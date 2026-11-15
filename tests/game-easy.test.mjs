// Task B20: Beat the physics for a first-time player. Easy mode draws more before the reveal (the track's arrowhead,
// hints 1–2, month ticks, the ruler's dated end and a scale bar), so the answer-leak rule is checked again for it.
// The stars and the plain result line read the answers, and only after the reveal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { has, t } from '../static/js/i18n.js';
import {
  DIFFICULTY_ORDER, insideModelOval, lastMeasurement, preRevealState, roundDifficulty, roundStars, scaleBarArcsec, scoreRound, toOffset,
} from '../static/js/game.js';
import { wordDate } from '../static/js/game-help.js';

const DATA = fileURLToPath(new URL('../static/data/', import.meta.url));
const SOURCE = readFileSync(fileURLToPath(new URL('../static/js/game-ui.js', import.meta.url)), 'utf8');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const board = read(join(DATA, 'scoreboard.json'));
const ROUNDS = ['barnard', 'epsindib', 'pluto'].map((key) => [key, read(join(DATA, 'game', `${key}-position.json`))]);

/** Every finite number pair in a value (east/north offsets, ruler ends, ticks …). */
function pairs(node, out = []) {
  if (Array.isArray(node)) node.forEach((item) => pairs(item, out));
  else if (node && typeof node === 'object') {
    if (Number.isFinite(node.east) && Number.isFinite(node.north)) out.push([node.east, node.north]);
    Object.values(node).forEach((value) => pairs(value, out));
  }
  return out;
}

test('Easy mode before the reveal: nothing drawn depends on the model, the baseline or the actual position', () => {
  for (const [key, round] of ROUNDS) {
    const state = preRevealState(round);
    assert.ok(state.easy && Number.isFinite(state.easy.scaleArcsec), `${key}: Easy-mode state`);
    assert.equal(state.easy.targetMjd, round.reveal_t_mjd, `${key}: the ruler's end is labelled with the target date only`);
    const moved = preRevealState({
      ...round,
      model: { ...round.model, east_arcsec: 98765, north_arcsec: -12345, cov_arcsec2: [[9, 0], [0, 9]] },
      baseline: { ...round.baseline, east_arcsec: -5555, north_arcsec: 4444 },
      actual: { ...round.actual, east_arcsec: 777, north_arcsec: -888 },
    });
    assert.deepEqual(moved, state, `${key}: moving the hidden answers changes nothing on screen in Easy mode`);
    const origin = lastMeasurement(round);
    for (const part of ['model', 'baseline', 'actual']) {
      const answer = toOffset(origin, round[part]);
      for (const [east, north] of pairs(state)) assert.ok(Math.hypot(east - answer.east, north - answer.north) > 1e-6, `${key}: ${part} drawn at (${east}, ${north})`);
    }
    // The month ticks are the training-only ruler's 30-day ticks.
    assert.deepEqual(state.easy.months.map((tick) => tick.days), state.hints.ruler.ticks.map((tick) => tick.days));
  }
});

test('the stars and the plain result read the answers only after the reveal', () => {
  // In game-ui.js the stars, the oval test and the score are used inside showResults() only.
  for (const name of ['roundStars(', 'scoreRound(']) {
    const at = SOURCE.indexOf(name, SOURCE.indexOf('} from \'./game.js\';'));
    assert.ok(at > 0, name);
    const owner = [...SOURCE.slice(0, at).matchAll(/\nfunction (\w+)\(/g)].at(-1)[1];
    assert.equal(owner, 'showResults', `${name} is called from ${owner}`);
    assert.equal(SOURCE.split(name).length, 2, `${name} is called once`);
  }
});

test('stars: three inside the physics oval, two closer than the straight line, one otherwise', () => {
  const [, round] = ROUNDS[0];
  const at = (east, north) => ({ east_arcsec: round.model.east_arcsec + east, north_arcsec: round.model.north_arcsec + north });
  const atModel = at(0, 0);
  assert.equal(insideModelOval(round, atModel), true);
  assert.equal(roundStars(round, atModel, scoreRound(round, atModel)), 3);
  const far = at(500, 500);
  assert.equal(insideModelOval(round, far), false);
  assert.equal(roundStars(round, far, scoreRound(round, far)), 1);
  // Outside the oval but closer to the real position than the straight line: two stars.
  const nearActual = { east_arcsec: round.actual.east_arcsec, north_arcsec: round.actual.north_arcsec + 0.01 };
  const result = scoreRound(round, nearActual);
  if (insideModelOval(round, nearActual) === false) assert.equal(roundStars(round, nearActual, result), 2);
  assert.ok(result.errors.player < result.errors.baseline);
  assert.equal(insideModelOval({ ...round, model: { east_arcsec: 0, north_arcsec: 0 } }, atModel), null, 'no oval in the file: no three-star test');
});

test('the plain result numbers are the files\' errors (straight line and physics match the scoreboard)', () => {
  for (const [key, round] of ROUNDS) {
    const row = board.rows.find((item) => item.trial_id === round.trial_id);
    const result = scoreRound(round, round.baseline);
    // Within 0.01″ or 1 part in 10⁵ (Pluto's 19,870″ straight line differs by 0.05″ between the round file's
    // flat offsets and the verification's tangent plane; the page shows it rounded far coarser).
    const near = (a, b) => Math.abs(a - b) <= Math.max(0.01, 1e-5 * Math.abs(b));
    assert.ok(near(result.errors.baseline, row.baseline_error_arcsec), `${key}: straight line ${result.errors.baseline} vs ${row.baseline_error_arcsec}`);
    assert.ok(near(result.errors.model, row.model_error_arcsec), `${key}: physics ${result.errors.model} vs ${row.model_error_arcsec}`);
  }
  assert.equal(t('game.plainResult', { player: '0.9″', baseline: '3.1″', model: '1.5″' }), 'You were 0.9″ away. The straight line was 3.1″ away, and our physics 1.5″.');
});

test('round titles, picker labels, difficulty order and the scale bar', () => {
  const [, barnard] = ROUNDS[0];
  assert.equal(t('game.titleWhere', { name: 'Barnard’s Star', date: wordDate(barnard.reveal_t_mjd) }), 'Where will Barnard’s Star be on 21 Aug 2026?');
  assert.deepEqual(ROUNDS.map(([key, round]) => roundDifficulty(key, round)), ['easy', 'medium', 'hard']);
  assert.deepEqual(DIFFICULTY_ORDER, ['easy', 'medium', 'hard']);
  assert.equal(t('game.pickerLevel', { name: 'Pluto', level: t('game.level.hard') }), 'Pluto · Hard');
  assert.equal(scaleBarArcsec(37), 5);
  assert.equal(scaleBarArcsec(9), 2);
  assert.equal(scaleBarArcsec(25000), 5000);
  assert.match(t('game.scaleBar', { length: '5″' }), /the Moon is 1,800″ wide/);
  for (const key of ['game.check', 'game.typeOrKeys', 'game.mode.easy', 'game.mode.hard', 'game.nextRound', 'game.stars.3', 'game.stars.2', 'game.stars.1',
    'game.who.playerEasy', 'game.who.playerHard', 'game.easy.pluto', 'game.easy.plutoLink', 'game.hint2.tickMonth']) assert.ok(has(key), key);
  assert.equal(t('game.headline'), 'Can you guess where it goes next?');
  assert.equal(t('game.check'), 'Check my guess');
});
