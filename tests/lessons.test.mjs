import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  absoluteMagnitude, allInside, distancePc, erfc, expectedFalseAlarms, inside2d, LESSONS, magnitudeDifference,
  orbitalPeriodYears, planetModel, radius2d, readLessonRecord, reflectedDimming, scoreboardSummary, shiftArcsecForAu,
  syntheticLesson, upperTail, visualMagnitude,
} from '../static/js/lessons.js';

const near = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not near ${expected}`);

test('lesson 1: the parsec is the distance where 1 au gives 1 arcsec', () => {
  assert.equal(distancePc(1, 1), 1);
  near(distancePc(1, 0.1), 10);
  near(distancePc(2, 0.5), 4, 1e-12);
  assert.equal(distancePc(1, 0), null, 'no shift: no distance, not infinity');
  assert.equal(distancePc(-1, 1), null);
  near(shiftArcsecForAu(1, 206264.80624709636), 1, 1e-9);
  near(shiftArcsecForAu(1, 50), 4125.296, 1e-3);
});

test('lesson 2: magnitudes are logarithmic and reflected light falls as 1/r^4', () => {
  near(magnitudeDifference(100), 5);
  near(magnitudeDifference(10), 2.5);
  assert.equal(magnitudeDifference(0), null);
  const twice = reflectedDimming(40, 80);
  near(twice.ratio, 16);
  near(twice.magnitudes, 3.0103, 1e-4);
  near(twice.magnitudes, magnitudeDifference(twice.ratio), 1e-12, 'both routes agree');
});

test('lesson 2: H from size and albedo, and V at a distance (opposition, no phase effects)', () => {
  near(absoluteMagnitude(1329, 1), 0, 1e-12);
  near(absoluteMagnitude(1000, 0.1), 3.118, 1e-3);
  near(visualMagnitude(0, 1, 1), 0);
  near(visualMagnitude(3.118, 40, 40), 3.118 + 5 * Math.log10(1600), 1e-9);
  assert.equal(absoluteMagnitude(0, 0.1), null);
  assert.equal(visualMagnitude(5, 0, 1), null);
});

test('lesson 3: Gaussian tails and the 2D 95% radius', () => {
  near(erfc(0), 1, 1e-7);
  near(upperTail(1.959963984540054), 0.025, 1e-6);
  near(upperTail(3), 0.0013499, 1e-6);
  near(upperTail(-1), 0.8413447, 1e-6);
  near(radius2d(0.95), 2.4477468, 1e-6);
  near(radius2d(0.95) ** 2, 5.991464547107979, 1e-9);
  near(inside2d(radius2d(0.95)), 0.95, 1e-12);
  near(inside2d(2), 0.8646647, 1e-6, '2 sigma is only 86.5% in two dimensions');
  near(expectedFalseAlarms(500, 3), 0.67495, 1e-4);
  near(allInside(0.95, 10), 0.598737, 1e-6);
});

test('the synthetic practice values are the formulas, never hand-typed numbers', () => {
  const distance = syntheticLesson('distance');
  assert.equal(distance.worked.answer.value, 10);
  assert.deepEqual(distance.exercises.map((item) => item.answer.value), [4, 4, 4125]);
  const brightness = syntheticLesson('brightness');
  assert.equal(brightness.worked.answer.value, 5);
  assert.deepEqual(brightness.exercises.map((item) => item.answer.value), [2.5, 3.01, 19.1]);
  assert.equal(brightness.exercises[1].answer.ratio, 16);
  const sure = syntheticLesson('sure');
  assert.equal(sure.worked.answer.value, 0.588);
  assert.deepEqual(sure.exercises.map((item) => item.answer.value), [86.5, 0.67, 59.9]);
  assert.equal(sure.exercises[0].answer.radius95, 2.448);
  for (const id of ['distance', 'brightness', 'sure']) assert.equal(syntheticLesson(id).exercises.length, 3, id);
});

test('lesson records: matched by id, unsourced real inputs flagged, malformed records refused', () => {
  const fixture = JSON.parse(readFileSync(new URL('../static/dev-fixtures/lessons/distance.json', import.meta.url), 'utf8'));
  const read = readLessonRecord(fixture);
  assert.equal(read.id, 'distance');
  assert.equal(read.example, true);
  assert.equal(read.worked.inputs[0].synthetic, true);
  const real = readLessonRecord({
    lesson_id: 'how-sure',
    worked_example: { inputs: [{ name: 'sigma_arcsec', value: 0.33, unit: 'arcsec', synthetic: false, source_ref: null }], answer: { value: 0.65 } },
    exercises: [{ id: 'q1', prompt_key: 'lesson.sure.q1', inputs: [], answer: { value: 1 } }, { id: 'BAD ID' }],
  });
  assert.equal(real.id, 'sure');
  assert.equal(real.worked.inputs[0].unsourced, true, 'a real input without a source is flagged');
  assert.equal(real.exercises.length, 1);
  assert.equal(readLessonRecord({ lesson_id: 'astrology' }), null);
  assert.equal(readLessonRecord(null), null);
  assert.equal(LESSONS.length, 3);
});

test('lesson 3 reads the scoreboard counts and computes no success rate', () => {
  const board = JSON.parse(readFileSync(new URL('../static/dev-fixtures/scoreboard.json', import.meta.url), 'utf8'));
  const summary = scoreboardSummary(board);
  const retro = summary.find((row) => row.category === 'retrospective_holdout');
  assert.deepEqual(retro, { category: 'retrospective_holdout', checked: 2, hit: 2, miss: 0, open: 0, other: 0 });
  assert.equal(summary.find((row) => row.category === 'illustrative').open, 1);
  assert.equal(scoreboardSummary(null), null);
  for (const row of summary) assert.equal(Object.keys(row).some((key) => /rate|percent/.test(key)), false);
});

test('Planet X Lab: brightness and motion follow the stated assumptions', () => {
  const model = planetModel({ distanceAu: 500, diameterKm: 20000, albedo: 0.4 });
  near(model.h, absoluteMagnitude(20000, 0.4), 1e-12);
  near(model.v, model.h + 5 * Math.log10(500 * 499), 1e-12);
  near(model.periodYears, orbitalPeriodYears(500), 1e-9);
  near(model.periodYears, 11180.34, 0.01);
  near(model.driftArcsecPerYear, 1296000 / 11180.34, 0.01);
  near(model.parallaxArcsec, shiftArcsecForAu(1, 499), 1e-9);
  const farther = planetModel({ distanceAu: 1000, diameterKm: 20000, albedo: 0.4 });
  assert.ok(farther.v - model.v > 2.9 && farther.v - model.v < 3.1, 'twice as far is about 3 mag fainter');
  const brighter = planetModel({ distanceAu: 500, diameterKm: 20000, albedo: 0.8 });
  near(model.v - brighter.v, 2.5 * Math.log10(2), 1e-9, 'double albedo: 0.75 mag brighter');
});
