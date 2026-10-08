const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = () => import(pathToFileURL(path.resolve(__dirname, '../src/data/publication.mjs')).href);

test('newer accepted catalog preserves its whole qualification/date row against old detail copies', async () => {
  const { detailCatalog } = await load();
  const row = { appid: 10, followers: 5000, release_start: '2026-10-09',
    release_precision: 'day', name: 'Current name', sexual_content_screened: true,
    language_support: { tchinese: false }, categories: [] };
  const catalog = { generated_at: '2026-10-08T02:00:00Z', games: [row] };
  const raw = { appid: 10, followers: 10000, release_start: '2026-10-08',
    release_date_conflict: true, twitch_admission: { invalid: true },
    sexual_content_screened: false, name: 'Old name',
    language_support: { tchinese: true }, categories: [{ id: 1 }],
    short_description: 'Description', short_description_language: 'zh-TW' };
  const original = JSON.stringify({ catalog, raw });
  const result = detailCatalog(catalog, raw, 10);
  assert.deepEqual(result.games[0], { short_description: 'Description',
    short_description_language: 'zh-TW', ...row });
  assert.equal(result.generated_at, catalog.generated_at);
  assert.equal(JSON.stringify({ catalog, raw }), original);
});

test('an AppID detail file cannot re-add a game removed from the authoritative public catalog', async () => {
  const { detailCatalog } = await load();
  const catalog = { games: [] };
  assert.equal(detailCatalog(catalog, { appid: 10, followers: 10000, release_start: '2026-10-08' }, 10), catalog);
});

test('catalog-provided descriptions remain authoritative while unavailable catalog permits valid direct detail', async () => {
  const { detailCatalog } = await load();
  const raw = { appid: 10, short_description: 'Old', content_enriched_at: '2026-10-08T00:00:00Z' };
  const catalog = { games: [{ appid: 10, short_description: 'Current' }] };
  assert.equal(detailCatalog(catalog, raw, 10).games[0].short_description, 'Current');
  assert.deepEqual(detailCatalog(null, raw, '10'), { generated_at: raw.content_enriched_at, games: [raw] });
  assert.equal(detailCatalog(null, raw, 20), null);
  assert.equal(detailCatalog(null, { appid: true }, 1), null);
  assert.equal(detailCatalog(null, { appid: '010' }, 10), null);
});

test('declared revision conflict rejects supplementary detail; absent revision is unknown and timestamps are not revisions', async () => {
  const { detailCatalog, knownPublicationConflict } = await load();
  const catalog = { revision: 'new', generated_at: '2026-10-08T02:00:00Z', games: [{ appid: 10 }] };
  assert.equal(knownPublicationConflict(catalog, { catalog_revision: 'old' }), true);
  assert.equal(knownPublicationConflict(catalog, {}), false);
  assert.equal(detailCatalog(catalog, { appid: 10, catalog_revision: 'old', short_description: 'Old' }, 10), catalog);
  assert.equal(detailCatalog(catalog, { appid: 10, revision: 'new', short_description: 'Same' }, 10).games[0].short_description, 'Same');
  assert.equal(detailCatalog(catalog, { appid: 10, generated_at: '2026-10-08T01:00:00Z', short_description: 'Unversioned' }, 10).games[0].short_description, 'Unversioned');
});

test('existing catalog and AppID files remain readable without requiring nonexistent revision fields', async () => {
  const { detailCatalog } = await load();
  const catalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/catalog.json'), 'utf8'));
  const row = catalog.games.find(game => fs.existsSync(path.resolve(__dirname, `../data/games/${game.appid}.json`)));
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../data/games/${row.appid}.json`), 'utf8'));
  const result = detailCatalog(catalog, raw, row.appid);
  assert.equal(result.games.length, catalog.games.length);
  const merged = result.games.find(game => game.appid === row.appid);
  for (const [key, value] of Object.entries(row)) assert.deepEqual(merged[key], value, key);
  assert.equal(merged.short_description, row.short_description ?? raw.short_description);
});
