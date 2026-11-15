// The "Fly to" list, Escape and the Planet Nine explanation of the 3D Home scene (task B11). Loaded with the 3D view.
// The scene (space3d.js) flies and follows; this module runs the page controls around it.
import { $, el, prefersReducedMotion } from './dom.js';

const HOVER_OPEN_MS = 200;
const HOVER_CLOSE_MS = 350;

const editable = (node) => node instanceof Element && Boolean(node.closest('input:not([type="range"]), select, textarea, [contenteditable="true"]'));

/** Starts the controls for a 3D controller. Returns { nine(kind), dispose }. */
export function createFocusControl({ controller }) {
  const fly = $('space-fly');
  const summary = fly.querySelector('summary');
  const list = $('space-fly-list');
  const key = $('map-key');
  const nineKey = $('space-nine-key');
  const nineBox = $('space-nine');

  // ---------- Fly to: Tab to it, Enter opens the list, Enter on a body flies there ----------
  list.replaceChildren(...controller.focusKeys().map((body) => el('button', { type: 'button', class: 'quiet', dataset: { key: body }, text: controller.nameOf(body) })));
  const closeList = ({ focus = false } = {}) => {
    fly.open = false;
    if (focus) summary.focus({ preventScroll: true });
  };
  const onList = (event) => {
    const button = event.target.closest('button[data-key]');
    if (!button) return;
    controller.focus(button.dataset.key);
    closeList({ focus: true });
  };
  const onOutside = (event) => {
    if (fly.open && !fly.contains(event.target)) closeList();
  };

  // ---------- Planet Nine: shown in the colour key while pointed at, or until clicked again ----------
  $('space-nine-text').textContent = controller.nineText;
  let shown = false;
  let pinned = false;
  let hovering = false;
  let keyWasOpen = false;
  let timer = 0;

  function show(open, { scroll = false } = {}) {
    clearTimeout(timer);
    if (open !== shown) {
      shown = open;
      if (open) {
        keyWasOpen = key.open;
        key.open = true;
      } else if (!keyWasOpen) {
        key.open = false;
      }
      nineBox.hidden = !open;
      nineKey.setAttribute('aria-expanded', String(open));
      controller.highlightNine(open);
    }
    // On phones the colour key sits under the scene: bring the explanation into view after a tap.
    if (open && scroll && matchMedia('(max-width: 900px)').matches) {
      nineBox.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
  }

  /** From the scene: 'enter' / 'leave' (pointer over the ring or its label), 'click', 'away' (a click elsewhere). */
  function nine(kind, { fromKey = false } = {}) {
    if (kind === 'enter') {
      hovering = true;
      clearTimeout(timer);
      timer = setTimeout(() => show(true), fromKey ? 0 : HOVER_OPEN_MS);
    } else if (kind === 'leave') {
      hovering = false;
      clearTimeout(timer);
      timer = setTimeout(() => show(pinned), HOVER_CLOSE_MS);
    } else if (kind === 'click') {
      pinned = !pinned;
      show(pinned, { scroll: pinned && !fromKey });
    } else if (kind === 'away' && pinned) {
      pinned = false;
      show(false);
    }
  }
  const onKeyEnter = () => nine('enter', { fromKey: true });
  const onKeyLeave = () => nine('leave', { fromKey: true });
  const onKeyClick = () => nine('click', { fromKey: true });
  // Closing the colour key closes the explanation with it. Either panel opening or closing moves labels.
  const onFlyToggle = () => controller.relayout();
  const onKeyToggle = () => {
    controller.relayout();
    if (!key.open && shown) {
      pinned = false;
      keyWasOpen = false;
      show(false);
    }
  };

  // ---------- Escape: closes the list, then the explanation, then flies the camera home ----------
  // Capture phase: it runs before the page's own Escape (which closes an open investigation first).
  const onKey = (event) => {
    if (event.key !== 'Escape' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (document.body.dataset.page !== 'home' || document.querySelector('dialog[open]')) return;
    if (fly.open) {
      event.preventDefault();
      closeList({ focus: true });
      return;
    }
    if (pinned || shown) {
      pinned = false;
      show(false);
      return;
    }
    if (editable(event.target) || $('site-nav')?.classList.contains('open')) return;
    controller.reset();
  };

  list.addEventListener('click', onList);
  document.addEventListener('click', onOutside);
  document.addEventListener('keydown', onKey, true);
  nineKey.addEventListener('pointerenter', onKeyEnter);
  nineKey.addEventListener('pointerleave', onKeyLeave);
  nineKey.addEventListener('click', onKeyClick);
  key.addEventListener('toggle', onKeyToggle);
  fly.addEventListener('toggle', onFlyToggle);

  return {
    nine,
    dispose() {
      clearTimeout(timer);
      if (shown) show(false);
      closeList();
      list.replaceChildren();
      list.removeEventListener('click', onList);
      document.removeEventListener('click', onOutside);
      document.removeEventListener('keydown', onKey, true);
      nineKey.removeEventListener('pointerenter', onKeyEnter);
      nineKey.removeEventListener('pointerleave', onKeyLeave);
      nineKey.removeEventListener('click', onKeyClick);
      key.removeEventListener('toggle', onKeyToggle);
      fly.removeEventListener('toggle', onFlyToggle);
    },
  };
}
