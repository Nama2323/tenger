// Home / Investigate: coordinate search, the challenge shortcuts, the schematic distance map and the
// accessible target list. All three views are built from one target list (targets.js).
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

/** One of the five official targets as a compact chip with a tiny blinking thumbnail. */
function shortcutChip(entry, thumbs, onOpen) {
  const label = `${entryName(entry)}. ${hookOf(entry) ?? ''} ${statusLabel(entry)}. ${predictionLabel(entry)}.`;
  const tile = thumbs ? blinkTile(entry.key, thumbs) : el('span', { class: 'blink empty', 'aria-hidden': 'true' });
  if (!isViewable(entry)) {
    return el('li', {}, el('span', { class: `target-chip chip-off colour-${entry.colour}`, 'aria-label': label, role: 'img' }, [tile, entryName(entry)]));
  }
  return el('li', {}, el('button', {
    type: 'button',
    class: `target-chip colour-${entry.colour}`,
    'aria-label': label,
    title: label,
    onclick: () => onOpen(entry),
  }, [tile, el('span', { text: entryName(entry), 'aria-hidden': 'true' })]));
}

function renderShortcuts(entries, thumbsOf, onOpen) {
  const official = entries.filter((entry) => entry.official);
  $('shortcut-list').replaceChildren(...official.map((entry) => shortcutChip(entry, thumbsOf(entry), onOpen)));
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
  const glow = el('span', { class: 'sun-glow', 'aria-hidden': 'true' });
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
  canvas.replaceChildren(glow, svg, ...labels, sun, ...markers);
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

// ---------- Targets rail ----------

const GROUPS = ['star', 'variable', 'solar', 'hypothetical', 'other'];

function railItem(entry, onOpen) {
  const distance = entry.map ? formatDistance(entry.map.distance) : null;
  const source = entry.map?.distance?.source;
  const status = isViewable(entry) || !entry.statusReasonKey
    ? statusLabel(entry)
    : t('data.unavailableBecause', { reason: tData(entry.statusReasonKey, 'explain.unknown') });
  const lines = [
    el('strong', { text: entryName(entry) }),
    el('small', { text: `${kindLabel(entry.kind)} · ${t(`role.${entry.role}`)}` }),
    el('small', { text: distance ? t('feed.distance', { distance, source: source ?? '—' }) : t('feed.noDistance') }),
    el('small', { text: `${status} · ${t('feed.prediction', { status: predictionLabel(entry) })}` }),
  ];
  if (!isViewable(entry)) return el('li', {}, el('div', { class: `rail-item is-off colour-${entry.colour}` }, lines));
  return el('li', {}, el('button', {
    type: 'button',
    class: `rail-item colour-${entry.colour}`,
    onclick: () => onOpen(entry),
  }, [...lines, el('span', { class: 'rail-go', text: t('feed.open') })]));
}

/** The accessible target list: the same entries as the map, grouped by type. */
function renderRail(entries, onOpen) {
  const groups = GROUPS.map((colour) => ({ colour, members: entries.filter((entry) => entry.colour === colour) }))
    .filter((group) => group.members.length);
  $('feed-list').replaceChildren(...groups.map((group) => el('section', { class: `rail-group colour-${group.colour}` }, [
    el('h3', {}, [el('i', { class: 'dot', 'aria-hidden': 'true' }), t(`rail.group.${group.colour}`)]),
    el('ul', {}, group.members.map((entry) => railItem(entry, onOpen))),
  ])));
  $('rail-count').textContent = String(entries.length);
}

// ---------- Search ----------

export function buildFovOptions(select, selected = DEFAULT_FOV) {
  select.replaceChildren(...FOV_CHOICES.map((fov) => el('option', {
    value: String(fov),
    text: t('search.fovOption', { arcmin: String(Math.round(fov * 60)), deg: String(fov) }),
    selected: fov === selected,
  })));
}

/** Puts a position into the search box, e.g. from a click on the real sky map. */
export function fillCoordinates(ra, dec) {
  $('search-input').value = `${ra.toFixed(4)} ${dec >= 0 ? '+' : ''}${dec.toFixed(4)}`;
  $('search-message').textContent = t('sky.picked', { ra: ra.toFixed(4), dec: dec.toFixed(4) });
}

// ---------- Starfield ----------

const STAR_AREA_PX = 2600;

/** A still field of faint stars behind the console; same pattern on every load (seeded). */
export function drawStarfield(canvas = $('starfield')) {
  if (!canvas?.getContext) return;
  const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
  const width = innerWidth;
  const height = innerHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  let seed = 20261114;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const tints = ['230, 237, 247', '200, 225, 255', '255, 236, 200'];
  const count = Math.round((width * height) / STAR_AREA_PX);
  for (let index = 0; index < count; index += 1) {
    const size = random() ** 3 * 1.3 + 0.25;
    context.fillStyle = `rgba(${tints[Math.floor(random() * tints.length)]}, ${(0.15 + random() * 0.6).toFixed(2)})`;
    context.beginPath();
    context.arc(random() * width, random() * height, size, 0, Math.PI * 2);
    context.fill();
  }
}

// ---------- Page ----------

/** thumbsOf(entry) returns { kind, frames } prepared thumbnails or null. */
export function renderHome({ entries, indexLoaded, thumbsOf, onOpen }) {
  renderShortcuts(entries, thumbsOf, onOpen);
  renderMap(entries, indexLoaded, onOpen);
  renderRail(entries, onOpen);
}
