// B10: the time control of the 3D Solar System on Home (clock rules and the positions it drives).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { has, t } from '../static/js/i18n.js';
import { julianDate, planetPosition, smallBodyElements, smallBodyPosition } from '../static/js/orbits.js';
import { clampStep, createClock, formatClock, MAX_STEP, RANGE_MS, RATES, rateOf, rateSeconds, REAL_TIME_STEP } from '../static/js/time.js';

const STATIC = fileURLToPath(new URL('../static/', import.meta.url));
const scene = JSON.parse(readFileSync(`${STATIC}data/scene3d.json`, 'utf8'));
const DAY = 86400000;
const WALL = Date.UTC(2026, 10, 15, 7, 0, 0);
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ''} ${actual} vs ${expected}`);
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));

test('the speed steps are real time, 5 min, 1 h, 1 day, 1 week, 1 month and 1 year per second, both ways, with paused in the middle', () => {
  assert.deepEqual(RATES.map((rate) => rate.key), ['paused', 'real', 'min5', 'hour', 'day', 'week', 'month', 'year']);
  assert.equal(MAX_STEP, 7);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(rateSeconds), [0, 1, 300, 3600, 86400, 604800]);
  near(rateSeconds(6), 30.4375 * 86400, 1e-6, 'a month is a twelfth of a Julian year');
  near(rateSeconds(7), 365.25 * 86400, 1e-6);
  assert.equal(rateSeconds(-4), -86400, 'left of centre runs backward');
  assert.deepEqual([clampStep(9), clampStep(-12), clampStep(2.4), clampStep('x')], [7, -7, 2, 0]);
  assert.deepEqual(rateOf(-4), { key: 'day', backward: true });
  for (const rate of RATES) assert.ok(has(`time.rate.${rate.key}`), rate.key);
  assert.equal(t('time.rate.month'), '1 month/s');
  assert.equal(t('time.rateBackward', { rate: t('time.rate.day') }), '-1 day/s');
});

test('on load the clock is live at real speed, which looks still', () => {
  const clock = createClock({ wallMs: WALL });
  assert.equal(clock.step(), REAL_TIME_STEP);
  assert.equal(clock.isLive(WALL + 5000), true);
  assert.equal(clock.now(WALL + 5000), WALL + 5000, 'one second per second');
});

test('with reduced motion the clock starts paused and never moves by itself', () => {
  const clock = createClock({ wallMs: WALL, reducedMotion: true });
  assert.equal(clock.step(), 0);
  assert.equal(clock.moving(), false);
  assert.equal(clock.now(WALL + 3600000), WALL, 'an hour later it still shows the load time');
  assert.equal(clock.isLive(WALL + 10), false);
  // It moves only when the visitor asks.
  clock.goLive(WALL + 20000);
  assert.equal(clock.isLive(WALL + 21000), true);
});

test('the rate drives the time: forward, backward, pause and play, back to live', () => {
  const clock = createClock({ wallMs: WALL });
  clock.setStep(4, WALL);
  assert.equal(clock.now(WALL + 2000), WALL + 2 * DAY, '1 day/s for 2 s');
  assert.equal(clock.isLive(WALL + 2000), false);
  clock.setStep(-5, WALL + 2000);
  assert.equal(clock.now(WALL + 3000), WALL + 2 * DAY - 7 * DAY, 'then a week backward');
  clock.toggle(WALL + 3000);
  assert.equal(clock.step(), 0);
  assert.equal(clock.now(WALL + 9000), WALL - 5 * DAY, 'paused');
  clock.toggle(WALL + 9000);
  assert.equal(clock.step(), -5, 'play again at the last speed');
  clock.stepBy(+1, WALL + 9000);
  clock.stepBy(+20, WALL + 9000);
  assert.equal(clock.step(), MAX_STEP, 'the arrows stop at the fastest step');
  clock.goLive(WALL + 10000);
  assert.equal(clock.isLive(WALL + 10500), true);
  assert.equal(clock.now(WALL + 10500), WALL + 10500);
});

test('the time stops at 1900 and at 2050 with a note, and can move back from an end', () => {
  assert.deepEqual(RANGE_MS.map((ms) => new Date(ms).toISOString().slice(0, 10)), ['1900-01-01', '2050-01-01']);
  const clock = createClock({ wallMs: WALL });
  clock.setStep(7, WALL);
  const end = clock.now(WALL + 60000);
  assert.equal(end, RANGE_MS[1], '1 year/s for a minute stops at 2050');
  assert.equal(clock.step(), 0);
  assert.equal(clock.limit(), 'end');
  clock.setStep(3, WALL + 61000);
  assert.equal(clock.now(WALL + 70000), RANGE_MS[1], 'pushing on stops again');
  clock.setStep(-7, WALL + 70000);
  assert.equal(clock.limit(), null, 'moving back clears the note');
  assert.ok(clock.now(WALL + 71000) < RANGE_MS[1]);
  assert.equal(clock.now(WALL + 300000), RANGE_MS[0], 'and backward it stops at 1900');
  assert.equal(clock.limit(), 'start');
  assert.ok(has('time.limit.start') && has('time.limit.end'));
});

test('the date is shown in UTC to the second', () => {
  assert.equal(formatClock(Date.UTC(2026, 10, 15, 7, 42, 10, 900)), '2026-11-15 07:42:10');
  assert.match(t('time.utc'), /UTC/);
});

test('positions at the scene epoch match the existing check values (JPL Horizons in scene3d.json)', () => {
  // The clock gives a date; the scene turns it into a Julian date and positions.
  const epoch = scene.bodies.earth.position_now.epoch_jd_tdb;
  const clock = createClock({ wallMs: (epoch - 2440587.5) * DAY, reducedMotion: true });
  const jd = julianDate(new Date(clock.now(0)));
  near(jd, epoch, 1e-9);
  assert.ok(distance(planetPosition('earth', jd), scene.bodies.earth.position_now.position_au) < 0.01, 'Earth–Moon barycentre vs DE441');
  for (const [key, tolerance] of [['pluto', 0.1], ['makemake', 0.01]]) {
    const body = scene.bodies[key];
    const elements = smallBodyElements(body.catalogue_orbit);
    assert.ok(elements, `${key}: elements in the scene file`);
    const at = smallBodyPosition(elements, body.position_now.epoch_jd_tdb);
    assert.ok(distance(at, body.position_now.position_au) < tolerance, `${key}: Kepler from the SBDB elements lands on Horizons (${distance(at, body.position_now.position_au).toFixed(4)} au)`);
  }
});

test('small-body elements are used only when complete; nothing is invented', () => {
  const orbit = scene.bodies.pluto.catalogue_orbit;
  assert.equal(smallBodyElements(null), null);
  assert.equal(smallBodyElements({ ...orbit, epoch_jd_tdb: undefined }), null);
  const { ma, ...withoutAnomaly } = orbit.elements;
  assert.equal(smallBodyElements({ ...orbit, elements: withoutAnomaly }), null);
  // A whole period later the body is back where it was.
  const elements = smallBodyElements(orbit);
  const period = 360 / elements.n;
  assert.ok(distance(smallBodyPosition(elements, elements.epoch), smallBodyPosition(elements, elements.epoch + period)) < 1e-6);
});
