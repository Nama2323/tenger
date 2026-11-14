import test from 'node:test';
import assert from 'node:assert/strict';
import { bandToParam, buildRoute, parseBand, parseRoute, resolveRoute } from '../static/js/route.js';

const targets = [
  { key: 'barnard', name: "Barnard's Star", centre: { ra: 269.44648, dec: 4.76867 }, fov: 0.1 },
  { key: 'makemake', name: 'Makemake', centre: null, fov: null },
];

test('old links keep working: target alone opens the target on the investigate page', () => {
  const resolved = resolveRoute(parseRoute('?target=barnard'), targets);
  assert.equal(resolved.page, 'investigate');
  assert.deepEqual(resolved.open, { kind: 'target', key: 'barnard', fov: 0.1 });
  assert.deepEqual(resolved.notes, []);
});

test('old links keep working: ra/dec/fov alone open that position', () => {
  const resolved = resolveRoute(parseRoute('?ra=40&dec=60&fov=0.2'), targets);
  assert.deepEqual(resolved.open, { kind: 'position', ra: 40, dec: 60, fov: 0.2 });
});

test('id is an alias of target, and target wins when both disagree', () => {
  assert.equal(parseRoute('?id=barnard').target, 'barnard');
  const both = parseRoute('?target=barnard&id=rdra');
  assert.equal(both.target, 'barnard');
  assert.equal(both.notes[0].key, 'note.idIgnored');
});

test('coordinates win over a conflicting target, with a note', () => {
  const resolved = resolveRoute(parseRoute('?target=barnard&ra=40&dec=60'), targets);
  assert.deepEqual(resolved.open, { kind: 'position', ra: 40, dec: 60, fov: null });
  assert.equal(resolved.notes.at(-1).key, 'note.coordinatesWin');
});

test('coordinates inside the target field agree with it (no conflict)', () => {
  const shared = resolveRoute(parseRoute('?target=barnard&ra=269.44648&dec=4.76867&fov=0.1'), targets);
  assert.equal(shared.open.kind, 'target');
  // Gaia position of the star, 0.03 degrees from the field centre: still the same prepared field.
  const star = resolveRoute(parseRoute('?target=barnard&ra=269.44875&dec=4.73942'), targets);
  assert.equal(star.open.kind, 'target');
  assert.deepEqual(star.notes, []);
});

test('malformed values are dropped with notes, never guessed', () => {
  const route = parseRoute('?ra=400&dec=5&fov=9&band=zz&mode=wild&page=nowhere&a=<script>');
  assert.equal(route.ra, null);
  assert.equal(route.fov, null);
  assert.equal(route.band, null);
  assert.equal(route.mode, null);
  assert.equal(route.page, null);
  assert.equal(route.a, null);
  assert.deepEqual(route.notes.map((note) => note.key), ['note.badCoordinates', 'note.badFov', 'note.badBand']);
});

test('page=investigate without anything to investigate falls back to home', () => {
  const resolved = resolveRoute(parseRoute('?page=investigate'), targets);
  assert.equal(resolved.page, 'home');
  assert.equal(resolved.notes[0].key, 'note.nothingToInvestigate');
});

test('an unknown target is reported, not silently replaced', () => {
  const resolved = resolveRoute(parseRoute('?target=vulcan'), targets);
  assert.equal(resolved.open, null);
  assert.equal(resolved.notes[0].key, 'note.unknownTarget');
});

test('bands round-trip', () => {
  for (const text of ['all', 'd1', 'd6', 'c0', 'c101']) assert.equal(bandToParam(parseBand(text)), text);
  assert.equal(parseBand('d7'), null);
  assert.equal(parseBand('c102'), null);
});

test('a share link restores the full state', () => {
  const state = {
    page: 'investigate', target: 'barnard', ra: 269.44648, dec: 4.76867, fov: 0.1, panel: 'prediction',
    band: { kind: 'detector', detector: 6 }, mode: 'swipe', a: 'allwise', b: '2026-08-23', v: 'example-1', embed: false, fixtures: true,
  };
  const link = buildRoute(state);
  const route = parseRoute(link);
  assert.equal(route.page, 'investigate');
  assert.equal(route.target, 'barnard');
  assert.equal(route.ra, 269.44648);
  assert.equal(route.dec, 4.76867);
  assert.equal(route.fov, 0.1);
  assert.equal(route.panel, 'prediction');
  assert.deepEqual(route.band, { kind: 'detector', detector: 6 });
  assert.equal(route.mode, 'swipe');
  assert.equal(route.a, 'allwise');
  assert.equal(route.b, '2026-08-23');
  assert.equal(route.v, 'example-1');
  assert.equal(route.fixtures, true);
  assert.equal(buildRoute(state), link, 'equal states give equal links');
});

test('the home page has a clean link; embed is kept', () => {
  assert.equal(buildRoute({ page: 'home' }), '');
  assert.equal(buildRoute({ page: 'about', embed: true }), '?page=about&embed=1');
});
