// Trial labels shared by the Prediction panel, the game and (later) the scoreboard, so a trial reads the
// same everywhere: category, status, "counts as prospective" and the example stamp.
import { chip } from './dom.js';
import { has, t } from './i18n.js';

export const categoryLabel = (category) => (has(`category.${category}`) ? t(`category.${category}`) : String(category ?? '—'));
export const categoryNote = (category) => (has(`category.${category}.note`) ? t(`category.${category}.note`) : '');
/** The full name of a trial type for the "what the trial types mean" lists, e.g. "Blind (prospective, unexposed)". */
export const categoryTerm = (category) => (has(`category.${category}.term`) ? t(`category.${category}.term`) : categoryLabel(category));
export const categoryChip = (category) => chip(categoryLabel(category), `chip-category-${category}`);
export const trialStatusChip = (status) => chip(has(`trial.${status}`) ? t(`trial.${status}`) : String(status ?? '—'), `chip-trial-${status}`);
export const exampleChip = (doc) => (doc?.example ? chip(t('example.tag'), 'chip-example') : null);

/** From a scoreboard row only: the page never decides on its own whether a trial counts as prospective. */
export function prospectiveChip(row) {
  if (!row) return null;
  return chip(t(row.counts_as_prospective ? 'score.counts' : 'score.notCounted'), row.counts_as_prospective ? 'chip-trial-hit' : '');
}
