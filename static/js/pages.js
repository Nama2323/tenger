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
const CREDITS = ['ack.base-project', 'ack.irsa', 'ack.spherex', 'ack.wise', 'ack.gaia', 'credit.horizons', 'ack.aladin', 'ack.fonts', 'ack.ai'];

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
