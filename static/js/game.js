// Beat the physics: round checks, raw errors and the bounded score (docs/DATA-CONTRACT.md §11).
// Pure: no DOM, so the scoring edge cases are unit-tested under Node.
//
// Score (exp_decay_v1): score = round(100 * exp(-error / scale)), error >= 0 in the round's units,
// scale > 0 fixed when the round was generated, before the reveal. A perfect guess scores 100, the
// score falls towards 0 and never below. Nothing is divided by the baseline error. If the error or the
// scale is not a finite number, or scale <= 0, the score is null and only raw errors are shown.

export const SCORE_FORMULAS = ['exp_decay_v1'];
export const PLAYERS = ['player', 'baseline', 'model'];
/** Position fields are in arcsec (contract: units in field names); a round may report errors in larger units. */
const FROM_ARCSEC = { arcsec: 1, arcmin: 1 / 60, deg: 1 / 3600 };
const TIE_TOLERANCE = 1e-9;

export function expDecayScore(error, scale) {
  if (!Number.isFinite(error) || error < 0 || !Number.isFinite(scale) || scale <= 0) return null;
  return Math.round(100 * Math.exp(-error / scale));
}

const isPosition = (point) => Number.isFinite(point?.east_arcsec) && Number.isFinite(point?.north_arcsec);
const isScalar = (point) => Number.isFinite(point?.value);

/** Magnitudes (DATA-CONTRACT V4: "mag_ab"): smaller is brighter, so plots put small values at the top. */
export const isMagnitude = (units) => typeof units === 'string' && /^mag/.test(units);

/** 'position' or 'scalar' from the round's quantity, or null for a quantity the page cannot play. */
export function roundKind(round) {
  if (round?.quantity === 'position') return 'position';
  if (round?.quantity === 'brightness' || round?.quantity === 'flux') return 'scalar';
  return null;
}

/**
 * Whether a round can be played, with problem keys (i18n 'game.problem.*'). Blocking problems stop play;
 * a missing or unknown score formula only removes the score (raw errors are still shown).
 */
export function checkRound(round) {
  const blocking = [];
  const warnings = [];
  const kind = roundKind(round);
  if (!kind) blocking.push('quantity');
  const valid = kind === 'position' ? isPosition : isScalar;
  const training = Array.isArray(round?.training_points) ? round.training_points : [];
  if (kind && (!training.length || !training.every((point) => valid(point) && Number.isFinite(point.t_mjd)))) blocking.push('training');
  if (kind && !Number.isFinite(round?.reveal_t_mjd)) blocking.push('revealTime');
  for (const part of ['baseline', 'model', 'actual']) if (kind && !valid(round?.[part])) blocking.push(part);
  if (!SCORE_FORMULAS.includes(round?.scoring?.formula)) warnings.push('formula');
  else if (!(Number.isFinite(round.scoring.scale) && round.scoring.scale > 0)) warnings.push('scale');
  if (kind === 'position' && !(round?.units in FROM_ARCSEC)) warnings.push('units');
  return { ok: blocking.length === 0, kind, blocking, warnings };
}

/** Raw distance between two points of a round, in the round's units (arcsec when the units are unknown). */
export function pointError(round, first, second) {
  if (roundKind(round) === 'position') {
    if (!isPosition(first) || !isPosition(second)) return null;
    const arcsec = Math.hypot(first.east_arcsec - second.east_arcsec, first.north_arcsec - second.north_arcsec);
    return arcsec * (FROM_ARCSEC[round.units] ?? 1);
  }
  if (!isScalar(first) || !isScalar(second)) return null;
  return Math.abs(first.value - second.value);
}

/** The unit errors are reported in: the round's units for scalars; for positions arcsec unless set. */
export function errorUnit(round) {
  if (roundKind(round) === 'position') return round.units in FROM_ARCSEC ? round.units : 'arcsec';
  return round?.units ?? '';
}

/**
 * Errors and scores of the player's guess, the baseline and the model against the actual observation.
 * best lists who came closest (more than one on a tie). The model may lose.
 */
export function scoreRound(round, guess) {
  const check = checkRound(round);
  const scored = SCORE_FORMULAS.includes(round?.scoring?.formula) && !check.warnings.includes('units');
  const scale = round?.scoring?.scale;
  const errors = {
    player: pointError(round, guess, round?.actual),
    baseline: pointError(round, round?.baseline, round?.actual),
    model: pointError(round, round?.model, round?.actual),
  };
  const scores = Object.fromEntries(PLAYERS.map((who) => [who, scored ? expDecayScore(errors[who], scale) : null]));
  const finite = PLAYERS.filter((who) => Number.isFinite(errors[who]));
  const smallest = Math.min(...finite.map((who) => errors[who]));
  const best = finite.filter((who) => errors[who] - smallest <= TIE_TOLERANCE);
  return { errors, scores, best, unit: errorUnit(round), scored: scored && scores.player !== null };
}

/** "Physics lost" means the straight line came strictly closer than the frozen model. */
export const physicsLost = (result) => Number.isFinite(result.errors.model) && Number.isFinite(result.errors.baseline)
  && result.errors.baseline + TIE_TOLERANCE < result.errors.model;

// ---------- Plot geometry (shared by the page and the tests) ----------

const MIN_SPAN_SCALES = 4;
const MARGIN_SPANS = 1;

/**
 * The square area shown before the reveal, from the training points only, so the axes do not hint at the
 * answer: the training box widened by its own size on every side, and at least four score scales wide.
 * extra points (revealed later) widen it. Returns { east: [min, max], north: [min, max] } in arcsec.
 */
export function positionView(round, extra = []) {
  const points = [...round.training_points, ...extra.filter(isPosition)];
  const easts = points.map((point) => point.east_arcsec);
  const norths = points.map((point) => point.north_arcsec);
  const trainingSpan = Math.max(
    Math.max(...round.training_points.map((point) => point.east_arcsec)) - Math.min(...round.training_points.map((point) => point.east_arcsec)),
    Math.max(...round.training_points.map((point) => point.north_arcsec)) - Math.min(...round.training_points.map((point) => point.north_arcsec)),
  );
  const scaleArcsec = (Number.isFinite(round.scoring?.scale) && round.scoring.scale > 0 ? round.scoring.scale : 1)
    / (FROM_ARCSEC[round.units] ?? 1);
  const margin = Math.max(trainingSpan * MARGIN_SPANS, (MIN_SPAN_SCALES * scaleArcsec) / 2);
  const east = [Math.min(...easts) - margin, Math.max(...easts) + margin];
  const north = [Math.min(...norths) - margin, Math.max(...norths) + margin];
  const span = Math.max(east[1] - east[0], north[1] - north[0]);
  const centre = { east: (east[0] + east[1]) / 2, north: (north[0] + north[1]) / 2 };
  return { east: [centre.east - span / 2, centre.east + span / 2], north: [centre.north - span / 2, centre.north + span / 2] };
}

/** Time and value ranges for a scalar round: training points to the reveal date; values padded the same way. */
export function scalarView(round, extra = []) {
  const times = round.training_points.map((point) => point.t_mjd);
  const values = [...round.training_points, ...extra.filter(isScalar)].map((point) => point.value);
  const trainingValues = round.training_points.map((point) => point.value);
  const trainingSpan = Math.max(...trainingValues) - Math.min(...trainingValues);
  const scale = Number.isFinite(round.scoring?.scale) && round.scoring.scale > 0 ? round.scoring.scale : 1;
  const margin = Math.max(trainingSpan * 0.5, scale);
  const timeSpan = Math.max(round.reveal_t_mjd, ...times) - Math.min(...times);
  return {
    time: [Math.min(...times) - timeSpan * 0.05, Math.max(round.reveal_t_mjd, ...times) + timeSpan * 0.08],
    value: [Math.min(...values) - margin, Math.max(...values) + margin],
  };
}

/** Round, readable tick values covering [low, high]. */
export function ticks(low, high, count = 5) {
  const step = (high - low) / count;
  if (!(step > 0)) return [low];
  const magnitude = 10 ** Math.floor(Math.log10(step));
  const nice = [1, 2, 5, 10].find((value) => value * magnitude >= step) * magnitude;
  const result = [];
  for (let value = Math.ceil(low / nice) * nice; value <= high + nice * 1e-9; value += nice) result.push(+value.toPrecision(12));
  return result;
}

// ---------- Best scores on this device (best effort) ----------

const STORAGE_KEY = 'tenger.game.v1';

export function readBest(storage, roundId) {
  try {
    const all = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}');
    const best = all?.[roundId]?.best;
    return Number.isFinite(best) ? best : null;
  } catch {
    return null;
  }
}

/** Saves the score if it beats the stored one; returns the best after saving (or null if storage failed). */
export function saveBest(storage, roundId, score) {
  if (!Number.isFinite(score)) return readBest(storage, roundId);
  try {
    const all = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}') ?? {};
    const previous = Number.isFinite(all[roundId]?.best) ? all[roundId].best : null;
    const best = previous === null ? score : Math.max(previous, score);
    all[roundId] = { best, plays: (all[roundId]?.plays ?? 0) + 1 };
    storage.setItem(STORAGE_KEY, JSON.stringify(all));
    return best;
  } catch {
    return null;
  }
}
