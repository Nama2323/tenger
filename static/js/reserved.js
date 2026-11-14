// Sky regions where live loading is paused until their predictions are frozen and checked (released ones no longer block).
// Authoritative source: static/data/reserved.json (DATA-CONTRACT V3.3, Session A). A request is refused when
// its centre lies within margin_deg plus half the field diagonal of any point of a region's path (the
// RA/Dec box is only a summary). If the file is missing or cannot be read, the built-in copy of
// docs/EXPOSURE.md rule 4 below is used. Reserved regions always come from real data, never fixtures.
// A live job downloads up to 150 current exposures, which would expose reserved observations.
// Prepared (bundled) frames of these targets stay viewable: they are already exposed.
import { separationDeg } from './coords.js';

export const RESERVED_MARGIN_DEG = 2;
export const RESERVED_PATH = 'data/reserved.json';

export const BUILT_IN_REGIONS = [
  { key: 'barnard', ra: 269.4465, dec: 4.7687 },
  { key: 'wise0855', ra: 133.7595, dec: -7.2422 },
  { key: 'epsindib', ra: 331.0964, dec: -56.8011 },
  { key: 'rwaur', ra: 76.9565, dec: 30.4012 },
  { key: 'rdra', ra: 248.1672, dec: 66.7551 },
  // Moving bodies: the box spans their observed 2025-26 path (docs/EXPOSURE.md).
  { key: 'makemake', ra: [199.8, 202.4], dec: [20.1, 21.6] },
  { key: 'pluto', ra: [304.1, 308.6], dec: [-23.8, -22.8] },
];
/** Kept for older imports and tests: the built-in list. */
export const RESERVED_REGIONS = BUILT_IN_REGIONS;

let active = { regions: BUILT_IN_REGIONS, margin: RESERVED_MARGIN_DEG, source: 'built-in' };

const isRange = (value) => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && value[0] <= value[1];

const validPoint = (point) => Number.isFinite(point?.ra_deg) && Number.isFinite(point?.dec_deg)
  && point.ra_deg >= 0 && point.ra_deg < 360 && Math.abs(point.dec_deg) <= 90;

/**
 * V10: a region is lifted only when the file says `status: "released"` with a reason; anything else (no status,
 * an unknown status) keeps it reserved. Fail closed.
 */
function statusOf(item) {
  const released = item.status === 'released' && typeof item.release_reason_key === 'string';
  return {
    status: released ? 'released' : 'reserved',
    reasonKey: released ? item.release_reason_key : item.reason_key ?? null,
    untilKey: released ? null : item.until_key ?? null,
  };
}

/**
 * One region from the file: a path of points (V3.3), else a point (ra/dec or ra_deg/dec_deg) or a box
 * (two-number ranges). Null if malformed.
 */
function normaliseRegion(item) {
  if (!item || typeof item !== 'object' || typeof item.key !== 'string') return null;
  if (item.path !== undefined) {
    if (!Array.isArray(item.path) || !item.path.length || !item.path.every(validPoint)) return null;
    return {
      key: item.key,
      kind: item.kind ?? null,
      path: item.path.map((point) => ({ ra: point.ra_deg, dec: point.dec_deg })),
      ...statusOf(item),
    };
  }
  const ra = item.ra_range_deg ?? item.ra_deg ?? item.ra;
  const dec = item.dec_range_deg ?? item.dec_deg ?? item.dec;
  if (Number.isFinite(ra) && Number.isFinite(dec) && ra >= 0 && ra < 360 && Math.abs(dec) <= 90) return { key: item.key, ra, dec, ...statusOf(item) };
  if (isRange(ra) && isRange(dec)) return { key: item.key, ra: [...ra], dec: [...dec], ...statusOf(item) };
  return null;
}

/**
 * Reads a reserved-regions document. It is used only if it is a tenger.reserved…/1 file whose regions all
 * parse; otherwise null is returned and the built-in list stays in force (fail closed, never open).
 */
export function parseReserved(doc) {
  if (!doc || !/^tenger\.reserved[a-z_]*\/1$/.test(doc.schema_version ?? '') || doc.example === true) return null;
  if (!Array.isArray(doc.regions) || !doc.regions.length) return null;
  const regions = doc.regions.map(normaliseRegion);
  if (regions.some((region) => region === null)) return null;
  const margin = doc.margin_deg ?? RESERVED_MARGIN_DEG;
  if (!(Number.isFinite(margin) && margin >= 0)) return null;
  return { regions, margin, source: 'file' };
}

export function useReserved(parsed) {
  active = parsed ?? { regions: BUILT_IN_REGIONS, margin: RESERVED_MARGIN_DEG, source: 'built-in' };
  return active;
}

export const reservedSource = () => active.source;

/** Every region in force with its status, for the list on About (built-in regions are all reserved). */
export const reservedRegions = () => active.regions.map((region) => ({ status: 'reserved', ...region }));

/** Fetches data/reserved.json and makes it active when valid; returns the source in force. */
export async function loadReserved(fetchImpl = (...args) => fetch(...args)) {
  try {
    const response = await fetchImpl(RESERVED_PATH, { cache: 'no-cache' });
    if (!response.ok) return useReserved(null).source;
    return useReserved(parseReserved(await response.json())).source;
  } catch {
    return useReserved(null).source;
  }
}

const raGap = (ra, edge) => {
  const gap = Math.abs(ra - edge) % 360;
  return gap > 180 ? 360 - gap : gap;
};

/** Distance in degrees from a position to a region (a path of points, a point, or an RA/Dec box). */
export function distanceToRegion(ra, dec, region) {
  if (region.path) return Math.min(...region.path.map((point) => separationDeg(ra, dec, point.ra, point.dec)));
  if (!Array.isArray(region.ra)) return separationDeg(ra, dec, region.ra, region.dec);
  const [raLow, raHigh] = region.ra;
  const [decLow, decHigh] = region.dec;
  const nearestDec = Math.min(decHigh, Math.max(decLow, dec));
  const inside = ra >= raLow && ra <= raHigh;
  const nearestRa = inside ? ra : raGap(ra, raLow) <= raGap(ra, raHigh) ? raLow : raHigh;
  return separationDeg(ra, dec, nearestRa, nearestDec);
}

/** The reserved region a live request would touch: its centre within the margin plus half the field's diagonal. */
export function reservedRegionNear(ra, dec, fov = 0) {
  const reach = active.margin + (Math.max(0, fov) / 2) * Math.SQRT2;
  let closest = null;
  for (const region of active.regions) {
    // A released path (its trial verified, or frozen with nothing to verify) no longer blocks live loading.
    if (region.status === 'released') continue;
    const distance = distanceToRegion(ra, dec, region);
    if (distance <= reach && (!closest || distance < closest.distance)) closest = { ...region, distance };
  }
  return closest;
}
