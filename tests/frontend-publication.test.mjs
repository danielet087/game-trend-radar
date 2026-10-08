import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const repository = resolve(import.meta.dirname, '..');
const pages = ['index', 'games', 'upcoming', 'released', 'saved', 'date', 'explore', 'game', 'growth', 'analysis', 'twitch', 'scheduler', 'discover'];

test('every published entry references existing compiled assets within the project base', () => {
  for (const page of pages) {
    const html = readFileSync(join(repository, page + '.html'), 'utf8');
    assert.doesNotMatch(html, /(?:src|href)="[^\"]*(?:\/src\/|\.vue(?:\"|\?)|\.ts(?:\"|\?))/);
    assert.doesNotMatch(html, /<script[^>]*radar-(?:data|play|game-detail|twitch|scheduler)-v/);
    if (page !== 'discover') assert.match(html, /<script type="module"[^>]*\/game-trend-radar\/assets\/app\//);
    for (const [, path] of html.matchAll(/(?:src|href)="(\/game-trend-radar\/assets\/app\/[^\"]+)"/g)) {
      assert.ok(existsSync(join(repository, path.replace('/game-trend-radar/', ''))), `${page}: ${path}`);
    }
  }
  assert.match(readFileSync(join(repository, 'scheduler.html'), 'utf8'), /noindex,nofollow/);
});

test('static publication preserves collector data and the previous built release', () => {
  const directory = mkdtempSync(join(tmpdir(), 'radar-publication-'));
  try {
    mkdirSync(join(directory, 'scripts'));
    cpSync(join(repository, 'scripts/publish-static.mjs'), join(directory, 'scripts/publish-static.mjs'));
    for (const path of ['data', 'dist/data', 'dist/assets/app', 'assets/app']) mkdirSync(join(directory, path), { recursive: true });
    writeFileSync(join(directory, 'data/catalog.json'), 'collector-current');
    writeFileSync(join(directory, 'dist/data/catalog.json'), 'build-old');
    writeFileSync(join(directory, 'dist/.nojekyll'), '');
    for (const page of pages) writeFileSync(join(directory, 'dist', page + '.html'), '<p>compiled</p>');
    writeFileSync(join(directory, 'assets/app/previous.js'), 'previous');
    writeFileSync(join(directory, 'assets/app/obsolete.js'), 'obsolete');
    writeFileSync(join(directory, 'assets/app/releases.json'), JSON.stringify([['previous.js'], ['obsolete.js']]));
    writeFileSync(join(directory, 'dist/assets/app/current.js'), 'current');
    const run = () => spawnSync(process.execPath, [join(directory, 'scripts/publish-static.mjs')], { encoding: 'utf8' });
    assert.equal(run().status, 0);
    assert.equal(readFileSync(join(directory, 'data/catalog.json'), 'utf8'), 'collector-current');
    assert.ok(existsSync(join(directory, 'assets/app/previous.js')));
    assert.ok(!existsSync(join(directory, 'assets/app/obsolete.js')));
    const snapshot = readFileSync(join(directory, 'assets/app/releases.json'), 'utf8');
    assert.equal(run().status, 0);
    assert.equal(readFileSync(join(directory, 'assets/app/releases.json'), 'utf8'), snapshot);
    assert.equal(readdirSync(directory).filter(file => file.endsWith('.html')).length, 13);
    // A partial build must not replace an existing live entry.
    rmSync(join(directory, 'dist/date.html'));
    writeFileSync(join(directory, 'dist/index.html'), 'partial');
    assert.notEqual(run().status, 0);
    assert.equal(readFileSync(join(directory, 'index.html'), 'utf8'), '<p>compiled</p>');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
