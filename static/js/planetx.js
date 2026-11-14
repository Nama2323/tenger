// "Could SPHEREx see Planet X? We measured it": readers and chart maths for Session A's injection-recovery
// depth file and the "Find the hidden planet" game pairs (DATA-CONTRACT V12; artificial content lives only under
// static/data/planetx/). Pure, no DOM. The game's planets are artificial sources added to real frames: never a
// detection, never counted.

import { DETECTOR_RANGES } from './stack.js';

export const DEPTH_PATH = 'planetx/depth.json';
export const HIDDEN_PATH = 'planetx/hidden-planet.json';

const finite = (value) => Number.isFinite(value);

/** A SPHEREx detector pixel, about 6.15″. Frames resampled when aligned can have finer picture pixels. */
export const NATIVE_PIXEL_ARCSEC = 6.15;

/**
 * Where the published bands of the Planet X predictions sit (µm): Johnson I about 0.80, WISE W1 3.35, WISE W2 4.60.
 * Keyed by the band ids of the depth file; the published band name is the fallback.
 */
export const PUBLISHED_BAND_UM = { i: 0.8, w1: 3.35, w2: 4.6 };
const BAND_NAMES = [[/\bjohnson\s*i\b/i, 'i'], [/\bw1\b/i, 'w1'], [/\bw2\b/i, 'w2']];

/**
 * Does the band's published wavelength lie inside the SPHEREx array the file names, and do the file's own
 * wavelengths lie inside that array? ok is null when the band is not one we know.
 */
export function bandWavelengthCheck(band) {
  const key = PUBLISHED_BAND_UM[band?.id] !== undefined ? band.id : BAND_NAMES.find(([pattern]) => pattern.test(band?.published_band ?? band?.publishedBand ?? ''))?.[1];
  const published = key ? PUBLISHED_BAND_UM[key] : null;
  const array = DETECTOR_RANGES[band?.detector] ?? null;
  const used = band?.wavelength_um ?? band?.wavelength ?? null;
  if (published === null || !array) return { published, array, ok: null, publishedInside: null, usedInside: null };
  const inside = (value) => value >= array[0] && value <= array[1];
  const publishedInside = inside(published);
  const usedInside = Array.isArray(used) && used.every(finite) ? used.every(inside) : null;
  return { published, array, ok: publishedInside && usedInside !== false, publishedInside, usedInside };
}

/** Wilson score interval for k successes in n trials (z = 1.96 for 95%). */
export function wilson(k, n, z = 1.96) {
  if (!(n > 0) || !(k >= 0) || k > n) return null;
  const p = k / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/**
 * The magnitude where the recovered fraction falls to `level`, by linear interpolation between the two curve
 * points that bracket it (points sorted bright → faint). Null when the curve never crosses that level.
 */
export function depthAt(curve, level) {
  const points = [...curve].filter((point) => finite(point.mag) && finite(point.fraction)).sort((a, b) => a.mag - b.mag);
  for (let index = 1; index < points.length; index += 1) {
    const [bright, faint] = [points[index - 1], points[index]];
    if (bright.fraction >= level && faint.fraction < level) {
      return bright.mag + ((bright.fraction - level) / (bright.fraction - faint.fraction)) * (faint.mag - bright.mag);
    }
  }
  return null;
}

/** {min,max} or {value,plus,minus} or a number → [low, high] (a point gives low = high), else null. */
export function magRange(quantity) {
  if (finite(quantity)) return [quantity, quantity];
  if (finite(quantity?.min) && finite(quantity?.max)) return [quantity.min, quantity.max];
  if (finite(quantity?.value) && finite(quantity?.plus) && finite(quantity?.minus)) return [quantity.value - quantity.minus, quantity.value + quantity.plus];
  if (finite(quantity?.value)) return [quantity.value, quantity.value];
  return null;
}

function readCurve(points, confidenceZ) {
  return (points ?? []).flatMap((point) => {
    const mag = point?.mag_ab ?? point?.mag;
    const injected = point?.injected ?? point?.n_injected;
    const recovered = point?.recovered ?? point?.n_recovered;
    if (!finite(mag) || !(injected > 0) || !(recovered >= 0) || recovered > injected) return [];
    const fraction = finite(point.fraction) ? point.fraction : recovered / injected;
    const interval = Array.isArray(point.interval) && point.interval.every(finite) ? point.interval : wilson(recovered, injected, confidenceZ);
    return [{ mag, injected, recovered, fraction, interval }];
  }).sort((a, b) => a.mag - b.mag);
}

/** A depth given as a number or as {value, interval}: {value, interval|null}, or null. */
function depthValue(given) {
  if (finite(given)) return { value: given, interval: null };
  if (finite(given?.value)) return { value: given.value, interval: Array.isArray(given.interval) && given.interval.every(finite) ? given.interval : null };
  return null;
}

function readCurveBlock(block, z) {
  const curve = readCurve(block?.curve, z);
  if (curve.length < 2) return null;
  const given50 = depthValue(block.depth_50_ab);
  const given90 = depthValue(block.depth_90_ab);
  return {
    curve,
    depth50: given50 ?? (depthAt(curve, 0.5) === null ? null : { value: depthAt(curve, 0.5), interval: null }),
    depth90: given90 ?? (depthAt(curve, 0.9) === null ? null : { value: depthAt(curve, 0.9), interval: null }),
    interpolated: { d50: !given50, d90: !given90 },
  };
}

/**
 * The depth file as the page shows it, or null when it is not a depth file (or claims to count). Each band's
 * pooled curve is the chart; per-field curves go to the table. Depths missing from the file are interpolated
 * from the curve and marked so. Projections (stacked_projection) are never read as measurements.
 */
export function readDepth(doc) {
  if (!doc || !/^tenger\.planetx_depth\/\d+$/.test(doc.schema_version ?? '') || doc.counts === true) return null;
  const confidence = finite(doc.method?.confidence) ? doc.method.confidence : 0.95;
  const z = confidence >= 0.95 ? 1.96 : 1.0;
  const bands = (doc.bands ?? []).flatMap((band) => {
    const pooled = readCurveBlock(band?.pooled ?? band, z);
    if (!band?.id || !pooled) return [];
    const fields = (band.fields ?? []).flatMap((field) => {
      const block = readCurveBlock(field, z);
      return block ? [{
        fieldKey: field.field_key ?? null,
        exposures: Number.isInteger(field.n_exposures) ? field.n_exposures : null,
        zodi: finite(field.zodi_mjy_sr) ? field.zodi_mjy_sr : null,
        falseDetection: field.false_detection ?? null,
        ...block,
      }] : [];
    });
    return [{
      id: band.id,
      detector: Number.isInteger(band.detector) ? band.detector : null,
      publishedBand: band.published_band ?? null,
      wavelength: Array.isArray(band.wavelength_um) && band.wavelength_um.every(finite) ? band.wavelength_um : null,
      check: bandWavelengthCheck(band),
      ...pooled,
      fields,
    }];
  });
  if (!bands.length) return null;
  const models = (doc.models ?? []).flatMap((model) => (model?.reference ? [{
    id: model.id ?? null,
    reference: model.reference,
    doi: model.doi ?? null,
    bandId: model.band_id ?? null,
    range: magRange(model.mag_ab),
    published: model.mag_published && finite(model.mag_published.value) ? model.mag_published : null,
    vegaToAb: model.vega_to_ab ?? null,
    location: model.location ?? null,
    noteKey: model.note_key ?? null,
    scenarioKey: model.scenario_key ?? null,
  }] : []));
  const wiseDoc = doc.wise_limit;
  const wise = wiseDoc && finite(wiseDoc.mag_ab) ? {
    bandId: wiseDoc.band_id ?? null, mag: wiseDoc.mag_ab, magVega: finite(wiseDoc.mag_vega) ? wiseDoc.mag_vega : null,
    completeness: finite(wiseDoc.completeness) ? wiseDoc.completeness : null, reference: wiseDoc.reference ?? null, doi: wiseDoc.doi ?? null,
    location: wiseDoc.location ?? null, noteKey: wiseDoc.note_key ?? null,
  } : null;
  return {
    example: doc.example === true,
    confidence,
    method: doc.method ?? {},
    bands,
    models,
    wise,
    verdicts: (doc.verdicts ?? []).filter((item) => item && typeof item.verdict_key === 'string'),
    verdictKey: doc.verdict_key ?? null,
    // The headline sentence with its numbers: { key, values } filled from the file, `text` as Session A wrote it.
    verdictSummary: typeof doc.verdict_summary?.key === 'string' ? {
      key: doc.verdict_summary.key,
      values: doc.verdict_summary.values && typeof doc.verdict_summary.values === 'object' ? doc.verdict_summary.values : {},
      text: typeof doc.verdict_summary.text === 'string' ? doc.verdict_summary.text : null,
    } : null,
    missionKey: doc.mission_sensitivity?.statement_key ?? null,
    // Session A names them limitation_keys; assumption_keys is the earlier name. Both are shown, once each.
    assumptionKeys: [...new Set([doc.assumption_keys, doc.limitation_keys].flatMap((list) => (Array.isArray(list) ? list : [])).filter((key) => typeof key === 'string'))],
  };
}

/** A chart's x range (magnitudes) that holds the curve, the depths and every marker drawn on it, padded. */
export function magExtent(band, markers = []) {
  const values = [...band.curve.map((point) => point.mag), band.depth50?.value, band.depth90?.value, ...markers.flat()].filter(finite);
  const [low, high] = [Math.min(...values), Math.max(...values)];
  const pad = Math.max(0.3, (high - low) * 0.06);
  return [low - pad, high + pad];
}

// ---------- Find the hidden planet ----------

/**
 * The hidden-planet game file, or null. Refused unless the file says it is artificial and not counted, and every
 * frame lives under planetx/ (the only place artificial content may be, V12) and is not marked as anything but
 * artificial. So a real detection can never appear as a round, and a round never as a detection.
 */
export function readHiddenPlanet(doc) {
  if (!doc || !/^tenger\.hidden_planet\/\d+$/.test(doc.schema_version ?? '') || doc.artificial !== true || doc.counts !== false) return null;
  const artificialFrame = (frame) => typeof frame?.path === 'string' && /^planetx\//.test(frame.path)
    && (frame.content_type === undefined || frame.content_type === 'artificial') && frame.width > 0 && frame.height > 0;
  const pairs = (doc.pairs ?? []).flatMap((pair) => {
    const frames = Array.isArray(pair?.frames) ? pair.frames : [];
    if (frames.length !== 2 || !frames.every(artificialFrame)) return [];
    const injected = (pair.injected ?? []).filter((point) => [0, 1].includes(point?.frame) && finite(point.x) && finite(point.y));
    if (injected.length < 2) return [];
    const found = pair.pipeline?.found === true;
    return [{
      id: String(pair.id ?? ''),
      fieldKey: pair.field_key ?? null,
      bandId: pair.band_id ?? null,
      frames: frames.map((frame) => ({ path: frame.path, tMjd: finite(frame.t_mjd) ? frame.t_mjd : null, width: frame.width, height: frame.height, pixelArcsec: finite(frame.pixel_arcsec) ? frame.pixel_arcsec : null })),
      injected,
      mag: finite(pair.injected_mag_ab) ? pair.injected_mag_ab : null,
      // V12: { east, north, total } in arcsec; an early example gave the total alone.
      motion: finite(pair.motion_arcsec) ? pair.motion_arcsec : finite(pair.motion_arcsec?.total) ? pair.motion_arcsec.total : null,
      pipeline: { found, positions: found && Array.isArray(pair.pipeline.positions) ? pair.pipeline.positions.filter((point) => finite(point?.x) && finite(point?.y)) : [], ruleKey: pair.pipeline?.rule_key ?? null },
      tolerance: finite(pair.tolerance_px) ? pair.tolerance_px : 3,
    }];
  });
  return pairs.length ? { example: doc.example === true, pairs } : null;
}

/** The player's tap against the injected source in the frame they tapped: distance in pixels (and arcsec). */
/**
 * The numbers the reveal shows, so they multiply as written: the distance rounded to 0.1 picture pixel, times that
 * frame's own pixel scale from the file, and the tolerance circle in pixels and arcseconds.
 */
export function tapReport(pair, verdict) {
  if (!pair || !verdict) return null;
  const scale = pair.frames[verdict.point.frame]?.pixelArcsec;
  const px = Math.round(verdict.distancePx * 10) / 10;
  return {
    px,
    scale: finite(scale) ? scale : null,
    arcsec: finite(scale) ? px * scale : null,
    tolerancePx: pair.tolerance,
    toleranceArcsec: finite(scale) && finite(pair.tolerance) ? pair.tolerance * scale : null,
    resampled: finite(scale) ? Math.abs(scale - NATIVE_PIXEL_ARCSEC) / NATIVE_PIXEL_ARCSEC > 0.05 : null,
  };
}

export function judgeTap(pair, tap) {
  if (!pair || !finite(tap?.x) || !finite(tap?.y)) return null;
  const candidates = pair.injected.filter((point) => tap.frame === undefined || point.frame === tap.frame);
  const nearest = (candidates.length ? candidates : pair.injected)
    .map((point) => ({ point, distance: Math.hypot(point.x - tap.x, point.y - tap.y) }))
    .sort((a, b) => a.distance - b.distance)[0];
  const scale = pair.frames[nearest.point.frame]?.pixelArcsec;
  return { distancePx: nearest.distance, distanceArcsec: finite(scale) ? nearest.distance * scale : null, hit: nearest.distance <= pair.tolerance, point: nearest.point };
}

/**
 * Every published prediction against our depth, one row per verdict in the file: the gap (prediction minus our
 * pooled 50% single-exposure depth) and how many of them are too faint. Numbers only from the file.
 */
export function gapRows(depth) {
  const rows = (depth?.verdicts ?? []).filter((verdict) => finite(verdict.gap_mag?.value)).map((verdict) => ({
    bandId: verdict.band_id ?? null,
    modelId: verdict.model_id ?? null,
    model: depth.models.find((item) => item.id === verdict.model_id) ?? null,
    wise: verdict.model_id === 'wise-limit' || (depth.wise && depth.wise.id === verdict.model_id),
    predicted: finite(verdict.model_mag_ab) ? verdict.model_mag_ab : null,
    depth: finite(verdict.depth_50_ab) ? verdict.depth_50_ab : null,
    gap: verdict.gap_mag.value,
    sigma: finite(verdict.gap_mag.sigma) ? verdict.gap_mag.sigma : null,
    factor: finite(verdict.factor_in_flux) ? verdict.factor_in_flux : null,
    verdictKey: verdict.verdict_key,
  }));
  const closest = rows.reduce((best, row) => (best === null || row.gap < best.gap ? row : best), null);
  return { rows, tooFaint: rows.filter((row) => row.gap > 0).length, closest };
}

/** How many artificial planets each point of the pooled curves holds: the method's number, else [min, max] counted from the curves. */
export function injectedPerPoint(depth) {
  if (finite(depth?.method?.injections_per_point)) return [depth.method.injections_per_point, depth.method.injections_per_point];
  const counts = (depth?.bands ?? []).flatMap((band) => band.curve.map((point) => point.injected)).filter(finite);
  return counts.length ? [Math.min(...counts), Math.max(...counts)] : null;
}

/** The published values drawn on one band's chart, faintest last, numbered for the chart's key. */
export const bandModels = (depth, bandId) => depth.models.filter((model) => model.bandId === bandId && model.range)
  .sort((a, b) => a.range[0] - b.range[0]).map((model, index) => ({ ...model, number: index + 1 }));
