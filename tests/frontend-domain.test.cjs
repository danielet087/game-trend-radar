const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const load = () => import(pathToFileURL(path.join(repo, 'src/domain/index.mjs')).href);
const steam = (extra = {}) => ({
  appid: 10, name_en: 'Example', name_zh_tw: '範例',
  release_start: '2026-10-08', release_end: '2026-10-08',
  release_precision: 'day', followers: 6000,
  follower_checked_at: '2026-10-08T00:00:00Z',
  language_support: { tchinese: true, schinese: true, english: true },
  ...extra,
});
const native = (extra = {}) => ({ schema_version: 1, generated_at: '2026-10-08T01:00:00Z', games: [{
  id: 'igdb:30', igdb_id: 30, name_en: 'Example', name_zh_tw: '範例',
  hypes: 35, sexual_content_screened: true,
  checked_at: '2026-10-08T00:30:00Z',
  platforms: [{ code: 'NS2', id: 508 }],
  websites: [{ url: 'https://store.steampowered.com/app/10/' }],
  releases: [{ platform: 'NS2', date: '2026-10-09', precision: 'day', region: 'worldwide', source: 'IGDB' }],
  ...extra,
}] });

test('ES modules preserve the public adapter API and current published datasets', async () => {
  const { RadarData: modular } = await load();
  const baseline = require('../assets/radar-data-v1.js');
  assert.deepEqual(Object.keys(modular).sort(), Object.keys(baseline).sort());
  const read = name => JSON.parse(fs.readFileSync(path.join(repo, 'data', name), 'utf8'));
  const official = read('steam_upcoming.json');
  const preview = read('steam_preview.json');
  const consolePayload = read('nintendo_upcoming.json');
  for (const args of [[official, preview, consolePayload], [null, preview, consolePayload],
    [official, null, null], [null, null, consolePayload], [null, null, null]]) {
    assert.deepEqual(modular.datasets(...args), baseline.datasets(...args));
  }
});

test('all established date, identity, threshold, language, edition and multiplayer rules run against ES modules', async () => {
  const indexURL = pathToFileURL(path.join(repo, 'src/domain/index.mjs')).href;
  const adapterPath = path.join(repo, 'assets/radar-data-v1.js');
  // Run the established behavioral suite against the new facade. The legacy
  // adapter stays intact as a readable reference throughout migration.
  const loader = `import Module from 'node:module'; import { RadarData } from ${JSON.stringify(indexURL)};
    const original = Module._load;
    Module._load = function(request, parent, isMain) {
      if (Module._resolveFilename(request, parent) === ${JSON.stringify(adapterPath)}) return RadarData;
      return original.apply(this, arguments);
    };`;
  const files = fs.readdirSync(__dirname).filter(name => name.endsWith('.test.cjs') &&
    !name.startsWith('frontend-domain') &&
    /require\([^\n]+radar-data-v1/.test(fs.readFileSync(path.join(__dirname, name), 'utf8')));
  assert.ok(files.length >= 10, 'Provider rule regression suites must remain present');
  const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(loader)}`,
    '--test', ...files.map(file => path.join(__dirname, file))], { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('typed boundary separates one game from platform versions and release events', async () => {
  const { normalizeBoundary } = await load();
  const result = normalizeBoundary({ official: {
    generated_at: '2026-10-08T00:00:00Z', games: [steam()],
  }, native: native() });
  assert.equal(result.entities.length, 1);
  const game = result.entities[0];
  assert.equal(game.id, 'steam:10');
  assert.deepEqual(game.identity.igdbIds, [30]);
  assert.deepEqual(game.versions.map(version => version.platform), ['Steam', 'NS2']);
  assert.deepEqual(result.releaseEvents.map(event => [event.platform, event.date]), [
    ['Steam', '2026-10-08'], ['NS2', '2026-10-09'],
  ]);
  assert.deepEqual(game.metrics.map(metric => [metric.provider, metric.kind, metric.value]), [
    ['Steam', 'followers', 6000], ['IGDB', 'hypes', 35],
  ]);
  assert.equal(game.metrics[0].provenance.checkedAt, '2026-10-08T00:00:00Z');
  assert.equal(game.metrics[1].provenance.checkedAt, '2026-10-08T00:30:00Z');
  assert.deepEqual(result.sourceUpdates, {
    steam: '2026-10-08T00:00:00Z', native: '2026-10-08T01:00:00Z', latest: '2026-10-08T01:00:00Z',
  });
  assert.equal(game.versions[1].languageSupport.status, 'unknown');
  assert.equal(game.versions[1].languageSupport.languages.tchinese, null);
});

test('date-only release events retain their day without inventing timestamps or Taiwan confirmation', async () => {
  const { normalizeBoundary } = await load();
  const event = normalizeBoundary({ native: native({ websites: [] }) }).releaseEvents[0];
  assert.equal(event.date, '2026-10-09');
  assert.equal(event.timestamp, null);
  assert.equal(event.sourceTimestamp, null);
  assert.equal(event.timestampTaipeiDate, null);
  assert.equal(event.timeZone, null);
  assert.equal(event.taiwanConfirmed, null);
  assert.equal(event.sourceRegion, 'worldwide');
});

test('the JSON boundary filters invalid collections and preserves exact provider admission gates', async () => {
  const { normalizeBoundary } = await load();
  assert.equal(normalizeBoundary({ official: { games: 'not an array' } }), null);
  assert.equal(normalizeBoundary({ official: [] }), null);
  const result = normalizeBoundary({ official: { games: [null, 'bad', {}, steam(), steam({ appid: 20, followers: 4999 })] } });
  assert.deepEqual(result.entities.map(game => game.id), ['steam:10']);
  assert.deepEqual(normalizeBoundary({ native: native({ sexual_content_screened: false }) }).entities, []);
  assert.deepEqual(normalizeBoundary({ native: native({ hypes: 29 }) }).entities, []);
});

test('older platform releases stay in entity history without entering the admitted calendar scope', async () => {
  const { normalizeBoundary } = await load();
  const oldSteam = steam({ release_start: '2025-10-08', release_end: '2025-10-08',
    followers: 3500, recent_source: 'tracked_release' });
  const result = normalizeBoundary({ official: { games: [] }, preview: { games: [], recent_games: [oldSteam] }, native: native() });
  const event = result.releaseEvents.find(value => value.platform === 'Steam');
  assert.equal(event.date, '2025-10-08');
  assert.deepEqual(event.visibility, { games: false, recent: true });
  assert.equal(result.entities[0].metrics[0].provenance.dataset, 'preview');
});

test('a verified zero follower count remains measured zero while absent source times remain unknown', async () => {
  const { normalizeBoundary } = await load();
  const imported = steam({
    followers: 0, steam_type: 'game', sexual_content_screened: true,
    release_display_precision: 'date_full', release_date_timezone: 'Asia/Taipei',
    release_time_utc: '2026-10-07T16:00:00Z', release_timestamp_taipei_date: '2026-10-08',
    twitch_admission: {
      schema_version: 1, method: 'twitch_igdb_external_steam_v1', appid: 10,
      twitch_game_id: '100', igdb_id: '200', checked_at: '2026-10-08T01:00:00Z',
      source_frontend_commit: 'a'.repeat(40),
      source_enrollment: { source: 'igdb_first_release_date', viewer_count: 7200,
        min_viewers: 7000, observed_at: '2026-10-08T00:00:00Z' },
    },
  });
  const entity = normalizeBoundary({ official: { games: [imported] } }).entities[0];
  assert.deepEqual(entity.metrics.map(metric => [metric.kind, metric.value, metric.status]), [
    ['followers', 0, 'observed'], ['viewers', 7200, 'observed'],
  ]);
  assert.equal(entity.metrics[0].provenance.datasetUpdatedAt, null);
  assert.equal(entity.versions[0].languageSupport.languages.tchinese, true);
  assert.deepEqual(entity.identity.twitchGameIds, ['100']);
});
