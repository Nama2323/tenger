// B5: "Could SPHEREx see Planet X? We measured it" and "Find the hidden planet" (DATA-CONTRACT V12 shapes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { has, t } from '../static/js/i18n.js';
import {
  bandModels, bandWavelengthCheck, depthAt, gapRows, injectedPerPoint, DEPTH_PATH, HIDDEN_PATH, judgeTap, magExtent, magRange, NATIVE_PIXEL_ARCSEC, PUBLISHED_BAND_UM, readDepth,
  readHiddenPlanet, tapReport, wilson,
} from '../static/js/planetx.js';

const FIXTURES = fileURLToPath(new URL('../static/dev-fixtures/', import.meta.url));
const fixture = (path) => JSON.parse(readFileSync(`${FIXTURES}${path}`, 'utf8'));
const DATA = fileURLToPath(new URL('../static/data/', import.meta.url));
/** Session A's real file when it is published, else null (the checks below then run on the example only). */
const real = (path) => (existsSync(`${DATA}${path}`) ? JSON.parse(readFileSync(`${DATA}${path}`, 'utf8')) : null);
/** The example file and, once published, the real one, each with a name for messages. */
const both = (path) => [['example', fixture(path)], ['real', real(path)]].filter(([, doc]) => doc);
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ''} ${actual} vs ${expected}`);

test('Wilson intervals match known values and stay inside 0–1', () => {
  const [low, high] = wilson(50, 100);
  near(low, 0.4038, 1e-4);
  near(high, 0.5962, 1e-4);
  const [zeroLow, zeroHigh] = wilson(0, 20);
  assert.equal(zeroLow, 0);
  near(zeroHigh, 0.1611, 1e-4);
  const [allLow, allHigh] = wilson(20, 20);
  near(allLow, 0.8389, 1e-4);
  assert.equal(allHigh, 1);
  assert.equal(wilson(5, 0), null);
  assert.equal(wilson(6, 5), null);
});

test('depths are where the recovered fraction crosses 50% and 90%, interpolated between points', () => {
  const curve = [{ mag: 17, fraction: 1 }, { mag: 18, fraction: 0.8 }, { mag: 19, fraction: 0.4 }, { mag: 20, fraction: 0 }];
  near(depthAt(curve, 0.5), 18.75, 1e-12);
  near(depthAt(curve, 0.9), 17.5, 1e-12);
  assert.equal(depthAt(curve, 1.5), null);
  assert.equal(depthAt([{ mag: 18, fraction: 1 }, { mag: 19, fraction: 0.95 }], 0.5), null, 'never crosses');
  assert.deepEqual(magRange({ min: 20, max: 21 }), [20, 21]);
  assert.deepEqual(magRange({ value: 21, plus: 0.5, minus: 0.3 }), [20.7, 21.5]);
  assert.deepEqual(magRange(19.5), [19.5, 19.5]);
  assert.equal(magRange(null), null);
});

test('the depth reader takes pooled curves, depth intervals, same-band models and the WISE limit', () => {
  const doc = {
    schema_version: 'tenger.planetx_depth/1', artificial: true, counts: false,
    method: { confidence: 0.95, injections_per_point: 200 },
    bands: [{
      id: 'w2', detector: 6, wavelength_um: [4.42, 5.0], published_band: 'WISE W2',
      pooled: {
        curve: [{ mag_ab: 17, injected: 200, recovered: 199 }, { mag_ab: 18, injected: 200, recovered: 120 }, { mag_ab: 19, injected: 200, recovered: 10 }],
        depth_50_ab: { value: 18.2, interval: [18.1, 18.3] }, depth_90_ab: null,
      },
      fields: [{ field_key: 'barnard', n_exposures: 30, curve: [{ mag_ab: 17, injected: 50, recovered: 50 }, { mag_ab: 18, injected: 50, recovered: 20 }] }],
    }],
    models: [{ id: 'a', reference: 'Paper A', band_id: 'w2', mag_ab: 21.3 }, { id: 'b', reference: 'Paper B', band_id: 'w2', mag_ab: null, note_key: 'x' }],
    wise_limit: { band_id: 'w2', mag_ab: 18.9, reference: 'Survey' },
    verdicts: [{ band_id: 'w2', model_id: 'a', gap_mag: { value: 3.1, sigma: 0.1 }, verdict_key: 'v' }],
    verdict_key: 'v',
    stacked_projection: { projection: true, depth_50_ab: 25 },
  };
  const depth = readDepth(doc);
  const band = depth.bands[0];
  assert.deepEqual(band.depth50, { value: 18.2, interval: [18.1, 18.3] });
  assert.equal(band.interpolated.d50, false);
  assert.ok(band.depth90.value > 17 && band.depth90.value < 18 && band.interpolated.d90, 'missing 90% depth is interpolated');
  assert.ok(band.curve.every((point) => point.interval[0] <= point.fraction && point.fraction <= point.interval[1]));
  assert.equal(band.fields.length, 1);
  assert.deepEqual(depth.models.map((model) => model.range), [[21.3, 21.3], null], 'a model without a same-band value is listed, not drawn');
  assert.equal(depth.wise.mag, 18.9);
  assert.equal(JSON.stringify(depth).includes('"projection"'), false, 'a stacked projection is never read as a measurement');
  const [low, high] = magExtent(band, [[21.3, 21.3], [18.9]]);
  assert.ok(low < 17 && high > 21.3, 'the chart range holds every marker');
  assert.deepEqual(readDepth({ ...doc, assumption_keys: ['a', 'b'], limitation_keys: ['b', 'c'] }).assumptionKeys, ['a', 'b', 'c'], 'limitation_keys are read too, each key once');
  assert.equal(readDepth({ ...doc, counts: true }), null);
  assert.equal(readDepth({ ...doc, schema_version: 'tenger.planetx-depth/1' }), null);
});

test('the example depth file is labelled and readable; real data take its place automatically', () => {
  const doc = fixture(DEPTH_PATH);
  assert.equal(doc.example, true);
  assert.equal(doc.artificial, true);
  const depth = readDepth(doc);
  assert.equal(depth.example, true);
  assert.ok(depth.bands.length >= 1 && depth.bands.every((band) => band.depth50));
});

test('hidden-planet rounds are refused unless every part is marked artificial and not counted', () => {
  const doc = fixture(HIDDEN_PATH);
  assert.equal(readHiddenPlanet(doc).pairs.length, 1);
  assert.equal(readHiddenPlanet({ ...doc, artificial: false }), null);
  assert.equal(readHiddenPlanet({ ...doc, artificial: undefined }), null);
  assert.equal(readHiddenPlanet({ ...doc, counts: true }), null);
  assert.equal(readHiddenPlanet({ ...doc, counts: undefined }), null);
  const pair = doc.pairs[0];
  const variant = (frames) => readHiddenPlanet({ ...doc, pairs: [{ ...pair, frames }] });
  assert.equal(variant([{ ...pair.frames[0], path: 'barnard/frames/a.webp' }, pair.frames[1]]), null, 'frames must live under planetx/');
  assert.equal(variant([{ ...pair.frames[0], content_type: 'measured' }, pair.frames[1]]), null, 'a frame marked as anything but artificial');
  assert.equal(variant([pair.frames[0]]), null, 'needs two frames');
  assert.equal(readHiddenPlanet({ ...doc, pairs: [{ ...pair, injected: [pair.injected[0]] }] }), null, 'needs the injected position in both frames');
});

test('a tap is judged against where the artificial planet was put, in pixels and arcseconds', () => {
  const round = readHiddenPlanet(fixture(HIDDEN_PATH)).pairs[0];
  const [first] = round.injected;
  const exact = judgeTap(round, { x: first.x, y: first.y });
  assert.equal(exact.distancePx, 0);
  assert.equal(exact.hit, true);
  const off = judgeTap(round, { x: first.x + 4, y: first.y + 3, frame: 0 });
  near(off.distancePx, 5, 1e-9);
  near(off.distanceArcsec, 5 * round.frames[0].pixelArcsec, 1e-9);
  assert.equal(off.hit, false);
  assert.equal(judgeTap(round, { x: Number.NaN, y: 1 }), null);
});

test('every visible label of the panel and the round exists in English', () => {
  for (const key of [
    'planetx.link', 'planetx.title', 'planetx.measuredChip', 'planetx.injectedChip', 'planetx.exampleNote', 'planetx.lead', 'planetx.axisMag',
    'planetx.assume.injected', 'planetx.assume.rule', 'planetx.assume.interval', 'planetx.assume.depth', 'planetx.assume.models', 'planetx.lessonLine',
    'hidden.title', 'hidden.chip', 'hidden.label', 'hidden.lead', 'hidden.leadExample', 'hidden.notCounted', 'hidden.youFound', 'hidden.youMissed',
    'hidden.pipelineFound', 'hidden.pipelineMissed', 'hidden.check', 'hidden.scaleResampled', 'hidden.scaleNative', 'planetx.bandMismatch', 'planetx.gapsSummary', 'planetx.gapTable', 'planetx.wiseRow',
  ]) assert.ok(has(key), key);
});

test('each band\'s published wavelength lies inside the SPHEREx array the file names (Johnson I in D1, W1 in D4, W2 in D6)', () => {
  assert.deepEqual(PUBLISHED_BAND_UM, { i: 0.8, w1: 3.35, w2: 4.6 });
  const expected = { i: 1, w1: 4, w2: 6 };
  for (const [name, doc] of both(DEPTH_PATH)) {
    for (const band of doc.bands) {
      const check = bandWavelengthCheck(band);
      assert.equal(band.detector, expected[band.id], `${name} ${band.id} is on array D${expected[band.id]}`);
      assert.equal(check.publishedInside, true, `${name} ${band.id}: ${check.published} µm inside D${band.detector} ${check.array}`);
      assert.notEqual(check.usedInside, false, `${name} ${band.id}: the file's wavelengths ${band.wavelength_um} lie inside D${band.detector}`);
      assert.equal(check.ok, true, `${name} ${band.id}`);
      if (Number.isFinite(band.nominal_um)) near(band.nominal_um, check.published, 0.1, `${name} ${band.id} nominal wavelength`);
    }
    assert.ok(readDepth(doc).bands.every((band) => band.check.ok), `${name}: the reader carries the check`);
  }
  // The mistake this guards against: W1 (3.35 µm) put on array D3 (1.63–2.41 µm).
  const wrong = bandWavelengthCheck({ id: 'w1', detector: 3, wavelength_um: [1.63, 2.41], published_band: 'WISE W1' });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.publishedInside, false);
  assert.equal(bandWavelengthCheck({ id: 'x', detector: 2, published_band: 'WISE W2' }).published, 4.6, 'falls back to the published band name');
  assert.equal(bandWavelengthCheck({ id: 'k', detector: 3, published_band: '2MASS K' }).ok, null, 'an unknown band is not judged');
});

test('the arcseconds shown equal the pixels shown times that frame\'s own pixel scale from the file', () => {
  for (const [name, doc] of both(HIDDEN_PATH)) {
    const read = readHiddenPlanet(doc);
    assert.ok(read, `${name} hidden-planet file is readable`);
    read.pairs.forEach((pair, index) => {
      const raw = doc.pairs[index];
      for (const point of pair.injected) {
        const fileScale = raw.frames[point.frame].pixel_arcsec;
        assert.equal(pair.frames[point.frame].pixelArcsec, fileScale, `${name} ${raw.id}: the scale is read from the file`);
        for (const [dx, dy] of [[3, 4], [1.23, 0.5], [0, 0]]) {
          const verdict = judgeTap(pair, { x: point.x + dx, y: point.y + dy, frame: point.frame });
          near(verdict.distanceArcsec, verdict.distancePx * fileScale, 1e-9, `${name} ${raw.id}`);
          const shown = tapReport(pair, verdict);
          assert.equal(shown.scale, fileScale);
          assert.equal(shown.px, Math.round(Math.hypot(dx, dy) * 10) / 10);
          near(shown.arcsec, shown.px * fileScale, 1e-9, `${name} ${raw.id}: shown arcsec = shown px × pixel_arcsec`);
          near(shown.toleranceArcsec, raw.tolerance_px * fileScale, 1e-9);
        }
      }
    });
  }
});

test('Session A\'s pairs: the pixel scale in the file agrees with the injected sky positions', { skip: real(HIDDEN_PATH) ? false : 'real hidden-planet.json not published yet' }, () => {
  const doc = real(HIDDEN_PATH);
  for (const pair of doc.pairs) {
    const [a, b] = pair.injected;
    const scale = pair.frames[0].pixel_arcsec;
    assert.equal(pair.frames[1].pixel_arcsec, scale, `${pair.id}: both frames on one grid`);
    const dec = (((a.dec_deg + b.dec_deg) / 2) * Math.PI) / 180;
    const sky = Math.hypot((b.ra_deg - a.ra_deg) * Math.cos(dec), b.dec_deg - a.dec_deg) * 3600;
    const px = Math.hypot(b.x - a.x, b.y - a.y);
    near(px * scale, sky, sky * 0.01 + 0.05, `${pair.id}: ${px.toFixed(2)} px × ${scale}″ vs ${sky.toFixed(2)}″ on the sky`);
    const shown = tapReport(readHiddenPlanet({ ...doc, pairs: [pair] }).pairs[0], { distancePx: 1, point: a });
    assert.equal(shown.resampled, Math.abs(scale - NATIVE_PIXEL_ARCSEC) / NATIVE_PIXEL_ARCSEC > 0.05, `${pair.id}: says so when the frames were resampled`);
  }
});

test('the headline verdict is filled with the file\'s numbers, and every published value is listed against our depth', () => {
  for (const [name, doc] of both(DEPTH_PATH)) {
    const depth = readDepth(doc);
    if (depth.verdictSummary) {
      const words = has(depth.verdictSummary.key) ? t(depth.verdictSummary.key, depth.verdictSummary.values) : depth.verdictSummary.text;
      const template = has(depth.verdictSummary.key) ? t(depth.verdictSummary.key) : '';
      for (const placeholder of template.match(/\{(\w+)\}/g) ?? []) {
        assert.ok(placeholder.slice(1, -1) in depth.verdictSummary.values, `${name}: ${placeholder} has a value in the file`);
      }
      assert.ok(!/\{\w+\}/.test(words), `${name}: no placeholder left`);
    }
    const { rows, tooFaint, closest } = gapRows(depth);
    assert.equal(rows.length, doc.verdicts.filter((verdict) => Number.isFinite(verdict.gap_mag?.value)).length);
    assert.equal(tooFaint, rows.filter((row) => row.gap > 0).length);
    assert.ok(rows.every((row) => row.gap >= closest.gap));
    for (const row of rows) if (row.predicted !== null && row.depth !== null) near(row.gap, row.predicted - row.depth, 0.02, `${name} ${row.modelId}: gap = prediction − depth`);
  }
  const published = real(DEPTH_PATH);
  if (published) {
    const { rows, tooFaint, closest } = gapRows(readDepth(published));
    assert.equal(tooFaint, rows.length, 'Session A: every gap is positive');
    assert.equal(closest.modelId, 'lm16-280au-i');
    near(closest.gap, 0.36, 1e-9);
    assert.ok(rows.some((row) => row.wise), 'the WISE limit row is recognised');
  }
});

test('the injection count comes from the method or the curves, and chart markers are numbered faintest last', () => {
  for (const [name, doc] of both(DEPTH_PATH)) {
    const depth = readDepth(doc);
    const counts = injectedPerPoint(depth);
    const all = depth.bands.flatMap((band) => band.curve.map((point) => point.injected));
    if (Number.isFinite(doc.method?.injections_per_point)) assert.deepEqual(counts, [doc.method.injections_per_point, doc.method.injections_per_point], name);
    else assert.deepEqual(counts, [Math.min(...all), Math.max(...all)], name);
    for (const band of depth.bands) {
      const models = bandModels(depth, band.id);
      assert.deepEqual(models.map((model) => model.number), models.map((_, index) => index + 1), `${name} ${band.id}`);
      assert.ok(models.every((model, index) => index === 0 || models[index - 1].range[0] <= model.range[0]), `${name} ${band.id}: brightest first`);
    }
  }
});
