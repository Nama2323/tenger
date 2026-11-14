// Drives headless Chrome over the DevTools protocol: measures the real viewport, horizontal overflow and
// tap targets under 44 px, and saves one screenshot per page and width (prefers-reduced-motion forced, so
// nothing is mid-animation). Needs Google Chrome and Node 22+ (global WebSocket). No npm packages.
// Usage: node docs/screens/capture.mjs http://localhost:8766 docs/screens [page-name-prefix]
// Set FULL=390 to also save full-page captures at that width.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9339;
const [base, outDir, only] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const WIDTHS = [
  { width: 360, height: 780, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 768, height: 1024, mobile: true },
  { width: 1280, height: 800, mobile: false },
];
const PAGES = [
  { name: 'home', path: '/', ready: '#shortcut-list li' },
  { name: 'home-fixtures-map', path: '/?fixtures=1', ready: '.map-marker', scrollTo: '.explore' },
  { name: 'investigate-barnard', path: '/?target=barnard', ready: '#caption-body .caption-col' },
  { name: 'investigate-barnard-swipe', path: '/?target=barnard&mode=swipe', ready: '#caption-body .caption-col' },
  { name: 'investigate-rdra-side', path: '/?target=rdra&mode=side', ready: '#caption-body .caption-col' },
  { name: 'prediction-fixtures', path: '/?fixtures=1&target=barnard&panel=prediction', ready: '.trial', scrollTo: '#panel-prediction' },
  { name: 'makemake-unavailable', path: '/?target=makemake', ready: '#see-empty:not([hidden])' },
  { name: 'game', path: '/?page=game', ready: '#game-rounds p' },
  { name: 'game-example', path: '/?page=game&fixtures=1', ready: '.game-plot', scrollTo: '#round-picker' },
  { name: 'game-example-revealed', path: '/?page=game&fixtures=1&round=barnard-position-example', ready: '.game-plot', act: "(() => { const v = document.getElementById('guess-value'); if (v) { v.value = '5.8'; v.dispatchEvent(new Event('change')); } const e = document.getElementById('guess-east'); if (e) { e.value = '-2'; e.dispatchEvent(new Event('change')); const n = document.getElementById('guess-north'); n.value = '14.6'; n.dispatchEvent(new Event('change')); } document.getElementById('lock-guess').click(); for (let i = 0; i < 3; i += 1) document.getElementById('reveal-next').click(); })()", scrollTo: '.round-grid' },
  { name: 'game-rdra-revealed', path: '/?page=game&fixtures=1&round=rdra-brightness-example', ready: '.game-plot', act: "(() => { const v = document.getElementById('guess-value'); if (v) { v.value = '5.8'; v.dispatchEvent(new Event('change')); } const e = document.getElementById('guess-east'); if (e) { e.value = '-2'; e.dispatchEvent(new Event('change')); const n = document.getElementById('guess-north'); n.value = '14.6'; n.dispatchEvent(new Event('change')); } document.getElementById('lock-guess').click(); for (let i = 0; i < 3; i += 1) document.getElementById('reveal-next').click(); })()", scrollTo: '.round-grid' },
  { name: 'learn', path: '/?page=learn', ready: '#lesson-list li' },
  { name: 'about', path: '/?page=about', ready: '#about-credits li' },
];

const AUDIT = `(() => {
  const vw = document.documentElement.clientWidth;
  const wide = [];
  for (const node of document.querySelectorAll('body *')) {
    if (!node.getClientRects().length) continue;
    const box = node.getBoundingClientRect();
    if (box.right > vw + 0.5 || box.left < -0.5) {
      let clipped = false;
      for (let up = node.parentElement; up && up !== document.body; up = up.parentElement) {
        const style = getComputedStyle(up);
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { clipped = true; break; }
      }
      if (!clipped && getComputedStyle(node).position !== 'fixed') wide.push(node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + '.' + String(node.className).split(' ')[0] + ' ' + Math.round(box.left) + '..' + Math.round(box.right));
    }
  }
  const small = [];
  for (const node of document.querySelectorAll('button, a[href], input, select, summary, [role="button"]')) {
    if (!node.getClientRects().length) continue;
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden') continue;
    if (node.matches('input[type="checkbox"]')) continue;
    if (node.closest('p, li, dd') && node.matches('a') && !node.closest('nav')) continue;
    const box = node.getBoundingClientRect();
    if (box.width < 43.5 || box.height < 43.5) small.push(node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + ' "' + (node.textContent || node.getAttribute('aria-label') || '').trim().slice(0, 24) + '" ' + Math.round(box.width) + 'x' + Math.round(box.height));
  }
  return { innerWidth, innerHeight, clientWidth: vw, scrollWidth: document.documentElement.scrollWidth, wide: wide.slice(0, 12), small: [...new Set(small)].slice(0, 30), errors: window.__errors || [] };
})()`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'tenger-chrome-'))}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-prefers-reduced-motion', 'about:blank',
  ], { stdio: 'ignore' });
  let info;
  for (let attempt = 0; attempt < 50 && !info; attempt += 1) {
    await sleep(200);
    info = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).catch(() => null);
  }
  const pageTarget = info.find((item) => item.type === 'page');
  const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener('open', resolve));
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else listeners.forEach((listener) => listener(message));
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    nextId += 1;
    pending.set(nextId, resolve);
    socket.send(JSON.stringify({ id: nextId, method, params }));
  });
  const consoleErrors = [];
  listeners.push((message) => {
    if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') consoleErrors.push(`${message.params.entry.text} ${message.params.entry.url ?? ''}`);
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  const report = [];
  for (const page of PAGES) {
    if (only && !page.name.startsWith(only)) continue;
    for (const size of WIDTHS) {
      consoleErrors.length = 0;
      await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: size.mobile });
      await send('Emulation.setTouchEmulationEnabled', { enabled: size.mobile });
      await send('Page.navigate', { url: base + page.path });
      let ready = false;
      for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
        await sleep(250);
        const result = await send('Runtime.evaluate', { expression: `Boolean(document.querySelector(${JSON.stringify(page.ready)}))`, returnByValue: true });
        ready = result.result?.result?.value === true;
      }
      await sleep(900);
      if (page.act) {
        await send('Runtime.evaluate', { expression: page.act });
        await sleep(500);
      }
      if (page.scrollTo) {
        await send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(page.scrollTo)}).scrollIntoView({block:'start'})` });
        await sleep(400);
      }
      const audit = (await send('Runtime.evaluate', { expression: AUDIT, returnByValue: true })).result.result.value;
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const file = `${page.name}-${size.width}.png`;
      writeFileSync(join(outDir, file), Buffer.from(shot.result.data, 'base64'));
      if (process.env.FULL && size.width === Number(process.env.FULL)) {
        await send('Runtime.evaluate', { expression: 'scrollTo(0,0)' });
        const metrics = await send('Page.getLayoutMetrics');
        const height = Math.min(9000, Math.ceil(metrics.result.cssContentSize.height));
        const full = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.width, height, scale: 1 } });
        writeFileSync(join(outDir, `${page.name}-${size.width}-full.png`), Buffer.from(full.result.data, 'base64'));
      }
      report.push({ page: page.name, requested: size.width, ready, ...audit, consoleErrors: [...consoleErrors] });
    }
  }
  writeFileSync(join(outDir, 'viewport-report.json'), JSON.stringify(report, null, 2));
  for (const row of report) {
    const overflow = row.scrollWidth > row.clientWidth;
    console.log(`${row.page} @${row.requested}: inner ${row.innerWidth}x${row.innerHeight}, client ${row.clientWidth}, scroll ${row.scrollWidth}${overflow ? ' OVERFLOW' : ''}${row.ready ? '' : ' NOT-READY'}`);
    if (row.wide.length) console.log('   wide:', row.wide.join(' | '));
    if (row.small.length) console.log('   small:', row.small.join(' | '));
    if (row.consoleErrors.length) console.log('   errors:', row.consoleErrors.join(' | '));
  }
  socket.close();
  chrome.kill();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
