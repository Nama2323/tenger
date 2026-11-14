// Pure maths for the 3D home scene: planet positions from JPL's approximate Keplerian elements, the
// log-distance mapping, frame rotation for star directions, the illustrative Kuiper Belt and the Planet Nine
// range band. No three.js here, so it runs (and is tested) in Node.
//
// Source of the elements and formulae: E. M. Standish, "Keplerian Elements for Approximate Positions of the Major
// Planets", JPL Solar System Dynamics, https://ssd.jpl.nasa.gov/planets/approx_pos.html, Table 1 (mean ecliptic
// and equinox of J2000, valid 1800 AD to 2050 AD). Copied 15 Nov 2026. Nominal errors in that period: 15–600″ in
// heliocentric longitude (Saturn the worst), so this is a picture, not an ephemeris.

const DEG = Math.PI / 180;
export const J2000_JD = 2451545.0;
export const DAYS_PER_CENTURY = 36525;
/** IAU 2006 obliquity of the ecliptic at J2000 (84381.448″), as used by scene3d.json. */
export const OBLIQUITY_RAD = (84381.448 / 3600) * DEG;
export const VALID_YEARS = [1800, 2050];

/**
 * Table 1. Per planet: [value at J2000, rate per Julian century] for a (au), e, I (deg), L (deg), varpi (longitude of
 * perihelion, deg) and Omega (longitude of the ascending node, deg). "earth" is the Earth–Moon barycentre.
 */
export const PLANET_ELEMENTS = {
  mercury: { a: [0.38709927, 0.00000037], e: [0.20563593, 0.00001906], I: [7.00497902, -0.00594749], L: [252.25032350, 149472.67411175], varpi: [77.45779628, 0.16047689], node: [48.33076593, -0.12534081] },
  venus: { a: [0.72333566, 0.00000390], e: [0.00677672, -0.00004107], I: [3.39467605, -0.00078890], L: [181.97909950, 58517.81538729], varpi: [131.60246718, 0.00268329], node: [76.67984255, -0.27769418] },
  earth: { a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392], I: [-0.00001531, -0.01294668], L: [100.46457166, 35999.37244981], varpi: [102.93768193, 0.32327364], node: [0.0, 0.0] },
  mars: { a: [1.52371034, 0.00001847], e: [0.09339410, 0.00007882], I: [1.84969142, -0.00813131], L: [-4.55343205, 19140.30268499], varpi: [-23.94362959, 0.44441088], node: [49.55953891, -0.29257343] },
  jupiter: { a: [5.20288700, -0.00011607], e: [0.04838624, -0.00013253], I: [1.30439695, -0.00183714], L: [34.39644051, 3034.74612775], varpi: [14.72847983, 0.21252668], node: [100.47390909, 0.20469106] },
  saturn: { a: [9.53667594, -0.00125060], e: [0.05386179, -0.00050991], I: [2.48599187, 0.00193609], L: [49.95424423, 1222.49362201], varpi: [92.59887831, -0.41897216], node: [113.66242448, -0.28867794] },
  uranus: { a: [19.18916464, -0.00196176], e: [0.04725744, -0.00004397], I: [0.77263783, -0.00242939], L: [313.23810451, 428.48202785], varpi: [170.95427630, 0.40805281], node: [74.01692503, 0.04240589] },
  neptune: { a: [30.06992276, 0.00026291], e: [0.00859048, 0.00005105], I: [1.77004347, 0.00035372], L: [-55.12002969, 218.45945325], varpi: [44.96476227, -0.32241464], node: [131.78422574, -0.00508664] },
};
export const PLANETS = Object.keys(PLANET_ELEMENTS);

/** Julian date (UTC treated as TDB: the 69 s difference moves no planet visibly). */
export const julianDate = (date) => date.getTime() / 86400000 + 2440587.5;

const wrap180 = (degrees) => ((((degrees + 180) % 360) + 360) % 360) - 180;

/** Kepler's equation M = E − e·sin E (radians), Newton iteration as in the JPL note. */
export function solveKepler(meanAnomaly, eccentricity, tolerance = 1e-12) {
  let anomaly = meanAnomaly + eccentricity * Math.sin(meanAnomaly);
  for (let step = 0; step < 50; step += 1) {
    const delta = (meanAnomaly - (anomaly - eccentricity * Math.sin(anomaly))) / (1 - eccentricity * Math.cos(anomaly));
    anomaly += delta;
    if (Math.abs(delta) <= tolerance) break;
  }
  return anomaly;
}

/** The six elements at a Julian date, plus omega and M (degrees). */
export function elementsAt(planet, jd) {
  const table = PLANET_ELEMENTS[planet];
  if (!table) throw new Error(`unknown planet ${planet}`);
  const centuries = (jd - J2000_JD) / DAYS_PER_CENTURY;
  const at = ([value, rate]) => value + rate * centuries;
  const elements = { a: at(table.a), e: at(table.e), I: at(table.I), L: at(table.L), varpi: at(table.varpi), node: at(table.node) };
  return { ...elements, omega: elements.varpi - elements.node, M: wrap180(elements.L - elements.varpi) };
}

/** Orbital-plane coordinates (x', y') rotated into the J2000 ecliptic frame. */
function toEcliptic(x, y, { omega, node, I }) {
  const [cw, sw, cn, sn, ci, si] = [Math.cos(omega * DEG), Math.sin(omega * DEG), Math.cos(node * DEG), Math.sin(node * DEG), Math.cos(I * DEG), Math.sin(I * DEG)];
  return [
    (cw * cn - sw * sn * ci) * x + (-sw * cn - cw * sn * ci) * y,
    (cw * sn + sw * cn * ci) * x + (-sw * sn + cw * cn * ci) * y,
    sw * si * x + cw * si * y,
  ];
}

/** Heliocentric ecliptic J2000 position in au. */
export function planetPosition(planet, jd) {
  const elements = elementsAt(planet, jd);
  const anomaly = solveKepler(elements.M * DEG, elements.e);
  const x = elements.a * (Math.cos(anomaly) - elements.e);
  const y = elements.a * Math.sqrt(1 - elements.e ** 2) * Math.sin(anomaly);
  return toEcliptic(x, y, elements);
}

/**
 * A small body's osculating elements from scene3d.json (`catalogue_orbit`: JPL Small-Body Database, heliocentric
 * ecliptic J2000, with its epoch), or null when any needed element is missing. Nothing is filled in or assumed.
 */
export function smallBodyElements(orbit) {
  const value = (name) => orbit?.elements?.[name]?.value;
  const elements = { a: value('a'), e: value('e'), i: value('i'), node: value('om'), omega: value('w'), M0: value('ma'), n: value('n') };
  const epoch = orbit?.epoch_jd_tdb;
  if (!Number.isFinite(epoch) || !Object.values(elements).every(Number.isFinite) || elements.e >= 1) return null;
  return { ...elements, epoch };
}

/** Heliocentric ecliptic J2000 position (au) of a small body at a Julian date: two-body, Kepler's equation. */
export function smallBodyPosition(elements, jd) {
  const M = ((((elements.M0 + elements.n * (jd - elements.epoch)) % 360) + 360) % 360) * DEG;
  const anomaly = solveKepler(M, elements.e);
  const x = elements.a * (Math.cos(anomaly) - elements.e);
  const y = elements.a * Math.sqrt(1 - elements.e ** 2) * Math.sin(anomaly);
  return toEcliptic(x, y, { omega: elements.omega, node: elements.node, I: elements.i });
}

/** The whole orbit at the elements of that date, as `count` points evenly spaced in eccentric anomaly. */
export function orbitPoints(planet, jd, count = 256) {
  const elements = elementsAt(planet, jd);
  const minor = elements.a * Math.sqrt(1 - elements.e ** 2);
  return Array.from({ length: count }, (_, index) => {
    const anomaly = (2 * Math.PI * index) / count;
    return toEcliptic(elements.a * (Math.cos(anomaly) - elements.e), minor * Math.sin(anomaly), elements);
  });
}

/** ICRS (equatorial) unit vector → ecliptic J2000 (rotation about x by −ε). */
export function equatorialToEcliptic([x, y, z]) {
  const [c, s] = [Math.cos(OBLIQUITY_RAD), Math.sin(OBLIQUITY_RAD)];
  return [x, c * y + s * z, -s * y + c * z];
}

/**
 * The scene's distance scale: radius R = UNIT · log10(1 + r / r0). It keeps the direction of every position and
 * squeezes 0.4 au to 1,000 au into one picture. Not to scale, and labelled so on screen.
 */
export const LOG_SCALE = { r0: 0.25, unit: 10 };
export const scaledRadius = (au, scale = LOG_SCALE) => scale.unit * Math.log10(1 + Math.max(0, au) / scale.r0);
export const unscaledRadius = (radius, scale = LOG_SCALE) => scale.r0 * (10 ** (radius / scale.unit) - 1);

/** Maps an au vector to scene units along the same direction. */
export function scalePosition(vector, scale = LOG_SCALE) {
  const length = Math.hypot(...vector);
  if (!(length > 0)) return [0, 0, 0];
  const factor = scaledRadius(length, scale) / length;
  return vector.map((part) => part * factor);
}

/** Deterministic random numbers (mulberry32), so the illustrative belt looks the same on every visit. */
export function seededRandom(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * An illustrative Kuiper Belt: `count` points with semi-major axes 30–50 au, small eccentricities and inclinations,
 * at random places on their orbits. Not observed objects.
 */
export function kuiperBelt(count = 1500, seed = 2026, { inner = 30, outer = 50 } = {}) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, () => {
    const a = inner + (outer - inner) * random();
    const e = 0.15 * random() ** 2;
    const elements = { omega: 360 * random(), node: 360 * random(), I: 12 * (random() + random() - 1) };
    const anomaly = 2 * Math.PI * random();
    return toEcliptic(a * (Math.cos(anomaly) - e), a * Math.sqrt(1 - e ** 2) * Math.sin(anomaly), elements);
  });
}

/** A {min,max} or {value,plus,minus} range from scene3d.json as [low, high], or null. */
export function rangeOf(quantity) {
  if (!quantity) return null;
  if (Number.isFinite(quantity.min) && Number.isFinite(quantity.max)) return [quantity.min, quantity.max];
  if (Number.isFinite(quantity.value) && Number.isFinite(quantity.plus) && Number.isFinite(quantity.minus)) {
    return [quantity.value - quantity.minus, quantity.value + quantity.plus];
  }
  return null;
}

/**
 * Planet Nine from scene3d.json: every published semi-major-axis range, in the file's (publication) order, each with
 * its citation. The file deliberately gives no position or orbit, so these ranges are all that may be drawn.
 * Empty when the file states none (then only the label is drawn).
 */
export function planetNineRanges(planetNine) {
  if (planetNine?.status !== 'hypothetical') return [];
  return (planetNine.estimates ?? []).flatMap((estimate) => {
    const range = rangeOf(estimate?.semimajor_axis_au);
    if (!range || !(range[0] > 0 && range[1] > range[0])) return [];
    return [{ low: range[0], high: range[1], reference: estimate.reference ?? '', doi: estimate.doi ?? null }];
  });
}

/** Angle between two vectors in arcseconds. */
export function separationArcsec(first, second) {
  const dot = first.reduce((sum, part, index) => sum + part * second[index], 0);
  const cosine = dot / (Math.hypot(...first) * Math.hypot(...second));
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) / DEG) * 3600;
}
