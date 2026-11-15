// Plain words for the target view (task B17): one line saying what a target is and how far away, and the
// finding under the image compared with the full Moon. Pure: numbers in, text out (strings from js/i18n.js).
import { has, t } from './i18n.js';
import { AU_PER_UNIT } from './map.js';
import { colourOf } from './targets.js';

/** The full Moon's apparent width, about 31 arcminutes (it ranges 29.3′–34.1′ over the Moon's orbit). */
export const FULL_MOON_ARCSEC = 31 * 60;

/** Light-years for a {value, unit} distance in pc or ly; null for Solar System units or none. */
export function lightYears(distance) {
  const value = Number(distance?.value);
  if (!distance || !Number.isFinite(value) || value <= 0) return null;
  // The same constants as the map and the target list, so the numbers agree everywhere.
  if (distance.unit === 'pc') return (value * AU_PER_UNIT.pc) / AU_PER_UNIT.ly;
  if (distance.unit === 'ly') return value;
  return null;
}

/** "6", "7.4", "598", "2,500,000": whole numbers from 10 light-years up, one decimal below (no ".0"). */
export function formatLightYears(ly) {
  return new Intl.NumberFormat('en', { maximumFractionDigits: ly >= 10 ? 0 : 1 }).format(ly);
}

/**
 * One plain line under a target's name: "A fast-moving star, 6 light-years away.", "A dwarf planet in our Solar
 * System.", or for a position the visitor chose, "A position you chose in the sky." kind and distance come from
 * the site's data files.
 */
export function plainLine({ kind, distance } = {}) {
  if (!kind || kind === 'custom') return t('plain.custom');
  const noun = has(`plain.kind.${kind}`) ? t(`plain.kind.${kind}`) : t('plain.kind.other');
  if (colourOf(kind) === 'solar') return has(`plain.solar.${kind}`) ? t(`plain.solar.${kind}`) : t('plain.solar', { noun });
  const ly = lightYears(distance);
  return ly === null ? t('plain.noDistance', { noun }) : t('plain.far', { noun, ly: formatLightYears(ly) });
}

/**
 * The number a count-up shows after elapsedMs of durationMs (task B28): from 0 to value with an ease-out, never
 * below 0 or past the value (progress is clamped, so a frame time slightly before the start cannot go negative).
 */
export function countUpShown(value, elapsedMs, durationMs) {
  if (!Number.isFinite(value)) return value;
  const progress = durationMs > 0 ? Math.max(0, Math.min(1, elapsedMs / durationMs)) : 1;
  return progress >= 1 ? value : value * (1 - (1 - progress) ** 3);
}

const FRACTIONS = [[2, 'half'], [3, 'third'], [4, 'quarter'], [5, 'fifth'], [10, 'tenth'], [20, 'twentieth'], [50, 'fiftieth'], [100, 'hundredth']];

/**
 * How a shift on the sky compares with the full Moon: "about a tenth of the full Moon's width" (168″),
 * "about half of …", "about 2 times …". Below a hundredth it says so; the nearest listed fraction wins.
 */
export function moonShare(arcsec) {
  if (!Number.isFinite(arcsec) || arcsec <= 0) return null;
  const ratio = arcsec / FULL_MOON_ARCSEC;
  if (ratio >= 0.75) return t('moon.times', { n: new Intl.NumberFormat('en', { maximumFractionDigits: ratio < 10 ? 1 : 0 }).format(ratio) });
  if (ratio < 1 / 150) return t('moon.tiny');
  const [, word] = FRACTIONS.reduce((best, item) => (Math.abs(Math.log(ratio * item[0])) < Math.abs(Math.log(ratio * best[0])) ? item : best));
  return t(`moon.${word}`);
}
