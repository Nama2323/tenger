import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// WCAG 2 contrast of the design tokens in style.css. Text needs 4.5:1; the category colours are also used
// as text (names, labels), so they meet 4.5:1 on every surface too.
const css = readFileSync(new URL('../static/css/style.css', import.meta.url), 'utf8');
const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
const token = (name) => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(root);
  assert.ok(match, `token --${name}`);
  return match[1];
};

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(first, second) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

test('the tokens are the R1 design system', () => {
  const expected = {
    bg: '#05070d', panel: '#0a0f1a', border: '#1e2738', text: '#e6edf7', muted: '#8d9bb0', accent: '#5cc8ff',
    star: '#ffe08a', variable: '#c9a0ff', solar: '#5cc8ff', hypothetical: '#ffa94d', hit: '#5fd38d', miss: '#ffb547', waiting: '#8d9bb0',
  };
  for (const [name, value] of Object.entries(expected)) assert.equal(token(name), value, `--${name}`);
});

test('text, accent, category and verdict colours reach 4.5:1 on every surface', () => {
  const surfaces = ['bg', 'panel', 'raise'];
  const foregrounds = ['text', 'muted', 'accent', 'star', 'variable', 'solar', 'hypothetical', 'other', 'hit', 'miss', 'waiting', 'bad'];
  for (const surface of surfaces) {
    for (const foreground of foregrounds) {
      const ratio = contrast(token(foreground), token(surface));
      assert.ok(ratio >= 4.5, `--${foreground} on --${surface}: ${ratio.toFixed(2)}`);
    }
  }
});

test('dark text on accent buttons reaches 4.5:1', () => {
  assert.ok(contrast(token('on-accent'), token('accent')) >= 4.5);
});

test('the example banner text is readable', () => {
  assert.ok(contrast(token('text'), '#2a1c05') >= 4.5);
  assert.ok(contrast(token('miss'), '#2a1c05') >= 4.5);
});
