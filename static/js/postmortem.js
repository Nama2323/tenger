// "Why we missed": readers for Session A's exploratory files about the Pluto miss. Pure functions, no DOM.
// postmortem.json (DATA-CONTRACT V8) and hindcast-v2.json (V11) are explanations made after the reveal: pages
// label them "exploratory, after the reveal" and never use them to change a status or a count.

export const POSTMORTEM_PATH = 'trials/pluto/postmortem.json';
export const HINDCAST_PATH = 'trials/pluto/hindcast-v2.json';
/** χ² with 2 degrees of freedom at 95%: the 2D region D² ≤ 5.991. */
export const CHI2_95_2D = 5.991;

const number = (value) => (Number.isFinite(value) ? value : null);
const ellipse = (block) => (block && Number.isFinite(block.semi_major_95_arcsec)
  ? { major: block.semi_major_95_arcsec, minor: block.semi_minor_95_arcsec, pa: number(block.position_angle_deg_east_of_north) }
  : null);

/** 95% semi-axes (arcsec) of a 2×2 covariance in arcsec², from its eigenvalues. Null if not a covariance. */
export function ellipseOfCovariance(cov) {
  if (!Array.isArray(cov) || cov.length !== 2) return null;
  const [[a, b], [c, d]] = cov;
  if (![a, b, c, d].every(Number.isFinite) || Math.abs(b - c) > 1e-6 * Math.max(1, Math.abs(b))) return null;
  const mean = (a + d) / 2;
  const spread = Math.hypot((a - d) / 2, b);
  const [large, small] = [mean + spread, mean - spread];
  if (!(small > 0)) return null;
  return { major: Math.sqrt(CHI2_95_2D * large), minor: Math.sqrt(CHI2_95_2D * small) };
}

/**
 * The post-mortem as the page shows it, or null when the file is missing, of another kind, or claims to count.
 * Every number comes from the file; `nExposures`/`nVisits` are null until the file states them.
 */
export function readPostmortem(doc) {
  if (doc?.schema_version !== 'tenger.postmortem/1' || doc.exploratory !== true || doc.counts !== false) return null;
  const id = doc.identification ?? {};
  const split = doc.residual_split ?? {};
  const test = doc.uncertainty_test ?? {};
  const models = doc.alternative_models ?? {};
  const offsets = Object.entries(test.sensitivity ?? {})
    .map(([sigma, entry]) => ({ sigma: Number(sigma), d2: number(entry?.d2_with_inflated_covariance), result: entry?.would_have_been ?? null }))
    .filter((entry) => Number.isFinite(entry.sigma) && entry.d2 !== null)
    .sort((first, second) => first.sigma - second.sigma);
  const jackknife = test.jackknife_by_visit_and_array;
  return {
    trialId: doc.trial_id ?? null,
    label: doc.label ?? null,
    status: doc.frozen?.status ?? null,
    d2: number(doc.frozen?.d2),
    error: number(doc.frozen?.error_arcsec),
    frozenRegion: ellipse(doc.frozen?.c_pred_ellipse_95),
    observedFromJpl: number(id.observed_minus_horizons_total_arcsec),
    forecastFromJpl: number(id.frozen_model_minus_horizons_total_arcsec),
    along: number(split.along_track_arcsec),
    across: number(split.cross_track_arcsec),
    alongZ: number(split.along_track_z),
    acrossZ: number(split.cross_track_z),
    motion: number(split.apparent_motion_arcsec_per_day),
    groups: Number.isInteger(test.groups) ? test.groups : null,
    nExposures: Number.isInteger(test.n_exposures) ? test.n_exposures : null,
    nVisits: Number.isInteger(test.n_visits) ? test.n_visits : null,
    offsets,
    jackknife: jackknife ? { ...ellipse(jackknife.ellipse_95), d2: number(jackknife.d2_with_jackknife_covariance) } : null,
    frame: {
      heliocentric: number(models.heliocentric_two_body?.error_arcsec),
      barycentric: number(models.barycentric_two_body?.error_arcsec),
      nbody: number(models.barycentric_nbody?.error_arcsec),
    },
    openForecast: ellipse(doc.open_forecast_2027?.frozen_ellipse_95),
  };
}

/**
 * How much bigger the error of a mean really is when N measurements fall into G groups that share their error,
 * compared with treating all N as independent: √(N/G) in the simplest case (equal groups, shared error dominant).
 */
export const correlatedInflation = (n, groups) => (n > 0 && groups > 0 ? Math.sqrt(n / groups) : null);

/** The exploratory hindcast (old method vs new on the 2026 check), or null. */
export function readHindcast(doc) {
  if (doc?.schema_version !== 'tenger.hindcast/1' || doc.exploratory !== true || doc.counts !== false) return null;
  const side = (block, { frozen }) => (block ? {
    name: block.name ?? null,
    error: number(block.error_arcsec),
    d2: number(block.d2),
    result: frozen ? block.result ?? null : block.result_if_it_had_been_frozen ?? null,
    along: number(block.along_track_95_arcsec),
    across: number(block.cross_track_95_arcsec),
    region: ellipseOfCovariance(block.c_pred_arcsec2),
  } : null);
  return { labelKey: doc.label_key ?? null, label: doc.label ?? null, old: side(doc.old_method, { frozen: true }), new: side(doc.new_method, { frozen: false }) };
}

/** One row per Pluto open forecast for the side-by-side table: v1 (frozen before the miss) and the v2 revisions. */
export function forecastRows(bundles) {
  return bundles.flatMap((bundle) => {
    const trial = bundle?.trial?.state === 'ok' ? bundle.trial.doc : null;
    const prediction = bundle?.prediction?.state === 'ok' ? bundle.prediction.doc : null;
    if (!trial || !prediction || trial.target_key !== 'pluto' || prediction.open_forecast !== true && trial.open_forecast !== true) return [];
    const model = prediction.model ?? {};
    const alongAcross = Number.isFinite(model.along_track_95_arcsec) && Number.isFinite(model.cross_track_95_arcsec);
    return [{
      id: bundle.id,
      version: Number.isInteger(trial.method_version) ? trial.method_version : 1,
      revises: trial.revises ?? null,
      tMjd: number(prediction.t_mjd),
      frozenUtc: trial.frozen_utc ?? null,
      along: alongAcross ? model.along_track_95_arcsec : null,
      across: alongAcross ? model.cross_track_95_arcsec : null,
      axes: alongAcross ? null : ellipseOfCovariance(model.cov_arcsec2),
      labelKey: trial.forecast_label_key ?? null,
    }];
  }).sort((first, second) => first.version - second.version || (first.tMjd ?? 0) - (second.tMjd ?? 0));
}
