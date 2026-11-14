// "Could SPHEREx see Planet X? We measured it" (Planet X Lab) and the "Find the hidden planet" round (Beat the
// physics). Data from planetx.js readers: Session A's static/data/planetx/ files, or until they exist the
// labelled examples in static/dev-fixtures/planetx/. The game's planets are artificial: labelled so before and
// after the reveal, never shown as a detection, never counted outside the game.
import { $, chip, el, formatNumber, prefersReducedMotion } from './dom.js';
import { has, t, tData } from './i18n.js';
import { bandModels, DEPTH_PATH, gapRows, headline, injectedPerPoint, HIDDEN_PATH, judgeTap, magExtent, NATIVE_PIXEL_ARCSEC, readDepth, readHiddenPlanet, tapReport, TOO_FAINT_BELOW } from './planetx.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = (name, attributes = {}, children = []) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  node.append(...children.filter(Boolean));
  return node;
};
const mag = (value) => formatNumber(value, 2);
const text = (key, values, fallbackKey = 'explain.unknown') => (key ? (has(key) ? t(key, values) : tData(key, fallbackKey)) : '');

async function json(url) {
  if (!url) return null;
  try {
    const response = await fetch(url);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/**
 * Loads the depth file and the game pairs: the real files when they exist, else the labelled examples.
 * Returns { depth, hidden, depthUrl(path), hiddenUrl(path) }; `example` on each read says which.
 */
export async function loadPlanetX(real, fixtures) {
  const [realDepth, realHidden] = await Promise.all([json(real.url(DEPTH_PATH)), json(real.url(HIDDEN_PATH))]);
  let depth = readDepth(realDepth);
  let depthSource = real;
  if (!depth) {
    depth = readDepth(await json(fixtures.url(DEPTH_PATH)));
    depthSource = fixtures;
  }
  let hidden = readHiddenPlanet(realHidden);
  let hiddenSource = real;
  if (!hidden) {
    hidden = readHiddenPlanet(await json(fixtures.url(HIDDEN_PATH)));
    hiddenSource = fixtures;
  }
  return { depth, hidden, imageUrl: (path) => hiddenSource.url(path), depthFromFixture: depthSource === fixtures };
}

// ---------- The measured panel ----------

/**
 * The headline: built from the file's summary numbers and the measured curve (planetx.js headline), so it says how
 * often one exposure would catch the closest published case; else the file's own summary sentence.
 */
function verdictLine(depth) {
  const built = headline(depth);
  if (built) return el('p', { class: 'planetx-verdict', text: t(built.key, { ...built.values, reach: t(built.reach.key, built.reach.values) }) });
  const summary = depth.verdictSummary;
  const words = summary && has(summary.key) ? t(summary.key, summary.values) : summary?.text ?? (depth.verdictKey ? text(depth.verdictKey) : '');
  return words ? el('p', { class: 'planetx-verdict', text: words }) : null;
}

const gapName = (row, depth) => (row.wise
  ? t('planetx.wiseRow', { reference: depth.wise?.reference ?? '—' })
  : row.model?.scenarioKey ? text(row.model.scenarioKey, {}, 'explain.unknown') : row.model?.reference ?? row.modelId ?? '—');

/** A fraction as a percentage: whole percent for "about N%", one decimal for a curve point. */
const pct = (fraction, digits = 0) => {
  if (!Number.isFinite(fraction)) return '—';
  if (digits === 0 && fraction > 0 && fraction < 0.005) return t('planetx.found.underOne');
  return `${formatNumber(fraction * 100, digits)}%`;
};
const pointText = (point) => t('planetx.found.point', {
  mag: mag(point.mag), pct: pct(point.fraction, 1),
  low: point.interval ? formatNumber(point.interval[0] * 100, 1) : '—', high: point.interval ? formatNumber(point.interval[1] * 100, 1) : '—',
});

/** The fraction found at a published value, with where it comes from: "28%" and "interpolated between …". */
function foundText(found) {
  if (!found) return { main: '—', source: '' };
  if (found.beyond === 'faint') return { main: t('planetx.found.atMost', { pct: pct(found.upper, 1) }), source: t('planetx.found.fainter', { point: pointText(found.points[0]) }) };
  if (found.beyond === 'bright') return { main: t('planetx.found.atLeast', { pct: pct(found.lower, 1) }), source: t('planetx.found.brighter', { point: pointText(found.points[0]) }) };
  if (!found.interpolated) return { main: pct(found.fraction), source: t('planetx.found.tested', { point: pointText(found.points[0]) }) };
  return { main: pct(found.fraction), source: t('planetx.found.interpolated', { a: pointText(found.points[0]), b: pointText(found.points[1]) }) };
}

/** What the published value means for one exposure, from the curve (planetx.js reachOf). */
function reachText(row) {
  if (row.reach === 'faint') return t('planetx.reach.faint');
  if (row.reach === 'partial') return t('planetx.reach.partial', { pct: pct(row.found.fraction) });
  if (row.reach === 'within') return t('planetx.reach.within', { pct: pct(row.found.fraction ?? row.found.lower) });
  if (row.reach === 'unknown') return t('planetx.reach.unknown');
  return row.verdictKey ? text(row.verdictKey) : '—';
}

const gapWithError = (row) => (row.sigma === null ? formatNumber(row.gap, 2) : `${formatNumber(row.gap, 2)} ± ${formatNumber(row.sigma, 2)}`);

/**
 * Every published prediction against our measured curve: how many are too faint for one exposure (under 5%
 * found), each one that is not with how often one exposure would find it, what the ± means, then the table.
 */
function gapSection(depth) {
  const summary = gapRows(depth);
  const { rows } = summary;
  if (!rows.length) return null;
  const bandName = (id) => depth.bands.find((band) => band.id === id)?.publishedBand ?? id ?? '—';
  const limit = String(Math.round(TOO_FAINT_BELOW * 100));
  const sentences = [
    t('planetx.reachCount', { faint: String(summary.tooFaint), n: String(rows.length), limit }),
    ...summary.partial.map((row) => t('planetx.reachPartialLine', {
      name: gapName(row, depth), band: bandName(row.bandId), gap: gapWithError(row), factor: row.factor === null ? '—' : formatNumber(row.factor, 1),
      pct: pct(row.found.fraction), source: foundText(row.found).source,
    })),
    ...summary.within.map((row) => t('planetx.reachWithinLine', { name: gapName(row, depth), band: bandName(row.bandId), pct: pct(row.found.fraction ?? row.found.lower) })),
  ];
  // Rows the curve cannot place keep the file's own verdict text, once each.
  const fileMeanings = [...new Set(rows.filter((row) => row.reach === null).map((row) => row.verdictKey))]
    .filter((key) => key && key !== depth.verdictKey && key !== depth.verdictSummary?.key);
  const sigmas = [...new Set(rows.map((row) => row.sigma).filter((value) => value !== null))].sort((a, b) => a - b);
  return el('div', { class: 'planetx-gaps' }, [
    el('p', { text: sentences.join(' ') }),
    sigmas.length ? el('p', { class: 'note planetx-sigma', text: t('planetx.sigmaNote', { sigma: sigmas.map((value) => `± ${formatNumber(value, 2)}`).join(t('planetx.or')) }) }) : null,
    el('p', { class: 'note', text: t('planetx.reach.rule', { limit }) }),
    ...fileMeanings.map((key) => el('p', { class: 'note', text: text(key) })),
    el('details', { class: 'data-table' }, [
      el('summary', { text: t('planetx.gapTableShow', { n: String(rows.length) }) }),
      el('div', { class: 'table-scroll' }, el('table', {}, [
        el('caption', { text: t('planetx.gapTable', { limit }) }),
        el('thead', {}, el('tr', {}, ['planetx.col.prediction', 'planetx.col.band', 'planetx.col.predicted', 'planetx.col.depth', 'planetx.col.gap', 'planetx.col.factor', 'planetx.col.found', 'planetx.col.reach']
          .map((key) => el('th', { scope: 'col', text: t(key) })))),
        el('tbody', {}, rows.map((row) => {
          const found = foundText(row.found);
          return el('tr', { class: row.reach ? `reach-${row.reach}` : null }, [
            el('th', { scope: 'row', text: gapName(row, depth) }),
            el('td', { text: bandName(row.bandId) }),
            el('td', { text: row.predicted === null ? '—' : mag(row.predicted) }),
            el('td', { text: row.depth === null ? '—' : mag(row.depth) }),
            el('td', { text: gapWithError(row) }),
            el('td', { text: row.factor === null ? '—' : `×${formatNumber(row.factor, 1)}` }),
            el('td', { class: 'found' }, [el('strong', { text: found.main }), found.source ? el('small', { class: 'found-source', text: found.source }) : null]),
            el('td', { class: 'reach', text: reachText(row) }),
          ]);
        })),
      ])),
    ]),
  ]);
}

function bandTitle(band) {
  const range = band.wavelength ? `${formatNumber(band.wavelength[0], 2)}–${formatNumber(band.wavelength[1], 2)}` : '—';
  return t('planetx.bandTitle', { band: band.publishedBand ?? band.id, detector: band.detector ? `D${band.detector}` : '—', range });
}

/** The key to the numbered markers: which published prediction each number is, and its AB magnitude in this band. */
function modelKey(band, depth) {
  const models = bandModels(depth, band.id);
  if (!models.length) return null;
  return el('ol', { class: 'planetx-key', 'aria-label': t('planetx.keyLabel', { band: band.publishedBand ?? band.id }) }, models.map((model) => el('li', { value: String(model.number) }, [
    el('span', { text: model.scenarioKey ? text(model.scenarioKey) : model.reference }),
    el('span', { class: 'mono', text: ` AB ${model.range[0] === model.range[1] ? mag(model.range[0]) : `${mag(model.range[0])}–${mag(model.range[1])}`}` }),
  ])));
}

function bandChart(band, depth) {
  const models = bandModels(depth, band.id);
  const wise = depth.wise?.bandId === band.id ? depth.wise : null;
  const [low, high] = magExtent(band, [...models.map((model) => model.range), wise ? [wise.mag] : []]);
  const [width, height, left, right, top, bottom] = [560, 250, 44, 14, 16, 46];
  const x = (value) => left + ((value - low) / (high - low)) * (width - left - right);
  const y = (fraction) => top + (1 - fraction) * (height - top - bottom);
  const points = band.curve;
  const area = [...points.map((point) => `${x(point.mag).toFixed(1)},${y(point.interval?.[1] ?? point.fraction).toFixed(1)}`),
    ...[...points].reverse().map((point) => `${x(point.mag).toFixed(1)},${y(point.interval?.[0] ?? point.fraction).toFixed(1)}`)].join(' ');
  const ticks = [];
  for (let value = Math.ceil(low); value <= high; value += 1) {
    ticks.push(svg('line', { x1: x(value), x2: x(value), y1: top, y2: height - bottom, class: 'grid' }), svg('text', { x: x(value), y: height - bottom + 14, class: 'tick', 'text-anchor': 'middle' }, [document.createTextNode(String(value))]));
  }
  for (const fraction of [0, 0.5, 0.9, 1]) {
    ticks.push(svg('line', { x1: left, x2: width - right, y1: y(fraction), y2: y(fraction), class: fraction === 0.5 || fraction === 0.9 ? 'level' : 'grid' }),
      svg('text', { x: left - 6, y: y(fraction) + 4, class: 'tick', 'text-anchor': 'end' }, [document.createTextNode(`${Math.round(fraction * 100)}%`)]));
  }
  const depthLine = (entry, level, className) => (entry ? [
    svg('line', { x1: x(entry.value), x2: x(entry.value), y1: top, y2: height - bottom, class: className }),
    svg('text', { x: x(entry.value) + 4, y: y(level) - 6, class: `depth-label ${className}` }, [document.createTextNode(t('planetx.depthLabel', { level: String(Math.round(level * 100)), mag: mag(entry.value) }))]),
  ] : []);
  // Several published values share a chart: each marker carries a number, explained in the key under the chart.
  const markers = models.flatMap((model, index) => {
    const [from, to] = model.range;
    const labelY = top + 11 + (index % 3) * 12;
    return [
      from === to
        ? svg('line', { x1: x(from), x2: x(from), y1: top, y2: height - bottom, class: 'model' })
        : svg('rect', { x: x(from), y: top, width: Math.max(2, x(to) - x(from)), height: height - top - bottom, class: 'model-range' }),
      svg('text', { x: x(to) + 3, y: labelY, class: 'marker-label model marker-number' }, [document.createTextNode(String(model.number))]),
    ];
  });
  const wiseMarker = wise ? [
    svg('line', { x1: x(wise.mag), x2: x(wise.mag), y1: top, y2: height - bottom, class: 'wise' }),
    svg('text', { x: x(wise.mag) - 4, y: height - bottom - 6, class: 'marker-label wise', 'text-anchor': 'end' }, [document.createTextNode(t('planetx.wiseLabel', { mag: mag(wise.mag) }))]),
  ] : [];
  return svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'planetx-chart', role: 'img', 'aria-label': t('planetx.chartLabel', { band: bandTitle(band) }) }, [
    ...ticks,
    svg('polygon', { points: area, class: 'interval' }),
    svg('polyline', { points: points.map((point) => `${x(point.mag).toFixed(1)},${y(point.fraction).toFixed(1)}`).join(' '), class: 'curve' }),
    ...points.map((point) => svg('circle', { cx: x(point.mag).toFixed(1), cy: y(point.fraction).toFixed(1), r: 3, class: 'pt' })),
    ...depthLine(band.depth50, 0.5, 'd50'),
    ...depthLine(band.depth90, 0.9, 'd90'),
    ...markers,
    ...wiseMarker,
    svg('text', { x: (left + width - right) / 2, y: height - 8, class: 'axis', 'text-anchor': 'middle' }, [document.createTextNode(t('planetx.axisMag'))]),
  ]);
}

function bandTable(band) {
  const fmt = (value, digits = 2) => formatNumber(value, digits);
  return el('details', { class: 'data-table' }, [
    el('summary', { text: t('planetx.tableShow', { band: band.publishedBand ?? band.id }) }),
    el('div', { class: 'table-scroll' }, el('table', {}, [
      el('caption', { text: t('planetx.tableCaption', { band: bandTitle(band) }) }),
      el('thead', {}, el('tr', {}, ['planetx.col.mag', 'planetx.col.injected', 'planetx.col.recovered', 'planetx.col.fraction', 'planetx.col.interval'].map((key) => el('th', { scope: 'col', text: t(key) })))),
      el('tbody', {}, band.curve.map((point) => el('tr', {}, [
        el('td', { text: fmt(point.mag) }), el('td', { text: String(point.injected) }), el('td', { text: String(point.recovered) }),
        el('td', { text: fmt(point.fraction) }), el('td', { text: point.interval ? `${fmt(point.interval[0])}–${fmt(point.interval[1])}` : '—' }),
      ]))),
    ])),
    band.fields.length ? el('div', { class: 'table-scroll' }, el('table', {}, [
      el('caption', { text: t('planetx.fieldsCaption') }),
      el('thead', {}, el('tr', {}, ['planetx.col.field', 'planetx.col.exposures', 'planetx.col.d50', 'planetx.col.d90', 'planetx.col.false'].map((key) => el('th', { scope: 'col', text: t(key) })))),
      el('tbody', {}, band.fields.map((field) => el('tr', {}, [
        el('td', { text: field.fieldKey ? (has(`field.${field.fieldKey}`) ? t(`field.${field.fieldKey}`) : field.fieldKey) : '—' }),
        el('td', { text: field.exposures === null ? '—' : String(field.exposures) }),
        el('td', { text: field.depth50 ? mag(field.depth50.value) : '—' }),
        el('td', { text: field.depth90 ? mag(field.depth90.value) : '—' }),
        el('td', { text: field.falseDetection && Number.isInteger(field.falseDetection.blanks) ? t('planetx.falseValue', { n: String(field.falseDetection.false ?? 0), blanks: String(field.falseDetection.blanks) }) : '—' }),
      ]))),
    ])) : null,
  ]);
}

function depthLine(band) {
  const part = (entry, level) => (entry
    ? t(entry.interval ? 'planetx.depthWithInterval' : 'planetx.depthPlain', { level, mag: mag(entry.value), low: entry.interval ? mag(entry.interval[0]) : '', high: entry.interval ? mag(entry.interval[1]) : '' })
    : t('planetx.depthNone', { level }));
  return t('planetx.depthSummary', { band: band.publishedBand ?? band.id, d50: part(band.depth50, '50'), d90: part(band.depth90, '90') });
}

function assumptions(depth) {
  const method = depth.method ?? {};
  const rule = method.detection_rule ?? {};
  const items = [
    (() => {
      const counts = injectedPerPoint(depth);
      return counts ? t('planetx.assume.injected', { n: counts[0] === counts[1] ? String(counts[0]) : `${counts[0]}–${counts[1]}` }) : null;
    })(),
    method.single_exposure === true ? t('planetx.assume.single') : null,
    Number.isFinite(rule.snr_min) ? t('planetx.assume.rule', { snr: String(rule.snr_min), offset: String(rule.max_offset_px ?? '—') }) : null,
    t('planetx.assume.interval', { confidence: String(Math.round(depth.confidence * 100)) }),
    t('planetx.assume.depth'),
    t('planetx.assume.models'),
    ...depth.assumptionKeys.map((key) => text(key)),
  ];
  return el('ul', { class: 'planetx-assumptions' }, items.filter(Boolean).map((item) => el('li', { text: item })));
}

/** The "Measured by TENGER" panel for the Planet X Lab. data: loadPlanetX() result (or null while loading). */
export function measuredPanel(data) {
  if (data === undefined) return el('section', { id: 'measured', class: 'lesson-part planetx-measured' }, [el('h3', { text: t('planetx.title') }), el('p', { class: 'note', text: t('loading') })]);
  const depth = data?.depth;
  if (!depth) return el('section', { id: 'measured', class: 'lesson-part planetx-measured' }, [el('h3', { text: t('planetx.title') }), el('p', { class: 'panel-note', text: t('planetx.missing') })]);
  const qualitative = depth.models.filter((model) => !model.range);
  return el('section', { id: 'measured', class: 'lesson-part planetx-measured', 'aria-labelledby': 'planetx-title' }, [
    el('h3', { id: 'planetx-title', text: t('planetx.title') }),
    el('p', { class: 'chip-line' }, [
      depth.example ? chip(t('example.tag'), 'chip-example') : chip(t('planetx.measuredChip'), 'chip-measured'),
      chip(t('planetx.injectedChip'), 'chip-artificial'),
    ]),
    depth.example ? el('p', { class: 'panel-note warn', text: t('planetx.exampleNote') }) : null,
    el('p', { text: t('planetx.lead') }),
    verdictLine(depth),
    gapSection(depth),
    el('div', { class: 'planetx-grid' }, [
      el('div', { class: 'planetx-bands' }, depth.bands.map((band) => el('figure', { class: 'planetx-band' }, [
        el('figcaption', {}, [el('strong', { text: bandTitle(band) }), el('span', { class: 'note', text: depthLine(band) })]),
        band.check?.ok === false ? el('p', { class: 'panel-note warn', text: t('planetx.bandMismatch', {
          band: band.publishedBand ?? band.id, um: formatNumber(band.check.published, 2), detector: band.detector ? `D${band.detector}` : '—',
          low: band.check.array ? formatNumber(band.check.array[0], 2) : '—', high: band.check.array ? formatNumber(band.check.array[1], 2) : '—',
        }) }) : null,
        bandChart(band, depth),
        modelKey(band, depth),
        bandTable(band),
      ]))),
      el('aside', { class: 'planetx-side' }, [
        el('h4', { text: t('planetx.assumeTitle') }),
        assumptions(depth),
        depth.models.length ? el('h4', { text: t('planetx.modelsTitle') }) : null,
        depth.models.length ? el('ul', { class: 'planetx-models' }, depth.models.map((model) => el('li', {}, [
          el('strong', { text: model.reference }),
          el('span', { text: model.range ? t('planetx.modelValue', { band: model.bandId ?? '—', mag: model.range[0] === model.range[1] ? mag(model.range[0]) : `${mag(model.range[0])}–${mag(model.range[1])}` }) : t('planetx.modelNoValue') }),
          model.noteKey ? el('small', { text: text(model.noteKey) }) : null,
          model.doi ? el('a', { href: `https://doi.org/${model.doi}`, rel: 'noopener', text: `doi:${model.doi}` }) : null,
        ]))) : null,
        qualitative.length ? el('p', { class: 'note', text: t('planetx.qualitativeNote') }) : null,
        depth.wise ? el('p', { class: 'note', text: t('planetx.wiseNote', { mag: mag(depth.wise.mag), band: depth.wise.bandId ?? '—', reference: depth.wise.reference ?? '—' }) }) : null,
        depth.missionKey ? el('p', { class: 'note', text: text(depth.missionKey) }) : null,
      ]),
    ]),
  ]);
}

// ---------- Find the hidden planet ----------

let round = null;

function drawMarks() {
  const { pair, guess, revealed } = round;
  const layer = $('hidden-marks');
  const pct = (value, size) => `${(value / size) * 100}%`;
  const [width, height] = [pair.frames[0].width, pair.frames[0].height];
  const marks = [];
  if (guess) marks.push(el('span', { class: 'hidden-mark guess', style: `left:${pct(guess.x, width)};top:${pct(guess.y, height)}` }));
  if (revealed) {
    for (const point of pair.injected) marks.push(el('span', { class: 'hidden-mark injected', style: `left:${pct(point.x, width)};top:${pct(point.y, height)}`, title: t('hidden.injectedMark', { frame: point.frame === 0 ? 'A' : 'B' }) }));
    for (const point of pair.pipeline.positions) marks.push(el('span', { class: 'hidden-mark pipeline', style: `left:${pct(point.x, width)};top:${pct(point.y, height)}` }));
  }
  layer.replaceChildren(...marks);
}

function showFrame(index) {
  round.frame = index;
  $('hidden-frame-b').style.opacity = index === 1 ? '1' : '0';
  $('hidden-which').textContent = t('hidden.frameShown', { frame: index === 0 ? 'A' : 'B' });
}

function setBlink(on) {
  clearInterval(round.timer);
  round.timer = null;
  if (on && !prefersReducedMotion()) round.timer = setInterval(() => showFrame(round.frame === 0 ? 1 : 0), 700);
  $('hidden-blink').setAttribute('aria-pressed', String(on && !prefersReducedMotion()));
}

function reveal() {
  if (!round.guess) {
    $('hidden-result').replaceChildren(el('p', { class: 'note warn', text: t('hidden.tapFirst') }));
    return;
  }
  round.revealed = true;
  setBlink(false);
  drawMarks();
  const verdict = judgeTap(round.pair, round.guess);
  const shown = tapReport(round.pair, verdict);
  const { pipeline } = round.pair;
  const decimals = (value) => (Number.isInteger(value) ? 0 : Number.isInteger(value * 10) ? 1 : 2);
  $('hidden-result').replaceChildren(
    el('p', { class: 'hidden-artificial', text: t('hidden.label') }),
    el('p', { class: verdict.hit ? 'hidden-hit' : 'hidden-miss', text: t(verdict.hit ? 'hidden.youFound' : 'hidden.youMissed', {
      px: formatNumber(shown.px, 1),
      scale: shown.scale === null ? '—' : formatNumber(shown.scale, decimals(shown.scale)),
      arcsec: shown.arcsec === null ? '—' : formatNumber(shown.arcsec, decimals(shown.scale ?? 0) + 1),
      tolerance: formatNumber(shown.tolerancePx, decimals(shown.tolerancePx)),
      toleranceArcsec: shown.toleranceArcsec === null ? '—' : formatNumber(shown.toleranceArcsec, Math.max(1, decimals(shown.tolerancePx))),
    }) }),
    shown.scale === null ? null : el('p', { class: 'note', text: t(shown.resampled ? 'hidden.scaleResampled' : 'hidden.scaleNative', {
      scale: formatNumber(shown.scale, decimals(shown.scale)), native: formatNumber(NATIVE_PIXEL_ARCSEC, 2),
    }) }),
    el('p', { text: t(pipeline.found ? 'hidden.pipelineFound' : 'hidden.pipelineMissed', {
      snr: pipeline.positions.length ? formatNumber(Math.min(...pipeline.positions.map((point) => point.snr ?? Infinity)), 1) : '—',
    }) }),
    round.pair.mag !== null ? el('p', { class: 'note', text: t('hidden.magnitude', { mag: formatNumber(round.pair.mag, 1), motion: round.pair.motion === null ? '—' : formatNumber(round.pair.motion, 0) }) }) : null,
    el('p', { class: 'note', text: t('hidden.notCounted') }),
  );
}

function onTap(event) {
  if (round.revealed) return;
  const box = $('hidden-stage').getBoundingClientRect();
  const frame = round.pair.frames[0];
  round.guess = {
    x: ((event.clientX - box.left) / box.width) * frame.width,
    y: ((event.clientY - box.top) / box.height) * frame.height,
  };
  drawMarks();
  $('hidden-check').disabled = false;
}

function onKey(event) {
  if (round.revealed) return;
  const step = event.shiftKey ? 5 : 1;
  const frame = round.pair.frames[0];
  const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
  if (move) {
    event.preventDefault();
    const guess = round.guess ?? { x: frame.width / 2, y: frame.height / 2 };
    round.guess = { x: Math.min(frame.width, Math.max(0, guess.x + move[0])), y: Math.min(frame.height, Math.max(0, guess.y + move[1])) };
    drawMarks();
    $('hidden-check').disabled = false;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    reveal();
  }
}

function startPair(index) {
  const pair = round.data.hidden.pairs[index];
  clearInterval(round.timer);
  round = { ...round, pair, index, guess: null, revealed: false, frame: 0, timer: null };
  $('hidden-frame-a').src = round.data.imageUrl(pair.frames[0].path);
  $('hidden-frame-b').src = round.data.imageUrl(pair.frames[1].path);
  $('hidden-stage').style.aspectRatio = `${pair.frames[0].width} / ${pair.frames[0].height}`;
  $('hidden-result').replaceChildren();
  $('hidden-check').disabled = true;
  drawMarks();
  showFrame(0);
  setBlink(true);
}

/** The optional round on the Beat the physics page. data: loadPlanetX() result. */
export function renderHiddenRound(host, data) {
  const hidden = data?.hidden;
  if (!hidden) {
    host.replaceChildren();
    host.hidden = true;
    return;
  }
  host.hidden = false;
  // The example pair is synthetic, so its wording must not call the frames real SPHEREx pictures.
  const example = hidden.example;
  host.replaceChildren(...[
    el('h2', { id: 'hidden-title', text: t('hidden.title') }),
    el('p', { class: 'chip-line' }, [chip(t('hidden.chip'), 'chip-artificial'), example ? chip(t('example.tag'), 'chip-example') : null]),
    el('p', { class: 'lead', text: t(example ? 'hidden.leadExample' : 'hidden.lead') }),
    el('p', { class: 'note', text: t('hidden.how') }),
    hidden.pairs.length > 1 ? el('div', { class: 'segment', role: 'group', 'aria-label': t('hidden.pairs') }, hidden.pairs.map((pair, index) => el('button', {
      type: 'button', text: t('hidden.pair', { n: String(index + 1) }), onclick: () => startPair(index),
    }))) : null,
    el('div', { class: 'hidden-layout' }, [
      el('figure', { class: 'hidden-figure' }, [
        el('div', { id: 'hidden-stage', class: 'hidden-stage', tabindex: '0', role: 'application', 'aria-label': t('hidden.stageLabel'), onclick: onTap, onkeydown: onKey }, [
          el('img', { id: 'hidden-frame-a', alt: t(example ? 'hidden.frameAltExample' : 'hidden.frameAlt', { frame: 'A' }), draggable: 'false' }),
          el('img', { id: 'hidden-frame-b', alt: t(example ? 'hidden.frameAltExample' : 'hidden.frameAlt', { frame: 'B' }), draggable: 'false' }),
          el('div', { id: 'hidden-marks', class: 'hidden-marks', 'aria-hidden': 'true' }),
          el('p', { class: 'hidden-badge', text: t('hidden.label') }),
        ]),
        el('figcaption', {}, [el('span', { id: 'hidden-which', class: 'mono' }), el('span', { class: 'note', text: t(example ? 'hidden.captionExample' : 'hidden.caption') })]),
      ]),
      el('div', { class: 'hidden-controls' }, [
        el('div', { class: 'hidden-buttons' }, [
          el('button', { id: 'hidden-blink', type: 'button', class: 'quiet', 'aria-pressed': 'true', text: t('hidden.blink'), onclick: () => setBlink(!round.timer) }),
          el('button', { type: 'button', class: 'quiet', text: t('hidden.showA'), onclick: () => { setBlink(false); showFrame(0); } }),
          el('button', { type: 'button', class: 'quiet', text: t('hidden.showB'), onclick: () => { setBlink(false); showFrame(1); } }),
          el('button', { id: 'hidden-check', type: 'button', class: 'primary', text: t('hidden.check'), onclick: reveal, disabled: true }),
          el('button', { type: 'button', class: 'quiet', text: t('hidden.again'), onclick: () => startPair(round.index) }),
        ]),
        el('div', { id: 'hidden-result', class: 'hidden-result', 'aria-live': 'polite' }),
      ]),
    ]),
  ].filter(Boolean));
  round = { data, pair: null, index: 0 };
  startPair(0);
}
