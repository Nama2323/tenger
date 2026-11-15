// "What Vestigium can and can't do" (task B19): the numbers in the dialog, read from the data files, never typed
// in. Pure: documents in, numbers out.
import { glanceOf } from './planetx.js';

/**
 * barnard: Barnard's Star investigation.json; depth: planetx/depth.json read by readDepth().
 * gaiaPct: how far our measured total proper motion is from Gaia's, in percent, rounded UP to 0.1 (so "within"
 * stays true); blendArcsec: the fit radius inside which two sources merge (pipeline core_radius_arcsec);
 * injected: artificial planets in the pooled recovery curves; low/high: magnitudes the nominal Planet Nine is too
 * faint for one image. Any value the files do not give is null, and the sentence is shown without it.
 */
export function limitsNumbers({ barnard = null, depth = null } = {}) {
  const motion = barnard?.explanation?.find((item) => item?.key === 'explain.motion-measured')?.params;
  const gaiaPct = Number.isFinite(motion?.value) && Number.isFinite(motion?.catalogue) && motion.catalogue > 0
    ? Math.ceil((Math.abs(motion.value - motion.catalogue) / motion.catalogue) * 1000 - 1e-9) / 10 : null;
  const radius = barnard?.pipeline?.settings?.core_radius_arcsec;
  const injected = depth?.bands?.length ? depth.bands.reduce((sum, band) => sum + band.curve.reduce((count, point) => count + (Number.isFinite(point.injected) ? point.injected : 0), 0), 0) : null;
  const glance = depth ? glanceOf(depth) : null;
  return {
    gaiaPct, blendArcsec: Number.isFinite(radius) ? radius : null, injected: injected || null,
    low: glance?.low ?? null, high: glance?.high ?? null,
  };
}
