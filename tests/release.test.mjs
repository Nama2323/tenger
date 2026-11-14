// H1a release checks: About credits, guided tour rules, embed code, Open Graph image.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { has, t } from '../static/js/i18n.js';
import { embedCode, parseRoute } from '../static/js/route.js';
import {
  TOUR_STEPS, TOUR_STORAGE_KEY, markTourSeen, nextTourStep, runTour, shouldAutoStart, stopTour, tourSeen,
} from '../static/js/tour.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const html = readFileSync(`${ROOT}static/index.html`, 'utf8');
// pages.js imports help.js, which only touches the DOM inside functions; the data arrays are plain exports.
const about = await import('../static/js/pages.js');

const memoryStorage = (initial = {}) => {
  const store = new Map(Object.entries(initial));
  return { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)), store };
};
const brokenStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

test('the SPHEREx acknowledgement is copied word for word from the IRSA file', () => {
  const file = readFileSync(`${ROOT}docs/tenger-context/context/IRSA-acknowledgement.txt`, 'utf8');
  assert.equal(t('ack.spherex'), file.split('\n')[0].trim());
});

test('About lists both SPHEREx DOIs and every service the code uses', () => {
  const links = about.SOURCES.flatMap((source) => source.links.map(([href]) => href));
  for (const doi of ['10.26131/IRSA678', '10.26131/IRSA679']) assert.ok(links.includes(`https://doi.org/${doi}`), doi);
  const ids = about.SOURCES.map((source) => source.id);
  for (const id of ['spherex', 'irsa', 'wise', 'twomass', 'gaia', 'simbad', 'vizier', 'sesame', 'vsx', 'horizons', 'most', 'sbdb', 'standish', 'aladin']) {
    assert.ok(ids.includes(id), id);
  }
  for (const source of about.SOURCES) {
    assert.ok(has(`about.src.${source.id}.name`) && has(`about.src.${source.id}.use`), source.id);
    if (source.ack) assert.ok(has(source.ack), source.ack);
    for (const [href, key] of source.links) {
      assert.match(href, /^https:\/\//);
      assert.ok(has(key), key);
    }
  }
});

test('About links every DOI the published data cite, and the A8/A9 sources (B8)', () => {
  const linked = [...about.SOURCES, ...about.REFERENCES].flatMap((item) => item.links.map(([href]) => href));
  const dois = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      if (typeof value.doi === 'string') dois.add(value.doi);
      Object.values(value).forEach(walk);
    }
  };
  for (const path of ['planetx/depth.json', 'scene3d.json']) {
    try { walk(JSON.parse(readFileSync(`${ROOT}static/data/${path}`, 'utf8'))); } catch { /* not published here */ }
  }
  assert.ok(dois.size >= 4, 'the data cite DOIs');
  for (const doi of dois) assert.ok(linked.includes(`https://doi.org/${doi}`), `About links doi:${doi}`);
  for (const cite of ['Linder & Mordasini 2016', 'Fortney et al. 2016', 'Meisner et al. 2018', 'Blanton & Roweis 2007', 'WISE All-Sky Release Explanatory Supplement']) {
    assert.ok(about.REFERENCES.some((ref) => ref.cite.includes(cite)), cite);
  }
  assert.ok(about.SOURCES.some((source) => source.id === 'most'), 'IRSA MOST (A9)');
  assert.ok(about.SOURCES.some((source) => source.id === 'horizons'), 'JPL Horizons (A9)');
  for (const ref of about.REFERENCES) {
    assert.ok(has(`about.ref.${ref.use ?? ref.id}`), ref.id);
    for (const [href] of ref.links) assert.match(href, /^https:\/\//);
  }
});

test('About gives every library a licence, and every method, limit and disclosure has text', () => {
  for (const item of about.SOFTWARE) {
    assert.ok(item.licence && /^https:\/\//.test(item.href), item.name);
    assert.ok(has(item.use), item.use);
  }
  assert.ok(about.SOFTWARE.some((item) => item.name.startsWith('Aladin Lite') && item.licence === 'GPL-3.0'));
  assert.ok(about.SOFTWARE.some((item) => item.name.startsWith('three.js') && item.licence === 'MIT'));
  assert.ok(about.PYTHON_PACKAGES.length > 20 && about.PYTHON_PACKAGES.every(([name, licence]) => name && licence));
  for (const id of about.METHODS) assert.ok(has(`about.m.${id}`) && has(`about.m.${id}.title`), id);
  for (const id of about.LIMITS) assert.ok(has(`about.l.${id}`) && has(`about.l.${id}.title`), id);
  for (const key of [...about.TEAM, ...about.AI_DISCLOSURE]) assert.ok(has(key), key);
  assert.equal(about.TEAM.length, 4);
  assert.equal(about.BASE_PROJECT, 'https://github.com/pythonhack000/spherex-blink');
});

test('the AI disclosure names the tools and says no image was AI-generated', () => {
  const text = about.AI_DISCLOSURE.map((key) => t(key)).join(' ');
  for (const word of ['Codex', 'Claude Code', 'Anthropic', 'reviewed', 'No AI-generated images']) assert.ok(text.includes(word), word);
});

test('the tour follows the release story and only starts by itself once, on a plain Home visit', () => {
  assert.deepEqual(TOUR_STEPS.map((step) => step.key), ['tour.home', 'tour.pluto', 'tour.predictions', 'tour.game', 'tour.learn']);
  for (const step of TOUR_STEPS) assert.ok(has(step.key), step.key);
  const fresh = memoryStorage();
  assert.equal(shouldAutoStart({ storage: fresh, route: parseRoute('') }), true);
  assert.equal(shouldAutoStart({ storage: fresh, route: parseRoute('?page=home') }), true);
  for (const link of ['?embed=1', '?fixtures=1', '?page=about', '?target=pluto', '?ra=10&dec=20', '?page=predictions&trial=x']) {
    assert.equal(shouldAutoStart({ storage: fresh, route: parseRoute(link) }), false, link);
  }
  // Without working storage it could not remember, so it waits for the button.
  assert.equal(shouldAutoStart({ storage: brokenStorage, route: parseRoute('') }), false);
  assert.equal(shouldAutoStart({ storage: null, route: parseRoute('') }), false);
  assert.equal(tourSeen(brokenStorage), null);
  assert.equal(markTourSeen(brokenStorage), false);
  assert.equal(markTourSeen(fresh), true);
  assert.equal(fresh.store.get(TOUR_STORAGE_KEY), 'seen');
  assert.equal(shouldAutoStart({ storage: fresh, route: parseRoute('') }), false);
});

test('the tour steps on with Next, can be skipped, and marks itself seen when it starts', () => {
  const calls = [];
  const actions = {
    render: ({ index, last }) => calls.push(`render ${index}${last ? ' last' : ''}`),
    showPage: (page) => calls.push(`page ${page}`),
    open: (key) => calls.push(`open ${key}`),
    whenReady: () => {},
    showReveal: () => calls.push('reveal'),
    setMode: () => {},
    setPlaying: () => {},
    reducedMotion: () => true,
    started: () => calls.push('started'),
    finished: () => calls.push('finished'),
  };
  const storage = memoryStorage();
  runTour(actions, { storage });
  assert.equal(storage.store.get(TOUR_STORAGE_KEY), 'seen');
  for (let i = 0; i < 4; i += 1) nextTourStep();
  nextTourStep();
  assert.deepEqual(calls, [
    'started', 'render 0', 'page home', 'render 1', 'open pluto', 'render 2', 'page predictions', 'reveal',
    'render 3', 'page game', 'render 4 last', 'page learn', 'finished',
  ]);
  calls.length = 0;
  runTour(actions, { storage });
  stopTour();
  nextTourStep();
  assert.deepEqual(calls, ['started', 'render 0', 'page home', 'finished']);
});

test('the embed code is an escaped, lazy, responsive iframe of an embed=1 link', () => {
  const code = embedCode('https://example.org/?target=barnard&embed=1', 'TENGER: "A" <b>');
  assert.match(code, /^<iframe src="https:\/\/example\.org\/\?target=barnard&amp;embed=1" /);
  assert.match(code, /title="TENGER: &quot;A&quot; &lt;b&gt;"/);
  assert.match(code, /width="100%"/);
  assert.match(code, /loading="lazy"/);
  assert.match(code, /<\/iframe>$/);
  assert.ok(has('embed.copy') && has('embed.open') && has('embed.frameTitle'));
});

test('Open Graph tags point at a real 1200×630 og.png under 200 KB', () => {
  for (const property of ['og:title', 'og:description', 'og:image', 'og:image:alt', 'og:type', 'og:url']) {
    assert.match(html, new RegExp(`<meta property="${property}" content="[^"]+">`), property);
  }
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  // Absolute addresses for the public site (GitHub Pages).
  assert.match(html, /<meta property="og:url" content="https:\/\/nama2323\.github\.io\/tenger\/">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/nama2323\.github\.io\/tenger\/og\.png">/);
  const png = readFileSync(`${ROOT}static/og.png`);
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.ok(statSync(`${ROOT}static/og.png`).size < 200 * 1024);
});

test('the offline sky tiles are reachable only from the Real sky panel', () => {
  const read = (name) => readFileSync(`${ROOT}static/${name}`, 'utf8');
  const scripts = ['js/main.js', 'js/home.js', 'js/space-ui.js', 'js/space3d.js', 'js/pages.js', 'index.html', 'css/style.css'];
  for (const name of scripts) assert.doesNotMatch(read(name), /data\/sky/, `${name} must not reference the offline tiles`);
  const sky = read('js/sky.js');
  // sky.js tries the online survey first and falls back to the local copy only if that is unreachable.
  assert.ok(sky.indexOf('TILES_ONLINE') < sky.indexOf("'data/sky'"));
  const main = read('js/main.js');
  assert.equal(main.match(/createSky\(/g).length, 1, 'one call');
  assert.match(main, /async function openSkyContext\(\) \{[\s\S]*?createSky\(/);
  assert.equal(main.match(/openSkyContext\(\)/g).length, 2, 'defined once, called once (when the panel opens)');
  assert.match(main, /if \(open\) openSkyContext\(\);/);
});
