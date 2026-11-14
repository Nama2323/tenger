// The "Why Pluto loops" page: the 3D scene (loop3d.js, loaded when the page opens) and, always, a true-scale 2D
// chart of the apparent path, which is also the fallback when 3D is not available.
import { $, formatNumber, formatUtc, prefersReducedMotion } from './dom.js';
import { t } from './i18n.js';
import { EXAGGERATION, loopModel, parallaxDeg, norm, sub, truePath, timeline, observerAt } from './loop.js';
import { POSTMORTEM_PATH, readPostmortem } from './postmortem.js';
import { chooseView, webglAvailable, VIEW_STORAGE_KEY } from './space-ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEG = Math.PI / 180;
let state = null;

const svg = (name, attributes = {}, children = []) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  node.append(...children);
  return node;
};
const dateOf = (mjd) => formatUtc(new Date((mjd - 40587) * 86400000), { time: false });

function savedView() {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY);
  } catch {
    return null;
  }
}

async function json(url) {
  if (!url) return null;
  try {
    const response = await fetch(url);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

// ---------- The true-scale chart (also the 2D fallback) ----------

/** Tangent-plane offsets in degrees around a centre: x grows to the east (drawn to the left), y to the north. */
function projector(raCentre, decCentre) {
  const c = Math.cos(decCentre * DEG);
  return ({ ra, dec }) => {
    let dra = ra - raCentre;
    if (dra > 180) dra -= 360;
    if (dra < -180) dra += 360;
    return { x: dra * c, y: dec - decCentre };
  };
}

function drawChart() {
  const { model } = state;
  const path = truePath(model.orbit, timeline(model.start, model.end, 2));
  const measured = (list) => list.filter((entry) => entry.measured).map((entry) => ({ ra: entry.measured.ra_deg, dec: entry.measured.dec_deg }));
  const groups = {
    training: measured(model.training),
    evaluation: measured(model.evaluation),
    tracks: model.tracks.map((track) => ({ version: track.version, points: track.points.map((point) => ({ ra: point.ra, dec: point.dec })) })),
  };
  const everything = [...path, ...groups.training, ...groups.evaluation, ...groups.tracks.flatMap((track) => track.points)];
  const raMid = everything.reduce((sum, point) => sum + point.ra, 0) / everything.length;
  const decMid = everything.reduce((sum, point) => sum + point.dec, 0) / everything.length;
  const project = projector(raMid, decMid);
  const xs = everything.map((point) => project(point).x);
  const ys = everything.map((point) => project(point).y);
  const [xMin, xMax, yMin, yMax] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = 0.25;
  const width = 900;
  const unitPx = (width - 80) / (xMax - xMin + 2 * pad);
  const height = Math.max(180, (yMax - yMin + 2 * pad) * unitPx + 60);
  // East is to the left: larger x (east) at smaller pixel x.
  const px = (point) => {
    const p = project(point);
    return { x: 40 + (xMax + pad - p.x) * unitPx, y: 20 + (yMax + pad - p.y) * unitPx };
  };
  const polyline = (points, className) => svg('polyline', { points: points.map(px).map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '), class: className });
  const dotsOf = (points, className, r = 3) => points.map((point) => {
    const { x, y } = px(point);
    return svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r, class: className });
  });
  const ticks = [];
  for (let ra = Math.ceil(raMid - 10); ra <= Math.floor(raMid + 10); ra += 1) {
    const { x } = px({ ra, dec: decMid });
    if (x < 30 || x > width - 10) continue;
    ticks.push(svg('line', { x1: x, x2: x, y1: 14, y2: height - 30, class: 'grid' }), svg('text', { x, y: height - 12, class: 'tick', 'text-anchor': 'middle' }, [`${ra}°`]));
  }
  for (let dec = Math.ceil((decMid - 3) * 2) / 2; dec <= decMid + 3; dec += 0.5) {
    const { y } = px({ ra: raMid, dec });
    if (y < 14 || y > height - 30) continue;
    ticks.push(svg('line', { x1: 36, x2: width - 4, y1: y, y2: y, class: 'grid' }), svg('text', { x: 4, y: y + 4, class: 'tick' }, [`${dec.toFixed(1)}°`]));
  }
  const now = svg('g', { class: 'now-marker' }, [svg('circle', { r: 6 })]);
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height.toFixed(0)}`, class: 'loop-chart-svg', role: 'img', 'aria-labelledby': 'loop-chart-title loop-chart-lead' }, [
    ...ticks,
    polyline(path, 'path'),
    // v2 first, so the dashed v1 track (frozen before the miss) stays visible on top where they overlap.
    ...[...groups.tracks].sort((a, b) => b.version - a.version).map((track) => polyline(track.points, track.version >= 2 ? 'track v2' : 'track v1')),
    ...dotsOf(groups.training, 'pt training'),
    ...dotsOf(groups.evaluation, 'pt evaluation', 3.5),
    ...groups.tracks.flatMap((track) => dotsOf(track.points, track.version >= 2 ? 'pt v2' : 'pt v1', 2.5)),
    now,
    svg('text', { x: 8, y: 14, class: 'tick' }, [t('loop.axisEast')]),
  ]);
  $('loop-chart').replaceChildren(chart);
  state.chartNow = (mjd) => {
    const position = truePath(model.orbit, [mjd])[0];
    const { x, y } = px(position);
    now.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`);
  };
}

/** The 2026 check at true scale (arcseconds), from the post-mortem: the frozen 95% region and the observation. */
function drawInset(pm) {
  const host = $('loop-inset');
  if (!pm?.frozenRegion || !Number.isFinite(pm.along)) {
    host.replaceChildren();
    $('loop-inset-wrap').hidden = true;
    return;
  }
  $('loop-inset-wrap').hidden = false;
  const size = 220;
  const scale = (size / 2 - 16) / Math.max(pm.frozenRegion.major, pm.error ?? 0, 1);
  const centre = size / 2;
  const { major, minor, pa } = pm.frozenRegion;
  // Position angle θ is east of north. With east drawn to the left and north up, the long axis points along
  // (−sin θ, −cos θ) on screen, which is an SVG rotation of 90° − θ (an ellipse is the same turned by 180°).
  const rotate = 90 - (pa ?? 0);
  const [east, north] = pm.residualEN ?? [null, null];
  const observed = Number.isFinite(east) ? { x: centre - east * scale, y: centre - north * scale } : null;
  host.replaceChildren(svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'loop-inset-svg', role: 'img', 'aria-label': t('loop.insetNote', { major: formatNumber(major, 2), minor: formatNumber(minor, 2), error: formatNumber(pm.error, 1) }) }, [
    svg('line', { x1: centre, x2: centre, y1: 8, y2: size - 8, class: 'grid' }),
    svg('line', { x1: 8, x2: size - 8, y1: centre, y2: centre, class: 'grid' }),
    svg('ellipse', { cx: centre, cy: centre, rx: (major * scale).toFixed(1), ry: (minor * scale).toFixed(1), transform: `rotate(${rotate.toFixed(1)} ${centre} ${centre})`, class: 'region' }),
    svg('circle', { cx: centre, cy: centre, r: 3.5, class: 'pt forecast' }),
    observed ? svg('path', { d: `M${observed.x - 5},${observed.y - 5}L${observed.x + 5},${observed.y + 5}M${observed.x - 5},${observed.y + 5}L${observed.x + 5},${observed.y - 5}`, class: 'observed' }) : null,
    svg('line', { x1: 12, x2: 12 + 2 * scale, y1: size - 12, y2: size - 12, class: 'scalebar' }),
    svg('text', { x: 12, y: size - 16, class: 'tick' }, ['2″']),
    svg('text', { x: size - 22, y: 16, class: 'tick' }, ['N ↑']),
    svg('text', { x: 8, y: 16, class: 'tick' }, ['← E']),
  ].filter(Boolean)));
  $('loop-inset-note').textContent = t('loop.insetNote', { major: formatNumber(major, 2), minor: formatNumber(minor, 2), error: formatNumber(pm.error, 1) });
}

// ---------- Page ----------

function setTime(mjd) {
  state.time = mjd;
  $('loop-date').textContent = dateOf(mjd);
  state.chartNow?.(mjd);
  state.scene?.setTime(mjd);
}

function setView(mode) {
  state.mode = mode;
  $('loop-stage').hidden = mode !== '3d';
  $('loop-toggle').textContent = t(mode === '3d' ? 'loop.view2d' : 'loop.view3d');
  for (const id of ['loop-from-spherex', 'loop-top', 'loop-reset']) $(id).hidden = mode !== '3d';
}

async function start3d() {
  try {
    const { createLoopScene } = await import('./loop3d.js');
    const scene = createLoopScene($('loop3d'), {
      model: state.model,
      reducedMotion: prefersReducedMotion(),
      allowSoftware: savedView() === '3d',
      labelOf: (key, values) => t(key, values),
    });
    if (scene.unavailable) {
      setView('2d');
      $('loop-note').textContent = t(scene.unavailable === 'slow' ? 'space.slow' : 'space.noWebgl');
      return;
    }
    state.scene = scene;
    setView('3d');
    scene.setTime(state.time);
  } catch (error) {
    console.error('The 3D loop could not start:', error);
    setView('2d');
    $('loop-note').textContent = t('space.failed');
  }
}

/**
 * Called each time the page is shown. options: source (contract source for data/), openForecastIds (Pluto's
 * open forecasts from the index), embed.
 */
export async function showLoopPage({ source, openForecastIds = [], embed = false }) {
  if (state?.ready || state?.loading) return;
  state = { loading: true };
  const [scene, pm, ...predictions] = await Promise.all([
    json(source.url('scene3d.json')),
    json(source.url(POSTMORTEM_PATH)),
    ...openForecastIds.map((id) => json(source.url(`trials/${id}/prediction.json`)).then((doc) => (doc ? { id, ...doc } : null))),
  ]);
  const v2 = predictions.filter((doc) => doc && doc.trial_id !== scene?.pluto_loop?.open_forecast_2027?.trial_id && Array.isArray(doc.track));
  const model = loopModel(scene, v2);
  if (!model) {
    state = { ready: true };
    $('loop-note').textContent = t('loop.noScene');
    $('loop-stage').hidden = true;
    return;
  }
  const postmortem = readPostmortem(pm);
  state = { ready: true, model, scene: null, mode: '2d', time: model.observed?.tMjd ?? model.start };
  const distance = norm(sub(model.orbit(state.time), observerAt(state.time)));
  $('loop-scale').textContent = t('loop.scale', { factor: String(EXAGGERATION), deg: formatNumber(parallaxDeg(distance), 1) });
  const slider = $('loop-slider');
  slider.min = String(Math.floor(model.start));
  slider.max = String(Math.ceil(model.end));
  slider.value = String(Math.round(state.time));
  slider.addEventListener('input', () => setTime(Number(slider.value)));
  drawChart();
  drawInset(postmortem && { ...postmortem, residualEN: pm?.residual_split ? [pm.residual_split.east_arcsec, pm.residual_split.north_arcsec] : null });
  setTime(state.time);
  const choice = chooseView({ webgl: !embed && webglAvailable(), reducedMotion: prefersReducedMotion(), saved: savedView(), deviceMemory: navigator.deviceMemory ?? null, embed });
  $('loop-note').textContent = choice.reason ? t(choice.reason) : '';
  $('loop-toggle').hidden = !choice.offer3d;
  setView('2d');
  $('loop-toggle').onclick = () => {
    if (state.mode === '3d') {
      setView('2d');
    } else if (state.scene) {
      setView('3d');
    } else {
      $('loop-note').textContent = '';
      start3d();
    }
  };
  $('loop-from-spherex').onclick = () => state.scene?.fromSpherex();
  $('loop-top').onclick = () => state.scene?.top();
  $('loop-reset').onclick = () => state.scene?.overview();
  if (choice.mode === '3d') start3d();
}
