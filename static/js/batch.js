// The asteroid batch (Session A's A9): many small position trials scored together, so the page can say how often
// the truth landed inside our 95% regions. Pure functions, no DOM. Each asteroid is a normal trial (trial,
// prediction, receipt, verification); the batch file adds the calibration summary and one row per trial.

/** D² ≤ 5.991 is "inside the 95% region" for a 2D position; D ≤ 2.4477. */
export const D2_LIMIT_95 = 5.991;
export const D_LIMIT_95 = Math.sqrt(D2_LIMIT_95);

const finite = (value) => Number.isFinite(value);

/** log of n choose k, via lgamma-free summation (n stays small here). */
function logChoose(n, k) {
  let sum = 0;
  for (let i = 1; i <= k; i += 1) sum += Math.log((n - k + i) / i);
  return sum;
}

/** P(X ≤ k) for X ~ Binomial(n, p). */
export function binomialCdf(k, n, p) {
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return 0;
  let total = 0;
  for (let i = 0; i <= k; i += 1) total += Math.exp(logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  return Math.min(1, total);
}

function bisect(f, low, high) {
  for (let step = 0; step < 200; step += 1) {
    const mid = (low + high) / 2;
    if (f(mid)) high = mid;
    else low = mid;
  }
  return (low + high) / 2;
}

/**
 * Exact (Clopper–Pearson) interval for a binomial proportion: k successes in n, two-sided at `level`.
 * It never claims more than the counts support, which matters when n is small.
 */
export function clopperPearson(k, n, level = 0.95) {
  if (!(n > 0) || !(k >= 0) || k > n) return null;
  const alpha = 1 - level;
  const lower = k === 0 ? 0 : bisect((p) => 1 - binomialCdf(k - 1, n, p) >= alpha / 2, 0, 1);
  const upper = k === n ? 1 : bisect((p) => binomialCdf(k, n, p) <= alpha / 2, 0, 1);
  return [lower, upper];
}

/** One model's numbers on a row: V13 prefixes them (`model_d2`, `secondary_d`, `baseline_inside`); the example used bare names for the model. */
function scoreOf(row, prefix, bare) {
  const pick = (name) => (row[`${prefix}_${name}`] !== undefined ? row[`${prefix}_${name}`] : bare ? row[name] : undefined);
  const d2 = finite(pick('d2')) ? pick('d2') : finite(pick('d')) ? pick('d') ** 2 : null;
  const inside = pick('inside');
  return {
    d: finite(pick('d')) ? pick('d') : d2 !== null ? Math.sqrt(d2) : null,
    d2,
    inside: typeof inside === 'boolean' ? inside : d2 !== null ? d2 <= D2_LIMIT_95 : null,
    error: finite(row[`${prefix}_error_arcsec`]) ? row[`${prefix}_error_arcsec`] : null,
  };
}

/** A calibration block (`calibration`, `secondary_calibration`, `baseline_calibration`) as the page uses it, or null. */
function readCalibration(given, fallbackRows) {
  if (!given && !fallbackRows) return null;
  const level = finite(given?.level) ? given.level : 0.95;
  const n = Number.isInteger(given?.n) ? given.n : fallbackRows.length;
  const k = Number.isInteger(given?.k_inside) ? given.k_inside : fallbackRows.filter((row) => row.inside).length;
  const fileInterval = Array.isArray(given?.interval) && given.interval.every(finite) ? given.interval : null;
  return {
    n,
    k,
    level,
    // No forecast checked yet: no interval to show (0 of 0 says nothing).
    interval: n > 0 ? fileInterval ?? clopperPearson(k, n, level) : null,
    wilson: n > 0 && Array.isArray(given?.wilson_interval) && given.wilson_interval.every(finite) ? given.wilson_interval : null,
    method: fileInterval ? given.interval_method ?? null : 'clopper_pearson',
    expected: finite(given?.expected_inside) ? given.expected_inside : n * level,
    computed: !given,
    noteKey: given?.independence_note_key ?? null,
  };
}

/**
 * The batch file as the page shows it, or null. Rows come from the file; the calibration numbers too. Only when
 * the file has no calibration block are k and n counted from the rows (excluded rows left out) and the interval
 * computed exactly; the result says so (`computed: true`). The secondary model and the straight line are read
 * the same way and kept apart from the primary (V13).
 */
export function readBatch(doc) {
  if (!doc || !/^tenger\.batch\/\d+$/.test(doc.schema_version ?? '') || !Array.isArray(doc.rows)) return null;
  const rows = doc.rows.flatMap((row) => {
    if (typeof row?.trial_id !== 'string') return [];
    const model = scoreOf(row, 'model', true);
    const secondary = scoreOf(row, 'secondary', false);
    const baseline = scoreOf(row, 'baseline', false);
    return [{
      trialId: row.trial_id,
      name: typeof row.name === 'string' ? row.name : row.trial_id,
      d: model.d,
      d2: model.d2,
      inside: model.inside,
      modelError: model.error,
      baselineError: baseline.error,
      secondary,
      baseline,
      status: row.status ?? null,
      statusKey: row.status_reason_key ?? null,
      // JPL compared with the frozen regions after the verdict (V13 + A9): exploratory, never counted.
      horizons: row.exploratory_vs_horizons && row.exploratory_vs_horizons.counts === false ? {
        error: finite(row.exploratory_vs_horizons.primary_median_error_arcsec) ? row.exploratory_vs_horizons.primary_median_error_arcsec : null,
        inside: typeof row.exploratory_vs_horizons.primary_inside_95 === 'boolean' ? row.exploratory_vs_horizons.primary_inside_95 : null,
      } : null,
      excludedKey: row.excluded_reason_key ?? null,
    }];
  });
  const scored = rows.filter((row) => !row.excludedKey && row.inside !== null);
  const pick = (name) => scored.map((row) => ({ inside: row[name].inside })).filter((row) => row.inside !== null);
  return {
    example: doc.example === true,
    id: doc.batch_id ?? null,
    nameKey: doc.title_key ?? null,
    name: doc.name ?? null,
    category: doc.category ?? null,
    labels: Array.isArray(doc.labels) ? doc.labels : [],
    statementPending: doc.team_statement_pending === true,
    frozenUtc: typeof doc.frozen_utc === 'string' ? doc.frozen_utc : doc.receipt?.frozen_utc ?? null,
    receipt: doc.receipt ?? null,
    trialIds: Array.isArray(doc.trial_ids) ? doc.trial_ids : rows.map((row) => row.trialId),
    calibration: readCalibration(doc.calibration, scored),
    secondaryCalibration: doc.secondary_calibration ? readCalibration(doc.secondary_calibration, pick('secondary')) : null,
    baselineCalibration: doc.baseline_calibration ? readCalibration(doc.baseline_calibration, pick('baseline')) : null,
    waiting: rows.filter((row) => row.status === 'waiting').length,
    // Only a block that says it is exploratory and not counted is read, and it is never the calibration.
    exploratory: doc.exploratory_horizons_coverage?.exploratory === true && doc.exploratory_horizons_coverage?.counts === false ? {
      noteKey: doc.exploratory_horizons_coverage.note_key ?? null,
      primary: readCalibration(doc.exploratory_horizons_coverage.primary, null),
      secondary: doc.exploratory_horizons_coverage.secondary ? readCalibration(doc.exploratory_horizons_coverage.secondary, null) : null,
    } : null,
    notAttempted: Array.isArray(doc.not_attempted) ? doc.not_attempted : [],
    rows,
    noteKeys: Array.isArray(doc.note_keys) ? doc.note_keys.filter((key) => typeof key === 'string') : [],
  };
}

/** Rows sorted for the D chart (smallest D first), without excluded or unscored rows. */
export const chartRows = (batch) => batch.rows.filter((row) => !row.excludedKey && finite(row.d)).sort((a, b) => a.d - b.d);

/** How many rows the straight line beat the model on (both errors known); ties are neither. */
export function baselineWins(batch) {
  const both = batch.rows.filter((row) => finite(row.modelError) && finite(row.baselineError));
  return { compared: both.length, model: both.filter((row) => row.modelError < row.baselineError).length, baseline: both.filter((row) => row.baselineError < row.modelError).length };
}

/** Where the nominal level sits against the interval: 'fits', 'tooSmall' (regions overconfident) or 'tooBig'. */
export function coverageVerdict({ interval, level } = {}) {
  if (!Array.isArray(interval) || !Number.isFinite(level)) return null;
  if (level > interval[1]) return 'tooSmall';
  if (level < interval[0]) return 'tooBig';
  return 'fits';
}

/** The same share inside with more tries (a what-if, not measured): exact intervals for n·m, one row per factor. */
export function whatIfRows({ k, n, level = 0.95 }, factors = [4, 16]) {
  if (!(n > 0)) return [];
  return factors.map((factor) => ({ n: n * factor, k: k * factor, interval: clopperPearson(k * factor, n * factor, level) }));
}
