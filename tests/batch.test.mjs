// B6: the asteroid batch on Predictions and in Lesson 3 (calibration of many small position trials).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
  const unlisted = { ...realIndex };
  delete unlisted.batch_paths;
  globalThis.fetch = staticFetch({ 'data/index.json': unlisted });
  const real = createSource({ fixtures: false, fetchImpl: globalThis.fetch });
  const fixtures = createSource({ fixtures: true, fetchImpl: globalThis.fetch });
  assert.equal(await loadBatch({ real, fixtures, allowExample: false }), null);
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
  // Session A's own index: once it lists a batch, that batch is shown even in example mode.
  if (Array.isArray(realIndex.batch_paths) && realIndex.batch_paths.length) {
    globalThis.fetch = staticFetch();
    const published = await loadBatch({ real: createSource({ fixtures: false, fetchImpl: globalThis.fetch }), fixtures: createSource({ fixtures: true, fetchImpl: globalThis.fetch }), allowExample: true });
    assert.equal(published.batch.example, false);
    assert.equal(published.path, `data/${realIndex.batch_paths[0]}`);
  }
});

test('every visible label of the batch section and the lesson example exists in English', () => {
  for (const key of [
    'batch.title', 'batch.lead', 'batch.statementPending', 'batch.statementPendingNote', 'batch.exampleNote', 'batch.headline', 'batch.interval',
    'batch.method.exact', 'batch.method.wilson', 'batch.expected', 'batch.fits', 'batch.tooSmall', 'batch.tooBig', 'batch.smallN', 'batch.assumeIndependent',
    'batch.computed', 'batch.dTitle', 'batch.dLabel', 'batch.dAxis', 'batch.limitLine', 'batch.errorsTitle', 'batch.errorsSummary', 'batch.inside',
    'batch.outside', 'batch.notScored', 'batch.excluded', 'batch.f.forecast', 'batch.f.date', 'batch.f.region', 'batch.f.observed', 'batch.f.baseline', 'batch.frozen',
    'batch.frozenExample', 'batch.frozenNoLink', 'batch.plotLegend', 'batch.example.independence', 'batch.example.note',
    'lesson.sure.batchTitle', 'lesson.sure.batchExample', 'lesson.sure.batchCount', 'lesson.sure.batchMeaning', 'lesson.sure.batchInterval',
    'lesson.sure.batchWhatIf', 'lesson.sure.batchCaption', 'lesson.sure.batchLesson', 'lesson.sure.batchSource',
  ]) assert.ok(has(key), key);
});

const realBatch = () => {
  const path = `${STATIC}data/batches/asteroids-2026a.json`;
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
};

test('V13 rows: model, second model and straight line are read from their own prefixed fields', () => {
  const doc = {
    schema_version: 'tenger.batch/1', trial_ids: ['a', 'b'],
    rows: [
      { trial_id: 'a', status: 'hit', model_d2: 2.0, model_d: Math.sqrt(2), model_inside: true, model_error_arcsec: 3.1,
        secondary_d2: 9.0, secondary_d: 3, secondary_inside: false, secondary_error_arcsec: 12, baseline_d2: 40, baseline_d: Math.sqrt(40), baseline_inside: false, baseline_error_arcsec: 30 },
      { trial_id: 'b', status: 'waiting', model_d2: null, model_d: null, model_inside: null, secondary_d2: null, baseline_d2: null },
    ],
    calibration: { n: 1, k_inside: 1, level: 0.95, interval: [0.025, 1], interval_method: 'clopper_pearson', wilson_interval: [0.207, 1] },
    secondary_calibration: { n: 1, k_inside: 0, level: 0.95, interval: [0, 0.975] },
    baseline_calibration: { n: 1, k_inside: 0, level: 0.95, interval: [0, 0.975] },
  };
  const batch = readBatch(doc);
  const [a, b] = batch.rows;
  assert.equal(a.d2, 2.0);
  assert.equal(a.inside, true);
  assert.equal(a.modelError, 3.1);
  assert.equal(a.secondary.inside, false);
  assert.equal(a.secondary.error, 12);
  assert.equal(a.baseline.inside, false);
  assert.equal(a.baselineError, 30);
  assert.equal(b.inside, null);
  assert.equal(b.status, 'waiting');
  assert.deepEqual([batch.calibration.k, batch.secondaryCalibration.k, batch.baselineCalibration.k], [1, 0, 0], 'each model counted on its own');
  assert.deepEqual(batch.calibration.wilson, [0.207, 1]);
  assert.equal(batch.waiting, 1);
});

test('a batch with nothing checked yet has no interval and no coverage verdict (never "0 of 0")', () => {
  const batch = readBatch({ schema_version: 'tenger.batch/1', rows: [{ trial_id: 'a', status: 'waiting' }],
    calibration: { n: 0, k_inside: 0, level: 0.95, interval: [0, 1] } });
  assert.equal(batch.calibration.n, 0);
  assert.equal(batch.calibration.interval, null);
  assert.equal(coverageVerdict(batch.calibration), null);
  for (const key of ['batch.waitingHeadline', 'batch.waitingHeadlineNoDate', 'batch.waitingNext', 'batch.count.waiting', 'batch.count.insufficient_data', 'batch.count.other',
    'batch.secondaryLine', 'batch.baselineLine', 'batch.waiting', 'batch.insufficient', 'batch.notAttempted']) assert.ok(has(key), key);
});

test('Session A\'s frozen batch: 8 rows, 7 waiting and 1 insufficient data, nothing scored yet', { skip: realBatch() ? false : 'real batch not on this branch yet' }, () => {
  const doc = realBatch();
  const batch = readBatch(doc);
  assert.equal(batch.example, false);
  assert.equal(batch.rows.length, doc.trial_ids.length);
  assert.equal(batch.calibration.n, doc.calibration.n);
  if (doc.calibration.n === 0) {
    assert.equal(batch.calibration.interval, null);
    assert.equal(coverageVerdict(batch.calibration), null);
  }
  assert.equal(batch.waiting, doc.rows.filter((row) => row.status === 'waiting').length);
  assert.ok(batch.rows.every((row) => row.status !== 'waiting' || row.inside === null), 'a waiting row is never shown as inside or outside');
  assert.ok(batch.frozenUtc);
});

test('loading a published batch never requests a verification file for a row still waiting for its check', { skip: realBatch() ? false : 'real batch not on this branch yet' }, async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const inner = staticFetch();
  const requested = [];
  globalThis.fetch = async (url) => { requested.push(String(url)); return inner(url); };
  const data = await loadBatch({ real: createSource({ fixtures: false, fetchImpl: globalThis.fetch }), fixtures: createSource({ fixtures: true, fetchImpl: globalThis.fetch }) });
  const waiting = data.batch.rows.filter((row) => row.status === 'waiting').map((row) => row.trialId);
  assert.ok(waiting.length > 0);
  for (const id of waiting) assert.ok(!requested.some((url) => url.includes(`${id}/verification.json`)), `${id}: no verification request`);
  assert.ok(data.bundles.every((bundle) => bundle.trial.state === 'ok' && bundle.prediction.state === 'ok'), 'trial and prediction files still read');
});
