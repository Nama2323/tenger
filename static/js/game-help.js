// Beat the physics, help for the player (task B7): the "How to predict" box, the timeline strip, the three
// optional hints and the one-line explanation after the reveal. Every number before the reveal comes from the
// training points on screen (game.js); nothing here reads the model, the baseline or the actual position until
// explainResult, which runs only after the reveal.
import { el, formatNumber, formatUtc, withUnit } from './dom.js';
import { has, t } from './i18n.js';
import { dateClusters, daysToTarget, hintDirection, hintRuler, resultExplanation, trainingMotion } from './game.js';
import { mjdToDate } from './stack.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = (name, attributes = {}, children = []) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  node.append(...children.filter(Boolean));
  return node;
};
const words = (text) => document.createTextNode(text);
const dateOf = (mjd) => formatUtc(mjdToDate(mjd), { time: false });
export const HINT_COUNT = 3;

/** "2025-08-10", or "2025-08-10 – 08-16" for a group of dots over several days (the year again if it changes). */
export function clusterDate({ start, end }) {
  const [first, last] = [dateOf(start), dateOf(end)];
  if (first === last) return first;
  return `${first} – ${last.slice(0, 4) === first.slice(0, 4) ? last.slice(5) : last}`;
}

/** An angle in arcsec in the round's units, readable at any size (19,870″ also as degrees). */
export function angleText(arcsec, unit = 'arcsec') {
  if (!Number.isFinite(arcsec)) return '—';
  const factor = { arcsec: 1, arcmin: 1 / 60, deg: 1 / 3600 }[unit] ?? 1;
  const value = arcsec * factor;
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 1 ? 1 : 2;
  const main = withUnit(value, unit, digits);
  return unit === 'arcsec' && Math.abs(arcsec) >= 3600 ? `${main} (${withUnit(arcsec / 3600, 'deg', 1)})` : main;
}

// ---------- How to predict ----------

const HOWTO_KEY = 'tenger.game.howto.v1';
let howtoOpen = null;

/** Open on the first visit; afterwards it remembers whether the player closed it (best effort). */
function howtoStartsOpen() {
  if (howtoOpen !== null) return howtoOpen;
  let seen = false;
  try {
    seen = globalThis.localStorage?.getItem(HOWTO_KEY) === '1';
    globalThis.localStorage?.setItem(HOWTO_KEY, '1');
  } catch {
    // Storage blocked: open every time, which is harmless.
  }
  howtoOpen = !seen;
  return howtoOpen;
}

/** type: 'star', 'solar' or 'brightness' (game.js roundType); name: the target's name. */
export function howToBox(type, name) {
  const steps = [1, 2, 3, 4, 5].filter((n) => has(`game.howto.${type}.step${n}`));
  const box = el('details', { class: 'howto', open: howtoStartsOpen() }, [
    el('summary', { text: t('game.howto.title') }),
    el('div', { class: 'howto-body' }, [
      el('p', { text: t(`game.howto.${type}.idea`, { name }) }),
      el('ol', {}, steps.map((n) => el('li', { text: t(`game.howto.${type}.step${n}`, { name }) }))),
      type === 'solar' ? el('p', {}, el('a', { href: '?page=loop', text: t('loop.link') })) : null,
    ]),
  ]);
  box.addEventListener('toggle', () => { howtoOpen = box.open; });
  return box;
}

// ---------- Timeline strip ----------

/**
 * A time line under the chart: one mark per group of dots (one SPHEREx visit) with its start date, the target
 * date, and the stretch from the last measurement to the target, then "N days after the last measurement".
 * Positions follow the days; labels keep their size at every width. Numbers from the round file.
 */
export function timelineStrip(round) {
  const clusters = dateClusters(round);
  const first = clusters[0].start;
  const target = round.reveal_t_mjd;
  const total = Math.max(1, target - first);
  const at = (mjd) => `${(((mjd - first) / total) * 100).toFixed(2)}%`;
  const last = clusters.at(-1).end;
  const days = daysToTarget(round);
  const marks = clusters.map((cluster, index) => [
    el('span', { class: 'tl-mark', style: `left: ${at(cluster.start)}; width: max(6px, ${(((cluster.end - cluster.start) / total) * 100).toFixed(2)}%)` }),
    // Alternate rows, so dates of visits close in time never touch.
    el('span', { class: `tl-date${index % 2 ? ' tl-date-low' : ''}${index === 0 ? ' tl-date-first' : (cluster.start - first) / total > 0.85 ? ' tl-date-end' : ''}`, style: `left: ${at(cluster.start)}`, text: dateOf(cluster.start) }),
  ]);
  return el('figure', { class: 'timeline' }, [
    el('figcaption', { class: 'note', text: t('game.timeline.caption') }),
    el('div', { class: 'tl-track', role: 'img', 'aria-label': t('game.timeline.label', {
      visits: clusters.map((cluster) => clusterDate(cluster)).join('; '), target: dateOf(target), days: formatNumber(days, 0),
    }) }, [
      el('span', { class: 'tl-line' }),
      el('span', { class: 'tl-ahead', style: `left: ${at(last)}; right: 0` }),
      ...marks.flat(),
      el('span', { class: 'tl-diamond' }),
      el('span', { class: 'tl-target', text: t('game.timeline.target', { date: dateOf(target) }) }),
    ]),
    el('p', { class: 'tl-summary', text: t('game.timeline.after', { days: formatNumber(days, 0), last: dateOf(last) }) }),
  ]);
}

// ---------- Hints ----------

const COMPASS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
/** The 8-point compass word for a direction given as (east, north). */
export function compassOf(direction) {
  if (!direction) return null;
  const bearing = (Math.atan2(direction.east, direction.north) * 180) / Math.PI; // 0 = north, 90 = east
  return COMPASS[((Math.round(bearing / 45) % 8) + 8) % 8];
}

/** A small sketch of the yearly loop for hint 3: a straight drift with a wiggle (star) or a backward loop (solar). */
function loopSketch(type) {
  const [width, height] = [220, 90];
  const path = [];
  for (let step = 0; step <= 120; step += 1) {
    const year = (step / 120) * 2;
    const angle = 2 * Math.PI * year;
    const x = type === 'solar' ? 20 + year * 90 - 26 * Math.sin(angle) : 20 + year * 90;
    const y = type === 'solar' ? 45 - 14 * Math.cos(angle) : 45 - 12 * Math.sin(angle) - 4 * Math.cos(angle);
    path.push(`${step ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return el('figure', { class: 'hint-sketch' }, [
    svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': t(`game.hint3.sketch.${type === 'solar' ? 'solar' : 'star'}`) }, [
      svg('line', { x1: 20, y1: 45, x2: 200, y2: 45, class: 'sketch-straight' }),
      svg('path', { d: path.join(''), class: 'sketch-path' }),
    ]),
    el('figcaption', { class: 'note', text: t('game.hint3.sketchCaption') }),
  ]);
}

/** The text of hint n (1–3) for a round, from its training points only. */
export function hintBody(n, round, type, name, unit) {
  if (n === 1) {
    const compass = compassOf(hintDirection(round));
    return [el('p', { text: compass ? t('game.hint1.text', { direction: t(`game.dir.${compass}`) }) : t('game.hint1.none') })];
  }
  if (n === 2) {
    const motion = trainingMotion(round);
    const ruler = hintRuler(round);
    if (!motion || !ruler) return [el('p', { text: t('game.hint2.none') })];
    return [
      el('p', { text: t('game.hint2.text', {
        speed: angleText(motion.speed, unit), step: String(ruler.stepDays), days: formatNumber(daysToTarget(round), 0),
        distance: angleText(Math.hypot(ruler.end.east, ruler.end.north), unit),
      }) }),
      el('p', { class: 'note', text: t('game.hint2.straight') }),
    ];
  }
  return [el('p', { text: t(`game.hint3.${type === 'solar' ? 'solar' : 'star'}`, { name }) }), loopSketch(type)];
}

/**
 * Hints 1 and 2 drawn on the chart, in offsets from the last measurement: the average direction as an arrow and
 * the straight-line ruler with a tick every 30 days. offsetToPlot and span come from the chart's geometry.
 */
export function hintOverlay(round, shown, { offsetToPlot, span }) {
  const nodes = [];
  const origin = offsetToPlot({ east: 0, north: 0 });
  const direction = hintDirection(round);
  if (shown >= 1 && direction) {
    const tip = offsetToPlot({ east: direction.east * span * 0.22, north: direction.north * span * 0.22 });
    nodes.push(
      svg('defs', {}, [svg('marker', { id: 'hint-head', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, [svg('path', { d: 'M0,0L10,5L0,10Z', class: 'hint-head' })])]),
      svg('line', { x1: origin.x, y1: origin.y, x2: tip.x, y2: tip.y, class: 'hint-arrow', 'marker-end': 'url(#hint-head)' }),
    );
  }
  const ruler = shown >= 2 ? hintRuler(round) : null;
  if (ruler) {
    const end = offsetToPlot(ruler.end);
    const length = Math.hypot(end.x - origin.x, end.y - origin.y) || 1;
    // The perpendicular that points right (or down), so labels sit beside the ruler, anchored away from it.
    let [nx, ny] = [-(end.y - origin.y) / length, (end.x - origin.x) / length];
    if (nx < 0 || (nx === 0 && ny < 0)) [nx, ny] = [-nx, -ny];
    const anchor = nx > 0.35 ? 'start' : 'middle';
    const every = ruler.ticks.length > 6 ? 2 : 1;
    nodes.push(svg('line', { x1: origin.x, y1: origin.y, x2: end.x, y2: end.y, class: 'hint-ruler' }));
    ruler.ticks.forEach((tick, index) => {
      const at = offsetToPlot(tick);
      nodes.push(svg('line', { x1: at.x - nx * 5, y1: at.y - ny * 5, x2: at.x + nx * 5, y2: at.y + ny * 5, class: 'hint-tick' }));
      if ((index + 1) % every === 0) nodes.push(svg('text', { x: at.x + nx * 10, y: at.y + ny * 10 + 4, class: 'hint-label', 'text-anchor': anchor }, [words(t('game.hint2.tick', { days: String(tick.days) }))]));
    });
    nodes.push(
      svg('circle', { cx: end.x, cy: end.y, r: 4, class: 'hint-end' }),
      svg('text', { x: end.x + nx * 12, y: end.y + ny * 12 + 4, class: 'hint-label hint-label-end', 'text-anchor': anchor }, [words(t('game.hint2.end'))]),
    );
  }
  return nodes;
}

// ---------- After the reveal ----------

/** One line explaining the result (game.js resultExplanation). Only called after the reveal. */
export function explainResult(round, type, name, result) {
  const explanation = resultExplanation(round, type, result);
  if (!explanation) return null;
  const unit = result.unit;
  const perArcsec = { arcsec: 1, arcmin: 1 / 60, deg: 1 / 3600 }[unit] ?? 1;
  const show = (value) => (type === 'brightness' ? withUnit(value, unit, 2) : angleText(value / perArcsec, unit));
  const text = t(`game.explain.${explanation.key}`, { model: show(explanation.model), baseline: show(explanation.baseline), name });
  return el('p', { class: 'explain-line', text: explanation.outside ? `${text} ${t('game.explain.outside')}` : text });
}
