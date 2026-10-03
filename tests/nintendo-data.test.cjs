const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../assets/radar-data-v1.js');
const R = require('../assets/radar-discovery-v1.js');
const platform = (code) => ({ id: code === 'NS' ? 130 : 508, code, name: code === 'NS' ? 'Nintendo Switch' : 'Nintendo Switch 2' });
const row = (changes = {}) => ({
  id: 'igdb:366896', igdb_id: 366896, name_en: 'Fire Emblem: Fortune’s Weave', hypes: 45,
  sexual_content_screened: true, platform_data_complete: true,
  platforms: [platform('NS2')], known_platforms: [platform('NS2')],
  exclusivity: { status: 'listed_only', platform: 'NS2' },
  releases: [{ date: '2027-03-20', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB' }],
  url: 'https://www.igdb.com/games/fire-emblem-fortunes-weave',
  cover_image: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1234.jpg',
  ...changes,
});
const payload = (games) => ({ schema_version: 1, generated_at: '2026-10-03T16:00:00Z', games });

test('Nintendo uses hypes ≥ 30 and requires confirmed native platforms, exact dates and content screening', () => {
  assert.equal(D.nintendoGames(payload([row({ hypes: 30 })])).length, 1);
  for (const changes of [{ hypes: 29 }, { hypes: null }, { hypes: '45' }, { hypes: true },
    { hypes: -1 }, { sexual_content_screened: false }, { sexual_content_screened: null },
    { igdb_id: 10 }, { id: '366896' }, { platforms: [{ id: 130, code: 'NS2' }] },
    { releases: [{ date: '2027-03-20', platform: 'NS', precision: 'day' }] },
    { releases: [{ date: '2027-03-20', platform: 'NS2', precision: 'month' }] },
    { releases: [{ date: '2027-02-29', platform: 'NS2', precision: 'day' }] }])
    assert.deepEqual(D.nintendoGames(payload([row(changes)])), [], JSON.stringify(changes));
  assert.deepEqual(D.nintendoGames({ games: [row()] }), []);
});

test('same-day NS and NS2 releases merge; later native platform ports retain their own calendar date', () => {
  const game = row({ platforms: [platform('NS'), platform('NS2')], known_platforms: [platform('NS'), platform('NS2')],
    exclusivity: { status: 'multi_platform' }, releases: [
      { date: '2027-03-20', platform: 'NS', precision: 'day', region: 'worldwide' },
      { date: '2027-03-20', platform: 'NS2', precision: 'day', region: 'worldwide' },
      { date: '2027-03-20', platform: 'NS2', precision: 'day', region: 'worldwide' },
      { date: '2027-04-01', platform: 'NS2', precision: 'day', region: 'japan' },
    ] });
  const data = D.datasets(null, null, payload([game]));
  assert.equal(data.games.length, 2);
  assert.deepEqual(data.games[0].releasePlatforms, ['NS', 'NS2']);
  assert.deepEqual(data.games[1].releasePlatforms, ['NS2']);
  assert.equal(data.games[0].appid, data.games[1].appid);
  assert.notEqual(data.games[0].key, data.games[1].key);
  assert.equal(D.selectGames(data, 'date', '2026-10-04', '2027-04-01').length, 1);
  assert.match(D.detailURL(data.games[1]), /igdb=366896&date=2027-04-01$/);
});

test('only complete sole-platform records with official Nintendo evidence receive exclusive labels', () => {
  const listed = D.nintendoGames(payload([row()]))[0];
  assert.equal(listed.platformLabel, 'NS2（目前僅此平台）');
  assert.equal(listed.platformShort, 'NS2');
  assert.doesNotMatch(listed.platformLabel, /獨佔/);
  const proof = { status: 'confirmed', platform: 'NS2', url: 'https://www.nintendo.com/us/store/products/fire-emblem-fortunes-weave-switch-2/' };
  const confirmed = D.nintendoGames(payload([row({ exclusivity: proof })]))[0];
  assert.equal(confirmed.platformLabel, 'NS2 獨佔');
  for (const changes of [{ platform_data_complete: false }, { known_platforms: [] },
    { known_platforms: [platform('NS2'), { id: 6, name: 'PC (Microsoft Windows)' }] },
    { exclusivity: { ...proof, url: 'https://www.igdb.com/games/fire-emblem-fortunes-weave' } },
    { exclusivity: { ...proof, url: 'https://nintendo.com.evil.test/' } },
    { exclusivity: { ...proof, platform: 'NS' } }]) {
    assert.doesNotMatch(D.nintendoGames(payload([row({ exclusivity: proof, ...changes })]))[0].platformLabel, /獨佔/);
  }
  const multiple = D.nintendoGames(payload([row({ known_platforms: [platform('NS2'), { id: 6, name: 'PC' }], exclusivity: { status: 'multi_platform' } })]))[0];
  assert.equal(multiple.platformLabel, 'NS2・多平台');
});

test('Nintendo identity, localized names and links cannot collide with a Steam AppID', () => {
  const steam = { appid: 366896, name: 'Steam game', release_start: '2027-03-20', followers: 5000 };
  const data = D.datasets({ games: [steam] }, null, payload([row({ name_zh_tw: '繁體標題', name_zh_cn_traditional: '轉繁標題' })]));
  assert.equal(data.games.length, 2);
  const nintendo = data.games.find(game => game.source === 'nintendo');
  assert.equal(nintendo.name, '繁體標題');
  assert.equal(nintendo.followers, null);
  assert.equal(nintendo.hypes, 45);
  assert.equal(D.saveID(nintendo), 'igdb:366896');
  assert.equal(D.savedID('igdb:366896'), 'igdb:366896');
  assert.equal(D.savedID(366896), 366896);
  assert.equal(D.savedID('igdb:0'), null);
  assert.equal(nintendo.link, row().url);
  assert.equal(nintendo.art, row().cover_image);
  assert.equal(D.nintendoURL('javascript:alert(1)'), '');
  assert.equal(D.nintendoURL('https://images.igdb.com.evil.test/a.jpg', 'image'), '');
  assert.equal(D.nintendoURL('https://secret:token@www.nintendo.com/'), '');
  assert.equal(D.nintendoGames(payload([row({ url: 'javascript:alert(1)', cover_image: 'https://evil.test/a.png' })]))[0].art, '');
});

test('calendar features one popular game per community without treating hypes as Steam Followers', () => {
  const nintendo = D.nintendoGames(payload([row({ hypes: 45 })]))[0];
  const steam = D.normalize({ appid: 1, name: 'Steam game', release_start: nintendo.date, followers: 500000 });
  const steam2 = D.normalize({ appid: 2, name: 'Steam second', release_start: nintendo.date, followers: 50000 });
  assert.deepEqual(D.calendarFeatured([steam2, nintendo, steam]).map(game => game.appid), [1, 'igdb:366896']);
  const hotter = { ...nintendo, appid: 'igdb:2', key: 'igdb:2@2027-03-20', hypes: 90 };
  assert.deepEqual(D.calendarFeatured([nintendo, hotter]).map(game => game.appid), ['igdb:2', 'igdb:366896']);
  assert.ok(D.popularityCompare(hotter, nintendo) < 0);
  assert.ok(D.popularityCompare(steam, hotter) < 0);
});

test('Nintendo failure does not hide Steam and discovery does not overwrite Nintendo metadata', () => {
  const steam = { games: [{ appid: 1, name: 'Steam', followers: 5000, release_start: '2027-03-20' }] };
  assert.equal(D.datasets(steam, null, null).games.length, 1);
  const data = D.datasets(steam, null, payload([row({ tags: ['Strategy'], genres: ['RPG'] })]));
  const enriched = R.enrich(data, steam, null).games.find(game => game.source === 'nintendo');
  assert.deepEqual(enriched.tags, ['Strategy']);
  assert.deepEqual(enriched.genres, ['RPG']);
});

test('catalog update reflects the newest valid source while retaining each source timestamp', () => {
  const older = '2026-10-03T15:01:00Z', newer = '2026-10-03T16:40:00Z';
  for (const [steamTime, nintendoTime] of [[older, newer], [newer, older]]) {
    const data = D.datasets({ games: [], generated_at: steamTime }, null,
      { ...payload([row()]), generated_at: nintendoTime });
    assert.equal(data.updated, newer);
    assert.equal(data.steamUpdated, steamTime);
    assert.equal(data.nintendoUpdated, nintendoTime);
    assert.equal(data.recentUpdated, steamTime);
  }
  const sameInstant = D.datasets({ games: [], generated_at: older }, null,
    { ...payload([]), generated_at: '2026-10-04T00:40:00+08:00' });
  assert.equal(sameInstant.updated, '2026-10-04T00:40:00+08:00');
});

test('invalid or absent source timestamps cannot override a valid catalog update', () => {
  const valid = '2026-10-03T16:40:00Z';
  for (const invalid of [null, '', 'invalid', '2026-10-05T01:00:00', '2026-02-30T01:00:00Z', '2026-10-05T99:00:00Z']) {
    const badNintendo = D.datasets({ games: [], generated_at: valid }, null,
      { ...payload([]), generated_at: invalid });
    assert.equal(badNintendo.updated, valid);
    assert.equal(badNintendo.nintendoUpdated, null);
    const badSteam = D.datasets({ games: [], generated_at: invalid }, null,
      { ...payload([]), generated_at: valid });
    assert.equal(badSteam.updated, valid);
    assert.equal(badSteam.steamUpdated, null);
  }
  assert.equal(D.datasets({ games: [] }, null, payload([])).updated, payload([]).generated_at);
  assert.equal(D.datasets({ games: [], generated_at: 'bad', updated_at: valid }, null).steamUpdated, valid);
  assert.equal(D.datasets({ games: [] }, null).updated, null);
});
