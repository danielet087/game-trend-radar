const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../assets/radar-data-v1.js');

function support(fields = {}) {
  return { status: 'confirmed', region: 'taiwan', complete: true,
    languages: { tchinese: false, schinese: true, english: true, chinese: true },
    supported_languages: [{ code: 'zh-Hans', name: '簡體中文' }, { code: 'en', name: '英文' }],
    source: 'Nintendo 台灣', source_url: 'https://www.nintendo.com/tw/games/switch2/example/',
    checked_at: '2026-10-04T05:00:00Z', evidence_type: 'official_product_languages', ...fields };
}
function payload(fields = {}) {
  return { schema_version: 1, games: [{ id: 'igdb:1', igdb_id: 1, name_en: 'Nintendo Game',
    hypes: 40, sexual_content_screened: true, platforms: [{ id: 508, code: 'NS2' }],
    releases: [{ platform: 'NS2', date: '2026-11-01', precision: 'day', source: 'IGDB' }],
    platform_language_support: { NS2: support() }, ...fields }] };
}

test('Nintendo uses only validated per-platform language evidence, preserving explicit scripts', () => {
  const [game] = D.nintendoGames(payload({ language_support: { tchinese: true, schinese: false } }));
  assert.equal(game.languages.tchinese, null);
  assert.equal(game.languages.schinese, true);
  assert.deepEqual(game.languageBadges.map(row => row.label), ['支援簡中']);
  assert.equal(game.platformLanguages.NS2.languages.tchinese, false);
  assert.match(game.languageBadges[0].title, /NS2 版本.*台灣.*Nintendo 台灣/);
});

test('legacy generic language data cannot stand in for Nintendo language evidence', () => {
  const [game] = D.nintendoGames(payload({ platform_language_support: undefined,
    language_support: { tchinese: true, schinese: true, english: true } }));
  assert.deepEqual(game.languageBadges.map(row => row.label), ['語言支援待確認']);
  assert.equal(game.languages.tchinese, null);
  assert.equal(game.platformLanguages.NS2.status, 'unknown');
});

test('generic Chinese stays ambiguous for both complete and partial official evidence', () => {
  for (const complete of [true, false]) {
    const row = support({ complete, status: complete ? 'confirmed' : 'partial',
      languages: { tchinese: null, schinese: null, english: complete ? false : null, chinese: true },
      supported_languages: [{ code: 'zh', name: '中文' }],
      evidence_type: complete ? 'official_product_languages' : 'official_chinese_unspecified' });
    const normalized = D.nintendoLanguageSupport(row);
    assert.equal(normalized.status, row.status);
    assert.deepEqual(normalized.languageBadges.map(row => row.label), ['中文（字體待確認）']);
    assert.equal(normalized.languages.tchinese, null);
    assert.equal(normalized.languages.schinese, null);
  }
});

test('unsafe, inconsistent or wrong-region language evidence falls back to unknown', () => {
  for (const fields of [
    { source_url: 'javascript:alert(1)' }, { source_url: 'https://www.nintendo.com.evil.example/' },
    { source_url: 'https://user@www.nintendo.com/tw/' }, { checked_at: '2026-10-04T05:00:00' },
    { source_url: 'https://www.nintendo.com/us/store/products/example/', region: 'taiwan' },
    { source_url: 'https://ec.nintendo.com/HK/en/example/', region: 'taiwan' },
    { source_url: 'https://www.nintendo.com.hk/example/', region: 'taiwan' },
    { languages: { tchinese: true, schinese: true, english: true, chinese: true } },
    { status: 'confirmed', complete: false }, { evidence_type: 'igdb_language_support' },
  ]) assert.equal(D.nintendoLanguageSupport(support(fields)).status, 'unknown');
});

test('NS and NS2 language evidence stays separate and multi-native filters require all selected versions', () => {
  const traditional = support({ languages: { tchinese: true, schinese: false, english: false, chinese: true },
    supported_languages: [{ code: 'zh-Hant', name: '繁體中文' }] });
  const [game] = D.nintendoGames(payload({
    platforms: [{ id: 130, code: 'NS' }, { id: 508, code: 'NS2' }],
    releases: [{ platform: 'NS', date: '2026-11-01', precision: 'day', source: 'IGDB' },
      { platform: 'NS2', date: '2026-11-01', precision: 'day', source: 'IGDB' }],
    platform_language_support: { NS: traditional, NS2: support() },
  }));
  assert.deepEqual(game.languageBadges.map(row => row.label), ['NS 支援繁中', 'NS2 支援簡中']);
  assert.equal(game.languages.tchinese, null);
  assert.equal(game.languages.schinese, null);
  assert.equal(game.platformLanguages.NS.languages.tchinese, true);
  assert.equal(game.platformLanguages.NS2.languages.tchinese, false);
});

test('Steam merging retains independent Nintendo evidence and Steam primary language chips', () => {
  const catalog = { games: [{ appid: 123, followers: 6000, name: 'Steam Game', release_start: '2026-11-01',
    language_support: { tchinese: true, schinese: true } }] };
  const nintendo = payload({ websites: [{ url: 'https://store.steampowered.com/app/123/' }] });
  const [game] = D.datasets(catalog, null, nintendo).games;
  assert.deepEqual(game.languageBadges.map(row => row.label), ['支援繁中', '支援簡中']);
  assert.equal(game.languages.tchinese, true);
  assert.equal(game.platformLanguages.NS2.languages.tchinese, false);
  assert.equal(game.platformLanguages.NS2.source, 'Nintendo 台灣');
});

test('foreign official language evidence retains its region without implying a Taiwan version', () => {
  for (const [region, source_url] of [
    ['north_america', 'https://www.nintendo.com/us/store/products/example/'],
    ['united_kingdom', 'https://www.nintendo.com/en-gb/Games/example/'],
    ['europe', 'https://www.nintendo.com/en-gb/Games/example/'],
    ['worldwide', 'https://www.layton.jp/jouki/'],
    ['hong_kong', 'https://ec.nintendo.com/HK/en/example/'],
    ['asia', 'https://asia.sega.com/example/'],
  ]) assert.equal(D.nintendoLanguageSupport(support({ region, source_url })).region, region);
});
