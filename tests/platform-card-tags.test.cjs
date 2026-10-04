const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../assets/radar-data-v1.js');

const platform = id => ({ id, ...(id === 130 ? { code: 'NS' } : id === 508 ? { code: 'NS2' } : {}), name: `Platform ${id}` });
const raw = (changes = {}) => ({ id: 'igdb:1', igdb_id: 1, name_en: 'Game', hypes: 40, sexual_content_screened: true,
  platforms: [platform(508)], known_platforms: [platform(508)], platform_data_complete: true,
  releases: [{ platform: 'NS2', date: '2026-11-01', precision: 'day', source: 'IGDB' }], ...changes });
const payload = (...games) => ({ schema_version: 1, games });
const native = changes => D.nintendoGames(payload(raw(changes)))[0];
const store = 'https://store.steampowered.com/app/10/';

test('verified PC evidence does not depend on the Steam admission threshold or current release platform', () => {
  const nintendo = raw({ websites: [{ url: store }] });
  const result = D.datasets({ games: [{ appid: 10, name: 'Game', followers: 4999, release_start: '2026-10-10' }] }, null, payload(nintendo));
  const [game] = result.games;
  assert.equal(game.source, 'nintendo');
  assert.deepEqual(game.releasePlatforms, ['NS2']);
  assert.equal(D.cardPlatformBadge(game).label, 'PC＋主機');
  assert.match(D.cardPlatformBadge(game).title, /PC（Steam）.*NS2/);
  const unverified = native({ steam_appid: 10, websites: [] });
  assert.equal(D.cardPlatformBadge(unverified).label, 'NS2');
});

test('Windows, Mac and Linux establish PC while hover keeps all confirmed platforms', () => {
  const game = native({ known_platforms: [6, 14, 3, 508, 167, 169, 39].map(platform) });
  const badge = D.cardPlatformBadge(game);
  assert.equal(badge.label, 'PC＋主機');
  assert.match(badge.title, /PC（Windows）.*Mac.*Linux.*PS5.*Xbox Series X\|S.*NS2.*iOS/);
});

test('console-only tags require a complete console list and do not misclassify mobile or unknown types', () => {
  const consoles = [508, 167, 169].map(platform);
  assert.equal(D.cardPlatformBadge(native({ known_platforms: consoles })).label, '主機多平台');
  assert.equal(D.cardPlatformBadge(native({ known_platforms: consoles, platform_data_complete: false })).label, '平台待確認');
  const mobile = native({ known_platforms: [...consoles, platform(39)] });
  assert.equal(D.cardPlatformBadge(mobile).label, '平台待確認');
  assert.match(D.cardPlatformBadge(mobile).title, /iOS/);
  const unknown = native({ known_platforms: [...consoles, { id: 99999, name: 'Other system' }] });
  assert.equal(D.cardPlatformBadge(unknown).label, '平台待確認');
  assert.match(D.cardPlatformBadge(unknown).title, /Other system（類型待確認）/);
});

test('an inconsistent complete flag cannot claim console-only or exclusive availability', () => {
  const game = native({ known_platforms: [platform(167), platform(169)], platform_data_complete: true });
  assert.equal(game.platformDataComplete, null);
  assert.equal(D.cardPlatformBadge(game).label, '平台待確認');
  assert.match(D.cardPlatformBadge(game).title, /平台清單或類型仍待確認/);
});

test('backward compatibility does not create a native NS2 version and verified exclusivity stays intact', () => {
  const game = native({ platforms: [platform(130)], known_platforms: [platform(130)],
    releases: [{ platform: 'NS', date: '2026-11-01', precision: 'day', source: 'IGDB' }],
    compatible_platforms: [platform(508)], backwards_compatible: ['NS2'],
    exclusivity: { status: 'confirmed', platform: 'NS', url: 'https://www.nintendo.com/tw/games/example/' } });
  assert.deepEqual(game.platforms, ['NS']);
  assert.equal(D.cardPlatformBadge(game).label, 'NS 獨佔');
  assert.doesNotMatch(D.cardPlatformBadge(game).title, /NS2/);
  assert.equal(D.cardPlatformBadge(D.normalize({ appid: 10, name: 'Steam Game', followers: 6000, release_start: '2026-11-01' })).label, 'Steam');
});

test('missing or partial multi-platform evidence stays unknown without enumerating invented platforms', () => {
  assert.equal(D.cardPlatformBadge({}).label, '平台待確認');
  const game = native({ platforms: [platform(130), platform(508)], known_platforms: undefined, platform_data_complete: undefined });
  assert.equal(game.platformDataComplete, null);
  assert.equal(D.cardPlatformBadge(game).label, '平台待確認');
  assert.doesNotMatch(D.cardPlatformBadge(game).title, /PS5|Xbox|PC/);
});

test('merged known platform sets are a union and conflicting completeness is preserved as unknown', () => {
  const first = raw({ known_platforms: [platform(6), platform(508)], websites: [{ url: store }] });
  const second = raw({ id: 'igdb:2', igdb_id: 2, platforms: [platform(130)],
    known_platforms: [platform(6), platform(130), platform(167)], platform_data_complete: false,
    releases: [{ platform: 'NS', date: '2026-11-02', precision: 'day', source: 'IGDB' }], websites: [{ url: store }] });
  for (const platform_data_complete of [false, true]) {
    const result = D.datasets({ games: [{ appid: 10, name: 'Game', followers: 6000, release_start: '2026-10-31' }] },
      null, payload(first, { ...second, platform_data_complete }));
    for (const game of result.games) {
      assert.deepEqual(game.knownPlatforms.map(row => row.id), [6, 130, 167, 508]);
      assert.equal(game.platformDataComplete, null);
      assert.equal(D.cardPlatformBadge(game).label, 'PC＋主機');
      assert.match(D.cardPlatformBadge(game).title, /PS5.*NS.*NS2/);
    }
  }
});

test('later native platform additions update the whole-game badge without shifting event identity', () => {
  const before = native({ platforms: [platform(130)], known_platforms: [platform(130)],
    releases: [{ platform: 'NS', date: '2026-11-01', precision: 'day', source: 'IGDB' }] });
  assert.equal(D.cardPlatformBadge(before).label, 'NS');
  const after = native({ platforms: [platform(130), platform(508)], known_platforms: [platform(130), platform(508)],
    releases: [{ platform: 'NS', date: '2026-11-01', precision: 'day', source: 'IGDB' },
      { platform: 'NS2', date: '2027-01-01', precision: 'day', source: 'IGDB' }] });
  assert.equal(D.cardPlatformBadge(after).label, '主機多平台');
  assert.equal(D.gameKey(before), D.gameKey(after));
  assert.deepEqual(after.releasePlatforms, ['NS']);
});
