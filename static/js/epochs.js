// Investigation epochs and comparisons (DATA-CONTRACT V1 §5 and V3.1) seen from the viewer.
// Since A3 an epoch is one detector array in one visit (id "v<visit>-d<array>") and epochs[].viewer.visit
// equals the frames' visit field, so the viewer's dated step for a visit holds the epochs of all six arrays.
// Comparisons exist only between epochs of the same array. Pure: no DOM.
import { detectorOfChannel } from './stack.js';

export function parseObsKey(key) {
  const match = /^([^:]+):([^:]+):D(\d+)$/.exec(String(key ?? ''));
  return match ? { collection: match[1], obsId: match[2], detector: Number(match[3]) } : null;
}

/** The array a band belongs to, or null for the all-band composite (which mixes arrays). */
export function arrayOfBand(band) {
  if (band?.kind === 'detector') return band.detector;
  if (band?.kind === 'channel') return detectorOfChannel(band.channel);
  return null;
}

const epochDetector = (epoch) => epoch.detector ?? Number(/-d(\d+)$/.exec(epoch.id ?? '')?.[1]);

/** The epoch of one array in one viewer visit. */
export function epochAt(epochs, visit, detector) {
  return (Array.isArray(epochs) ? epochs : [])
    .find((epoch) => epoch?.viewer?.visit === visit && epochDetector(epoch) === detector) ?? null;
}

/**
 * The evidence file's comparison for the viewer's A and B visits in the chosen band.
 * reason: null when found; 'composite' (choose one array), 'context' (AllWISE step), 'no-epoch' or 'no-comparison'.
 */
export function pairComparison(doc, visitA, visitB, band) {
  if (!doc) return { comparison: null, reason: 'no-epoch' };
  if (visitA === null || visitB === null) return { comparison: null, reason: 'context' };
  const detector = arrayOfBand(band);
  if (detector === null) return { comparison: null, reason: 'composite' };
  const a = epochAt(doc.epochs, visitA, detector);
  const b = epochAt(doc.epochs, visitB, detector);
  if (!a || !b) return { comparison: null, reason: 'no-epoch', detector };
  const comparison = (doc.comparisons ?? []).find((item) => (item.a === a.id && item.b === b.id)
    || (item.a === b.id && item.b === a.id)) ?? null;
  return { comparison, a: a.id, b: b.id, detector, reason: comparison ? null : 'no-comparison' };
}

/** A difference image needs a comparison whose modes include it (brightness and field both quantitative). */
export const allowsDifference = (comparison) => Boolean(comparison)
  && comparison.grade === 'quantitative' && (comparison.modes ?? []).includes('difference');

/** Grade and reason keys of a comparison, from the V3 blocks (brightness, position, field) or V1 reason_keys. */
export function comparisonReasons(comparison) {
  if (!comparison) return [];
  const blocks = ['brightness', 'position', 'field'].map((name) => comparison[name])
    .filter((block) => block && typeof block === 'object').map((block) => block.reason_key);
  return [...new Set([...blocks, ...(comparison.reason_keys ?? [])].filter(Boolean))];
}

/** How many of the file's epochs point at a visit the viewer has. */
export function epochCoverage(doc, visits) {
  const epochs = Array.isArray(doc?.epochs) ? doc.epochs : [];
  const known = new Set(visits);
  return { matched: epochs.filter((epoch) => known.has(epoch?.viewer?.visit)).length, total: epochs.length };
}
