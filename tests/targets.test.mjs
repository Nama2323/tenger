import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { distanceInAu, mapRadius, placeOnMap, RINGS } from '../static/js/map.js';
import { buildTargets, colourOf, findCoveringTarget, isLegacyOnly, isViewable, legacyPlaces, OFFICIAL_KEYS } from '../static/js/targets.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const legacy = read('../static/data/targets.json');
const fixtureIndex = read('../static/dev-fixtures/index.json');

test('without a site index: five official targets ready, three planned ones not available yet', () => {
  const entries = buildTargets(null, legacy);
  assert.deepEqual(entries.map((entry) => entry.key), [...OFFICIAL_KEYS, 'makemake', 'pluto', '3i-atlas']);
  for (const entry of entries.slice(0, 5)) assert.ok(isViewable(entry), entry.key);
  for (const entry of entries.slice(5)) {
    assert.equal(entry.dataStatus, 'unavailable', entry.key);
    assert.equal(isViewable(entry), false);
  }
  assert.equal(entries.find((entry) => entry.key === '3i-atlas').seeOnly, true);
  for (const entry of entries) assert.equal(entry.map, null, 'no invented distances without the index');
});

test('with the fixture index: its targets, statuses and map data are used', () => {
  const entries = buildTargets(fixtureIndex, legacy);
  const barnard = entries.find((entry) => entry.key === 'barnard');
  assert.equal(barnard.prediction.status, 'hit');
  assert.deepEqual(barnard.prediction.trialIds, ['barnard-position-example']);
  assert.ok(barnard.legacy, 'viewer frames still come from the legacy target');
  assert.equal(entries.find((entry) => entry.key === 'planet-nine').colour, 'hypothetical');
  assert.equal(entries.filter((entry) => entry.official).length, 5);
});

test('with the real index: all five challenge targets stay viewable, unvalidated ones are marked legacy-only', () => {
  const realIndex = read('../static/data/index.json');
  const entries = buildTargets(realIndex, legacy);
  for (const key of OFFICIAL_KEYS) assert.ok(isViewable(entries.find((entry) => entry.key === key)), key);
  const unvalidated = entries.filter((entry) => entry.official && realIndex.targets.find((target) => target.key === entry.key)?.data_status === 'unavailable');
  for (const entry of unvalidated) assert.equal(isLegacyOnly(entry), true, entry.key);
  for (const key of ['makemake', 'pluto', '3i-atlas']) assert.equal(isViewable(entries.find((entry) => entry.key === key)), false, key);
});

test('colour families', () => {
  assert.equal(colourOf('faststar'), 'star');
  assert.equal(colourOf('browndwarf'), 'star');
  assert.equal(colourOf('variable'), 'variable');
  assert.equal(colourOf('dwarfplanet'), 'solar');
  assert.equal(colourOf('comet'), 'solar');
  assert.equal(colourOf('hypothetical'), 'hypothetical');
});

test('a position inside a prepared field opens that field; elsewhere nothing is claimed', () => {
  const entries = buildTargets(null, legacy);
  const all = [...entries, ...legacyPlaces(legacy, entries)];
  assert.equal(findCoveringTarget(all, 269.44875, 4.73942).key, 'barnard');
  assert.equal(findCoveringTarget(all, 10.68471, 41.26875).key, 'm31');
  assert.equal(findCoveringTarget(all, 40, 60), null);
});

test('map: logarithmic radius, cited distances only, arbitrary angles required', () => {
  assert.ok(Math.abs(distanceInAu({ value: 1, unit: 'pc' }) - 206264.806) < 0.01);
  assert.equal(distanceInAu({ value: null, unit: 'pc' }), null);
  assert.equal(distanceInAu({ value: 5, unit: 'furlong' }), null);
  assert.equal(distanceInAu(null), null);
  const radii = RINGS.map((ring) => mapRadius(ring.au).r);
  for (let index = 1; index < radii.length; index += 1) assert.ok(radii[index] > radii[index - 1]);
  const step = mapRadius(100).r - mapRadius(10).r;
  assert.ok(Math.abs(mapRadius(1000).r - mapRadius(100).r - step) < 1e-12, 'equal steps per factor of ten');
  const place = placeOnMap({ distance: { value: 1.83, unit: 'pc' }, angle_deg: 0, angle_is_arbitrary: true });
  assert.ok(place.x > 0.5 && Math.abs(place.y - 0.5) < 1e-12);
  assert.equal(placeOnMap({ distance: { value: 1.83, unit: 'pc' }, angle_deg: 0, angle_is_arbitrary: false }), null);
  assert.equal(placeOnMap({ distance: null, angle_deg: 0, angle_is_arbitrary: true }), null);
  assert.equal(mapRadius(1e12).clamped, 'above');
});
