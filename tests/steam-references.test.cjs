const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/domain/index.mjs').RadarData;

// Kingdom Hearts III: the Steam version came out in 2024, the NS2 version is new.
const reference = (changes = {}) => ({
  appid: 2552450, name: 'KINGDOM HEARTS III + Re Mind (DLC)', name_en: 'KINGDOM HEARTS III + Re Mind (DLC)',
  display_name: '王國之心 III + Re Mind (DLC)', display_name_source: 'tchinese',
  name_zh_tw: 'KINGDOM HEARTS III + Re Mind (DLC)', name_zh_tw_traditional: null, steam_type: 'game',
  language_support: { tchinese: true, schinese: true, english: true },
  categories: [{ id: 2, description: 'Single-player' }],
  categories_source: 'Steam IStoreBrowseService/GetItems supported_player_categoryids',
  categories_checked_at: '2026-11-19T16:25:28Z',
  release_start: '2024-06-13', release_precision: 'day', release_coming_soon: false,
  release_date_basis: 'steam_taiwan_store_date', release_time_utc: '2024-06-13T00:00:00Z',
  release_date_timezone: 'Asia/Taipei', followers: null, sexual_content_screened: true, content_descriptorids: [],
  header_image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2552450/header.jpg?t=1',
  main_capsule_image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2552450/capsule_616x353.jpg?t=1',
  header_image_2x: '', main_capsule_image_2x: '',
  short_description: '此為系列最新作品，是從第一部作品開始的「黑暗探求者篇」的完結篇。',
  short_description_en: 'The final chapter of the Dark Seeker Saga.',
  short_description_language: 'zh-TW', short_description_source: 'steam_tchinese',
  tags: ['Action', 'RPG'], tag_labels_zh_tw: { Action: '動作', RPG: '角色扮演' }, genres: ['Action'],
  genre_labels_zh_tw: { Action: '動作' },
  reference: { method: 'igdb_console_steam_link_v1', igdb_ids: [2933], console_titles: ['Kingdom Hearts III'],
    title_match: 'subtitle' },
  checked_at: '2026-11-19T16:25:28Z',
  ...changes,
});
const consoleGame = (changes = {}) => ({
  id: 'igdb:2933', igdb_id: 2933, name_en: 'Kingdom Hearts III', display_name: 'Kingdom Hearts III',
  sexual_content_screened: true, hypes: 120, platform_data_complete: true,
  platforms: [{ id: 508, code: 'NS2' }],
  known_platforms: [{ id: 6, name: 'PC' }, { id: 508, code: 'NS2' }],
  exclusivity: { status: 'multi_platform' },
  releases: [{ date: '2026-10-08', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB' }],
  websites: [{ url: 'https://store.steampowered.com/app/2552450' }],
  url: 'https://www.igdb.com/games/kingdom-hearts-iii',
  cover_image: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg',
  ...changes,
});
const payload = games => ({ schema_version: 1, generated_at: '2026-11-19T16:25:28Z', games });
const steamGame = (changes = {}) => ({
  appid: 3161310, name_en: 'Hela', followers: 39021, release_start: '2026-10-08',
  language_support: { tchinese: true }, ...changes,
});
const data = ({ references = [reference()], consoles = [consoleGame()], steam = [] } = {}) =>
  D.datasets({ games: steam }, null, payload(consoles), payload(references));

test('a console game with a Steam reference becomes one Steam-based game on the console date', () => {
  const result = data();
  assert.equal(result.games.length, 1);
  const game = result.games[0];
  assert.equal(game.source, 'steam');
  assert.equal(game.appid, 2552450);
  assert.equal(game.steamReference, true);
  assert.equal(game.followers, null);
  assert.equal(game.igdbId, 2933);
  assert.equal(game.date, '2026-10-08');
  assert.deepEqual(game.platforms, ['Steam', 'NS2']);
  assert.deepEqual(game.releasePlatforms, ['NS2']);
  // The Steam version's own day is kept for the page, marked as not a radar release.
  assert.deepEqual(game.releases.map(row => [row.platform, row.date, row.reference === true]),
    [['Steam', '2024-06-13', true], ['NS2', '2026-10-08', false]]);
  assert.equal(game.name, '王國之心 III + Re Mind (DLC)');
  assert.equal(game.description, reference().short_description);
  assert.equal(game.descriptionSource, 'steam_tchinese');
  assert.equal(game.languages.tchinese, true);
  assert.equal(game.steamLink, 'https://store.steampowered.com/app/2552450/');
  assert.equal(D.detailURL(game), './game.html?appid=2552450&date=2026-10-08');
});

test('a reference never shows up on its own, and a same-day Steam release joins the event', () => {
  assert.equal(data({ consoles: [] }).games.length, 0);
  const sameDay = data({ references: [reference({ release_start: '2026-10-08', release_coming_soon: true })] }).games[0];
  assert.deepEqual(sameDay.releasePlatforms, ['Steam', 'NS2']);
  const undated = data({ references: [reference({ release_start: null, release_precision: null })] }).games[0];
  assert.deepEqual(undated.platforms, ['Steam', 'NS2']);
  assert.deepEqual(undated.releases.map(row => row.platform), ['NS2']);
});

test('a reference merges only the console games it was checked against', () => {
  const other = consoleGame({ id: 'igdb:26676', igdb_id: 26676, name_en: 'Kingdom Hearts 0.2' });
  const result = data({ consoles: [consoleGame(), other] });
  assert.deepEqual(result.games.map(game => [game.source, game.igdbId]).sort(), [['nintendo', 26676], ['steam', 2933]]);
});

test('a catalog row wins over a reference for the same product', () => {
  const steam = [steamGame({ appid: 2552450, name_en: 'KINGDOM HEARTS III', followers: 52000, release_start: '2026-10-08' })];
  const game = data({ steam }).games.find(row => row.appid === 2552450);
  assert.equal(game.followers, 52000);
  assert.equal(game.steamReference, undefined);
});

test('malformed references are ignored', () => {
  const broken = [
    reference({ reference: { method: 'other', igdb_ids: [2933] } }),
    reference({ reference: { method: 'igdb_console_steam_link_v1', igdb_ids: [] } }),
    reference({ followers: 9000 }),
    reference({ sexual_content_screened: false }),
    reference({ steam_type: 'dlc' }),
  ];
  for (const row of broken) {
    const result = data({ references: [row] });
    assert.equal(result.games[0].source, 'nintendo');
  }
  assert.equal(data({ references: null }).games[0].source, 'nintendo');
});

test('reference games rank with console games by IGDB interest, after Steam Followers', () => {
  const steam = [steamGame()];
  const quieter = consoleGame({ id: 'igdb:9', igdb_id: 9, name_en: 'Quiet', display_name: 'Quiet', hypes: 31, websites: [] });
  const result = data({ steam, consoles: [consoleGame(), quieter] });
  const ranked = [...result.games].sort(D.popularityCompare);
  assert.deepEqual(ranked.map(game => game.name), ['Hela', '王國之心 III + Re Mind (DLC)', 'Quiet']);
  assert.deepEqual(D.calendarFeatured(result.games).map(game => game.name), ['Hela', '王國之心 III + Re Mind (DLC)']);
});
