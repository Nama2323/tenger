// The 3D scene's orbit maths against published positions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  equatorialToEcliptic, julianDate, kuiperBelt, LOG_SCALE, orbitPoints, planetNineRanges, planetPosition, PLANETS,
  rangeOf, scaledRadius, scalePosition, separationArcsec, solveKepler, unscaledRadius,
} from '../static/js/orbits.js';

const scene = JSON.parse(readFileSync(fileURLToPath(new URL('../static/data/scene3d.json', import.meta.url)), 'utf8'));
const EPOCH = 2461358.5; // 2026-11-14 00:00 TDB, the epoch of scene3d.json

// JPL Horizons API (v1.2), 15 Nov 2026: heliocentric (500@10) ecliptic J2000 vectors at JD 2461358.5 TDB, au.
// Ephemerides: DE441 (Mercury, Mars, Saturn), jup365, ura184, nep098.
const HORIZONS = {
  mercury: [-5.506162458356689e-2, 3.053255013831533e-1, 3.000253050928545e-2],
  mars: [-4.582101466393467e-1, 1.540546502862178, 4.351945733777984e-2],
  jupiter: [-3.737777774231429, 3.786495429369319, 6.789869671205570e-2],
  saturn: [9.196378739456426, 2.006564360266400, -4.010187135258003e-1],
  uranus: [8.775136058809652, 1.733918480131576e1, -4.938261210621020e-2],
  neptune: [2.982971946030040e1, 1.518813806649173, -7.186968189061000e-1],
};
// JPL's nominal errors of the approximate elements for 1800–2050: longitude and latitude (″), distance (1000 km).
const NOMINAL = {
  mercury: [15, 1, 1], mars: [40, 2, 25], jupiter: [400, 10, 600], saturn: [600, 25, 1500], uranus: [50, 2, 1000], neptune: [10, 1, 200],
};
const AU_KM = 149597870.7;
const TOLERANCE_FACTOR = 3;

test('Kepler solver is exact for circles and converges for eccentric orbits', () => {
  assert.equal(solveKepler(1.2, 0), 1.2);
  for (const e of [0.01, 0.2, 0.6, 0.9]) {
    for (const M of [-3, -1, 0.1, 2.5]) {
      const E = solveKepler(M, e);
      assert.ok(Math.abs(E - e * Math.sin(E) - M) < 1e-10, `e=${e} M=${M}`);
    }
  }
});

test('planet positions agree with JPL Horizons within 3× the published nominal error', () => {
  for (const [planet, reference] of Object.entries(HORIZONS)) {
    const [longitude, latitude, distanceKm] = NOMINAL[planet];
    const position = planetPosition(planet, EPOCH);
    const angle = separationArcsec(position, reference);
    const radial = Math.abs(Math.hypot(...position) - Math.hypot(...reference));
    assert.ok(angle < TOLERANCE_FACTOR * (longitude + latitude), `${planet}: ${angle.toFixed(1)}″ off`);
    assert.ok(radial < TOLERANCE_FACTOR * distanceKm * 1000 / AU_KM, `${planet}: ${radial.toFixed(5)} au off in distance`);
  }
});

test('the Earth–Moon barycentre lands on the Earth position in scene3d.json (Horizons DE441)', () => {
  const earth = scene.bodies.earth.position_now.position_au;
  const position = planetPosition('earth', scene.epoch_jd_tdb);
  // The barycentre is 4,700 km from Earth (about 6″ seen from the Sun) plus 20″ nominal error.
  assert.ok(separationArcsec(position, earth) < 60, `${separationArcsec(position, earth)}″`);
  assert.ok(Math.abs(Math.hypot(...position) - Math.hypot(...earth)) < 0.0002);
});

test('julianDate matches the J2000 and scene epochs', () => {
  assert.equal(julianDate(new Date(Date.UTC(2000, 0, 1, 12))), 2451545);
  assert.equal(julianDate(new Date(Date.UTC(2026, 10, 14, 0))), 2461358.5);
});

test('orbit lines pass through the planet and every planet is listed', () => {
  assert.deepEqual(PLANETS, ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']);
  for (const planet of PLANETS) {
    const points = orbitPoints(planet, EPOCH, 720);
    const position = planetPosition(planet, EPOCH);
    const closest = Math.min(...points.map((point) => Math.hypot(...point.map((part, index) => part - position[index]))));
    assert.ok(closest < 0.01 * Math.hypot(...position), `${planet} is off its orbit line by ${closest}`);
  }
});

test('the log scale keeps direction, orders distances and inverts', () => {
  assert.equal(scaledRadius(0), 0);
  const radii = [0.39, 1, 5.2, 30, 50, 400, 1000].map((au) => scaledRadius(au));
  for (let index = 1; index < radii.length; index += 1) assert.ok(radii[index] > radii[index - 1]);
  for (const au of [0.5, 7, 45, 900]) assert.ok(Math.abs(unscaledRadius(scaledRadius(au)) - au) < 1e-9 * au);
  const scaled = scalePosition([3, 4, 0]);
  assert.ok(Math.abs(Math.hypot(...scaled) - scaledRadius(5)) < 1e-12);
  assert.ok(Math.abs(scaled[0] / scaled[1] - 0.75) < 1e-12);
  assert.deepEqual(scalePosition([0, 0, 0]), [0, 0, 0]);
  assert.equal(LOG_SCALE.unit, 10);
});

test('star directions rotate from ICRS into the ecliptic frame', () => {
  // The north celestial pole sits 23.44° from the ecliptic pole; the vernal equinox direction is unchanged.
  const pole = equatorialToEcliptic([0, 0, 1]);
  assert.ok(Math.abs(Math.acos(pole[2]) * 180 / Math.PI - 23.4393) < 1e-3);
  assert.deepEqual(equatorialToEcliptic([1, 0, 0]), [1, 0, 0]);
  for (const star of scene.stars) assert.ok(Math.abs(Math.hypot(...equatorialToEcliptic(star.direction_icrs)) - 1) < 1e-3, star.key);
});

test('the Kuiper Belt illustration stays between 30 and 50 au and is the same on every visit', () => {
  const belt = kuiperBelt(400);
  assert.deepEqual(belt, kuiperBelt(400));
  for (const point of belt) {
    const distance = Math.hypot(...point);
    assert.ok(distance > 30 * 0.85 && distance < 50 * 1.15, String(distance));
  }
});

test('Planet Nine is drawn only as the published semi-major-axis ranges, each with its citation', () => {
  assert.deepEqual(rangeOf({ min: 380, max: 980 }), [380, 980]);
  assert.deepEqual(rangeOf({ value: 380, plus: 140, minus: 80 }), [300, 520]);
  assert.equal(rangeOf({ text: 'about 30 degrees' }), null);
  const ranges = planetNineRanges(scene.planet_nine);
  assert.equal(scene.planet_nine.status, 'hypothetical');
  assert.ok(ranges.length >= 1);
  for (const range of ranges) assert.ok(range.low > 100 && range.high > range.low && range.reference, JSON.stringify(range));
  // Exactly the estimates in the file that state a semi-major axis, nothing invented.
  assert.equal(ranges.length, scene.planet_nine.estimates.filter((estimate) => rangeOf(estimate.semimajor_axis_au)).length);
  assert.ok(!('position_au' in scene.planet_nine) && !('orbit_points_au' in scene.planet_nine));
  assert.deepEqual(planetNineRanges({ ...scene.planet_nine, status: 'observed' }), []);
  assert.deepEqual(planetNineRanges({ status: 'hypothetical', estimates: [{ reference: 'x', mass_earth: { min: 5, max: 10 } }] }), []);
  assert.deepEqual(planetNineRanges(null), []);
});

test('display colours need all three array groups on that date', async () => {
  const { colourGroupsPresent, COMPOSITE } = await import('../static/js/stack.js');
  assert.deepEqual(COMPOSITE, { red: [5, 6], green: [3, 4], blue: [1, 2] });
  const frames = (detectors) => detectors.map((detector) => ({ detector }));
  assert.equal(colourGroupsPresent(frames([1, 3, 6])), true);
  assert.equal(colourGroupsPresent(frames([2, 4, 5, 5])), true);
  assert.equal(colourGroupsPresent(frames([1, 2, 3, 4])), false);
  assert.equal(colourGroupsPresent(frames([])), false);
  assert.equal(colourGroupsPresent(undefined), false);
});

test('the 3D view falls back to the 2D map: no WebGL, low memory, reduced motion, embed or a saved choice', async () => {
  const { chooseView } = await import('../static/js/space-ui.js');
  const base = { webgl: true, reducedMotion: false, saved: null, deviceMemory: 8, embed: false };
  assert.deepEqual(chooseView(base), { mode: '3d', reason: null, offer3d: true });
  assert.deepEqual(chooseView({ ...base, webgl: false }), { mode: '2d', reason: 'space.noWebgl', offer3d: false });
  assert.deepEqual(chooseView({ ...base, deviceMemory: 1 }), { mode: '2d', reason: 'space.slow', offer3d: false });
  assert.deepEqual(chooseView({ ...base, reducedMotion: true }), { mode: '2d', reason: 'space.reducedMotion', offer3d: true });
  // A visitor who switched 3D on keeps it, also with reduced motion (camera moves are then instant).
  assert.deepEqual(chooseView({ ...base, reducedMotion: true, saved: '3d' }), { mode: '3d', reason: null, offer3d: true });
  assert.deepEqual(chooseView({ ...base, saved: '2d' }), { mode: '2d', reason: null, offer3d: true });
  assert.deepEqual(chooseView({ ...base, embed: true }), { mode: '2d', reason: null, offer3d: false });
  assert.deepEqual(chooseView({ ...base, deviceMemory: null }), { mode: '3d', reason: null, offer3d: true });
  const { has } = await import('../static/js/i18n.js');
  for (const key of ['space.noWebgl', 'space.slow', 'space.reducedMotion', 'space.failed', 'space.view2d', 'space.view3d', 'space.reset', 'space.top']) assert.ok(has(key), key);
});
