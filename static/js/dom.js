// Small DOM helpers shared by the TENGER pages.
import { t } from './i18n.js';

export const $ = (id) => document.getElementById(id);

/** Creates an element. props: class, text, dataset, on<event>, other attributes; children may nest. */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  const list = [children].flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false);
  node.append(...list);
  return node;
}

/** A labelled pill, e.g. a status or a content type. */
export const chip = (text, kind = '') => el('span', { class: `chip ${kind}`.trim(), text });

/** "2025-08-15 20:45 UTC" style: unambiguous for observation times. */
export function formatUtc(date, { time = true } = {}) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  const iso = date.toISOString();
  return time ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

const SYMBOL_UNITS = new Set(['arcsec', 'arcmin', 'deg']);

/** A number with its unit from the resource file: symbols stick to the number (1.2″), words get a space. */
export function withUnit(value, unit, digits = 2) {
  const number = formatNumber(value, digits);
  if (!unit || number === '—') return number;
  const label = t(`unit.${unit}`);
  return SYMBOL_UNITS.has(unit) ? `${number}${label}` : `${number} ${label}`;
}

export function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** Chart data as a real table inside a disclosure, so the numbers are readable without the picture. */
export function dataTable({ caption, columns, rows, summary = t('table.show') }) {
  const head = el('tr', {}, columns.map((column) => el('th', { scope: 'col', text: column })));
  const body = rows.map((row) => el('tr', {}, row.map((cell) => el('td', { text: cell }))));
  return el('details', { class: 'data-table' }, [
    el('summary', { text: summary }),
    el('div', { class: 'table-scroll' }, el('table', {}, [
      caption ? el('caption', { text: caption }) : null,
      el('thead', {}, head),
      el('tbody', {}, body),
    ])),
  ]);
}

/** A two-column list of facts (label, value). */
export function factList(pairs, className = 'facts') {
  return el('dl', { class: className }, pairs.filter(Boolean).flatMap(([label, value]) => [
    el('dt', { text: label }),
    el('dd', {}, value instanceof Node ? value : String(value)),
  ]));
}

export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
