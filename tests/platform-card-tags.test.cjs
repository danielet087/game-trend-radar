const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/domain/index.mjs').RadarData;

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
  assert.equal(D.cardPlatformBadge(unverified).label, '主機');
  assert.match(D.cardPlatformBadge(unverified).title, /已確認平台：NS2。.*尚未確認獨佔/);
});

test('a sole Nintendo platform uses a neutral tag until official exclusivity evidence is verified', () => {
  for (const [code, id] of [['NS', 130], ['NS2', 508]]) {
    const changes = { platforms: [platform(id)], known_platforms: [platform(id)],
      releases: [{ platform: code, date: '2026-11-01', precision: 'day', source: 'IGDB' }] };
    for (const exclusivity of [undefined,
      { status: 'listed_only', platform: code },
      { status: 'confirmed', platform: code },
      { status: 'confirmed', platform: code, url: 'https://www.igdb.com/games/example' },
      { status: 'confirmed', platform: code, url: 'https://example.com/exclusive' }]) {
      const badge = D.cardPlatformBadge(native({ ...changes, exclusivity }));
      assert.equal(badge.label, '主機');
      assert.equal(badge.status, 'nintendo');
      assert.match(badge.title, new RegExp(`已確認平台：${code}。.*尚未確認獨佔`));
    }
    const verified = { ...changes,
      exclusivity: { status: 'confirmed', platform: code, url: 'https://www.nintendo.com/tw/games/example/' } };
    assert.equal(D.cardPlatformBadge(native(verified)).label, `${code} 獨佔`);
    assert.equal(D.cardPlatformBadge(native(verified)).status, 'exclusive');
    const incomplete = D.cardPlatformBadge(native({ ...verified, platform_data_complete: false }));
    assert.equal(incomplete.label, '主機');
    assert.match(incomplete.title, /平台清單或類型仍待確認。.*尚未確認獨佔/);
  }
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
  assert.equal(D.cardPlatformBadge(before).label, '主機');
  const after = native({ platforms: [platform(130), platform(508)], known_platforms: [platform(130), platform(508)],
    releases: [{ platform: 'NS', date: '2026-11-01', precision: 'day', source: 'IGDB' },
      { platform: 'NS2', date: '2027-01-01', precision: 'day', source: 'IGDB' }] });
  assert.equal(D.cardPlatformBadge(after).label, '主機多平台');
  assert.equal(D.gameKey(before), D.gameKey(after));
  assert.deepEqual(after.releasePlatforms, ['NS']);
});

const labels = result => result.chips.map(chip => chip.label);
const released = result => result.chips.filter(chip => chip.released).map(chip => chip.label);

test('platform chips name each known platform in a fixed order and gain a chip when a new version is announced', () => {
  const before = native({ known_platforms: [platform(508)] });
  assert.deepEqual(labels(D.cardPlatformChips(before)), ['NS2']);
  assert.match(D.cardPlatformChips(before).title, /之後可能增加/);
  assert.doesNotMatch(labels(D.cardPlatformChips(before)).join(), /獨佔/);
  // IGDB later lists PS5, Xbox Series and Xbox One: the same game, more chips, one Xbox chip.
  const after = native({ known_platforms: [platform(508), platform(167), platform(169), platform(49)] });
  assert.deepEqual(labels(D.cardPlatformChips(after)), ['NS2', 'PS5', 'Xbox']);
  assert.equal(D.gameKey(before), D.gameKey(after));
  const everywhere = native({ known_platforms: [platform(39), platform(130), platform(508), platform(48), platform(6), platform(14)] });
  assert.deepEqual(labels(D.cardPlatformChips(everywhere)), ['PC', 'NS2', 'NS', 'PS4', '手機']);
  assert.deepEqual(D.cardPlatformChips(everywhere).chips.map(chip => chip.family), ['other', 'nintendo', 'nintendo', 'playstation', 'other']);
});

test('a release event marks only the platforms releasing that day and a verified Steam product replaces PC', () => {
  const nintendo = raw({ websites: [{ url: store }], known_platforms: [platform(508), platform(6), platform(167)],
    platforms: [platform(508), { id: 167, code: 'PS5' }],
    releases: [{ platform: 'NS2', date: '2026-11-01', precision: 'day', source: 'IGDB' },
      { platform: 'PS5', date: '2027-02-01', precision: 'day', source: 'IGDB' }] });
  const result = D.datasets({ games: [{ appid: 10, name: 'Game', followers: 4999, release_start: '2026-10-10' }] }, null, payload(nintendo));
  const ns2 = result.games.find(game => game.date === '2026-11-01');
  const chips = D.cardPlatformChips(ns2, ns2.releasePlatforms);
  assert.deepEqual(labels(chips), ['Steam', 'NS2', 'PS5']);
  assert.deepEqual(released(chips), ['NS2']);
  assert.match(chips.title, /^本次發售：NS2。已確認平台：PC（Steam）／PS5／NS2。/);
  assert.doesNotMatch(chips.scope, /本次發售/);
  assert.deepEqual(released(D.cardPlatformChips(ns2)), []);
});

test('only official sole-platform proof turns a chip into 獨佔, and nothing known reads 平台待確認', () => {
  const proof = { status: 'confirmed', platform: 'NS2', url: 'https://www.nintendo.com/us/store/products/game-switch-2/' };
  const confirmed = D.cardPlatformChips(native({ exclusivity: proof }), ['NS2']);
  assert.deepEqual(labels(confirmed), ['NS2 獨佔']);
  assert.deepEqual(confirmed.chips.map(chip => [chip.exclusive, chip.released]), [[true, true]]);
  assert.deepEqual(labels(D.cardPlatformChips({})), ['平台待確認']);
  assert.equal(D.platformFamily('PS5'), 'playstation');
  assert.equal(D.platformFullNames.NS2, 'Nintendo Switch 2');
});
