import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkRound, expDecayScore, isMagnitude, physicsLost, pointError, positionView, readBest, saveBest, scalarView, scoreRound, ticks,
} from '../static/js/game.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const barnard = read('../static/dev-fixtures/game/barnard-position-example.json');
const makemake = read('../static/dev-fixtures/game/makemake-position-example.json');
const rdra = read('../static/dev-fixtures/game/rdra-brightness-example.json');

test('exp_decay_v1: a perfect guess scores 100 and scores fall towards 0, never below', () => {
  assert.equal(expDecayScore(0, 2), 100);
  assert.equal(expDecayScore(2, 2), Math.round(100 * Math.exp(-1)));
  assert.equal(expDecayScore(1e9, 2), 0);
  assert.equal(expDecayScore(Number.MAX_VALUE, 1e-300), 0);
  for (let error = 0; error < 50; error += 0.37) {
    const score = expDecayScore(error, 3);
    assert.ok(score >= 0 && score <= 100);
    assert.ok(score <= expDecayScore(error / 2, 3), 'smaller errors never score lower');
  }
});

test('exp_decay_v1: zero, negative and non-finite inputs give no score instead of a fake number', () => {
  assert.equal(expDecayScore(1, 0), null, 'zero scale');
  assert.equal(expDecayScore(1, -2), null, 'negative scale');
  assert.equal(expDecayScore(1, NaN), null);
  assert.equal(expDecayScore(1, Infinity), null);
  assert.equal(expDecayScore(NaN, 2), null);
  assert.equal(expDecayScore(Infinity, 2), null);
  assert.equal(expDecayScore(-0.5, 2), null, 'a raw error is never negative');
  assert.equal(expDecayScore(null, 2), null);
  assert.equal(expDecayScore(undefined, 2), null);
});

test('the score never divides by the baseline error: a perfect baseline does not break anything', () => {
  const round = { ...barnard, baseline: { ...barnard.actual } };
  const result = scoreRound(round, { east_arcsec: -1.0, north_arcsec: 15.0 });
  assert.equal(result.errors.baseline, 0);
  assert.equal(result.scores.baseline, 100);
  assert.ok(Number.isFinite(result.scores.player) && result.scores.player > 0, 'matching or missing the baseline still scores');
  assert.deepEqual(result.best, ['baseline']);
});

test('raw errors use the round units; the Barnard example is one where physics loses', () => {
  const result = scoreRound(barnard, { east_arcsec: -1.2, north_arcsec: 15.5 });
  assert.equal(result.unit, 'arcsec');
  assert.equal(result.errors.player, 0);
  assert.equal(result.scores.player, 100);
  assert.ok(Math.abs(result.errors.baseline - 0.1) < 1e-9);
  assert.ok(Math.abs(result.errors.model - Math.hypot(0.05, 0.4)) < 1e-9);
  assert.equal(physicsLost(result), true);
  assert.deepEqual(result.best, ['player']);
});

test('positions reported in arcmin are converted from the arcsec fields', () => {
  const result = scoreRound(makemake, { east_arcsec: -2600 + 60, north_arcsec: 360 });
  assert.equal(result.unit, 'arcmin');
  assert.ok(Math.abs(result.errors.player - 1) < 1e-9, '60 arcsec is 1 arcmin');
  assert.equal(result.scores.player, Math.round(100 * Math.exp(-1 / 2)));
  assert.equal(physicsLost(result), false);
});

test('brightness rounds use absolute differences in magnitudes', () => {
  const result = scoreRound(rdra, { value: 5.9 });
  assert.equal(result.unit, 'mag_ab');
  assert.ok(Math.abs(result.errors.player - 0.5) < 1e-9);
  assert.ok(Math.abs(result.errors.model - 0.5) < 1e-9);
  assert.deepEqual(result.best.sort(), ['model', 'player'], 'equal errors tie');
  assert.ok(Math.abs(result.errors.baseline - 2.2) < 1e-9);
});

test('a round with a bad scale or formula is still playable, with raw errors and no score', () => {
  for (const scoring of [{ formula: 'exp_decay_v1', scale: 0 }, { formula: 'exp_decay_v1', scale: null }, { formula: 'ratio_to_baseline', scale: 2 }, undefined]) {
    const round = { ...barnard, scoring };
    const check = checkRound(round);
    assert.equal(check.ok, true);
    assert.ok(check.warnings.length >= 1);
    const result = scoreRound(round, { east_arcsec: 0, north_arcsec: 15 });
    assert.equal(result.scored, false);
    assert.deepEqual(Object.values(result.scores), [null, null, null]);
    assert.ok(Number.isFinite(result.errors.player));
  }
});

test('broken rounds are refused, not guessed', () => {
  assert.deepEqual(checkRound({ ...barnard, quantity: 'spin' }).blocking, ['quantity']);
  assert.ok(checkRound({ ...barnard, training_points: [] }).blocking.includes('training'));
  assert.ok(checkRound({ ...barnard, actual: { east_arcsec: null, north_arcsec: 1 } }).blocking.includes('actual'));
  assert.ok(checkRound({ ...rdra, model: {} }).blocking.includes('model'));
  assert.ok(checkRound({ ...rdra, reveal_t_mjd: 'soon' }).blocking.includes('revealTime'));
  assert.equal(pointError(barnard, { east_arcsec: NaN, north_arcsec: 0 }, barnard.actual), null);
  for (const round of [barnard, makemake, rdra]) assert.equal(checkRound(round).ok, true, round.round_id);
});

test('before the reveal, the view comes from the training points only', () => {
  const before = positionView(barnard);
  const moved = positionView({ ...barnard, actual: { east_arcsec: 500, north_arcsec: 500 }, baseline: { east_arcsec: -900, north_arcsec: 0 } });
  assert.deepEqual(before, moved, 'the hidden answer does not change the axes');
  assert.ok(Math.abs((before.east[1] - before.east[0]) - (before.north[1] - before.north[0])) < 1e-9, 'square: same scale east and north');
  const after = positionView(barnard, [{ east_arcsec: 500, north_arcsec: 0 }]);
  assert.ok(after.east[1] >= 500, 'a revealed point widens the view');
  const scalar = scalarView(rdra);
  assert.ok(scalar.time[1] > rdra.reveal_t_mjd && scalar.time[0] < rdra.training_points[0].t_mjd);
  assert.deepEqual(scalarView({ ...rdra, actual: { value: 99 } }), scalar);
});

test('contract V4 brightness units: only magnitudes count smaller as brighter', () => {
  assert.equal(isMagnitude('mag_ab'), true);
  assert.equal(isMagnitude('mag'), true);
  assert.equal(isMagnitude('ujy'), false);
  assert.equal(isMagnitude('ratio'), false);
  assert.equal(isMagnitude(undefined), false);
  assert.equal(checkRound({ ...rdra, units: 'ujy' }).ok, true);
});

test('ticks are round numbers inside the range', () => {
  assert.deepEqual(ticks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(ticks(-1.3, 1.3, 5), [-1, 0, 1]);
  assert.deepEqual(ticks(-1.3, 1.3, 10), [-1, -0.5, 0, 0.5, 1]);
  assert.deepEqual(ticks(3, 3), [3]);
});

test('best scores are kept per round, and storage failures are harmless', () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  assert.equal(readBest(storage, 'r1'), null);
  assert.equal(saveBest(storage, 'r1', 40), 40);
  assert.equal(saveBest(storage, 'r1', 25), 40);
  assert.equal(saveBest(storage, 'r1', 90), 90);
  assert.equal(readBest(storage, 'r2'), null);
  assert.equal(saveBest(storage, 'r1', null), 90, 'no score, nothing saved');
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(readBest(broken, 'r1'), null);
  assert.equal(saveBest(broken, 'r1', 50), null);
  assert.equal(readBest(null, 'r1'), null);
  memory.set('tenger.game.v1', '{not json');
  assert.equal(readBest(storage, 'r1'), null);
});
