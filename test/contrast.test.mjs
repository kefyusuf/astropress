import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Issue #15 kabul kriteri: light + dark tüm metin kombinasyonları WCAG 2.1 AA (≥4.5:1).
// global.css :root değişkenlerini okuyup WCAG göreli luminans formülüyle hesaplar —
// ileride ton değişse de test regresyonu yakalar.
const css = fs.readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');

function lum(hex) {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg, bg) {
  const [l1, l2] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function colorsOf(varName) {
  const m = css.match(new RegExp(`--${varName}: light-dark\\((#[0-9a-fA-F]{6}), (#[0-9a-fA-F]{6})\\)`));
  if (!m) throw new Error(`--${varName} global.css'te bulunamadı`);
  return { light: m[1], dark: m[2] };
}

test('WCAG 2.1 AA: tüm metin kombinasyonları ≥ 4.5:1 (light + dark)', () => {
  const bg = colorsOf('bg');
  const surface = colorsOf('surface');
  const soft = colorsOf('soft');
  const text = colorsOf('text');
  const muted = colorsOf('muted');
  const primary = colorsOf('primary');

  const pairs = [
    ['text/bg', text, bg],
    ['text/soft', text, soft],
    ['text/surface', text, surface],
    ['muted/bg', muted, bg],
    ['muted/soft', muted, soft],
    ['muted/surface', muted, surface],
    ['primary/bg', primary, bg],
    ['primary/soft', primary, soft],
    ['primary/surface', primary, surface],
  ];

  for (const mode of ['light', 'dark']) {
    for (const [name, fg, bgc] of pairs) {
      const r = ratio(fg[mode], bgc[mode]);
      assert.ok(r >= 4.5, `${name} (${mode}) kontrast ${r.toFixed(2)}:1 < 4.5:1`);
    }
  }
});
