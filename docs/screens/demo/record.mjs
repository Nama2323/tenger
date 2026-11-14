// Records the silent demo clips for the 30-second video (task B8) from the public site, real data only:
// 1280x720, H.264, 30 fps. Page clips use Chrome's screencast with real timestamps, resampled to a constant
// 30 fps; the 3D clip steps the page clock by hand (one frame per 1/30 s), so software WebGL stays smooth.
// Needs Google Chrome, ffmpeg and Node 22+. No npm packages.
// Usage: node docs/screens/demo/record.mjs http://localhost:8766 docs/screens/demo [clip ...]
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9347;
const FPS = 30;
const [base, outDir, ...only] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function browser() {
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'tenger-demo-'))}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', 'about:blank',
  ], { stdio: 'ignore' });
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
  const errors = [];
  listeners.push((message) => {
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? 'exception');
    if (message.method === 'Network.requestWillBeSent' && message.params.request.url.includes('dev-fixtures')) errors.push(`fixture request ${message.params.request.url}`);
  });
  for (const domain of ['Page', 'Runtime', 'Network']) await send(`${domain}.enable`);
  // A returning visitor: the tour already seen; the 3D Home chosen.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('tenger.tour.v1', 'seen'); localStorage.setItem('tenger.view.v1', '3d'); localStorage.setItem('tenger.game.howto.v1', '1'); } catch {}" });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  const open = async (path, ready) => {
    await send('Page.navigate', { url: base + path });
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await sleep(250);
      if (await evaluate(`Boolean(${ready})`)) break;
    }
    await sleep(1200);
  };
  return { chrome, socket, send, evaluate, listeners, errors, open };
}

/** Real-time screencast while `script` runs; returns frames with timestamps. */
async function screencast(page, script) {
  const frames = [];
  const onFrame = (message) => {
    if (message.method !== 'Page.screencastFrame') return;
    // Timed by arrival on Node's clock, the same clock as start and end (Chrome's own timestamps can be offset).
    frames.push({ data: message.params.data, t: Date.now() / 1000 });
    page.send('Page.screencastFrameAck', { sessionId: message.params.sessionId });
  };
  page.listeners.push(onFrame);
  await page.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1280, maxHeight: 720, everyNthFrame: 2 });
  const start = Date.now() / 1000;
  await script();
  const end = Date.now() / 1000;
  await page.send('Page.stopScreencast');
  page.listeners.splice(page.listeners.indexOf(onFrame), 1);
  return { frames, start, end };
}

/** Encodes timestamped JPEG frames (or evenly spaced PNG frames) into a 30 fps H.264 MP4 of `seconds`. */
function encode(name, { frames, start, end, even }) {
  const dir = mkdtempSync(join(tmpdir(), `tenger-${name}-`));
  const lines = [];
  frames.forEach((frame, index) => {
    const file = join(dir, `f${String(index).padStart(5, '0')}.${even ? 'png' : 'jpg'}`);
    writeFileSync(file, Buffer.from(frame.data, 'base64'));
    // The first frame is the page as it was when recording started; a still page sends it late, so it counts from the start.
    const next = even ? 1 / FPS : (frames[index + 1]?.t ?? end) - (index === 0 ? start : Math.max(frame.t, start));
    // Real gaps (the 30 fps filter drops extra frames); a frame never gets more time than it was on screen.
    lines.push(`file '${file}'`, `duration ${Math.max(0.001, next).toFixed(4)}`);
  });
  lines.push(`file '${join(dir, `f${String(frames.length - 1).padStart(5, '0')}.${even ? 'png' : 'jpg'}`)}'`);
  writeFileSync(join(dir, 'list.txt'), lines.join('\n'));
  const output = join(outDir, `${name}.mp4`);
  for (const crf of [21, 24, 27, 30]) {
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'),
      '-vf', `fps=${FPS},scale=1280:720:flags=lanczos:out_range=tv,format=yuv420p`, '-color_range', 'tv', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', String(crf),
      '-an', '-movflags', '+faststart', output], { stdio: 'inherit' });
    if (statSync(output).size < 2.9 * 1024 * 1024) break;
  }
  rmSync(dir, { recursive: true, force: true });
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_frames:format=duration,size', '-of', 'json', output]).stdout.toString();
  return { output, probe: JSON.parse(probe) };
}

const smoothScroll = (page, selector, ms, offset = -70) => page.evaluate(`new Promise((resolve) => {
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

const CLIPS = {
  /** (a) Home: the 3D scene, a slow turn, then the camera flies to Pluto and its investigation opens. */
  async 'a-home-3d'(page) {
    await page.open('/', "document.body.classList.contains('space-3d') && document.querySelector('.space-canvas')");
    await sleep(2500);
    await page.evaluate("document.getElementById('map-key') && (document.getElementById('map-key').open = false)");
    await page.evaluate(`(() => {
      let now = performance.now(); let queue = [];
      performance.now = () => now;
      window.requestAnimationFrame = (callback) => { queue.push(callback); return queue.length; };
      window.cancelAnimationFrame = () => {};
      window.__step = (ms) => { now += ms; const run = queue; queue = []; run.forEach((callback) => callback(now)); };
    })()`);
    const frames = [];
    const shoot = async (count, between = 0) => {
      for (let frame = 0; frame < count; frame += 1) {
        await page.evaluate(`window.__step(${1000 / FPS})`);
        if (between) await sleep(between);
        const shot = await page.send('Page.captureScreenshot', { format: 'png' });
        frames.push({ data: shot.result.data });
      }
    };
    await shoot(24);
    // A slow drag turns the scene (OrbitControls), one small move per frame.
    const canvas = await page.evaluate("(() => { const b = document.querySelector('.space-canvas').getBoundingClientRect(); return { x: b.left + b.width * 0.55, y: b.top + b.height * 0.5 }; })()");
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: canvas.x, y: canvas.y, button: 'left', clickCount: 1 });
    for (let frame = 0; frame < 42; frame += 1) {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: canvas.x - frame * 3.2, y: canvas.y + frame * 0.6, button: 'left', buttons: 1 });
      await shoot(1);
    }
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: canvas.x - 42 * 3.2, y: canvas.y + 42 * 0.6, button: 'left', clickCount: 1 });
    await shoot(12);
    await page.evaluate("[...document.querySelectorAll('#rail button')].find((b) => b.textContent.trim().toLowerCase().startsWith('pluto')).click()");
    await shoot(50);
    // The investigation panel slides in on the real clock: give it time between frames.
    await shoot(42, 1000 / FPS);
    return { frames, even: true };
  },

  /** (b) Predictions: the scoreboard, the Pluto miss with "Why we missed", then the open v2 forecasts. */
  async 'b-predictions'(page) {
    await page.open('/?page=predictions', "!document.getElementById('page-predictions').hasAttribute('data-loading') && document.querySelector('#trial-pluto-position-2026b')");
    await page.evaluate("scrollTo(0, document.getElementById('ledger-board').getBoundingClientRect().top + scrollY - 70)");
    await sleep(500);
    return screencast(page, async () => {
      await sleep(800);
      await smoothScroll(page, '#trial-pluto-position-2026b', 1100);
      await sleep(300);
      await page.evaluate("(() => { const d = document.querySelector('#trial-pluto-position-2026b .why-missed'); if (d) d.open = true; })()");
      await sleep(1100);
      await smoothScroll(page, '#ledger-forecasts-title', 1100);
      await sleep(1300);
    });
  },

  /** (c) Beat the physics: Epsilon Indi B, Hint 2's ruler, a guess, then the reveal in steps. */
  async 'c-game-epsindib'(page) {
    await page.open('/?page=game&round=epsindib-position', "document.querySelector('.game-plot')");
    await page.evaluate("(() => { const h = document.querySelector('.howto'); if (h) h.open = false; })()");
    await page.evaluate("scrollTo(0, document.querySelector('.round-grid').getBoundingClientRect().top + scrollY - 76)");
    await sleep(500);
    return screencast(page, async () => {
      await sleep(600);
      await page.evaluate("document.getElementById('hint-next').click()");
      await sleep(700);
      await page.evaluate("document.getElementById('hint-next').click()");
      await sleep(1100);
      // A guess near the ruler's end, typed as offsets from the last measurement.
      await page.evaluate("(() => { const e = document.getElementById('guess-east'); e.value = '1.5'; e.dispatchEvent(new Event('change')); const n = document.getElementById('guess-north'); n.value = '-1.2'; n.dispatchEvent(new Event('change')); })()");
      await sleep(600);
      await page.evaluate("document.getElementById('lock-guess').click()");
      for (let step = 0; step < 3; step += 1) {
        await sleep(600);
        await page.evaluate("document.getElementById('reveal-next').click()");
      }
      await sleep(1300);
    });
  },

  /** (d) Planet X Lab: "Measured by TENGER", the headline, and the W1 recovery chart. */
  async 'd-planetx-lab'(page) {
    await page.open('/?page=learn&lesson=lab', "document.querySelector('#measured .planetx-chart')");
    await page.evaluate("scrollTo(0, document.getElementById('measured').getBoundingClientRect().top + scrollY - 76)");
    await sleep(500);
    return screencast(page, async () => {
      await sleep(1400);
      await smoothScroll(page, '#measured .planetx-band:nth-child(2)', 1100, -76);
      await sleep(1700);
    });
  },

  /** (f) The asteroid batch: the summary (k of N scored, why the others were not, the exploratory JPL line), then the cards. */
  async 'f-asteroid-batch'(page) {
    await page.open('/?page=predictions', "document.querySelector('#ledger-batch .batch-card')");
    // The ledger above keeps growing while its cards load: scroll, let it settle, scroll again.
    const toSummary = "scrollTo(0, document.querySelector('#ledger-batch .batch-summary').getBoundingClientRect().top + scrollY - 140)";
    await page.evaluate(toSummary);
    await sleep(1500);
    await page.evaluate(toSummary);
    await sleep(500);
    return screencast(page, async () => {
      await sleep(2000);
      await smoothScroll(page, '#ledger-batch .batch-cards', 1100);
      await sleep(1200);
    });
  },

  /** (e) Find the hidden planet: the frames blink, a tap near the moving dot, the reveal. */
  async 'e-hidden-planet'(page) {
    await page.open('/?page=game', "document.querySelector('#hidden-stage img') && document.querySelector('#hidden-stage img').complete");
    await page.evaluate("scrollTo(0, document.getElementById('hidden-stage').getBoundingClientRect().top + scrollY - 140)");
    await sleep(500);
    const pair = await fetch(`${base}/data/planetx/hidden-planet.json`).then((r) => r.json()).then((doc) => doc.pairs[0]);
    const target = pair.injected.find((point) => point.frame === 0);
    return screencast(page, async () => {
      await sleep(1800);
      // A tap a little off the injected position, in the frame's pixel grid (centres at integers).
      await page.evaluate(`(() => {
        const stage = document.getElementById('hidden-stage'); const box = stage.getBoundingClientRect();
        const x = box.left + ((${target.x} + 1.2 + 0.5) / ${pair.frames[0].width}) * box.width;
        const y = box.top + ((${target.y} + 0.8 + 0.5) / ${pair.frames[0].height}) * box.height;
        stage.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
      })()`);
      await sleep(700);
      await page.evaluate("document.getElementById('hidden-check').click()");
      await sleep(2000);
    });
  },
};

const page = await browser();
const report = [];
for (const [name, record] of Object.entries(CLIPS)) {
  if (only.length && !only.includes(name)) continue;
  page.errors.length = 0;
  const captured = await record(page);
  const { output, probe } = encode(name, captured);
  const stream = probe.streams?.[0] ?? {};
  report.push({ name, file: output, seconds: Number(probe.format?.duration ?? 0), bytes: Number(probe.format?.size ?? 0), codec: stream.codec_name, size: `${stream.width}x${stream.height}`, fps: stream.r_frame_rate, errors: [...page.errors] });
  console.log(name, report.at(-1));
}
// clips.json keeps every clip: a partial run replaces only the clips it recorded.
let previous = [];
try { previous = JSON.parse(readFileSync(join(outDir, 'clips.json'), 'utf8')); } catch { previous = []; }
const fresh = report.map(({ file, ...rest }) => ({ file: file.split('/').at(-1), ...rest }));
const merged = [...previous.filter((clip) => !fresh.some((item) => item.name === clip.name)), ...fresh].sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(join(outDir, 'clips.json'), `${JSON.stringify(merged, null, 2)}\n`);
page.socket.close();
page.chrome.kill();
process.exit(0);
