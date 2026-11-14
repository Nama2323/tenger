// Beat the physics, Learn (with the Planet X Lab) and About. In this build the game and lessons show
// what is published in the site index and honest "not published yet" states; they never invent rounds.
import { $, chip, el } from './dom.js';
import { t, tData } from './i18n.js';

const LESSONS = ['distance', 'brightness', 'sure'];
const ABOUT_DATA = ['about.data.spherex', 'about.data.allwise', 'about.data.gaia'];
const ABOUT_METHODS = [
  'about.methods.grid', 'about.methods.legacy', 'about.methods.difference',
  'about.methods.trials', 'about.methods.map', 'about.methods.reserved',
];
const CREDITS = ['credit.base-project', 'credit.irsa', 'credit.spherex', 'credit.wise', 'credit.gaia', 'credit.aladin', 'credit.fonts', 'credit.ai'];

/** rounds: contract load results of game/<round_id>.json. */
export function renderGame(rounds) {
  const usable = rounds.filter((round) => round.state === 'ok');
  if (!usable.length) {
    $('game-rounds').replaceChildren(el('p', { class: 'panel-note', text: t('game.waiting') }));
    return;
  }
  $('game-rounds').replaceChildren(el('ul', { class: 'cards-list' }, usable.map(({ doc }) => el('li', { class: 'page-card' }, [
    el('h3', { text: t('game.round', { id: doc.round_id }) }),
    el('p', { class: 'stamps' }, [
      doc.example ? chip(t('example.tag'), 'chip-example') : null,
      chip(t(`category.${doc.category}`), `chip-category-${doc.category}`),
    ]),
    el('p', { text: t(`quantity.${doc.quantity}`) }),
    el('p', { class: 'panel-note', text: t('game.soon') }),
  ]))));
}

/** lessons: contract load results of lessons/<lesson_id>.json, matched to the three planned lessons. */
export function renderLearn(lessons) {
  const published = new Map(lessons.filter((lesson) => lesson.state === 'ok').map(({ doc }) => [doc.lesson_id, doc]));
  $('lesson-list').replaceChildren(...LESSONS.map((id) => {
    const doc = published.get(id);
    return el('li', { class: 'page-card' }, [
      el('h3', { text: doc ? tData(doc.title_key, 'explain.unknown') : t(`lesson.${id}.title`) }),
      el('p', { text: t(`lesson.${id}.text`) }),
      el('p', { class: 'stamps' }, doc?.example ? chip(t('example.tag'), 'chip-example') : null),
      el('p', { class: 'panel-note', text: t('learn.preparing') }),
    ]);
  }));
}

export function renderAbout() {
  $('about-data').replaceChildren(...ABOUT_DATA.map((key) => el('li', { text: t(key) })));
  $('about-methods').replaceChildren(...ABOUT_METHODS.map((key) => el('li', { text: t(key) })));
  $('about-credits').replaceChildren(...CREDITS.map((key) => el('li', { text: t(key) })));
}
