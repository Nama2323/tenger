// Task B21 (re-make of B9): the 30-second demo video of Vestigium, made only from real screen recordings of the
// current build (no generated images, video, voice or music). Each shot is recorded in headless Chrome at 1280x720
// and cut to an exact number of frames at 30 fps; the captions are burned in from PNGs that Chrome renders in the
// site's own font (this ffmpeg has no text filters), and the title card is an HTML page using the site's stylesheet
// and logo (static/img/logo.svg). Writes vestigium-demo-30s.mp4 (H.264 High, yuv420p, 30 fps, no audio),
// vestigium-demo-30s.srt and vestigium-demo-30s-contact.png. Every shot checks that no page shows "TENGER",
// "SPHEREx Blink" or "pythonhack000". Numbers in the captions are read from the page or the data files.
// Usage: node docs/screens/demo/make-video.mjs [base URL]
//   Without a URL it serves this checkout's static/ folder itself on a free local port (the build as it is now).
//   ONLY=<shot id> records one shot and prints its frame times.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = join(HERE, '..', '..', '..', 'static');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.gz': 'application/gzip', '.bin': 'application/octet-stream', '.txt': 'text/plain' };
let server = null;
let BASE = process.argv[2]?.replace(/\/$/, '');
if (!BASE) {
  server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(STATIC, path));
    if (!file.startsWith(normalize(STATIC))) { res.writeHead(403).end(); return; }
    try { res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file)); } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  BASE = `http://127.0.0.1:${server.address().port}`;
}
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9400 + Math.floor(Math.random() * 400); // a fresh port, so a stale Chrome can never answer instead
const FPS = 30;
const OUT = join(HERE, 'vestigium-demo-30s');
const WORK = mkdtempSync(join(tmpdir(), 'vestigium-b21-'));
const NAMES = /spherex[\s_-]*blink|pythonhack000/i;
const OLD_BRAND = /TENGER|Tenger/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Chrome over the DevTools protocol ----------

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'vestigium-b21-chrome-'))}`,
  // The Mac's GPU (Metal): with software rendering the viewer page draws about 2 frames a second and the blink is lost.
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
  '--allow-file-access-from-files', 'about:blank',
], { stdio: 'ignore' });
// Never leave this Chrome running, whatever happens (a stale one keeps its port and burns the CPU).
process.on('exit', () => chrome.kill());
process.on('uncaughtException', (error) => { console.error(error); chrome.kill(); process.exit(1); });
let info;
for (let attempt = 0; attempt < 50 && !info; attempt += 1) {
  await sleep(200);
  info = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).catch(() => null);
}
const socket = new WebSocket(info.find((item) => item.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve));
let nextId = 0;
const pending = new Map();
const listeners = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); } else listeners.forEach((fn) => fn(message));
});
const send = (method, params = {}) => new Promise((resolve) => { nextId += 1; pending.set(nextId, resolve); socket.send(JSON.stringify({ id: nextId, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const problems = [];
listeners.push((message) => {
  if (message.method === 'Runtime.exceptionThrown') problems.push(message.params.exceptionDetails.exception?.description ?? 'exception');
  if (message.method === 'Network.requestWillBeSent' && /dev-fixtures|onrender\.com/.test(message.params.request.url)) problems.push(`request ${message.params.request.url}`);
});
for (const domain of ['Page', 'Runtime', 'Network']) await send(`${domain}.enable`);
/** A returning visitor: the tour already seen and the 3D Home chosen. */
let viewScript = null;
async function setView(view) {
  if (viewScript) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: viewScript });
  const added = await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('tenger.tour.v1', 'seen'); localStorage.setItem('tenger.view.v1', '${view}'); localStorage.setItem('tenger.game.howto.v1', '1'); } catch {}` });
  viewScript = added.result.identifier;
}
await setView('3d');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

async function open(path, ready) {
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(100);
  await send('Page.navigate', { url: BASE + path });
  for (let attempt = 0; attempt < 160; attempt += 1) {
    await sleep(250);
    if (await evaluate(`Boolean(${ready})`)) break;
  }
  await sleep(1200);
  await checkNames(path);
}

/** No page in the video may name the base project or its author, or show the old brand (user, 15 Nov). */
async function checkNames(where) {
  if (NAMES.test(await evaluate('document.documentElement.outerHTML'))) problems.push(`names on ${where}`);
  if (OLD_BRAND.test(await evaluate('document.title + " " + document.body.innerText'))) problems.push(`old brand on ${where}`);
}

const scrollTo = (selector, offset = -70) => evaluate(`scrollTo(0, document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top + scrollY + ${offset})`);
const smoothScroll = (selector, ms, offset = -70) => evaluate(`new Promise((resolve) => {
  const node = document.querySelector(${JSON.stringify(selector)});
  const from = scrollY;
  const to = Math.max(0, node.getBoundingClientRect().top + scrollY + ${offset});
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ${ms});
    const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    scrollTo(0, from + (to - from) * ease);
    if (k < 1) requestAnimationFrame(step); else resolve();
  };
  requestAnimationFrame(step);
})`);
const key = (name) => evaluate(`document.querySelector('#reveal').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(name)}, bubbles: true }))`);

/** Chrome's screencast with arrival times; the first frame counts from the start (a still page sends it late). */
async function screencast(script) {
  const frames = [];
  const onFrame = (message) => {
    if (message.method !== 'Page.screencastFrame') return;
    frames.push({ data: message.params.data, t: Date.now() / 1000 });
    send('Page.screencastFrameAck', { sessionId: message.params.sessionId });
  };
  listeners.push(onFrame);
  await send('Page.startScreencast', { format: 'png', maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  const start = Date.now() / 1000;
  await script(start);
  const end = Date.now() / 1000;
  await send('Page.stopScreencast');
  listeners.splice(listeners.indexOf(onFrame), 1);
  return { frames, start, end };
}

/**
 * Screenshots as fast as Chrome gives them, each kept with its arrival time, for `seconds`. Used where the
 * screencast misses changes (the blink swaps two layers without a new compositor frame).
 */
async function screenshotLoop(seconds) {
  const frames = [];
  const start = Date.now() / 1000;
  while (Date.now() / 1000 - start < seconds) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    frames.push({ data: shot.result.data, t: Date.now() / 1000 });
  }
  return { frames, start, end: Date.now() / 1000 };
}

/** Writes captured frames as one exact-length 30 fps clip (lossless enough to re-encode once at the end). */
function encodeShot(name, { frames, start, end, even }, count, skip = 0) {
  const dir = join(WORK, name);
  mkdirSync(dir, { recursive: true });
  const lines = [];
  frames.forEach((frame, index) => {
    const file = join(dir, `f${String(index).padStart(5, '0')}.png`);
    writeFileSync(file, Buffer.from(frame.data, 'base64'));
    const next = even ? 1 / FPS : (frames[index + 1]?.t ?? end) - (index === 0 ? start : Math.max(frame.t, start));
    lines.push(`file '${file}'`, `duration ${Math.max(0.001, next).toFixed(4)}`);
  });
  lines.push(`file '${join(dir, `f${String(frames.length - 1).padStart(5, '0')}.png`)}'`);
  writeFileSync(join(dir, 'list.txt'), lines.join('\n'));
  const output = join(WORK, `${name}.mp4`);
  run(['-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'),
    '-vf', `fps=${FPS},trim=start_frame=${skip},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=3,scale=1280:720:flags=lanczos,format=yuv420p`,
    '-frames:v', String(count), '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-an', output]);
  return output;
}

function run(args) {
  const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

async function screenshotFile(url, file, transparent = false) {
  if (transparent) await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await send('Page.navigate', { url });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(100);
    if (await evaluate("document.readyState === 'complete' && document.fonts.status === 'loaded'")) break;
  }
  await sleep(300);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
  if (transparent) await send('Emulation.setDefaultBackgroundColorOverride', {});
}

// ---------- The take: one continuous recording with a visible cursor (task B26) ----------

const facts = {};
const clicks = [];
const path = []; // every mouse position sent, with its time: [ms, x, y]
const mouse = { x: 980, y: 300 };
let takeStart = 0;

/** A cursor drawn by the page itself (so the screencast shows it), following the real mouse events. */
const CURSOR_SCRIPT = `(() => {
  if (window.__demoCursor) return; window.__demoCursor = true;
  const cursor = document.createElement('div');
  cursor.id = 'demo-cursor'; cursor.setAttribute('aria-hidden', 'true');
  cursor.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647;pointer-events:none;will-change:transform;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.6));transform:translate(977px,298px)';
  cursor.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M3 2 L3 20 L8 15.5 L11.5 22.5 L14.6 21 L11.1 14 L18 14 Z" fill="#fff" stroke="#05070d" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const style = document.createElement('style');
  style.textContent = '@keyframes demo-ripple{from{transform:translate(-50%,-50%) scale(0.3);opacity:0.95}to{transform:translate(-50%,-50%) scale(1.7);opacity:0}}.demo-ripple{position:fixed;width:34px;height:34px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 2px rgba(5,7,13,0.55);pointer-events:none;z-index:2147483647;animation:demo-ripple 0.45s ease-out forwards}';
  const host = () => [...document.querySelectorAll('dialog[open]')].at(-1) ?? document.body;
  const place = () => { if (cursor.parentElement !== host()) host().append(cursor); };
  const start = () => { document.head.append(style); place(); new MutationObserver(place).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] }); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  addEventListener('pointermove', (event) => { cursor.style.transform = 'translate(' + (event.clientX - 3) + 'px,' + (event.clientY - 2) + 'px)'; }, true);
  addEventListener('pointerdown', (event) => {
    const ring = document.createElement('div'); ring.className = 'demo-ripple';
    ring.style.left = event.clientX + 'px'; ring.style.top = event.clientY + 'px';
    host().append(ring); setTimeout(() => ring.remove(), 500);
  }, true);
})()`;

const mouseAt = async (x, y, buttons = 0) => {
  mouse.x = x; mouse.y = y;
  path.push([Date.now(), x, y]);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons, button: buttons ? 'left' : 'none' });
};
/**
 * An eased (ease-in-out), slightly curved move. 400 to 700 ms; a move that could not stay under about 115 px per
 * video frame in 700 ms goes in two hops. The cursor never goes below y = 600, where the captions are.
 */
async function moveTo(x, y, { ms = null, buttons = 0 } = {}) {
  y = Math.min(y, 600);
  const from = { ...mouse };
  const dx = x - from.x; const dy = y - from.y; const dist = Math.hypot(dx, dy);
  if (dist < 1) return;
  if (dist > 720 && ms === null) {
    await moveTo(from.x + dx * 0.5 + dy * 0.04, from.y + dy * 0.5 - dx * 0.04, { ms: 560, buttons });
    await moveTo(x, y, { ms: 560, buttons });
    return;
  }
  const duration = ms ?? Math.min(700, Math.max(400, dist * 0.95));
  const bend = 0.1 * dist;
  const cx = (from.x + x) / 2 - (dy / dist) * bend;
  const cy = (from.y + y) / 2 + (dx / dist) * bend;
  const t0 = Date.now();
  for (;;) {
    const k = Math.min(1, (Date.now() - t0) / duration);
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    await mouseAt((1 - e) ** 2 * from.x + 2 * (1 - e) * e * cx + e * e * x, (1 - e) ** 2 * from.y + 2 * (1 - e) * e * cy + e * e * y, buttons);
    if (k >= 1) break;
    await sleep(12);
  }
}
const centre = (selector) => evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return null; const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
/** Moves to an element, hovers a moment, checks that the pointer is on it, then presses and releases. */
async function click(selector, { dx = 0, dy = 0, expect = null } = {}) {
  const point = await centre(selector);
  if (!point) { problems.push(`click target missing: ${selector}`); return; }
  await moveTo(point[0] + dx, point[1] + dy);
  await sleep(180);
  const hit = await evaluate(`(() => { const n = document.elementFromPoint(${mouse.x}, ${mouse.y}); const t = document.querySelector(${JSON.stringify(selector)}); return Boolean(n && t && (t === n || t.contains(n))); })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mouse.x, y: mouse.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(70);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mouse.x, y: mouse.y, button: 'left', buttons: 0, clickCount: 1 });
  clicks.push({ selector, at: ((Date.now() - takeStart) / 1000).toFixed(2), hit, expect });
  if (!hit) problems.push(`click missed ${selector}`);
}
/** Smooth wheel scrolling: many small steps over 600 to 900 ms at the pointer. */
async function wheel(total, ms = 760) {
  const steps = 24;
  for (let index = 0; index < steps; index += 1) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mouse.x, y: mouse.y, deltaX: 0, deltaY: total / steps });
    await sleep(ms / steps);
  }
}
const waitFor = async (expression, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await evaluate(`Boolean(${expression})`)) return true; await sleep(60); } return false; };

/** The shots: their captions and lengths (for the captions, the .srt and the contact sheet). */
const SHOTS = [
  { id: 's1-home', seconds: 4, caption: 'Vestigium: watch the sky move in real NASA SPHEREx pictures.' },
  { id: 's2-barnard', seconds: 4, top: true, caption: () => `Real pictures, ${facts.yearA} and ${facts.yearB}: Barnard's Star moved about ${facts.shift}″.` },
  { id: 's3-s4-reveal', seconds: 12, captions: [
    { at: 0, seconds: 6, text: 'We locked a Pluto forecast on GitHub before opening the newest pictures.' },
    { at: 6, seconds: 6, text: () => `${facts.plutoOff}″ off: 3,000× closer than a straight line, but just outside our 95% oval. A published miss.` },
  ] },
  { id: 's5-why-2027', seconds: 4, caption: 'We found why, and locked new forecasts for 2027.' },
  { id: 's6-planetx', seconds: 3, caption: 'Could SPHEREx see Planet X? We measured it: not in one image.' },
];
const TAKE_SECONDS = SHOTS.reduce((sum, shot) => sum + shot.seconds, 0);

/** The whole story in one screencast, written to disk frame by frame (JPEG) with arrival times. */
async function recordTake() {
  // The numbers the captions need, from the trial's own file.
  await open('/?page=predictions', "!document.getElementById('page-predictions').hasAttribute('data-loading')");
  const check = await evaluate("fetch('data/trials/pluto-position-2026b/verification.json').then((r) => r.json())");
  const model = check?.residuals?.model?.error_arcsec; const line = check?.residuals?.baseline?.error_arcsec;
  facts.plutoOff = Number.isFinite(model) ? model.toFixed(1) : null;
  facts.plutoRatio = Number.isFinite(model) && Number.isFinite(line) ? line / model : null;
  if (!facts.plutoOff || !(facts.plutoRatio >= 3000) || check?.status !== 'miss') problems.push(`Pluto facts: ${JSON.stringify({ model, line, status: check?.status })}`);

  // Home with the 3D first screen running, the cursor over the scene.
  await open('/', "document.getElementById('hero-watch') && !document.getElementById('page-home').hasAttribute('data-loading')");
  await mouseAt(mouse.x, mouse.y);
  await waitFor("document.getElementById('page-home').classList.contains('hero-mode')", 8000);
  await sleep(1500);

  const dir = join(WORK, 'take');
  mkdirSync(dir, { recursive: true });
  const frames = [];
  const onFrame = (message) => {
    if (message.method !== 'Page.screencastFrame') return;
    const file = join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(message.params.data, 'base64'));
    frames.push({ file, t: Date.now() });
    send('Page.screencastFrameAck', { sessionId: message.params.sessionId });
  };
  listeners.push(onFrame);
  await send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  takeStart = Date.now();
  const at = async (seconds) => { const wait = takeStart + seconds * 1000 - Date.now(); if (wait > 0) await sleep(wait); };

  // 0–4 s: the 3D first screen; the cursor glides to "Watch Barnard's Star move" and clicks.
  await at(0.5); await moveTo(860, 380, { ms: 650 });
  await at(2.5); await click('#hero-watch', { expect: 'investigate' });
  // 4–8 s: Barnard's Star blinking; a small drag of Contrast to the right.
  await waitFor("document.body.dataset.page === 'investigate' && document.getElementById('play').getAttribute('aria-pressed') === 'true'");
  await at(4.4);
  const thumb = await evaluate("(() => { const s = document.getElementById('contrast'); const r = s.getBoundingClientRect(); const k = (Number(s.value) - Number(s.min)) / (Number(s.max) - Number(s.min)); return [r.left + 8 + k * (r.width - 16), r.top + r.height / 2]; })()");
  await moveTo(thumb[0], thumb[1]);
  await sleep(150);
  const before = await evaluate("document.getElementById('contrast').value");
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mouse.x, y: mouse.y, button: 'left', buttons: 1, clickCount: 1 });
  await moveTo(thumb[0] + 64, thumb[1], { ms: 700, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mouse.x, y: mouse.y, button: 'left', buttons: 0, clickCount: 1 });
  facts.contrast = [before, await evaluate("document.getElementById('contrast').value")];
  clicks.push({ selector: '#contrast (drag)', at: ((Date.now() - takeStart) / 1000).toFixed(2), hit: Number(facts.contrast[1]) > Number(facts.contrast[0]), expect: 'contrast up' });
  facts.finding = await evaluate("document.getElementById('finding').textContent");
  facts.shift = (facts.finding.match(/about ([\d,]+)″/) ?? [])[1];
  const labels = await evaluate(`new Promise((resolve) => { const seen = {}; const t0 = performance.now();
    const look = () => { const text = document.getElementById('plate-date')?.textContent ?? '';
      if (/^A\\b/.test(text)) seen.a = text; if (/^B\\b/.test(text)) seen.b = text;
      if ((seen.a && seen.b) || performance.now() - t0 > 2500) resolve(seen); else setTimeout(look, 40); };
    look(); })`);
  facts.yearA = (String(labels.a ?? '').match(/(19|20)\d\d/) ?? [])[0];
  facts.yearB = (String(labels.b ?? '').match(/(19|20)\d\d/) ?? [])[0];
  if (!facts.yearA || !facts.yearB || !facts.shift) problems.push(`Barnard facts: ${JSON.stringify({ labels, finding: facts.finding })}`);
  await checkNames('Barnard');
  await at(7.0); await moveTo(mouse.x - 40, mouse.y - 120, { ms: 600 });
  // 8–14 s: "Predictions" in the menu, a smooth scroll past the four steps and back, "See how it works with Pluto", "Next".
  await at(7.9); await click('#site-nav [data-page-link="predictions"]', { expect: 'predictions' });
  await waitFor("document.body.dataset.page === 'predictions' && !document.getElementById('story-pluto').disabled");
  await moveTo(700, 420, { ms: 450 });
  await at(9.3); await wheel(420, 780);
  await at(10.4); await wheel(-420, 760);
  await at(11.1); await click('#story-pluto', { expect: 'reveal' });
  await waitFor("document.getElementById('reveal').open");
  await checkNames('Pluto reveal');
  await at(12.4); await click('#reveal-forward');
  await at(13.2); await click('#reveal-forward');
  // 14–20 s: on to the verdict with the zoomed inset; the cursor rests near the inset.
  await at(14.0); await click('#reveal-forward');
  await at(14.6); await click('#reveal-forward');
  await at(15.2); await click('#reveal-forward', { expect: 'verdict' });
  await at(16.2);
  const inset = await centre('#reveal-stage .rv-inset');
  const stage = await centre('#reveal-stage');
  const rest = inset ?? stage;
  await moveTo(rest[0] - 140, rest[1] + 40, { ms: 650 });
  facts.revealStep = await evaluate("document.querySelector('#reveal-steps [aria-current]')?.textContent ?? ''");
  if (facts.revealStep !== 'Verdict') problems.push(`reveal step ${facts.revealStep}`);
  // 20–24 s: close the reveal, scroll to "Why we missed", open it, then on to the 2027 card under it.
  await at(18.3); await click('#reveal-close', { expect: 'reveal closed' });
  await waitFor("!document.getElementById('reveal').open");
  await moveTo(640, 360);
  const toWhy = await evaluate("document.querySelector('#trial-pluto-position-2026b .why-missed').getBoundingClientRect().top - 140");
  await wheel(toWhy, 700);
  await sleep(150);
  await click('#trial-pluto-position-2026b .why-missed > summary', { dx: -40, expect: 'why open' });
  await waitFor("document.querySelector('#trial-pluto-position-2026b .why-missed').open && document.getElementById('story-check').classList.contains('is-under-why')", 1500);
  await moveTo(640, 420);
  const toCheck = await evaluate("(() => { const k = document.getElementById('story-check').getBoundingClientRect(); return k.bottom - 560; })()");
  await wheel(toCheck, 820);
  // 24–27 s: "Planet X" in the menu; the Lab's top.
  await at(23.3); await click('#nav-planetx', { expect: 'lab' });
  await waitFor("!document.getElementById('lab-view').hidden");
  facts.labTitle = await evaluate("document.getElementById('lab-view-title')?.textContent ?? ''");
  await checkNames('Planet X Lab');
  await moveTo(520, 260, { ms: 600 });
  await at(TAKE_SECONDS + 0.3);
  const end = Date.now();
  await send('Page.stopScreencast');
  listeners.splice(listeners.indexOf(onFrame), 1);
  facts.pages = { lab: Boolean(facts.labTitle) };
  return { frames, start: takeStart, end };
}

/** Writes the take's frames as one exact-length 30 fps clip. */
function encodeTake({ frames, start, end }, count) {
  const dir = join(WORK, 'take');
  const lines = [];
  frames.forEach((frame, index) => {
    const next = ((frames[index + 1]?.t ?? end) - (index === 0 ? start : Math.max(frame.t, start))) / 1000;
    lines.push(`file '${frame.file}'`, `duration ${Math.max(0.001, next).toFixed(4)}`);
  });
  lines.push(`file '${frames.at(-1).file}'`);
  writeFileSync(join(dir, 'list.txt'), lines.join('\n'));
  const output = join(WORK, 'take.mp4');
  run(['-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'),
    '-vf', `fps=${FPS},tpad=stop_mode=clone:stop_duration=3,scale=1280:720:flags=lanczos,format=yuv420p`,
    '-frames:v', String(count), '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-an', output]);
  return output;
}

/** The largest step of the cursor between two video frames (30 fps), from the positions sent. */
function maxStepPerFrame(start) {
  const position = (ms) => { let last = path[0]; for (const point of path) { if (point[0] > ms) break; last = point; } return last; };
  let worst = 0;
  for (let frame = 1; frame < TAKE_SECONDS * FPS; frame += 1) {
    const a = position(start + ((frame - 1) * 1000) / FPS); const b = position(start + (frame * 1000) / FPS);
    worst = Math.max(worst, Math.hypot(b[1] - a[1], b[2] - a[2]));
  }
  return Math.round(worst);
}

// ---------- Record, caption, assemble ----------

const cursorScript = await send('Page.addScriptToEvaluateOnNewDocument', { source: CURSOR_SCRIPT });
const taken = await recordTake();
// The captions and the title card are drawn without the cursor (the title card has none, task B26).
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: cursorScript.result.identifier });
const clips = [{ id: 'take', file: encodeTake(taken, TAKE_SECONDS * FPS) }];
facts.frames = taken.frames.length;
facts.maxCursorStepPx = maxStepPerFrame(taken.start);
if (facts.maxCursorStepPx > 120) problems.push(`cursor moved ${facts.maxCursorStepPx} px in one frame`);
console.log('recorded the take', taken.frames.length, 'frames');
const title = join(WORK, 'title.png');
await screenshotFile(pathToFileURL(join(HERE, 'video', 'title-card.html')).href, title);
const titleClip = join(WORK, 's7-title.mp4');
run(['-loop', '1', '-i', title, '-vf', `fps=${FPS},format=yuv420p`, '-frames:v', String(3 * FPS), '-c:v', 'libx264', '-crf', '12', '-an', titleClip]);
clips.push({ id: 's7-title', file: titleClip });

// The caption table: shot captions laid end to end; the title card carries its own text.
const cues = [];
let clock = 0;
for (const shot of SHOTS) {
  if (shot.captions) shot.captions.forEach((cue) => cues.push({ start: clock + cue.at, end: clock + cue.at + cue.seconds, text: typeof cue.text === 'function' ? cue.text() : cue.text }));
  else cues.push({ start: clock, end: clock + shot.seconds, top: shot.top === true, text: typeof shot.caption === 'function' ? shot.caption() : shot.caption });
  clock += shot.seconds;
}
const total = clock + 3;

// Each caption drawn by Chrome on a transparent page; its lines read back so the .srt breaks where the video does.
for (const [index, cue] of cues.entries()) {
  cue.png = join(WORK, `caption-${index + 1}.png`);
  await screenshotFile(`${pathToFileURL(join(HERE, 'video', 'caption.html')).href}?t=${encodeURIComponent(cue.text)}${cue.top ? '&pos=top' : ''}`, cue.png, true);
  cue.lines = await evaluate(`(() => {
    const rows = new Map();
    for (const span of document.querySelectorAll('#box span')) { const top = Math.round(span.offsetTop); rows.set(top, [...(rows.get(top) ?? []), span.textContent]); }
    return [...rows.keys()].sort((a, b) => a - b).map((top) => rows.get(top).join(' '));
  })()`);
  if (cue.lines.length > 2) problems.push(`caption ${index + 1} has ${cue.lines.length} lines`);
}

const inputs = [...clips.flatMap((clip) => ['-i', clip.file]), ...cues.flatMap((cue) => ['-loop', '1', '-i', cue.png])];
const filter = [`${clips.map((_, index) => `[${index}:v]`).join('')}concat=n=${clips.length}:v=1:a=0[v0]`];
cues.forEach((cue, index) => {
  filter.push(`[v${index}][${clips.length + index}:v]overlay=0:0:enable='gte(t,${cue.start})*lt(t,${cue.end})'[v${index + 1}]`);
});
run([...inputs, '-filter_complex', filter.join(';'), '-map', `[v${cues.length}]`, '-frames:v', String(total * FPS), '-r', String(FPS),
  '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-preset', 'slow', '-crf', '20',
  '-movflags', '+faststart', '-an', `${OUT}.mp4`]);

const stamp = (seconds) => {
  const ms = Math.round(seconds * 1000);
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};
writeFileSync(`${OUT}.srt`, cues.map((cue, index) => `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.lines.join('\n')}\n`).join('\n'));

// Contact sheet: one frame from the middle of each shot, 4 across.
const middles = [];
clock = 0;
for (const shot of [...SHOTS.flatMap((item) => (item.captions ? item.captions.map((cue) => ({ seconds: cue.seconds })) : [{ seconds: item.seconds }])), { seconds: 3 }]) {
  middles.push(clock + shot.seconds / 2);
  clock += shot.seconds;
}
const select = middles.map((time) => `eq(n\\,${Math.round(time * FPS)})`).join('+');
run(['-i', `${OUT}.mp4`, '-vf', `select='${select}',scale=640:360,tile=4x2:padding=8:color=0x05070d`, '-frames:v', '1', '-fps_mode', 'vfr', `${OUT}-contact.png`]);

const probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries',
  'stream=codec_name,profile,width,height,pix_fmt,r_frame_rate,nb_read_frames:format=duration,size', '-of', 'json', `${OUT}.mp4`]).stdout.toString());
console.log(JSON.stringify({ facts, clicks, cues: cues.map(({ start, end, lines }) => ({ start, end, lines })), probe, bytes: statSync(`${OUT}.mp4`).size, problems }, null, 2));
rmSync(WORK, { recursive: true, force: true });
socket.close();
chrome.kill();
server?.close();
process.exit(problems.length ? 1 : 0);
