// Reads TENGER contract files (docs/DATA-CONTRACT.md, version 1). Real files live under data/;
// development fixtures under dev-fixtures/ (opened only with ?fixtures=1) and always carry "example": true.
export const KNOWN_MAJOR = 1;
export const REAL_BASE = 'data/';
export const FIXTURE_BASE = 'dev-fixtures/';
const KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SAFE_PATH = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i;

/** 'ok', 'unsupported' (a newer major version) or 'invalid' (wrong kind or no schema_version). */
export function checkSchema(doc, kind) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return 'invalid';
  const match = /^tenger\.([a-z_]+)\/(\d+)$/.exec(doc.schema_version ?? '');
  if (!match || match[1] !== kind) return 'invalid';
  return Number(match[2]) === KNOWN_MAJOR ? 'ok' : 'unsupported';
}

export const isExample = (doc) => doc?.example === true;
export const isKey = (value) => typeof value === 'string' && KEY.test(value);

/** Paths inside a data file must stay inside the data folder. */
export function isSafePath(path) {
  return typeof path === 'string' && SAFE_PATH.test(path) && !path.split('/').includes('..');
}

/**
 * Loads contract files. Every result is { state, path, doc?, example? } where state is one of
 * 'ok', 'missing' (404 or not listed), 'unsupported', 'invalid' or 'error' (network).
 */
export function createSource({ fixtures = false, fetchImpl = (...args) => fetch(...args) } = {}) {
  const base = fixtures ? FIXTURE_BASE : REAL_BASE;
  const cache = new Map();

  async function fetchOne(path, kind) {
    if (!isSafePath(path)) return { state: 'invalid', path };
    let response;
    try {
      response = await fetchImpl(base + path);
    } catch {
      return { state: 'error', path };
    }
    if (response.status === 404) return { state: 'missing', path };
    if (!response.ok) return { state: 'error', path };
    let doc;
    try {
      doc = await response.json();
    } catch {
      return { state: 'invalid', path };
    }
    const check = checkSchema(doc, kind);
    if (check !== 'ok') return { state: check, path };
    return { state: 'ok', path, doc, example: isExample(doc) };
  }

  function load(path, kind) {
    const id = `${kind}|${path}`;
    if (!cache.has(id)) cache.set(id, fetchOne(path, kind));
    return cache.get(id);
  }

  const missing = (path = null) => Promise.resolve({ state: 'missing', path });

  return {
    base,
    fixtures,
    index: () => load('index.json', 'site_index'),
    investigation: (path) => (path ? load(path, 'investigation') : missing()),
    async trial(trialId) {
      if (!isKey(trialId)) return { id: trialId, trial: { state: 'invalid' } };
      const folder = `trials/${trialId}`;
      const [trial, prediction, receipt, verification] = await Promise.all([
        load(`${folder}/trial.json`, 'trial'),
        load(`${folder}/prediction.json`, 'prediction'),
        load(`${folder}/receipt.json`, 'receipt'),
        load(`${folder}/verification.json`, 'verification'),
      ]);
      return { id: trialId, trial, prediction, receipt, verification };
    },
    gameRound: (path) => (path ? load(path, 'game_round') : missing()),
    scoreboard: (path) => (path ? load(path, 'scoreboard') : missing()),
    strings: (path = 'strings.en.json') => load(path, 'strings'),
    lesson: (path) => (path ? load(path, 'lesson') : missing()),
    url: (path) => (isSafePath(path) ? base + path : null),
  };
}
