import { readdirSync, copyFileSync, cpSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Keep the existing GitHub Pages main/root source. Only code artifacts move;
// collectors continue publishing data/** directly without a frontend rebuild.
const repository = resolve(import.meta.dirname, '..');
const built = resolve(repository, 'dist');
if (!existsSync(resolve(built, 'index.html'))) throw new Error('Run npm run build before publishing static files.');
const htmlFiles = readdirSync(built).filter(file => file.endsWith('.html'));
if (htmlFiles.length !== 13) throw new Error('Incomplete multi-page build: expected 13 HTML entry points.');
for (const file of htmlFiles) copyFileSync(resolve(built, file), resolve(repository, file));
const appAssets = resolve(repository, 'assets/app');
mkdirSync(appAssets, { recursive: true });
const files = readdirSync(resolve(built, 'assets/app')).sort();
const historyFile = resolve(appAssets, 'releases.json');
let releases = [];
try { releases = JSON.parse(readFileSync(historyFile, 'utf8')); } catch { /* First built release. */ }
if (JSON.stringify(releases[0]) !== JSON.stringify(files)) releases = [files, ...releases].slice(0, 2);
const retained = new Set(releases.flat());
for (const file of readdirSync(appAssets)) {
  if (file !== 'releases.json' && !retained.has(file)) rmSync(resolve(appAssets, file), { force: true });
}
cpSync(resolve(built, 'assets/app'), appAssets, { recursive: true });
writeFileSync(historyFile, JSON.stringify(releases, null, 2) + '\n');
copyFileSync(resolve(built, '.nojekyll'), resolve(repository, '.nojekyll'));
console.log(`Published ${htmlFiles.length} static entry points; public data files were preserved.`);
