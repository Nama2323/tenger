// Task B15: the Predictions page as a story. Technical words stay inside closed "Details", and every number the
// page shows outside them matches the published data files (static/data), within its display rounding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { has, t } from '../static/js/i18n.js';
import {
  DETAILS_ONLY_WORDS, asteroidName, itemSentence, longDate, overRatio, shortAngle, storyModel, visibleStory,
} from '../static/js/predict-story.js';
import { STEPS } from '../static/js/reveal.js';

const DATA = fileURLToPath(new URL('../static/data/', import.meta.url));
const HTML = readFileSync(fileURLToPath(new URL('../static/index.html', import.meta.url)), 'utf8');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const board = read(join(DATA, 'scoreboard.json'));
const index = read(join(DATA, 'index.json'));
const names = new Map(index.targets.map((target) => [target.key, target.name]));
const nameOf = (key) => names.get(key) ?? key;

/** A trial bundle as contract.js returns it, from static/data/trials/<id>/. */
function bundle(id) {
  const folder = join(DATA, 'trials', id);
  const file = (name) => (existsSync(join(folder, name)) ? { state: 'ok', doc: read(join(folder, name)) } : { state: 'missing' });
  return { id, trial: file('trial.json'), prediction: file('prediction.json'), receipt: file('receipt.json'), verification: file('verification.json') };
}
const bundles = [...board.rows.map((row) => row.trial_id), ...board.open_forecasts].map(bundle);
const model = storyModel({ board, bundles });
const story = visibleStory(model, nameOf);

// ---------- The static markup of the page ----------

/** The Predictions section of index.html. */
const section = (() => {
  const start = HTML.indexOf('<section id="page-predictions"');
  const end = HTML.indexOf('<!-- ======================= Beat the physics');
  assert.ok(start > 0 && end > start, 'Predictions section found');
  return HTML.slice(start, end).replace(/<!--[\s\S]*?-->/g, '');
})();

/** The markup with every <details>…</details> removed (nested ones too): what shows with all Details closed. */
function withoutDetails(html) {
  let out = '';
  let depth = 0;
  let at = 0;
  const pattern = /<\/?details\b[^>]*>/g;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    if (depth === 0) out += html.slice(at, match.index);
    depth += match[0].startsWith('</') ? -1 : 1;
    assert.ok(depth >= 0, 'balanced <details>');
    at = match.index + match[0].length;
  }
  assert.equal(depth, 0, 'balanced <details>');
  return out + html.slice(at);
}

/** Visible static text: data-t strings plus literal text between tags (elements marked hidden are skipped). */
function staticTexts(html) {
  const texts = [];
  for (const match of html.matchAll(/<[^>]*\bdata-t="([^"]+)"[^>]*>/g)) if (!/\shidden[\s>]/.test(match[0])) texts.push(t(match[1]));
  for (const text of html.replace(/<[^>]+>/g, '\n').split('\n')) if (text.trim()) texts.push(text.trim());
  return texts;
}

const visibleStatic = staticTexts(withoutDetails(section));
const visible = [...visibleStatic, ...story];

test('the page opens with the new headline, one line and the Pluto button', () => {
  assert.equal(t('story.title'), 'Can we predict where things in space will be?');
  assert.equal(t('ledger.eyebrow').toUpperCase(), 'PREDICT AND CHECK');
  assert.match(section, /id="predictions-title"[^>]*data-t="story\.title"/);
  assert.match(section, /id="story-pluto"[^>]*data-t="story\.cta"/);
  assert.equal(t('story.cta'), 'See how it works with Pluto');
  for (const step of ['measure', 'predict', 'lock', 'check']) {
    assert.ok(has(`story.step.${step}.title`) && has(`story.step.${step}.text`), step);
    assert.ok(visibleStatic.includes(t(`story.step.${step}.text`)), `step ${step} is outside Details`);
  }
  assert.ok(!visibleStatic.includes(t('story.physics.text')), '"What physics?" stays closed');
  assert.ok(visibleStatic.includes(t('story.arcsec')));
});

test('technical words appear only inside Details on the Predictions page', () => {
  assert.ok(visible.length > 30, 'enough visible text was read');
  for (const text of visible) {
    for (const word of DETAILS_ONLY_WORDS) assert.ok(!text.toLowerCase().includes(word.toLowerCase()), `"${word}" outside Details: ${text}`);
  }
  // The full record (old cards, scoreboard, batch section, forecasts, the untested list) is drawn into hosts that sit
  // inside a <details> in the markup, so none of it shows until a Details is opened.
  const closed = withoutDetails(section);
  for (const id of ['ledger-board', 'ledger-list', 'ledger-batch-host', 'ledger-forecast-list', 'ledger-seeonly', 'story-untested-list', 'ledger-trials-title']) {
    assert.ok(section.includes(`id="${id}"`), `${id} exists`);
    assert.ok(!closed.includes(`id="${id}"`), `${id} sits inside a Details`);
  }
  // The words are really there, inside Details: nothing was deleted.
  assert.match(t('ledger.trialsHeadline', { n: '7', counts: 'x' }), /frozen predictions/);
  assert.match(t('story.gaiaNote'), /catalogue-assisted/);
  assert.match(section, /<details id="ledger-board-details"[^>]*><summary data-t="ledger\.boardDetails">/);
});

test('real tests and practice runs come from the scoreboard, with the right sentences', () => {
  const realRows = board.rows.filter((row) => row.category === 'prospective_unexposed' && ['hit', 'miss'].includes(row.status));
  const batchHits = board.asteroid_batch.rows.filter((row) => ['hit', 'miss'].includes(row.status));
  assert.deepEqual(model.real.map((entry) => entry.id), [...realRows.map((row) => row.trial_id), ...batchHits.map((row) => row.trial_id)]);
  assert.deepEqual(model.practice.map((entry) => entry.id).sort(), board.rows.filter((row) => row.category === 'retrospective_holdout' && ['hit', 'miss'].includes(row.status)).map((row) => row.trial_id).sort());

  const pluto = model.real.find((entry) => entry.targetKey === 'pluto');
  const row = board.rows.find((item) => item.trial_id === pluto.id);
  const sentence = itemSentence(pluto);
  const numbers = (text) => [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((match) => Number(match[0].replaceAll(',', '')));
  const [error, degrees, times] = numbers(sentence);
  assert.ok(Math.abs(error - row.model_error_arcsec) <= 0.05, `Pluto error ${error} vs ${row.model_error_arcsec}`);
  assert.ok(Math.abs(degrees - row.baseline_error_arcsec / 3600) <= 0.05, `straight line ${degrees}° vs ${row.baseline_error_arcsec}″`);
  const ratio = row.baseline_error_arcsec / row.model_error_arcsec;
  assert.ok(times <= ratio && ratio < times + 1000, `over ${times} times worse (ratio ${ratio})`);
  assert.equal(row.status, 'miss');
  assert.match(sentence, /^Miss\. .*just outside the oval/);
  assert.equal(pluto.pending, row.confirmation_pending === true);

  const tercidina = model.real.find((entry) => entry.kind === 'asteroid');
  const batchRow = board.asteroid_batch.rows.find((item) => item.trial_id === tercidina.id);
  assert.equal(asteroidName(batchRow.target_name), '345 Tercidina');
  assert.ok(Math.abs(numbers(itemSentence(tercidina))[0] - batchRow.model_error_arcsec) <= 0.05);
  assert.equal(tercidina.pending, board.asteroid_batch.team_statement_pending === true);

  for (const entry of model.practice) {
    const practiceRow = board.rows.find((item) => item.trial_id === entry.id);
    const shown = numbers(itemSentence(entry, { practice: true }))[0];
    assert.ok(Math.abs(shown - practiceRow.model_error_arcsec) <= 0.005, `${entry.id}: ${shown} vs ${practiceRow.model_error_arcsec}`);
    assert.ok(entry.gaia === bundle(entry.id).trial.doc.labels.includes('catalogue_assisted'));
  }
  assert.equal(shortAngle(1.5188), '1.52″');
  assert.equal(shortAngle(0.0755), '0.08″');
  assert.equal(shortAngle(5.8991), '5.9″');
  assert.equal(shortAngle(19869.7467), '5.5°');
  assert.equal(overRatio(3368.2), '3,000');
});

test('every number shown outside Details matches the data files', () => {
  const rows = board.rows;
  const batchRows = board.asteroid_batch.rows;
  const scored = (row) => ['hit', 'miss'].includes(row.status);
  const allowed = new Set();
  const allow = (value, digits) => allowed.add(Number(value.toFixed(digits)));
  for (const row of [...rows, ...batchRows]) {
    if (Number.isFinite(row.model_error_arcsec)) { allow(row.model_error_arcsec, 1); allow(row.model_error_arcsec, 2); }
    if (Number.isFinite(row.baseline_error_arcsec)) allow(row.baseline_error_arcsec / 3600, 1);
    if (Number.isFinite(row.baseline_error_arcsec) && Number.isFinite(row.model_error_arcsec)) {
      allowed.add(Math.floor(row.baseline_error_arcsec / row.model_error_arcsec / 1000) * 1000);
    }
  }
  for (const row of batchRows) allowed.add(Number(String(row.target_name).match(/^\d+/)?.[0])); // catalogue numbers in names
  allowed.add(rows.filter((row) => !scored(row)).length); // targets that could not be tested
  allowed.add(batchRows.filter((row) => !scored(row)).length); // asteroids that could not be tested
  allowed.add(batchRows.length); // asteroids predicted at once
  allowed.add(board.asteroid_batch.calibration.n); // asteroids checked
  allowed.add(board.asteroid_batch.calibration.k_inside);
  const forecastYears = board.open_forecasts.map((id) => bundle(id).trial.doc).filter((trial) => trial.target_key === 'pluto')
    .map((trial) => new Date(Date.UTC(1858, 10, 17) + trial.holdout.t_mjd * 86400000).getUTCFullYear());
  for (const year of forecastYears) allowed.add(year);
  // Fixed facts of the explanation, not results: the 95% level of the oval and the Moon's width (about 1,800″).
  allowed.add(95);
  allowed.add(1800);
  for (const text of visible) {
    // A digit glued to a letter is a label, not a value ("3D").
    for (const match of text.matchAll(/\d[\d,]*(?:\.\d+)?(?![\dA-Za-z])/g)) {
      const value = Number(match[0].replaceAll(',', ''));
      if (/^[1-4]$/.test(text)) continue; // the step numbers 1–4
      assert.ok(allowed.has(value), `number ${match[0]} in "${text}" is not from the data files`);
    }
  }
  // The months of the 2027 card come from the frozen Pluto forecasts made with the fixed method.
  const fixed = board.open_forecasts.filter((id) => /pluto/.test(id) && /-v2/.test(id)).map((id) => bundle(id).trial.doc.holdout.t_mjd);
  const months = [...new Set(fixed.sort((a, b) => a - b).map((mjd) => longDate(mjd).split(' ')[1]))];
  assert.deepEqual(months, ['April', 'September']);
  assert.ok(story.includes(t('story.check.text', { name: 'Pluto', months: 'April and September', year: '2027' })));
  assert.ok(story.includes('Could not be tested: 4 targets and 7 asteroids (too faint, too bright, or too few clean pictures).'));
});

test('the reveal has six steps in story order with one plain sentence each', () => {
  assert.deepEqual(STEPS, ['track', 'region', 'lock', 'observed', 'baseline', 'verdict']);
  for (const key of ['track', 'region', 'lockReal', 'lockPractice', 'observed', 'baseline', 'hit', 'miss', 'missJust', 'fixed']) assert.ok(has(`reveal.plain.${key}`), key);
  assert.ok(has('reveal.nextPlain') && has('reveal.more') && has('reveal.s.lock'));
  // The Pluto trial: the oval's date and the "just outside" wording come from its files.
  const pluto = bundle('pluto-position-2026b');
  assert.equal(longDate(pluto.trial.doc.holdout.t_mjd), '1 October 2026');
  const d = Math.sqrt(pluto.verification.doc.residuals.model.d2);
  const limit = Math.sqrt(pluto.trial.doc.scoring.threshold_d2);
  assert.ok(d > limit && d <= 1.5 * limit, 'a miss just outside the 95% limit');
  assert.equal(model.plutoTrialId, 'pluto-position-2026b');
});
