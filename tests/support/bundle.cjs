'use strict';
// Bundles one shipped module (with its TypeScript and Vue imports) into a
// script that a test can run in a fresh vm context for every simulated page.
const path = require('node:path');

const repository = path.resolve(__dirname, '..', '..');
const cache = new Map();

function bundle(entry, name) {
  const key = entry + '\0' + name;
  if (!cache.has(key)) cache.set(key, (async () => {
    const [{ build }, { default: vue }] = await Promise.all([import('vite'), import('@vitejs/plugin-vue')]);
    const result = await build({
      configFile: false, logLevel: 'silent', root: repository, plugins: [vue()],
      define: { 'process.env.NODE_ENV': '"production"' },
      build: { write: false, minify: false, emptyOutDir: false, cssCodeSplit: false,
        lib: { entry: path.join(repository, entry), name, formats: ['iife'], fileName: name } },
    });
    const chunk = (Array.isArray(result) ? result : [result]).flatMap(item => item.output)
      .find(item => item.type === 'chunk');
    return chunk.code;
  })());
  return cache.get(key);
}

module.exports = { bundle };
