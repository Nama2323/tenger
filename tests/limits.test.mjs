// Task B19: "What Vestigium can and can't do". Its numbers come from the data files, the old claim that we cannot
// say whether SPHEREx could detect Planet Nine is gone everywhere on the site, and the items moved out of the
// dialog are on the About page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { has, t } from '../static/js/i18n.js';
import { limitsNumbers } from '../static/js/limits.js';
import { readDepth } from '../static/js/planetx.js';
import { LIMITS } from '../static/js/pages.js';
import { CAN_DO, LIMITS_DO } from '../static/js/help.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

test('the dialog numbers are computed from investigation.json and depth.json', () => {
  const barnard = JSON.parse(read('static/data/barnard/investigation.json'));
  const depth = readDepth(JSON.parse(read('static/data/planetx/depth.json')));
  const numbers = limitsNumbers({ barnard, depth });
  const motion = barnard.explanation.find((item) => item.key === 'explain.motion-measured').params;
  const pct = (Math.abs(motion.value - motion.catalogue) / motion.catalogue) * 100;
  assert.ok(numbers.gaiaPct >= pct && numbers.gaiaPct - pct < 0.1, `${numbers.gaiaPct} vs ${pct}`);
  assert.equal(numbers.blendArcsec, barnard.pipeline.settings.core_radius_arcsec);
  assert.equal(numbers.injected, depth.bands.reduce((sum, band) => sum + band.curve.reduce((n, point) => n + point.injected, 0), 0));
  assert.ok(Number.isInteger(numbers.low) && Number.isInteger(numbers.high) && numbers.low <= numbers.high);
  // Without the files nothing is invented.
  assert.deepEqual(limitsNumbers({}), { gaiaPct: null, blendArcsec: null, injected: null, low: null, high: null });
});

test('every can and limit item has its text, and every limit says what we do about it', () => {
  for (const id of CAN_DO) assert.ok(has(`limits.can.${id}`), id);
  for (const id of LIMITS_DO) {
    assert.ok(has(`limits.limit.${id}`), id);
    assert.ok(t(`limits.do.${id}`, { low: '4', high: '7' }).startsWith('→ '), id);
  }
  assert.equal(t('limits.title'), 'What Vestigium can and can’t do');
});

/** Every text file the site serves, apart from the large data products. */
function siteFiles(dir = join(ROOT, 'static')) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'vendor' || name === 'fonts' ? [] : siteFiles(path);
    return /\.(js|mjs|html|json|md|txt|webmanifest)$/.test(name) && statSync(path).size < 2e6 ? [path] : [];
  });
}

test('the old "cannot say whether SPHEREx could detect it" no longer appears anywhere on the site', () => {
  const old = /cannot say whether SPHEREx could detect it/i;
  const found = [...siteFiles(), join(ROOT, 'README.md')].filter((path) => old.test(readFileSync(path, 'utf8')));
  assert.deepEqual(found, []);
});

test('the items moved out of the dialog are in the About page limitations', () => {
  for (const id of ['pixel', 'crossBand', 'comet', 'future']) {
    assert.ok(LIMITS.includes(id), id);
    assert.ok(has(`about.l.${id}`) && has(`about.l.${id}.title`), id);
  }
  assert.match(t('about.l.crossBand'), /WISE and 2MASS/);
  assert.match(t('about.l.comet'), /3I\/ATLAS/);
  assert.match(t('about.l.future'), /after IRSA releases the data/);
});
