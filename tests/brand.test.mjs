// Task B14: the visible brand is Vestigium. No user-facing string, page title, link preview, manifest or README
// text says TENGER. Not checked, on purpose: the repository name and web address (nama2323.github.io/tenger),
// frozen trial files, storage keys, schema names, file paths, version identifiers and code comments.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { englishKeys, t } from '../static/js/i18n.js';

const ROOT = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');
const OLD = /TENGER|Tenger/;
const BRAND = 'Vestigium';

test('no English string says TENGER, and the site title is Vestigium', () => {
  assert.equal(t('site.title'), BRAND);
  const old = englishKeys().filter((key) => OLD.test(t(key)));
  assert.deepEqual(old, [], `strings still naming TENGER: ${old.join(', ')}`);
  // Session A's resource file for data-driven text (DATA-CONTRACT strings) is user-facing too.
  const data = JSON.parse(read('static/data/strings.en.json'));
  const values = JSON.stringify(data.strings ?? data);
  assert.ok(!OLD.test(values), 'static/data/strings.en.json names TENGER');
});

test('the page title, link preview and manifest say Vestigium', () => {
  const html = read('static/index.html').replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!OLD.test(html), 'index.html (outside comments) names TENGER');
  assert.match(html, /<title>Vestigium<\/title>/);
  assert.match(html, /<meta property="og:site_name" content="Vestigium">/);
  assert.match(html, /<meta property="og:title" content="Vestigium[^"]*">/);
  const manifest = JSON.parse(read('static/site.webmanifest'));
  assert.equal(manifest.name, BRAND);
  assert.equal(manifest.short_name, BRAND);
  assert.match(html, /<link rel="manifest" href="site\.webmanifest">/);
});

test('the README is titled Vestigium and keeps the tenger address only as the repository name', () => {
  const readme = read('README.md');
  assert.match(readme, /^# Vestigium\b/);
  assert.ok(!OLD.test(readme), 'README.md names TENGER');
});

test('the logo is one file: header, favicon and manifest use img/logo.svg; its renders exist', () => {
  const html = read('static/index.html');
  assert.match(html, /<img class="brand-mark" src="img\/logo\.svg"/);
  assert.match(html, /<link rel="icon" href="img\/logo\.svg" type="image\/svg\+xml">/);
  assert.match(html, /<link rel="apple-touch-icon" href="img\/apple-touch-icon\.png">/);
  assert.ok(JSON.parse(read('static/site.webmanifest')).icons.some((icon) => icon.src === 'img/logo.svg'));
  assert.ok(read('static/img/logo.svg').startsWith('<svg'));
  for (const [path, width, height] of [['static/img/apple-touch-icon.png', 180, 180], ['static/og.png', 1200, 630]]) {
    assert.ok(existsSync(new URL(path, ROOT)), path);
    const png = readFileSync(new URL(path, ROOT));
    assert.equal(png.readUInt32BE(16), width, `${path} width`);
    assert.equal(png.readUInt32BE(20), height, `${path} height`);
  }
});
