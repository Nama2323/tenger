// Lessons and the Planet X Lab: the mathematics, the synthetic practice values and the reader for lesson
// records (DATA-CONTRACT V1 §12). Pure: no DOM, so every number on the Learn page is unit-tested.
//
// Until Session A publishes a lesson record (task A5), each lesson shows clearly marked synthetic practice
// values. When a record with a matching lesson_id exists, its worked example and exercises replace them.

export const ARCSEC_PER_RAD = 206264.80624709636;
export const KM_PER_AU = 149597870.7;
const EARTH_DIAMETER_KM = 12742;
const H_CONSTANT_KM = 1329;

// ---------- Lesson 1: distance and a moving observer ----------

/** Small-angle distance: d[pc] = b[au] / θ[arcsec], the definition of the parsec. */
export function distancePc(baselineAu, shiftArcsec) {
  if (!(baselineAu > 0) || !(shiftArcsec > 0)) return null;
  return baselineAu / shiftArcsec;
}

/** The shift (arcsec) a fixed object at distanceAu shows when the observer moves baselineAu sideways. */
export function shiftArcsecForAu(baselineAu, distanceAu) {
  if (!(baselineAu > 0) || !(distanceAu > 0)) return null;
  return (baselineAu / distanceAu) * ARCSEC_PER_RAD;
}

// ---------- Lesson 2: brightness, logarithms ----------

/** Magnitude difference for a brightness ratio: Δm = 2.5 log10(F1 / F2). */
export function magnitudeDifference(fluxRatio) {
  return fluxRatio > 0 ? 2.5 * Math.log10(fluxRatio) : null;
}

/** Reflected light from a distant body falls as 1/(r²Δ²); with Δ ≈ r it falls as 1/r⁴. */
export function reflectedDimming(nearAu, farAu) {
  if (!(nearAu > 0) || !(farAu > 0)) return null;
  const ratio = (farAu / nearAu) ** 4;
  return { ratio, magnitudes: 10 * Math.log10(farAu / nearAu) };
}

/** Absolute magnitude H from diameter (km) and geometric albedo: D = 1329 km / √p × 10^(−H/5). */
export function absoluteMagnitude(diameterKm, albedo) {
  if (!(diameterKm > 0) || !(albedo > 0)) return null;
  return 5 * Math.log10(H_CONSTANT_KM / (diameterKm * Math.sqrt(albedo)));
}

/** Visual magnitude at heliocentric r and observer distance Δ (au), phase angle taken as zero. */
export function visualMagnitude(h, sunDistanceAu, observerDistanceAu) {
  if (!Number.isFinite(h) || !(sunDistanceAu > 0) || !(observerDistanceAu > 0)) return null;
  return h + 5 * Math.log10(sunDistanceAu * observerDistanceAu);
}

// ---------- Lesson 3: how sure are we? ----------

/** Complementary error function (Numerical Recipes erfcc; fractional error below 1.2e-7). */
export function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418
    + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587
    + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/** One-sided Gaussian tail P(Z > k). */
export const upperTail = (k) => 0.5 * erfc(k / Math.SQRT2);

/** Probability that a 2D Gaussian point falls inside k standard deviations (circular case): 1 − e^(−k²/2). */
export const inside2d = (k) => 1 - Math.exp(-(k * k) / 2);

/** Radius (in σ) of the 2D region with probability p: √(−2 ln(1 − p)); 95% gives 2.4477. */
export const radius2d = (probability) => Math.sqrt(-2 * Math.log(1 - probability));

/** Expected false alarms among N independent tests at threshold k (one-sided): E = N · P(Z > k). */
export const expectedFalseAlarms = (n, k) => n * upperTail(k);

/** Chance that N independent trials, each with true coverage c, all land inside: c^N. */
export const allInside = (coverage, n) => coverage ** n;

// ---------- Planet X Lab ----------

/** Circular orbit around the Sun: period in years from Kepler's third law, P² = a³. */
export const orbitalPeriodYears = (distanceAu) => distanceAu ** 1.5;

/** The model for the Lab, with every assumption returned next to the numbers. */
export function planetModel({ distanceAu, diameterKm, albedo }) {
  const h = absoluteMagnitude(diameterKm, albedo);
  // Observer at about 1 au from the Sun near opposition: Δ ≈ r − 1.
  const observerAu = distanceAu - 1;
  const v = visualMagnitude(h, distanceAu, observerAu);
  const period = orbitalPeriodYears(distanceAu);
  return {
    h,
    v,
    observerAu,
    diameterEarths: diameterKm / EARTH_DIAMETER_KM,
    angularDiameterMas: (diameterKm / (observerAu * KM_PER_AU)) * ARCSEC_PER_RAD * 1000,
    parallaxArcsec: shiftArcsecForAu(1, observerAu),
    periodYears: period,
    driftArcsecPerYear: (360 * 3600) / period,
    lightHours: (distanceAu * KM_PER_AU) / 299792.458 / 3600,
  };
}

// ---------- Lessons ----------

/** The three lessons. Each lists the investigation it points to and accepts these record ids. */
export const LESSONS = [
  { id: 'distance', ids: ['distance', 'distance-moving-observer'], investigation: 'makemake', panel: 'see' },
  { id: 'brightness', ids: ['brightness', 'brightness-detection'], investigation: 'makemake', panel: 'changed' },
  { id: 'sure', ids: ['how-sure', 'sure', 'uncertainty'], investigation: 'barnard', panel: 'prediction' },
];

const round = (value, digits) => Number(value.toFixed(digits));

/**
 * Synthetic practice values, computed here (never typed in by hand) and always marked synthetic.
 * Each item: { inputs: [{ name, value, unit }], answer: { value, unit } | { textKey } }.
 */
export function syntheticLesson(id) {
  if (id === 'distance') {
    return {
      worked: { inputs: [{ name: 'baseline_au', value: 1, unit: 'au' }, { name: 'shift_arcsec', value: 0.1, unit: 'arcsec' }],
        answer: { value: round(distancePc(1, 0.1), 2), unit: 'pc' } },
      exercises: [
        { id: 'q1', inputs: [{ name: 'baseline_au', value: 1, unit: 'au' }, { name: 'shift_arcsec', value: 0.25, unit: 'arcsec' }],
          answer: { value: round(distancePc(1, 0.25), 2), unit: 'pc' } },
        { id: 'q2', inputs: [{ name: 'baseline_au', value: 2, unit: 'au' }, { name: 'shift_arcsec', value: 0.5, unit: 'arcsec' }],
          answer: { value: round(distancePc(2, 0.5), 2), unit: 'pc' } },
        { id: 'q3', inputs: [{ name: 'baseline_au', value: 1, unit: 'au' }, { name: 'distance_au', value: 50, unit: 'au' }],
          answer: { value: Math.round(shiftArcsecForAu(1, 50)), unit: 'arcsec', textKey: 'lesson.distance.a3' } },
      ],
    };
  }
  if (id === 'brightness') {
    const h = absoluteMagnitude(1000, 0.1);
    return {
      worked: { inputs: [{ name: 'flux_ratio', value: 100, unit: '' }], answer: { value: round(magnitudeDifference(100), 2), unit: 'mag' } },
      exercises: [
        { id: 'q1', inputs: [{ name: 'flux_ratio', value: 10, unit: '' }], answer: { value: round(magnitudeDifference(10), 2), unit: 'mag' } },
        { id: 'q2', inputs: [{ name: 'near_au', value: 40, unit: 'au' }, { name: 'far_au', value: 80, unit: 'au' }],
          answer: { value: round(reflectedDimming(40, 80).magnitudes, 2), unit: 'mag', ratio: reflectedDimming(40, 80).ratio } },
        { id: 'q3', inputs: [{ name: 'diameter_km', value: 1000, unit: 'km' }, { name: 'albedo', value: 0.1, unit: '' }, { name: 'distance_au', value: 40, unit: 'au' }],
          answer: { value: round(visualMagnitude(h, 40, 40), 1), unit: 'mag_v', textKey: 'lesson.brightness.a3' } },
      ],
    };
  }
  return {
    worked: { inputs: [{ name: 'sigma_arcsec', value: 0.3, unit: 'arcsec' }], answer: { value: round(1.959963984540054 * 0.3, 3), unit: 'arcsec' } },
    exercises: [
      { id: 'q1', inputs: [{ name: 'k_sigma', value: 2, unit: '' }],
        answer: { value: round(inside2d(2) * 100, 1), unit: 'percent', textKey: 'lesson.sure.a1', radius95: round(radius2d(0.95), 3) } },
      { id: 'q2', inputs: [{ name: 'tests', value: 500, unit: '' }, { name: 'k_sigma', value: 3, unit: '' }],
        answer: { value: round(expectedFalseAlarms(500, 3), 2), unit: '' } },
      { id: 'q3', inputs: [{ name: 'trials', value: 10, unit: '' }, { name: 'coverage', value: 0.95, unit: '' }],
        answer: { value: round(allInside(0.95, 10) * 100, 1), unit: 'percent', expected: round(0.95 * 10, 1) } },
    ],
  };
}

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const finiteOrNull = (value) => (Number.isFinite(value) ? value : null);

function readInput(input) {
  const synthetic = input?.synthetic !== false;
  return {
    name: String(input?.name ?? ''),
    value: finiteOrNull(input?.value),
    unit: typeof input?.unit === 'string' ? input.unit : '',
    contentType: input?.content_type ?? null,
    synthetic,
    sourceRef: input?.source_ref ?? null,
    // Contract: a real (non-synthetic) input needs a source; without one it is shown as unsourced.
    unsourced: !synthetic && !input?.source_ref,
  };
}

/** A lesson record in the page's shape, or null if it cannot be used. */
export function readLessonRecord(doc) {
  if (!doc || !ID.test(doc.lesson_id ?? '')) return null;
  const lesson = LESSONS.find((item) => item.ids.includes(doc.lesson_id));
  if (!lesson) return null;
  const worked = doc.worked_example;
  return {
    id: lesson.id,
    recordId: doc.lesson_id,
    example: doc.example === true,
    titleKey: doc.title_key ?? null,
    formulaKey: doc.formula_key ?? null,
    teacherKey: doc.teacher_note_key ?? null,
    gradeBand: doc.grade_band ?? null,
    investigation: doc.investigation_key ?? lesson.investigation,
    worked: worked ? {
      inputs: (worked.inputs ?? []).map(readInput),
      answer: { value: finiteOrNull(worked.answer?.value), unit: worked.answer?.unit ?? '' },
    } : null,
    exercises: (doc.exercises ?? []).filter((item) => ID.test(item?.id ?? '')).map((item) => ({
      id: item.id,
      promptKey: item.prompt_key ?? null,
      inputs: (item.inputs ?? []).map(readInput),
      answer: { value: finiteOrNull(item.answer?.value), unit: item.answer?.unit ?? '' },
    })),
    derivedFrom: Array.isArray(doc.derived_from) ? doc.derived_from : [],
  };
}

/**
 * Scoreboard counts for lesson 3: checked trials per category (hit, miss and the other outcomes) and open
 * forecasts (waiting). Only categories present in the file appear. Never computes a success rate.
 */
export function scoreboardSummary(doc) {
  if (!doc?.counts || typeof doc.counts !== 'object') return null;
  return Object.entries(doc.counts).map(([category, counts]) => {
    const values = Object.fromEntries(Object.entries(counts ?? {}).map(([status, count]) => [status, Number.isFinite(count) ? count : 0]));
    const checked = Object.entries(values).filter(([status]) => status !== 'waiting').reduce((sum, [, count]) => sum + count, 0);
    return { category, checked, hit: values.hit ?? 0, miss: values.miss ?? 0, open: values.waiting ?? 0, other: checked - (values.hit ?? 0) - (values.miss ?? 0) };
  });
}
