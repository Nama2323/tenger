// Pure geometry for "Why Pluto loops" (scene3d.json pluto_loop, DATA-CONTRACT V9, and the open-forecast files).
// Heliocentric ecliptic J2000, au. The apparent loop comes from the telescope's own yearly motion around the Sun.
//
// The 3D picture draws SPHEREx's orbit EXAGGERATION times larger than it is (labelled on screen): every sight line
// still runs from the drawn telescope through Pluto's real position, so the loop on the sky sphere is about that
// many times larger than the real one. The 2D chart beside it shows the real loop at true scale.
import { equatorialToEcliptic, OBLIQUITY_RAD, planetPosition } from './orbits.js';

export const EXAGGERATION = 8;
const DEG = Math.PI / 180;
/** Gaussian gravitational constant (rad/day): mean motion n = k / a^1.5 for a heliocentric two-body orbit. */
const GAUSS_K = 0.01720209895;
const MJD_TO_JD = 2400000.5;

export const sub = (a, b) => a.map((value, index) => value - b[index]);
export const add = (a, b) => a.map((value, index) => value + b[index]);
export const scale = (a, factor) => a.map((value) => value * factor);
export const norm = (a) => Math.hypot(...a);
export const unit = (a) => scale(a, 1 / norm(a));
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);

/** Ecliptic J2000 → ICRS (equatorial) for a vector: rotation about x by +ε. */
export function eclipticToEquatorial([x, y, z]) {
  const [c, s] = [Math.cos(OBLIQUITY_RAD), Math.sin(OBLIQUITY_RAD)];
  return [x, c * y - s * z, s * y + c * z];
}

/** RA/Dec (degrees, ICRS) of an ecliptic direction. */
export function radecOf(direction) {
  const [x, y, z] = unit(eclipticToEquatorial(direction));
  return { ra: ((Math.atan2(y, x) / DEG) + 360) % 360, dec: Math.asin(z) / DEG };
}

/** Ecliptic unit vector of an RA/Dec (degrees, ICRS). */
export function eclipticOfRadec(ra, dec) {
  const [a, d] = [ra * DEG, dec * DEG];
  return equatorialToEcliptic([Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)]);
}

/** Angle between two directions in arcseconds. */
export const separationArcsec = (first, second) => Math.acos(Math.min(1, Math.max(-1, dot(unit(first), unit(second))))) / DEG * 3600;

/**
 * Heliocentric two-body position from osculating elements (a au; e; i, om, w, ma degrees) at epochMjd, at mjd.
 * Mean motion from a (the Sun's mass only), as for TENGER's v1 orbit in scene3d.json (our_orbit).
 */
export function keplerPosition(elements, epochMjd, mjd) {
  const { a, e } = elements;
  const n = GAUSS_K / a ** 1.5;
  let anomaly = elements.ma * DEG + n * (mjd - epochMjd);
  anomaly = Math.atan2(Math.sin(anomaly), Math.cos(anomaly));
  let E = anomaly + e * Math.sin(anomaly);
  for (let step = 0; step < 50; step += 1) {
    const delta = (anomaly - (E - e * Math.sin(E))) / (1 - e * Math.cos(E));
    E += delta;
    if (Math.abs(delta) < 1e-13) break;
  }
  const [x, y] = [a * (Math.cos(E) - e), a * Math.sqrt(1 - e * e) * Math.sin(E)];
  const [w, om, i] = [elements.w * DEG, elements.om * DEG, elements.i * DEG];
  const [cw, sw, co, so, ci, si] = [Math.cos(w), Math.sin(w), Math.cos(om), Math.sin(om), Math.cos(i), Math.sin(i)];
  return [
    (cw * co - sw * so * ci) * x + (-sw * co - cw * so * ci) * y,
    (cw * so + sw * co * ci) * x + (-sw * so + cw * co * ci) * y,
    sw * si * x + cw * si * y,
  ];
}

/** Where the telescope is (Earth–Moon barycentre from JPL's approximate elements; SPHEREx is ~7,000 km from Earth). */
export const observerAt = (mjd) => planetPosition('earth', mjd + MJD_TO_JD);

/** Pluto from TENGER's own frozen orbit (our_orbit), or null when the file has none. */
export function plutoOrbit(scene) {
  const ours = scene?.bodies?.pluto?.our_orbit;
  const elements = ours?.elements;
  if (!elements || !['a', 'e', 'i', 'om', 'w', 'ma'].every((key) => Number.isFinite(elements[key])) || !Number.isFinite(ours.epoch_mjd_utc)) return null;
  return (mjd) => keplerPosition(elements, ours.epoch_mjd_utc, mjd);
}

/** The drawn telescope: its real heliocentric position times the exaggeration. */
export const drawnObserver = (observer, factor = EXAGGERATION) => scale(observer, factor);

/** The point where the ray from origin along direction meets a sphere of radius R around the Sun (origin inside). */
export function raySphere(origin, direction, radius) {
  const d = unit(direction);
  const b = dot(origin, d);
  const c = dot(origin, origin) - radius * radius;
  const t = -b + Math.sqrt(Math.max(0, b * b - c));
  return add(origin, scale(d, t));
}

/** A sight line in the drawn picture: from the drawn telescope through Pluto's real position to the sky sphere. */
export function drawnSightline(observer, pluto, radius, factor = EXAGGERATION) {
  const from = drawnObserver(observer, factor);
  return { from, through: pluto, sky: raySphere(from, sub(pluto, from), radius) };
}

/**
 * A sky position (RA/Dec seen from the observer at a known distance) as a 3D point: the observer plus distance
 * along that direction. Used for forecast tracks that give RA/Dec and a geocentric distance.
 */
export const pointFromRadec = (observer, ra, dec, distance) => add(observer, scale(eclipticOfRadec(ra, dec), distance));

/** Pluto's yearly parallax in degrees at a given distance in au: the angle 1 au subtends. */
export const parallaxDeg = (distanceAu) => Math.asin(1 / distanceAu) / DEG;

/** Evenly spaced MJDs from start to end. */
export function timeline(start, end, step = 2) {
  const times = [];
  for (let mjd = start; mjd <= end + 1e-9; mjd += step) times.push(mjd);
  return times;
}

/**
 * Everything the 3D scene and the 2D chart need from scene3d.json and the v2 forecast predictions:
 * training/evaluation exposures, the frozen forecast, the observation, and forecast tracks as 3D points.
 * v2 tracks give RA/Dec with a geocentric distance; the observer for those is Earth at that time.
 */
export function loopModel(scene, v2Forecasts = []) {
  const loop = scene?.pluto_loop;
  const orbit = plutoOrbit(scene);
  if (!loop || !orbit) return null;
  const exposure = (entry) => (Array.isArray(entry?.spherex_au) && Array.isArray(entry?.fitted_pluto_au) && Number.isFinite(entry?.t_mjd)
    ? { tMjd: entry.t_mjd, observer: entry.spherex_au, pluto: entry.fitted_pluto_au, measured: entry.measured ?? null, role: entry.role }
    : null);
  const training = (loop.training ?? []).map(exposure).filter(Boolean);
  const evaluation = (loop.evaluation ?? []).map(exposure).filter(Boolean);
  const v1 = (loop.open_forecast_2027?.track ?? []).filter((point) => Array.isArray(point.earth_au) && Array.isArray(point.fitted_pluto_au))
    .map((point) => ({ tMjd: point.t_mjd, observer: point.earth_au, pluto: point.fitted_pluto_au, ra: point.ra_deg, dec: point.dec_deg }));
  const tracks = [{ id: loop.open_forecast_2027?.trial_id ?? 'v1', version: 1, points: v1 }];
  for (const forecast of v2Forecasts) {
    const points = (forecast.track ?? []).filter((point) => [point.t_mjd, point.ra_deg, point.dec_deg, point.distance_au].every(Number.isFinite))
      .map((point) => {
        const observer = observerAt(point.t_mjd);
        return { tMjd: point.t_mjd, observer, pluto: pointFromRadec(observer, point.ra_deg, point.dec_deg, point.distance_au), ra: point.ra_deg, dec: point.dec_deg };
      });
    if (points.length) tracks.push({ id: forecast.id, version: 2, points });
  }
  const frozen = loop.frozen_forecast;
  const observed = loop.observed;
  const evaluationObserver = Array.isArray(observed?.earth_au) ? observed.earth_au : observerAt(frozen?.t_mjd ?? 0);
  const allTimes = [...training, ...evaluation, ...tracks.flatMap((track) => track.points)].map((point) => point.tMjd);
  return {
    orbit,
    training,
    evaluation,
    tracks: tracks.filter((track) => track.points.length),
    frozen: Array.isArray(frozen?.fitted_pluto_au) ? {
      tMjd: frozen.t_mjd, pluto: frozen.fitted_pluto_au, ra: frozen.ra_deg, dec: frozen.dec_deg, cov: frozen.cov_arcsec2 ?? null, observer: evaluationObserver,
    } : null,
    observed: Number.isFinite(observed?.ra_deg) ? {
      tMjd: observed.t_mjd, ra: observed.ra_deg, dec: observed.dec_deg, verdict: observed.verdict ?? null, d2: observed.d2 ?? null, observer: evaluationObserver,
    } : null,
    start: Math.min(...allTimes) - 20,
    end: Math.max(...allTimes) + 20,
  };
}

/** The apparent (true-scale) path: RA/Dec of Pluto seen from the observer for each time. */
export const truePath = (orbit, times) => times.map((mjd) => ({ tMjd: mjd, ...radecOf(sub(orbit(mjd), observerAt(mjd))) }));
