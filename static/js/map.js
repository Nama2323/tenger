// Geometry of the schematic logarithmic distance map. Pure: no DOM.
// The map is an illustration: radius grows with log10(distance), angles are arbitrary (from the index).
export const AU_PER_UNIT = {
  au: 1,
  pc: 206264.80624709636,
  ly: 63241.07708426628,
  kpc: 206264806.24709636,
};
export const MAP_MIN_AU = 1;
export const MAP_MAX_AU = 1e9;
/** Fractions of the map's width: the Sun's clear zone and the outer ring. */
export const INNER_RADIUS = 0.07;
export const OUTER_RADIUS = 0.47;

export const RINGS = [
  { au: 1, value: 1, unit: 'au' },
  { au: 10, value: 10, unit: 'au' },
  { au: 100, value: 100, unit: 'au' },
  { au: 1000, value: 1000, unit: 'au' },
  { au: AU_PER_UNIT.ly, value: 1, unit: 'ly' },
  { au: 10 * AU_PER_UNIT.ly, value: 10, unit: 'ly' },
  { au: 100 * AU_PER_UNIT.ly, value: 100, unit: 'ly' },
  { au: 1000 * AU_PER_UNIT.ly, value: 1000, unit: 'ly' },
  { au: 10000 * AU_PER_UNIT.ly, value: 10000, unit: 'ly' },
];

/** A cited distance in au, or null if it is missing or not usable. */
export function distanceInAu(distance) {
  if (!distance || typeof distance !== 'object') return null;
  const factor = AU_PER_UNIT[distance.unit];
  const value = Number(distance.value);
  if (!factor || distance.value === null || !Number.isFinite(value) || value <= 0) return null;
  return value * factor;
}

/** Radius as a fraction of the map width, and whether the value was clamped to the map's range. */
export function mapRadius(au) {
  const low = Math.log10(MAP_MIN_AU);
  const high = Math.log10(MAP_MAX_AU);
  const raw = (Math.log10(au) - low) / (high - low);
  const fraction = Math.min(1, Math.max(0, raw));
  return {
    r: INNER_RADIUS + fraction * (OUTER_RADIUS - INNER_RADIUS),
    clamped: raw < 0 ? 'below' : raw > 1 ? 'above' : null,
  };
}

/**
 * Where an index entry's marker goes: { x, y } as fractions of the map (y down), or null when the entry has
 * no usable distance or angle. An angle that is not flagged arbitrary is refused: the map must not imply
 * real sky directions.
 */
export function placeOnMap(map) {
  const au = distanceInAu(map?.distance);
  if (au === null || map.angle_is_arbitrary !== true || !Number.isFinite(map.angle_deg)) return null;
  const { r, clamped } = mapRadius(au);
  const angle = (map.angle_deg * Math.PI) / 180;
  return { x: 0.5 + r * Math.cos(angle), y: 0.5 - r * Math.sin(angle), r, au, clamped };
}
