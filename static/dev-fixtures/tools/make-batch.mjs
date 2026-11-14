// Writes an EXAMPLE asteroid batch for task B6 until Session A publishes A9:
//   dev-fixtures/batches/asteroids-example.json and dev-fixtures/trials/asteroid-NN-example/{trial,prediction,receipt,verification}.json
// Every name, position and number is invented, every file says "example": true. Never real data.
// Usage: node static/dev-fixtures/tools/make-batch.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clopperPearson, D2_LIMIT_95 } from '../../js/batch.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Writes a JSON file and returns the SHA-256 of its exact bytes (for the hash chain trial → prediction → receipt). */
const write = (path, doc) => {
  mkdirSync(dirname(join(ROOT, path)), { recursive: true });
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  writeFileSync(join(ROOT, path), text);
  return createHash('sha256').update(text).digest('hex');
};

// Invented outcomes: D (Mahalanobis distance of the model) and the straight-line error in arcsec. The model's
// error, residual and region are derived from D, so each card's plot agrees with its verdict.
const OUTCOMES = [
  [0.42, 6.1], [0.71, 9.8], [0.95, 0.6], [1.12, 15.5], [1.30, 3.1], [1.48, 11.0],
  [1.66, 7.7], [1.83, 1.9], [2.05, 19.4], [2.31, 8.3], [2.92, 12.6], [3.64, 3.1],
];
const ZERO_SHA = '0000000000000000000000000000000000000000';
const round = (value, digits = 4) => Number(value.toFixed(digits));
const DEG = Math.PI / 180;
const ids = [];
const rows = OUTCOMES.map(([d, baselineError], index) => {
  const n = String(index + 1).padStart(2, '0');
  const id = `asteroid-${n}-example`;
  const name = `Example asteroid ${n}`;
  ids.push(id);
  const ra = 30 + index * 11.5;
  const dec = -10 + index * 2.1;
  // Invented regions (arcsec²): an elongated forecast region and a small measurement error.
  const tilt = (index * 37) * DEG;
  const [long, short] = [1.4 + 0.15 * index, 0.6 + 0.05 * index];
  const cPred = [
    [round(long * Math.cos(tilt) ** 2 + short * Math.sin(tilt) ** 2), round((long - short) * Math.cos(tilt) * Math.sin(tilt))],
    [round((long - short) * Math.cos(tilt) * Math.sin(tilt)), round(long * Math.sin(tilt) ** 2 + short * Math.cos(tilt) ** 2)],
  ];
  const cObs = [[0.05, 0], [0, 0.05]];
  const s = [[cPred[0][0] + cObs[0][0], cPred[0][1]], [cPred[1][0], cPred[1][1] + cObs[1][1]]];
  // r = D · L · u with L the Cholesky factor of S, so rᵀ S⁻¹ r = D² exactly.
  const l11 = Math.sqrt(s[0][0]);
  const l21 = s[1][0] / l11;
  const l22 = Math.sqrt(s[1][1] - l21 * l21);
  const angle = index * 47 * DEG;
  const [u, v] = [Math.sin(angle), Math.cos(angle)];
  const east = round(d * l11 * u);
  const north = round(d * (l21 * u + l22 * v));
  const d2 = round(d * d);
  const modelError = round(Math.hypot(east, north));
  const status = d2 <= D2_LIMIT_95 ? 'hit' : 'miss';
  const observed = { ra_deg: round(ra + east / 3600 / Math.cos(dec * DEG), 8), dec_deg: round(dec + north / 3600, 8) };
  const baseline = { ra_deg: round(observed.ra_deg - baselineError / 3600 / Math.cos(dec * DEG), 8), dec_deg: observed.dec_deg };
  const cBase = [[0.3, 0], [0, 0.3]];
  const baseD2 = round(baselineError ** 2 / (cBase[0][0] + cObs[0][0]));
  const folder = `trials/${id}`;
  const trialSha = write(`${folder}/trial.json`, {
    schema_version: 'tenger.trial/1', example: true, trial_id: id, target_key: null, target_name: name, batch_id: 'asteroids-example',
    quantity: 'position', category: 'prospective_unexposed', labels: ['prospective_unexposed'], open_forecast: false, confirmation_pending: true,
    frozen_utc: '2026-11-15T03:00:00Z', holdout: { obs_ids: [`EXAMPLE_A${n}`], t_mjd: 61300 + index, selection_rule_key: 'holdout.next-visit', data_state: 'released' },
    scoring: { kind: 'position_2d', threshold_d2: D2_LIMIT_95 },
  });
  const predictionSha = write(`${folder}/prediction.json`, {
    schema_version: 'tenger.prediction/1', example: true, trial_id: id, trial_ref: { path: `${folder}/trial.json`, sha256: trialSha }, category: 'prospective_unexposed', prediction_status: 'predicted', t_mjd: 61300 + index,
    model: { ra_deg: ra, dec_deg: dec, cov_arcsec2: cPred, content_type: 'modeled' },
    baseline: { ...baseline, cov_arcsec2: cBase, content_type: 'modeled' },
  });
  write(`${folder}/receipt.json`, { schema_version: 'tenger.receipt/1', example: true, trial_id: id, prediction_path: `${folder}/prediction.json`, prediction_sha256: predictionSha, commit: ZERO_SHA, committed_utc: '2026-11-15T03:00:00Z' });
  write(`${folder}/verification.json`, {
    schema_version: 'tenger.verification/1', example: true, trial_id: id, prediction_sha256: predictionSha, revealed_utc: '2026-11-15T04:00:00Z', status, t_mjd: 61300 + index,
    observed: { ...observed, cov_arcsec2: cObs, content_type: 'measured' },
    residuals: {
      model: { c_pred_arcsec2: cPred, c_obs_arcsec2: cObs, east_arcsec: east, north_arcsec: north, d2, error_arcsec: modelError, status },
      baseline: { c_pred_arcsec2: cBase, c_obs_arcsec2: cObs, east_arcsec: baselineError, north_arcsec: 0, d2: baseD2, error_arcsec: baselineError, status: baseD2 <= D2_LIMIT_95 ? 'hit' : 'miss' },
    },
  });
  return { trial_id: id, name, d, d2, inside: d2 <= D2_LIMIT_95, model_error_arcsec: modelError, baseline_error_arcsec: baselineError, status, excluded_reason_key: null };
});
const k = rows.filter((row) => row.inside).length;
const n = rows.length;
write('batches/asteroids-example.json', {
  schema_version: 'tenger.batch/1',
  example: true,
  batch_id: 'asteroids-example',
  name: 'Example asteroid batch (invented)',
  category: 'prospective_unexposed',
  labels: ['prospective_unexposed'],
  team_statement_pending: true,
  frozen_utc: '2026-11-15T03:00:00Z',
  receipt: { commit_sha: ZERO_SHA, frozen_utc: '2026-11-15T03:00:00Z' },
  trial_ids: ids,
  calibration: { n, k_inside: k, level: 0.95, interval: clopperPearson(k, n, 0.95), interval_method: 'clopper_pearson', expected_inside: 0.95 * n, independence_note_key: 'batch.example.independence' },
  rows,
  note_keys: ['batch.example.note'],
});
console.log(`wrote an example batch: ${k} of ${n} inside`);
