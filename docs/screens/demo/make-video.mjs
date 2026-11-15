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

// ---------- The shots ----------

const facts = {};
/** Scrolls an element that scrolls itself (Home on wide screens) smoothly to a child. */
const smoothScrollIn = (scroller, selector, ms) => evaluate(`new Promise((resolve) => {
  const box = document.querySelector(${JSON.stringify(scroller)});
  const node = document.querySelector(${JSON.stringify(selector)});
  const from = box.scrollTop; const to = from + node.getBoundingClientRect().top - box.getBoundingClientRect().top;
  const t0 = performance.now();
  const step = (now) => { const k = Math.min(1, (now - t0) / ${ms}); const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    box.scrollTop = from + (to - from) * ease; if (k < 1) requestAnimationFrame(step); else resolve(); };
  requestAnimationFrame(step);
})`);
/** Home with its 3D map already running (woken by a pointer move), scrolled back to the first screen. */
async function openHome() {
  await open('/', "document.getElementById('hero-watch') && !document.getElementById('page-home').hasAttribute('data-loading')");
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 300 });
  for (let attempt = 0; attempt < 80; attempt += 1) { await sleep(200); if (await evaluate("!document.getElementById('space-time').hidden")) break; }
  await evaluate("document.getElementById('map-key') && (document.getElementById('map-key').open = false); document.getElementById('page-home').scrollTop = 0");
  await sleep(1500);
}
const clickAt = async (selector) => {
  const box = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box[0], y: box[1] });
  await sleep(120);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box[0], y: box[1], button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box[0], y: box[1], button: 'left', clickCount: 1 });
};

const SHOTS = [
  {
    id: 's1-home', seconds: 4, caption: 'Vestigium: watch the sky move in real NASA SPHEREx pictures.',
    /** The first screen over the live, slowly turning 3D scene (B25), then its text slides off the full 3D section. */
    async record() {
      await openHome();
      return screencast(async () => {
        await sleep(1700);
        await smoothScrollIn('#page-home', '.home-spacer', 1300);
        await sleep(1300);
      });
    },
  },
  {
    id: 's2-barnard', seconds: 4, caption: () => `Real pictures, ${facts.yearA} and ${facts.yearB}: Barnard's Star moved about ${facts.shift}″.`,
    /** A tap on "Watch Barnard's Star move", then Barnard's Star blinking; years and shift read from the page. */
    async record() {
      await openHome();
      const shots = { frames: [], start: Date.now() / 1000 };
      const grab = async () => { const shot = await send('Page.captureScreenshot', { format: 'png' }); shots.frames.push({ data: shot.result.data, t: Date.now() / 1000 }); };
      await grab(); await sleep(250); await grab();
      await clickAt('#hero-watch');
      const loop = await screenshotLoop(4.0);
      shots.frames.push(...loop.frames);
      shots.end = loop.end;
      const finding = await evaluate("document.getElementById('finding').textContent");
      facts.finding = finding;
      facts.shift = (finding.match(/about ([\d,]+)″/) ?? [])[1];
      const labels = await evaluate(`new Promise((resolve) => {
        const seen = {}; const t0 = performance.now();
        const look = () => { const text = document.getElementById('plate-date')?.textContent ?? '';
          if (/^A\\b/.test(text)) seen.a = text; if (/^B\\b/.test(text)) seen.b = text;
          if ((seen.a && seen.b) || performance.now() - t0 > 6000) resolve(seen); else setTimeout(look, 50); };
        look(); })`);
      facts.labels = labels;
      facts.yearA = (String(labels.a ?? '').match(/(19|20)\d\d/) ?? [])[0];
      facts.yearB = (String(labels.b ?? '').match(/(19|20)\d\d/) ?? [])[0];
      if (!facts.yearA || !facts.yearB || !facts.shift) problems.push(`Barnard facts missing: ${JSON.stringify(facts)}`);
      await checkNames('Barnard blink');
      return shots;
    },
  },
  {
    id: 's3-s4-reveal', seconds: 12, captions: [
      { at: 0, seconds: 6, text: 'We locked a Pluto forecast on GitHub before opening the newest pictures.' },
      { at: 6, seconds: 6, text: () => `${facts.plutoOff}″ off: 3,000× closer than a straight line, but just outside our 95% oval. A published miss.` },
    ],
    /** Predictions: the four steps; then the Pluto reveal from its first step to the verdict with the zoomed inset. */
    async record() {
      await open('/?page=predictions', "!document.getElementById('page-predictions').hasAttribute('data-loading') && !document.getElementById('story-pluto').disabled");
      // The caption's numbers from the trial's own verification file.
      const check = await evaluate("fetch('data/trials/pluto-position-2026b/verification.json').then((r) => r.json())");
      const model = check?.residuals?.model?.error_arcsec; const line = check?.residuals?.baseline?.error_arcsec;
      facts.plutoOff = Number.isFinite(model) ? model.toFixed(1) : null;
      facts.plutoRatio = Number.isFinite(model) && Number.isFinite(line) ? line / model : null;
      facts.plutoStatus = check?.status;
      if (!facts.plutoOff || !(facts.plutoRatio >= 3000) || check?.status !== 'miss') problems.push(`Pluto facts: ${JSON.stringify({ model, line, status: check?.status })}`);
      return screencast(async (t0) => {
        const at = async (seconds) => { const wait = t0 * 1000 + seconds * 1000 - Date.now(); if (wait > 0) await sleep(wait); };
        await at(0.5); await smoothScroll('#story-how-title', 900, -80);
        await at(2.7); await evaluate("document.getElementById('story-pluto').click()");
        await at(4.3); await key('ArrowRight');
        await at(5.5); await key('ArrowRight');
        await at(6.4); await key('ArrowRight');
        await at(7.4); await key('ArrowRight');
        await at(8.3); await key('ArrowRight');
        await at(12.3);
        facts.revealStep = await evaluate("document.querySelector('#reveal-steps [aria-current]')?.textContent ?? ''");
        await checkNames('Pluto reveal');
      });
    },
  },
  {
    id: 's5-why-2027', seconds: 4, caption: 'We found why, and locked new forecasts for 2027.',
    /** "Why we missed" opened on the Pluto card (full width), then the "Check us in 2027" card right under it. */
    async record() {
      await open('/?page=predictions', "!document.getElementById('page-predictions').hasAttribute('data-loading') && document.querySelector('#trial-pluto-position-2026b .why-missed')");
      await evaluate("document.querySelector('#trial-pluto-position-2026b .why-missed').open = true");
      await sleep(500);
      await scrollTo('#trial-pluto-position-2026b .why-missed', -110);
      await sleep(1200);
      await scrollTo('#trial-pluto-position-2026b .why-missed', -110);
      await sleep(400);
      // Since B22 the Pluto card is full width and "Check us in 2027" sits right under it while "Why we missed" is open:
      // read the reasons, then scroll until the end of "Why we missed" and the 2027 card are on screen together.
      return screencast(async () => {
        await sleep(1700);
        await smoothScroll('#story-check', 1000, -400);
        await sleep(1600);
      });
    },
  },
  {
    id: 's6-planetx', seconds: 3, caption: 'Could SPHEREx see Planet X? We measured it: not in one image.',
    /** The Planet X card on Home, a tap, and the top of the Planet X Lab. */
    async record() {
      await openHome();
      for (let attempt = 0; attempt < 30; attempt += 1) { await sleep(150); if (await evaluate("document.getElementById('hero-planetx-line').textContent.length > 0")) break; }
      return screencast(async () => {
        await sleep(1100);
        await clickAt('#hero-planetx');
        await sleep(2000);
        facts.labTitle = await evaluate("document.getElementById('lab-view-title')?.textContent ?? ''");
        await checkNames('Planet X Lab');
      });
    },
  },
];

// ---------- Record, caption, assemble ----------

// ONLY=<shot id> records that shot alone and prints its frame timing (for checking a recipe), then stops.
if (process.env.ONLY) {
  const shot = SHOTS.find((item) => item.id === process.env.ONLY);
  const captured = await shot.record();
  const times = captured.frames.map((frame) => (frame.t ? (frame.t - captured.start).toFixed(2) : '-'));
  console.log(JSON.stringify({ id: shot.id, frames: captured.frames.length, times: times.slice(0, 40), facts, problems }));
  socket.close();
  chrome.kill();
  server?.close();
  process.exit(0);
}

const clips = [];
for (const shot of SHOTS) {
  const captured = await shot.record();
  clips.push({ id: shot.id, file: encodeShot(shot.id, captured, shot.seconds * FPS) });
  console.log('recorded', shot.id, captured.frames.length, 'frames');
}
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
  else cues.push({ start: clock, end: clock + shot.seconds, text: typeof shot.caption === 'function' ? shot.caption() : shot.caption });
  clock += shot.seconds;
}
const total = clock + 3;

// Each caption drawn by Chrome on a transparent page; its lines read back so the .srt breaks where the video does.
for (const [index, cue] of cues.entries()) {
  cue.png = join(WORK, `caption-${index + 1}.png`);
  await screenshotFile(`${pathToFileURL(join(HERE, 'video', 'caption.html')).href}?t=${encodeURIComponent(cue.text)}`, cue.png, true);
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
console.log(JSON.stringify({ facts, cues: cues.map(({ start, end, lines }) => ({ start, end, lines })), probe, bytes: statSync(`${OUT}.mp4`).size, problems }, null, 2));
rmSync(WORK, { recursive: true, force: true });
socket.close();
chrome.kill();
server?.close();
process.exit(problems.length ? 1 : 0);
