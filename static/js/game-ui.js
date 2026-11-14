// Beat the physics: one round at a time, built from a game record (DATA-CONTRACT §11) and its trial.
// The player places a guess (tap, arrow keys or numbers), then the page reveals, in this order,
// the straight-line baseline, the frozen model with its region, and the real observation.
import { covarianceEllipse } from './coords.js';
import { $, chip, dataTable, el, formatNumber, formatUtc, withUnit } from './dom.js';
import {
  checkRound, errorUnit, fromOffset, isMagnitude, lastMeasurement, physicsLost, readBest, revealView, roundKind, saveBest, scalarView, scoreRound, ticks,
  toOffset,
} from './game.js';
import { has, t } from './i18n.js';
import { categoryChip, categoryNote, exampleChip, prospectiveChip, trialStatusChip } from './labels.js';
import { mjdToDate } from './stack.js';

const SIZE = 400;
const PAD = 46;
const INNER = SIZE - 2 * PAD;
const STEPS_PER_VIEW = 40;
const FAST_STEP = 5;
const STAGES = ['guess', 'locked', 'baseline', 'model', 'actual'];
const NEXT_LABEL = { locked: 'game.showBaseline', baseline: 'game.showModel', model: 'game.showActual' };
const FROM_ARCSEC = { arcsec: 1, arcmin: 1 / 60, deg: 1 / 3600 };
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Everything the page needs, set by main.js. */
let context = null;
/** The round being played. */
let play = null;

const storage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

function svg(name, attributes = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

const dateOf = (mjd) => formatUtc(mjdToDate(mjd), { time: false });
const displayFactor = (round) => (roundKind(round) === 'position' ? FROM_ARCSEC[errorUnit(round)] ?? 1 : 1);

// ---------- Marker shapes (shared by the plot and its legend) ----------

function marker(who, x, y) {
  const group = svg('g', { class: `mark mark-${who}` });
  if (who === 'training') group.append(svg('circle', { cx: x, cy: y, r: 4.5 }));
  if (who === 'player') group.append(svg('circle', { cx: x, cy: y, r: 9 }), svg('circle', { cx: x, cy: y, r: 2 }));
  if (who === 'baseline') group.append(svg('rect', { x: x - 6, y: y - 6, width: 12, height: 12 }));
  if (who === 'model') group.append(svg('path', { d: `M${x} ${y - 8}L${x + 8} ${y}L${x} ${y + 8}L${x - 8} ${y}Z` }));
  if (who === 'actual') group.append(svg('path', { d: `M${x - 7} ${y - 7}L${x + 7} ${y + 7}M${x + 7} ${y - 7}L${x - 7} ${y + 7}` }));
  return group;
}

function legendIcon(who) {
  const icon = svg('svg', { viewBox: '0 0 24 24', width: 22, height: 22, 'aria-hidden': 'true', class: 'legend-icon' });
  if (who === 'region') icon.append(svg('ellipse', { cx: 12, cy: 12, rx: 10, ry: 6, class: 'region' }));
  else icon.append(marker(who, 12, 12));
  return icon;
}

// ---------- Geometry ----------

function revealedParts() {
  const index = STAGES.indexOf(play.stage);
  return ['baseline', 'model', 'actual'].filter((part) => index >= STAGES.indexOf(part));
}

/**
 * Position rounds are drawn in offsets from the last training measurement (east left, north up). Before the reveal
 * the view comes only from the training points (game.js guessView); afterwards it may widen to show everything.
 */
function positionGeometry() {
  const { round } = play;
  const origin = lastMeasurement(round);
  const shown = revealedParts().map((part) => round[part]);
  if (play.stage !== 'guess' && play.guess) shown.push(play.guess);
  const view = revealView(round, shown);
  const span = view.east[1] - view.east[0];
  const offsetToPlot = (offset) => ({
    x: PAD + ((view.east[1] - offset.east) / span) * INNER,
    y: PAD + ((view.north[1] - offset.north) / span) * INNER,
  });
  return {
    view,
    span,
    origin,
    offsetToPlot,
    toPlot: (point) => offsetToPlot(toOffset(origin, point)),
    fromPlot: (x, y) => fromOffset(origin, {
      east: view.east[1] - ((x - PAD) / INNER) * span,
      north: view.north[1] - ((y - PAD) / INNER) * span,
    }),
  };
}

function scalarGeometry() {
  const { round } = play;
  const view = scalarView(round, revealedParts().map((part) => round[part]));
  const inverted = isMagnitude(round.units);
  const timeSpan = view.time[1] - view.time[0];
  const valueSpan = view.value[1] - view.value[0];
  const yOf = (value) => (inverted
    ? PAD + ((value - view.value[0]) / valueSpan) * INNER
    : PAD + ((view.value[1] - value) / valueSpan) * INNER);
  return {
    view,
    span: valueSpan,
    xOf: (mjd) => PAD + ((mjd - view.time[0]) / timeSpan) * INNER,
    yOf,
    toPlot: (point, mjd = round.reveal_t_mjd) => ({ x: PAD + ((mjd - view.time[0]) / timeSpan) * INNER, y: yOf(point.value) }),
    fromPlot: (_x, y) => ({
      value: inverted ? view.value[0] + ((y - PAD) / INNER) * valueSpan : view.value[1] - ((y - PAD) / INNER) * valueSpan,
    }),
  };
}

const geometry = () => (play.kind === 'position' ? positionGeometry() : scalarGeometry());

// ---------- Plot ----------

function drawAxes(plot, geo) {
  const { round } = play;
  const factor = displayFactor(round);
  if (play.kind === 'position') {
    for (const tick of ticks(geo.view.east[0] * factor, geo.view.east[1] * factor)) {
      const { x } = geo.offsetToPlot({ east: tick / factor, north: geo.view.north[0] });
      plot.append(svg('line', { x1: x, x2: x, y1: PAD, y2: SIZE - PAD, class: 'grid' }));
      plot.append(svg('text', { x, y: SIZE - PAD + 16, class: 'tick', 'text-anchor': 'middle' }, formatNumber(tick, tick % 1 ? 1 : 0)));
    }
    for (const tick of ticks(geo.view.north[0] * factor, geo.view.north[1] * factor)) {
      const { y } = geo.offsetToPlot({ east: geo.view.east[0], north: tick / factor });
      plot.append(svg('line', { x1: PAD, x2: SIZE - PAD, y1: y, y2: y, class: 'grid' }));
      plot.append(svg('text', { x: PAD - 6, y: y + 4, class: 'tick', 'text-anchor': 'end' }, formatNumber(tick, tick % 1 ? 1 : 0)));
    }
    plot.append(svg('text', { x: PAD, y: SIZE - 8, class: 'axis' }, t('game.axisEast', { unit: t(`unit.${errorUnit(round)}`) })));
    plot.append(svg('text', { x: 6, y: PAD - 14, class: 'axis' }, t('game.axisNorth', { unit: t(`unit.${errorUnit(round)}`) })));
    return;
  }
  for (const tick of ticks(geo.view.time[0], geo.view.time[1], 4)) {
    const x = geo.xOf(tick);
    plot.append(svg('line', { x1: x, x2: x, y1: PAD, y2: SIZE - PAD, class: 'grid' }));
    plot.append(svg('text', { x, y: SIZE - PAD + 16, class: 'tick', 'text-anchor': 'middle' }, formatUtc(mjdToDate(tick), { time: false }).slice(0, 7)));
  }
  for (const tick of ticks(geo.view.value[0], geo.view.value[1])) {
    const y = geo.yOf(tick);
    plot.append(svg('line', { x1: PAD, x2: SIZE - PAD, y1: y, y2: y, class: 'grid' }));
    plot.append(svg('text', { x: PAD - 6, y: y + 4, class: 'tick', 'text-anchor': 'end' }, formatNumber(tick, 1)));
  }
  plot.append(svg('text', { x: 6, y: PAD - 14, class: 'axis' }, t(isMagnitude(round.units) ? 'game.axisMag' : 'game.axisValue', { unit: has(`unit.${round.units}`) ? t(`unit.${round.units}`) : (round.units ?? '') })));
  const revealX = geo.xOf(round.reveal_t_mjd);
  plot.append(svg('line', { x1: revealX, x2: revealX, y1: PAD, y2: SIZE - PAD, class: 'reveal-line' }));
  plot.append(svg('text', { x: revealX - 4, y: PAD - 4, class: 'axis', 'text-anchor': 'end' }, t('game.revealDate', { date: dateOf(round.reveal_t_mjd) })));
}

function drawRegion(plot, geo) {
  const { round, bundle } = play;
  if (play.kind === 'position') {
    const cov = bundle?.prediction?.doc?.model?.cov_arcsec2;
    const d2 = round.model.region_d2 ?? bundle?.trial?.doc?.scoring?.threshold_d2;
    const ellipse = cov && Number.isFinite(d2) ? covarianceEllipse(cov, d2) : null;
    if (!ellipse) return false;
    const centre = geo.toPlot(round.model);
    const scale = INNER / geo.span;
    plot.append(svg('ellipse', {
      cx: centre.x, cy: centre.y, rx: ellipse.major * scale, ry: ellipse.minor * scale,
      transform: `rotate(${ellipse.angleDeg} ${centre.x} ${centre.y})`, class: 'region',
    }));
    return true;
  }
  const sigma = round.model.sigma ?? bundle?.prediction?.doc?.model?.sigma;
  const z = bundle?.trial?.doc?.scoring?.z_max;
  if (!Number.isFinite(sigma) || !Number.isFinite(z)) return false;
  const x = geo.xOf(round.reveal_t_mjd);
  const top = geo.yOf(round.model.value - z * sigma);
  const bottom = geo.yOf(round.model.value + z * sigma);
  plot.append(svg('rect', { x: x - 8, y: Math.min(top, bottom), width: 16, height: Math.abs(bottom - top), class: 'region' }));
  return true;
}

function drawPlot() {
  const { round } = play;
  const geo = geometry();
  play.geo = geo;
  const plot = svg('svg', {
    viewBox: `0 0 ${SIZE} ${SIZE}`,
    class: 'game-plot',
    tabindex: play.stage === 'guess' ? 0 : -1,
    role: 'application',
    'aria-label': t(play.kind === 'position' ? 'game.plotPosition' : 'game.plotScalar'),
    'aria-describedby': 'round-task game-keys',
  });
  plot.append(svg('rect', { x: PAD, y: PAD, width: INNER, height: INNER, class: 'plot-area' }));
  drawAxes(plot, geo);
  const training = [...round.training_points].sort((a, b) => a.t_mjd - b.t_mjd);
  const trainingXY = training.map((point) => (play.kind === 'position' ? geo.toPlot(point) : geo.toPlot(point, point.t_mjd)));
  plot.append(svg('polyline', { points: trainingXY.map(({ x, y }) => `${x},${y}`).join(' '), class: 'track' }));
  trainingXY.forEach(({ x, y }) => plot.append(marker('training', x, y)));
  [0, training.length - 1].filter((index, position, list) => list.indexOf(index) === position).forEach((index) => {
    const { x, y } = trainingXY[index];
    plot.append(svg('text', { x: x + 8, y: y - 8, class: 'point-label' }, dateOf(training[index].t_mjd)));
  });
  const parts = revealedParts();
  const last = trainingXY.at(-1);
  if (parts.includes('baseline')) {
    const point = geo.toPlot(round.baseline);
    plot.append(svg('line', { x1: last.x, y1: last.y, x2: point.x, y2: point.y, class: 'baseline-line' }));
  }
  if (parts.includes('model')) play.regionShown = drawRegion(plot, geo);
  if (parts.includes('actual')) {
    const actual = geo.toPlot(round.actual);
    for (const who of ['player', 'baseline', 'model']) {
      const from = geo.toPlot(who === 'player' ? play.guess : round[who]);
      plot.append(svg('line', { x1: from.x, y1: from.y, x2: actual.x, y2: actual.y, class: `error-line error-${who}` }));
    }
  }
  for (const part of parts) {
    const { x, y } = geo.toPlot(round[part]);
    plot.append(marker(part, x, y));
  }
  if (play.guess) {
    const { x, y } = geo.toPlot(play.guess);
    plot.append(marker('player', Math.min(SIZE - 4, Math.max(4, x)), Math.min(SIZE - 4, Math.max(4, y))));
  }
  bindPlot(plot);
  $('round-plot').replaceChildren(plot);
}

// ---------- Guessing ----------

/** focusPlot: keep keyboard focus on the plot, which is redrawn (only for taps and arrow keys on it). */
function setGuess(point, { announce = true, focusPlot = false } = {}) {
  if (play.stage !== 'guess') return;
  play.guess = point;
  syncInputs();
  drawPlot();
  $('lock-guess').disabled = false;
  if (announce) $('round-status').textContent = guessText();
  if (focusPlot) $('round-plot').querySelector('svg')?.focus({ preventScroll: true });
}

function guessText() {
  if (!play.guess) return '';
  const factor = displayFactor(play.round);
  const unit = errorUnit(play.round);
  if (play.kind === 'position') {
    const offset = toOffset(lastMeasurement(play.round), play.guess);
    return t('game.guessPosition', { east: withUnit(offset.east * factor, unit), north: withUnit(offset.north * factor, unit) });
  }
  return t('game.guessValue', { value: withUnit(play.guess.value, play.round.units) });
}

function bindPlot(plot) {
  if (play.stage !== 'guess') return;
  plot.addEventListener('click', (event) => {
    const matrix = plot.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const x = Math.min(SIZE - PAD, Math.max(PAD, point.x));
    const y = Math.min(SIZE - PAD, Math.max(PAD, point.y));
    setGuess(play.geo.fromPlot(x, y), { focusPlot: true });
  });
  plot.addEventListener('keydown', (event) => {
    const moves = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (event.key === 'Enter' && play.guess) {
      event.preventDefault();
      lockGuess();
      return;
    }
    if (!(event.key in moves)) return;
    event.preventDefault();
    const [east, north] = moves[event.key];
    nudge(east, north, event.shiftKey ? FAST_STEP : 1, true);
  });
}

/** Moves the guess by steps of 1/40 of the view (east is left on the sky). Starts at the last training point. */
function nudge(east, north, times = 1, focusPlot = false) {
  const step = (play.geo.span / STEPS_PER_VIEW) * times;
  const start = play.guess ?? { ...play.round.training_points.at(-1) };
  if (play.kind === 'position') {
    setGuess({ east_arcsec: start.east_arcsec + east * step, north_arcsec: start.north_arcsec + north * step }, { focusPlot });
  } else if (north) {
    const brighterUp = isMagnitude(play.round.units) ? -1 : 1;
    setGuess({ value: start.value + brighterUp * north * step }, { focusPlot });
  }
}

function syncInputs() {
  const factor = displayFactor(play.round);
  if (play.kind === 'position') {
    const offset = play.guess ? toOffset(lastMeasurement(play.round), play.guess) : null;
    $('guess-east').value = offset ? (offset.east * factor).toFixed(2) : '';
    $('guess-north').value = offset ? (offset.north * factor).toFixed(2) : '';
  } else {
    $('guess-value').value = play.guess ? play.guess.value.toFixed(2) : '';
  }
}

function readInputs() {
  const factor = displayFactor(play.round);
  if (play.kind === 'position') {
    const east = Number($('guess-east').value);
    const north = Number($('guess-north').value);
    if ($('guess-east').value === '' || $('guess-north').value === '' || !Number.isFinite(east) || !Number.isFinite(north)) return;
    setGuess(fromOffset(lastMeasurement(play.round), { east: east / factor, north: north / factor }));
  } else {
    const value = Number($('guess-value').value);
    if ($('guess-value').value === '' || !Number.isFinite(value)) return;
    setGuess({ value });
  }
}

function lockGuess() {
  if (!play.guess || play.stage !== 'guess') return;
  play.stage = 'locked';
  renderControls();
  drawPlot();
  $('round-status').textContent = `${t('game.locked')} ${guessText()}`;
  $('reveal-next').focus({ preventScroll: true });
}

function revealNext() {
  const next = { locked: 'baseline', baseline: 'model', model: 'actual' }[play.stage];
  if (!next) return;
  play.stage = next;
  drawPlot();
  renderControls();
  const messages = { baseline: 'game.saidBaseline', model: 'game.saidModel', actual: 'game.saidActual' };
  $('round-status').textContent = t(messages[next]);
  if (next === 'actual') showResults();
}

// ---------- Results ----------

function resultRow(who, result, unit) {
  const best = result.best.includes(who);
  return el('tr', { class: best ? 'is-best' : '' }, [
    el('th', { scope: 'row' }, [legendIcon(who), t(`game.who.${who}`)]),
    el('td', { text: withUnit(result.errors[who], unit, 3) }),
    el('td', { text: result.scores[who] === null ? '—' : String(result.scores[who]) }),
    el('td', { text: best ? t('game.closest') : '' }),
  ]);
}

function verdict(result) {
  if (result.best.length > 1) return t('game.verdictTie');
  if (result.best[0] === 'player') return t('game.verdictPlayer');
  if (physicsLost(result)) return t('game.verdictBaseline');
  return t('game.verdictModel');
}

function actualImage() {
  const image = play.round.actual.image;
  if (!image) return el('p', { class: 'panel-note', text: t('game.noImage') });
  const path = typeof image === 'string' ? image : image.path;
  const url = path ? context.imageUrl(path) : null;
  if (!url) return el('p', { class: 'panel-note', text: t('game.noImage') });
  const contentType = typeof image === 'object' ? image.content_type : null;
  return el('figure', { class: 'actual-image' }, [
    el('img', { src: url, alt: t('game.imageAlt', { date: dateOf(play.round.reveal_t_mjd) }), loading: 'lazy' }),
    el('figcaption', {}, [
      el('span', { text: t('game.imageCaption', { date: dateOf(play.round.reveal_t_mjd) }) }),
      contentType && has(`content.${contentType}`) ? chip(t(`content.${contentType}`), `chip-${contentType}`) : null,
    ]),
  ]);
}

function showResults() {
  const { round, bundle } = play;
  const result = scoreRound(round, play.guess);
  const unit = result.unit;
  const best = result.scored ? saveBest(storage(), round.round_id, result.scores.player) : null;
  const verification = bundle?.verification;
  const official = verification?.state === 'ok'
    ? el('p', { class: 'stamps' }, [el('span', { text: t('game.official') }), trialStatusChip(verification.doc.status)])
    : el('p', { class: 'panel-note', text: t('game.noVerification') });
  $('round-results').replaceChildren(...[
    el('h3', { text: t('game.resultsTitle') }),
    el('p', { class: 'verdict', text: verdict(result) }),
    physicsLost(result) ? el('p', { class: 'note', text: t('game.physicsMayLose') }) : null,
    el('div', { class: 'table-scroll' }, el('table', { class: 'results-table' }, [
      el('caption', { text: t('game.tableCaption') }),
      el('thead', {}, el('tr', {}, [t('game.colWho'), t('game.colError'), t('game.colScore'), ''].map((text) => el('th', { scope: 'col', text })))),
      el('tbody', {}, ['player', 'baseline', 'model'].map((who) => resultRow(who, result, unit))),
    ])),
    el('p', { class: 'note', text: result.scored
      ? t('game.scoreRule', { scale: withUnit(round.scoring.scale, unit, 2) })
      : t('game.noScore') }),
    play.regionShown === false ? el('p', { class: 'note', text: t('game.noRegion') }) : null,
    official,
    best !== null ? el('p', { class: 'note', text: t('game.best', { best: String(best) }) }) : null,
    actualImage(),
  ].filter(Boolean));
}

// ---------- Layout of one round ----------

function renderControls() {
  const guessing = play.stage === 'guess';
  for (const input of document.querySelectorAll('#guess-inputs input, #guess-inputs .nudge')) input.disabled = !guessing;
  $('lock-guess').hidden = !guessing;
  $('lock-guess').disabled = !play.guess;
  const label = NEXT_LABEL[play.stage];
  $('reveal-next').hidden = !label;
  if (label) $('reveal-next').textContent = t(label);
  $('play-again').hidden = play.stage !== 'actual';
  const reached = STAGES.indexOf(play.stage);
  for (const item of document.querySelectorAll('#reveal-steps li')) {
    const done = reached >= STAGES.indexOf(item.dataset.stage) && !(item.dataset.stage === 'locked' && guessing);
    item.classList.toggle('done', done);
    if (done) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  }
}

function guessInputs() {
  const unit = play.kind === 'position' ? errorUnit(play.round) : play.round.units;
  const field = (id, labelKey) => el('label', { class: 'field' }, [
    el('span', { text: t(labelKey, { unit: t(`unit.${unit}`) }) }),
    el('input', { id, type: 'number', step: 'any', inputmode: 'decimal', onchange: readInputs }),
  ]);
  const nudgeButton = (labelKey, east, north) => el('button', {
    type: 'button', class: 'nudge', text: t(labelKey), onclick: () => nudge(east, north),
  });
  const fields = play.kind === 'position'
    ? [field('guess-east', 'game.inputEast'), field('guess-north', 'game.inputNorth')]
    : [field('guess-value', 'game.inputValue')];
  const nudges = play.kind === 'position'
    ? [nudgeButton('game.nudgeNorth', 0, 1), nudgeButton('game.nudgeEast', 1, 0), nudgeButton('game.nudgeWest', -1, 0), nudgeButton('game.nudgeSouth', 0, -1)]
    : [nudgeButton(isMagnitude(play.round.units) ? 'game.nudgeBrighter' : 'game.nudgeUp', 0, 1), nudgeButton(isMagnitude(play.round.units) ? 'game.nudgeFainter' : 'game.nudgeDown', 0, -1)];
  return el('fieldset', { id: 'guess-inputs', class: 'guess-inputs' }, [
    el('legend', { text: t('game.yourGuess') }),
    el('div', { class: 'guess-fields' }, fields),
    el('div', { class: `nudges nudges-${play.kind}` }, nudges),
  ]);
}

function legend() {
  const items = ['training', 'player', 'baseline', 'model', 'region', 'actual'];
  return el('ul', { class: 'game-legend' }, items.map((who) => el('li', {}, [legendIcon(who), t(`game.legend.${who}`)])));
}

function trainingTable() {
  const { round } = play;
  const factor = displayFactor(round);
  const unit = play.kind === 'position' ? errorUnit(round) : round.units;
  const columns = play.kind === 'position'
    ? [t('table.date'), t('game.inputEast', { unit: t(`unit.${unit}`) }), t('game.inputNorth', { unit: t(`unit.${unit}`) }), t('col.kind')]
    : [t('table.date'), t('game.inputValue', { unit: t(`unit.${unit}`) }), t('col.kind')];
  const origin = play.kind === 'position' ? lastMeasurement(round) : null;
  const rows = [...round.training_points].sort((a, b) => a.t_mjd - b.t_mjd).map((point) => [
    dateOf(point.t_mjd),
    ...(play.kind === 'position'
      ? [formatNumber(toOffset(origin, point).east * factor, 2), formatNumber(toOffset(origin, point).north * factor, 2)]
      : [formatNumber(point.value, 2)]),
    has(`content.${point.content_type}`) ? t(`content.${point.content_type}`) : '—',
  ]);
  return dataTable({ caption: t('game.trainingCaption'), summary: t('game.trainingTable'), columns, rows });
}

function renderRound() {
  const { round, bundle } = play;
  const name = context.nameOf(bundle?.trial?.doc?.target_key) ?? round.trial_id;
  const date = dateOf(round.reveal_t_mjd);
  const count = String(round.training_points.length);
  const row = context.scoreboardRow(round.trial_id);
  $('round-area').replaceChildren(el('article', { class: 'round', 'aria-labelledby': 'round-title' }, [
    el('header', { class: 'round-head' }, [
      el('h2', { id: 'round-title', text: t(play.kind === 'position' ? 'game.titlePosition' : 'game.titleScalar', { name, date }) }),
      el('p', { class: 'stamps' }, [exampleChip(round), categoryChip(round.category), prospectiveChip(row)]),
      el('p', { class: 'note', text: categoryNote(round.category) }),
      el('p', { id: 'round-task', text: t(play.kind === 'position' ? 'game.taskPosition' : 'game.taskScalar', { name, date, count }) }),
    ]),
    el('div', { class: 'round-grid' }, [
      el('figure', { class: 'round-figure' }, [
        el('div', { id: 'round-plot', class: 'round-plot' }),
        el('figcaption', {}, [legend(), el('p', { id: 'game-keys', class: 'note', text: t('game.keys') })]),
      ]),
      el('div', { class: 'round-side' }, [
        guessInputs(),
        el('button', { id: 'lock-guess', type: 'button', class: 'glow', text: t('game.lock'), onclick: lockGuess, disabled: true }),
        el('ol', { id: 'reveal-steps', class: 'reveal-steps' }, ['locked', 'baseline', 'model', 'actual']
          .map((stage) => el('li', { dataset: { stage }, text: t(`game.step.${stage}`) }))),
        el('button', { id: 'reveal-next', type: 'button', class: 'glow', onclick: revealNext, hidden: true }),
        el('p', { id: 'round-status', class: 'round-status', role: 'status' }),
        el('div', { id: 'round-results', class: 'round-results' }),
        el('button', { id: 'play-again', type: 'button', text: t('game.again'), onclick: () => startRound(round.round_id), hidden: true }),
      ]),
    ]),
    trainingTable(),
  ]));
  renderControls();
  drawPlot();
}

function startRound(roundId) {
  const entry = context.rounds.find((item) => item.doc.round_id === roundId) ?? context.rounds[0];
  play = { round: entry.doc, bundle: entry.bundle, kind: roundKind(entry.doc), stage: 'guess', guess: null, regionShown: null };
  for (const button of document.querySelectorAll('#round-picker button')) {
    button.setAttribute('aria-pressed', String(button.dataset.round === entry.doc.round_id));
  }
  renderRound();
  context.onSelect(entry.doc.round_id);
}

function pickerLabel(entry) {
  const name = context.nameOf(entry.bundle?.trial?.doc?.target_key) ?? entry.doc.trial_id;
  return t('game.pickerLabel', { name, quantity: has(`quantity.${entry.doc.quantity}`) ? t(`quantity.${entry.doc.quantity}`) : entry.doc.quantity });
}

/**
 * rounds: [{ doc, bundle }] with doc a game record that loaded; skipped: [{ path, reason }] for rounds that
 * could not be played. nameOf(targetKey), imageUrl(path), scoreboardRow(trialId), onSelect(roundId).
 */
export function renderGamePage(options) {
  context = options;
  const playable = options.rounds.filter((entry) => checkRound(entry.doc).ok);
  const problems = [
    ...options.skipped.map((item) => t('game.skipped', { path: item.path, reason: t(`state.${item.reason}`) })),
    ...options.rounds.filter((entry) => !checkRound(entry.doc).ok)
      .map((entry) => t('game.unplayable', { id: entry.doc.round_id, parts: checkRound(entry.doc).blocking.join(', ') })),
  ];
  context.rounds = playable;
  const host = $('game-rounds');
  if (!playable.length) {
    play = null;
    host.replaceChildren(...[
      el('p', { class: 'panel-note', text: t('game.waiting') }),
      options.fixtures ? null : el('p', {}, el('a', { href: '?page=game&fixtures=1', class: 'example-link', text: t('game.tryExample') })),
      ...problems.map((text) => el('p', { class: 'note warn', text })),
    ].filter(Boolean));
    return;
  }
  host.replaceChildren(
    el('nav', { id: 'round-picker', class: 'round-picker', 'aria-label': t('game.rounds') }, playable.map((entry) => el('button', {
      type: 'button', dataset: { round: entry.doc.round_id }, onclick: () => startRound(entry.doc.round_id), 'aria-pressed': 'false',
    }, [pickerLabel(entry), ' ', categoryChip(entry.doc.category)]))),
    ...problems.map((text) => el('p', { class: 'note warn', text })),
    el('div', { id: 'round-area' }),
  );
  startRound(options.selected && playable.some((entry) => entry.doc.round_id === options.selected) ? options.selected : playable[0].doc.round_id);
}

export const currentRoundId = () => play?.round?.round_id ?? null;

/** Switches to a round named in a link, if it is one of the playable rounds. */
export function selectRound(roundId) {
  if (context?.rounds?.some((entry) => entry.doc.round_id === roundId)) startRound(roundId);
}
