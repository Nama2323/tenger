// Serves the local static/ folder as https://nama2323.github.io/tenger/ inside headless Chrome (CDP Fetch
// interception), so the page really runs with a github.io hostname. Logs every request; flags onrender.com.
// Usage: node docs/screens/github-io-check.mjs static <out dir>   (prints the request report; screenshots to <out dir>)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
const [STATIC, OUT] = process.argv.slice(2);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9361;
const ORIGIN = 'https://nama2323.github.io/tenger/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.gz': 'application/gzip', '.txt': 'text/plain', '.bin': 'application/octet-stream', '.ico': 'image/x-icon' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ghsim-'))}`, '--no-first-run', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', 'about:blank'], { stdio: 'ignore' });
let info;
for (let i = 0; i < 50 && !info; i += 1) { await sleep(200); info = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(info.find((x) => x.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const listeners = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else listeners.forEach((f) => f(m)); });
const send = (method, params = {}) => new Promise((r) => { id += 1; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const requests = []; const errors = [];
listeners.push(async (m) => {
  if (m.method === 'Fetch.requestPaused') {
    const url = new URL(m.params.request.url);
    let rel = decodeURIComponent(url.pathname.replace(/^\/tenger\/?/, '')) || 'index.html';
    const file = join(STATIC, rel);
    if (existsSync(file) && !file.endsWith('/')) {
      const body = readFileSync(file);
      await send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: TYPES[extname(file)] ?? 'application/octet-stream' }], body: body.toString('base64') });
    } else {
      await send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 404, responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }], body: Buffer.from('not found').toString('base64') });
    }
  }
  if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`);
});
for (const d of ['Page', 'Runtime', 'Network', 'Log']) await send(`${d}.enable`);
await send('Fetch.enable', { patterns: [{ urlPattern: 'https://nama2323.github.io/*', requestStage: 'Request' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('tenger.tour.v1', 'seen'); } catch {}" });
async function open(path) {
  await send('Page.navigate', { url: 'about:blank' }); await sleep(100);
  await send('Page.navigate', { url: ORIGIN + path });
  for (let i = 0; i < 40; i += 1) { await sleep(250); if (await evaluate("document.readyState === 'complete' && !document.querySelector('[data-loading]:not([hidden])')")) break; }
  await sleep(2500);
}
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64')); };
const report = {};
for (const width of [360, 1280]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: width === 360 ? 780 : 800, deviceScaleFactor: 1, mobile: width < 768 });
  const before = requests.length;
  await open('?ra=150.1&dec=2.2');
  await evaluate("document.getElementById('see-empty')?.scrollIntoView({ block: 'center' })");
  await sleep(300);
  await shot(`live-off-coords-${width}`);
  const coords = await evaluate("({ host: location.hostname, empty: document.getElementById('see-empty')?.hidden === false ? document.getElementById('see-empty').textContent : null, scroll: document.documentElement.scrollWidth })");
  await open('');
  await evaluate("(() => { const i = document.getElementById('search-input'); i.value = 'Cassiopeia A supernova remnant'; i.form ? i.form.requestSubmit() : i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()");
  await sleep(800);
  await evaluate("document.getElementById('search-message')?.scrollIntoView({ block: 'center' })");
  await shot(`live-off-name-${width}`);
  const name = await evaluate("document.getElementById('search-message')?.textContent");
  await open('?target=barnard&panel=see');
  const prepared = await evaluate("({ frames: document.body.innerText.includes('Frames from the investigation') || document.body.innerText.includes('Prepared frames'), dates: (document.body.innerText.match(/A · [^\\n]+/) || [])[0] })");
  await open('?page=about');
  await evaluate("document.querySelector('.site-footer').scrollIntoView({ block: 'end' })");
  await shot(`live-off-about-${width}`);
  const aboutText = await evaluate('document.body.innerText');
  report[width] = { coords, name, prepared, aboutMentions: /spherex[\s_-]*blink|pythonhack000/i.test(aboutText), requestsThisWidth: requests.length - before };
}
report.onrender = requests.filter((u) => /onrender\.com/.test(u));
report.otherHosts = [...new Set(requests.map((u) => { try { return new URL(u).host; } catch { return u.slice(0, 30); } }))];
report.apiRequests = requests.filter((u) => u.includes('/api/'));
report.errors = errors.filter((e) => !/favicon/.test(e)).slice(0, 10);
console.log(JSON.stringify(report, null, 2));
chrome.kill(); process.exit(0);
