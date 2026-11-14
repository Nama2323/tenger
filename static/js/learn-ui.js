// Learn: three printable lessons and the Planet X Lab. Numbers come from lessons.js (tested); text, formulas
// (MathML) and labels come from the English resource. Lesson records (DATA-CONTRACT §12) replace the
// synthetic practice values automatically once Session A publishes them.
import { $, chip, el, formatNumber, prefersReducedMotion, unitSuffix, withUnit } from './dom.js';
import { has, t, tData } from './i18n.js';
import { categoryLabel } from './labels.js';
import { LESSONS, planetModel, readLessonRecord, scoreboardSummary, syntheticLesson } from './lessons.js';
import { correlatedInflation } from './postmortem.js';
import { measuredPanel } from './planetx-ui.js';
import { lessonBatchSection } from './batch-ui.js';

const LAB = 'lab';
const LAB_DEFAULTS = { distanceAu: 500, diameterKm: 20000, albedo: 0.4 };
const LAB_RANGES = {
  distanceAu: { min: 200, max: 1200, step: 10 },
  diameterKm: { min: 5000, max: 60000, step: 500 },
  albedo: { min: 0.05, max: 0.8, step: 0.01 },
};
const LESSON_MINUTES = { distance: 45, brightness: 45, sure: 50 };

let context = { records: new Map(), scoreboard: null, nameOf: (key) => key, onNavigate: () => {} };
let view = null;
let lab = { ...LAB_DEFAULTS };

const unitText = (unit) => (unit && has(`unit.${unit}`) ? t(`unit.${unit}`) : unit);
const valueText = (value, unit, digits) => {
  if (!Number.isFinite(value)) return '—';
  const places = digits ?? (Math.abs(value) >= 100 || Number.isInteger(value) ? 0 : Math.abs(value) >= 10 ? 1 : 2);
  return unit ? withUnit(value, unit, places) : formatNumber(value, places);
};

/** A record's number to at most four significant figures, without trailing zeros: 4.086182 → "4.086", 0.064 → "0.064". */
const SIG4 = new Intl.NumberFormat('en', { maximumSignificantDigits: 4 });
export const sig4 = (value) => (Number.isFinite(value) ? SIG4.format(value) : '—');
const sig4Unit = (value, unit) => (Number.isFinite(value) ? `${sig4(value)}${unitSuffix(unit)}` : '—');

/**
 * Input values as template parameters. The web's own example templates take the unit from the value
 * ({baseline_au} becomes "1 au"); Session A's record templates write the unit in the sentence ("{days} days"),
 * so record values are bare numbers to four significant figures.
 */
export function inputParams(inputs, { bare = false } = {}) {
  return Object.fromEntries(inputs.map((input) => [input.name, bare
    ? sig4(input.value)
    : valueText(input.value, input.unit, String(input.value).split('.')[1]?.length ?? 0)]));
}

/** True when every {placeholder} of a template has a value, so a sentence is never printed with holes. */
function fillsAll(key, params) {
  if (!has(key)) return false;
  return [...t(key).matchAll(/\{(\w+)\}/g)].every((match) => params[match[1]] !== undefined);
}

// ---------- One lesson ----------

function lessonContent(lesson) {
  const record = context.records.get(lesson.id) ?? null;
  if (record) {
    return {
      source: record.example ? 'example' : 'record',
      record,
      worked: record.worked,
      exercises: record.exercises,
      investigation: record.investigation,
    };
  }
  const synthetic = syntheticLesson(lesson.id);
  const mark = (item) => ({ ...item, inputs: item.inputs.map((input) => ({ ...input, synthetic: true })) });
  return {
    source: 'synthetic',
    record: null,
    worked: mark(synthetic.worked),
    exercises: synthetic.exercises.map((item) => ({ ...mark(item), promptKey: `lesson.${lesson.id}.synthetic.${item.id}` })),
    investigation: lesson.investigation,
  };
}

function inputList(inputs) {
  return el('dl', { class: 'facts lesson-inputs' }, inputs.flatMap((input) => [
    el('dt', { text: has(`lesson.input.${input.name}`) ? t(`lesson.input.${input.name}`) : input.name }),
    el('dd', {}, [
      el('span', { class: 'mono', text: valueText(input.value, input.unit, String(input.value).split('.')[1]?.length ?? 0) }),
      input.synthetic ? chip(t('learn.inputSynthetic'), 'chip-example') : null,
      input.contentType && has(`content.${input.contentType}`) && !input.synthetic ? chip(t(`content.${input.contentType}`)) : null,
      input.unsourced ? chip(t('learn.inputUnsourced'), 'chip-trial-miss') : null,
    ]),
  ]));
}

/** The answer sentence of an exercise: a dedicated text when one exists, else "Answer: value". */
function answerText(lessonId, exercise, synthetic) {
  const answer = exercise.answer ?? {};
  if (!synthetic) {
    const value = sig4Unit(answer.value, answer.unit);
    return Number.isFinite(answer.z) ? t('learn.answerWithZ', { value, z: sig4(answer.z) }) : t('learn.answerIs', { value });
  }
  const value = valueText(answer.value, answer.unit);
  const key = answer.textKey ?? `lesson.${lessonId}.a${exercise.id?.replace(/^q/, '')}`;
  const params = {
    ...inputParams(exercise.inputs ?? []),
    value,
    ratio: Number.isFinite(answer.ratio) ? formatNumber(answer.ratio, 0) : undefined,
    radius95: Number.isFinite(answer.radius95) ? formatNumber(answer.radius95, 2) : undefined,
    expected: Number.isFinite(answer.expected) ? formatNumber(answer.expected, 1) : undefined,
    degrees: Number.isFinite(answer.value) && answer.unit === 'arcsec' ? formatNumber(answer.value / 3600, 2) : undefined,
  };
  return fillsAll(key, params) ? t(key, params) : t('learn.answerIs', { value });
}

function promptText(exercise, synthetic) {
  const params = inputParams(exercise.inputs, { bare: !synthetic });
  if (exercise.promptKey && fillsAll(exercise.promptKey, params)) return t(exercise.promptKey, params);
  if (exercise.promptKey && has(exercise.promptKey)) return t(exercise.promptKey, params);
  return t('learn.promptMissing', { key: exercise.promptKey ?? exercise.id });
}

function sourceNote(content) {
  if (content.source === 'record') return el('p', { class: 'panel-note lesson-source', text: t('learn.fromRecord', { id: content.record.recordId }) });
  if (content.source === 'example') return el('p', { class: 'panel-note lesson-source warn', text: t('learn.exampleRecord') });
  return el('p', { class: 'panel-note lesson-source', text: t('learn.synthetic') });
}

function scoreboardSection() {
  const rows = scoreboardSummary(context.scoreboard);
  const body = rows?.length
    ? el('div', { class: 'table-scroll' }, el('table', { class: 'results-table' }, [
      el('caption', { text: t('lesson.sure.boardCaption') }),
      el('thead', {}, el('tr', {}, ['col.category', 'col.checked', 'col.hit', 'col.miss', 'col.otherOutcome', 'col.waiting']
        .map((key) => el('th', { scope: 'col', text: t(key) })))),
      el('tbody', {}, rows.map((row) => el('tr', {}, [
        el('th', { scope: 'row', text: categoryLabel(row.category) }),
        ...[row.checked, row.hit, row.miss, row.other, row.waiting].map((count) => el('td', { text: String(count) })),
      ]))),
    ]))
    : el('p', { class: 'panel-note', text: t('lesson.sure.boardNone') });
  return el('section', { class: 'lesson-part' }, [
    el('h3', { text: t('lesson.sure.boardTitle') }),
    context.scoreboard?.example ? chip(t('example.tag'), 'chip-example') : null,
    body,
    el('p', { class: 'note', text: t('lesson.sure.boardNote') }),
  ]);
}

/**
 * Lesson 3's second worked example: the Pluto miss as overconfidence (independent versus correlated errors).
 * Every number comes from the exploratory post-mortem (postmortem.json); without it the section is left out.
 */
function plutoSection() {
  const pm = context.postmortem;
  if (!pm?.frozenRegion || !pm.jackknife || !Number.isInteger(pm.groups)) return null;
  const factor = correlatedInflation(pm.nExposures, pm.groups);
  return el('section', { class: 'lesson-part pluto-example' }, [
    el('h3', { text: t('lesson.sure.plutoTitle') }),
    chip(t('why.chip'), 'chip-exploratory'),
    el('p', { text: t('lesson.sure.plutoIdea') }),
    el('p', { text: factor
      ? t('lesson.sure.plutoCount', { n: String(pm.nExposures), groups: String(pm.groups), factor: formatNumber(factor, 1) })
      : t('lesson.sure.plutoGroups', { groups: String(pm.groups) }) }),
    el('p', { text: t('lesson.sure.plutoNumbers', {
      major: formatNumber(pm.frozenRegion.major, 2), minor: formatNumber(pm.frozenRegion.minor, 2), error: formatNumber(pm.error, 1),
      d2: formatNumber(pm.d2, 2), jkMajor: formatNumber(pm.jackknife.major, 1), jkMinor: formatNumber(pm.jackknife.minor, 1), jkD2: formatNumber(pm.jackknife.d2, 2),
    }) }),
    el('p', { class: 'worked-answer', text: t('lesson.sure.plutoLesson') }),
    el('p', { class: 'note', text: t('lesson.sure.plutoSource') }),
  ]);
}

function renderLesson(lesson) {
  const index = LESSONS.indexOf(lesson) + 1;
  const content = lessonContent(lesson);
  const title = content.record?.titleKey ? tData(content.record.titleKey, 'explain.unknown') : t(`lesson.${lesson.id}.title`);
  const workedParams = { ...inputParams(content.worked?.inputs ?? []), answer: valueText(content.worked?.answer?.value, content.worked?.answer?.unit) };
  const stepsKey = `lesson.${lesson.id}.workedSteps`;
  const investigationName = context.nameOf(content.investigation) ?? content.investigation;
  const panel = LESSONS.find((item) => item.id === lesson.id)?.panel ?? 'see';
  const exercises = content.exercises.slice(0, 3);
  $('lesson-view').replaceChildren(...[
    el('nav', { class: 'lesson-actions' }, [
      el('button', { type: 'button', class: 'quiet', text: t('learn.back'), onclick: () => showLearn(null) }),
      el('button', { type: 'button', class: 'primary', text: t('learn.print'), onclick: () => window.print() }),
    ]),
    el('header', { class: 'lesson-head' }, [
      el('p', { class: 'eyebrow', text: t('learn.meta', {
        n: String(index), grades: content.record?.gradeBand ?? t('learn.gradeDefault'), minutes: String(LESSON_MINUTES[lesson.id]),
      }) }),
      el('h2', { id: 'lesson-title', tabindex: '-1', text: title }),
      sourceNote(content),
    ]),
    el('section', { class: 'lesson-part' }, [el('h3', { text: t('learn.idea') }), el('p', { text: t(`lesson.${lesson.id}.idea`) })]),
    el('section', { class: 'lesson-part formula-part' }, [
      el('h3', { text: t('learn.formula') }),
      mathBlock(`lesson.${lesson.id}.math`, `lesson.${lesson.id}.words`),
      content.record?.formulaKey && has(content.record.formulaKey) ? el('p', { text: t(content.record.formulaKey) }) : null,
      el('h4', { text: t('learn.assumptions') }),
      el('ul', {}, [1, 2, 3].filter((n) => has(`lesson.${lesson.id}.assume${n}`)).map((n) => el('li', { text: t(`lesson.${lesson.id}.assume${n}`) }))),
    ]),
    content.worked ? el('section', { class: 'lesson-part' }, [
      el('h3', { text: t('learn.worked') }),
      inputList(content.worked.inputs),
      fillsAll(stepsKey, workedParams) && content.source === 'synthetic' ? el('p', { class: 'worked-steps', text: t(stepsKey, workedParams) }) : null,
      el('p', { class: 'worked-answer', text: t('learn.answerIs', { value: workedParams.answer }) }),
    ]) : el('section', { class: 'lesson-part' }, [el('h3', { text: t('learn.worked') }), el('p', { class: 'panel-note', text: t('learn.workedMissing') })]),
    lesson.id === 'sure' ? batchPart() : null,
    lesson.id === 'sure' ? plutoSection() : null,
    lesson.id === 'brightness' ? el('p', { class: 'planetx-line' }, [
      el('span', { text: `${t('planetx.lessonLine')} ` }),
      el('a', { href: '?page=learn&lesson=lab#measured', text: t('planetx.link') }),
    ]) : null,
    lesson.id === 'distance' ? el('section', { class: 'lesson-part loop-part' }, [
      el('h3', { text: t('lesson.distance.loopTitle') }),
      el('p', { text: t('lesson.distance.loopText') }),
      el('p', {}, el('a', { class: 'button-link', href: '?page=loop', text: t('loop.link') })),
    ]) : null,
    el('section', { class: 'lesson-part' }, [
      el('h3', { text: t('learn.exercises') }),
      el('ol', { class: 'exercises' }, exercises.map((exercise) => el('li', {}, [
        el('p', { text: promptText(exercise, content.source === 'synthetic') }),
        el('details', { class: 'answer-toggle' }, [el('summary', { text: t('learn.showAnswer') }), el('p', { text: answerText(lesson.id, exercise, content.source === 'synthetic') })]),
      ]))),
    ]),
    lesson.id === 'sure' ? scoreboardSection() : null,
    el('section', { class: 'lesson-part' }, [
      el('h3', { text: t('learn.teacher') }),
      el('p', { text: content.record?.teacherKey && has(content.record.teacherKey) ? t(content.record.teacherKey) : t(`lesson.${lesson.id}.synthetic.teacher`) }),
    ]),
    el('section', { class: 'lesson-part' }, [
      el('h3', { text: t('learn.source') }),
      el('p', {}, el('a', { href: `?page=investigate&target=${encodeURIComponent(content.investigation)}&panel=${panel}`, text: t('learn.sourceLink', { name: investigationName }) })),
    ]),
    el('section', { class: 'answer-key', 'aria-label': t('learn.answerKey') }, [
      el('h3', { text: t('learn.answerKeyTitle', { title }) }),
      el('ol', {}, exercises.map((exercise) => el('li', { text: answerText(lesson.id, exercise, content.source === 'synthetic') }))),
    ]),
  ].filter(Boolean));
}

/** A formula as MathML (from the resource), with the same formula in plain words below it. */
function mathBlock(formulaKey, wordsKey) {
  const holder = el('div', { class: 'math' });
  holder.innerHTML = t(formulaKey); // trusted: MathML written in the English resource file
  return el('figure', { class: 'formula' }, [holder, el('figcaption', { text: t('learn.inWords', { text: t(wordsKey) }) })]);
}

// ---------- Planet X Lab ----------

function labRow(labelKey, value, assumptionKey, params = {}) {
  return el('div', { class: 'lab-row' }, [
    el('dt', { text: t(labelKey) }),
    el('dd', {}, [el('span', { class: 'lab-value mono', text: value }), el('small', { text: t(assumptionKey, params) })]),
  ]);
}

function renderLabResults() {
  const model = planetModel(lab);
  $('lab-results').replaceChildren(el('dl', { class: 'lab-list' }, [
    labRow('lab.v', t('lab.vValue', { value: formatNumber(model.v, 1) }), 'lab.vAssume'),
    labRow('lab.h', t('lab.hValue', { value: formatNumber(model.h, 1) }), 'lab.hAssume'),
    labRow('lab.size', t('lab.sizeValue', { value: formatNumber(model.angularDiameterMas, 0) }), 'lab.sizeAssume'),
    labRow('lab.parallax', t('lab.parallaxValue', { value: formatNumber(model.parallaxArcsec, 0), degrees: formatNumber(model.parallaxArcsec / 3600, 2) }), 'lab.parallaxAssume'),
    labRow('lab.drift', t('lab.driftValue', { value: formatNumber(model.driftArcsecPerYear, 0) }), 'lab.driftAssume', { period: formatNumber(model.periodYears, 0) }),
    labRow('lab.light', t('lab.lightValue', { value: formatNumber(model.lightHours, 1) }), 'lab.lightAssume'),
  ]));
  $('lab-distance-value').textContent = t('lab.valueAu', { value: formatNumber(lab.distanceAu, 0) });
  $('lab-diameter-value').textContent = t('lab.valueKm', { value: formatNumber(lab.diameterKm, 0), earths: formatNumber(model.diameterEarths, 1) });
  $('lab-albedo-value').textContent = formatNumber(lab.albedo, 2);
}

function slider(id, key, labelKey) {
  const range = LAB_RANGES[key];
  return el('div', { class: 'lab-slider' }, [
    el('label', { for: id }, [el('span', { text: t(labelKey) }), el('output', { id: `${id}-value`, for: id, class: 'mono' })]),
    el('input', {
      id, type: 'range', min: range.min, max: range.max, step: range.step, value: lab[key],
      oninput: (event) => {
        lab = { ...lab, [key]: Number(event.target.value) };
        renderLabResults();
      },
    }),
  ]);
}

function renderLab() {
  $('lab-view').replaceChildren(
    el('nav', { class: 'lesson-actions' }, [el('button', { type: 'button', class: 'quiet', text: t('lab.back'), onclick: () => showLearn(null) })]),
    el('header', { class: 'lesson-head' }, [
      el('p', { class: 'eyebrow', text: t('lab.eyebrow') }),
      el('h2', { id: 'lab-view-title', tabindex: '-1', text: t('lab.title') }),
      el('p', { class: 'chip-line' }, chip(t('lab.hypotheticalTag'), 'chip-hypothetical')),
      el('p', { class: 'panel-note', text: t('lab.hypothetical') }),
      el('p', { text: t('lab.intro') }),
    ]),
    el('div', { class: 'lab-grid' }, [
      el('form', { class: 'lab-controls', onsubmit: (event) => event.preventDefault(), 'aria-label': t('lab.controls') }, [
        slider('lab-distance', 'distanceAu', 'lab.distance'),
        slider('lab-diameter', 'diameterKm', 'lab.diameter'),
        slider('lab-albedo', 'albedo', 'lab.albedo'),
        el('button', { type: 'button', class: 'quiet', text: t('lab.reset'), onclick: () => {
          lab = { ...LAB_DEFAULTS };
          renderLab();
        } }),
      ]),
      el('section', { class: 'lab-results', 'aria-labelledby': 'lab-results-title' }, [
        el('h3', { id: 'lab-results-title', text: t('lab.resultsTitle') }),
        el('div', { id: 'lab-results', 'aria-live': 'polite' }),
      ]),
    ]),
    el('section', { class: 'lesson-part' }, [el('h3', { text: t('lab.detectTitle') }), el('p', { text: t('lab.detectText') })]),
    measuredPanel(context.planetx),
  );
  renderLabResults();
  // Links from Home, Predictions and Lesson 2 land on the measured panel.
  if (location.hash === '#measured') requestAnimationFrame(() => $('measured')?.scrollIntoView({ block: 'start' }));
}

// ---------- Learn index and navigation ----------

function renderIndex() {
  $('lesson-list').replaceChildren(...LESSONS.map((lesson, index) => {
    const content = lessonContent(lesson);
    return el('li', { class: 'page-card glass' }, [
      el('span', { class: 'lesson-number', 'aria-hidden': 'true', text: String(index + 1).padStart(2, '0') }),
      el('h2', { class: 'card-title', text: t(`lesson.${lesson.id}.title`) }),
      el('p', { text: t(`lesson.${lesson.id}.text`) }),
      el('p', { class: 'note', text: t(content.source === 'synthetic' ? 'learn.statusSynthetic' : 'learn.statusRecord') }),
      el('button', { type: 'button', class: 'primary', text: t('learn.open'), 'aria-label': `${t('learn.open')}: ${t(`lesson.${lesson.id}.title`)}`, onclick: () => showLearn(lesson.id) }),
    ]);
  }));
}

/** Shows the lesson list (null), one lesson, or the Lab, and keeps the URL in step. */
export function showLearn(id, { notify = true, focus = true } = {}) {
  const lesson = LESSONS.find((item) => item.id === id) ?? null;
  view = lesson ? lesson.id : id === LAB ? LAB : null;
  $('learn-index').hidden = view !== null;
  $('lesson-view').hidden = !lesson;
  $('lab-view').hidden = view !== LAB;
  document.body.dataset.lesson = view ?? '';
  if (lesson) renderLesson(lesson);
  if (view === LAB) renderLab();
  if (notify) context.onNavigate(view);
  if (focus) {
    scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    const heading = lesson ? $('lesson-title') : view === LAB ? $('lab-view-title') : $('learn-title');
    heading?.focus({ preventScroll: true });
  }
}

export const currentLearnView = () => view;

/** Lesson 3's batch example, or an empty placeholder until (or unless) a batch is available. */
const batchPart = () => lessonBatchSection(context.batch) ?? el('div', { id: 'lesson-batch', hidden: true });

/** The asteroid batch arrived (main.js loads it when Learn opens): fill Lesson 3's worked example. */
export function setBatch(data) {
  if (!context) return;
  context.batch = data ?? null;
  $('lesson-batch')?.replaceWith(batchPart());
}

/** The Planet X files arrived (main.js loads them when Learn or Beat the physics opens): fill the Lab's panel. */
export function setPlanetX(data) {
  if (!context) return;
  context.planetx = data;
  const panel = $('measured');
  if (panel) {
    panel.replaceWith(measuredPanel(data));
    if (location.hash === '#measured') $('measured')?.scrollIntoView({ block: 'start' });
  }
}

export function initLearn({ records, scoreboard, postmortem = null, nameOf, onNavigate }) {
  const usable = new Map();
  for (const result of records) {
    const read = result.state === 'ok' ? readLessonRecord(result.doc) : null;
    if (read && !usable.has(read.id)) usable.set(read.id, read);
  }
  context = { records: usable, scoreboard, postmortem, planetx: undefined, batch: null, nameOf, onNavigate };
  renderIndex();
  $('lab-open').onclick = () => showLearn(LAB);
}
