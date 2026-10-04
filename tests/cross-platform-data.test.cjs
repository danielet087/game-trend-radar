const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../assets/radar-data-v1.js');
const steam = (changes = {}) => ({
  appid: 3161310, name_en: 'Hela', name_zh_tw: 'Hela：鼠鼠奇旅', followers: 39021,
  release_start: '2026-12-01', language_support: { tchinese: true, schinese: true },
  header_image: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3161310/header.jpg',
  ...changes,
});
const nintendo = (changes = {}) => ({
  id: 'igdb:314449', igdb_id: 314449, name_en: 'Hela: Of Mice & Magic', name_zh_tw: 'Hela：鼠鼠奇旅',
  sexual_content_screened: true, hypes: 46, platform_data_complete: true,
  platforms: [{ id: 508, code: 'NS2' }],
  known_platforms: [{ id: 6, name: 'PC' }, { id: 508, code: 'NS2' }],
  exclusivity: { status: 'multi_platform' },
  releases: [{ date: '2026-12-01', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB' }],
  websites: [{ url: 'https://store.steampowered.com/app/3161310/Hela/' }],
  url: 'https://www.igdb.com/games/hela-of-mice-and-magic',
  cover_image: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co123.jpg',
  ...changes,
});
const payload = (games) => ({ schema_version: 1, games });
const data = (s = steam(), n = nintendo()) => D.datasets({ games: [s] }, null, payload([n]));

test('Hela exact Steam product identity merges a same-day Nintendo event without mixing community counts', () => {
  const result = data();
  assert.equal(result.games.length, 1);
  assert.equal(result.recent.length, 1);
  const game = result.games[0];
  assert.equal(game.source, 'steam');
  assert.equal(game.appid, 3161310);
  assert.equal(game.igdbId, 314449);
  assert.equal(game.followers, 39021);
  assert.equal(game.hypes, 46);
  assert.equal(game.art, steam().header_image);
  assert.deepEqual(game.releasePlatforms, ['Steam', 'NS2']);
  assert.deepEqual(game.platformBadges.map(badge => badge.label), ['Steam', 'NS2', '多平台']);
  assert.equal(game.dateReleases.length, 2);
  assert.equal(game.languages.tchinese, true);
  assert.equal(game.languageBadges[0].label, '支援繁中');
  assert.equal(D.detailURL(game), './game.html?appid=3161310&date=2026-12-01');
});

test('different platform dates remain independent calendar events and consolidate only after list filters', () => {
  const result = data(steam({ release_start: '2026-10-09' }), nintendo({ releases: [
    { date: '2026-10-08', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB' },
  ] }));
  assert.deepEqual(result.games.map(game => game.date), ['2026-10-08', '2026-10-09']);
  const ns = D.selectGames(result, 'date', '2026-10-04', '2026-10-08')[0];
  const pc = D.selectGames(result, 'date', '2026-10-04', '2026-10-09')[0];
  assert.deepEqual(ns.releasePlatforms, ['NS2']);
  assert.deepEqual(pc.releasePlatforms, ['Steam']);
  assert.equal(ns.dateRegion, 'worldwide');
  assert.equal(ns.dateSource, 'IGDB');
  assert.equal(pc.dateSource, 'Steam');
  assert.equal(ns.releases.length, 2);
  assert.equal(D.cardGames(D.selectGames(result, 'all', '2026-10-04')).length, 1);
  assert.equal(D.cardGames(result.games)[0].date, '2026-10-08');
  assert.equal(D.cardGames(result.games.filter(game => game.date >= '2026-10-09'))[0].date, '2026-10-09');
  assert.equal(D.cardGames(D.selectGames(result, 'released', '2026-10-08'))[0].date, '2026-10-08');
  assert.equal(D.cardGames(D.selectGames(result, 'upcoming', '2026-10-09'))[0].date, '2026-10-09');
});

test('matching titles, numeric coincidences and unsupported identity claims never merge games', () => {
  for (const changes of [
    { websites: [] },
    { websites: [], steam_appid: 3161310 },
    { igdb_id: 3161310, id: 'igdb:3161310', websites: [] },
    { websites: [{ url: 'https://store.steampowered.com/search/?term=Hela' }] },
    { websites: [{ url: 'https://store.steampowered.com/app/31613100/Hela/' }] },
  ]) {
    const result = data(steam(), nintendo(changes));
    assert.equal(result.games.length, 2, JSON.stringify(changes));
    assert.equal(D.cardGames(result.games).length, 2, JSON.stringify(changes));
  }
});

test('latest scoped card representatives sort correctly around an intermediate release', () => {
  const result = data(steam({ release_start: '2026-10-09' }), nintendo({ releases: [
    { date: '2026-10-07', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB' },
  ] }));
  const intermediate = D.normalize(steam({ appid: 99, name_en: 'Intermediate', release_start: '2026-10-08' }));
  const items = [...result.games, intermediate];
  assert.deepEqual(D.cardGames(items, 'latest').sort((a, b) => b.date.localeCompare(a.date))
    .map(game => [game.appid, game.date]), [[3161310, '2026-10-09'], [99, '2026-10-08']]);
  assert.deepEqual(D.cardGames(items).sort((a, b) => a.date.localeCompare(b.date))
    .map(game => [game.appid, game.date]), [[3161310, '2026-10-07'], [99, '2026-10-08']]);
  const released = D.selectGames({ ...result, recent: items }, 'released', '2026-10-08');
  assert.equal(D.cardGames(released, 'latest').find(game => game.appid === 3161310).date, '2026-10-07');
});

test('Steam identity rejects unsafe origins, credentials, malformed IDs and conflicting product evidence', () => {
  for (const url of [
    'http://store.steampowered.com/app/3161310/',
    'https://store.steampowered.com.evil.test/app/3161310/',
    'https://evil.test/store.steampowered.com/app/3161310/',
    'https://user:pass@store.steampowered.com/app/3161310/',
    'https://store.steampowered.com:444/app/3161310/',
    'https://store.steampowered.com/app/03161310/',
    'https://store.steampowered.com/app/9007199254740993/',
    'https://store.steampowered.com/app/3161310/Hela/other',
    'javascript:alert(3161310)',
  ]) assert.equal(D.nintendoSteamIdentity(nintendo({ websites: [{ url }] })), null, url);
  assert.equal(D.nintendoSteamIdentity(nintendo({ steam_appid: 10 })), null);
  assert.equal(D.nintendoSteamIdentity(nintendo({ steam_appid: 'bad' })), null);
  assert.equal(D.nintendoSteamIdentity(nintendo({ websites: [
    ...nintendo().websites, { url: 'https://store.steampowered.com/app/10/' },
  ] })), null);
  assert.equal(D.nintendoSteamIdentity(nintendo({ steam_appid: '3161310', websites: [
    ...nintendo().websites, { url: 'https://store.steampowered.com/app/3161310/?utm_source=igdb' },
  ] })), 3161310);
});

test('an unadmitted Steam listing adds no Steam date or Followers to the Nintendo calendar', () => {
  const result = data(steam({ release_start: '2026-12-01', followers: 4999 }));
  const game = result.games[0];
  assert.equal(result.games.length, 1);
  assert.equal(game.source, 'nintendo');
  assert.equal(game.appid, 'igdb:314449');
  assert.equal(game.steamAppid, 3161310);
  assert.equal(game.followers, null);
  assert.equal(game.hypes, 46);
  assert.deepEqual(game.platforms, ['NS2']);
  assert.deepEqual(game.releasePlatforms, ['NS2']);
  assert.ok(game.releases.every(release => release.platform === 'NS2'));
  assert.deepEqual(game.platformBadges.map(badge => badge.label), ['NS2', '多平台']);
});

test('old Nintendo saved IDs and Steam saved IDs both recognize the merged card', () => {
  const game = data().games[0];
  assert.equal(D.saveID(game), 3161310);
  assert.equal(D.isSaved(game, new Set(['igdb:314449'])), true);
  assert.equal(D.isSaved(game, new Set([3161310])), true);
  assert.equal(D.isSaved(game, new Set([314449])), false);
  assert.equal(D.isSaved(game, new Set(['igdb:3161310'])), false);
});

test('all native NS/NS2 dates and safe aliases survive multiple verified Nintendo records', () => {
  const second = nintendo({ id: 'igdb:314450', igdb_id: 314450,
    platforms: [{ id: 130, code: 'NS' }], releases: [
      { date: '2026-12-02', platform: 'NS', precision: 'day', region: 'japan', source: 'IGDB' },
      { date: '2026-12-01', platform: 'NS', precision: 'month', region: 'worldwide', source: 'IGDB' },
    ] });
  const result = D.datasets({ games: [steam()] }, null, payload([nintendo(), second]));
  assert.equal(result.games.length, 2);
  assert.equal(D.cardGames(result.games).length, 1);
  assert.deepEqual(result.games[0].platforms, ['Steam', 'NS', 'NS2']);
  assert.deepEqual(result.games[1].releasePlatforms, ['NS']);
  assert.ok(result.games[0].releases.every(release => release.precision === 'day'));
  assert.equal(D.isSaved(result.games[1], new Set(['igdb:314450'])), true);
  assert.deepEqual(result.games[0].igdbIds, [314449, 314450]);
});
