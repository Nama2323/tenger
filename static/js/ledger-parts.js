// Small pieces shared by the Predictions page (ledger-ui.js) and the reveal (reveal.js): status and label chips,
// the freeze receipt line, dates and the raw residual table. Every text comes from the English resource.
import { chip, el, formatNumber, formatUtc } from './dom.js';
import { has, t } from './i18n.js';
import { categoryLabel } from './labels.js';
import { commitInfo } from './ledger.js';
import { mjdToDate } from './stack.js';

export const dateOfMjd = (mjd) => (Number.isFinite(mjd) ? formatUtc(mjdToDate(mjd), { time: false }) : '—');

/** "2026-11-14 12:06 UTC" from an ISO string, or a dash. */
export function utcText(iso) {
  const date = typeof iso === 'string' ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? `${formatUtc(date)} UTC` : '—';
}

/** Short status chip for the ledger (the long trial.* text stays in the Prediction panel and the game). */
export function statusChip(status) {
  if (!status) return chip(t('ledger.status.none'), 'chip-trial-none');
  const key = `ledger.status.${status}`;
  return chip(has(key) ? t(key) : String(status), `chip-trial chip-trial-${status}`);
}

/** Every category label of a trial, the most limiting (its category) first. */
export const labelChips = (labels) => labels.map((label) => chip(categoryLabel(label), `chip-category-${label}`));

/** "Frozen in git <short sha> on <UTC>", linking to the commit when it is a real one. */
export function receiptLine(receiptResult) {
  const info = commitInfo(receiptResult);
  if (!info) {
    const text = receiptResult?.state && receiptResult.state !== 'missing' ? t(`state.${receiptResult.state}`) : t('ledger.noReceipt');
    return el('p', { class: 'receipt-line muted', text });
  }
  if (info.example) return el('p', { class: 'receipt-line' }, [t('ledger.frozenExample', { utc: utcText(info.utc) })]);
  if (!info.short) return el('p', { class: 'receipt-line' }, [t('ledger.frozenNoSha', { utc: utcText(info.utc) })]);
  return el('p', { class: 'receipt-line' }, [
    `${t('ledger.frozenPrefix')} `,
    info.url
      ? el('a', { href: info.url, class: 'sha', target: '_blank', rel: 'noopener', text: info.short })
      : el('code', { class: 'sha', text: info.short }),
    ` ${t('ledger.frozenOn', { utc: utcText(info.utc) })}`,
  ]);
}

const arcsec = (value) => (Number.isFinite(value) ? `${formatNumber(value, Math.abs(value) >= 100 ? 1 : 2)}″` : '—');
const distance = (residual) => (Number.isFinite(residual?.d2) && residual.d2 >= 0 ? formatNumber(Math.sqrt(residual.d2), 2) : '—');

/**
 * The raw residuals of the model and the straight-line baseline, exactly as verification.json gives them
 * (observed minus predicted), with D = √d² for a position test. limit: √threshold, for the caption.
 */
export function residualTable(residuals, { position = true, limit = null, unit = '', caption = true } = {}) {
  const rows = [['model', residuals?.model], ['baseline', residuals?.baseline]].filter(([, residual]) => residual);
  if (!rows.length) return null;
  const columns = position
    ? [t('ledger.col.prediction'), t('ledger.col.east'), t('ledger.col.north'), t('ledger.col.error'), t('ledger.col.distance')]
    : [t('ledger.col.prediction'), t('ledger.col.error'), t('ledger.col.z')];
  const cells = (residual) => (position
    ? [arcsec(residual.east_arcsec), arcsec(residual.north_arcsec), arcsec(residual.error_arcsec), distance(residual)]
    : [Number.isFinite(residual.error) ? `${formatNumber(residual.error, 2)} ${unit}`.trim() : '—', Number.isFinite(residual.z) ? formatNumber(Math.abs(residual.z), 2) : '—']);
  return el('div', { class: 'table-scroll' }, el('table', { class: 'residual-table' }, [
    caption ? el('caption', { text: position && Number.isFinite(limit) ? t('ledger.residualsPosition', { limit: formatNumber(limit, 2) }) : t('ledger.residualsValue') }) : null,
    el('thead', {}, el('tr', {}, columns.map((column) => el('th', { scope: 'col', text: column })))),
    el('tbody', {}, rows.map(([who, residual]) => el('tr', { class: `row-${who}` }, [
      el('th', { scope: 'row', text: t(`ledger.who.${who}`) }),
      ...cells(residual).map((cell) => el('td', { text: cell })),
    ]))),
  ]));
}
