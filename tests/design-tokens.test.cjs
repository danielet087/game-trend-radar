const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Colors, corner radii and shadows are values only in tokens.css; every other
// stylesheet uses its var(--…) names. This keeps the palette in one place and
// stops new one-off colors, radii and shadows from creeping back in.
const SRC = path.join(__dirname, '..', 'src');
const TOKENS = path.join(SRC, 'shared/styles/tokens.css');
const list = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? list(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const files = list(SRC);
const css = files.filter(file => file.endsWith('.css'));
const scripts = files.filter(file => /\.(ts|js|mjs|vue)$/.test(file));

function declarations(file) {
  const text = fs.readFileSync(file, 'utf8');
  const masked = text.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));
  const found = [];
  for (const match of masked.matchAll(/(?<=[{;])\s*(--[\w-]+|[a-zA-Z-]+)\s*:\s*([^;{}]+?)\s*(?=[;}])/g)) {
    const line = masked.slice(0, match.index + match[0].length).split('\n').length;
    found.push({ prop: match[1], value: match[2], where: `${path.relative(SRC, file)}:${line}` });
  }
  return found;
}
const all = css.flatMap(file => declarations(file).map(item => ({ ...item, file })));
const outside = all.filter(item => item.file !== TOKENS);
const stripVars = value => {
  let previous;
  do { previous = value; value = value.replace(/(?:var|calc)\([^()]*\)/g, ' '); } while (value !== previous);
  return value;
};
const NAMED = /(?<![\w-])(white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|brown|silver|navy|gold|teal|maroon|olive|lime|aqua|fuchsia)(?![\w-])/i;

test('colors are written only in tokens.css', () => {
  const raw = outside.filter(({ value }) => /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(value) ||
    NAMED.test(stripVars(value)));
  assert.deepEqual(raw.map(item => `${item.where} ${item.prop}: ${item.value}`), []);
  const misplaced = declarations(TOKENS).filter(item => !item.prop.startsWith('--') && /#[0-9a-f]{3,8}\b/i.test(item.value));
  assert.deepEqual(misplaced.map(item => item.where), []);
});

test('corners use the three radius steps or a pill', () => {
  const allowed = /^(0|50%|inherit|var\(--radius-(sm|md|lg|pill)\))$/;
  const odd = outside.filter(item => /radius$/.test(item.prop) && !item.prop.startsWith('--') &&
    item.value.split(/\s+/).some(part => !allowed.test(part)));
  assert.deepEqual(odd.map(item => `${item.where} ${item.prop}: ${item.value}`), []);
});

test('shadows use the depth, ring and shadow tokens', () => {
  const odd = outside.filter(item => item.prop === 'box-shadow' &&
    stripVars(item.value).split(/[\s,]+/).some(part => part && !/^(none|inset|0|1px)$/.test(part)));
  assert.deepEqual(odd.map(item => `${item.where} box-shadow: ${item.value}`), []);
});

test('every var(--name) refers to a defined custom property', () => {
  const defined = new Set(all.filter(item => item.prop.startsWith('--')).map(item => item.prop));
  for (const file of scripts) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/['"`]\s*(--[a-z][\w-]*)\s*[:'"`]/g)) defined.add(match[1]);
  }
  const missing = [];
  for (const item of all) {
    for (const match of item.value.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
      if (!match[2] && !defined.has(match[1])) missing.push(`${item.where} ${match[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every palette color in tokens.css is used', () => {
  const tokens = declarations(TOKENS).filter(item => /^--[a-z]+-\d+[b-z]?(-a\d\d)?$|^--[a-z-]+-a\d\d$/.test(item.prop));
  const text = css.map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const unused = tokens.filter(item => !text.includes(`var(${item.prop})`));
  assert.deepEqual(unused.map(item => item.prop), []);
});
