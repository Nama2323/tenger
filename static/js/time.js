// The clock of the 3D Solar System on Home (task B10): a simulated UTC time, a signed speed in fixed steps, the
// 1900–2050 range used with JPL's approximate planet elements, and "live" (the current time at real speed).
// Pure: callers pass the wall-clock time, so every rule is testable in Node.

/** Speeds, slowest first: seconds of simulated time per second. A month is a twelfth and a year a Julian year. */
export const RATES = [
  { key: 'paused', seconds: 0 },
  { key: 'real', seconds: 1 },
  { key: 'min5', seconds: 300 },
  { key: 'hour', seconds: 3600 },
  { key: 'day', seconds: 86400 },
  { key: 'week', seconds: 7 * 86400 },
  { key: 'month', seconds: 365.25 * 86400 / 12 },
  { key: 'year', seconds: 365.25 * 86400 },
];
export const MAX_STEP = RATES.length - 1;
/** Steps run from -MAX_STEP (fastest backward) through 0 (paused) to +MAX_STEP; +1 is real time. */
export const REAL_TIME_STEP = 1;
/** 1900-01-01 to 2050-01-01 UTC: inside the 1800–2050 validity of JPL's approximate elements (Standish, Table 1). */
export const RANGE_MS = [Date.UTC(1900, 0, 1), Date.UTC(2050, 0, 1)];
/** Within this of the wall clock, at real speed, the clock counts as live. */
const LIVE_TOLERANCE_MS = 1000;

export const clampStep = (step) => Math.max(-MAX_STEP, Math.min(MAX_STEP, Math.round(Number(step) || 0)));
/** Simulated seconds per second for a step (negative = backward). */
export const rateSeconds = (step) => Math.sign(step) * RATES[Math.abs(clampStep(step))].seconds;
/** The rate's key and direction, for the label ("1 month/s", "-1 day/s"). */
export const rateOf = (step) => ({ key: RATES[Math.abs(clampStep(step))].key, backward: clampStep(step) < 0 });
const clampTime = (ms) => Math.max(RANGE_MS[0], Math.min(RANGE_MS[1], ms));

/**
 * A clock at `wallMs`. Live at real speed by default; paused at the current time with reduced motion (it then
 * moves only when the visitor asks). Methods take the wall-clock time of the action.
 */
export function createClock({ wallMs, reducedMotion = false }) {
  let anchorWall = wallMs;
  let anchorSim = clampTime(wallMs);
  let step = reducedMotion ? 0 : REAL_TIME_STEP;
  let lastMoving = REAL_TIME_STEP;
  let limit = null;

  /** The simulated time at `at`, stopping (and pausing) at the ends of the range. */
  function now(at) {
    const sim = anchorSim + (at - anchorWall) * rateSeconds(step);
    // Only travel outward stops: from an end the clock may still move back into the range.
    const past = step > 0 ? sim >= RANGE_MS[1] : step < 0 ? sim <= RANGE_MS[0] : false;
    if (past) {
      limit = step > 0 ? 'end' : 'start';
      anchorSim = clampTime(sim);
      anchorWall = at;
      step = 0;
      return anchorSim;
    }
    return clampTime(sim);
  }

  function setStep(next, at) {
    anchorSim = now(at);
    anchorWall = at;
    step = clampStep(next);
    if (step !== 0) {
      lastMoving = step;
      // Moving away from an end clears its note; pushing on against it stops again at once.
      if ((limit === 'end' && step < 0) || (limit === 'start' && step > 0)) limit = null;
    }
    now(at);
  }

  return {
    now,
    setStep,
    step: () => step,
    stepBy: (delta, at) => setStep(step + delta, at),
    /** Space: pause, or play again at the last speed (real time if there was none). */
    toggle(at) {
      if (step === 0) setStep(lastMoving, at);
      else setStep(0, at);
    },
    /** LIVE: the current time at real speed. */
    goLive(at) {
      anchorWall = at;
      anchorSim = clampTime(at);
      step = REAL_TIME_STEP;
      lastMoving = REAL_TIME_STEP;
      limit = null;
    },
    isLive: (at) => step === REAL_TIME_STEP && Math.abs(now(at) - at) < LIVE_TOLERANCE_MS,
    moving: () => step !== 0,
    /** 'start' or 'end' after the clock stopped at an end of the range, else null. */
    limit: () => limit,
  };
}

/** "2026-11-15 07:42:10" (UTC) for a time in ms. */
export const formatClock = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
