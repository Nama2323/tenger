// Task B4: the Predictions page logic (static/js/ledger.js), its fixtures and its route parameter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tangentOffsetArcsec } from '../static/js/coords.js';
import { has } from '../static/js/i18n.js';
import {
  COMMIT_URL, commitInfo, forecastModel, formatArcsec, glanceModel, hasPublishedTrials, imagePlacement, isOpenForecast, ledgerTrialIds, niceLength,
  predictedOf, residualCheck, revealModel, scoreboardTable, sortByStatus, trialIdFromPath, trialLabels, trialStatus,
} from '../static/js/ledger.js';
import { buildRoute, parseRoute } from '../static/js/route.js';
import { CAN_DO, LIMITS_DO, SHORTCUTS } from '../static/js/help.js';
import { STEPS } from '../static/js/reveal.js';

// fileURLToPath, not URL.pathname: a checkout path may contain spaces ("Hackathon Astrolemma").
const FIXTURES = fileURLToPath(new URL('../static/dev-fixtures/', import.meta.url));
const DATA = fileURLToPath(new URL('../static/data/', import.meta.url));
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const ok = (doc) => ({ state: 'ok', doc });
const missing = { state: 'missing' };
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** A trial bundle as contract.js returns it, read from the fixture folder. */
function bundle(id) {
  const folder = join(FIXTURES, 'trials', id);
  const file = (name) => (existsSync(join(folder, name)) ? ok(read(join(folder, name))) : missing);
  return { id, trial: file('trial.json'), prediction: file('prediction.json'), receipt: file('receipt.json'), verification: file('verification.json'), training: file('training.json') };
}

const index = read(join(FIXTURES, 'index.json'));
const board = read(join(FIXTURES, 'scoreboard.json'));
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ''} ${actual} vs ${expected}`);

test('trial ids come from the index paths and the scoreboard, once each', () => {
  assert.equal(trialIdFromPath('trials/barnard-position-example/trial.json'), 'barnard-position-example');
  assert.equal(trialIdFromPath('trials/../x/trial.json'), null);
  assert.equal(trialIdFromPath('trials/Bad_Id/trial.json'), null);
  const ids = ledgerTrialIds(index, board);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['barnard-position-example', 'epsindib-position-example', 'pluto-position-example', 'pluto-position-forecast-example',
    'makemake-position-forecast-example', 'wise0855-position-example']) assert.ok(ids.includes(id), id);
  assert.deepEqual(ledgerTrialIds(null, null), []);
});

test('the page uses real trial files only once the real index lists some (fixtures until then)', () => {
  const real = read(join(DATA, 'index.json'));
  assert.equal(hasPublishedTrials(ok(real)), Array.isArray(real.trials) && real.trials.length > 0 || Boolean(real.scoreboard_path));
  assert.equal(hasPublishedTrials(ok({ ...real, trials: [], scoreboard_path: null })), false);
  assert.equal(hasPublishedTrials(ok({ ...real, trials: ['trials/pluto-position-a/trial.json'] })), true);
  assert.equal(hasPublishedTrials(ok({ ...real, trials: [], scoreboard_path: 'scoreboard.json' })), true);
  assert.equal(hasPublishedTrials(ok(index)), false, 'an example index never counts as published');
  assert.equal(hasPublishedTrials(missing), false);
});

test('open forecasts are only what the files label as such, never inferred from a date', () => {
  assert.equal(isOpenForecast(bundle('pluto-position-forecast-example')), true);
  assert.equal(isOpenForecast(bundle('makemake-position-forecast-example')), true);
  for (const id of ['barnard-position-example', 'pluto-position-example', 'epsindib-position-example']) assert.equal(isOpenForecast(bundle(id)), false, id);
  const future = bundle('pluto-position-example');
  future.trial.doc = { ...future.trial.doc, holdout: { ...future.trial.doc.holdout, t_mjd: 70000 }, open_forecast: false };
  delete future.trial.doc.holdout.data_state;
  assert.equal(isOpenForecast(future), false, 'a far-future date alone does not make an open forecast');
  assert.equal(isOpenForecast(future, { open_forecasts: ['pluto-position-example'] }), true, 'the scoreboard list is a label too');
});

test('statuses come from verification, then prediction_status, then a frozen prediction', () => {
  assert.equal(trialStatus(bundle('barnard-position-example')).status, 'hit');
  assert.equal(trialStatus(bundle('epsindib-position-example')).status, 'miss');
  const wise = trialStatus(bundle('wise0855-position-example'));
  assert.deepEqual([wise.status, wise.reasonKey], ['insufficient_data', 'measure.contaminated'], 'insufficient at freeze is not waiting');
  assert.equal(trialStatus(bundle('pluto-position-example')).status, 'waiting');
  assert.equal(trialStatus({ id: 'x', trial: ok({}), prediction: missing, verification: missing }).status, null);
  const conflict = trialStatus(bundle('barnard-position-example'), { status: 'miss' });
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.status, 'hit', 'the verification file wins and the disagreement is reported');
});

test('every category label is shown, the most limiting first', () => {
  assert.deepEqual(trialLabels(bundle('epsindib-position-example').trial.doc), ['retrospective_holdout', 'catalogue_assisted']);
  assert.deepEqual(trialLabels({ category: 'catalogue_assisted', labels: ['catalogue_assisted', 'made_up'] }), ['catalogue_assisted']);
  assert.deepEqual(trialLabels({ category: 'illustrative' }), ['illustrative']);
});

test('freeze receipts: short sha and a GitHub link only for a real commit', () => {
  const full = 'a3f9c2b7e1d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8';
  const real = commitInfo(ok({ commit: full, committed_utc: '2026-11-14T20:00:00Z', prediction_sha256: 'f'.repeat(64) }));
  assert.equal(real.short, 'a3f9c2b');
  assert.equal(real.url, `${COMMIT_URL}${full}`);
  assert.equal(real.url, 'https://github.com/Nama2323/tenger/commit/a3f9c2b7e1d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8');
  const example = commitInfo(bundle('barnard-position-example').receipt);
  assert.equal(example.example, true);
  assert.equal(example.url, null, 'no link for an example receipt');
  assert.equal(commitInfo(ok({ commit: '0'.repeat(40) })).short, null, 'an all-zero sha is not a commit');
  assert.equal(commitInfo(ok({ commit: 'not a sha; rm -rf' })).url, null);
  assert.equal(commitInfo(missing), null);
});

test('the scoreboard summary is the file’s counts, unchanged, with no rate', () => {
  const table = scoreboardTable(board);
  assert.deepEqual(table.rows.map((row) => row.category), Object.keys(board.counts));
  for (const row of table.rows) {
    table.statuses.forEach((status, index) => assert.equal(row.cells[index], board.counts[row.category][status]));
  }
  assert.deepEqual(table.openForecasts, board.open_forecasts);
  assert.deepEqual(table.seeOnly, ['3i-atlas']);
  assert.deepEqual(Object.keys(table), ['statuses', 'rows', 'seeOnly', 'openForecasts', 'example', 'generatedUtc'], 'no rate, percentage or expected-hit field');
  for (const row of table.rows) assert.deepEqual(Object.keys(row), ['category', 'cells']);
  assert.equal(scoreboardTable(null), null);
  assert.deepEqual(scoreboardTable({ counts: { retrospective_holdout: { hit: 1 } } }).statuses, ['hit'], 'only statuses present in the file');
});

test('fixture scoreboard: open forecasts and See-only targets are never counted', () => {
  const rowIds = board.rows.map((row) => row.trial_id);
  for (const id of board.open_forecasts) assert.ok(!rowIds.includes(id), id);
  const counted = Object.values(board.counts).reduce((sum, counts) => sum + Object.values(counts).reduce((a, b) => a + b, 0), 0);
  assert.equal(counted, board.rows.length);
  const statuses = new Set(board.rows.map((row) => row.status));
  for (const status of ['hit', 'miss', 'waiting', 'insufficient_data']) assert.ok(statuses.has(status), `fixtures include a ${status} trial`);
});

test('fixture hash chains: training → trial → prediction → receipt and verification', () => {
  const folders = readdirSync(join(FIXTURES, 'trials'));
  for (const id of folders) {
    const folder = join(FIXTURES, 'trials', id);
    const trial = read(join(folder, 'trial.json'));
    const prediction = read(join(folder, 'prediction.json'));
    assert.equal(prediction.trial_ref.sha256, sha(join(folder, 'trial.json')), id);
    if (existsSync(join(folder, 'receipt.json'))) assert.equal(read(join(folder, 'receipt.json')).prediction_sha256, sha(join(folder, 'prediction.json')), id);
    if (existsSync(join(folder, 'verification.json'))) assert.equal(read(join(folder, 'verification.json')).prediction_sha256, sha(join(folder, 'prediction.json')), id);
    if (existsSync(join(folder, 'training.json')) && !/^0+$/.test(trial.training.measurements_sha256)) {
      assert.equal(trial.training.measurements_sha256, sha(join(folder, 'training.json')), id);
    }
  }
});

test('the reveal draws the files’ positions in the scoring frame and agrees with the recorded residual', () => {
  const barnard = bundle('barnard-position-example');
  const model = revealModel(barnard, barnard.training);
  const verification = barnard.verification.doc;
  assert.equal(model.status, 'hit');
  near(model.observed.east, verification.residuals.model.east_arcsec, 0.01, 'observed east');
  near(model.observed.north, verification.residuals.model.north_arcsec, 0.01, 'observed north');
  near(model.distance, Math.sqrt(verification.residuals.model.d2), 1e-12, 'D is √d² from the file');
  near(model.limit, 2.4477468, 1e-6, '95% radius in 2D');
  assert.equal(model.check.ok, true);
  assert.equal(model.training.length, 3);
  assert.ok(model.training.every((point, index, list) => index === 0 || list[index - 1].tMjd <= point.tMjd), 'oldest first');
  assert.ok(model.region && model.testRegion && model.testRegion.major > model.region.major, 'test region adds the measurement error');
  assert.equal(model.image.scale, 6.2);
  const half = model.views.focus.span / 2;
  for (const point of [...model.training, model.baseline, model.observed, model.model]) {
    assert.ok(Math.abs(point.east - model.views.focus.east) < half && Math.abs(point.north - model.views.focus.north) < half, 'focus view holds every point');
  }
  assert.ok(model.views.full.span > model.views.focus.span, 'the reveal starts wider than it ends');

  const eps = bundle('epsindib-position-example');
  const miss = revealModel(eps, eps.training);
  assert.equal(miss.status, 'miss');
  assert.ok(miss.distance > miss.limit);
  assert.equal(miss.check.ok, true);
});

test('A5 frame: with residuals.model.reference the picture is drawn around it, and the shift is reported', () => {
  const shifted = bundle('barnard-position-example');
  const verification = structuredClone(shifted.verification.doc);
  const headline = shifted.prediction.doc.model;
  // The reference: the frozen model at the mean evaluation time from the real observer, 0.3″ east of the headline.
  const reference = { ra_deg: headline.ra_deg + 0.3 / 3600 / Math.cos((headline.dec_deg * Math.PI) / 180), dec_deg: headline.dec_deg, t_mjd: 61451.2 };
  const fromReference = tangentOffsetArcsec(reference.ra_deg, reference.dec_deg, verification.observed.ra_deg, verification.observed.dec_deg);
  verification.residuals.model = { ...verification.residuals.model, reference, east_arcsec: fromReference.east, north_arcsec: fromReference.north,
    c_pred_arcsec2: [[1.1, 0.2], [0.2, 1.5]] };
  const S = [[1.1 + 0.81, 0.2], [0.2, 1.5 + 0.81]];
  const det = S[0][0] * S[1][1] - S[0][1] * S[1][0];
  verification.residuals.model.d2 = (S[1][1] * fromReference.east ** 2 - 2 * S[0][1] * fromReference.east * fromReference.north + S[0][0] * fromReference.north ** 2) / det;
  shifted.verification = ok(verification);
  const model = revealModel(shifted);
  assert.equal(model.check.ok, true, 'recomputed against the reference, not the headline');
  near(model.referenceShift, 0.3, 0.001);
  assert.equal(model.tMjd, 61451.2);
  near(model.observed.east, fromReference.east, 1e-9);
  assert.deepEqual(model.model.cov, [[1.1, 0.2], [0.2, 1.5]], 'the drawn region uses the C_pred the verdict used');
});

test('the reveal refuses what it cannot show, and flags a residual that disagrees with the positions', () => {
  assert.equal(revealModel(bundle('pluto-position-example')), null, 'waiting: nothing to reveal');
  assert.equal(revealModel(bundle('rdra-brightness-example')), null, 'brightness: no position reveal');
  assert.equal(revealModel(bundle('wise0855-position-example')), null, 'no prediction');
  const tampered = bundle('barnard-position-example');
  tampered.verification.doc = structuredClone(tampered.verification.doc);
  tampered.verification.doc.residuals.model.east_arcsec += 0.5;
  assert.equal(revealModel(tampered).check.ok, false);
  assert.deepEqual(residualCheck(null, null), { checked: false, ok: true });
  const noTraining = revealModel(bundle('barnard-position-example'), missing);
  assert.deepEqual([noTraining.training.length, noTraining.trainingState], [0, 'missing']);
});

test('evaluation images are placed only with a centre, a pixel scale and north-up, east-left orientation', () => {
  const origin = { ra_deg: 10, dec_deg: 20 };
  const good = { path: 'trials/x/a.png', centre_ra_deg: 10, centre_dec_deg: 20, scale_arcsec_px: 6.2, width_px: 48, height_px: 48, north_up: true, east_left: true };
  const placed = imagePlacement(good, origin).image;
  near(placed.east[1] - placed.east[0], 48 * 6.2, 1e-9);
  assert.equal(imagePlacement({ ...good, east_left: false }, origin).reason, 'orientation');
  assert.equal(imagePlacement({ ...good, scale_arcsec_px: null }, origin).reason, 'geometry');
  assert.equal(imagePlacement(null, origin).reason, 'none');
  const offset = tangentOffsetArcsec(10, 20, 10.01, 20);
  near(imagePlacement({ ...good, centre_ra_deg: 10.01 }, origin).image.centre.east, offset.east, 1e-9);
});

test('open forecast charts: track points with their own 95% regions, a zoom when the region is tiny', () => {
  const pluto = bundle('pluto-position-forecast-example');
  const chart = forecastModel(pluto.prediction.doc, pluto.trial.doc);
  assert.equal(chart.track.length, 4);
  assert.ok(chart.track.every((point) => point.region && point.region.major > 0));
  assert.ok(chart.model.region);
  const makemake = bundle('makemake-position-forecast-example');
  const single = forecastModel(makemake.prediction.doc, makemake.trial.doc);
  assert.equal(single.track.length, 0);
  assert.equal(single.zoom, null);
  const what = predictedOf(pluto.prediction.doc, pluto.trial.doc);
  assert.equal(what.kind, 'position');
  assert.equal(what.track.length, 4);
  assert.equal(forecastModel({ model: null }, null), null, 'an insufficient forecast draws nothing');
});

test('cards: checked trials first, then waiting, then insufficient data; stable otherwise', () => {
  const cards = ['waiting', 'hit', 'insufficient_data', 'miss', 'hit'].map((status, index) => ({ index, status: { status } }));
  assert.deepEqual(sortByStatus(cards).map((card) => card.index), [1, 4, 3, 0, 2]);
});

test('scale bars and arcsec labels', () => {
  assert.equal(niceLength(25), 5);
  assert.equal(niceLength(300), 50);
  assert.equal(niceLength(7), 1);
  assert.equal(niceLength(1000), 120, 'arcminutes for long tracks: 2′, not 3.3′');
  assert.equal(formatArcsec(niceLength(1000)), '2′');
  assert.equal(formatArcsec(0.4), '0.40″');
  assert.equal(formatArcsec(5), '5″');
  assert.equal(formatArcsec(297.9), '5.0′');
  assert.equal(formatArcsec(20016), '5.56°');
  assert.equal(formatArcsec(Number.NaN), '—');
});

test('page=predictions and trial=<id> round-trip; trial is ignored on other pages', () => {
  const route = parseRoute('?page=predictions&trial=barnard-position-example');
  assert.equal(route.page, 'predictions');
  assert.equal(route.trial, 'barnard-position-example');
  assert.equal(buildRoute({ page: 'predictions', trial: 'barnard-position-example' }), '?page=predictions&trial=barnard-position-example');
  assert.equal(buildRoute({ page: 'game', trial: 'barnard-position-example' }), '?page=game');
  assert.equal(parseRoute('?page=predictions&trial=<script>').trial, null);
});

test('every reveal step, status, shortcut and limit has English text', () => {
  for (const status of ['waiting', 'hit', 'miss', 'insufficient_data', 'ambiguous', 'invalid_comparison', 'see_only', 'open', 'none']) assert.ok(has(`ledger.status.${status}`), status);
  for (const step of STEPS) assert.ok(has(`reveal.s.${step}`), step);
  for (const step of STEPS.slice(1)) assert.ok(has(`reveal.next.${step}`), step);
  for (const status of ['hit', 'miss', 'insufficient_data', 'ambiguous', 'invalid_comparison']) assert.ok(has(`reveal.verdict.${status}`), status);
  for (const reason of ['none', 'geometry', 'orientation']) assert.ok(has(`reveal.t.image.${reason}`), reason);
  for (const [title, rows] of SHORTCUTS) {
    assert.ok(has(title), title);
    for (const [keys, action] of rows) assert.ok(has(keys) && has(action), `${keys} ${action}`);
  }
  for (const id of CAN_DO) assert.ok(has(`limits.can.${id}`) || has(`limits.can.${id}Plain`), id);
  for (const id of LIMITS_DO) assert.ok((has(`limits.limit.${id}`) || has(`limits.limit.${id}Plain`)) && has(`limits.do.${id}`), id);
});

// Task B12: the Predictions page leads with the blind forecast's result and three key numbers, all counted from
// scoreboard.json (never typed in), so the headline and the tiles cannot drift from the file.
test('the Predictions headline and tiles are counted from scoreboard.json', () => {
  const doc = read(join(DATA, 'scoreboard.json'));
  const glance = glanceModel(doc);
  const blind = doc.rows.filter((row) => row.category === 'prospective_unexposed' && !row.exploratory && ['hit', 'miss'].includes(row.status));
  if (blind.length === 1) {
    assert.equal(glance.lead.targetKey, blind[0].target_key);
    assert.equal(glance.lead.status, blind[0].status);
    assert.equal(glance.lead.errorArcsec, blind[0].model_error_arcsec);
  } else {
    assert.equal(glance.lead, null);
  }
  const tile = (id) => glance.tiles.find((item) => item.id === id);
  assert.equal(tile('blind').miss, doc.counts.prospective_unexposed.miss);
  assert.equal(tile('blind').hit, doc.counts.prospective_unexposed.hit);
  assert.equal(tile('retro').hit, doc.counts.retrospective_holdout.hit);
  assert.equal(tile('retro').unusable, ['insufficient_data', 'ambiguous', 'invalid_comparison'].reduce((sum, key) => sum + (doc.counts.retrospective_holdout[key] ?? 0), 0));
  if (doc.asteroid_batch) {
    assert.equal(tile('batch').k, doc.asteroid_batch.calibration.k_inside);
    assert.equal(tile('batch').n, doc.asteroid_batch.calibration.n);
    assert.equal(tile('batch').pending, doc.asteroid_batch.team_statement_pending === true);
  }
});

test('the glance has no headline unless exactly one blind trial has a result', () => {
  const base = { counts: { prospective_unexposed: { hit: 1, miss: 1 } } };
  const row = (key, status, extra = {}) => ({ target_key: key, category: 'prospective_unexposed', status, model_error_arcsec: 1.2, ...extra });
  assert.equal(glanceModel({ ...base, rows: [row('a', 'hit'), row('b', 'miss')] }).lead, null);
  assert.equal(glanceModel({ ...base, rows: [row('a', 'hit'), row('b', 'miss', { exploratory: true })] }).lead.targetKey, 'a');
  assert.equal(glanceModel({ ...base, rows: [row('a', 'waiting')] }).lead, null);
  assert.equal(glanceModel({ rows: [] }), null);
  // No batch in the file: no batch tile, never an invented "0 of 0".
  assert.deepEqual(glanceModel({ ...base, rows: [] }).tiles.map((tile) => tile.id), ['blind']);
});
