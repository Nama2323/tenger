import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSchema, createSource, isSafePath } from '../static/js/contract.js';

// fileURLToPath, not URL.pathname: a checkout path may contain spaces ("Hackathon Astrolemma").
const FIXTURES = fileURLToPath(new URL('../static/dev-fixtures/', import.meta.url));
const DATA = fileURLToPath(new URL('../static/data/', import.meta.url));

function jsonFiles(folder) {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return jsonFiles(path);
    return name.endsWith('.json') ? [path] : [];
  });
}

/** A fake fetch that serves files from a folder, with 404 for anything missing. */
function folderFetch(folder, base) {
  return async (url) => {
    const path = join(folder, url.slice(base.length));
    try {
      const text = readFileSync(path, 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(text) };
    } catch {
      return { ok: false, status: 404, json: async () => ({}) };
    }
  };
}

test('schema checks: kind and major version must match', () => {
  assert.equal(checkSchema({ schema_version: 'tenger.trial/1' }, 'trial'), 'ok');
  assert.equal(checkSchema({ schema_version: 'tenger.trial/2' }, 'trial'), 'unsupported');
  assert.equal(checkSchema({ schema_version: 'tenger.prediction/1' }, 'trial'), 'invalid');
  assert.equal(checkSchema({}, 'trial'), 'invalid');
  assert.equal(checkSchema([], 'trial'), 'invalid');
  assert.equal(checkSchema(null, 'trial'), 'invalid');
});

test('paths from data files cannot leave the data folder', () => {
  assert.ok(isSafePath('barnard/investigation.json'));
  assert.ok(!isSafePath('../secrets.json'));
  assert.ok(!isSafePath('/etc/passwd'));
  assert.ok(!isSafePath('https://example.com/x.json'));
  assert.ok(!isSafePath('a/../../b.json'));
});

test('every development fixture is marked as an example and has a known schema', () => {
  const kinds = {
    'index.json': 'site_index', 'investigation.json': 'investigation', 'trial.json': 'trial', 'prediction.json': 'prediction',
    'receipt.json': 'receipt', 'verification.json': 'verification', 'scoreboard.json': 'scoreboard',
  };
  const files = jsonFiles(FIXTURES);
  assert.ok(files.length >= 8);
  for (const file of files) {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(doc.example, true, `${file} must carry "example": true`);
    const name = file.split('/').at(-1);
    const kind = kinds[name] ?? (file.includes('/game/') ? 'game_round' : file.includes('/lessons/') ? 'lesson' : null);
    assert.ok(kind, `unexpected fixture ${file}`);
    assert.equal(checkSchema(doc, kind), 'ok', file);
  }
});

test('no real data file claims to be an example (fixtures stay out of static/data)', () => {
  for (const file of jsonFiles(DATA)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('"example"')) continue;
    assert.notEqual(JSON.parse(text).example, true, `${file} is marked as an example`);
  }
});

test('the loader reports missing files honestly and reads fixtures only when asked', async () => {
  const real = createSource({ fixtures: false, fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
  assert.equal((await real.index()).state, 'missing');
  assert.equal(real.base, 'data/');
  const fixtures = createSource({ fixtures: true, fetchImpl: folderFetch(FIXTURES, 'dev-fixtures/') });
  const index = await fixtures.index();
  assert.equal(index.state, 'ok');
  assert.equal(index.example, true);
  const bundle = await fixtures.trial('barnard-position-example');
  assert.equal(bundle.trial.state, 'ok');
  assert.equal(bundle.verification.state, 'ok');
  const waiting = await fixtures.trial('rwaur-brightness-example');
  assert.equal(waiting.receipt.state, 'missing');
  assert.equal(waiting.verification.state, 'missing');
  assert.equal((await fixtures.trial('../x')).trial.state, 'invalid');
});

test('network failures and newer versions are not mistaken for data', async () => {
  const offline = createSource({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal((await offline.index()).state, 'error');
  const newer = createSource({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ schema_version: 'tenger.site_index/2' }) }) });
  assert.equal((await newer.index()).state, 'unsupported');
});

test('fixture hashes chain: prediction refers to the trial bytes, the receipt to the prediction bytes', async () => {
  const { createHash } = await import('node:crypto');
  const folder = join(FIXTURES, 'trials', 'barnard-position-example');
  const sha = (name) => createHash('sha256').update(readFileSync(join(folder, name))).digest('hex');
  const prediction = JSON.parse(readFileSync(join(folder, 'prediction.json'), 'utf8'));
  const receipt = JSON.parse(readFileSync(join(folder, 'receipt.json'), 'utf8'));
  assert.equal(prediction.trial_ref.sha256, sha('trial.json'));
  assert.equal(receipt.prediction_sha256, sha('prediction.json'));
});
