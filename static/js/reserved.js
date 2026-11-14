// Sky regions where live loading is paused until their predictions are frozen.
// Source: docs/EXPOSURE.md, rule 4 ("do not start live jobs within 2° of any of the eight targets").
// A live job downloads up to 150 current exposures, which would expose reserved observations.
// Prepared (bundled) frames of these targets stay viewable: they are already exposed.
// 3I/ATLAS is See-only (no trial) and has no path here; Session A can add regions in a later version.
import { separationDeg } from './coords.js';

export const RESERVED_MARGIN_DEG = 2;

export const RESERVED_REGIONS = [
  { key: 'barnard', ra: 269.4465, dec: 4.7687 },
  { key: 'wise0855', ra: 133.7595, dec: -7.2422 },
  { key: 'epsindib', ra: 331.0964, dec: -56.8011 },
  { key: 'rwaur', ra: 76.9565, dec: 30.4012 },
  { key: 'rdra', ra: 248.1672, dec: 66.7551 },
  // Moving bodies: the box spans their observed 2025-26 path (docs/EXPOSURE.md).
  { key: 'makemake', ra: [199.8, 202.4], dec: [20.1, 21.6] },
  { key: 'pluto', ra: [304.1, 308.6], dec: [-23.8, -22.8] },
];

const raGap = (ra, edge) => {
  const gap = Math.abs(ra - edge) % 360;
  return gap > 180 ? 360 - gap : gap;
};

/** Distance in degrees from a position to a region (a point, or an RA/Dec box). */
export function distanceToRegion(ra, dec, region) {
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
  const reach = RESERVED_MARGIN_DEG + (Math.max(0, fov) / 2) * Math.SQRT2;
  let closest = null;
  for (const region of RESERVED_REGIONS) {
    const distance = distanceToRegion(ra, dec, region);
    if (distance <= reach && (!closest || distance < closest.distance)) closest = { ...region, distance };
  }
  return closest;
}
