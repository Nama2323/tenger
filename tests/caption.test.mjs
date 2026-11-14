import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonWarning, CONTEXT_STEP, describeFrames, describePicture } from '../static/js/caption.js';

const frame = (mjd, detector, channel, release, obsId) => ({ mjd, detector, channel, release, obsId, pixels: new Float32Array(1) });
const visitA = { key: 0, frames: [frame(60902.5, 1, 3, 'spherex_qr2', 'OBS_A'), frame(60902.6, 3, 40, 'spherex_qr2', 'OBS_A')] };
const visitB = { key: 1, frames: [frame(61270.5, 1, 5, 'spherex_qr3', 'OBS_B'), frame(61271.0, 3, 40, 'spherex_dr1', 'OBS_C')] };

test('frames give a time range, releases with counts and explicit observation IDs', () => {
  const described = describeFrames(visitB.frames);
  assert.equal(described.start.toISOString().slice(0, 10), '2026-08-18');
  assert.ok(described.end > described.start);
  assert.deepEqual(described.releases, [{ release: 'spherex_dr1', count: 1 }, { release: 'spherex_qr3', count: 1 }]);
  assert.deepEqual(described.obs, ['OBS_B D1', 'OBS_C D3']);
});

test('a dated visit is processed; the AllWISE frame is context; B − A is a difference', () => {
  assert.equal(describePicture({ step: visitA }).status, 'processed');
  assert.equal(describePicture({ step: visitA }).combine, 'median');
  assert.equal(describePicture({ step: null, allFrames: [...visitA.frames, ...visitB.frames] }).combine, 'median_all');
  const context = describePicture({ step: { key: CONTEXT_STEP, year: 2010.5, frames: [{}] } });
  assert.equal(context.status, 'context');
  assert.equal(context.wavelength.kind, 'allwise');
  assert.equal(describePicture({ step: visitB, difference: true }).status, 'difference');
});

// Contract v2.4: never substitute the nearest channel; a date without the channel says so.
test('a single channel is never replaced by a neighbouring one', () => {
  const exact = describePicture({ step: visitA, band: { kind: 'channel', channel: 40 } });
  assert.equal(exact.wavelength.channel, 40);
  assert.equal(exact.wavelength.present, true);
  assert.equal(exact.frameCount, 1);
  const missing = describePicture({ step: visitA, band: { kind: 'channel', channel: 4 } });
  assert.equal(missing.wavelength.channel, 4);
  assert.equal(missing.wavelength.present, false);
  assert.equal(missing.frameCount, 0);
});

test('A/B warnings: cross-mission, missing exposure, approximate channels, broad bands', () => {
  const context = describePicture({ step: { key: CONTEXT_STEP, year: 2010.5, frames: [{}] } });
  assert.equal(comparisonWarning(context, describePicture({ step: visitB })), 'caption.warnCrossMission');
  const a = describePicture({ step: visitA, band: { kind: 'channel', channel: 5 } });
  const b = describePicture({ step: visitB, band: { kind: 'channel', channel: 5 } });
  assert.equal(comparisonWarning(a, b), 'caption.warnNoExposure');
  const same = describePicture({ step: visitA, band: { kind: 'channel', channel: 40 } });
  const sameB = describePicture({ step: visitB, band: { kind: 'channel', channel: 40 } });
  assert.equal(comparisonWarning(same, sameB), 'caption.warnChannelLabel');
  assert.equal(comparisonWarning(describePicture({ step: visitA }), describePicture({ step: visitB })), 'caption.warnBroadBand');
});
