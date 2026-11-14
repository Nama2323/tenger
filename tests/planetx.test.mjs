// B5: "Could SPHEREx see Planet X? We measured it" and "Find the hidden planet" (DATA-CONTRACT V12 shapes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { has, t } from '../static/js/i18n.js';
import {
  bandModels, bandWavelengthCheck, depthAt, gapRows, headline, injectedPerPoint, DEPTH_PATH, HIDDEN_PATH, judgeTap, magExtent, magRange, NATIVE_PIXEL_ARCSEC, oneIn, PUBLISHED_BAND_UM,
  reachOf, readDepth, readHiddenPlanet, recoveredAt, tapReport, TOO_FAINT_BELOW, wilson,
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
    'hidden.pipelineFound', 'hidden.pipelineMissed', 'hidden.check', 'hidden.scaleResampled', 'hidden.scaleNative', 'planetx.bandMismatch', 'planetx.reachCount', 'planetx.reachPartialLine', 'planetx.reachWithinLine', 'planetx.sigmaNote', 'planetx.gapTable', 'planetx.wiseRow',
    'planetx.reach.rule', 'planetx.reach.faint', 'planetx.reach.partial', 'planetx.reach.within', 'planetx.reach.unknown', 'planetx.col.found', 'planetx.col.reach',
    'planetx.found.point', 'planetx.found.interpolated', 'planetx.found.tested', 'planetx.found.fainter', 'planetx.found.brighter', 'planetx.headline',
    'planetx.headline.closestOdds', 'planetx.headline.closestPct', 'planetx.headline.onePct', 'planetx.headline.some', 'planetx.headline.none',
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
    const { rows, fainterThanDepth, tooFaint, partial, within, unknown, unread, closest } = gapRows(depth);
    assert.equal(rows.length, doc.verdicts.filter((verdict) => Number.isFinite(verdict.gap_mag?.value)).length);
    assert.equal(fainterThanDepth, rows.filter((row) => row.gap > 0).length);
    assert.equal(tooFaint + partial.length + within.length + unknown + unread, rows.length, `${name}: every row is placed once`);
    assert.ok(rows.every((row) => row.gap >= closest.gap));
    for (const row of rows) if (row.predicted !== null && row.depth !== null) near(row.gap, row.predicted - row.depth, 0.02, `${name} ${row.modelId}: gap = prediction − depth`);
  }
  const published = real(DEPTH_PATH);
  if (published) {
    const { rows, fainterThanDepth, closest } = gapRows(readDepth(published));
    assert.equal(fainterThanDepth, rows.length, 'Session A: every published value is fainter than our 50% depth');
    assert.equal(closest.modelId, 'lm16-280au-i');
    near(closest.gap, 0.36, 1e-9);
    assert.ok(rows.some((row) => row.wise), 'the WISE limit row is recognised');
  }
});

test('the fraction found at a published value is read from the pooled curve: the point itself, interpolated, or bounded beyond it', () => {
  const curve = [
    { mag: 17, fraction: 0.6, interval: [0.55, 0.65] }, { mag: 17.25, fraction: 0.4153, interval: [0.3722, 0.4597] },
    { mag: 17.5, fraction: 0.25, interval: [0.2135, 0.2904] }, { mag: 18, fraction: 0, interval: [0, 0.0079] },
  ];
  const between = recoveredAt(curve, 17.45);
  assert.equal(between.interpolated, true);
  near(between.fraction, 0.4153 + 0.8 * (0.25 - 0.4153), 1e-12);
  assert.deepEqual(between.points.map((point) => point.mag), [17.25, 17.5], 'both neighbours, so their intervals can be shown');
  const on = recoveredAt(curve, 17.5);
  assert.equal(on.interpolated, false);
  assert.equal(on.fraction, 0.25);
  const fainter = recoveredAt(curve, 21);
  assert.equal(fainter.beyond, 'faint');
  assert.equal(fainter.fraction, null, 'no value is made up beyond the tested range');
  assert.equal(fainter.upper, 0.0079);
  const brighter = recoveredAt(curve, 15);
  assert.equal(brighter.beyond, 'bright');
  assert.equal(brighter.lower, 0.55);
  assert.equal(recoveredAt(curve, Number.NaN), null);
  assert.equal(recoveredAt([curve[0]], 17), null);
});

test('"too faint for one exposure" only below 5% found; between 5% and the 50% depth it says how often', () => {
  assert.equal(TOO_FAINT_BELOW, 0.05);
  assert.equal(reachOf({ fraction: 0.049, beyond: null }, 1), 'faint');
  assert.equal(reachOf({ fraction: 0.05, beyond: null }, 1), 'partial');
  assert.equal(reachOf({ fraction: 0.283, beyond: null }, 0.36), 'partial');
  assert.equal(reachOf({ fraction: 0.6, beyond: null }, -0.2), 'within');
  assert.equal(reachOf({ fraction: null, beyond: 'faint', upper: 0.0079 }, 4), 'faint');
  assert.equal(reachOf({ fraction: null, beyond: 'faint', upper: 0.2 }, 4), 'unknown', 'a faint end that does not rule out 5% is not called too faint');
  assert.equal(reachOf(null, 1), null);
  assert.equal(oneIn(0.2831), 4);
  assert.equal(oneIn(0.04), null);
  assert.equal(oneIn(0.6), null);
  for (const [name, doc] of both(DEPTH_PATH)) {
    for (const row of gapRows(readDepth(doc)).rows) {
      if (!row.found) continue;
      const atMost = row.found.fraction ?? row.found.upper ?? 1;
      if (row.reach === 'faint') assert.ok(atMost < 0.05, `${name} ${row.modelId}: called too faint at ${atMost}`);
      if (row.found.fraction !== null && row.found.fraction >= 0.05) assert.notEqual(row.reach, 'faint', `${name} ${row.modelId}`);
    }
  }
});

test('Session A\'s curve: the 280 AU Linder & Mordasini case is found in about 28% of single exposures, every other value under 5%', { skip: real(DEPTH_PATH) ? false : 'real depth.json not published yet' }, () => {
  const depth = readDepth(real(DEPTH_PATH));
  const summary = gapRows(depth);
  assert.deepEqual(summary.partial.map((row) => row.modelId), ['lm16-280au-i']);
  const [row] = summary.partial;
  assert.equal(row.found.interpolated, true);
  assert.deepEqual(row.found.points.map((point) => point.mag), [17.25, 17.5]);
  near(row.found.fraction, 0.283, 0.001, 'user\'s figure: about 28%');
  assert.equal(summary.tooFaint, summary.rows.length - 1);
  assert.equal(summary.within.length, 0);
  const built = headline(depth);
  const words = t(built.key, { ...built.values, reach: t(built.reach.key, built.reach.values) });
  assert.match(words, /Only the closest published case comes within reach, and one exposure would catch it about 1 time in 4\./);
  assert.ok(!/\{\w+\}/.test(words), 'no placeholder left');
  assert.ok(!/brightest published scenarios/.test(words), 'the older wording is gone');
});

test('the ± next to each gap is said to be our measurement error only, not the planet\'s own uncertainty', () => {
  const note = t('planetx.sigmaNote', { sigma: '± 0.04' });
  assert.match(note, /± 0\.04/);
  assert.match(note, /measurement error only/);
  assert.match(note, /mass, albedo and distance/);
  assert.match(t('planetx.col.gap'), /our error/);
});

test('the file\'s per-row verdict keys agree with the curve once Session A has updated them (A10)', () => {
  for (const [name, doc] of both(DEPTH_PATH)) {
    const rows = gapRows(readDepth(doc)).rows.filter((row) => row.reach);
    const updated = doc.verdicts.some((verdict) => 'recovered_fraction' in verdict || verdict.verdict_key === 'planetx.verdict.partial');
    const expectedKey = { faint: 'planetx.verdict.too-faint', partial: 'planetx.verdict.partial', within: 'planetx.verdict.within-depth' };
    const disagree = rows.filter((row) => expectedKey[row.reach] && row.verdictKey !== expectedKey[row.reach] && !row.verdictKey.startsWith('planetx.example.'));
    if (updated) {
      assert.deepEqual(disagree.map((row) => row.modelId), [], `${name}: file verdict keys match the curve`);
      for (const row of rows) {
        const given = doc.verdicts.find((verdict) => verdict.model_id === row.modelId && verdict.band_id === row.bandId)?.recovered_fraction;
        const value = typeof given === 'object' && given !== null ? given.value : given;
        if (Number.isFinite(value) && row.found.fraction !== null) near(value, row.found.fraction, 0.005, `${name} ${row.modelId}: file fraction vs curve`);
      }
    } else {
      // Before A10 the only disagreement allowed is the overstated "too faint" on rows the curve places between 5% and 50%.
      assert.ok(disagree.every((row) => row.reach === 'partial' && row.verdictKey === 'planetx.verdict.too-faint'), `${name}: ${disagree.map((row) => row.modelId)}`);
    }
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

test('the motion between the frames is read as the contract gives it (V12 object, or a plain number)', () => {
  const published = real(HIDDEN_PATH);
  if (published) {
    const pairs = readHiddenPlanet(published).pairs;
    pairs.forEach((pair, index) => assert.equal(pair.motion, published.pairs[index].motion_arcsec.total, published.pairs[index].id));
  }
  assert.equal(readHiddenPlanet(fixture(HIDDEN_PATH)).pairs[0].motion, fixture(HIDDEN_PATH).pairs[0].motion_arcsec);
});

test('Session A\'s headline and the page\'s own headline say the same once the file carries one_in (A10 follow-up)', () => {
  const doc = real(DEPTH_PATH);
  if (!doc?.verdict_summary?.values?.one_in) return;
  const depth = readDepth(doc);
  const built = headline(depth);
  assert.equal(t(built.key, { ...built.values, reach: t(built.reach.key, built.reach.values) }), t(depth.verdictSummary.key, depth.verdictSummary.values));
  assert.equal(built.reach.values.odds, doc.verdict_summary.values.one_in);
});
