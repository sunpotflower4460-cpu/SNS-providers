import { readFile } from 'node:fs/promises';

// Every text color token must stay readable (WCAG AA 4.5:1) on every surface token, in
// both the dark and light palettes defined in src/theme.css.
const css = await readFile(new URL('../src/theme.css', import.meta.url), 'utf8');

function block(selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`theme.css is missing ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const vars = {};
  for (const match of css.slice(open + 1, close).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) vars[match[1]] = match[2].trim();
  return vars;
}

const dark = block(':root,\n:root[data-theme="dark"]');
const light = block(':root[data-theme="light"]');
const autoLight = block(':root:not([data-theme="dark"])');
if (JSON.stringify(light) !== JSON.stringify({ ...autoLight })) {
  throw new Error('The manual light palette and the automatic light palette in theme.css have drifted apart.');
}

function hex(value, palette) {
  const resolved = value.startsWith('var(') ? palette[value.slice(6, -1)] : value;
  if (!/^#[0-9a-f]{6}$/i.test(resolved || '')) throw new Error(`Cannot resolve color ${value}`);
  return [1, 3, 5].map((index) => parseInt(resolved.slice(index, index + 2), 16) / 255);
}
function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const texts = ['text', 'text-2', 'muted', 'accent', 'info-text', 'warn-text', 'danger-text'];
const surfaces = ['bg', 'surface', 'surface-2'];
const failures = [];
for (const [name, palette] of [['dark', { ...light, ...dark }], ['light', { ...dark, ...light }]]) {
  for (const text of texts) {
    for (const surface of surfaces) {
      const value = ratio(hex(palette[text], palette), hex(palette[surface], palette));
      if (value < 4.5) failures.push(`${name}: --${text} on --${surface} = ${value.toFixed(2)}`);
    }
  }
  const onAccent = ratio(hex(palette['on-accent'], palette), hex(palette.accent, palette));
  if (onAccent < 4.5) failures.push(`${name}: --on-accent on --accent = ${onAccent.toFixed(2)}`);
}
if (failures.length) throw new Error(`Theme contrast below WCAG AA:\n${failures.join('\n')}`);
console.log('Theme contrast OK: all text tokens reach 4.5:1 on bg/surface/surface-2 in dark and light.');
