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

// The team's logo files (task B27 logo swap): copied unchanged into static/img/, each used where its README says.
test('the header, tab, home-screen and manifest icons and the printed lessons use the team logo files', () => {
  const html = read('static/index.html');
  assert.match(html, /<img class="brand-logo" src="img\/vestigium-logo-white\.png" alt="Vestigium"/);
  assert.match(html, /<link rel="icon" href="img\/favicon\.svg" type="image\/svg\+xml">/);
  assert.match(html, /<link rel="icon" href="img\/favicon-32\.png" sizes="32x32" type="image\/png">/);
  assert.match(html, /<link rel="apple-touch-icon" href="img\/favicon-180\.png">/);
  const icons = JSON.parse(read('static/site.webmanifest')).icons.map((icon) => [icon.src, icon.sizes]);
  assert.deepEqual(icons, [['img/favicon-192.png', '192x192'], ['img/favicon-512.png', '512x512']]);
  assert.match(read('static/js/learn-ui.js'), /img\/vestigium-logo-navy\.png/);
  for (const [path, width, height] of [
    ['static/img/vestigium-logo-white.png', 712, 176], ['static/img/vestigium-logo-navy.png', 712, 176], ['static/img/favicon-32.png', 32, 32],
    ['static/img/favicon-180.png', 180, 180], ['static/img/favicon-192.png', 192, 192], ['static/img/favicon-512.png', 512, 512], ['static/og.png', 1200, 630],
  ]) {
    assert.ok(existsSync(new URL(path, ROOT)), path);
    const png = readFileSync(new URL(path, ROOT));
    assert.equal(png.readUInt32BE(16), width, `${path} width`);
    assert.equal(png.readUInt32BE(20), height, `${path} height`);
  }
  for (const path of ['static/img/favicon.svg', 'static/img/vestigium-mark-white.svg']) {
    const svg = read(path);
    assert.ok(svg.startsWith('<svg') && !/script|href|foreignObject/i.test(svg), path);
  }
});
