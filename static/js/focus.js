// Pure rules for flying the camera of the 3D Home scene to a body (task B11): which bodies can be chosen, how close
// the camera may come to each, how far it may pull back from any of them, which body a click or tap means, and
// which labels stay when labels overlap. No three.js and no DOM, so every rule runs (and is tested) in Node.
import { PLANETS } from './orbits.js';

/** The bodies the camera can fly to and follow, in the order of the "Fly to" list. */
export const FOCUS_KEYS = ['sun', ...PLANETS, 'pluto', 'makemake'];

/** Exaggerated radii in scene units (the scene's 10 units are one decade of distance). */
export const SIZE = {
  sun: 0.9, mercury: 0.17, venus: 0.27, earth: 0.29, mars: 0.21, jupiter: 0.6, saturn: 0.52, uranus: 0.38, neptune: 0.38, dwarf: 0.24,
};
/** Saturn's drawn rings reach 2.1 radii. */
export const SATURN_RING_OUTER = 2.1;
/** Stars sit on a shell the camera never enters by itself; their glows reach a few units beyond it. */
export const STAR_SHELL = 150;
const STAR_GLOW = 2.75;
/** Everything drawn in the scene, star glows included, lies within this radius of the Sun (scene units). */
export const SCENE_RADIUS = STAR_SHELL + STAR_GLOW + 3;
/** Farthest a camera target sits from the Sun: Makemake's aphelion is about 53 au, a star view's target 24 units. */
export const TARGET_REACH = 26;
/** The home view (the Sun) keeps the earlier fixed limit. */
export const HOME_MIN_DISTANCE = 1.2;

/** The drawn size of a body: its radius, or Saturn's ring. */
export function extentOf(key) {
  if (key === 'saturn') return SIZE.saturn * SATURN_RING_OUTER;
  return SIZE[key] ?? SIZE.dwarf;
}

/**
 * The closest the camera may come to a body (scene units from its centre): 2.5 times its drawn size, where the body
 * about fills the view. Small for the inner planets, so their neighbours separate when the camera is on one.
 */
export const minDistanceFor = (key) => Math.round(extentOf(key) * 2.5 * 1000) / 1000;

/** How far from a body a flight ends: close enough to see it, far enough to keep its neighbours in view. */
const FLY_DISTANCE = { sun: 16, mercury: 3.2, venus: 3.6, earth: 3.6, mars: 3.4, jupiter: 6, saturn: 7, uranus: 5, neptune: 5, pluto: 4.5, makemake: 4.5 };
export const flyDistanceFor = (key) => FLY_DISTANCE[key] ?? 5;

/**
 * How far the camera may pull back from any target and still see the whole scene, star shell included: the sphere
 * around the target that holds the scene (SCENE_RADIUS + TARGET_REACH) fits inside the narrower half-angle of the
 * view (vertical, or horizontal on portrait screens). fovDeg is the vertical field of view.
 */
export function sceneFitDistance({ aspect = 1, fovDeg = 42, margin = 1.08 } = {}) {
  const half = (fovDeg / 2) * (Math.PI / 180);
  const narrower = Math.min(half, Math.atan(Math.tan(half) * (aspect > 0 ? aspect : 1)));
  return (margin * (SCENE_RADIUS + TARGET_REACH)) / Math.sin(narrower);
}

/** A click or tap counts for a body within this many CSS pixels of its centre (a 44 px target), or on its disc. */
export const TAP_RADIUS_PX = 22;

/**
 * The body a click or tap at `pointer` ({x, y} px) means, from candidates [{ key, x, y, radius (px), depth }] already
 * projected onto the screen. Distance is measured in units of each body's reach, so a small planet in front of the
 * Sun's disc can still be chosen; on a tie the nearer body wins. null when nothing is in reach.
 */
export function pickOnScreen(candidates, pointer, minRadius = TAP_RADIUS_PX) {
  let best = null;
  for (const candidate of candidates) {
    const reach = Math.max(minRadius, candidate.radius + 4);
    const gap = Math.hypot(candidate.x - pointer.x, candidate.y - pointer.y);
    if (gap > reach) continue;
    const score = gap / reach;
    if (!best || score < best.score - 0.02 || (Math.abs(score - best.score) <= 0.02 && candidate.depth < best.depth)) {
      best = { key: candidate.key, score, depth: candidate.depth };
    }
  }
  return best?.key ?? null;
}

/** Label kinds, most important first after the focused body's own label. */
export const LABEL_IMPORTANCE = { target: 3, sun: 3, earth: 2.5, planet: 2, hypothetical: 1.5, note: 1, ring: 1 };
/** A label that was showing keeps its place against an equally important one up to this much farther away. */
const STAY_FACTOR = 0.85;

/** Whether two {x, y, w, h} boxes overlap, with `gap` px of clearance. */
export const overlaps = (a, b, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * Which labels to show, and where. labels: [{ id, rects: [{x, y, w, h}, ...] (px; the places a label may take, its
 * current one first, e.g. right, left, above or below its point), kind, depth (distance from the camera), focused,
 * shown (was showing) }]; a single `rect` may stand for `rects`. blocked: boxes of the panels over the scene (the
 * time bar, the side panels); bounds: the scene's box, which a place must lie inside (a label cut off at the edge
 * reads as nothing). No label takes a place under a panel, not even the focused one. In order — the focused
 * body's label, more important kinds, nearer labels (one already showing counts a little nearer, so labels do not
 * flicker) — each label takes its first place that overlaps no panel and no label already placed; with none free it
 * fades. Returns a Map from each shown label's id to the index of the place it takes.
 */
export function chooseLabels(labels, { blocked = [], bounds = null, gap = 2 } = {}) {
  const inside = (rect) => !bounds || (rect.x >= bounds.x && rect.y >= bounds.y && rect.x + rect.w <= bounds.x + bounds.w && rect.y + rect.h <= bounds.y + bounds.h);
  const importance = (label) => LABEL_IMPORTANCE[label.kind] ?? 0;
  const depth = (label) => label.depth * (label.shown ? STAY_FACTOR : 1);
  const placesOf = (label) => label.rects ?? [label.rect];
  const order = labels
    .filter((label) => placesOf(label).some((rect) => rect && rect.w > 0))
    .sort((a, b) => (Number(Boolean(b.focused)) - Number(Boolean(a.focused))) || (importance(b) - importance(a)) || (depth(a) - depth(b)));
  const chosen = [];
  const placed = new Map();
  for (const label of order) {
    const rects = placesOf(label);
    const index = rects.findIndex((rect) => rect && rect.w > 0 && inside(rect)
      && !blocked.some((box) => overlaps(rect, box)) && !chosen.some((other) => overlaps(rect, other, gap)));
    if (index < 0) continue;
    chosen.push(rects[index]);
    placed.set(label.id, index);
  }
  return placed;
}
