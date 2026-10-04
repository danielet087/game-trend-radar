const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../assets/radar-data-v1.js');

const edition = (changes = {}) => ({ type: 'base_plus_dlc', label: '本體＋Re Mind DLC',
  title: 'KINGDOM HEARTS III + Re Mind', product_id: '70010000117242', region: 'hong_kong',
  source_url: 'https://ec.nintendo.com/HK/zh/titles/70010000117242',
  checked_at: '2026-10-04T06:37:03.073308Z', ...changes });
const nintendo = (changes = {}) => ({ id: 'igdb:2933', igdb_id: 2933, name_en: 'Kingdom Hearts III',
  hypes: 45, sexual_content_screened: true, platforms: [{ id: 508, code: 'NS2' }],
  releases: [{ platform: 'NS2', date: '2026-10-09', precision: 'day', region: 'worldwide', source: 'IGDB' }],
  websites: [{ url: 'https://store.steampowered.com/app/2552450/' }],
  platform_editions: { NS2: edition() }, ...changes });
const payload = (...games) => ({ schema_version: 1, games });
const steam = (changes = {}) => ({ appid: 2552450, name: 'Kingdom Hearts III',
  followers: 6000, release_start: '2026-10-08', ...changes });

test('approved edition metadata is platform-specific and can be selected for an event or complete game', () => {
  const [game] = D.nintendoGames(payload(nintendo({ platforms: [{ id: 130, code: 'NS' }, { id: 508, code: 'NS2' }],
    releases: [{ platform: 'NS', date: '2026-10-08', precision: 'day', source: 'IGDB' },
      { platform: 'NS2', date: '2026-10-09', precision: 'day', source: 'IGDB' }] })));
  assert.deepEqual(game.platformEditions, { NS2: edition() });
  assert.deepEqual(D.releaseEditionBadges(game), []);
  assert.deepEqual(D.releaseEditionBadges(game, game.platforms), [{ platform: 'NS2', ...edition() }]);
  const [later] = D.nintendoGames(payload(nintendo()));
  assert.deepEqual(D.releaseEditionBadges(later), [{ platform: 'NS2', ...edition() }]);
  assert.deepEqual(D.releaseEditionBadges(later, ['NS', 'NS2', 'NS2', 'Steam']), [{ platform: 'NS2', ...edition() }]);
});

test('only recognized editions with bounded names, numeric IDs and matching official regional products are accepted', () => {
  const expansion = edition({ type: 'base_plus_expansion', label: '本體＋Dark Arisen 擴充版',
    title: "Dragon's Dogma 2: Dark Arisen", product_id: '70010000118032', region: 'australia',
    source_url: 'https://www.nintendo.com/au/games/nintendo-switch-2/dragons-dogma-2-dark-arisen/' });
  const deluxe = edition({ type: 'deluxe', label: 'Deluxe 版', title: 'Resident Evil 2 Deluxe Edition',
    product_id: '70010000114443', region: 'australia', source_url: 'https://ec.nintendo.com/AU/en/titles/70010000114443' });
  for (const row of [edition(), expansion, deluxe]) assert.deepEqual(D.nintendoEdition(row), row);
  for (const changes of [
    { type: 'dlc_only' }, { label: ' ' }, { label: 'x'.repeat(121) }, { title: '' }, { title: 'x'.repeat(241) },
    { product_id: 70010000117242 }, { product_id: 'invalid' }, { product_id: '70010000117243' },
    { region: 'taiwan' }, { source_url: 'https://ec.nintendo.com/TW/zh/titles/70010000117242' },
    { source_url: 'https://ec.nintendo.com/HK/zh/titles/70010000117243' },
    { source_url: 'https://www.nintendo.com.evil.example/HK/zh/titles/70010000117242' },
    { source_url: 'https://asia.sega.com/product/' },
    { checked_at: '2026-10-04T06:37:03' },
  ]) assert.equal(D.nintendoEdition(edition(changes)), null, JSON.stringify(changes));
});

test('same-day merged editions retain one event and the canonical Steam game identity', () => {
  const result = D.datasets({ games: [steam({ release_start: '2026-10-09' })] }, null, payload(nintendo()));
  assert.equal(result.games.length, 1);
  const [game] = result.games;
  assert.equal(game.identityKey, 'steam:2552450');
  assert.deepEqual(game.releasePlatforms, ['Steam', 'NS2']);
  assert.deepEqual(game.platformEditions, { NS2: edition() });
  assert.equal(D.detailURL(game), './game.html?appid=2552450&date=2026-10-09');
});

test('different platform dates retain two event keys with one canonical game and complete edition details', () => {
  const result = D.datasets({ games: [steam()] }, null, payload(nintendo()));
  assert.equal(result.games.length, 2);
  assert.equal(new Set(result.games.map(D.gameKey)).size, 2);
  assert.equal(new Set(result.games.map(game => game.identityKey)).size, 1);
  assert.equal(D.cardGames(result.games).length, 1);
  assert.deepEqual(result.games.map(game => D.releaseEditionBadges(game).map(row => row.label)), [[], ['本體＋Re Mind DLC']]);
  for (const game of result.games) {
    assert.equal(game.releases.length, 2);
    assert.deepEqual(game.platformEditions, { NS2: edition() });
    const url = new URL(D.detailURL(game), 'https://example.test/');
    assert.equal(url.searchParams.get('appid'), '2552450');
    assert.equal(url.searchParams.get('date'), game.date);
  }
});

test('conflicting or missing edition evidence is omitted instead of being inherited across merged records', () => {
  const first = nintendo();
  const duplicate = (platform_editions) => nintendo({ id: 'igdb:2934', igdb_id: 2934, platform_editions });
  const exact = D.datasets({ games: [steam()] }, null, payload(first, duplicate({ NS2: edition() })));
  assert.deepEqual(exact.games[0].platformEditions, { NS2: edition() });
  for (const conflict of [{ NS2: edition({ label: '另一個版本' }) }, {}]) {
    const result = D.datasets({ games: [steam()] }, null, payload(first, duplicate(conflict)));
    assert.deepEqual(result.games[0].platformEditions, {});
    assert.deepEqual(D.releaseEditionBadges(result.games[0], ['NS2']), []);
  }
});

test('a Nintendo edition and bare Steam link cannot redirect to an unadmitted Steam profile', () => {
  const result = D.datasets({ games: [steam({ followers: 4999 })] }, null, payload(nintendo()));
  const [game] = result.games;
  assert.equal(game.source, 'nintendo');
  assert.equal(game.identityKey, 'steam:2552450');
  assert.equal(D.detailURL(game), './game.html?igdb=2933&date=2026-10-09');
  assert.deepEqual(game.platformEditions, { NS2: edition() });
  assert.deepEqual(game.releases.map(row => row.platform), ['NS2']);
});
