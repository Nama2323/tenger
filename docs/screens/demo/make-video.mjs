// Task B9: the 30-second demo video, made only from real screen recordings of the deployed site (no generated
// images, video, voice or music). Each shot is recorded in headless Chrome at 1280x720 and cut to an exact number
// of frames at 30 fps; the captions are burned in from PNGs that Chrome renders in the site's own font (this ffmpeg
// has no text filters), and the title card is an HTML page using the site's stylesheet. Writes
// tenger-demo-30s.mp4 (H.264 High, yuv420p, 30 fps, no audio), tenger-demo-30s.srt and tenger-demo-30s-contact.png.
// Every shot also checks that the page names neither the base project nor its author.
// Usage: node docs/screens/demo/make-video.mjs [base URL]   (default: the public site)
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] ?? 'https://nama2323.github.io/tenger').replace(/\/$/, '');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9400 + Math.floor(Math.random() * 400); // a fresh port, so a stale Chrome can never answer instead
const FPS = 30;
const OUT = join(HERE, 'tenger-demo-30s');
const WORK = mkdtempSync(join(tmpdir(), 'tenger-b9-'));
const NAMES = /spherex[\s_-]*blink|pythonhack000/i;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Chrome over the DevTools protocol ----------

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'tenger-b9-chrome-'))}`,
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
  // The page as recorded must not name the base project or its author (user, 15 Nov).
  if (NAMES.test(await evaluate('document.documentElement.outerHTML'))) problems.push(`names on ${path}`);
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

const years = {};

const SHOTS = [
  {
    id: 's1-home-pluto', seconds: 4, caption: 'TENGER: see the sky change in NASA SPHEREx images.',
    /** Home in 3D, then the flight to Pluto: the page clock is stepped by hand, one frame per 1/30 s. */
    async record() {
      // A returning visitor: Pluto's images are already in the browser cache, so they appear as the flight lands.
      await open('/?target=pluto&panel=see', "document.querySelectorAll('.dates button, #dates button').length > 2 && !document.body.innerText.includes('images ready')");
      await sleep(2500);
      await open('/', "document.body.classList.contains('space-3d') && document.querySelector('.space-canvas')");
      await sleep(2000);
      await evaluate("document.getElementById('map-key') && (document.getElementById('map-key').open = false)");
      await evaluate(`(() => {
        let now = performance.now(); let queue = [];
        performance.now = () => now;
        window.requestAnimationFrame = (callback) => { queue.push(callback); return queue.length; };
        window.cancelAnimationFrame = () => {};
        window.__step = (ms) => { now += ms; const run = queue; queue = []; run.forEach((callback) => callback(now)); };
      })()`);
      const frames = [];
      const shoot = async (count, between = 0) => {
        for (let frame = 0; frame < count; frame += 1) {
          await evaluate(`window.__step(${1000 / FPS})`);
          if (between) await sleep(between);
          const shot = await send('Page.captureScreenshot', { format: 'png' });
          frames.push({ data: shot.result.data });
        }
      };
      await shoot(14);
      await evaluate("[...document.querySelectorAll('#rail button')].find((b) => b.textContent.trim().toLowerCase().startsWith('pluto')).click()");
      await shoot(64);
      await shoot(44, 1000 / FPS);
      return { frames, even: true };
    },
  },
  {
    id: 's2-barnard-blink', seconds: 3, caption: () => `Real images, ${years.a} and ${years.b}: Barnard's Star moved.`,
    /** Barnard's Star blinking between the AllWISE frame and the newest SPHEREx frame; the caption's years are theirs. */
    async record() {
      await open('/?target=barnard&panel=see', "document.body.innerText.includes('Frames from the investigation') && document.querySelector('#plates')");
      await scrollTo('#observatory', -64);
      await sleep(600);
      // The blink shows A and B in turn in the plate's own date label ("A · AllWISE 2010", "B · Aug 22, 2026"):
      // sample it until both have been on screen, and take each year from its own label.
      const labels = await evaluate(`new Promise((resolve) => {
        const seen = {}; const t0 = performance.now();
        const look = () => {
          const text = document.getElementById('plate-date')?.textContent ?? '';
          if (/^A\\b/.test(text)) seen.a = text;
          if (/^B\\b/.test(text)) seen.b = text;
          if ((seen.a && seen.b) || performance.now() - t0 > 6000) resolve(seen); else setTimeout(look, 50);
        };
        look();
      })`);
      years.a = (String(labels.a ?? '').match(/(19|20)\d\d/) ?? [])[0];
      years.b = (String(labels.b ?? '').match(/(19|20)\d\d/) ?? [])[0];
      years.labels = labels;
      if (!years.a || !years.b) problems.push(`frame years not found: ${JSON.stringify(labels)}`);
      return screenshotLoop(3.4);
    },
  },
  {
    id: 's3-s4-reveal', seconds: 12, captions: [
      { at: 0, seconds: 6, text: 'We locked a Pluto forecast in GitHub before opening the newest images.' },
      { at: 6, seconds: 6, text: '6 arcsec off: 3,000x closer than a straight line, but just outside our 95% region. A published miss.' },
    ],
    /** The Pluto reveal in one take: image, training track, frozen region (with its commit), then the straight line, the observation and the verdict. */
    async record() {
      await open('/?page=predictions&trial=pluto-position-2026b', "document.querySelector('#reveal[open] .reveal-svg')");
      return screencast(async (t0) => {
        const at = async (seconds) => { const wait = t0 * 1000 + seconds * 1000 - Date.now(); if (wait > 0) await sleep(wait); };
        await at(0.9); await key('ArrowRight');
        await at(2.2); await key('ArrowRight');
        await at(6.1); await key('ArrowRight');
        await at(8.2); await key('ArrowRight');
        await at(10.0); await key('ArrowRight');
        await at(12.4);
      });
    },
  },
  {
    id: 's5-why-forecasts', seconds: 4, caption: 'We found why, and froze new forecasts for 2027.',
    /** "Why we missed" opened on the Pluto card, then the open 2027 forecasts. */
    async record() {
      await open('/?page=predictions', "!document.getElementById('page-predictions').hasAttribute('data-loading') && document.querySelector('#trial-pluto-position-2026b .why-missed')");
      await evaluate("document.querySelector('#trial-pluto-position-2026b .why-missed').open = true");
      await sleep(500);
      await scrollTo('#trial-pluto-position-2026b .why-missed', -90);
      await sleep(1500);
      await scrollTo('#trial-pluto-position-2026b .why-missed', -90);
      await sleep(400);
      return screencast(async () => {
        await sleep(1500);
        await smoothScroll('#ledger-forecasts-title', 1000);
        await sleep(1800);
      });
    },
  },
  {
    id: 's6-planetx', seconds: 4,
    caption: 'Could SPHEREx see Planet X? We measured it: for the nominal Planet Nine, one image is 4 to 7 magnitudes too shallow.',
    /** The Planet X Lab: "Measured by TENGER", the headline, then the first measured curve. */
    async record() {
      await open('/?page=learn&lesson=lab', "document.querySelector('#measured .planetx-chart')");
      await scrollTo('#measured', -76);
      await sleep(1500);
      await scrollTo('#measured', -76);
      await sleep(400);
      return screencast(async () => {
        await sleep(1700);
        await smoothScroll('#measured .planetx-band', 1000, -76);
        await sleep(1700);
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
  console.log(JSON.stringify({ id: shot.id, frames: captured.frames.length, times: times.slice(0, 40), years, problems }));
  socket.close();
  chrome.kill();
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
  if (shot.captions) shot.captions.forEach((cue) => cues.push({ start: clock + cue.at, end: clock + cue.at + cue.seconds, text: cue.text }));
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
console.log(JSON.stringify({ years, cues: cues.map(({ start, end, lines }) => ({ start, end, lines })), probe, bytes: statSync(`${OUT}.mp4`).size, problems }, null, 2));
rmSync(WORK, { recursive: true, force: true });
socket.close();
chrome.kill();
process.exit(problems.length ? 1 : 0);
