// The prediction ledger (Predictions page): pure functions that turn the trial files Session A publishes
// (DATA-CONTRACT V1 §6–10 plus V5) into what the page shows. No DOM. Nothing here computes a success rate:
// statuses, residuals and counts come from the files; the page only re-projects positions for drawing and
// checks that the drawn positions agree with the recorded residual.
import { addCovariance, covarianceEllipse, tangentOffsetArcsec } from './coords.js';
import { isKey } from './contract.js';
import { formatNumber } from './dom.js';

export const CATEGORIES = ['prospective_unexposed', 'retrospective_holdout', 'catalogue_assisted', 'illustrative'];
/** Scoreboard columns, in the order of the contract enum (see_only is a separate list, never a count). */
export const COUNT_STATUSES = ['waiting', 'hit', 'miss', 'insufficient_data', 'ambiguous', 'invalid_comparison'];
/** Card order: checked trials first, then frozen predictions still waiting, then trials without a usable prediction or check. */
const STATUS_ORDER = ['hit', 'miss', 'ambiguous', 'invalid_comparison', 'waiting', 'insufficient_data'];
export const COMMIT_URL = 'https://github.com/Nama2323/tenger/commit/';
export const SHORT_SHA = 7;
const SHA = /^[0-9a-f]{7,40}$/;
const RESIDUAL_TOLERANCE_ARCSEC = 0.02;
const RESIDUAL_TOLERANCE_FRACTION = 0.02;
/** The focus view is the drawn elements plus this margin on each side, and never narrower than MIN_FOCUS. */
const FOCUS_MARGIN = 0.22;
const MIN_FOCUS_ARCSEC = 4;

const okDoc = (result) => (result?.state === 'ok' ? result.doc : null);
const finite = (...values) => values.every(Number.isFinite);
const isPoint = (point) => finite(point?.ra_deg, point?.dec_deg);
const isCov = (cov) => Array.isArray(cov) && cov.length === 2 && cov.every((row) => Array.isArray(row) && row.length === 2 && row.every(Number.isFinite));

/** The trial id in an index path "trials/<id>/trial.json", or null. */
export function trialIdFromPath(path) {
  const match = /^trials\/([^/]+)\/trial\.json$/.exec(String(path ?? ''));
  return match && isKey(match[1]) ? match[1] : null;
}

/** Real files are used as soon as the real index lists a trial or a scoreboard; until then, the page shows fixtures. */
export function hasPublishedTrials(indexResult) {
  const doc = okDoc(indexResult);
  if (!doc || doc.example === true) return false;
  return (Array.isArray(doc.trials) && doc.trials.length > 0) || Boolean(doc.scoreboard_path);
}

/** Every trial id listed in the index or the scoreboard, once, in that order. */
export function ledgerTrialIds(index, scoreboard) {
  const ids = [
    ...(Array.isArray(index?.trials) ? index.trials.map(trialIdFromPath) : []),
    ...(Array.isArray(scoreboard?.rows) ? scoreboard.rows.map((row) => row?.trial_id) : []),
    ...(Array.isArray(scoreboard?.open_forecasts) ? scoreboard.open_forecasts : []),
  ];
  return [...new Set(ids.filter(isKey))];
}

/** An open forecast (a future visit IRSA has not released) only when a file says so (V5): never inferred from dates. */
export function isOpenForecast(bundle, scoreboard = null) {
  const trial = okDoc(bundle?.trial);
  if (trial?.open_forecast === true || trial?.holdout?.data_state === 'not_released') return true;
  return Array.isArray(scoreboard?.open_forecasts) && scoreboard.open_forecasts.includes(bundle?.id);
}

/** Category first, then every other label the trial file lists (V5 labels), each once and only known ones. */
export function trialLabels(trial, prediction = null) {
  const category = trial?.category ?? prediction?.category ?? null;
  const labels = Array.isArray(trial?.labels) ? trial.labels : [];
  return [...new Set([category, ...labels].filter((label) => CATEGORIES.includes(label)))];
}

/**
 * The status a card shows, from the files in this order: verification.json, then a prediction that could not be
 * made (V5 prediction_status), then a frozen prediction (waiting). The scoreboard row is only compared.
 * Returns { status, reasonKey, source, conflict }; status is null when no prediction is published yet.
 */
export function trialStatus(bundle, row = null) {
  const verification = okDoc(bundle?.verification);
  const prediction = okDoc(bundle?.prediction);
  let result = { status: null, reasonKey: null, source: null };
  if (verification?.status) {
    result = { status: verification.status, reasonKey: verification.status_reason_key ?? null, source: 'verification' };
  } else if (prediction?.prediction_status === 'insufficient_data') {
    result = { status: 'insufficient_data', reasonKey: prediction.status_reason_key ?? null, source: 'prediction' };
  } else if (prediction) {
    result = { status: 'waiting', reasonKey: null, source: 'prediction' };
  }
  const conflict = Boolean(row?.status && result.status && row.status !== result.status);
  return { ...result, conflict };
}

/** The freeze receipt as "frozen in git <short sha> on <utc>". The link is only for a real, non-example commit. */
export function commitInfo(receiptResult) {
  const doc = okDoc(receiptResult);
  if (!doc) return null;
  const sha = String(doc.commit ?? '').toLowerCase();
  const valid = SHA.test(sha) && /[1-9a-f]/.test(sha);
  return {
    short: valid ? sha.slice(0, SHORT_SHA) : null,
    url: valid && doc.example !== true ? `${COMMIT_URL}${sha}` : null,
    utc: typeof doc.committed_utc === 'string' ? doc.committed_utc : null,
    example: doc.example === true,
    predictionSha: typeof doc.prediction_sha256 === 'string' ? doc.prediction_sha256 : null,
    pushedUtc: doc.pushed?.utc ?? null,
  };
}

/** What was predicted: a position (with an optional track over a window), a value, or nothing. */
export function predictedOf(prediction, trial = null) {
  if (!prediction) return { kind: 'none', tMjd: Number.isFinite(trial?.holdout?.t_mjd) ? trial.holdout.t_mjd : null };
  const tMjd = Number.isFinite(prediction.t_mjd) ? prediction.t_mjd : (Number.isFinite(trial?.holdout?.t_mjd) ? trial.holdout.t_mjd : null);
  const track = Array.isArray(prediction.track) ? prediction.track.filter((point) => isPoint(point) && Number.isFinite(point.t_mjd)) : [];
  if (isPoint(prediction.model)) return { kind: 'position', tMjd, model: prediction.model, baseline: isPoint(prediction.baseline) ? prediction.baseline : null, track };
  if (Number.isFinite(prediction.model?.value)) return { kind: 'value', tMjd, model: prediction.model, baseline: Number.isFinite(prediction.baseline?.value) ? prediction.baseline : null, track: [] };
  return { kind: 'none', tMjd, track };
}

/** Scoreboard counts exactly as written: only categories and statuses present in the file. No totals, no rates. */
export function scoreboardTable(doc) {
  if (!doc?.counts || typeof doc.counts !== 'object') return null;
  const categories = [...CATEGORIES.filter((category) => category in doc.counts), ...Object.keys(doc.counts).filter((category) => !CATEGORIES.includes(category))];
  const present = new Set(categories.flatMap((category) => Object.keys(doc.counts[category] ?? {})));
  const statuses = [...COUNT_STATUSES.filter((status) => present.has(status)), ...[...present].filter((status) => !COUNT_STATUSES.includes(status))];
  return {
    statuses,
    rows: categories.map((category) => ({
      category,
      cells: statuses.map((status) => (Number.isInteger(doc.counts[category]?.[status]) ? doc.counts[category][status] : null)),
    })),
    seeOnly: Array.isArray(doc.see_only) ? doc.see_only.filter((key) => typeof key === 'string') : [],
    openForecasts: Array.isArray(doc.open_forecasts) ? doc.open_forecasts.filter(isKey) : null,
    example: doc.example === true,
    generatedUtc: doc.generated_utc ?? null,
  };
}

/** Cards sorted by status (checked, then waiting, then insufficient data); stable within a status. */
export function sortByStatus(cards) {
  const rank = (card) => {
    const index = STATUS_ORDER.indexOf(card.status?.status);
    return index < 0 ? STATUS_ORDER.length : index;
  };
  return cards.map((card, index) => ({ card, index })).sort((a, b) => rank(a.card) - rank(b.card) || a.index - b.index).map(({ card }) => card);
}

// ---------- The reveal: everything in the scoring frame (tangent plane at the frozen model position) ----------

function d2Of(residual, cov) {
  const [[a, b], [c, d]] = cov;
  const det = a * d - b * c;
  if (!(det > 0)) return null;
  const [e, n] = residual;
  return (d * e * e - (b + c) * e * n + a * n * n) / det;
}

/**
 * Does the recorded residual match the drawn positions? The page draws observed minus model in the same frame
 * and recomputes d² with S = C_pred + C_obs; a disagreement is shown, never silently corrected.
 */
export function residualCheck(observedOffset, recorded, predictedCov, observedCov) {
  if (!observedOffset || !finite(recorded?.east_arcsec, recorded?.north_arcsec)) return { checked: false, ok: true };
  const tolerance = (value) => Math.max(RESIDUAL_TOLERANCE_ARCSEC, Math.abs(value) * RESIDUAL_TOLERANCE_FRACTION);
  let ok = Math.abs(observedOffset.east - recorded.east_arcsec) <= tolerance(recorded.east_arcsec)
    && Math.abs(observedOffset.north - recorded.north_arcsec) <= tolerance(recorded.north_arcsec);
  let d2 = null;
  if (isCov(predictedCov) && isCov(observedCov)) {
    d2 = d2Of([observedOffset.east, observedOffset.north], addCovariance(predictedCov, observedCov));
    if (Number.isFinite(recorded.d2) && Number.isFinite(d2)) ok = ok && Math.abs(d2 - recorded.d2) <= Math.max(0.02, recorded.d2 * RESIDUAL_TOLERANCE_FRACTION);
  }
  return { checked: true, ok, d2 };
}

/** Where an evaluation image sits in the frame. Only north-up, east-left images with a pixel scale are placed. */
export function imagePlacement(image, origin) {
  if (!image || typeof image.path !== 'string') return { image: null, reason: 'none' };
  if (!finite(image.centre_ra_deg, image.centre_dec_deg, image.scale_arcsec_px, image.width_px, image.height_px)
    || !(image.scale_arcsec_px > 0 && image.width_px > 0 && image.height_px > 0)) return { image: null, reason: 'geometry' };
  if (image.north_up !== true || image.east_left !== true) return { image: null, reason: 'orientation' };
  const centre = tangentOffsetArcsec(origin.ra_deg, origin.dec_deg, image.centre_ra_deg, image.centre_dec_deg);
  const halfWidth = (image.width_px * image.scale_arcsec_px) / 2;
  const halfHeight = (image.height_px * image.scale_arcsec_px) / 2;
  return {
    image: {
      path: image.path,
      contentType: image.content_type ?? null,
      epochId: image.epoch_id ?? null,
      scale: image.scale_arcsec_px,
      centre,
      east: [centre.east - halfWidth, centre.east + halfWidth],
      north: [centre.north - halfHeight, centre.north + halfHeight],
    },
    reason: null,
  };
}

/** Square view { east, north, span } around a set of (east, north) extents. */
function squareAround(extents, margin, minimum) {
  const easts = extents.map((point) => point.east);
  const norths = extents.map((point) => point.north);
  const east = [Math.min(...easts), Math.max(...easts)];
  const north = [Math.min(...norths), Math.max(...norths)];
  const raw = Math.max(east[1] - east[0], north[1] - north[0]);
  const span = Math.max(raw * (1 + 2 * margin), minimum);
  return { east: (east[0] + east[1]) / 2, north: (north[0] + north[1]) / 2, span };
}

/** The four corners of an ellipse's bounding box (axis-aligned), for view fitting. */
function ellipseExtents(centre, ellipse) {
  if (!ellipse) return [];
  const angle = (ellipse.angleDeg * Math.PI) / 180;
  const halfEast = Math.hypot(ellipse.major * Math.cos(angle), ellipse.minor * Math.sin(angle));
  const halfNorth = Math.hypot(ellipse.major * Math.sin(angle), ellipse.minor * Math.cos(angle));
  return [
    { east: centre.east - halfEast, north: centre.north - halfNorth },
    { east: centre.east + halfEast, north: centre.north + halfNorth },
  ];
}

/**
 * Everything the reveal draws for a verified position trial, in arcsec east and north of the frozen model
 * position (the contract's scoring frame). Returns null when the trial cannot be revealed (not a position
 * trial, no frozen model position, or not verified).
 *
 * The verdict compares a mean residual with the frozen model evaluated at the mean evaluation time and from the
 * real observer (Session A, A5). When verification.json gives that position as residuals.<who>.reference (and
 * the covariance used as c_pred_arcsec2), the picture is drawn around it, so the drawn offsets are the scored
 * ones; the shift from prediction.json's headline position is reported, never hidden.
 */
export function revealModel(bundle, trainingResult = null) {
  const trial = okDoc(bundle?.trial);
  const prediction = okDoc(bundle?.prediction);
  const verification = okDoc(bundle?.verification);
  if (!trial || !prediction || !verification || trial.quantity !== 'position' || !isPoint(prediction.model)) return null;
  const residuals = verification.residuals ?? {};
  const reference = isPoint(residuals.model?.reference) ? residuals.model.reference : null;
  const origin = reference ?? prediction.model;
  const offset = (point) => tangentOffsetArcsec(origin.ra_deg, origin.dec_deg, point.ra_deg, point.dec_deg);
  const threshold = Number.isFinite(trial.scoring?.threshold_d2) ? trial.scoring.threshold_d2 : null;
  const covOf = (residual, point) => (isCov(residual?.c_pred_arcsec2) ? residual.c_pred_arcsec2 : isCov(point?.cov_arcsec2) ? point.cov_arcsec2 : null);
  const modelCov = covOf(residuals.model, prediction.model);
  const model = { east: 0, north: 0, cov: modelCov };
  const headline = reference ? offset(prediction.model) : null;
  const baselinePoint = isPoint(residuals.baseline?.reference) ? residuals.baseline.reference : (isPoint(prediction.baseline) ? prediction.baseline : null);
  const baseline = baselinePoint ? { ...offset(baselinePoint), cov: covOf(residuals.baseline, prediction.baseline) } : null;
  const observedDoc = verification.observed;
  const observed = isPoint(observedDoc) ? { ...offset(observedDoc), cov: isCov(observedDoc.cov_arcsec2) ? observedDoc.cov_arcsec2 : null } : null;
  const trainingDoc = okDoc(trainingResult);
  const training = (Array.isArray(trainingDoc?.points) ? trainingDoc.points : [])
    .filter((point) => isPoint(point) && Number.isFinite(point.t_mjd))
    .sort((a, b) => a.t_mjd - b.t_mjd)
    .map((point) => ({ ...offset(point), tMjd: point.t_mjd, contentType: point.content_type ?? null }));
  const region = modelCov && threshold ? covarianceEllipse(modelCov, threshold) : null;
  const testCov = modelCov && observed?.cov ? addCovariance(modelCov, observed.cov) : null;
  const testRegion = testCov && threshold ? covarianceEllipse(testCov, threshold) : null;
  const distance = (residual) => (Number.isFinite(residual?.d2) && residual.d2 >= 0 ? Math.sqrt(residual.d2) : null);
  const placed = imagePlacement(observedDoc?.image, origin);
  const focus = squareAround([
    { east: 0, north: 0 },
    ...training,
    ...(baseline ? [baseline] : []),
    ...(observed ? [observed] : []),
    ...ellipseExtents(model, region),
    ...ellipseExtents(model, testRegion),
  ], FOCUS_MARGIN, Math.max(MIN_FOCUS_ARCSEC, (region?.major ?? 0) * 3));
  const full = placed.image
    ? { east: placed.image.centre.east, north: placed.image.centre.north, span: Math.max(placed.image.east[1] - placed.image.east[0], placed.image.north[1] - placed.image.north[0], focus.span) }
    : { ...focus, span: focus.span * 3 };
  return {
    trialId: bundle.id,
    tMjd: Number.isFinite(reference?.t_mjd) ? reference.t_mjd : Number.isFinite(prediction.t_mjd) ? prediction.t_mjd : trial.holdout?.t_mjd ?? null,
    referenceShift: headline ? Math.hypot(headline.east, headline.north) : null,
    training,
    trainingState: trainingResult?.state ?? 'missing',
    model,
    baseline,
    observed,
    threshold,
    limit: threshold ? Math.sqrt(threshold) : null,
    region,
    testRegion,
    status: verification.status ?? null,
    statusReasonKey: verification.status_reason_key ?? null,
    modelResidual: residuals.model ?? null,
    baselineResidual: residuals.baseline ?? null,
    distance: distance(residuals.model),
    baselineDistance: distance(residuals.baseline),
    check: residualCheck(observed, residuals.model, modelCov, observed?.cov),
    image: placed.image,
    imageReason: placed.reason,
    identification: verification.identification ?? null,
    views: { full, focus },
  };
}

/** Linear blend of two views (for the zoom), t in [0, 1]; the span blends in log space so the zoom feels even. */
export function blendView(from, to, t) {
  const k = Math.min(1, Math.max(0, t));
  return {
    east: from.east + (to.east - from.east) * k,
    north: from.north + (to.north - from.north) * k,
    span: Math.exp(Math.log(from.span) + (Math.log(to.span) - Math.log(from.span)) * k),
  };
}

/** Smooth start and stop for animations. */
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);

/**
 * The small chart of an open forecast: the predicted position (and the track over the window when given) with
 * each 95% region drawn to scale, relative to the reference-time model position.
 */
export function forecastModel(prediction, trial) {
  if (!prediction || !isPoint(prediction.model)) return null;
  const origin = prediction.model;
  const threshold = Number.isFinite(trial?.scoring?.threshold_d2) ? trial.scoring.threshold_d2 : null;
  const offset = (point) => tangentOffsetArcsec(origin.ra_deg, origin.dec_deg, point.ra_deg, point.dec_deg);
  const regionOf = (cov) => (isCov(cov) && threshold ? covarianceEllipse(cov, threshold) : null);
  const track = (Array.isArray(prediction.track) ? prediction.track : [])
    .filter((point) => isPoint(point) && Number.isFinite(point.t_mjd))
    .sort((a, b) => a.t_mjd - b.t_mjd)
    .map((point) => ({ ...offset(point), tMjd: point.t_mjd, region: regionOf(point.cov_arcsec2) }));
  const model = { east: 0, north: 0, region: regionOf(origin.cov_arcsec2), tMjd: prediction.t_mjd ?? null };
  const baseline = isPoint(prediction.baseline) ? { ...offset(prediction.baseline), region: regionOf(prediction.baseline.cov_arcsec2) } : null;
  const extents = [model, ...track, ...ellipseExtents(model, model.region), ...track.flatMap((point) => ellipseExtents(point, point.region))];
  const view = squareAround(extents, FOCUS_MARGIN, Math.max(MIN_FOCUS_ARCSEC, (model.region?.major ?? 0) * 3));
  // When the region is tiny next to the track, a second view zooms on the reference-time region.
  const zoom = model.region && model.region.major * 2 < view.span * 0.06
    ? squareAround([model, ...ellipseExtents(model, model.region)], FOCUS_MARGIN, model.region.major * 3)
    : null;
  return { model, baseline, track, view, zoom, threshold };
}

/** A length for a scale bar, about a fifth of the view: 1, 2 or 5 times a power of ten in the unit it is shown in
 * (arcsec, arcmin from 2′, degrees from 1°), returned in arcsec. */
export function niceLength(span) {
  if (!(span > 0)) return 1;
  const target = span / 5;
  const unit = target >= 3600 ? 3600 : target >= 120 ? 60 : 1;
  const inUnit = target / unit;
  const power = 10 ** Math.floor(Math.log10(inUnit));
  const nice = [5, 2, 1].map((step) => step * power).find((value) => value <= inUnit * (1 + 1e-9)) ?? power;
  return nice * unit;
}

/** Arcseconds for labels: arcminutes from 2′ up, degrees from 1° up. */
export function formatArcsec(value) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 3600) return `${formatNumber(value / 3600, 2)}°`;
  if (Math.abs(value) >= 120) return `${formatNumber(value / 60, Number.isInteger(value / 60) ? 0 : 1)}′`;
  const digits = Math.abs(value) < 1 ? 2 : Math.abs(value) < 10 && !Number.isInteger(value) ? 2 : Number.isInteger(value) ? 0 : 1;
  return `${formatNumber(value, digits)}″`;
}
