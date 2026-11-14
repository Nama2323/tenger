// The public static site (GitHub Pages) has no TENGER server: it must make no live request at all, in particular
// none to spherex-blink.onrender.com, which the team does not run (user's decision, 15 Nov 2026). Running locally
// (same-origin uvicorn backend) keeps live search.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { has, t } from '../static/js/i18n.js';
import * as api from '../static/js/api.js';

const STATIC = fileURLToPath(new URL('../static/', import.meta.url));

/** Runs fn with a pretend page address and a fetch spy; returns the URLs fetched. */
async function onHost(hostname, fn) {
  const saved = { location: globalThis.location, fetch: globalThis.fetch };
  const requested = [];
  globalThis.location = { hostname };
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return { ok: true, status: 200, json: async () => ({ ra: 1, dec: 2, id: 'x' }), arrayBuffer: async () => new ArrayBuffer(8) };
  };
  try {
    await fn();
  } finally {
    globalThis.location = saved.location;
    globalThis.fetch = saved.fetch;
  }
  return requested;
}

test('on github.io no live call makes any request; each says live search is unavailable', async () => {
  const requested = await onHost('nama2323.github.io', async () => {
    assert.equal(api.liveAvailable(), false);
    for (const call of [() => api.observe(150.1, 2.2, 0.1), () => api.resolveName('M31'), () => api.getGaia(1, 2, 0.1), () => api.jobStatus('x'), () => api.parsePosition('10 20')]) {
      await assert.rejects(call(), (error) => error.liveUnavailable === true);
    }
  });
  assert.deepEqual(requested, [], 'nothing fetched');
});

test('running locally keeps live search, on this same origin and never on another host', async () => {
  for (const hostname of ['localhost', '127.0.0.1', '192.168.1.20']) {
    const requested = await onHost(hostname, async () => {
      assert.equal(api.liveAvailable(), true);
      await api.observe(150.1, 2.2, 0.1);
    });
    assert.deepEqual(requested, ['/api/observe?ra=150.1&dec=2.2&fov=0.1'], hostname);
  }
});

test('no file the site serves names onrender.com; the note says what works', () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.(html|js|mjs|css|json)$/.test(entry.name)) files.push(path);
    }
  };
  walk(STATIC.replace(/\/$/, ''));
  assert.deepEqual(files.filter((path) => /onrender\.com/i.test(readFileSync(path, 'utf8'))), []);
  assert.ok(has('note.liveUnavailable'));
  assert.equal(t('note.liveUnavailable'), 'Live search needs the TENGER server, which is not running on this public site; the prepared targets work.');
});
