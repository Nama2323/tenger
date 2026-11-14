// "Why we missed" section for the Pluto prediction card and the end of its reveal. Every number comes from
// postmortem.json (and, for the comparisons, hindcast-v2.json and the open-forecast files); the section is
// labelled "exploratory, after the reveal" and changes nothing in the trial's status or the scoreboard.
import { chip, el, formatNumber } from './dom.js';
import { t } from './i18n.js';
import { correlatedInflation } from './postmortem.js';
import { mjdToDate } from './stack.js';

const arcsec = (value, digits = 1) => `${formatNumber(value, digits)}″`;
/** Two decimals below 10″, one above (6.04″ × 2.49″, 54.1″ × 1.06″). */
const size = (value) => arcsec(value, Math.abs(value) < 10 ? 2 : 1);
const dateOf = (mjd) => (Number.isFinite(mjd) ? mjdToDate(mjd).toISOString().slice(0, 10) : '—');
const orList = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} ${t('why.or')} ${items.at(-1)}` : items.join(''));

function region(entry) {
  if (Number.isFinite(entry?.along) && Number.isFinite(entry?.across)) return t('why.alongAcross', { along: size(entry.along), across: size(entry.across) });
  const axes = entry?.axes ?? entry?.region;
  if (axes) return t('why.axes', { major: size(axes.major), minor: size(axes.minor) });
  return '—';
}

function points(pm, hindcast) {
  const items = [];
  if (Number.isFinite(pm.observedFromJpl)) items.push(t('why.found', { value: formatNumber(pm.observedFromJpl, 2) }));
  if (Number.isFinite(pm.forecastFromJpl) && Number.isFinite(pm.along)) {
    items.push(t('why.off', {
      jpl: formatNumber(pm.forecastFromJpl, 1), error: formatNumber(pm.error, 1),
      along: formatNumber(pm.along, 1), across: formatNumber(pm.across, 1),
      motion: formatNumber(pm.motion, 1), hours: formatNumber((pm.along / pm.motion) * 24, 1),
    }));
  }
  if (Number.isInteger(pm.groups) && pm.frozenRegion) {
    const values = { n: String(pm.nExposures), groups: String(pm.groups), major: formatNumber(pm.frozenRegion.major, 2), minor: formatNumber(pm.frozenRegion.minor, 2) };
    items.push(t(Number.isInteger(pm.nExposures) ? 'why.causeCount' : 'why.causeGroups', values));
  }
  if (pm.offsets.length && pm.jackknife) {
    items.push(t('why.offsets', {
      offsets: orList(pm.offsets.map((entry) => arcsec(entry.sigma))),
      d2: orList(pm.offsets.map((entry) => formatNumber(entry.d2, 2))),
      major: formatNumber(pm.jackknife.major, 1), minor: formatNumber(pm.jackknife.minor, 1), jd2: formatNumber(pm.jackknife.d2, 2),
    }));
  }
  if (Number.isFinite(pm.frame.heliocentric) && Number.isFinite(pm.frame.barycentric)) {
    items.push(t('why.frame', { helio: formatNumber(pm.frame.heliocentric, 2), bary: formatNumber(pm.frame.barycentric, 2), nbody: formatNumber(pm.frame.nbody, 2) }));
  }
  if (hindcast?.new?.name) items.push(t('why.changed', { method: hindcast.new.name }));
  return items;
}

function hindcastTable(hindcast) {
  if (!hindcast?.old || !hindcast?.new) return null;
  const row = (name, side, result) => el('tr', {}, [
    el('th', { scope: 'row', text: name }),
    el('td', { text: arcsec(side.error, 2) }),
    el('td', { text: region(side) }),
    el('td', { text: formatNumber(side.d2, 2) }),
    el('td', { text: result }),
  ]);
  return el('div', { class: 'table-scroll' }, el('table', { class: 'why-table' }, [
    el('caption', { text: t('why.hindcastTitle') }),
    el('thead', {}, el('tr', {}, ['why.col.method', 'why.col.error', 'why.col.region', 'why.col.d2', 'why.col.result'].map((key) => el('th', { scope: 'col', text: t(key) })))),
    el('tbody', {}, [
      row(t('why.old'), hindcast.old, t(`why.result.${hindcast.old.result === 'hit' ? 'hit' : 'miss'}`)),
      row(t('why.new'), hindcast.new, t(hindcast.new.result === 'hit' ? 'why.result.wouldHit' : 'why.result.wouldMiss')),
    ]),
  ]));
}

function forecastTable(rows) {
  if (rows.length < 2) return null;
  return el('div', { class: 'table-scroll' }, el('table', { class: 'why-table' }, [
    el('caption', { text: t('why.forecastsTitle') }),
    el('thead', {}, el('tr', {}, ['why.col.forecast', 'why.col.for', 'why.col.region'].map((key) => el('th', { scope: 'col', text: t(key) })))),
    el('tbody', {}, rows.map((row) => el('tr', {}, [
      el('th', { scope: 'row', text: t(row.version >= 2 ? 'why.v2' : 'why.v1', { date: (row.frozenUtc ?? '').slice(0, 10) || '—' }) }),
      el('td', { text: dateOf(row.tMjd) }),
      el('td', { text: region(row) }),
    ]))),
  ]));
}

/**
 * The section. data: { postmortem (readPostmortem), hindcast (readHindcast or null), forecasts (forecastRows) }.
 * open: start unfolded (the reveal) or folded (the card).
 */
export function whyWeMissed({ postmortem, hindcast = null, forecasts = [] }, { open = false } = {}) {
  if (!postmortem) return null;
  return el('details', { class: 'why-missed', open }, [
    el('summary', {}, [el('span', { text: t('why.title') }), chip(t('why.chip'), 'chip-exploratory')]),
    el('p', { class: 'note', text: t('why.label') }),
    el('ul', { class: 'why-points' }, points(postmortem, hindcast).map((text) => el('li', { text }))),
    hindcastTable(hindcast),
    hindcast ? el('p', { class: 'note', text: t('why.hindcastNote') }) : null,
    forecastTable(forecasts),
    forecasts.length > 1 ? el('p', { class: 'note', text: t('why.forecastsNote') }) : null,
  ]);
}

/** For Lesson 3: the factor by which treating N grouped detections as independent shrinks the error bar. */
export { correlatedInflation };
