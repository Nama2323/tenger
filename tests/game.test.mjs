import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  checkRound, daysToTarget, expDecayScore, fromOffset, guessView, isMagnitude, lastMeasurement, physicsLost, pointError, preRevealState,
  readBest, revealView, roundKind, saveBest, scalarView, scoreRound, ticks, toOffset, trainingMotion,
  dateClusters, hintDirection, hintRuler, resultExplanation, roundType,
} from '../static/js/game.js';
import { angleText, clusterDate, compassOf } from '../static/js/game-help.js';
import { has } from '../static/js/i18n.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ''} ${actual} vs ${expected}`);
const barnard = read('../static/dev-fixtures/game/barnard-position-example.json');
const makemake = read('../static/dev-fixtures/game/makemake-position-example.json');
const rdra = read('../static/dev-fixtures/game/rdra-brightness-example.json');
/** Every round the page can play: Session A's real rounds and the examples. */
const ROUNDS = ['../static/data/game/', '../static/dev-fixtures/game/'].flatMap((folder) => readdirSync(new URL(folder, import.meta.url))
  .filter((name) => name.endsWith('.json')).map((name) => [`${folder.includes('dev-') ? 'example' : 'real'} ${name}`, read(`${folder}${name}`)]));
const POSITION_ROUNDS = ROUNDS.filter(([, round]) => roundKind(round) === 'position');
/** Every number pair in a value, wherever it sits (for the leak test). */
function pairs(value, found = []) {
  if (Array.isArray(value)) value.forEach((item) => pairs(item, found));
  else if (value && typeof value === 'object') {
    if (Number.isFinite(value.east) && Number.isFinite(value.north)) found.push([value.east, value.north]);
    Object.values(value).forEach((item) => pairs(item, found));
  }
  return found;
}

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

test('answer leak: before the reveal nothing on screen depends on the model, the baseline or the actual position', () => {
  assert.ok(POSITION_ROUNDS.some(([name]) => name.startsWith('real')), 'the real rounds are checked');
  for (const [name, round] of POSITION_ROUNDS) {
    const state = preRevealState(round);
    // Move the three hidden answers far away: the state must not change at all.
    const moved = preRevealState({
      ...round,
      model: { ...round.model, east_arcsec: 123456, north_arcsec: -654321 },
      baseline: { ...round.baseline, east_arcsec: -98765, north_arcsec: 4321 },
      actual: { ...round.actual, east_arcsec: 777, north_arcsec: -888 },
    });
    assert.deepEqual(moved, state, `${name}: the hidden answers do not change what is shown`);
    // No coordinate shown equals an answer. Everything on screen is an offset from the last measurement, so the
    // answers are compared as offsets from the same point (nothing is shown in the file's frame).
    const origin = lastMeasurement(round);
    const answers = ['model', 'baseline', 'actual'].map((part) => [part, toOffset(origin, round[part]).east, toOffset(origin, round[part]).north]);
    const shown = [...pairs(state), [state.view.east[0], state.view.north[0]], [state.view.east[1], state.view.north[1]],
      [(state.view.east[0] + state.view.east[1]) / 2, (state.view.north[0] + state.view.north[1]) / 2]];
    for (const [part, east, north] of answers) {
      for (const [x, y] of shown) assert.ok(Math.hypot(x - east, y - north) > 1e-6, `${name}: ${part} shown at (${x}, ${y})`);
    }
    // The origin is the last measurement, so the zero gridlines cross there, not at the model.
    const last = state.training.at(-1);
    assert.deepEqual([last.east, last.north], [0, 0], `${name}: offsets start at the last measurement`);
    const model = toOffset(origin, round.model);
    assert.ok(Math.hypot(model.east, model.north) > 1e-6, `${name}: the screen's 0,0 is not the model`);
    assert.equal(state.daysToTarget, round.reveal_t_mjd - last.t_mjd);
  }
});

test('the view before the reveal holds the training points and their speed times the days to the target', () => {
  for (const [name, round] of POSITION_ROUNDS) {
    const view = guessView(round);
    const reach = trainingMotion(round).speed * daysToTarget(round);
    assert.ok(Math.abs((view.east[1] - view.east[0]) - (view.north[1] - view.north[0])) < 1e-9, `${name}: square`);
    for (const [east, north] of [[reach, 0], [-reach, 0], [0, reach], [0, -reach]]) {
      assert.ok(east >= view.east[0] && east <= view.east[1] && north >= view.north[0] && north <= view.north[1], `${name}: ${reach.toFixed(3)} in every direction`);
    }
    for (const point of preRevealState(round).training) assert.ok(point.east >= view.east[0] && point.east <= view.east[1], `${name}: training inside`);
    // After the reveal the view may widen to show everything, never shrink.
    const after = revealView(round, [round.baseline, round.model, round.actual]);
    assert.ok(after.east[0] <= view.east[0] && after.east[1] >= view.east[1], `${name}: widens only`);
    for (const part of ['baseline', 'model', 'actual']) {
      const offset = toOffset(lastMeasurement(round), round[part]);
      assert.ok(offset.east >= after.east[0] && offset.east <= after.east[1] && offset.north >= after.north[0] && offset.north <= after.north[1], `${name}: ${part} shown after the reveal`);
    }
  }
  const scalar = scalarView(rdra);
  assert.ok(scalar.time[1] > rdra.reveal_t_mjd && scalar.time[0] < rdra.training_points[0].t_mjd);
  assert.deepEqual(scalarView({ ...rdra, actual: { value: 99 }, model: { value: -5 }, baseline: { value: 40 } }), scalar);
});

test('typed offsets are relative to the last measurement; scoring stays in the file\'s frame', () => {
  for (const [name, round] of POSITION_ROUNDS) {
    const origin = lastMeasurement(round);
    const guess = fromOffset(origin, { east: 1.5, north: -2 });
    assert.deepEqual(toOffset(origin, guess), { east: 1.5, north: -2 }, name);
    const atActual = fromOffset(origin, toOffset(origin, round.actual));
    assert.ok(scoreRound(round, atActual).errors.player < 1e-9, `${name}: a guess typed at the actual offset scores as the actual`);
  }
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

const realRound = (name) => ROUNDS.find(([label]) => label === `real ${name}-position.json`)?.[1];

test('B7: round types, date groups and the timeline numbers come from the round file', () => {
  assert.equal(roundType(realRound('barnard'), 'barnard'), 'star');
  assert.equal(roundType(realRound('epsindib'), 'epsindib'), 'star');
  assert.equal(roundType(realRound('pluto'), 'pluto'), 'solar');
  assert.equal(roundType(makemake), 'solar', 'from the trial id when the target key is unknown');
  assert.equal(roundType(rdra), 'brightness');
  const groups = Object.fromEntries(['barnard', 'epsindib', 'pluto'].map((name) => [name, dateClusters(realRound(name))]));
  assert.deepEqual(Object.values(groups).map((list) => list.length), [2, 3, 2], 'one group per SPHEREx visit');
  for (const [name, list] of Object.entries(groups)) {
    assert.equal(list.reduce((sum, group) => sum + group.count, 0), realRound(name).training_points.length, `${name}: every dot in a group`);
    assert.equal(list.at(-1).end, lastMeasurement(realRound(name)).t_mjd);
  }
  assert.equal(clusterDate(groups.barnard[0]), '2025-08-21 – 08-27');
  assert.equal(clusterDate({ start: 61000, end: 61000.4 }), '2025-11-21');
  assert.match(clusterDate({ start: 61030, end: 61045 }), /^2025-12-21 – 2026-01-05$/, 'the year again when it changes');
  near(daysToTarget(realRound('barnard')), 144.5, 0.05);
});

test('B7 hints come from the training points only: direction, a 30-day ruler to the target date', () => {
  for (const [name, round] of POSITION_ROUNDS) {
    const direction = hintDirection(round);
    near(Math.hypot(direction.east, direction.north), 1, 1e-12, `${name}: unit direction`);
    const motion = trainingMotion(round);
    const ruler = hintRuler(round);
    const days = daysToTarget(round);
    assert.deepEqual(ruler.ticks.map((tick) => tick.days), Array.from({ length: Math.ceil(days / 30) - 1 }, (_, index) => 30 * (index + 1)), `${name}: a tick every 30 days`);
    near(ruler.end.days, days, 1e-9);
    near(ruler.end.east, motion.east * days, 1e-9);
    near(ruler.end.north, motion.north * days, 1e-9);
  }
  assert.equal(compassOf({ east: 0, north: 1 }), 'n');
  assert.equal(compassOf({ east: 1, north: 0 }), 'e');
  assert.equal(compassOf({ east: -0.7, north: -0.7 }), 'sw');
  assert.equal(compassOf(realRound('barnard') && hintDirection(realRound('barnard'))), 'n', "Barnard's Star moves north");
  assert.equal(hintRuler({ ...barnard, training_points: [barnard.training_points[0]] }), null, 'one date: no speed, no ruler');
  assert.equal(angleText(19869.7467), '19,870″ (5.5°)');
  assert.equal(angleText(0.0755), '0.08″');
  assert.equal(angleText(1.5188), '1.5″');
});

test('B7 explanation after the reveal uses the errors in the round file', () => {
  const barnardReal = realRound('barnard');
  const star = resultExplanation(barnardReal, 'star', scoreRound(barnardReal, barnardReal.actual));
  assert.deepEqual([star.key, star.model, star.baseline, star.outside, star.fromFile], ['star', 1.5188, 3.1073, false, true]);
  const plutoReal = realRound('pluto');
  const solar = resultExplanation(plutoReal, 'solar', scoreRound(plutoReal, plutoReal.actual));
  assert.deepEqual([solar.key, solar.model, solar.baseline, solar.outside], ['solar', 5.8991, 19869.7467, true]);
  const lost = resultExplanation(barnard, 'star', scoreRound(barnard, barnard.actual));
  assert.equal(lost.key, 'baselineCloser', 'the example where the straight line wins says so');
  assert.equal(lost.fromFile, false);
  const brightness = resultExplanation(rdra, 'brightness', scoreRound(rdra, { value: 5 }));
  assert.equal(brightness.key, 'brightness');
});

test('B7 strings exist in English for every round type', () => {
  for (const type of ['star', 'solar', 'brightness']) {
    assert.ok(has(`game.howto.${type}.idea`) && has(`game.howto.${type}.step1`), type);
    assert.ok(has(`game.explain.${type}`), type);
  }
  for (const key of ['game.howto.title', 'game.timeline.after', 'game.timeline.target', 'game.timeline.label', 'game.hints.title', 'game.hints.show', 'game.hint1.title', 'game.hint1.text',
    'game.hint2.title', 'game.hint2.text', 'game.hint2.straight', 'game.hint3.title', 'game.hint3.star', 'game.hint3.solar', 'game.who.playerHints', 'game.who.playerHint',
    'game.explain.baselineCloser', 'game.explain.outside', ...['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].map((d) => `game.dir.${d}`)]) assert.ok(has(key), key);
});
