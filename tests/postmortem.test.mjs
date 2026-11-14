// "Why we missed": the readers of Session A's exploratory Pluto files, against the published files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { has } from '../static/js/i18n.js';
import {
  correlatedInflation, ellipseOfCovariance, forecastRows, readHindcast, readPostmortem, CHI2_95_2D,
} from '../static/js/postmortem.js';

const DATA = fileURLToPath(new URL('../static/data/', import.meta.url));
const json = (path) => JSON.parse(readFileSync(`${DATA}${path}`, 'utf8'));
const ok = (doc) => ({ state: 'ok', doc });
const bundle = (id) => ({ id, trial: ok(json(`trials/${id}/trial.json`)), prediction: ok(json(`trials/${id}/prediction.json`)) });

test('the post-mortem is read as exploratory, with every number from the file', () => {
  const doc = json('trials/pluto/postmortem.json');
  const pm = readPostmortem(doc);
  assert.equal(pm.trialId, 'pluto-position-2026b');
  assert.equal(pm.status, 'miss');
  assert.equal(pm.observedFromJpl, doc.identification.observed_minus_horizons_total_arcsec);
  assert.equal(pm.forecastFromJpl, doc.identification.frozen_model_minus_horizons_total_arcsec);
  assert.equal(pm.along, doc.residual_split.along_track_arcsec);
  assert.ok(pm.along > pm.across, 'mostly along the track');
  assert.equal(pm.groups, doc.uncertainty_test.groups);
  assert.deepEqual(pm.offsets.map((entry) => entry.sigma), [0.1, 0.2, 0.4]);
  assert.ok(pm.offsets.every((entry) => entry.d2 < CHI2_95_2D && entry.result === 'hit'));
  assert.ok(pm.jackknife.major > pm.frozenRegion.major && pm.jackknife.d2 < CHI2_95_2D);
  assert.ok(pm.frame.barycentric < pm.frame.heliocentric);
  // Counts appear only if the file states them.
  assert.equal(pm.nExposures, Number.isInteger(doc.uncertainty_test.n_exposures) ? doc.uncertainty_test.n_exposures : null);
});

test('files that are not exploratory, or claim to count, are refused', () => {
  const doc = json('trials/pluto/postmortem.json');
  assert.equal(readPostmortem({ ...doc, counts: true }), null);
  assert.equal(readPostmortem({ ...doc, exploratory: false }), null);
  assert.equal(readPostmortem({ ...doc, schema_version: 'tenger.postmortem/2' }), null);
  assert.equal(readPostmortem(null), null);
  const hind = json('trials/pluto/hindcast-v2.json');
  assert.equal(readHindcast({ ...hind, counts: true }), null);
});

test('the hindcast compares the frozen method with the new one, which only "would have" hit', () => {
  const hind = readHindcast(json('trials/pluto/hindcast-v2.json'));
  assert.equal(hind.old.result, 'miss');
  assert.equal(hind.new.result, 'hit');
  assert.ok(hind.new.d2 < CHI2_95_2D && hind.old.d2 > CHI2_95_2D);
  assert.ok(hind.new.along > 10 && hind.new.across > 10);
  // The old region from its covariance matches the post-mortem's frozen ellipse.
  const frozen = readPostmortem(json('trials/pluto/postmortem.json')).frozenRegion;
  assert.ok(Math.abs(hind.old.region.major - frozen.major) < 0.05 && Math.abs(hind.old.region.minor - frozen.minor) < 0.05);
});

test('95% ellipse axes come from the covariance eigenvalues', () => {
  const circle = ellipseOfCovariance([[4, 0], [0, 4]]);
  assert.ok(Math.abs(circle.major - 2 * Math.sqrt(CHI2_95_2D)) < 1e-9 && Math.abs(circle.minor - circle.major) < 1e-9);
  const tilted = ellipseOfCovariance([[5, 3], [3, 5]]);
  assert.ok(Math.abs(tilted.major - Math.sqrt(CHI2_95_2D * 8)) < 1e-9 && Math.abs(tilted.minor - Math.sqrt(CHI2_95_2D * 2)) < 1e-9);
  assert.equal(ellipseOfCovariance([[1, 2], [2, 1]]), null, 'not positive definite');
  assert.equal(ellipseOfCovariance([[1, 0.5], [0.4, 1]]), null, 'not symmetric');
});

test('v1 and v2 open forecasts line up side by side, v1 first, nothing counted', () => {
  const rows = forecastRows(['pluto-position-open-2027b-v2b', 'pluto-position-open-2027a', 'pluto-position-open-2027a-v2b', 'barnard-position-2026b'].map(bundle));
  assert.deepEqual(rows.map((row) => row.id), ['pluto-position-open-2027a', 'pluto-position-open-2027a-v2b', 'pluto-position-open-2027b-v2b']);
  assert.equal(rows[0].version, 1);
  assert.ok(rows[0].axes && rows[0].along === null, 'v1 has no along/across fields, so its ellipse axes are shown');
  assert.ok(rows.slice(1).every((row) => row.version === 2 && row.along > 0 && row.revises === 'pluto-position-open-2027a'));
});

test('correlated errors: N detections in G shared-error groups shrink only like 1/√G', () => {
  assert.ok(Math.abs(correlatedInflation(50, 6) - Math.sqrt(50 / 6)) < 1e-12);
  assert.equal(correlatedInflation(10, 10), 1);
  assert.equal(correlatedInflation(null, 6), null);
  for (const key of ['why.title', 'why.chip', 'why.found', 'why.off', 'why.causeCount', 'why.causeGroups', 'why.offsets', 'why.frame', 'lesson.sure.plutoTitle', 'lesson.sure.plutoCount', 'lesson.sure.plutoGroups']) {
    assert.ok(has(key), key);
  }
});
