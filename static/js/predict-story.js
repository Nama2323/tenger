// Task B15: the Predictions page told as a story for a first-time visitor. This module only reads the published
// files (scoreboard.json, the trial files and the asteroid batch) and returns plain data and the visible sentences;
// ledger-ui.js draws them. No number is typed here: every value comes from the files, rounded for display.
import { formatNumber } from './dom.js';
import { t } from './i18n.js';

/** Words that belong to the detailed record: on the Predictions page they appear only inside a closed "Details". */
export const DETAILS_ONLY_WORDS = ['D²', 'retrospective', 'prospective', 'catalogue-assisted', 'trial type'];

/** A "just outside" miss: the distance is at most this many times the 95% limit. */
const JUST_OUTSIDE = 1.5;

const finite = Number.isFinite;
const okDoc = (result) => (result?.state === 'ok' ? result.doc : null);

/** "5.9″", "6.5″", "1.52″", "0.08″": two decimals below 2″, one above; degrees from 1° up ("5.5°"). */
export function shortAngle(arcsec) {
  if (!finite(arcsec)) return '—';
  if (Math.abs(arcsec) >= 3600) return `${formatNumber(arcsec / 3600, 1)}°`;
  return `${formatNumber(arcsec, Math.abs(arcsec) < 2 ? 2 : 1)}″`;
}

/** "3,000" for a ratio of 3,368: the largest round number the ratio is over (thousands, hundreds or tens). */
export function overRatio(ratio) {
  if (!finite(ratio) || ratio < 2) return null;
  const step = ratio >= 1000 ? 1000 : ratio >= 100 ? 100 : ratio >= 10 ? 10 : 1;
  return new Intl.NumberFormat('en').format(Math.floor(ratio / step) * step);
}

/** "1 October 2026" from an MJD (UTC). */
export function longDate(mjd) {
  if (!finite(mjd)) return '—';
  const date = new Date(Date.UTC(1858, 10, 17) + mjd * 86400000);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

const monthOf = (mjd) => new Date(Date.UTC(1858, 10, 17) + mjd * 86400000);

/** "April and September" (English list) from MJDs, in time order, each month once. */
function monthList(mjds) {
  const months = [];
  for (const mjd of [...mjds].sort((a, b) => a - b)) {
    const name = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(monthOf(mjd));
    if (!months.includes(name)) months.push(name);
  }
  return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(months);
}

/** "345 Tercidina" from "345 Tercidina (A892 WB)". */
export const asteroidName = (name) => String(name ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim();

/** Mahalanobis distance and the 95% limit of a verification file's model residual (null when absent). */
function distanceOf(verification, trial) {
  const d2 = verification?.residuals?.model?.d2;
  const limit2 = trial?.scoring?.threshold_d2;
  return finite(d2) && d2 >= 0 && finite(limit2) && limit2 > 0 ? { d: Math.sqrt(d2), limit: Math.sqrt(limit2) } : null;
}

/**
 * The page's story from the loaded files.
 * board: scoreboard.json; bundles: the ledger's trial bundles ({ id, trial, prediction, receipt, verification } as
 * contract.js returns them); batch: the asteroid batch file (raw JSON) or null.
 */
export function storyModel({ board, bundles = [], batch = null }) {
  const bundleOf = (id) => bundles.find((bundle) => bundle?.id === id) ?? null;
  const rows = Array.isArray(board?.rows) ? board.rows : [];
  const item = (row) => {
    const bundle = bundleOf(row.trial_id);
    const trial = okDoc(bundle?.trial);
    const labels = Array.isArray(trial?.labels) ? trial.labels : [row.category];
    return {
      id: row.trial_id,
      kind: 'trial',
      targetKey: row.target_key,
      category: row.category,
      status: row.status,
      errorArcsec: row.model_error_arcsec,
      baselineArcsec: row.baseline_error_arcsec,
      distance: distanceOf(okDoc(bundle?.verification), trial),
      pending: row.confirmation_pending === true || trial?.confirmation_pending === true,
      gaia: labels.includes('catalogue_assisted'),
      bundle,
    };
  };
  const scored = (row) => row.status === 'hit' || row.status === 'miss';
  const real = rows.filter((row) => row.category === 'prospective_unexposed' && scored(row)).map(item);
  const practice = rows.filter((row) => row.category === 'retrospective_holdout' && scored(row)).map(item);
  const untestedTargets = rows.filter((row) => !scored(row)).map((row) => {
    const bundle = bundleOf(row.trial_id);
    const prediction = okDoc(bundle?.prediction);
    const verification = okDoc(bundle?.verification);
    return { id: row.trial_id, targetKey: row.target_key, status: row.status, reasonKey: verification?.status_reason_key ?? prediction?.status_reason_key ?? row.status_reason_key ?? null };
  });

  // The asteroid batch: its scored hits join the real tests; the rest could not be tested.
  const batchBlock = board?.asteroid_batch ?? null;
  const batchRows = Array.isArray(batchBlock?.rows) ? batchBlock.rows : [];
  const pendingBatch = batchBlock?.team_statement_pending === true || batch?.team_statement_pending === true;
  for (const row of batchRows.filter(scored)) {
    real.push({
      id: row.trial_id, kind: 'asteroid', name: asteroidName(row.target_name), category: row.category, status: row.status,
      errorArcsec: row.model_error_arcsec, baselineArcsec: row.baseline_error_arcsec,
      distance: null,
      pending: pendingBatch || row.team_statement_pending === true, gaia: false, bundle: null,
    });
  }
  const untestedAsteroids = batchRows.filter((row) => !scored(row)).map((row) => ({
    id: row.trial_id, name: asteroidName(row.target_name), status: row.status, reasonKey: row.status_reason_key ?? null,
  }));
  const calibration = batchBlock?.calibration ?? null;
  const asteroids = batchRows.length ? {
    n: batchRows.length,
    checked: finite(calibration?.n) ? calibration.n : batchRows.filter(scored).length,
    hits: finite(calibration?.k_inside) ? calibration.k_inside : batchRows.filter((row) => row.status === 'hit').length,
    pending: pendingBatch,
  } : null;

  // Open Pluto forecasts made with the fixed method (v2): the months they can be checked.
  const open = Array.isArray(board?.open_forecasts) ? board.open_forecasts : [];
  const later = open.map(bundleOf).filter(Boolean).map((bundle) => ({ id: bundle.id, trial: okDoc(bundle.trial) }))
    .filter(({ trial }) => trial?.target_key === 'pluto' && finite(trial?.holdout?.t_mjd));
  const fixed = later.filter(({ id }) => /-v2/.test(id));
  const chosen = (fixed.length ? fixed : later).map(({ trial }) => trial.holdout.t_mjd);
  const check2027 = chosen.length
    ? { targetKey: 'pluto', months: monthList(chosen), year: monthOf(Math.min(...chosen)).getUTCFullYear(), mjds: chosen }
    : null;

  const reveal = real.find((entry) => entry.targetKey === 'pluto' && entry.kind === 'trial') ?? null;
  return { real, practice, untested: { targets: untestedTargets, asteroids: untestedAsteroids }, asteroids, check2027, plutoTrialId: reveal?.id ?? null };
}

/** The one-sentence result of a story item ("Miss. 5.9″ from our forecast, ..."). */
export function itemSentence(entry, { practice = false } = {}) {
  const error = shortAngle(entry.errorArcsec);
  if (practice) return t(entry.status === 'hit' ? 'story.practice.hit' : 'story.practice.miss', { error });
  if (entry.status === 'hit') return t('story.real.hit', { error });
  const just = entry.distance && entry.distance.d <= entry.distance.limit * JUST_OUTSIDE;
  const ratio = finite(entry.baselineArcsec) && finite(entry.errorArcsec) && entry.errorArcsec > 0 ? entry.baselineArcsec / entry.errorArcsec : null;
  const over = overRatio(ratio);
  const miss = t(just ? 'story.real.missJust' : 'story.real.miss', { error });
  return over ? `${miss} ${t('story.real.baselineWorse', { baseline: shortAngle(entry.baselineArcsec), times: over })}` : miss;
}

/** Display name of a story item. nameOf(key) maps a target key to its name. */
export const itemName = (entry, nameOf) => (entry.kind === 'asteroid' ? t('story.asteroidName', { name: entry.name }) : nameOf(entry.targetKey));

/** The chip of a story item: "Real test" or "Practice run" (the category's long name stays in Details). */
export const storyChipKey = (category) => (category === 'prospective_unexposed' ? 'story.chip.real' : category === 'retrospective_holdout' ? 'story.chip.practice' : null);

/**
 * Every sentence the story shows outside a "Details" (headings, chips, results, notes, buttons), in page order.
 * The page draws exactly these strings, and the tests read them to check words and numbers.
 */
export function visibleStory(model, nameOf) {
  const out = [];
  const add = (...texts) => out.push(...texts.filter((text) => typeof text === 'string' && text));
  add(t('story.results.title'));
  const group = (titleKey, entries, practice) => {
    if (!entries.length) return;
    add(t(titleKey));
    for (const entry of entries) {
      add(itemName(entry, nameOf), t(`ledger.status.${entry.status}`), storyChipKey(entry.category) ? t(storyChipKey(entry.category)) : null, itemSentence(entry, { practice }));
      if (entry.pending) add(t('story.pending'));
      if (entry.kind === 'trial') add(t('story.investigate', { name: nameOf(entry.targetKey) }));
      if (entry.kind === 'trial' && entry.targetKey === 'pluto') add(t('loop.link'));
    }
  };
  group('story.results.real', model.real, false);
  group('story.results.practice', model.practice, true);
  add(untestedLine(model));
  if (model.asteroids) add(...asteroidLines(model.asteroids));
  if (model.check2027) add(...checkLines(model.check2027, nameOf));
  return out;
}

export const untestedLine = (model) => t('story.untested', { targets: String(model.untested.targets.length), asteroids: String(model.untested.asteroids.length) });

export function asteroidLines(asteroids) {
  const rest = asteroids.n - asteroids.checked;
  const lead = asteroids.checked === 1 && asteroids.hits === 1
    ? t('story.asteroids.oneHit', { rest: String(rest) })
    : t('story.asteroids.lead', { checked: String(asteroids.checked), hits: String(asteroids.hits), rest: String(rest) });
  return [t('story.asteroids.title', { n: String(asteroids.n) }), lead];
}

export const checkLines = (check, nameOf) => [t('story.check.title', { year: String(check.year) }), t('story.check.text', { name: nameOf(check.targetKey), months: check.months, year: String(check.year) })];
