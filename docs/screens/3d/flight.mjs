// Records the 3D Home camera flight to Pluto as a smooth video for the presentation, whatever the machine's speed:
// the page's clock (performance.now and requestAnimationFrame) is stepped by hand, one screenshot per 1/30 s.
// Needs Google Chrome, ffmpeg and Node 22+. No npm packages.
// Usage: node docs/screens/3d/flight.mjs http://localhost:8766 docs/screens/3d [target=pluto]
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9345;
const FPS = 30;
const HOLD_BEFORE_S = 1;
const FLIGHT_S = 1.6;
const HOLD_AFTER_S = 1.6;
const [base, outDir, target = 'pluto'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const frames = mkdtempSync(join(tmpdir(), 'tenger-flight-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'tenger-chrome-'))}`,
  '--no-first-run', '--hide-scrollbars', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', 'about:blank',
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
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) => new Promise((resolve) => {
  nextId += 1;
  pending.set(nextId, resolve);
  socket.send(JSON.stringify({ id: nextId, method, params }));
});
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send('Page.enable');
await send('Runtime.enable');
// The tour is marked seen and the 3D view chosen, as a returning visitor would have it.
await send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('tenger.tour.v1', 'seen'); localStorage.setItem('tenger.view.v1', '3d'); } catch {}" });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${base}/` });
for (let attempt = 0; attempt < 80; attempt += 1) {
  await sleep(250);
  if (await evaluate("document.body.classList.contains('space-3d')")) break;
}
await sleep(3000);
// The colour key starts open on wide screens; folded, it leaves the scene clear for the video.
await evaluate("document.getElementById('map-key').open = false");
await sleep(300);
// From here the page's clock only moves when stepped.
await evaluate(`(() => {
  let now = performance.now();
  let queue = [];
  performance.now = () => now;
  window.requestAnimationFrame = (callback) => { queue.push(callback); return queue.length; };
  window.cancelAnimationFrame = () => {};
  window.__step = (ms) => { now += ms; const run = queue; queue = []; run.forEach((callback) => callback(now)); };
})()`);
let index = 0;
async function shoot(count) {
  for (let frame = 0; frame < count; frame += 1) {
    await evaluate(`window.__step(${1000 / FPS})`);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(frames, `f${String(index).padStart(4, '0')}.png`), Buffer.from(shot.result.data, 'base64'));
    index += 1;
  }
}
await shoot(HOLD_BEFORE_S * FPS);
await evaluate(`[...document.querySelectorAll('#rail button')].find((b) => b.textContent.trim().toLowerCase().startsWith('${target}')).click()`);
await shoot(FLIGHT_S * FPS);
// The investigation panel slides in with a CSS animation on the real clock; give it time between frames.
for (let frame = 0; frame < HOLD_AFTER_S * FPS; frame += 1) {
  await sleep(1000 / FPS);
  await shoot(1);
}
socket.close();
chrome.kill();
const output = join(outDir, `flight-to-${target}-1280x720.mp4`);
const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(frames, 'f%04d.png'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', output], { stdio: 'inherit' });
// A still from just before the camera arrives (the panel opens when it does).
spawnSync('cp', [join(frames, `f${String(Math.round((HOLD_BEFORE_S + 1.3) * FPS)).padStart(4, '0')}.png`), join(outDir, `flight-to-${target}-arriving-1280x720.png`)]);
rmSync(frames, { recursive: true, force: true });
console.log(result.status === 0 ? `wrote ${output} (${index} frames at ${FPS} fps)` : 'ffmpeg failed');
