const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../assets/radar-data-v1.js');

const officialSteam = (changes = {}) => ({ appid: 10, name: 'Game', followers: 6000,
  release_start: '2026-11-01', categories: [{ id: 2, description: 'Single-player' }],
  categories_source: 'Steam Store appdetails cc=TW categories', categories_checked_at: '2026-10-05T07:00:00Z', ...changes });
const native = (changes = {}) => ({ schema_version: 1, games: [{ id: 'igdb:1', igdb_id: 1,
  name_en: 'Game', hypes: 40, sexual_content_screened: true, platform_data_complete: true,
  platforms: [{ id: 130, code: 'NS' }, { id: 508, code: 'NS2' }], known_platforms: [{ id: 130 }, { id: 508 }],
  releases: [{ platform: 'NS', date: '2026-11-02', precision: 'day', source: 'IGDB' },
    { platform: 'NS2', date: '2026-11-03', precision: 'day', source: 'IGDB' }], ...changes }] });
const badge = game => D.cardMultiplayerBadge(game);

test('official Steam multiplayer, cooperative, split screen and MMO player categories produce one multiplayer badge', () => {
  for (const id of [1, 9, 20, 24, 27, 36, 37, 38, 39, 47, 48, 49]) {
    const game = D.normalize(officialSteam({ categories: [{ id: 2 }, { id }] }));
    assert.equal(badge(game).label, '多人');
    assert.match(badge(game).title, /Steam/);
  }
});

test('single-player, unknown modes, leaderboards and Remote Play Together do not imply multiplayer', () => {
  for (const categories of [undefined, [], [{ id: 2 }], [{ id: 25, description: 'Steam Leaderboards' }],
    [{ id: 44, description: 'Remote Play Together' }], [{ id: 999, description: 'Multi-player' }]]) {
    assert.equal(badge(D.normalize(officialSteam({ categories, tags: ['Multiplayer'], genres: ['MMO'] }))), null);
  }
});

test('Steam multiplayer evidence must retain its official category source and timestamp', () => {
  const multiplayer = { categories: [{ id: 1, description: 'Multi-player' }] };
  for (const changes of [{ categories_source: undefined }, { categories_source: 'Community tags' },
    { categories_checked_at: undefined }, { categories_checked_at: '2026-10-05T07:00:00' }]) {
    assert.equal(badge(D.normalize(officialSteam({ ...multiplayer, ...changes }))), null);
  }
  assert.equal(badge(D.normalize(officialSteam({ ...multiplayer,
    categories_source: 'Steam IStoreBrowseService/GetItems supported_player_categoryids' }))).label, '多人');
  const translated = officialSteam(multiplayer);
  const raw = officialSteam(); delete raw.categories;
  assert.equal(badge(D.normalize(raw, false, translated)).label, '多人');
  assert.equal(badge(D.normalize(officialSteam({ categories: [], categories_source: undefined }), false, translated)), null);
});

test('IGDB badges use exact game mode names, including games with both single and multiplayer modes', () => {
  for (const name of ['Multiplayer', 'Co-operative', 'Split screen', 'Massively Multiplayer Online (MMO)', 'Battle Royale']) {
    const game = D.nintendoGames(native({ game_modes: [{ id: 1, name: 'Single player' }, { id: 2, name }] }))[0];
    assert.equal(badge(game).label, '多人');
    assert.match(badge(game).title, /IGDB.*未提供各平台細分/);
  }
  for (const game_modes of [undefined, [], [{ id: 2 }], [{ name: 'Multiplayer' }], [{ id: -2, name: 'Multiplayer' }], [{ id: 1, name: 'Single player' }], [{ id: 2, name: 'multiplayer' }],
    [{ id: 2, name: 'Multiplayer adventure' }]]) {
    assert.equal(badge(D.nintendoGames(native({ game_modes, tags: ['Multiplayer'] }))[0]), null);
  }
});

test('platform multiplayer data overrides game-level fallback without treating partial negatives as a single-player confirmation', () => {
  const game = D.nintendoGames(native({ game_modes: [{ id: 2, name: 'Multiplayer' }], multiplayer_modes: [
    { platform: { id: 130 }, onlinecoop: false, onlinemax: 1 },
    { platform: { id: 508 }, onlinecoop: true, onlinecoopmax: 4 },
  ] }))[0];
  assert.equal(game.platformMultiplayer.NS.status, 'unknown');
  assert.equal(game.platformMultiplayer.NS2.status, 'multiplayer');
  assert.equal(D.cardMultiplayerBadge(game, true), null);
  assert.match(badge(game).title, /NS2：IGDB 平台模式資料/);
  assert.doesNotMatch(badge(game).title, /未提供各平台細分/);
  const zero = D.nintendoGames(native({ game_modes: [{ id: 2, name: 'Multiplayer' }], multiplayer_modes: [
    { platform: { id: 130 }, campaigncoop: false, dropin: false, lancoop: false, offlinecoop: false,
      onlinecoop: false, splitscreen: false, splitscreenonline: false,
      offlinecoopmax: 0, offlinemax: 1, onlinecoopmax: 0, onlinemax: 0 },
    { platform: { id: 508 }, onlinecoop: false, onlinemax: 0 },
  ] }))[0];
  assert.equal(zero.platformMultiplayer.NS.status, 'single');
  assert.equal(zero.platformMultiplayer.NS2.status, 'unknown');
  assert.equal(badge(zero), null);
});

test('only typed positive platform features or player counts establish multiplayer support', () => {
  for (const changes of [{ offlinemax: 2 }, { onlinecoopmax: 2 }, { splitscreen: true }, { lancoop: true }]) {
    const game = D.nintendoGames(native({ multiplayer_modes: [{ platform: { id: 130 }, ...changes }] }))[0];
    assert.equal(D.cardMultiplayerBadge(game, true).label, '多人');
  }
  for (const changes of [{ onlinecoop: 'true' }, { onlinemax: '4' }, { onlinemax: 0 }, { onlinemax: 1 }, { onlinemax: -2 }]) {
    const game = D.nintendoGames(native({ multiplayer_modes: [{ platform: { id: 130 }, ...changes }] }))[0];
    assert.equal(D.cardMultiplayerBadge(game, true), null);
  }
});

test('merged Steam and console events retain their own mode evidence and summary hover identifies only supported platforms', () => {
  const console = native({ websites: [{ url: 'https://store.steampowered.com/app/10/' }],
    game_modes: [{ id: 2, name: 'Multiplayer' }], multiplayer_modes: [
      { platform: { id: 130 }, onlinecoop: false }, { platform: { id: 508 }, onlinemax: 4 },
    ] });
  const data = D.datasets({ games: [officialSteam()] }, null, console);
  const byDate = new Map(data.games.map(game => [game.date, game]));
  assert.equal(D.cardMultiplayerBadge(byDate.get('2026-11-01'), true), null);
  assert.equal(D.cardMultiplayerBadge(byDate.get('2026-11-02'), true), null);
  assert.match(D.cardMultiplayerBadge(byDate.get('2026-11-03'), true).title, /NS2/);
  const summary = badge(D.cardGames(data.games)[0]);
  assert.equal(summary.label, '多人');
  assert.match(summary.title, /NS2/);
  assert.doesNotMatch(summary.title, /Steam|NS：/);
});
