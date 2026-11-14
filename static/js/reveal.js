// The reveal (task B4). For a verified position trial, a full-screen view shows the evaluation image and then,
// one step per click, Space or →: the training track, the frozen 95% region, the straight-line baseline, the
// observed position, and the verdict with its Mahalanobis distance. Made to be screen-recorded at 1280×720:
// large type, every state reachable by keyboard or click (nothing on hover), and no motion under
// prefers-reduced-motion. Numbers and verdicts come from the trial files; the page only draws them.
import { $, el, formatNumber, prefersReducedMotion } from './dom.js';
import { has, t, tData } from './i18n.js';
import { categoryNote, exampleChip } from './labels.js';
import { blendView, easeInOut, formatArcsec, niceLength, revealModel, trialLabels } from './ledger.js';
import { dateOfMjd, labelChips, receiptLine, residualTable, statusChip } from './ledger-parts.js';

export const STEPS = ['image', 'track', 'region', 'baseline', 'observed', 'verdict'];
const ZOOM_MS = 1100;
const CALLOUT_GAP = 54;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** { imageUrl(path), nameOf(key), loadTraining(id), onClose() } from ledger-ui.js. */
let context = null;
/** The open reveal: { bundle, model, step, size, camera, frame, layers, example }. */
let current = null;

function svg(name, attributes = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

const stepIndex = (name) => STEPS.indexOf(name);
const shown = (name) => current.step >= stepIndex(name);
const viewFor = (step) => (step === 0 ? current.model.views.full : current.model.views.focus);

// ---------- Drawing ----------

function frameOf(camera, size) {
  const scale = size / camera.span;
  return {
    scale,
    x: (east) => size / 2 - (east - camera.east) * scale,
    y: (north) => size / 2 - (north - camera.north) * scale,
    at(point) {
      return { x: this.x(point.east), y: this.y(point.north) };
    },
  };
}

function ellipseNode(centre, region, frame, className) {
  const { x, y } = frame.at(centre);
  // East left and north up flip both screen axes, which leaves the axis angle of an ellipse unchanged.
  return svg('ellipse', { cx: x, cy: y, rx: region.major * frame.scale, ry: region.minor * frame.scale, transform: `rotate(${region.angleDeg} ${x} ${y})`, class: className });
}

/** A wrapper that grows from its own centre when it enters (CSS), so the ellipse's rotation stays untouched. */
function grow(node, entering, className = '') {
  const group = svg('g', { class: `${className}${entering ? ' enter grow' : ''}`.trim() });
  group.append(node);
  return group;
}

function marker(kind, point, entering, delay = 0) {
  const { x, y } = point;
  const group = svg('g', { class: `rv-mark rv-${kind}${entering ? ' enter pop' : ''}`, style: delay ? `animation-delay:${delay}ms` : null });
  if (kind === 'training') group.append(svg('circle', { cx: x, cy: y, r: 6 }));
  if (kind === 'model') group.append(svg('path', { d: `M${x} ${y - 11}L${x + 11} ${y}L${x} ${y + 11}L${x - 11} ${y}Z` }));
  if (kind === 'baseline') group.append(svg('rect', { x: x - 8, y: y - 8, width: 16, height: 16 }));
  if (kind === 'observed') {
    group.append(svg('path', { d: `M${x - 11} ${y - 11}L${x + 11} ${y + 11}M${x + 11} ${y - 11}L${x - 11} ${y + 11}`, class: 'cross-halo' }));
    group.append(svg('path', { d: `M${x - 11} ${y - 11}L${x + 11} ${y + 11}M${x + 11} ${y - 11}L${x - 11} ${y + 11}`, class: 'cross' }));
  }
  return group;
}

/**
 * A text label with a leader line, placed in the direction (of eight) farthest from every other drawn point and
 * inside the picture, so labels never cover the markers they explain.
 */
function callout(layer, anchor, text, obstacles, size, { reach = 0, entering = false, avoid = [] } = {}) {
  const small = size < 420;
  const width = text.length * (small ? 8 : 9.2) + 20;
  const height = small ? 26 : 30;
  let best = null;
  for (let k = 0; k < 8; k += 1) {
    const angle = (k * Math.PI) / 4 + Math.PI / 8;
    const distance = reach + CALLOUT_GAP;
    const cx = anchor.x + Math.cos(angle) * (distance + width / 2 * Math.abs(Math.cos(angle)));
    const cy = anchor.y + Math.sin(angle) * (distance + height / 2 * Math.abs(Math.sin(angle)));
    const left = cx - width / 2;
    const top = cy - height / 2;
    const overlaps = avoid.some((box) => left < box.x + box.w && left + width > box.x && top < box.y + box.h && top + height > box.y);
    const inside = left >= 6 && top >= 6 && left + width <= size - 6 && top + height <= size - 40 && !overlaps;
    const clearance = Math.min(...obstacles.map((point) => Math.hypot(point.x - cx, point.y - cy)), size);
    const score = (inside ? 10000 : 0) + clearance;
    if (!best || score > best.score) best = { cx, cy, left, top, angle, score };
  }
  const group = svg('g', { class: `rv-callout${small ? ' small' : ''}${entering ? ' enter fade' : ''}` });
  const start = { x: anchor.x + Math.cos(best.angle) * (reach + 8), y: anchor.y + Math.sin(best.angle) * (reach + 8) };
  const end = { x: Math.min(Math.max(start.x, best.left), best.left + width), y: Math.min(Math.max(start.y, best.top), best.top + height) };
  group.append(svg('line', { x1: start.x, y1: start.y, x2: end.x, y2: end.y }));
  group.append(svg('rect', { x: best.left, y: best.top, width, height, rx: 6 }));
  group.append(svg('text', { x: best.cx, y: best.cy + (small ? 5 : 6), 'text-anchor': 'middle' }, text));
  layer.append(group);
}

function scaleBar(layer, frame, size, span) {
  const length = niceLength(span);
  const pixels = length * frame.scale;
  const group = svg('g', { class: 'rv-scale' });
  group.append(svg('rect', { x: 10, y: size - 44, width: Math.max(pixels, 60) + 20, height: 36, rx: 6, class: 'rv-chip-bg' }));
  group.append(svg('line', { x1: 20, x2: 20 + pixels, y1: size - 16, y2: size - 16 }));
  group.append(svg('text', { x: 20, y: size - 24 }, formatArcsec(length)));
  layer.append(group);
}

function compass(layer, size) {
  const group = svg('g', { class: 'rv-compass' });
  const x = size - 26;
  const y = 30;
  group.append(svg('line', { x1: x, y1: y + 18, x2: x, y2: y - 6 }), svg('line', { x1: x, y1: y + 18, x2: x - 24, y2: y + 18 }));
  group.append(svg('text', { x, y: y - 10, 'text-anchor': 'middle' }, t('reveal.lab.north')));
  group.append(svg('text', { x: x - 36, y: y + 23, 'text-anchor': 'middle' }, t('reveal.lab.east')));
  layer.append(group);
}

/** Builds the picture's fixed layers once per size; draw() then updates them. */
function buildStage() {
  const host = $('reveal-stage');
  const size = Math.max(200, Math.floor(host.clientWidth));
  current.size = size;
  const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'reveal-svg', 'aria-hidden': 'true' });
  const image = current.imageHref
    ? svg('image', { href: current.imageHref, preserveAspectRatio: 'none', class: 'eval-image' })
    : null;
  if (image) {
    image.addEventListener('error', () => {
      current.imageFailed = true;
      image.remove();
      updateText();
    });
  }
  const layers = { root, image, overlay: svg('g', { class: 'rv-overlay' }) };
  root.append(svg('rect', { x: 0, y: 0, width: size, height: size, class: 'rv-bg' }));
  if (image) root.append(image);
  root.append(layers.overlay);
  current.layers = layers;
  const verdict = el('div', { id: 'reveal-verdict', class: 'verdict-banner', hidden: true });
  host.replaceChildren(root, verdict);
}

/** Draws the current step. entering: the name of the step whose elements animate in (null = none). */
function draw(entering = null) {
  const { model, size, layers } = current;
  const frame = frameOf(current.camera, size);
  const overlay = layers.overlay;
  overlay.replaceChildren();
  drawVerdictBanner(entering === 'verdict');
  if (layers.image && model.image) {
    const left = frame.x(model.image.east[1]);
    const top = frame.y(model.image.north[1]);
    layers.image.setAttribute('x', left);
    layers.image.setAttribute('y', top);
    layers.image.setAttribute('width', (model.image.east[1] - model.image.east[0]) * frame.scale);
    layers.image.setAttribute('height', (model.image.north[1] - model.image.north[0]) * frame.scale);
    overlay.append(svg('rect', {
      x: left, y: top, width: (model.image.east[1] - model.image.east[0]) * frame.scale, height: (model.image.north[1] - model.image.north[0]) * frame.scale, class: 'rv-image-frame',
    }));
  }
  const obstacles = [];
  const add = (point) => {
    obstacles.push(point);
    return point;
  };

  // Step 0: the area the prediction is about, while the picture still shows the whole image.
  if (current.step === 0 || current.zooming) {
    const focus = model.views.focus;
    const half = (focus.span / 2) * frame.scale;
    const centre = frame.at(focus);
    overlay.append(svg('rect', { x: centre.x - half, y: centre.y - half, width: half * 2, height: half * 2, class: `rv-focus${current.zooming ? ' fading' : ''}` }));
    if (current.step === 0 && !current.zooming) callout(overlay, { x: centre.x + half, y: centre.y - half }, t('reveal.lab.focus'), [centre], size, { reach: 0 });
  }

  if (shown('track') && model.training.length && !current.zooming) {
    const enter = entering === 'track';
    const points = model.training.map((point) => add(frame.at(point)));
    // The segments between training points are obstacles too, so a label never sits on the track.
    points.slice(1).forEach((point, index) => {
      const from = points[index];
      const steps = Math.floor(Math.hypot(point.x - from.x, point.y - from.y) / 24);
      for (let k = 1; k < steps; k += 1) obstacles.push({ x: from.x + ((point.x - from.x) * k) / steps, y: from.y + ((point.y - from.y) * k) / steps });
    });
    overlay.append(svg('polyline', { points: points.map(({ x, y }) => `${x},${y}`).join(' '), class: `rv-track${enter ? ' enter draw' : ''}`, pathLength: 1 }));
    points.forEach((point, index) => overlay.append(marker('training', point, enter, enter ? 250 + index * 160 : 0)));
    // Dates of the first and last training position, beside the track.
    const first = points[0];
    const last = points.at(-1);
    const along = Math.atan2(last.y - first.y, last.x - first.x);
    const side = { x: Math.cos(along + Math.PI / 2), y: Math.sin(along + Math.PI / 2) };
    // Beside the track, on the side the perpendicular points to; the text starts there so it never covers the dot.
    const anchor = side.x > 0.35 ? 'start' : side.x < -0.35 ? 'end' : 'middle';
    for (const [point, mjd] of [[first, model.training[0].tMjd], [last, model.training.at(-1).tMjd]].slice(0, points.length > 1 ? 2 : 1)) {
      overlay.append(svg('text', {
        x: point.x + side.x * 14, y: point.y + side.y * 20 + 5, class: `rv-date${enter ? ' enter fade' : ''}`, 'text-anchor': anchor,
      }, dateOfMjd(mjd)));
    }
  }

  const modelPoint = frame.at(model.model);
  if (shown('region')) {
    add(modelPoint);
    if (model.region) overlay.append(grow(ellipseNode(model.model, model.region, frame, 'rv-region'), entering === 'region'));
    overlay.append(marker('model', modelPoint, entering === 'region'));
  }
  if (shown('baseline') && model.baseline) {
    const point = add(frame.at(model.baseline));
    const from = model.training.length ? frame.at(model.training.at(-1)) : null;
    if (from) overlay.append(svg('line', { x1: from.x, y1: from.y, x2: point.x, y2: point.y, class: `rv-baseline-line${entering === 'baseline' ? ' enter fade' : ''}` }));
    overlay.append(marker('baseline', point, entering === 'baseline'));
  }
  if (shown('verdict') && model.testRegion) {
    overlay.append(grow(ellipseNode(model.model, model.testRegion, frame, 'rv-test-region'), entering === 'verdict'));
  }
  if (shown('observed') && model.observed) {
    const point = add(frame.at(model.observed));
    overlay.append(svg('line', { x1: modelPoint.x, y1: modelPoint.y, x2: point.x, y2: point.y, class: `rv-residual${entering === 'observed' ? ' enter fade' : ''}` }));
    if (entering === 'observed') overlay.append(svg('circle', { cx: point.x, cy: point.y, r: 14, class: 'rv-pulse enter' }));
    overlay.append(marker('observed', point, entering === 'observed'));
  }

  // One label for what this step added, away from everything else (and from the verdict banner).
  const step = STEPS[current.step];
  const banner = $('reveal-verdict');
  const avoid = banner && !banner.hidden
    ? [{ x: banner.offsetLeft - 8, y: banner.offsetTop - 8, w: banner.offsetWidth + 16, h: banner.offsetHeight + 16 }]
    : [];
  if (!current.zooming) {
    if (step === 'track' && model.training.length) callout(overlay, obstacles[Math.floor(model.training.length / 2)] ?? obstacles[0], t('reveal.lab.track'), obstacles, size, { entering: entering === 'track' });
    if (step === 'region' && model.region) callout(overlay, modelPoint, t('reveal.lab.region'), obstacles, size, { reach: model.region.major * frame.scale, entering: entering === 'region' });
    if (step === 'baseline' && model.baseline) callout(overlay, frame.at(model.baseline), t('reveal.lab.baseline'), obstacles, size, { entering: entering === 'baseline' });
    if (step === 'observed' && model.observed) callout(overlay, frame.at(model.observed), t('reveal.lab.observed'), obstacles, size, { entering: entering === 'observed' });
    if (step === 'verdict' && model.testRegion) callout(overlay, modelPoint, t('reveal.lab.test'), obstacles, size, { reach: model.testRegion.major * frame.scale, entering: entering === 'verdict', avoid });
  }
  scaleBar(overlay, frame, size, current.camera.span);
  compass(overlay, size);
}

function drawVerdictBanner(entering) {
  const banner = $('reveal-verdict');
  if (!banner) return;
  const { model } = current;
  banner.hidden = !shown('verdict');
  if (banner.hidden) return;
  banner.className = `verdict-banner status-${model.status ?? 'none'}${entering ? ' enter' : ''}`;
  const status = model.status;
  const verdict = has(`reveal.verdict.${status}`) ? t(`reveal.verdict.${status}`) : (status ?? '—');
  const known = Number.isFinite(model.distance) && Number.isFinite(model.limit);
  const inside = known && model.distance <= model.limit;
  const values = { d: formatNumber(model.distance, 2), limit: formatNumber(model.limit, 2) };
  banner.replaceChildren(...[
    el('strong', { text: verdict }),
    known ? el('span', { class: 'd-value', text: t(inside ? 'reveal.dInside' : 'reveal.dOutside', values) }) : null,
    known ? el('span', { class: 'd-words', text: t(inside ? 'reveal.dInsideWords' : 'reveal.dOutsideWords') }) : null,
  ].filter(Boolean));
}

// ---------- Text beside the picture ----------

function legendItem(kind, text) {
  const icon = svg('svg', { viewBox: '0 0 28 28', width: 24, height: 24, 'aria-hidden': 'true', class: 'rv-legend-icon' });
  if (kind === 'region') icon.append(svg('ellipse', { cx: 14, cy: 14, rx: 12, ry: 7, class: 'rv-region' }));
  else if (kind === 'test') icon.append(svg('ellipse', { cx: 14, cy: 14, rx: 12, ry: 8, class: 'rv-test-region' }));
  else if (kind === 'track') icon.append(svg('line', { x1: 2, y1: 22, x2: 26, y2: 6, class: 'rv-track' }), marker('training', { x: 14, y: 14 }, false));
  else icon.append(marker(kind, { x: 14, y: 14 }, false));
  return el('li', {}, [icon, el('span', { text })]);
}

function legend() {
  const { model } = current;
  return el('ul', { class: 'rv-legend' }, [
    shown('track') && model.training.length ? legendItem('track', t('reveal.legend.track')) : null,
    shown('region') ? legendItem('model', t('reveal.legend.model')) : null,
    shown('region') && model.region ? legendItem('region', t('reveal.legend.region')) : null,
    shown('baseline') && model.baseline ? legendItem('baseline', t('reveal.legend.baseline')) : null,
    shown('observed') && model.observed ? legendItem('observed', t('reveal.legend.observed')) : null,
    shown('verdict') && model.testRegion ? legendItem('test', t('reveal.legend.test')) : null,
  ]);
}

function imageText() {
  const { model } = current;
  if (model.image && !current.imageFailed) {
    const kind = has(`content.${model.image.contentType}`) ? t(`content.${model.image.contentType}`) : t('reveal.imageKindUnknown');
    return [t('reveal.t.image', { kind, date: dateOfMjd(model.tMjd), scale: formatNumber(model.image.scale, 1) }), t('reveal.t.imageFocus')];
  }
  if (current.imageFailed) return [t('reveal.t.imageFailed'), t('reveal.t.imageFocus')];
  return [t(`reveal.t.image.${model.imageReason ?? 'none'}`), t('reveal.t.imageFocus')];
}

function stepContent() {
  const { model, bundle } = current;
  const trial = bundle.trial.doc;
  const step = STEPS[current.step];
  const paragraphs = [];
  const extra = [];
  if (step === 'image') paragraphs.push(...imageText());
  if (step === 'track') {
    if (model.training.length) {
      paragraphs.push(t('reveal.t.track', { count: String(model.training.length), first: dateOfMjd(model.training[0].tMjd), last: dateOfMjd(model.training.at(-1).tMjd) }));
    } else {
      paragraphs.push(t(model.trainingState === 'missing' ? 'reveal.t.noTrack' : 'reveal.t.trackUnreadable'));
    }
  }
  if (step === 'region') {
    paragraphs.push(t(model.region ? 'reveal.t.region' : 'reveal.t.noRegion', { date: dateOfMjd(model.tMjd) }));
    if (Number.isFinite(model.referenceShift)) paragraphs.push(t('reveal.t.reference', { shift: formatArcsec(model.referenceShift) }));
    extra.push(receiptLine(bundle.receipt));
    const note = categoryNote(trial.category);
    if (note) extra.push(el('p', { class: 'panel-note', text: note }));
    if (trial.confirmation_pending === true) extra.push(el('p', { class: 'note', text: t('ledger.confirmationPendingNote') }));
  }
  if (step === 'baseline') {
    paragraphs.push(model.baseline
      ? t('reveal.t.baseline', { distance: formatArcsec(Math.hypot(model.baseline.east, model.baseline.north)) })
      : t('reveal.t.noBaseline'));
  }
  if (step === 'observed') {
    if (model.observed) {
      paragraphs.push(t('reveal.t.observed', {
        model: formatArcsec(model.modelResidual?.error_arcsec), baseline: formatArcsec(model.baselineResidual?.error_arcsec),
      }));
      const alternatives = model.identification?.alternatives;
      if (Number.isInteger(alternatives) && alternatives > 0) paragraphs.push(t('reveal.t.alternatives', { count: String(alternatives) }));
    } else {
      paragraphs.push(t('reveal.t.noObserved'));
      if (model.statusReasonKey) paragraphs.push(tData(model.statusReasonKey, 'explain.unknown'));
    }
  }
  if (step === 'verdict') {
    if (model.observed && Number.isFinite(model.distance)) {
      paragraphs.push(t('reveal.t.verdict', { limit: formatNumber(model.limit, 2) }));
    } else {
      paragraphs.push(t('reveal.t.verdictOther'));
      if (model.statusReasonKey) paragraphs.push(tData(model.statusReasonKey, 'explain.unknown'));
    }
  }
  return { paragraphs, extra };
}

function numbers() {
  const { model } = current;
  const parts = [];
  if (shown('verdict')) {
    parts.push(el('p', { class: 'rv-verdict-line' }, [
      statusChip(model.status),
      Number.isFinite(model.distance) ? el('span', { class: 'mono', text: t('reveal.dValue', { d: formatNumber(model.distance, 2), d2: formatNumber(model.modelResidual.d2, 2), limit: formatNumber(model.limit, 2) }) }) : null,
    ]));
    const modelError = model.modelResidual?.error_arcsec;
    const lineError = model.baselineResidual?.error_arcsec;
    if (Number.isFinite(modelError) && Number.isFinite(lineError)) {
      parts.push(el('p', { text: t(lineError < modelError ? 'reveal.lineCloser' : lineError > modelError ? 'reveal.modelCloser' : 'reveal.tie', {
        model: formatArcsec(modelError), baseline: formatArcsec(lineError),
      }) }));
    }
    parts.push(residualTable({ model: model.modelResidual, baseline: model.baselineResidual }, { position: true, limit: model.limit, caption: false }));
  }
  if (shown('observed') && model.check.checked && !model.check.ok) {
    parts.push(el('p', { class: 'panel-note warn', text: t('reveal.checkFailed', { d2: formatNumber(model.check.d2, 2) }) }));
  }
  return parts;
}

function updateText() {
  if (!current) return;
  const step = current.step;
  const { paragraphs, extra } = stepContent();
  $('reveal-text').replaceChildren(
    el('h3', { text: t('reveal.stepOf', { n: String(step + 1), total: String(STEPS.length), name: t(`reveal.s.${STEPS[step]}`) }) }),
    ...paragraphs.map((text) => el('p', { text })),
    ...extra,
  );
  $('reveal-legend').replaceChildren(legend());
  $('reveal-numbers').replaceChildren(...numbers().filter(Boolean));
  $('reveal-steps').replaceChildren(...STEPS.map((name, index) => el('li', {
    class: index < step ? 'done' : index === step ? 'now' : '',
    'aria-current': index === step ? 'step' : null,
    text: t(`reveal.s.${name}`),
  })));
  $('reveal-back').disabled = step === 0;
  $('reveal-forward').textContent = step === STEPS.length - 1 ? t('reveal.again') : t(`reveal.next.${STEPS[step + 1]}`);
  $('reveal-stage').setAttribute('aria-label', t('reveal.stageLabel', { n: String(step + 1), total: String(STEPS.length), name: t(`reveal.s.${STEPS[step]}`) }));
  const caption = [];
  if (current.model.image && !current.imageFailed) {
    caption.push(t('reveal.caption', {
      kind: has(`content.${current.model.image.contentType}`) ? t(`content.${current.model.image.contentType}`) : t('reveal.imageKindUnknown'),
      scale: formatNumber(current.model.image.scale, 1),
    }));
  } else {
    caption.push(t('reveal.captionNoImage'));
  }
  if (current.example) caption.push(t('example.tag'));
  $('reveal-caption').textContent = caption.join(' · ');
}

// ---------- Steps ----------

function stopAnimation() {
  if (current?.raf) cancelAnimationFrame(current.raf);
  if (current) {
    current.raf = null;
    current.zooming = false;
  }
}

function zoomTo(target, after) {
  const from = { ...current.camera };
  const start = performance.now();
  current.zooming = true;
  const tick = (now) => {
    if (!current) return;
    const k = Math.min(1, (now - start) / ZOOM_MS);
    current.camera = blendView(from, target, easeInOut(k));
    draw();
    if (k < 1) {
      current.raf = requestAnimationFrame(tick);
    } else {
      current.raf = null;
      current.zooming = false;
      after();
    }
  };
  current.raf = requestAnimationFrame(tick);
}

export function goToStep(step, { animate = true } = {}) {
  if (!current) return;
  const target = Math.min(STEPS.length - 1, Math.max(0, step));
  const forward = target === current.step + 1;
  stopAnimation();
  current.step = target;
  updateText();
  const motion = animate && forward && !prefersReducedMotion();
  const view = viewFor(target);
  if (motion && target === 1 && current.camera.span !== view.span) {
    zoomTo(view, () => draw('track'));
    return;
  }
  current.camera = { ...view };
  draw(motion ? STEPS[target] : null);
}

export const forward = () => {
  if (!current) return;
  if (current.step === STEPS.length - 1) goToStep(0, { animate: false });
  else goToStep(current.step + 1);
};
export const back = () => current && goToStep(current.step - 1, { animate: false });

function onKey(event) {
  if (!current || event.altKey || event.ctrlKey || event.metaKey) return;
  const key = event.key;
  if (key === ' ' || key === 'Spacebar' || key === 'ArrowRight' || key === 'PageDown') {
    event.preventDefault();
    if (current.step < STEPS.length - 1) forward();
  } else if (key === 'ArrowLeft' || key === 'PageUp' || key === 'Backspace') {
    event.preventDefault();
    back();
  } else if (key === 'Home') {
    event.preventDefault();
    goToStep(0, { animate: false });
  } else if (key === 'End') {
    event.preventDefault();
    goToStep(STEPS.length - 1, { animate: false });
  }
}

// ---------- Open and close ----------

let resizeObserver = null;

export function initReveal(options) {
  context = options;
  const dialog = $('reveal');
  if (dialog.dataset.bound) return;
  dialog.dataset.bound = '1';
  $('reveal-forward').addEventListener('click', forward);
  $('reveal-back').addEventListener('click', back);
  $('reveal-close').addEventListener('click', () => closeReveal());
  $('reveal-stage').addEventListener('click', () => {
    if (current && current.step < STEPS.length - 1) forward();
  });
  dialog.addEventListener('keydown', onKey);
  // Space on a focused button would also click it; the reveal uses Space for "next step" only.
  dialog.addEventListener('keyup', (event) => {
    if (event.key === ' ') event.preventDefault();
  });
  dialog.addEventListener('close', () => finish());
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => {
      if (!current || dialog.open === false) return;
      const size = Math.floor($('reveal-stage').clientWidth);
      if (Math.abs(size - current.size) < 2) return;
      stopAnimation();
      current.camera = { ...viewFor(current.step) };
      buildStage();
      draw();
    });
    resizeObserver.observe($('reveal-stage'));
  }
}

export async function openReveal(bundle, { example = false } = {}) {
  const training = await context.loadTraining(bundle.id);
  const model = revealModel(bundle, training);
  if (!model) return false;
  const trial = bundle.trial.doc;
  stopAnimation();
  current = {
    bundle,
    model,
    step: 0,
    camera: { ...model.views.full },
    example: example || trial.example === true,
    imageHref: model.image ? context.imageUrl(model.image.path) : null,
    imageFailed: false,
  };
  $('reveal-eyebrow').textContent = t('reveal.eyebrow');
  $('reveal-title').textContent = t('reveal.title', { name: context.nameOf(trial.target_key), date: dateOfMjd(model.tMjd) });
  $('reveal-stamps').replaceChildren(...[
    ...labelChips(trialLabels(trial)),
    trial.confirmation_pending === true ? el('span', { class: 'chip chip-pending', text: t('ledger.confirmationPending') }) : null,
    current.example ? exampleChip({ example: true }) : null,
  ].filter(Boolean));
  const dialog = $('reveal');
  if (!dialog.open) dialog.showModal();
  document.body.classList.add('revealing');
  buildStage();
  updateText();
  draw();
  $('reveal-forward').focus({ preventScroll: true });
  return true;
}

function finish() {
  stopAnimation();
  const had = Boolean(current);
  current = null;
  document.body.classList.remove('revealing');
  if (had) context?.onClose?.();
}

export function closeReveal({ notify = true } = {}) {
  const dialog = $('reveal');
  if (!notify) {
    stopAnimation();
    current = null;
    document.body.classList.remove('revealing');
  }
  if (dialog.open) dialog.close();
}

export const revealTrialId = () => current?.bundle?.id ?? null;
export const revealStep = () => current?.step ?? null;
