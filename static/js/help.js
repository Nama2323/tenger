// Two small dialogs reachable from the top bar on every page: the keyboard shortcuts (also opened with "?")
// and "What TENGER can and can't see". Native <dialog>: focus stays inside, Escape closes, focus returns.
import { $, el } from './dom.js';
import { t } from './i18n.js';

/** Shortcut groups: [title key, [[keys key, action key], ...]]. Every row is a real handler in the app. */
export const SHORTCUTS = [
  ['keys.group.page', [['keys.k.help', 'keys.a.help'], ['keys.k.escape', 'keys.a.escape'], ['keys.k.tab', 'keys.a.tab']]],
  ['keys.group.viewer', [['keys.k.space', 'keys.a.viewerSpace'], ['keys.k.leftRight', 'keys.a.viewerArrows'], ['keys.k.escape', 'keys.a.viewerEscape']]],
  ['keys.group.game', [['keys.k.arrows', 'keys.a.gameArrows'], ['keys.k.shiftArrows', 'keys.a.gameFast'], ['keys.k.enter', 'keys.a.gameEnter']]],
  ['keys.group.reveal', [['keys.k.nextStep', 'keys.a.revealNext'], ['keys.k.prevStep', 'keys.a.revealBack'], ['keys.k.homeEnd', 'keys.a.revealEnds'], ['keys.k.escape', 'keys.a.revealClose']]],
];

export const CAN_SEE = ['limits.can.images', 'limits.can.changes', 'limits.can.positions', 'limits.can.anywhere'];
export const CANNOT_SEE = [
  'limits.cannot.pixel', 'limits.cannot.saturated', 'limits.cannot.crossBand', 'limits.cannot.planetNine',
  'limits.cannot.comet', 'limits.cannot.future', 'limits.cannot.proof',
];

function keyCaps(text) {
  return el('span', { class: 'keycaps' }, text.split(' ').map((part) => (part === '/' || part === '+' ? el('span', { class: 'key-sep', text: part }) : el('kbd', { text: part }))));
}

function fillShortcuts() {
  $('shortcuts-body').replaceChildren(...SHORTCUTS.map(([title, rows]) => el('section', { class: 'keys-group' }, [
    el('h3', { text: t(title) }),
    el('dl', {}, rows.flatMap(([keys, action]) => [el('dt', {}, keyCaps(t(keys))), el('dd', { text: t(action) })])),
  ])));
}

function fillLimits() {
  $('limits-body').replaceChildren(
    el('section', { class: 'limits-group can' }, [el('h3', { text: t('limits.canTitle') }), el('ul', {}, CAN_SEE.map((key) => el('li', { text: t(key) })))]),
    el('section', { class: 'limits-group cannot' }, [el('h3', { text: t('limits.cannotTitle') }), el('ul', {}, CANNOT_SEE.map((key) => el('li', { text: t(key) })))]),
  );
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
