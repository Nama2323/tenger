// Two small dialogs reachable from the top bar on every page: the keyboard shortcuts (also opened with "?")
// and "What TENGER can and can't see". Native <dialog>: focus stays inside, Escape closes, focus returns.
import { $, el } from './dom.js';
import { t } from './i18n.js';
import { limitsNumbers } from './limits.js';
import { readDepth } from './planetx.js';

/** Shortcut groups: [title key, [[keys key, action key], ...]]. Every row is a real handler in the app. */
export const SHORTCUTS = [
  ['keys.group.page', [['keys.k.help', 'keys.a.help'], ['keys.k.escape', 'keys.a.escape'], ['keys.k.tab', 'keys.a.tab']]],
  ['keys.group.viewer', [['keys.k.space', 'keys.a.viewerSpace'], ['keys.k.leftRight', 'keys.a.viewerArrows'], ['keys.k.escape', 'keys.a.viewerEscape']]],
  ['keys.group.game', [['keys.k.arrows', 'keys.a.gameArrows'], ['keys.k.shiftArrows', 'keys.a.gameFast'], ['keys.k.enter', 'keys.a.gameEnter']]],
  ['keys.group.reveal', [['keys.k.nextStep', 'keys.a.revealNext'], ['keys.k.prevStep', 'keys.a.revealBack'], ['keys.k.homeEnd', 'keys.a.revealEnds'], ['keys.k.escape', 'keys.a.revealClose']]],
  ['keys.group.time', [
    ['keys.k.space', 'keys.a.timeSpace'], ['keys.k.leftRight', 'keys.a.timeArrows'], ['keys.k.live', 'keys.a.timeLive'],
    ['keys.k.enter', 'keys.a.flyEnter'], ['keys.k.escape', 'keys.a.flyEscape'],
  ]],
];

/** "It can" (task B19): the dialog and the About page show the same list. */
export const CAN_DO = ['pictures', 'moved', 'positions', 'predict', 'detect', 'forecasts', 'teach', 'search'];
/** "Its limits, and what we do about them": each limit and, on a line starting with "→", what we do about it. */
export const LIMITS_DO = ['planetNine', 'blend', 'saturated', 'proof'];

// Numbers from the data files (limits.js), loaded the first time the list is drawn; until then each sentence is
// shown without its number, never with an invented one.
let numbers = {};
let loading = null;
const hosts = new Set();
const json = (path) => fetch(path).then((response) => (response.ok ? response.json() : null)).catch(() => null);
const count = (value) => new Intl.NumberFormat('en').format(value);

function canText(id) {
  if (id === 'positions' && numbers.gaiaPct !== null && numbers.gaiaPct !== undefined) return t('limits.can.positions', { pct: String(numbers.gaiaPct) });
  if (id === 'positions') return t('limits.can.positionsPlain');
  if (id === 'detect' && numbers.injected) return t('limits.can.detect', { n: count(numbers.injected) });
  if (id === 'detect') return t('limits.can.detectPlain');
  return t(`limits.can.${id}`);
}

function limitText(id) {
  if (id === 'blend' && numbers.blendArcsec) return t('limits.limit.blend', { arcsec: String(numbers.blendArcsec) });
  if (id === 'blend') return t('limits.limit.blendPlain');
  return t(`limits.limit.${id}`);
}

function doText(id) {
  if (id === 'planetNine' && Number.isFinite(numbers.low) && Number.isFinite(numbers.high)) {
    return t(numbers.low === numbers.high ? 'limits.do.planetNineOne' : 'limits.do.planetNine', { low: String(numbers.low), high: String(numbers.high) });
  }
  if (id === 'planetNine') return t('limits.do.planetNinePlain');
  return t(`limits.do.${id}`);
}

function fill(host) {
  host.replaceChildren(
    el('section', { class: 'limits-group can' }, [el('h3', { text: t('limits.canTitle') }), el('ul', {}, CAN_DO.map((id) => el('li', { text: canText(id) })))]),
    el('section', { class: 'limits-group cannot' }, [
      el('h3', { text: t('limits.cannotTitle') }),
      el('ul', { class: 'limits-list' }, LIMITS_DO.map((id) => el('li', {}, [el('p', { text: limitText(id) }), el('p', { class: 'limits-do', text: doText(id) })]))),
    ]),
  );
}

/** Draws the two lists into host (the dialog's body or the About card) and fills in the numbers once loaded. */
export function renderLimits(host) {
  if (!host) return;
  hosts.add(host);
  fill(host);
  loading ??= Promise.all([json('data/barnard/investigation.json'), json('data/planetx/depth.json')]).then(([barnard, depth]) => {
    numbers = limitsNumbers({ barnard, depth: readDepth(depth) });
    for (const each of hosts) fill(each);
  });
}

function keyCaps(text) {
  return el('span', { class: 'keycaps' }, text.split(' ').map((part) => (part === '/' || part === '+' ? el('span', { class: 'key-sep', text: part }) : el('kbd', { text: part }))));
}

function fillShortcuts() {
  // How to search (moved here from under the Home search box, task B12), then the keyboard shortcuts.
  const search = el('section', { class: 'keys-group' }, [el('h3', { text: t('keys.group.search') }), el('p', { class: 'note', text: t('search.help') })]);
  $('shortcuts-body').replaceChildren(search, ...SHORTCUTS.map(([title, rows]) => el('section', { class: 'keys-group' }, [
    el('h3', { text: t(title) }),
    el('dl', {}, rows.flatMap(([keys, action]) => [el('dt', {}, keyCaps(t(keys))), el('dd', { text: t(action) })])),
  ])));
}

function fillLimits() {
  renderLimits($('limits-body'));
}

export function openDialog(id) {
  const dialog = $(id);
  if (!dialog || dialog.open) return;
  if (id === 'shortcuts') fillShortcuts();
  if (id === 'limits') fillLimits();
  dialog.showModal();
}

const typing = (target) => target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));

export function initHelp({ onOpen = () => {} } = {}) {
  for (const button of document.querySelectorAll('[data-dialog]')) {
    button.addEventListener('click', () => {
      onOpen();
      openDialog(button.dataset.dialog);
    });
  }
  for (const dialog of document.querySelectorAll('dialog.sheet')) {
    dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
    // A click on the dimmed backdrop (outside the sheet's box) closes it too.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }
  document.addEventListener('keydown', (event) => {
    const question = event.key === '?' || (event.key === '/' && event.shiftKey);
    if (!question || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
    if (document.querySelector('dialog.sheet[open]')) return;
    event.preventDefault();
    onOpen();
    openDialog('shortcuts');
  });
}
