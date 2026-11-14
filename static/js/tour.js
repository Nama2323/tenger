// The guided demo: a scripted walk through TENGER. It shows real images, catalogue motions and the
// labelled viewer modes, then hands over to Beat the physics. It never shows a measured motion or
// brightness number: those wait for validated files (the old demo relied on the unvalidated motion box).
import { t } from './i18n.js';

const FRAME_WAIT_MS = 30000;
const POLL_MS = 400;
const SWIPE_MS = 4000;
const SWIPE_TICK_MS = 50;
const ARRAY_MS = 1600;
const ARRAYS = [1, 2, 3, 4, 5, 6];

let activeRun = null;

class Stopped extends Error {}

function sleeper(run) {
  return (milliseconds) => new Promise((resolve, reject) => {
    setTimeout(() => (run.stopped ? reject(new Stopped()) : resolve()), milliseconds);
  });
}

async function waitForFrames(actions, sleep) {
  const started = Date.now();
  while (Date.now() - started < FRAME_WAIT_MS) {
    if (actions.ready()) return;
    await sleep(POLL_MS);
  }
}

/** Sweeps the swipe divider across and back; with reduced motion it simply sets the midpoint. */
async function sweepSwipe(actions, sleep) {
  if (actions.reducedMotion()) {
    actions.setSwipe(50);
    await sleep(SWIPE_MS);
    return;
  }
  const steps = SWIPE_MS / SWIPE_TICK_MS;
  for (let step = 0; step <= steps; step += 1) {
    const phase = step / steps;
    actions.setSwipe(100 * (phase < 0.5 ? 1 - 2 * phase : 2 * phase - 1));
    await sleep(SWIPE_TICK_MS);
  }
  actions.setSwipe(50);
}

const SCRIPT = [
  async (actions, sleep) => {
    actions.showPage('home');
    actions.caption(t('tour.home'));
    await sleep(6000);
  },
  async (actions, sleep) => {
    actions.caption(t('tour.barnard'));
    actions.open('barnard');
    await sleep(500);
    await waitForFrames(actions, sleep);
    actions.setMode('blink');
    actions.setPlaying(!actions.reducedMotion());
    await sleep(8000);
  },
  async (actions, sleep) => {
    actions.caption(t('tour.follow'));
    await actions.setFollow(true);
    await sleep(6000);
    await actions.setFollow(false);
  },
  async (actions, sleep) => {
    actions.caption(t('tour.swipe'));
    actions.setMode('swipe');
    await sweepSwipe(actions, sleep);
    actions.caption(t('tour.side'));
    actions.setMode('side');
    await sleep(6000);
  },
  async (actions, sleep) => {
    actions.caption(t('tour.arrays'));
    actions.open('rdra');
    await sleep(500);
    await waitForFrames(actions, sleep);
    actions.setMode('blink');
    for (const detector of ARRAYS) {
      actions.setBand({ kind: 'detector', detector });
      await sleep(ARRAY_MS);
    }
    actions.setBand({ kind: 'composite' });
    actions.caption(t('tour.caption'));
    await sleep(7000);
  },
  async (actions, sleep) => {
    actions.caption(t('tour.game'));
    actions.showPage('game');
    await sleep(7000);
  },
];

export const isTourRunning = () => Boolean(activeRun);

/** Starts the demo, or stops it if it is already running. */
export async function runTour(actions) {
  if (activeRun) {
    activeRun.stopped = true;
    return;
  }
  const run = { stopped: false };
  activeRun = run;
  actions.started();
  const sleep = sleeper(run);
  try {
    for (const step of SCRIPT) await step(actions, sleep);
  } catch (error) {
    if (!(error instanceof Stopped)) actions.caption(error.message);
  } finally {
    activeRun = null;
    actions.finished();
  }
}

export function stopTour() {
  if (activeRun) activeRun.stopped = true;
}
