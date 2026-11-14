// The guided tour: Home → the Pluto investigation → Predictions and the reveal → Beat the physics → Learn.
// The reader moves on with "Next" (no timers, so there is time to read) and can skip it at any step.
// It starts by itself once per browser, on a plain visit to Home; the "Guided tour" button replays it.
// It shows no measured numbers of its own: every page it opens says what is and is not measured.

export const TOUR_STORAGE_KEY = 'tenger.tour.v1';

/** Each step: the caption key and what the page does when the step opens. */
export const TOUR_STEPS = [
  { key: 'tour.home', run: (actions) => actions.showPage('home') },
  {
    key: 'tour.pluto',
    run: (actions) => {
      actions.open('pluto');
      actions.whenReady(() => {
        actions.setMode('blink');
        actions.setPlaying(!actions.reducedMotion());
      });
    },
  },
  {
    key: 'tour.predictions',
    run: (actions) => {
      actions.showPage('predictions');
      actions.showReveal();
    },
  },
  { key: 'tour.game', run: (actions) => actions.showPage('game') },
  { key: 'tour.learn', run: (actions) => actions.showPage('learn') },
];

/** Best-effort storage: any failure (private mode, blocked site data) reads as "unavailable". */
export function tourSeen(storage) {
  try {
    const value = storage?.getItem(TOUR_STORAGE_KEY);
    return value === null ? false : value !== undefined ? true : null;
  } catch {
    return null;
  }
}

export function markTourSeen(storage) {
  try {
    storage?.setItem(TOUR_STORAGE_KEY, 'seen');
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the tour starts by itself: only on a plain visit to Home (no link to a page, target, position or
 * example data), not when embedded, and only when the browser can remember that it was shown. Without
 * working storage it would start on every visit, so then it waits for the button.
 */
export function shouldAutoStart({ storage, route }) {
  if (!route || route.embed || route.fixtures) return false;
  if (route.page && route.page !== 'home') return false;
  if (route.target || route.ra !== null && route.ra !== undefined || route.trial || route.round || route.lesson) return false;
  return tourSeen(storage) === false;
}

let active = null;

export const isTourRunning = () => Boolean(active);

function show(run) {
  const step = TOUR_STEPS[run.index];
  run.actions.render({ index: run.index, total: TOUR_STEPS.length, key: step.key, last: run.index === TOUR_STEPS.length - 1 });
  step.run(run.actions);
}

/** Starts the tour at the first step (marking it seen), or stops it if it is running. */
export function runTour(actions, { storage } = {}) {
  if (active) {
    stopTour();
    return;
  }
  markTourSeen(storage);
  active = { index: 0, actions };
  actions.started();
  show(active);
}

/** Next step, or the end of the tour after the last one. */
export function nextTourStep() {
  if (!active) return;
  if (active.index >= TOUR_STEPS.length - 1) {
    stopTour();
    return;
  }
  active.index += 1;
  show(active);
}

export function stopTour() {
  if (!active) return;
  const { actions } = active;
  active = null;
  actions.finished();
}
