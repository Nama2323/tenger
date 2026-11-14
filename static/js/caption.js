// What the caption strip says about the picture on a plate: time, wavelength, release, IDs and status.
// Pure: no DOM. Text comes from i18n keys in the page code.
import { DETECTOR_RANGES, WAVE_MAX, WAVE_MIN, channelWavelength, mjdToDate, selectBand } from './stack.js';

export const CONTEXT_STEP = 'wise';
/** The AllWISE context frame is a W2 coadd (backend/wise.py). */
export const ALLWISE_W2_UM = 4.6;

/** Start/end time, releases and observation IDs of a set of frames. */
export function describeFrames(frames) {
  if (!frames.length) return { start: null, end: null, releases: [], obs: [] };
  const times = frames.map((frame) => frame.mjd).filter(Number.isFinite);
  const releases = new Map();
  for (const frame of frames) releases.set(frame.release ?? 'unknown', (releases.get(frame.release ?? 'unknown') ?? 0) + 1);
  const obs = [...new Set(frames.map((frame) => `${frame.obsId ?? '?'} D${frame.detector}`))].sort();
  return {
    start: times.length ? mjdToDate(Math.min(...times)) : null,
    end: times.length ? mjdToDate(Math.max(...times)) : null,
    releases: [...releases.entries()].sort().map(([release, count]) => ({ release, count })),
    obs,
  };
}

function wavelengthOf(band, used) {
  if (band.kind === 'composite') return { kind: 'composite', low: WAVE_MIN, high: WAVE_MAX };
  if (band.kind === 'detector') {
    const [low, high] = DETECTOR_RANGES[band.detector];
    return { kind: 'detector', detector: band.detector, low, high };
  }
  // The legacy channel is an approximate display bin (contract v2.1), so the wavelength is labelled "≈".
  return { kind: 'channel', channel: band.channel, wavelength: channelWavelength(band.channel), present: used.length > 0 };
}

/**
 * One plate's picture. step is a dated visit ({ key, frames }), the AllWISE context step, or null for the
 * median of all dates. difference marks a B − A picture.
 */
export function describePicture({ step, allFrames = [], band = { kind: 'composite' }, difference = false }) {
  if (step?.key === CONTEXT_STEP) {
    return {
      status: 'context',
      combine: 'coadd',
      year: step.year,
      wavelength: { kind: 'allwise', centre: ALLWISE_W2_UM },
      start: null,
      end: null,
      releases: [{ release: 'allwise', count: 1 }],
      obs: [],
      frameCount: 1,
    };
  }
  const pool = step ? step.frames : allFrames;
  const used = selectBand(pool, band);
  const described = describeFrames(used.length ? used : pool);
  let combine = 'median_all';
  if (step) combine = used.length > 1 ? 'median' : 'single';
  return {
    status: difference ? 'difference' : 'processed',
    combine,
    wavelength: wavelengthOf(band, used),
    ...described,
    frameCount: used.length,
  };
}

/** Why two pictures are not like-for-like, as an i18n key, or null. */
export function comparisonWarning(first, second) {
  if (!first || !second) return null;
  if ((first.status === 'context') !== (second.status === 'context')) return 'caption.warnCrossMission';
  if (!first.frameCount || !second.frameCount) return 'caption.warnNoExposure';
  const a = first.wavelength;
  if (a.kind === 'channel') return 'caption.warnChannelLabel';
  if (a.kind === 'composite' || a.kind === 'detector') return 'caption.warnBroadBand';
  return null;
}
