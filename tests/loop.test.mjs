// "Why Pluto loops": the geometry against the loop data in scene3d.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { has } from '../static/js/i18n.js';
import {
  drawnSightline, eclipticOfRadec, EXAGGERATION, keplerPosition, loopModel, norm, observerAt, parallaxDeg, plutoOrbit,
  radecOf, raySphere, separationArcsec, sub, timeline, truePath,
} from '../static/js/loop.js';

const DATA = fileURLToPath(new URL('../static/data/', import.meta.url));
const scene = JSON.parse(readFileSync(`${DATA}scene3d.json`, 'utf8'));
const loop = scene.pluto_loop;
const v2 = ['pluto-position-open-2027a-v2b', 'pluto-position-open-2027b-v2b']
  .map((id) => ({ id, ...JSON.parse(readFileSync(`${DATA}trials/${id}/prediction.json`, 'utf8')) }));

test('our frozen orbit, propagated, lands on the fitted Pluto positions and on position_now', () => {
  const orbit = plutoOrbit(scene);
  for (const entry of [...loop.training, ...loop.evaluation]) {
    // fitted_pluto_au is at the light-emission time, about 0.2 days earlier at 35 au.
    assert.ok(norm(sub(orbit(entry.t_mjd - 0.2), entry.fitted_pluto_au)) < 0.002, entry.obs_key);
  }
  const ours = scene.bodies.pluto.our_orbit;
  assert.ok(norm(sub(orbit(scene.epoch_jd_tdb - 2400000.5), ours.position_now_au)) < 0.002);
  assert.deepEqual(keplerPosition({ a: 1, e: 0, i: 0, om: 0, w: 0, ma: 0 }, 0, 0).map((value) => Math.round(value * 1e9) / 1e9), [1, 0, 0]);
});

test('directions from the data vectors match the measured RA/Dec of the training exposures', () => {
  for (const entry of loop.training.filter((item) => item.measured)) {
    const direction = sub(entry.fitted_pluto_au, entry.spherex_au);
    assert.ok(separationArcsec(direction, eclipticOfRadec(entry.measured.ra_deg, entry.measured.dec_deg)) < 3, entry.obs_key);
  }
  const { ra, dec } = radecOf(eclipticOfRadec(306.1, -23.7));
  assert.ok(Math.abs(ra - 306.1) < 1e-9 && Math.abs(dec + 23.7) < 1e-9);
});

test('the telescope position from JPL elements agrees with the FITS-header positions', () => {
  for (const entry of [...loop.training, ...loop.evaluation]) assert.ok(norm(sub(observerAt(entry.t_mjd), entry.spherex_au)) < 0.001);
});

test('drawn sight lines pass through Pluto and end on the sky sphere; the loop is exaggerated as labelled', () => {
  const orbit = plutoOrbit(scene);
  const t = loop.evaluation[0].t_mjd;
  const line = drawnSightline(observerAt(t), orbit(t), 160);
  assert.ok(Math.abs(norm(line.sky) - 160) < 1e-9);
  const toPluto = sub(line.through, line.from);
  const toSky = sub(line.sky, line.from);
  assert.ok(separationArcsec(toPluto, toSky) < 1e-3, 'through Pluto');
  assert.ok(Math.abs(norm(raySphere([1, 0, 0], [1, 0, 0], 5)) - 5) < 1e-12);
  // Seen from the Sun, the drawn loop is wider than the true apparent path by roughly the exaggeration.
  const times = timeline(60943, 61500, 5);
  const middle = times[Math.floor(times.length / 2)];
  const spread = (points, centre) => Math.max(...points.map((point) => separationArcsec(point, centre)));
  const drawn = times.map((mjd) => drawnSightline(observerAt(mjd), orbit(mjd), 160).sky);
  const real = times.map((mjd) => sub(orbit(mjd), observerAt(mjd)));
  const ratio = spread(drawn, drawnSightline(observerAt(middle), orbit(middle), 160).sky) / spread(real, sub(orbit(middle), observerAt(middle)));
  assert.ok(ratio > EXAGGERATION / 3 && ratio < EXAGGERATION * 1.5, String(ratio));
  assert.ok(Math.abs(parallaxDeg(35.6) - 1.61) < 0.01);
});

test('the loop model holds the exposures, the 2026 check and the v1 and v2 forecast tracks', () => {
  const model = loopModel(scene, v2);
  assert.equal(model.training.length, loop.training.length);
  assert.equal(model.evaluation.length, loop.evaluation.length);
  assert.ok(model.frozen && model.observed.verdict === 'miss');
  assert.deepEqual(model.tracks.map((track) => track.version), [1, 2, 2]);
  // v2 points rebuilt from RA/Dec and the geocentric distance sit on the same sky positions.
  for (const point of model.tracks[1].points) {
    assert.ok(separationArcsec(sub(point.pluto, point.observer), eclipticOfRadec(point.ra, point.dec)) < 0.01);
  }
  assert.ok(model.start < loop.training[0].t_mjd && model.end > model.tracks.at(-1).points.at(-1).tMjd);
  const path = truePath(model.orbit, [loop.evaluation[0].t_mjd]);
  assert.ok(Math.abs(path[0].ra - loop.evaluation[0].measured.ra_deg) < 0.01);
  assert.equal(loopModel({ ...scene, pluto_loop: undefined }), null);
  for (const key of ['loop.title', 'loop.scale', 'loop.fromSpherex', 'loop.top', 'loop.view2d', 'loop.link', 'loop.checkLabel', 'nav.loop']) assert.ok(has(key), key);
});
