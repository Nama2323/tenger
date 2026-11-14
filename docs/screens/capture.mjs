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

const SIZES = {
  360: { width: 360, height: 780, mobile: true },
  390: { width: 390, height: 844, mobile: true },
  768: { width: 768, height: 1024, mobile: true },
  1280: { width: 1280, height: 800, mobile: false },
  1440: { width: 1440, height: 900, mobile: false },
  // The reveal is screen-recorded at 1280×720 for the video.
  '720p': { width: 1280, height: 720, mobile: false, label: '1280x720' },
  // Open Graph image (static/og.png): 1200×630.
  og: { width: 1200, height: 630, mobile: false, label: 'og' },
};
// WIDTHS=390,1440 picks sizes; PAGES=home,about picks pages by exact name; PREFIX=before- names the files.
const WIDTHS = (process.env.WIDTHS ?? '360,390,768,1280').split(',').map((width) => SIZES[width.trim()]).filter(Boolean);
/** Pages with their own sizes (e.g. the reveal at 1280×720) list them in `sizes`; WIDTHS still filters. */
const sizesFor = (page) => (page.sizes ? page.sizes.map((key) => SIZES[key]) : WIDTHS).filter((size) => !process.env.WIDTHS || WIDTHS.includes(size));
const ONLY = process.env.PAGES ? new Set(process.env.PAGES.split(',').map((name) => name.trim())) : null;
const PREFIX = process.env.PREFIX ?? '';
const PAGES = [
  { name: 'home', path: '/', ready: '.map-marker' },
  { name: 'home-rail-open', path: '/', ready: '.map-marker', act: "(() => { const t = document.getElementById('rail-toggle'); if (t.getAttribute('aria-expanded') !== 'true') t.click(); })()" },
  { name: 'home-fixtures-map', path: '/?fixtures=1', ready: '.map-marker' },
  { name: 'investigate-barnard', path: '/?target=barnard', ready: '#caption-body .caption-col' },
  { name: 'investigate-barnard-timebar', path: '/?target=barnard', ready: '#caption-body .caption-col', act: "document.querySelector('.timebar').scrollIntoView({ block: 'start' })" },
  { name: 'investigate-barnard-panel', path: '/?target=barnard&panel=changed', ready: '#caption-body .caption-col' },
  { name: 'investigate-barnard-swipe', path: '/?target=barnard&mode=swipe', ready: '#caption-body .caption-col' },
  { name: 'investigate-rdra-side', path: '/?target=rdra&mode=side', ready: '#caption-body .caption-col' },
  { name: 'prediction-fixtures', path: '/?fixtures=1&target=barnard&panel=prediction', ready: '.trial' },
  { name: 'investigate-epsindib-diff', path: '/?target=epsindib&band=d1&a=2025-05-10&b=2026-04-25&mode=diff', ready: '#caption-body .caption-col' },
  { name: 'investigate-wise0855', path: '/?target=wise0855&panel=changed', ready: '#caption-body .caption-col' },
  { name: 'investigate-makemake-preview', path: '/?target=makemake&mode=side', ready: '#caption-body .caption-col' },
  { name: 'investigate-pluto-preview', path: '/?target=pluto', ready: '#caption-body .caption-col' },
  { name: 'unavailable-3i-atlas', path: '/?target=3i-atlas', ready: '#see-empty:not([hidden]), #caption-body .caption-col' },
  { name: 'game', path: '/?page=game', ready: '#game-rounds p' },
  { name: 'game-example', path: '/?page=game&fixtures=1', ready: '.game-plot', scrollTo: '#round-picker' },
  { name: 'game-example-revealed', path: '/?page=game&fixtures=1&round=barnard-position-example', ready: '.game-plot', act: "(() => { const v = document.getElementById('guess-value'); if (v) { v.value = '5.8'; v.dispatchEvent(new Event('change')); } const e = document.getElementById('guess-east'); if (e) { e.value = '-2'; e.dispatchEvent(new Event('change')); const n = document.getElementById('guess-north'); n.value = '14.6'; n.dispatchEvent(new Event('change')); } document.getElementById('lock-guess').click(); for (let i = 0; i < 3; i += 1) document.getElementById('reveal-next').click(); })()", scrollTo: '.round-grid' },
  { name: 'game-rdra-revealed', path: '/?page=game&fixtures=1&round=rdra-brightness-example', ready: '.game-plot', act: "(() => { const v = document.getElementById('guess-value'); if (v) { v.value = '5.8'; v.dispatchEvent(new Event('change')); } const e = document.getElementById('guess-east'); if (e) { e.value = '-2'; e.dispatchEvent(new Event('change')); const n = document.getElementById('guess-north'); n.value = '14.6'; n.dispatchEvent(new Event('change')); } document.getElementById('lock-guess').click(); for (let i = 0; i < 3; i += 1) document.getElementById('reveal-next').click(); })()", scrollTo: '.round-grid' },
  { name: 'predictions', path: '/?page=predictions', ready: '.ledger-card' },
  { name: 'predictions-cards', path: '/?page=predictions', ready: '.ledger-card', scrollTo: '#ledger-trials-title' },
  { name: 'predictions-forecasts', path: '/?page=predictions', ready: '.forecast-card', scrollTo: '#ledger-forecasts-title' },
  { name: 'predictions-fixtures', path: '/?page=predictions&fixtures=1', ready: '.ledger-card', scrollTo: '#ledger-trials-title' },
  { name: 'predictions-fixtures-forecasts', path: '/?page=predictions&fixtures=1', ready: '.forecast-card', scrollTo: '#ledger-forecasts-title' },
  { name: 'predictions-reveal-1-image', path: '/?page=predictions&fixtures=1&trial=barnard-position-example', ready: '.reveal-svg', sizes: ['360', '390', '768', '1280', '720p'] },
  { name: 'predictions-reveal-2-track', path: '/?page=predictions&fixtures=1&trial=barnard-position-example', ready: '.reveal-svg', act: "document.querySelector('#reveal').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))", sizes: ['720p'] },
  { name: 'predictions-reveal-3-region', path: '/?page=predictions&fixtures=1&trial=barnard-position-example', ready: '.reveal-svg', act: "(() => { for (let i = 0; i < 2; i += 1) document.querySelector('#reveal').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); })()", sizes: ['720p'] },
  { name: 'predictions-reveal-4-baseline', path: '/?page=predictions&fixtures=1&trial=barnard-position-example', ready: '.reveal-svg', act: "(() => { for (let i = 0; i < 3; i += 1) document.querySelector('#reveal').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); })()", sizes: ['720p'] },
  { name: 'predictions-reveal-5-observed', path: '/?page=predictions&fixtures=1&trial=barnard-position-example', ready: '.reveal-svg', act: "(() => { for (let i = 0; i < 4; i += 1) document.querySelector('#reveal').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); })()", sizes: ['720p'] },
  { name: 'predictions-reveal-6-verdict', path: '/?page=predictions&fixtures=1&trial=barnard-position-example', ready: '.reveal-svg', act: "document.querySelector('#reveal').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))", sizes: ['360', '390', '768', '1280', '720p'] },
  { name: 'predictions-reveal-miss', path: '/?page=predictions&fixtures=1&trial=epsindib-position-example', ready: '.reveal-svg', act: "document.querySelector('#reveal').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))", sizes: ['390', '1280', '720p'] },
  { name: 'shortcuts', path: '/?page=predictions', ready: '.ledger-card', act: "document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))" },
  { name: 'limits', path: '/', ready: '.map-marker', act: "document.querySelector('.nav .nav-extra').click()" },
  { name: 'learn', path: '/?page=learn', ready: '#lesson-list li' },
  { name: 'learn-lesson-distance', path: '/?page=learn&lesson=distance', ready: '#lesson-view .answer-key' },
  { name: 'learn-lesson-sure', path: '/?page=learn&lesson=sure&fixtures=1', ready: '#lesson-view .answer-key', act: "document.querySelectorAll('.answer-toggle').forEach((d) => { d.open = true; })" },
  { name: 'learn-lab', path: '/?page=learn&lesson=lab', ready: '#lab-results dl' },
  { name: 'learn-lab-measured', path: '/?page=learn&lesson=lab#measured', ready: '#measured .planetx-chart', scrollTo: '#measured' },
  { name: 'learn-lab-measured-w1', path: '/?page=learn&lesson=lab#measured', ready: '#measured .planetx-chart', scrollTo: '#measured .planetx-band:nth-child(2)' },
  { name: 'learn-lesson-brightness-planetx', path: '/?page=learn&lesson=brightness', ready: '.planetx-line', scrollTo: '.planetx-line' },
  { name: 'game-hidden', path: '/?page=game', ready: '#hidden-stage img', scrollTo: '#hidden-round' },
  { name: 'game-hidden-revealed', path: '/?page=game', ready: '#hidden-stage img', act: "(() => { const st = document.getElementById('hidden-stage'); const b = st.getBoundingClientRect(); st.dispatchEvent(new MouseEvent('click', { clientX: b.left + b.width * 0.42, clientY: b.top + b.height * 0.56, bubbles: true })); document.getElementById('hidden-check').click(); })()", scrollTo: '#hidden-round' },
  { name: 'about', path: '/?page=about', ready: '#about-data li' },
  { name: 'about-reserved', path: '/?page=about', ready: '#about-reserved li', scrollTo: '#about-reserved-title' },
  { name: 'predictions-why', path: '/?page=predictions', ready: '.why-missed', act: "(() => { const d = document.querySelector('#trial-pluto-position-2026b .why-missed'); d.open = true; })()", scrollTo: '#trial-pluto-position-2026b .why-missed', sizes: ['360', '390', '768', '1280', '720p'] },
  { name: 'reveal-pluto-why', path: '/?page=predictions&trial=pluto-position-2026b', ready: '.reveal-svg', act: "document.querySelector('#reveal').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))", sizes: ['390', '1280', '720p'] },
  { name: 'learn-lesson-sure-pluto', path: '/?page=learn&lesson=sure', ready: '.pluto-example', scrollTo: '.pluto-example' },
  { name: 'learn-lesson-distance-loop', path: '/?page=learn&lesson=distance', ready: '.loop-part', scrollTo: '.loop-part' },
  { name: 'loop', path: '/?page=loop', ready: '#loop-chart svg' },
  // B6: the asteroid batch (only the invented example exists yet, so only in ?fixtures=1 mode).
  { name: 'predictions-batch', path: '/?page=predictions&fixtures=1', ready: '#ledger-batch .batch-card', scrollTo: '#ledger-batch' },
  { name: 'predictions-batch-charts', path: '/?page=predictions&fixtures=1', ready: '#ledger-batch .batch-card', scrollTo: '#ledger-batch .batch-charts' },
  { name: 'predictions-batch-cards', path: '/?page=predictions&fixtures=1', ready: '#ledger-batch .batch-card', scrollTo: '#ledger-batch .batch-cards' },
  { name: 'learn-lesson-sure-batch', path: '/?page=learn&lesson=sure&fixtures=1', ready: '#lesson-batch h3', scrollTo: '#lesson-batch' },
  { name: 'loop-chart', path: '/?page=loop', ready: '#loop-chart svg', scrollTo: '#loop-chart-title' },
  { name: 'about-see', path: '/?page=about', ready: '#about-data li', scrollTo: '#about-limits-title' },
  { name: 'about-credits', path: '/?page=about', ready: '#about-data li', scrollTo: '#about-data-title' },
  { name: 'tour-home', path: '/', ready: '.map-marker', act: "document.getElementById('tour-start').click()" },
  { name: 'tour-pluto', path: '/', ready: '.map-marker', act: "(() => { document.getElementById('tour-start').click(); document.getElementById('tour-next').click(); })()" },
  { name: 'embed-barnard', path: '/?target=barnard&embed=1', ready: '#caption-body .caption-col' },
  { name: 'embed-code', path: '/?target=barnard', ready: '#caption-body .caption-col', act: "document.getElementById('embed-copy').click()" },
  { name: 'og-home', path: '/', ready: '.map-marker', sizes: ['og'] },
  { name: 'og-barnard', path: '/?target=barnard&mode=side', ready: '#caption-body .caption-col', sizes: ['og'] },
  // 3D Home (last: switching it on is remembered for the rest of this run). Reduced motion stays forced, so the
  // view is switched on with its button and camera moves are instant.
  { name: 'home-3d', path: '/', ready: '.map-marker', act: "(() => { if (!document.body.classList.contains('space-3d')) document.getElementById('space-toggle').click(); })()", wait: 2500 },
  { name: 'home-3d-top', path: '/', ready: '.space-canvas', act: "document.getElementById('space-top').click()", wait: 800 },
  { name: 'home-3d-pluto', path: '/', ready: '.space-canvas', act: "document.querySelector('.space-label[data-key=pluto]').click()", wait: 2500 },
  // After the 3D Home captures switched the 3D view on for this run, the loop page starts in 3D too.
  { name: 'loop-3d', path: '/?page=loop', ready: '#loop3d canvas', wait: 1500, act: 'void 0', sizes: ['360', '390', '768', '1280', '720p'] },
  { name: 'loop-3d-spherex', path: '/?page=loop', ready: '#loop3d canvas', act: "document.getElementById('loop-from-spherex').click()", wait: 1500, sizes: ['390', '1280', '720p'] },
  { name: 'loop-3d-top', path: '/?page=loop', ready: '#loop3d canvas', act: "document.getElementById('loop-top').click()", wait: 1500, sizes: ['1280', '720p'] },
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
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-prefers-reduced-motion',
    // WebGL for the 3D Home view in headless Chrome (software rendering).
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader', 'about:blank',
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
  // The guided tour starts by itself on a first visit; mark it seen so it does not cover the captures.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('tenger.tour.v1', 'seen'); } catch {}" });
  const report = [];
  for (const page of PAGES) {
    if (only && !page.name.startsWith(only)) continue;
    if (ONLY && !ONLY.has(page.name)) continue;
    for (const size of sizesFor(page)) {
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
        await sleep(page.wait ?? 500);
      }
      if (page.scrollTo) {
        await send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(page.scrollTo)}).scrollIntoView({block:'start'})` });
        await sleep(400);
      }
      const audit = (await send('Runtime.evaluate', { expression: AUDIT, returnByValue: true })).result.result.value;
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const file = `${PREFIX}${page.name}-${size.label ?? size.width}.png`;
      writeFileSync(join(outDir, file), Buffer.from(shot.result.data, 'base64'));
      if (process.env.FULL && size.width === Number(process.env.FULL)) {
        await send('Runtime.evaluate', { expression: 'scrollTo(0,0)' });
        const metrics = await send('Page.getLayoutMetrics');
        const height = Math.min(9000, Math.ceil(metrics.result.cssContentSize.height));
        const full = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.width, height, scale: 1 } });
        writeFileSync(join(outDir, `${PREFIX}${page.name}-${size.width}-full.png`), Buffer.from(full.result.data, 'base64'));
      }
      report.push({ page: page.name, requested: size.label ?? size.width, ready, ...audit, consoleErrors: [...consoleErrors] });
    }
  }
  writeFileSync(join(outDir, `${PREFIX}viewport-report.json`), JSON.stringify(report, null, 2));
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
