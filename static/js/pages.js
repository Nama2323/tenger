// About: data sources, methods, credits and fonts. (The game is in game-ui.js, lessons in learn-ui.js.)
import { $, el } from './dom.js';
import { t } from './i18n.js';

const ABOUT_DATA = ['about.data.spherex', 'about.data.allwise', 'about.data.gaia'];
const ABOUT_METHODS = [
  'about.methods.grid', 'about.methods.legacy', 'about.methods.difference',
  'about.methods.trials', 'about.methods.map', 'about.methods.reserved',
];
const CREDITS = ['ack.base-project', 'ack.irsa', 'ack.spherex', 'ack.wise', 'ack.gaia', 'credit.horizons', 'ack.aladin', 'ack.ai'];
/** Self-hosted fonts and their licence files (static/fonts/README.md). */
const FONTS = [
  { key: 'font.spaceGrotesk', family: 'Space Grotesk', licence: 'fonts/OFL-SpaceGrotesk.txt', class: 'font-head' },
  { key: 'font.inter', family: 'Inter', licence: 'fonts/OFL-Inter.txt', class: 'font-text' },
  { key: 'font.jetbrainsMono', family: 'JetBrains Mono', licence: 'fonts/OFL-JetBrainsMono.txt', class: 'font-mono' },
];

export function renderAbout() {
  $('about-data').replaceChildren(...ABOUT_DATA.map((key) => el('li', { text: t(key) })));
  $('about-methods').replaceChildren(...ABOUT_METHODS.map((key) => el('li', { text: t(key) })));
  $('about-credits').replaceChildren(...CREDITS.map((key) => el('li', { text: t(key) })));
  $('about-fonts').replaceChildren(...FONTS.map((font) => el('li', {}, [
    el('strong', { class: font.class, text: font.family }),
    el('span', { text: t(font.key) }),
    el('a', { href: font.licence, text: t('font.licence') }),
  ])));
}
