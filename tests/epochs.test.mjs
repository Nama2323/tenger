import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allowsDifference, arrayOfBand, comparisonReasons, epochAt, epochCoverage, pairComparison, parseObsKey } from '../static/js/epochs.js';
import { BUILT_IN_REGIONS, parseReserved, reservedRegionNear, reservedSource, useReserved, loadReserved } from '../static/js/reserved.js';

const doc = {
  epochs: [
    { id: 'v0-d6', detector: 6, viewer: { visit: 0, frame_indices: [1, 2] } },
    { id: 'v3-d6', detector: 6, viewer: { visit: 3, frame_indices: [9] } },
    { id: 'v0-d1', detector: 1, viewer: { visit: 0, frame_indices: [0] } },
    { id: 'v3-d1', viewer: { visit: 3, frame_indices: [8] } },
  ],
  comparisons: [
    { id: 'c6', a: 'v0-d6', b: 'v3-d6', grade: 'quantitative', modes: ['blink', 'side_by_side', 'swipe', 'difference'],
      brightness: { grade: 'quantitative', reason_key: 'compare.matched-pairs' }, position: { grade: 'quantitative', reason_key: 'compare.response-matched' }, field: 'quantitative' },
    { id: 'c1', a: 'v3-d1', b: 'v0-d1', grade: 'qualitative', modes: ['blink', 'side_by_side', 'swipe'], brightness: { grade: 'qualitative', reason_key: 'compare.response-shifted' } },
  ],
};

test('observation keys parse into collection, obs_id and detector', () => {
  assert.deepEqual(parseObsKey('spherex_dr1:2025W33_2C_0321_1:D6'), { collection: 'spherex_dr1', obsId: '2025W33_2C_0321_1', detector: 6 });
  assert.equal(parseObsKey('nonsense'), null);
});

test('a band belongs to one array; the composite mixes arrays', () => {
  assert.equal(arrayOfBand({ kind: 'detector', detector: 4 }), 4);
  assert.equal(arrayOfBand({ kind: 'channel', channel: 99 }), 6);
  assert.equal(arrayOfBand({ kind: 'composite' }), null);
});

test('epochs are found by viewer visit and array (detector field or id suffix)', () => {
  assert.equal(epochAt(doc.epochs, 3, 6).id, 'v3-d6');
  assert.equal(epochAt(doc.epochs, 3, 1).id, 'v3-d1');
  assert.equal(epochAt(doc.epochs, 5, 6), null);
});

test('the viewer pair finds the same-array comparison in either order', () => {
  const six = pairComparison(doc, 0, 3, { kind: 'detector', detector: 6 });
  assert.equal(six.comparison.id, 'c6');
  assert.equal(allowsDifference(six.comparison), true);
  assert.deepEqual(comparisonReasons(six.comparison), ['compare.matched-pairs', 'compare.response-matched']);
  const one = pairComparison(doc, 0, 3, { kind: 'detector', detector: 1 });
  assert.equal(one.comparison.id, 'c1');
  assert.equal(allowsDifference(one.comparison), false, 'qualitative: no difference image');
  assert.equal(pairComparison(doc, 0, 3, { kind: 'composite' }).reason, 'composite');
  assert.equal(pairComparison(doc, null, 3, { kind: 'detector', detector: 6 }).reason, 'context');
  assert.equal(pairComparison(doc, 0, 5, { kind: 'detector', detector: 6 }).reason, 'no-epoch');
  assert.equal(pairComparison(null, 0, 3, { kind: 'detector', detector: 6 }).reason, 'no-epoch');
  assert.equal(allowsDifference(null), false);
  assert.equal(allowsDifference({ grade: 'quantitative', modes: ['blink'] }), false);
});

test('the real Epsilon Indi B file allows a difference image only where Session A says so', () => {
  const real = JSON.parse(readFileSync(new URL('../static/data/epsindib/investigation.json', import.meta.url), 'utf8'));
  const d1 = pairComparison(real, 0, 2, { kind: 'detector', detector: 1 });
  assert.equal(allowsDifference(d1.comparison), true);
  assert.equal(d1.comparison.checks.background, 'not_checked', 'the caption must say background was not checked');
  const d5 = pairComparison(real, 0, 2, { kind: 'detector', detector: 5 });
  assert.equal(allowsDifference(d5.comparison), false, 'registration not verified: no difference image');
  assert.equal(pairComparison(real, 0, 2, { kind: 'composite' }).reason, 'composite');
  const allowed = real.comparisons.filter(allowsDifference);
  for (const comparison of allowed) {
    assert.equal(comparison.checks.psf, 'pass');
    assert.equal(comparison.checks.registration, 'pass');
  }
});

test('epoch coverage counts epochs on visits the viewer has', () => {
  assert.deepEqual(epochCoverage(doc, [0, 3]), { matched: 4, total: 4 });
  assert.deepEqual(epochCoverage(doc, [0]), { matched: 2, total: 4 });
  assert.deepEqual(epochCoverage(null, [0]), { matched: 0, total: 0 });
});

test('the published reserved.json (A3) is valid: holdout and see-only paths, challenge targets open', () => {
  const real = JSON.parse(readFileSync(new URL('../static/data/reserved.json', import.meta.url), 'utf8'));
  const parsed = parseReserved(real);
  assert.ok(parsed, 'the real file parses');
  try {
    useReserved(parsed);
    assert.deepEqual(parsed.regions.map((region) => region.key).sort(), ['3i-atlas', 'makemake', 'pluto']);
    // V10: Pluto (verified) and Makemake (nothing to verify) are released; 3I/ATLAS stays reserved.
    for (const key of ['pluto', 'makemake']) {
      const region = real.regions.find((item) => item.key === key);
      assert.equal(region.status, 'released');
      const point = region.path[0];
      assert.equal(reservedRegionNear(point.ra_deg, point.dec_deg, 0.1), null, `${key} no longer blocks`);
    }
    const comet = real.regions.find((region) => region.key === '3i-atlas');
    assert.notEqual(comet.status, 'released');
    assert.equal(reservedRegionNear(comet.path[0].ra_deg, comet.path[0].dec_deg, 0.1)?.key, '3i-atlas');
    assert.equal(reservedRegionNear(comet.path[0].ra_deg + 1.9, comet.path[0].dec_deg, 0)?.key, '3i-atlas', 'within the 2 degree margin');
    assert.equal(reservedRegionNear(269.4465, 4.7687, 0.1), null, 'Barnard data were all opened in A3');
  } finally {
    useReserved(null);
  }
});

test('only an explicit release with a reason lifts a region; anything else stays reserved', () => {
  const path = [{ ra_deg: 306, dec_deg: -23.7 }];
  const doc = (extra) => ({ schema_version: 'tenger.reserved/1', margin_deg: 2, regions: [{ key: 'pluto', path, ...extra }] });
  const cases = [
    [{}, 'pluto'],
    [{ status: 'reserved' }, 'pluto'],
    [{ status: 'open' }, 'pluto'],
    [{ status: 'released' }, 'pluto'],
    [{ status: 'released', release_reason_key: 'reserved.released-verified' }, null],
  ];
  try {
    for (const [extra, expected] of cases) {
      useReserved(parseReserved(doc(extra)));
      assert.equal(reservedRegionNear(306, -23.7, 0.1)?.key ?? null, expected, JSON.stringify(extra));
    }
  } finally {
    useReserved(null);
  }
});

test('reserved.json is used only when it is a valid, real file; otherwise the built-in list stays', () => {
  const valid = {
    schema_version: 'tenger.reserved/1',
    margin_deg: 2,
    regions: [{ key: 'barnard', ra_deg: 269.4465, dec_deg: 4.7687 }, { key: 'pluto', ra_range_deg: [304.1, 308.6], dec_range_deg: [-23.8, -22.8] }],
  };
  assert.equal(parseReserved(valid).regions.length, 2);
  assert.equal(parseReserved({ ...valid, example: true }), null, 'never from an example file');
  assert.equal(parseReserved({ ...valid, schema_version: 'tenger.reserved/2' }), null);
  assert.equal(parseReserved({ ...valid, regions: [] }), null);
  assert.equal(parseReserved({ ...valid, regions: [...valid.regions, { key: 'bad', ra: 500, dec: 0 }] }), null, 'one bad region rejects the file');
  assert.equal(parseReserved({ ...valid, regions: [{ key: 'p', path: [{ ra_deg: 10, dec_deg: 95 }] }] }), null, 'bad path point');
  const path = parseReserved({ ...valid, regions: [{ key: 'p', path: [{ ra_deg: 10, dec_deg: 0 }, { ra_deg: 20, dec_deg: 0 }] }] });
  assert.equal(path.regions[0].path.length, 2);
  assert.equal(parseReserved({ ...valid, margin_deg: -1 }), null);
  try {
    useReserved(parseReserved(valid));
    assert.equal(reservedSource(), 'file');
    assert.equal(reservedRegionNear(306, -23, 0)?.key, 'pluto');
    assert.equal(reservedRegionNear(201, 21, 0), null, 'the file is authoritative once valid');
  } finally {
    useReserved(null);
  }
  assert.equal(reservedSource(), 'built-in');
  assert.equal(reservedRegionNear(201, 21, 0)?.key, 'makemake');
  assert.equal(BUILT_IN_REGIONS.length, 7);
});

test('a missing or unreadable reserved.json keeps the built-in list', async () => {
  assert.equal(await loadReserved(async () => ({ ok: false, status: 404 })), 'built-in');
  assert.equal(await loadReserved(async () => { throw new Error('offline'); }), 'built-in');
  assert.equal(await loadReserved(async () => ({ ok: true, json: async () => ({ nonsense: true }) })), 'built-in');
});
