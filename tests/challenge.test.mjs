// Task B24: "Challenge a friend". A challenge link carries only the round, an optional first name, the stars and the
// mode. Every value read from a link is untrusted: bad links are ignored, names are only ever shown as text, and no
// coordinate of the guess, the model, the baseline, the real position or the training dots can be in a link.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { has, t } from '../static/js/i18n.js';
import { CHALLENGE_KEYS, challengeOutcome, challengeUrl, cleanName, readChallenge, starText } from '../static/js/challenge.js';

const DATA = fileURLToPath(new URL('../static/data/', import.meta.url));
const JS = fileURLToPath(new URL('../static/js/', import.meta.url));
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const ROUNDS = ['barnard', 'epsindib', 'pluto'].map((key) => read(join(DATA, 'game', `${key}-position.json`)));
const IDS = ROUNDS.map((round) => round.round_id);
const BASE = 'https://example.org/tenger/index.html';
const link = (query) => readChallenge(new URL(`${BASE}?${query}`).searchParams, IDS);

test('names: letters (any script), spaces and hyphens, at most 20 characters; anything else is refused', () => {
  assert.equal(cleanName('Narmandakh'), 'Narmandakh');
  assert.equal(cleanName('  Anne-Marie   Li '), 'Anne-Marie Li');
  assert.equal(cleanName('Нарандах'), 'Нарандах');
  assert.equal(cleanName(''), '');
  assert.equal(cleanName(null), '');
  for (const bad of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', 'Bob"', 'O\'Neil', 'a&amp;b', 'x'.repeat(21), '123', '-Bo', 'Bo\u0000', 'javascript:alert(1)']) {
    assert.equal(cleanName(bad), null, bad);
  }
});

test('a crafted link with HTML or script in the name is ignored, and so is any other bad value', () => {
  const good = `page=game&round=${IDS[0]}&${CHALLENGE_KEYS.name}=Narmandakh&${CHALLENGE_KEYS.stars}=2&${CHALLENGE_KEYS.mode}=easy`;
  assert.deepEqual(link(good), { roundId: IDS[0], name: 'Narmandakh', stars: 2, mode: 'easy' });
  assert.deepEqual(link(`page=game&round=${IDS[2]}&stars=3&mode=hard`), { roundId: IDS[2], name: '', stars: 3, mode: 'hard' });
  for (const bad of [
    `page=game&round=${IDS[0]}&from=%3Cscript%3Ealert(1)%3C%2Fscript%3E&stars=2&mode=easy`,
    `page=game&round=${IDS[0]}&from=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&stars=2&mode=easy`,
    `page=game&round=${IDS[0]}&from=Bo%22%3E%3Cb%3E&stars=2&mode=easy`,
    `page=game&round=${IDS[0]}&from=Narmandakh&stars=4&mode=easy`,
    `page=game&round=${IDS[0]}&from=Narmandakh&stars=2.5&mode=easy`,
    `page=game&round=${IDS[0]}&from=Narmandakh&stars=%3Cb%3E&mode=easy`,
    `page=game&round=${IDS[0]}&from=Narmandakh&stars=2&mode=%3Cscript%3E`,
    `page=game&round=not-a-round&from=Narmandakh&stars=2&mode=easy`,
    `page=game&round=%3Cscript%3E&stars=2&mode=easy`,
    `page=game&round=${IDS[0]}&stars=2`,
  ]) assert.equal(link(bad), null, bad);
  // No challenge values at all: no challenge (an ordinary game link).
  assert.equal(link(`page=game&round=${IDS[0]}`), null);
});

test('the page shows challenge values only as text, never as HTML, and keeps nothing', () => {
  const ui = readFileSync(join(JS, 'game-ui.js'), 'utf8');
  const module = readFileSync(join(JS, 'challenge.js'), 'utf8');
  for (const source of [ui, module]) {
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser/.test(source), 'no HTML parsing of any text');
  }
  // The banner and the outcome are built with el(..., { text }), which sets textContent.
  assert.match(ui, /id: 'challenge-banner'[^\n]*text: t\(/);
  assert.match(ui, /id: 'challenge-outcome'[^\n]*text: outcomeText\(/);
  // Nothing about a challenge goes to a server or to browser storage.
  assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|sendBeacon|document\.cookie/.test(module));
  const challengePart = ui.slice(ui.indexOf('// ---------- Challenge a friend (task B24)'), ui.indexOf('// ---------- Layout of one round'));
  assert.ok(challengePart.length > 500);
  assert.ok(!/storage\(|localStorage|sessionStorage|fetch\(|sendBeacon/.test(challengePart));
});

test('a challenge link holds no coordinate: only page, round, name, stars and mode', () => {
  for (const round of ROUNDS) {
    for (const [name, stars, mode] of [['Narmandakh', 3, 'easy'], ['', 1, 'hard'], ['Anne-Marie', 2, 'easy']]) {
      const url = new URL(challengeUrl(BASE, { roundId: round.round_id, name, stars, mode }));
      assert.deepEqual([...url.searchParams.keys()].sort(), ['mode', 'page', 'round', 'stars', ...(name ? ['from'] : [])].sort());
      assert.equal(url.searchParams.get('stars'), String(stars));
      // The only number in the query is the star count (round ids have no numbers either).
      assert.deepEqual(url.search.match(/\d+(\.\d+)?/g), [String(stars)], url.search);
      // None of the round's positions (model, baseline, actual, training) appears in any form.
      const values = [round.model, round.baseline, round.actual, ...round.training_points].flatMap((point) => [point.east_arcsec, point.north_arcsec]);
      for (const value of values) {
        for (const digits of [1, 2, 3, 4]) assert.ok(!url.href.includes(Math.abs(value).toFixed(digits)), `${round.round_id}: ${value}`);
      }
    }
  }
  // The builder refuses bad values instead of putting them in a link.
  assert.equal(challengeUrl(BASE, { roundId: IDS[0], name: '<b>', stars: 2, mode: 'easy' }), null);
  assert.equal(challengeUrl(BASE, { roundId: IDS[0], name: 'Bo', stars: 4, mode: 'easy' }), null);
  assert.equal(challengeUrl(BASE, { roundId: IDS[0], name: 'Bo', stars: 2, mode: 'medium' }), null);
  // Whatever else the page's own address carries is dropped.
  const url = new URL(challengeUrl(`${BASE}?ra=12.5&dec=-3.2#x`, { roundId: IDS[0], name: 'Bo', stars: 2, mode: 'easy' }));
  assert.equal(url.hash, '');
  assert.ok(!url.searchParams.has('ra') && !url.searchParams.has('dec'));
});

test('win, tie and loss, and the English texts', () => {
  assert.equal(challengeOutcome(3, 2), 'win');
  assert.equal(challengeOutcome(2, 2), 'tie');
  assert.equal(challengeOutcome(1, 3), 'loss');
  assert.equal(t('challenge.banner', { name: 'Narmandakh', stars: starText(2), target: 'Barnard’s Star', mode: t('challenge.mode.easy') }),
    'Narmandakh got ★★ on Barnard’s Star (Easy). Can you beat it?');
  assert.equal(t('challenge.bannerNoName', { stars: starText(2), target: 'Barnard’s Star', mode: 'Easy' }), 'A friend got ★★ on Barnard’s Star (Easy). Can you beat it?');
  assert.equal(t('challenge.outcome.win', { mine: starText(3) }), 'You got ★★★. You win!');
  assert.match(t('challenge.outcome.tie', { mine: starText(2) }), /It’s a tie\.$/);
  assert.match(t('challenge.outcome.loss', { mine: starText(1), name: 'Narmandakh' }), /Narmandakh wins this time\.$/);
  for (const key of ['challenge.button', 'challenge.back', 'challenge.copied', 'challenge.unverified', 'challenge.nameLabel', 'challenge.share']) assert.ok(has(key), key);
  assert.equal(t('challenge.unverified'), 'Challenge links are not verified scores.');
});
