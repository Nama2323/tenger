// Writes the example trials used by the Predictions page (task B4) before Session A publishes real ones.
// Every file it writes carries "example": true. Positions, covariances, dates, receipts and the images are
// invented: they are not measurements and not TENGER results. Field names follow DATA-CONTRACT V1 §6–10 and
// the V5 additions agreed with Session A (open_forecast, labels, confirmation_pending, holdout.data_state,
// holdout.check_after_utc, prediction_status, track, training.json, observed.image).
//
// Usage (from the repository root): node static/dev-fixtures/tools/make-trials.mjs
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { addCovariance, tangentOffsetArcsec } from '../../js/coords.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEG = Math.PI / 180;
const ARCSEC = 1 / 3600;
const THRESHOLD_D2 = 5.991464547107979;
const ZERO_SHA = '0'.repeat(64);
const ZERO_COMMIT = '0'.repeat(40);
const SCORING = {
  kind: 'position_2d_chi2',
  frame: 'tangent plane at predicted position, east/north arcsec',
  coverage: 0.95,
  threshold_d2: THRESHOLD_D2,
  covariance: 'S = C_pred + C_obs',
};

const text = (doc) => `${JSON.stringify(doc, null, 2)}\n`;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const round = (value, digits) => Number(value.toFixed(digits));

function write(path, doc) {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  const bytes = typeof doc === 'string' || Buffer.isBuffer(doc) ? doc : text(doc);
  writeFileSync(full, bytes);
  return sha(Buffer.from(bytes));
}

/** Inverse gnomonic projection: the sky position at (east, north) arcsec from (ra0, dec0). */
function fromOffset(ra0, dec0, east, north) {
  const x = east * ARCSEC * DEG;
  const y = north * ARCSEC * DEG;
  const d0 = dec0 * DEG;
  const rho = Math.hypot(x, y);
  if (rho === 0) return { ra_deg: ra0, dec_deg: dec0 };
  const c = Math.atan(rho);
  const dec = Math.asin(Math.cos(c) * Math.sin(d0) + (y * Math.sin(c) * Math.cos(d0)) / rho);
  const ra = ra0 * DEG + Math.atan2(x * Math.sin(c), rho * Math.cos(d0) * Math.cos(c) - y * Math.sin(d0) * Math.sin(c));
  return { ra_deg: round(((ra / DEG) + 360) % 360, 9), dec_deg: round(dec / DEG, 9) };
}

function d2Of(residual, cov) {
  const [[a, b], [c, d]] = cov;
  const det = a * d - b * c;
  const [e, n] = residual;
  return (d * e * e - (b + c) * e * n + a * n * n) / det;
}

/** Residual of an observed position against a predicted one, in the tangent plane at the prediction. */
function residual(predicted, observed) {
  const offset = tangentOffsetArcsec(predicted.ra_deg, predicted.dec_deg, observed.ra_deg, observed.dec_deg);
  const S = addCovariance(predicted.cov_arcsec2, observed.cov_arcsec2);
  return {
    east_arcsec: round(offset.east, 4),
    north_arcsec: round(offset.north, 4),
    d2: round(d2Of([offset.east, offset.north], S), 4),
    error_arcsec: round(Math.hypot(offset.east, offset.north), 4),
  };
}

/** Least-squares straight line through the training offsets, evaluated at t (the baseline). */
function straightLine(points, t) {
  const n = points.length;
  const mean = (list) => list.reduce((sum, value) => sum + value, 0) / n;
  const tm = mean(points.map((p) => p.t));
  const fit = (key) => {
    const vm = mean(points.map((p) => p[key]));
    const slope = points.reduce((sum, p) => sum + (p.t - tm) * (p[key] - vm), 0) / points.reduce((sum, p) => sum + (p.t - tm) ** 2, 0);
    return vm + slope * (t - tm);
  };
  return { east: fit('east'), north: fit('north') };
}

// ---------- A tiny PNG writer for the artificial evaluation images ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
  return Buffer.concat([head, data, crc]);
}
function png(width, height, grey) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    for (let x = 0; x < width; x += 1) raw[y * (width + 1) + 1 + x] = grey[y * width + x];
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Seeded random numbers so the artificial images are the same on every run. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * An artificial star field: north up, east left, pixel (0,0) top left. stars: [{east, north, flux}] in arcsec
 * from the image centre. Gaussian stars, sigma 0.75 px, plus a little noise. Not an observation.
 */
function starField({ size, scale, stars, seed }) {
  const next = random(seed);
  const grey = new Uint8Array(size * size);
  const sigma = 0.75;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let value = 14 + next() * 10;
      for (const star of stars) {
        const sx = (size - 1) / 2 - star.east / scale;
        const sy = (size - 1) / 2 - star.north / scale;
        value += star.flux * Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) / (2 * sigma ** 2));
      }
      grey[y * size + x] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
  return png(size, size, grey);
}

// ---------- Shared builders ----------

function exampleReceipt(id, predictionSha, utc) {
  return {
    schema_version: 'tenger.receipt/1',
    example: true,
    trial_id: id,
    prediction_path: `trials/${id}/prediction.json`,
    prediction_sha256: predictionSha,
    commit: ZERO_COMMIT,
    committed_utc: utc,
    pushed: { remote: 'origin', branch: 'tenger-dev', utc: null },
  };
}

function trialDoc(spec, trainingSha) {
  return {
    schema_version: 'tenger.trial/1',
    example: true,
    contract_version: 5,
    trial_id: spec.id,
    target_key: spec.target,
    quantity: 'position',
    category: spec.category,
    labels: spec.labels,
    open_forecast: spec.openForecast ?? false,
    confirmation_pending: spec.confirmationPending ?? false,
    frozen_utc: spec.frozen,
    exposure: { status: spec.exposure, inventory_ref: null, team_statement: null, notes: 'example fixture' },
    training: { obs_keys: spec.trainingKeys, measurements_sha256: trainingSha ?? ZERO_SHA },
    holdout: {
      obs_ids: spec.holdoutIds,
      t_mjd: spec.t,
      selection_rule_key: 'holdout.next-visit',
      data_state: spec.dataState,
      check_after_utc: spec.checkAfter ?? null,
    },
    permitted_inputs: spec.permitted,
    model: { id: 'example-model', version: '0.0.0-example', code_sha256: ZERO_SHA },
    baseline: { id: 'linear-no-parallax' },
    scoring: SCORING,
    exclusion_rules_keys: [],
    exploratory: false,
    revises: null,
  };
}

/** A position trial with a training track; writes trial, training, prediction, receipt and (optionally) verification. */
function positionTrial(spec) {
  const folder = `trials/${spec.id}`;
  const centre = spec.centre;
  const training = spec.training.map((point) => ({ t: point.t, east: point.east, north: point.north }));
  const trainingDoc = {
    schema_version: 'tenger.training/1',
    example: true,
    trial_id: spec.id,
    points: spec.training.map((point, index) => ({
      t_mjd: point.t,
      ...fromOffset(centre.ra, centre.dec, point.east, point.north),
      cov_arcsec2: point.cov,
      obs_keys: [spec.trainingKeys[index]],
      content_type: 'measured',
    })),
  };
  const trainingSha = write(`${folder}/training.json`, trainingDoc);
  const trialSha = write(`${folder}/trial.json`, trialDoc(spec, trainingSha));
  const line = straightLine(training, spec.t);
  const model = { ...fromOffset(centre.ra, centre.dec, 0, 0), cov_arcsec2: spec.modelCov, content_type: 'modeled' };
  const baseline = { ...fromOffset(centre.ra, centre.dec, line.east, line.north), cov_arcsec2: spec.baselineCov, content_type: 'modeled' };
  const prediction = {
    schema_version: 'tenger.prediction/1',
    example: true,
    contract_version: 5,
    trial_id: spec.id,
    trial_ref: { path: `${folder}/trial.json`, sha256: trialSha },
    category: spec.category,
    created_utc: spec.created,
    prediction_status: 'predicted',
    status_reason_key: null,
    t_mjd: spec.t,
    model,
    baseline,
    track: spec.track ? spec.track.map((point) => ({
      t_mjd: point.t,
      ...fromOffset(centre.ra, centre.dec, point.east, point.north),
      cov_arcsec2: point.cov,
    })) : null,
    limitation_keys: spec.limitations,
  };
  const predictionSha = write(`${folder}/prediction.json`, prediction);
  write(`${folder}/receipt.json`, exampleReceipt(spec.id, predictionSha, spec.committed));
  if (!spec.observed) return { prediction, predictionSha };

  const observed = {
    ...fromOffset(centre.ra, centre.dec, spec.observed.east, spec.observed.north),
    cov_arcsec2: spec.observed.cov,
    obs_keys: spec.holdoutIds.map((id) => `spherex_qr3:${id}:D3`),
    content_type: 'measured',
    image: null,
  };
  if (spec.image) {
    const imageCentre = fromOffset(centre.ra, centre.dec, spec.image.east, spec.image.north);
    const stars = [
      { east: spec.observed.east - spec.image.east, north: spec.observed.north - spec.image.north, flux: 210 },
      ...spec.image.field,
    ];
    write(`${folder}/evaluation-artificial.png`, starField({ size: spec.image.size, scale: spec.image.scale, stars, seed: spec.image.seed }));
    observed.image = {
      path: `${folder}/evaluation-artificial.png`,
      content_type: 'artificial',
      epoch_id: null,
      centre_ra_deg: imageCentre.ra_deg,
      centre_dec_deg: imageCentre.dec_deg,
      scale_arcsec_px: spec.image.scale,
      width_px: spec.image.size,
      height_px: spec.image.size,
      north_up: true,
      east_left: true,
    };
  }
  const residuals = { model: residual(model, observed), baseline: residual(baseline, observed) };
  const status = residuals.model.d2 <= THRESHOLD_D2 ? 'hit' : 'miss';
  const verification = {
    schema_version: 'tenger.verification/1',
    example: true,
    contract_version: 5,
    trial_id: spec.id,
    prediction_sha256: predictionSha,
    revealed_utc: spec.revealed,
    observed,
    identification: { method_key: 'ident.preregistered-aperture', alternatives: 0, ambiguous: false },
    residuals,
    status,
    status_reason_key: null,
  };
  write(`${folder}/verification.json`, verification);
  return { prediction, predictionSha, verification };
}

// ---------- The example trials ----------

/** Epsilon Indi B: retrospective, the frozen model misses (the straight line misses too). */
const epsindib = positionTrial({
  id: 'epsindib-position-example',
  target: 'epsindib',
  category: 'retrospective_holdout',
  labels: ['retrospective_holdout', 'catalogue_assisted'],
  exposure: 'exposed',
  centre: { ra: 330.871, dec: -56.798 },
  t: 61292.0,
  frozen: '2026-11-14T15:00:00Z',
  created: '2026-11-14T15:05:00Z',
  committed: '2026-11-14T15:06:00Z',
  revealed: '2026-11-14T15:30:00Z',
  dataState: 'released',
  holdoutIds: ['EXAMPLE_E5_1'],
  trainingKeys: ['spherex_dr1:EXAMPLE_E1_1:D3', 'spherex_dr1:EXAMPLE_E2_1:D3', 'spherex_qr3:EXAMPLE_E3_1:D3', 'spherex_qr3:EXAMPLE_E4_1:D3'],
  training: [
    { t: 60805.0, east: -5.45, north: 3.15, cov: [[0.3, 0], [0, 0.3]] },
    { t: 60985.0, east: -3.25, north: 2.25, cov: [[0.3, 0], [0, 0.3]] },
    { t: 61170.0, east: -1.55, north: 0.55, cov: [[0.3, 0], [0, 0.3]] },
    { t: 61230.0, east: -0.45, north: 0.65, cov: [[0.3, 0], [0, 0.3]] },
  ],
  modelCov: [[0.36, 0.05], [0.05, 0.49]],
  baselineCov: [[0.81, 0], [0, 0.81]],
  observed: { east: 2.55, north: -2.05, cov: [[0.64, 0], [0, 0.64]] },
  image: {
    size: 48, scale: 6.2, east: 9.3, north: -12.4, seed: 7,
    field: [
      { east: 81, north: 63, flux: 120 }, { east: -96, north: -40, flux: 70 }, { east: 30, north: -110, flux: 160 },
      { east: -61, north: 102, flux: 55 }, { east: 118, north: -88, flux: 90 }, { east: -12, north: 52, flux: 40 },
    ],
  },
  permitted: [{ name: 'Gaia DR3 parallax (example)', content_type: 'catalogue', used_for: 'prior' }],
  limitations: ['limit.blended-binary', 'limit.parallax-from-catalogue', 'limit.example'],
});

/** Pluto: catalogue-assisted, frozen and waiting (the reserved visit stays closed). */
positionTrial({
  id: 'pluto-position-example',
  target: 'pluto',
  category: 'catalogue_assisted',
  labels: ['catalogue_assisted'],
  confirmationPending: true,
  exposure: 'unexposed',
  centre: { ra: 306.0952, dec: -23.7196 },
  t: 61314.1,
  frozen: '2026-11-14T15:10:00Z',
  created: '2026-11-14T15:12:00Z',
  committed: '2026-11-14T15:13:00Z',
  dataState: 'released',
  holdoutIds: ['EXAMPLE_P9_1', 'EXAMPLE_P9_2'],
  trainingKeys: ['spherex_dr1:EXAMPLE_P1_1:D2', 'spherex_dr1:EXAMPLE_P2_1:D2', 'spherex_qr3:EXAMPLE_P3_1:D2'],
  training: [
    { t: 60950.0, east: 610.0, north: 95.0, cov: [[1.2, 0], [0, 1.2]] },
    { t: 61130.0, east: 290.0, north: 30.0, cov: [[1.2, 0], [0, 1.2]] },
    { t: 61290.0, east: 25.0, north: 6.0, cov: [[1.2, 0], [0, 1.2]] },
  ],
  modelCov: [[1.44, 0.2], [0.2, 1.0]],
  baselineCov: [[16, 0], [0, 16]],
  permitted: [{ name: 'JPL Horizons ephemeris (example)', content_type: 'catalogue', used_for: 'prior' }],
  limitations: ['limit.ephemeris-guided', 'limit.example'],
});

/** Pluto: an open forecast for a future visit, with a track over the expected window. */
positionTrial({
  id: 'pluto-position-forecast-example',
  target: 'pluto',
  category: 'catalogue_assisted',
  labels: ['catalogue_assisted'],
  openForecast: true,
  exposure: 'unexposed',
  centre: { ra: 307.402, dec: -23.41 },
  t: 61516.5,
  frozen: '2026-11-14T15:20:00Z',
  created: '2026-11-14T15:22:00Z',
  committed: '2026-11-14T15:23:00Z',
  dataState: 'not_released',
  checkAfter: '2027-10-01T00:00:00Z',
  holdoutIds: [],
  trainingKeys: ['spherex_dr1:EXAMPLE_P1_1:D2', 'spherex_dr1:EXAMPLE_P2_1:D2', 'spherex_qr3:EXAMPLE_P3_1:D2'],
  training: [
    { t: 60950.0, east: -4350.0, north: -1185.0, cov: [[1.2, 0], [0, 1.2]] },
    { t: 61130.0, east: -3020.0, north: -820.0, cov: [[1.2, 0], [0, 1.2]] },
    { t: 61290.0, east: -1240.0, north: -330.0, cov: [[1.2, 0], [0, 1.2]] },
  ],
  modelCov: [[2.25, 0.3], [0.3, 1.69]],
  baselineCov: [[64, 0], [0, 64]],
  track: [
    { t: 61515.0, east: 31.0, north: 4.4, cov: [[2.25, 0.3], [0.3, 1.69]] },
    { t: 61516.0, east: 10.3, north: 1.5, cov: [[2.25, 0.3], [0.3, 1.69]] },
    { t: 61517.0, east: -10.4, north: -1.4, cov: [[2.3, 0.3], [0.3, 1.72]] },
    { t: 61518.0, east: -31.1, north: -4.3, cov: [[2.36, 0.31], [0.31, 1.76]] },
  ],
  permitted: [{ name: 'JPL Horizons ephemeris (example)', content_type: 'catalogue', used_for: 'prior' }],
  limitations: ['limit.ephemeris-guided', 'limit.example'],
});

/** Makemake: an open forecast for one reference time (no track). */
positionTrial({
  id: 'makemake-position-forecast-example',
  target: 'makemake',
  category: 'catalogue_assisted',
  labels: ['catalogue_assisted'],
  openForecast: true,
  exposure: 'unexposed',
  centre: { ra: 202.164, dec: 21.18 },
  t: 61530.0,
  frozen: '2026-11-14T15:25:00Z',
  created: '2026-11-14T15:26:00Z',
  committed: '2026-11-14T15:27:00Z',
  dataState: 'not_released',
  checkAfter: null,
  holdoutIds: [],
  trainingKeys: ['spherex_dr1:EXAMPLE_M1_1:D4', 'spherex_qr3:EXAMPLE_M2_1:D4', 'spherex_qr3:EXAMPLE_M3_1:D4'],
  training: [
    { t: 60860.0, east: 1640.0, north: -520.0, cov: [[2.5, 0], [0, 2.5]] },
    { t: 61040.0, east: 1010.0, north: -330.0, cov: [[2.5, 0], [0, 2.5]] },
    { t: 61230.0, east: 520.0, north: -150.0, cov: [[2.5, 0], [0, 2.5]] },
  ],
  modelCov: [[4.0, 0.5], [0.5, 2.25]],
  baselineCov: [[100, 0], [0, 100]],
  permitted: [{ name: 'JPL Horizons ephemeris (example)', content_type: 'catalogue', used_for: 'prior' }],
  limitations: ['limit.ephemeris-guided', 'limit.example'],
});

/** WISE 0855: no defensible prediction at freeze (V5 prediction_status). Counts as insufficient data. */
{
  const id = 'wise0855-position-example';
  const folder = `trials/${id}`;
  const spec = {
    id, target: 'wise0855', category: 'retrospective_holdout', labels: ['retrospective_holdout'], exposure: 'exposed',
    frozen: '2026-11-14T15:40:00Z', t: 61290.0, dataState: 'released', holdoutIds: ['EXAMPLE_W5_1'],
    trainingKeys: ['spherex_dr1:EXAMPLE_W1_1:D6', 'spherex_qr3:EXAMPLE_W2_1:D6'], permitted: [],
  };
  const trialSha = write(`${folder}/trial.json`, trialDoc(spec, null));
  const predictionSha = write(`${folder}/prediction.json`, {
    schema_version: 'tenger.prediction/1',
    example: true,
    contract_version: 5,
    trial_id: id,
    trial_ref: { path: `${folder}/trial.json`, sha256: trialSha },
    category: spec.category,
    created_utc: '2026-11-14T15:41:00Z',
    prediction_status: 'insufficient_data',
    status_reason_key: 'measure.contaminated',
    t_mjd: spec.t,
    model: null,
    baseline: null,
    track: null,
    limitation_keys: ['limit.example'],
  });
  write(`${folder}/receipt.json`, exampleReceipt(id, predictionSha, '2026-11-14T15:42:00Z'));
}

/** Barnard (written by B1/B2, hash chain unchanged): add its training track and an artificial evaluation image. */
{
  const folder = 'trials/barnard-position-example';
  const prediction = JSON.parse(readFileSync(join(ROOT, folder, 'prediction.json'), 'utf8'));
  const model = prediction.model;
  const baselineOffset = tangentOffsetArcsec(model.ra_deg, model.dec_deg, prediction.baseline.ra_deg, prediction.baseline.dec_deg);
  // Three training visits on the straight line that ends at the frozen baseline, with wiggles that do not move
  // the least-squares line (orthogonal to 1 and t), so the drawn baseline is the line through the drawn points.
  const times = [60916.0, 61119.0, 61275.0];
  const velocity = { east: -0.8 / 365.25, north: 10.36 / 365.25 };
  const tMean = times.reduce((sum, t) => sum + t, 0) / times.length;
  const centred = times.map((t) => t - tMean);
  const sumSq = centred.reduce((sum, value) => sum + value * value, 0);
  // Component of (1, -2, 1) orthogonal to the centred times (it is already orthogonal to the constant).
  const raw = [1, -2, 1];
  const along = raw.reduce((sum, value, index) => sum + value * centred[index], 0) / sumSq;
  const wiggle = raw.map((value, index) => value - along * centred[index]);
  const points = times.map((t, index) => ({
    t_mjd: t,
    ...fromOffset(model.ra_deg, model.dec_deg,
      baselineOffset.east + velocity.east * (t - prediction.t_mjd) + 0.12 * wiggle[index],
      baselineOffset.north + velocity.north * (t - prediction.t_mjd) - 0.18 * wiggle[index]),
    cov_arcsec2: [[0.09, 0], [0, 0.09]],
    obs_keys: [`spherex_qr3:EXAMPLE_B${index + 1}_1:D3`],
    content_type: 'measured',
  }));
  write(`${folder}/training.json`, { schema_version: 'tenger.training/1', example: true, trial_id: 'barnard-position-example', points });
  const verificationPath = `${folder}/verification.json`;
  const verification = JSON.parse(readFileSync(join(ROOT, verificationPath), 'utf8'));
  const imageCentre = fromOffset(model.ra_deg, model.dec_deg, -7.0, 11.5);
  const observedOffset = tangentOffsetArcsec(model.ra_deg, model.dec_deg, verification.observed.ra_deg, verification.observed.dec_deg);
  write(`${folder}/evaluation-artificial.png`, starField({
    size: 48,
    scale: 6.2,
    seed: 3,
    stars: [
      { east: observedOffset.east + 7.0, north: observedOffset.north - 11.5, flux: 230 },
      { east: -70, north: 88, flux: 140 }, { east: 104, north: 20, flux: 80 }, { east: -40, north: -115, flux: 110 },
      { east: 55, north: -60, flux: 45 }, { east: -118, north: -20, flux: 65 }, { east: 20, north: 120, flux: 50 },
    ],
  }));
  verification.observed.image = {
    path: `${folder}/evaluation-artificial.png`,
    content_type: 'artificial',
    epoch_id: null,
    centre_ra_deg: imageCentre.ra_deg,
    centre_dec_deg: imageCentre.dec_deg,
    scale_arcsec_px: 6.2,
    width_px: 48,
    height_px: 48,
    north_up: true,
    east_left: true,
  };
  write(verificationPath, verification);
}

// ---------- Scoreboard (derived from every example trial, as Session A's verify.py would) ----------

{
  const ids = [
    'barnard-position-example', 'epsindib-position-example', 'wise0855-position-example', 'rdra-brightness-example',
    'makemake-position-example', 'pluto-position-example', 'rwaur-brightness-example',
    'pluto-position-forecast-example', 'makemake-position-forecast-example',
  ];
  const read = (path) => {
    try {
      return { bytes: readFileSync(join(ROOT, path)), doc: JSON.parse(readFileSync(join(ROOT, path), 'utf8')) };
    } catch {
      return null;
    }
  };
  const counts = {};
  const rows = [];
  const openForecasts = [];
  const derived = [];
  for (const id of ids) {
    const trial = read(`trials/${id}/trial.json`).doc;
    const prediction = read(`trials/${id}/prediction.json`)?.doc;
    const verification = read(`trials/${id}/verification.json`);
    for (const name of ['trial', 'prediction', 'receipt', 'verification']) {
      const file = read(`trials/${id}/${name}.json`);
      if (file) derived.push({ path: `trials/${id}/${name}.json`, sha256: sha(file.bytes) });
    }
    if (trial.open_forecast === true) {
      openForecasts.push(id);
      continue;
    }
    let status = 'waiting';
    if (verification) status = verification.doc.status;
    else if (prediction?.prediction_status === 'insufficient_data') status = 'insufficient_data';
    const category = trial.category;
    counts[category] ??= { waiting: 0, hit: 0, miss: 0, insufficient_data: 0, ambiguous: 0, invalid_comparison: 0 };
    counts[category][status] += 1;
    const row = {
      trial_id: id, target_key: trial.target_key, quantity: trial.quantity, category, labels: trial.labels ?? [category],
      status, exploratory: trial.exploratory === true,
      counts_as_prospective: category === 'prospective_unexposed' && trial.exploratory !== true && (status === 'hit' || status === 'miss'),
    };
    if (verification && trial.quantity === 'position') {
      row.model_error_arcsec = verification.doc.residuals.model.error_arcsec;
      row.baseline_error_arcsec = verification.doc.residuals.baseline.error_arcsec;
    }
    rows.push(row);
  }
  const ORDER = ['prospective_unexposed', 'retrospective_holdout', 'catalogue_assisted', 'illustrative'];
  write('scoreboard.json', {
    schema_version: 'tenger.scoreboard/1',
    example: true,
    contract_version: 5,
    generated_utc: '2026-11-14T15:45:00Z',
    derived_from: derived,
    counts: Object.fromEntries(ORDER.filter((category) => counts[category]).map((category) => [category, counts[category]])),
    see_only: ['3i-atlas'],
    open_forecasts: openForecasts,
    rows,
  });
}

// ---------- Index: list every example trial ----------

{
  const index = JSON.parse(readFileSync(join(ROOT, 'index.json'), 'utf8'));
  const trialIds = {
    barnard: ['barnard-position-example'],
    wise0855: ['wise0855-position-example'],
    epsindib: ['epsindib-position-example'],
    rwaur: ['rwaur-brightness-example'],
    rdra: ['rdra-brightness-example'],
    makemake: ['makemake-position-example', 'makemake-position-forecast-example'],
    pluto: ['pluto-position-example', 'pluto-position-forecast-example'],
  };
  const statusOf = { barnard: 'hit', wise0855: 'insufficient_data', epsindib: 'miss', rwaur: 'waiting', rdra: 'hit', makemake: 'hit', pluto: 'waiting' };
  for (const target of index.targets) {
    if (!trialIds[target.key]) continue;
    target.prediction = { status: statusOf[target.key], trial_ids: trialIds[target.key] };
  }
  index.trials = Object.values(trialIds).flat().map((id) => `trials/${id}/trial.json`);
  write('index.json', index);
}

console.log('example trials written to', ROOT);
