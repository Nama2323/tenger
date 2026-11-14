// Home / Investigate: coordinate search, the challenge shortcuts, the schematic distance map and the
// accessible target list. All three views are built from one target list (targets.js).
import { parseDec, parseRa } from './coords.js';
import { $, el, prefersReducedMotion } from './dom.js';
import { has, t, tData } from './i18n.js';
import { AU_PER_UNIT, RINGS, mapRadius, placeOnMap } from './map.js';
import { isLegacyOnly, isViewable } from './targets.js';

const BLINK_MS = 900;
const LABEL_SIDES = ['label-right', 'label-left', 'label-below', 'label-above'];
const LABEL_GAP_PX = 2;
const FOV_CHOICES = [0.05, 0.1, 0.2, 0.5];
const DEFAULT_FOV = 0.1;
let blinkTimer = null;

export const entryName = (entry) => entry.name ?? t(entry.nameKey);

export function formatDistance(distance) {
  if (!distance || distance.value === null || !Number.isFinite(Number(distance.value))) return null;
  const value = Number(distance.value);
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const shown = new Intl.NumberFormat('en', { maximumFractionDigits: digits }).format(value);
  if (distance.unit === 'pc') {
    const ly = new Intl.NumberFormat('en', { maximumFractionDigits: value >= 30 ? 0 : 1 })
      .format((value * AU_PER_UNIT.pc) / AU_PER_UNIT.ly);
    return t('distance.pc', { value: shown, ly });
  }
  return t(`distance.${distance.unit}`, { value: shown });
}

export function predictionLabel(entry) {
  return entry.prediction.status ? t(`trial.${entry.prediction.status}`) : t('trial.none');
}

export const statusLabel = (entry) => (isLegacyOnly(entry) ? t('data.legacyOnly') : t(`data.${entry.dataStatus}`));
const hookOf = (entry) => (has(`hook_${entry.key}`) ? t(`hook_${entry.key}`) : null);
export const kindLabel = (kind) => t(has(`kind${kind}`) ? `kind${kind}` : 'kindother');

// ---------- Blinking thumbnails ----------

/** A looping pair of prepared thumbnails; which one shows is driven by one attribute on the body. */
function blinkTile(key, thumbs) {
  const ringless = thumbs.kind === 'colour' || thumbs.kind === 'index';
  const tile = el('div', { class: ringless ? 'blink place' : 'blink', 'aria-hidden': 'true' });
  thumbs.frames.forEach((frame, index) => {
    const side = index ? 'b' : 'a';
    if (Number.isFinite(frame.x)) tile.style.setProperty(`--${side}x`, `${frame.x * 100}%`);
    if (Number.isFinite(frame.y)) tile.style.setProperty(`--${side}y`, `${frame.y * 100}%`);
    tile.append(
      el('img', { src: frame.src ?? `data/${key}/${frame.file}`, alt: '', class: `plate-${side}`, loading: 'lazy' }),
      el('b', { class: `label-${side}`, text: frame.label }),
    );
  });
  tile.append(el('i', { class: 'ring' }));
  return tile;
}

export function startBlinking() {
  clearInterval(blinkTimer);
  if (prefersReducedMotion()) {
    document.body.dataset.blink = 'b';
    return;
  }
  blinkTimer = setInterval(() => {
    document.body.dataset.blink = document.body.dataset.blink === 'b' ? 'a' : 'b';
  }, BLINK_MS);
}

// ---------- Shortcuts ----------

function shortcutCard(entry, thumbs, onOpen) {
  const words = el('span', { class: 'card-words' }, [
    el('strong', { text: entryName(entry) }),
    el('small', { text: hookOf(entry) }),
    el('small', { class: 'card-status', text: `${statusLabel(entry)} · ${predictionLabel(entry)}` }),
  ]);
  const thumbNote = thumbs ? el('span', { class: 'sr-only', text: t(`thumb.${thumbs.kind}`) }) : null;
  return el('li', {}, el('button', {
    type: 'button',
    class: `card colour-${entry.colour}`,
    onclick: () => onOpen(entry),
  }, [thumbs ? blinkTile(entry.key, thumbs) : el('span', { class: 'blink empty', 'aria-hidden': 'true' }), words, thumbNote]));
}

function plannedCard(entry) {
  return el('li', { class: `card is-off colour-${entry.colour}` }, [
    el('span', { class: 'blink empty', 'aria-hidden': 'true' }),
    el('span', { class: 'card-words' }, [
      el('strong', { text: entryName(entry) }),
      el('small', { text: hookOf(entry) }),
      el('small', { class: 'card-status', text: [
        entry.statusReasonKey ? t('data.unavailableBecause', { reason: tData(entry.statusReasonKey, 'explain.unknown') }) : statusLabel(entry),
        entry.seeOnly ? t('trial.see_only') : null,
      ].filter(Boolean).join(' · ') }),
    ]),
  ]);
}

function renderShortcuts(entries, thumbsOf, onOpen) {
  const official = entries.filter((entry) => entry.official);
  const others = entries.filter((entry) => !entry.official && entry.role !== 'place');
  $('shortcut-list').replaceChildren(...official.map((entry) => (isViewable(entry)
    ? shortcutCard(entry, thumbsOf(entry), onOpen) : plannedCard(entry))));
  $('planned-list').replaceChildren(...others.map((entry) => (isViewable(entry)
    ? shortcutCard(entry, thumbsOf(entry), onOpen) : plannedCard(entry))));
  $('planned').hidden = !others.length;
}

// ---------- Map ----------

const SVG = 'http://www.w3.org/2000/svg';
const svgNode = (name, attributes) => {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
};

function ringLabel(ring) {
  const value = new Intl.NumberFormat('en').format(ring.value);
  return t(ring.unit === 'au' ? 'map.ringAu' : 'map.ringLy', { value });
}

function mapMarker(entry, place, onOpen) {
  const distance = formatDistance(entry.map.distance);
  const label = t('map.marker', { name: entryName(entry), distance, status: statusLabel(entry) });
  const props = {
    class: `map-marker colour-${entry.colour} label-right${isViewable(entry) ? '' : ' is-off'}`,
    style: `left:${(place.x * 100).toFixed(2)}%;top:${(place.y * 100).toFixed(2)}%`,
    'aria-label': label,
    title: label,
  };
  const content = [el('i', { class: 'dot', 'aria-hidden': 'true' }), el('span', { text: entryName(entry), 'aria-hidden': 'true' })];
  if (isViewable(entry)) return el('button', { ...props, type: 'button', onclick: () => onOpen(entry) }, content);
  return el('span', { ...props, role: 'img' }, content);
}

function renderMap(entries, indexLoaded, onOpen) {
  const canvas = $('map-canvas');
  const notes = $('map-notes');
  $('map-waiting').hidden = indexLoaded;
  canvas.hidden = !indexLoaded;
  $('map-legend').hidden = !indexLoaded;
  if (!indexLoaded) {
    canvas.replaceChildren();
    notes.replaceChildren();
    return;
  }
  const svg = svgNode('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true', class: 'map-rings' });
  const labels = [];
  RINGS.forEach((ring, index) => {
    const { r } = mapRadius(ring.au);
    svg.append(svgNode('circle', { cx: 50, cy: 50, r: (r * 100).toFixed(2), class: `ring ring-${ring.unit}` }));
    labels.push(el('span', {
      class: index % 2 ? 'ring-label minor' : 'ring-label',
      style: `top:${((0.5 - r) * 100).toFixed(2)}%`,
      'aria-hidden': 'true',
      text: ringLabel(ring),
    }));
  });
  svg.append(svgNode('circle', { cx: 50, cy: 50, r: 1.6, class: 'sun' }));
  const sun = el('span', { class: 'sun-label', text: t('map.sun') });
  const markers = [];
  const unplaced = [];
  const clamped = [];
  for (const entry of entries) {
    const place = entry.map ? placeOnMap(entry.map) : null;
    if (!place) {
      unplaced.push(entryName(entry));
      continue;
    }
    if (place.clamped) clamped.push(t('map.clamped', { name: entryName(entry) }));
    markers.push(mapMarker(entry, place, onOpen));
  }
  canvas.replaceChildren(svg, ...labels, sun, ...markers);
  placeMapLabels();
  notes.replaceChildren(
    ...(unplaced.length ? [el('p', { text: t('map.unplaced', { names: unplaced.join(', ') }) })] : []),
    ...clamped.map((text) => el('p', { text })),
  );
}

const DOT_RADIUS_PX = 9;

const overlapArea = (first, second) => {
  const width = Math.min(first.right, second.right) - Math.max(first.left, second.left) + LABEL_GAP_PX;
  const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) + LABEL_GAP_PX;
  return width > 0 && height > 0 ? width * height : 0;
};

const outside = (rect, box) => Math.max(0, box.left - rect.left) + Math.max(0, rect.right - box.right)
  + Math.max(0, box.top - rect.top) + Math.max(0, rect.bottom - box.bottom);

/** Puts each marker's name right, left, below or above its dot, choosing the side that stays inside the map
 * and covers the fewest other names and dots. Runs again on resize; does nothing while the map is hidden. */
export function placeMapLabels() {
  const canvas = $('map-canvas');
  const box = canvas.getBoundingClientRect();
  if (!box.width) return;
  const markers = [...canvas.querySelectorAll('.map-marker')];
  const dots = markers.map((marker) => {
    const x = box.left + (parseFloat(marker.style.left) / 100) * box.width;
    const y = box.top + (parseFloat(marker.style.top) / 100) * box.height;
    return { left: x - DOT_RADIUS_PX, right: x + DOT_RADIUS_PX, top: y - DOT_RADIUS_PX, bottom: y + DOT_RADIUS_PX };
  });
  const placed = [];
  markers.forEach((marker, index) => {
    const label = marker.querySelector('span');
    const obstacles = [...placed, ...dots.filter((_, other) => other !== index)];
    let best = null;
    for (const side of LABEL_SIDES) {
      marker.classList.remove(...LABEL_SIDES);
      marker.classList.add(side);
      const rect = label.getBoundingClientRect();
      const cost = outside(rect, box) * 1000 + obstacles.reduce((sum, other) => sum + overlapArea(rect, other), 0);
      if (!best || cost < best.cost) best = { side, cost, rect };
      if (cost === 0) break;
    }
    marker.classList.remove(...LABEL_SIDES);
    marker.classList.add(best.side);
    placed.push(best.rect);
  });
}

// ---------- Feed ----------

function feedItem(entry, onOpen) {
  const distance = entry.map ? formatDistance(entry.map.distance) : null;
  const source = entry.map?.distance?.source;
  const lines = [
    el('p', { class: 'feed-kind', text: `${kindLabel(entry.kind)} · ${t(`role.${entry.role}`)}` }),
    el('p', { text: distance ? t('feed.distance', { distance, source: source ?? '—' }) : t('feed.noDistance') }),
    el('p', { text: `${statusLabel(entry)} · ${t('feed.prediction', { status: predictionLabel(entry) })}` }),
  ];
  const action = isViewable(entry)
    ? el('button', { type: 'button', class: 'glow', onclick: () => onOpen(entry), text: t('feed.open'), 'aria-label': `${t('feed.open')}: ${entryName(entry)}` })
    : el('p', { class: 'feed-off', text: entry.statusReasonKey
      ? t('data.unavailableBecause', { reason: tData(entry.statusReasonKey, 'explain.unknown') })
      : t('data.unavailable') });
  return el('li', { class: `feed-item colour-${entry.colour}` }, [
    el('h3', {}, [el('i', { class: 'dot', 'aria-hidden': 'true' }), entryName(entry)]),
    ...lines,
    action,
  ]);
}

function renderFeed(entries, onOpen) {
  $('feed-list').replaceChildren(...entries.map((entry) => feedItem(entry, onOpen)));
}

// ---------- Coordinate search ----------

export function buildFovOptions(select, selected = DEFAULT_FOV) {
  select.replaceChildren(...FOV_CHOICES.map((fov) => el('option', {
    value: String(fov),
    text: t('search.fovOption', { arcmin: String(Math.round(fov * 60)), deg: String(fov) }),
    selected: fov === selected,
  })));
}

export function bindCoordinateSearch(onSubmit) {
  buildFovOptions($('coord-fov'));
  $('coord-search').addEventListener('submit', (event) => {
    event.preventDefault();
    const ra = parseRa($('coord-ra').value);
    const dec = parseDec($('coord-dec').value);
    const problems = [ra === null ? t('search.badRa') : null, dec === null ? t('search.badDec') : null].filter(Boolean);
    $('coord-ra').setAttribute('aria-invalid', String(ra === null));
    $('coord-dec').setAttribute('aria-invalid', String(dec === null));
    $('coord-message').textContent = problems.join(' ');
    if (problems.length) return;
    onSubmit({ ra, dec, fov: Number($('coord-fov').value) });
  });
}

/** Fills the coordinate form, e.g. from a click on the real sky map. */
export function fillCoordinates(ra, dec) {
  $('coord-ra').value = ra.toFixed(4);
  $('coord-dec').value = `${dec >= 0 ? '+' : ''}${dec.toFixed(4)}`;
  $('coord-message').textContent = t('sky.picked', { ra: ra.toFixed(4), dec: dec.toFixed(4) });
}

// ---------- Page ----------

/** thumbsOf(entry) returns { kind, frames } prepared thumbnails or null. */
export function renderHome({ entries, indexLoaded, thumbsOf, onOpen }) {
  renderShortcuts(entries, thumbsOf, onOpen);
  renderMap(entries, indexLoaded, onOpen);
  renderFeed(entries, onOpen);
}
