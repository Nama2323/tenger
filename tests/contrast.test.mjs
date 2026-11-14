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

test('the tokens are the ones agreed in the plan', () => {
  assert.equal(token('bg'), '#05070d');
  assert.equal(token('panel'), '#0a0f1a');
  assert.equal(token('card'), '#0f1726');
  assert.equal(token('ink'), '#e6edf7');
});

test('text and category colours reach 4.5:1 on every surface', () => {
  const surfaces = ['bg', 'panel', 'card'];
  const foregrounds = ['ink', 'dim', 'star', 'variable', 'solar', 'hypothetical', 'other', 'ok', 'bad', 'warn'];
  for (const surface of surfaces) {
    for (const foreground of foregrounds) {
      const ratio = contrast(token(foreground), token(surface));
      assert.ok(ratio >= 4.5, `--${foreground} on --${surface}: ${ratio.toFixed(2)}`);
    }
  }
});

test('dark text on the amber buttons reaches 4.5:1', () => {
  assert.ok(contrast(token('on-accent'), token('star')) >= 4.5);
});

test('the example banner text is readable', () => {
  assert.ok(contrast(token('ink'), '#241a06') >= 4.5);
  assert.ok(contrast(token('warn'), '#241a06') >= 4.5);
});
