// Chooses between the 3D home scene and the 2D schematic map, loads the 3D one lazily (three.js only arrives
// after the page is usable), and runs its buttons. The 2D map stays the fallback: no WebGL, reduced motion
// (unless the visitor switches 3D on), a device that draws too slowly, or a script that fails to load.
import { $, formatUtc, prefersReducedMotion } from './dom.js';
import { t } from './i18n.js';

export const VIEW_STORAGE_KEY = 'tenger.view.v1';
const LOW_MEMORY_GB = 2;

let state = { mode: 'unset', controller: null, loading: null, hooks: null, reason: null };

function savedView() {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveView(value) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, value);
  } catch {
    // Best effort: without storage the choice lasts for this page only.
  }
}

/**
 * Whether this browser has WebGL at all. A cheap check: creating a test context costs seconds on software
 * rendering, so a context that then fails to start is caught by createSpace (and the 2D map stays).
 */
export const webglAvailable = () => typeof window.WebGLRenderingContext === 'function' || typeof window.WebGL2RenderingContext === 'function';

/**
 * The view to start in, from the facts of this browser. Pure, so the rules are testable.
 * Returns { mode: '3d' | '2d', reason, offer3d } where offer3d says whether the "3D view" button may be shown.
 */
export function chooseView({ webgl, reducedMotion, saved, deviceMemory = null, embed = false }) {
  if (embed) return { mode: '2d', reason: null, offer3d: false };
  if (!webgl) return { mode: '2d', reason: 'space.noWebgl', offer3d: false };
  if (Number.isFinite(deviceMemory) && deviceMemory < LOW_MEMORY_GB) return { mode: '2d', reason: 'space.slow', offer3d: false };
  if (saved === '2d') return { mode: '2d', reason: null, offer3d: true };
  if (saved === '3d') return { mode: '3d', reason: null, offer3d: true };
  if (reducedMotion) return { mode: '2d', reason: 'space.reducedMotion', offer3d: true };
  return { mode: '3d', reason: null, offer3d: true };
}

async function loadSceneFile() {
  try {
    const response = await fetch('data/scene3d.json');
    if (!response.ok) return null;
    const doc = await response.json();
    return doc && typeof doc === 'object' && doc.bodies ? doc : null;
  } catch {
    return null;
  }
}

function showNote(key, values) {
  const note = $('space-note');
  note.textContent = key ? t(key, values) : '';
  note.hidden = !key;
}

/** The intended view; the 3D one is shown only once its scene exists (the 2D map stays until then). */
function setMode(mode, { shown = mode === '2d' } = {}) {
  state.mode = mode;
  if (shown) {
    document.body.classList.toggle('space-3d', mode === '3d');
    $('space3d').hidden = mode !== '3d';
  }
  // The button names the other view than the one on screen: "3D view" also while the 3D scene is still waiting
  // to start (the 2D map is what the visitor sees then).
  $('space-toggle').textContent = t(document.body.classList.contains('space-3d') ? 'space.view2d' : 'space.view3d');
}

function stop3d() {
  state.time?.dispose();
  state.time = null;
  state.controller?.dispose();
  state.controller = null;
}

async function start3d() {
  // Once only: a click on "3D view" and the idle start can both ask for it.
  if (state.controller) return null;
  if (state.loading) return state.loading;
  const { hooks } = state;
  state.loading = (async () => {
    try {
      // The time control (B10) arrives with the 3D view, so Home's first load does not grow.
      const [{ createSpace }, scene, { createTimeControl }] = await Promise.all([import('./space3d.js'), loadSceneFile(), import('./time-ui.js')]);
      if (state.mode !== '3d') return;
      const sceneDate = scene?.epoch_jd_tdb ? formatUtc(new Date((scene.epoch_jd_tdb - 2440587.5) * 86400000), { time: false }) : '—';
      $('space-key-note').textContent = t('space.keyNote', { date: sceneDate });
      $('space-date').textContent = t('space.date', { date: formatUtc(new Date(), { time: false }) });
      const controller = createSpace($('space3d'), {
        scene,
        date: new Date(),
        reducedMotion: prefersReducedMotion(),
        allowSoftware: savedView() === '3d',
        nameOf: hooks.nameOf,
        distanceOf: hooks.distanceOf,
        labelOf: (key, values) => t(key.startsWith('planet.') ? key : `space.${key}`, values),
        insetLeft: hooks.insetLeft,
        onPick: (key) => hooks.onPick(key),
        onHud: ({ target }) => {
          $('space-target').textContent = t('space.target', { name: target });
        },
        onSlow: () => {
          stop3d();
          setMode('2d');
          showNote('space.slow');
          $('space-toggle').hidden = true;
        },
      });
      if (controller.unavailable) {
        setMode('2d');
        showNote(controller.unavailable === 'slow' ? 'space.slow' : 'space.noWebgl');
        return;
      }
      state.controller = controller;
      setMode('3d', { shown: true });
      controller.resize();
      state.time = createTimeControl({ controller, host: $('space3d'), reducedMotion: prefersReducedMotion() });
      const unplaced = hooks.entries().filter((entry) => entry.key && !controller.has(entry.key)).map(hooks.nameOfEntry);
      showNote(scene ? (unplaced.length ? 'space.unplaced' : null) : 'space.noSceneFile', { names: unplaced.join(', ') });
    } catch (error) {
      console.error('The 3D view could not start:', error);
      stop3d();
      setMode('2d');
      showNote('space.failed');
    } finally {
      state.loading = null;
    }
  })();
  return state.loading;
}

/**
 * Called once Home has been drawn. hooks: entries(), nameOf(key), nameOfEntry(entry), distanceOf(star),
 * insetLeft(), onPick(key), embed.
 */
export function initSpace(hooks) {
  if (state.hooks) return;
  state.hooks = hooks;
  const choice = chooseView({
    webgl: !hooks.embed && webglAvailable(),
    reducedMotion: prefersReducedMotion(),
    saved: savedView(),
    deviceMemory: navigator.deviceMemory ?? null,
    embed: hooks.embed,
  });
  $('space-tools').hidden = !choice.offer3d;
  setMode(choice.mode);
  showNote(choice.reason);
  $('space-toggle').addEventListener('click', () => {
    if (state.controller) {
      saveView('2d');
      stop3d();
      setMode('2d');
      showNote(null);
    } else {
      saveView('3d');
      showNote(null);
      setMode('3d');
      start3d();
    }
  });
  $('space-reset').addEventListener('click', () => state.controller?.reset());
  $('space-top').addEventListener('click', () => state.controller?.top());
  state.pending = choice.mode === '3d';
}

/** After the page has loaded and stayed idle this long, the 3D view starts even without an interaction. */
export const IDLE_START_MS = 4000;
const WAKE_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];

/**
 * main.js calls this whenever Home (or an investigation over it) is on screen. The first time, and only if the
 * 3D view was chosen, three.js is fetched: on the visitor's first interaction, or once the page has loaded and
 * then stayed idle for IDLE_START_MS. Until then the 2D map is the page.
 */
export function homeShown() {
  if (!state.pending) return;
  state.pending = false;
  let started = false;
  const wake = () => {
    if (started) return;
    started = true;
    for (const name of WAKE_EVENTS) removeEventListener(name, wake);
    start3d();
  };
  for (const name of WAKE_EVENTS) addEventListener(name, wake, { passive: true });
  const idle = window.requestIdleCallback ?? ((callback) => setTimeout(callback, 50));
  const afterLoad = () => setTimeout(() => idle(wake, { timeout: 2000 }), IDLE_START_MS);
  if (document.readyState === 'complete') afterLoad();
  else addEventListener('load', afterLoad, { once: true });
}

/** Flies to a target in the 3D view, then runs `then`; without a 3D view (or that target) runs `then` at once. */
export function flyThen(key, then) {
  if (state.mode === '3d' && state.controller?.has(key) && state.controller.flyTo(key, { then })) return;
  then();
}

export const spaceMode = () => state.mode;
