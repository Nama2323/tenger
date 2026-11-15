// Task B18: the zoomed inset of the reveal (steps 4–6). It appears only where the main map hides the miss or the oval
// under one mark, frames the forecast centre, the 95% oval and the real position from the trial files, states its real
// magnification, and keeps a miss just outside the oval visibly apart at phone width.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { has, t } from '../static/js/i18n.js';
import { revealModel } from '../static/js/ledger.js';
import { shortAngle } from '../static/js/predict-story.js';
import { insetView, roundZoom } from '../static/js/reveal.js';

const DATA = fileURLToPath(new URL('../static/data/', import.meta.url));
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const board = read(join(DATA, 'scoreboard.json'));

function bundle(id) {
  const folder = join(DATA, 'trials', id);
  const file = (name) => (existsSync(join(folder, name)) ? { state: 'ok', doc: read(join(folder, name)) } : { state: 'missing' });
  return { id, trial: file('trial.json'), prediction: file('prediction.json'), receipt: file('receipt.json'), verification: file('verification.json'), training: file('training.json') };
}

/** The reveal model of a trial and the inset the verdict step (step 6) draws on a map `size` px wide. */
function verdictInset(id, size) {
  const b = bundle(id);
  const model = revealModel(b, b.training);
  assert.ok(model, `${id}: reveal model`);
  const mainSpan = model.views.focus.span;
  const oval = model.testRegion ?? model.region;
  const view = insetView({ model: model.model, observed: model.observed, oval, mainSpan, mainScale: size / mainSpan, distance: model.distance, limit: model.limit });
  return { model, view, oval, mainSpan, width: Math.round(size * (size < 420 ? 0.44 : 0.4)) };
}

/** Shortest distance (arcsec) from a point to the edge of an oval { major, minor, angleDeg } centred on `centre`. */
function edgeDistance(point, centre, oval) {
  const phi = (oval.angleDeg * Math.PI) / 180;
  let best = Infinity;
  for (let k = 0; k < 20000; k += 1) {
    const theta = (2 * Math.PI * k) / 20000;
    const east = centre.east + oval.major * Math.cos(theta) * Math.cos(phi) - oval.minor * Math.sin(theta) * Math.sin(phi);
    const north = centre.north + oval.major * Math.cos(theta) * Math.sin(phi) + oval.minor * Math.sin(theta) * Math.cos(phi);
    best = Math.min(best, Math.hypot(point.east - east, point.north - north));
  }
  return best;
}

const PHONE = 366; // the reveal's map at a 390 px wide phone
const DESKTOP = 650; // and at 1280 px

test('the title states the real magnification: two significant figures, and the inset is drawn at exactly that', () => {
  assert.equal(roundZoom(5987), 6000);
  assert.equal(roundZoom(1234), 1200);
  assert.equal(roundZoom(8.71), 8.7);
  assert.equal(roundZoom(0.5), 1);
  for (const size of [PHONE, DESKTOP]) {
    const { view, mainSpan } = verdictInset('pluto-position-2026b', size);
    assert.equal(view.factor, Number(view.factor.toPrecision(2)));
    assert.ok(Math.abs(mainSpan / view.span - view.factor) < 1e-6 * view.factor);
    assert.equal(t('reveal.inset.title', { factor: new Intl.NumberFormat('en').format(view.factor) }), `Zoomed in ${new Intl.NumberFormat('en').format(view.factor)}×`);
  }
});

test('Pluto: the inset frames the forecast centre and the real position, and the miss stays visibly outside the oval', () => {
  for (const size of [PHONE, DESKTOP]) {
    const { model, view, oval, width } = verdictInset('pluto-position-2026b', size);
    assert.ok(view, 'Pluto gets an inset');
    assert.ok(view.factor >= 1000, `zoomed ${view.factor}×`);
    for (const point of [model.model, model.observed]) {
      assert.ok(Math.abs(point.east - view.centre.east) < view.span / 2 && Math.abs(point.north - view.centre.north) < view.span / 2, 'inside the inset');
    }
    // The real position is outside the verdict's oval (D > limit), and the gap is wide enough to see on a phone:
    // the inset's cross reaches 3 px on a phone and 5 px on a desktop, and the oval's line is 1.25 px wide.
    assert.ok(model.distance > model.limit);
    const gap = edgeDistance(model.observed, model.model, oval);
    assert.ok(gap > 0.2 && gap < 0.4, `gap ${gap}″`);
    const pixels = gap * (width / view.span);
    assert.ok(pixels >= (size < 420 ? 6 : 9), `gap on screen ${pixels.toFixed(1)} px at ${size}`);
  }
  // The label is the file's model error, as the step-6 sentence and the scoreboard give it.
  const { model } = verdictInset('pluto-position-2026b', PHONE);
  const row = board.rows.find((item) => item.trial_id === 'pluto-position-2026b');
  assert.equal(shortAngle(model.modelResidual.error_arcsec), '5.9″');
  assert.equal(model.modelResidual.error_arcsec, row.model_error_arcsec);
});

test('the inset appears only where the main map hides the oval or the miss under one mark', () => {
  for (const size of [PHONE, DESKTOP]) {
    assert.ok(verdictInset('asteroid-345-position', size).view, 'asteroid 345: the map spans degrees');
    assert.ok(verdictInset('epsindib-position-2026b', size).view, 'Epsilon Indi B: the 0.08″ miss and its small oval sit under the cross');
    assert.equal(verdictInset('barnard-position-2026b', size).view, null, "Barnard's Star: the oval and the 1.52″ miss are visible on the map");
  }
});

test('no "just outside by" line: the trial files do not give that number', () => {
  const verification = JSON.stringify(read(join(DATA, 'trials', 'pluto-position-2026b', 'verification.json')));
  assert.ok(!/outside_by|margin_arcsec|excess_arcsec/.test(verification));
  assert.ok(!has('reveal.inset.outsideBy'));
});
