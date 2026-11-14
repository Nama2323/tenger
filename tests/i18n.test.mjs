import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { currentLanguage, englishKeys, has, t, tData } from '../static/js/i18n.js';

// fileURLToPath, not URL.pathname: a checkout path may contain spaces ("Hackathon Astrolemma").
const STATIC = fileURLToPath(new URL('../static/', import.meta.url));
const html = readFileSync(`${STATIC}index.html`, 'utf8');
const scripts = readdirSync(`${STATIC}js`).filter((name) => name.endsWith('.js'))
  .map((name) => ({ name, source: readFileSync(`${STATIC}js/${name}`, 'utf8') }));
const keys = new Set(englishKeys());

test('English is the default language', () => {
  assert.equal(currentLanguage(), 'en');
});

test('every key the page uses exists in the English resource', () => {
  const used = [...html.matchAll(/data-t(?:-label|-placeholder)?="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(used.length > 50);
  for (const key of used) assert.ok(keys.has(key), `index.html uses missing key ${key}`);
  for (const { name, source } of scripts) {
    for (const match of source.matchAll(/\bt\('([^']+)'/g)) assert.ok(keys.has(match[1]), `${name} uses missing key ${match[1]}`);
  }
});

test('index.html has no visible text outside the resource file', () => {
  const body = html.slice(html.indexOf('<body'), html.indexOf('</body>'))
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const texts = [...body.matchAll(/>([^<]+)</g)].map((match) => match[1].trim()).filter(Boolean);
  assert.deepEqual(texts, [], `hard-coded text in index.html: ${texts.join(' | ')}`);
  for (const match of body.matchAll(/(?<![-\w])(?:aria-label|placeholder|title)="([^"]*)"/g)) {
    assert.fail(`hard-coded attribute text in index.html: ${match[0]}`);
  }
});

test('the contract enums all have English text', () => {
  const enums = {
    trial: ['waiting', 'hit', 'miss', 'insufficient_data', 'ambiguous', 'invalid_comparison', 'see_only'],
    category: ['prospective_unexposed', 'retrospective_holdout', 'catalogue_assisted', 'illustrative'],
    content: ['measured', 'catalogue', 'modeled', 'interpreted', 'processed', 'artificial'],
    grade: ['quantitative', 'qualitative', 'invalid'],
    data: ['available', 'partial', 'unavailable'],
    mstatus: ['measured', 'insufficient_data', 'invalid_comparison', 'not_attempted'],
    exposure: ['unexposed', 'exposed', 'unknown'],
    status: ['real', 'processed', 'difference', 'context', 'artificial'],
  };
  for (const [prefix, values] of Object.entries(enums)) {
    for (const value of values) assert.ok(has(`${prefix}.${value}`), `${prefix}.${value}`);
  }
  for (const category of enums.category) assert.ok(has(`category.${category}.note`));
});

test('only a prospective trial may say it was frozen before the reserved data were opened', () => {
  assert.match(t('category.prospective_unexposed.note'), /before the reserved observations were opened/);
  for (const other of ['retrospective_holdout', 'catalogue_assisted', 'illustrative']) {
    assert.doesNotMatch(t(`category.${other}.note`), /before .* opened/);
  }
  assert.match(t('category.retrospective_holdout.note'), /not a blind test/);
});

test('placeholders are filled, and unknown data keys get a visible generic text', () => {
  assert.equal(t('changed.value', { value: '1.0', sigma: '0.1', unit: '″/yr' }), '1.0 ± 0.1 ″/yr');
  assert.match(tData('limit.never-written', 'limit.unknown'), /limit\.never-written/);
});

test('every data key Session A publishes has English text in the resource file (copied, not only fetched)', () => {
  const published = JSON.parse(readFileSync(`${STATIC}data/strings.en.json`, 'utf8'));
  assert.equal(published.schema_version, 'tenger.strings/1');
  for (const key of Object.keys(published.strings)) assert.ok(keys.has(key), `strings.en.json key ${key} is missing from i18n.js`);
});

test('the map caption says it is not a sky map', () => {
  assert.equal(t('map.caption'), 'Schematic: not a sky map. Angles are arbitrary; distances come from the cited sources.');
});
