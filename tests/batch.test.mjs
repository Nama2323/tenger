// B6: the asteroid batch on Predictions and in Lesson 3 (calibration of many small position trials).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { has } from '../static/js/i18n.js';
import { createSource } from '../static/js/contract.js';
import {
  baselineWins, binomialCdf, chartRows, clopperPearson, coverageVerdict, D2_LIMIT_95, D_LIMIT_95, readBatch, whatIfRows,
} from '../static/js/batch.js';
import { BATCH_FIXTURE_PATH, loadBatch } from '../static/js/batch-ui.js';

const STATIC = fileURLToPath(new URL('../static/', import.meta.url));
const fixture = (path) => JSON.parse(readFileSync(`${STATIC}dev-fixtures/${path}`, 'utf8'));
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ''} ${actual} vs ${expected}`);

test('the 95% line for a 2D position is D² = 5.991, D = 2.4477', () => {
  assert.equal(D2_LIMIT_95, 5.991);
  near(D_LIMIT_95, 2.4477, 1e-4);
});

test('exact (Clopper–Pearson) intervals match known values', () => {
  near(binomialCdf(3, 10, 0.5), 0.171875, 1e-12);
  const cases = [[0, 10, 0, 0.3085], [10, 10, 0.6915, 1], [5, 10, 0.1871, 0.8129], [11, 12, 0.6152, 0.9979], [19, 20, 0.7513, 0.9987]];
  for (const [k, n, low, high] of cases) {
    const [a, b] = clopperPearson(k, n);
    near(a, low, 1e-4, `${k}/${n} low`);
    near(b, high, 1e-4, `${k}/${n} high`);
  }
  assert.equal(clopperPearson(3, 0), null);
  assert.equal(clopperPearson(5, 4), null);
});

test('a small N gives a wide interval; the same share with more tries narrows it', () => {
  const width = ([low, high]) => high - low;
  const rows = whatIfRows({ k: 10, n: 12, level: 0.95 });
  assert.deepEqual(rows.map((row) => [row.k, row.n]), [[40, 48], [160, 192]]);
  assert.ok(width(clopperPearson(10, 12)) > width(rows[0].interval));
  assert.ok(width(rows[0].interval) > width(rows[1].interval));
});

test('coverage verdicts compare the nominal 95% with the interval', () => {
  assert.equal(coverageVerdict({ interval: [0.6, 0.99], level: 0.95 }), 'fits');
  assert.equal(coverageVerdict({ interval: [0.5, 0.9], level: 0.95 }), 'tooSmall');
  assert.equal(coverageVerdict({ interval: [0.96, 1], level: 0.95 }), 'tooBig');
  assert.equal(coverageVerdict({ interval: null, level: 0.95 }), null);
});

test('the batch reader takes counts from the file, or counts the rows when the file has none', () => {
  const rows = [
    { trial_id: 'a', name: 'A', d2: 1, model_error_arcsec: 1, baseline_error_arcsec: 3 },
    { trial_id: 'b', name: 'B', d: 3, model_error_arcsec: 5, baseline_error_arcsec: 2 },
    { trial_id: 'c', name: 'C', d2: 2, model_error_arcsec: 2, baseline_error_arcsec: 2 },
    { trial_id: 'd', name: 'D', d2: 0.5, excluded_reason_key: 'batch.why.blended' },
  ];
  const counted = readBatch({ schema_version: 'tenger.batch/1', rows });
  assert.equal(counted.calibration.computed, true);
  assert.equal(counted.calibration.n, 3, 'the excluded row is left out');
  assert.equal(counted.calibration.k, 2);
  assert.equal(counted.calibration.method, 'clopper_pearson');
  assert.deepEqual(counted.calibration.interval, clopperPearson(2, 3));
  near(counted.calibration.expected, 2.85, 1e-12);
  assert.deepEqual(chartRows(counted).map((row) => row.trialId), ['a', 'c', 'b'], 'smallest D first, the excluded row left out');
  assert.equal(counted.rows[1].inside, false, 'D = 3 is outside the 95% region');
  assert.deepEqual(baselineWins(counted), { compared: 3, model: 1, baseline: 1 }, 'a tie counts for neither');
  const given = readBatch({ schema_version: 'tenger.batch/1', rows, team_statement_pending: true, calibration: { n: 3, k_inside: 2, level: 0.95, interval: [0.1, 0.9], interval_method: 'wilson', expected_inside: 2.85 } });
  assert.equal(given.calibration.computed, false);
  assert.deepEqual(given.calibration.interval, [0.1, 0.9], 'the file\'s interval is shown as published');
  assert.equal(given.calibration.method, 'wilson');
  assert.equal(given.statementPending, true);
  assert.equal(readBatch({ ...given, schema_version: 'tenger.scoreboard/1' }), null);
  assert.equal(readBatch({ schema_version: 'tenger.batch/1' }), null);
});

test('the example batch is labelled, consistent with its own trial files, and says the statement is pending', () => {
  const doc = fixture(BATCH_FIXTURE_PATH);
  assert.equal(doc.example, true);
  const batch = readBatch(doc);
  assert.equal(batch.example, true);
  assert.equal(batch.statementPending, true);
  assert.equal(batch.calibration.k, batch.rows.filter((row) => row.inside).length);
  for (const row of batch.rows) {
    const residual = fixture(`trials/${row.trialId}/verification.json`).residuals.model;
    const s = [0, 1].map((i) => [0, 1].map((j) => residual.c_pred_arcsec2[i][j] + residual.c_obs_arcsec2[i][j]));
    const det = s[0][0] * s[1][1] - s[0][1] * s[1][0];
    const [x, y] = [residual.east_arcsec, residual.north_arcsec];
    const d2 = (s[1][1] * x * x - 2 * s[0][1] * x * y + s[0][0] * y * y) / det;
    near(d2, row.d2, 0.01, `${row.trialId} D² from its residual and region`);
    assert.equal(row.inside, d2 <= D2_LIMIT_95, `${row.trialId} verdict`);
    assert.equal(fixture(`trials/${row.trialId}/trial.json`).batch_id, doc.batch_id);
  }
});

/** A fake fetch over static/: real files from static/data, fixtures from static/dev-fixtures. */
function staticFetch(overrides = {}) {
  return async (url) => {
    const path = String(url);
    if (path in overrides) return { ok: true, status: 200, json: async () => overrides[path] };
    try {
      const text = readFileSync(`${STATIC}${path}`, 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(text) };
    } catch {
      return { ok: false, status: 404, json: async () => ({}) };
    }
  };
}

test('the invented example never shows on the public page; a listed real batch switches in automatically', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const realIndex = JSON.parse(readFileSync(`${STATIC}data/index.json`, 'utf8'));
  // No batch listed: nothing on the public page, the example only in ?fixtures=1 mode.
  globalThis.fetch = staticFetch();
  const real = createSource({ fixtures: false, fetchImpl: globalThis.fetch });
  const fixtures = createSource({ fixtures: true, fetchImpl: globalThis.fetch });
  if (!Array.isArray(realIndex.batch_paths)) {
    assert.equal(await loadBatch({ real, fixtures, allowExample: false }), null);
  }
  const example = await loadBatch({ real, fixtures, allowExample: true });
  assert.equal(example.batch.example, true);
  assert.equal(example.bundles.length, 12);
  assert.ok(example.bundles.every((bundle) => bundle.trial.state === 'ok' && bundle.verification.state === 'ok'));
  // A real batch listed in the index wins, even in example mode; one marked as an example is refused.
  const listed = { ...realIndex, batch_paths: ['batches/asteroids-test.json'] };
  const realBatch = { ...fixture(BATCH_FIXTURE_PATH), example: undefined, batch_id: 'asteroids-test', trial_ids: [], rows: [] };
  globalThis.fetch = staticFetch({ 'data/index.json': listed, 'data/batches/asteroids-test.json': realBatch });
  const switched = await loadBatch({ real: createSource({ fixtures: false, fetchImpl: globalThis.fetch }), fixtures, allowExample: false });
  assert.equal(switched.batch.id, 'asteroids-test');
  assert.equal(switched.batch.example, false);
  assert.equal(switched.path, 'data/batches/asteroids-test.json');
  globalThis.fetch = staticFetch({ 'data/index.json': listed, 'data/batches/asteroids-test.json': { ...realBatch, example: true } });
  assert.equal(await loadBatch({ real: createSource({ fixtures: false, fetchImpl: globalThis.fetch }), fixtures, allowExample: false }), null);
});

test('every visible label of the batch section and the lesson example exists in English', () => {
  for (const key of [
    'batch.title', 'batch.lead', 'batch.statementPending', 'batch.statementPendingNote', 'batch.exampleNote', 'batch.headline', 'batch.interval',
    'batch.method.exact', 'batch.method.wilson', 'batch.expected', 'batch.fits', 'batch.tooSmall', 'batch.tooBig', 'batch.smallN', 'batch.independence',
    'batch.computed', 'batch.dTitle', 'batch.dLabel', 'batch.dAxis', 'batch.limitLine', 'batch.errorsTitle', 'batch.errorsSummary', 'batch.inside',
    'batch.outside', 'batch.notScored', 'batch.excluded', 'batch.f.forecast', 'batch.f.date', 'batch.f.region', 'batch.f.observed', 'batch.f.baseline', 'batch.frozen',
    'batch.frozenExample', 'batch.frozenNoLink', 'batch.plotLegend', 'batch.example.independence', 'batch.example.note',
    'lesson.sure.batchTitle', 'lesson.sure.batchExample', 'lesson.sure.batchCount', 'lesson.sure.batchMeaning', 'lesson.sure.batchInterval',
    'lesson.sure.batchWhatIf', 'lesson.sure.batchCaption', 'lesson.sure.batchLesson', 'lesson.sure.batchSource',
  ]) assert.ok(has(key), key);
});
