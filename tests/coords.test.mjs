import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCovariance, covarianceEllipse, parseCoordinates, parseDec, parseRa, separationDeg, tangentOffsetArcsec,
} from '../static/js/coords.js';
import { RESERVED_REGIONS, reservedRegionNear } from '../static/js/reserved.js';

const near = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not near ${expected}`);

test('right ascension in degrees and in hours', () => {
  near(parseRa('150.1'), 150.1);
  near(parseRa('10h00m24s'), 150.1);
  near(parseRa('10:00:24'), 150.1);
  near(parseRa('10 00 24'), 150.1);
  near(parseRa('150d06m'), 150.1);
  assert.equal(parseRa('360'), null);
  assert.equal(parseRa('-5'), null);
  assert.equal(parseRa('10h61m'), null);
  assert.equal(parseRa('abc'), null);
});

test('declination with signs, unicode minus and symbols', () => {
  near(parseDec('+2.2'), 2.2);
  near(parseDec('−56 48 04'), -(56 + 48 / 60 + 4 / 3600));
  near(parseDec('-0 30 00'), -0.5);
  near(parseDec('+02°12′00″'), 2.2);
  assert.equal(parseDec('91'), null);
  assert.equal(parseDec('10h'), null);
});

test('both coordinates in one text', () => {
  assert.deepEqual(parseCoordinates('150.1 2.2'), { ra: 150.1, dec: 2.2 });
  assert.deepEqual(parseCoordinates('150.1, -2.2'), { ra: 150.1, dec: -2.2 });
  const sexagesimal = parseCoordinates('10 00 24 +02 12 00');
  near(sexagesimal.ra, 150.1);
  near(sexagesimal.dec, 2.2);
  const marked = parseCoordinates('10h00m24s -02d12m00s');
  near(marked.dec, -2.2);
  assert.equal(parseCoordinates('Andromeda'), null);
  assert.equal(parseCoordinates('150.1'), null);
});

test('separation and tangent-plane offsets', () => {
  near(separationDeg(10, 20, 10, 21), 1, 1e-9);
  near(separationDeg(359.9, 0, 0.1, 0), 0.2, 1e-9);
  const offset = tangentOffsetArcsec(10, 0, 10 + 1 / 3600, 0);
  near(offset.east, 1, 1e-6);
  near(offset.north, 0, 1e-6);
  const north = tangentOffsetArcsec(10, 60, 10, 60 + 2 / 3600);
  near(north.north, 2, 1e-6);
});

test('covariance ellipse: axes and orientation', () => {
  const round = covarianceEllipse([[4, 0], [0, 4]], 1);
  near(round.major, 2);
  near(round.minor, 2);
  const northward = covarianceEllipse([[1, 0], [0, 9]], 5.991464547107979);
  near(northward.major, 3 * Math.sqrt(5.991464547107979));
  near(northward.minor, Math.sqrt(5.991464547107979));
  near(northward.angleDeg, 90);
  const tilted = covarianceEllipse([[2, 1], [1, 2]], 1);
  near(tilted.angleDeg, 45);
  assert.equal(covarianceEllipse([[1, 2], [2, 1]], 1), null, 'not positive definite');
  assert.deepEqual(addCovariance([[1, 0.2], [0.2, 1.44]], [[0.81, 0], [0, 0.81]]), [[1.81, 0.2], [0.2, 2.25]]);
});

test('live loading is refused near every reserved target', () => {
  for (const region of RESERVED_REGIONS) {
    const ra = Array.isArray(region.ra) ? (region.ra[0] + region.ra[1]) / 2 : region.ra;
    const dec = Array.isArray(region.dec) ? (region.dec[0] + region.dec[1]) / 2 : region.dec;
    assert.equal(reservedRegionNear(ra, dec, 0.1)?.key, region.key);
  }
  assert.equal(reservedRegionNear(269.4465 + 1.9, 4.7687, 0)?.key, 'barnard');
  assert.equal(reservedRegionNear(198.0, 20.5, 0)?.key, 'makemake', 'within 2 degrees of the Makemake path box');
  assert.equal(reservedRegionNear(306, -25.5, 0)?.key, 'pluto');
});

test('live loading is allowed far from the reserved targets', () => {
  assert.equal(reservedRegionNear(40, 60, 0.1), null);
  assert.equal(reservedRegionNear(10.68, 41.27, 0.5), null);
  assert.equal(reservedRegionNear(269.4465 + 2.5, 4.7687, 0.1), null);
});
