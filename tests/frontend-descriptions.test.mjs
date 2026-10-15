import test from 'node:test';
import assert from 'node:assert/strict';
import { RadarData as D } from '../src/domain/index.mjs';
import { RadarDiscovery as R } from '../src/features/discovery/index.js';
import { descriptionRecord, chooseDescription, descriptionLabel, descriptionSourceURL,
  renderDescriptionSource } from '../src/domain/descriptions.mjs';
import { detailCatalog } from '../src/data/publication.mjs';

const description = (source, copy = source, extra = {}) => ({
  short_description: copy, short_description_language: 'zh-TW', short_description_source: source, ...extra,
});
const steam = (extra = {}) => ({ appid: 42, name: 'Example', followers: 6000,
  release_start: '2026-11-01', language_support: { english: true, tchinese: false }, ...extra });
const native = (extra = {}) => ({ schema_version: 1, games: [{
  id: 'igdb:99', igdb_id: 99, name_en: 'Example', hypes: 40, sexual_content_screened: true,
  platforms: [{ id: 167, code: 'PS5' }], websites: [{ url: 'https://store.steampowered.com/app/42/' }],
  releases: [{ platform: 'PS5', date: '2026-11-08', precision: 'day', region: 'worldwide', source: 'IGDB',
    date_basis: 'igdb_calendar_day', time_zone: 'Asia/Taipei', timezone_status: 'date_only',
    source_date: '2026-11-08', source_region: 'worldwide', taiwan_release_confirmed: false }],
  url: 'https://www.igdb.com/games/example', ...extra,
}] });

test('description priority is stable in either source order and keeps each text with its provenance', () => {
  const sources = ['steam_tchinese', 'steam_schinese_converted', 'official_zh_tw', 'official_schinese_converted', 'editorial_zh_tw'];
  for (let i = 0; i < sources.length; i++) for (let j = i + 1; j < sources.length; j++) {
    const first = description(sources[i], `中文 ${i}`, { description_source_url: 'https://publisher.example/game' });
    const second = description(sources[j], `中文 ${j}`);
    for (const records of [[first, second], [second, first]]) {
      const result = chooseDescription(...records);
      assert.equal(result.description, `中文 ${i}`, `${sources[i]} > ${sources[j]}`);
      assert.equal(result.descriptionSource, sources[i]);
      assert.equal(result.descriptionLanguage, 'zh-TW');
    }
  }
  assert.equal(chooseDescription(description('steam_tchinese', ''), description('official_zh_tw', '備援介紹')).description, '備援介紹');
});

test('merged release events consistently prefer native official Chinese to Steam English or retired automatic copy', () => {
  for (const steamCopy of [description('steam_machine_zh_tw', 'Steam 機翻'),
    { short_description_en: 'English Steam copy' }, {}]) {
    const catalog = { games: [steam(steamCopy)] };
    const data = R.enrich(D.datasets(catalog, null, native(description('official_zh_tw', '官方中文介紹', {
      description_source_url: 'https://publisher.example/game',
    }))), catalog, null);
    assert.equal(data.games.length, 2);
    for (const game of data.games) {
      assert.equal(game.description, '官方中文介紹');
      assert.equal(game.descriptionSource, 'official_zh_tw');
      assert.equal(game.descriptionSourceUrl, 'https://publisher.example/game');
      assert.equal(game.languages.tchinese, false);
      assert.equal(game.languageStatus, 'english');
      assert.equal(game.platformLanguages.PS5.status, 'unknown');
    }
  }
});

test('Steam official Chinese wins over native official Chinese and enrichment does not erase that choice', () => {
  for (const source of ['steam_tchinese', 'steam_schinese_converted']) {
    const catalog = { games: [steam(description(source, 'Steam 官方中文'))] };
    const data = R.enrich(D.datasets(catalog, null, native(description('official_zh_tw', '另一份官方中文'))), catalog, null);
    assert.ok(data.games.every(game => game.description === 'Steam 官方中文' && game.descriptionSource === source));
  }
});

test('native-only games show saved IGDB English instead of retired automatic Chinese without changing platform languages', () => {
  const data = R.enrich(D.datasets(null, null, native({ websites: [],
    ...description('igdb_machine_zh_tw', 'IGDB 翻譯介紹'), short_description_en: 'Original summary' })), null, null);
  assert.equal(data.games[0].description, 'Original summary');
  assert.equal(data.games[0].descriptionLanguage, 'en');
  assert.equal(data.games[0].descriptionSource, 'igdb_original');
  assert.equal(descriptionLabel(data.games[0]), 'IGDB 英文原文');
  assert.equal(data.games[0].descriptionSourceUrl, 'https://www.igdb.com/games/example');
  assert.equal(data.games[0].platformLanguages.PS5.status, 'unknown');
});

test('a native record using verified Steam English keeps the Steam source and original URL', () => {
  const data = R.enrich(D.datasets(null, null, native(description('steam_english', 'English Steam summary', {
    short_description_language: 'en',
  }))), null, null);
  assert.equal(data.games[0].description, 'English Steam summary');
  assert.equal(data.games[0].descriptionSource, 'steam_english');
  assert.equal(data.games[0].descriptionSourceUrl, 'https://store.steampowered.com/app/42/');
  assert.equal(descriptionLabel(data.games[0]), 'Steam 英文原文');
});

test('English fallback never inherits Chinese provenance and official or manual Chinese outranks English', () => {
  const english = descriptionRecord(steam({ ...description('steam_tchinese', ''), short_description_en: 'Only English' }));
  assert.equal(english.description, 'Only English');
  assert.equal(english.descriptionLanguage, 'en');
  assert.equal(english.descriptionSource, 'steam_english');
  assert.equal(descriptionLabel(english), 'Steam 英文原文');
  assert.equal(descriptionRecord(steam(description('steam_tchinese', 'English only', { short_description_language: 'en' }))).descriptionSource, 'steam_english');
  assert.equal(chooseDescription(english, description('editorial_zh_tw', '人工中文備援')).description, '人工中文備援');
  assert.equal(descriptionRecord(description('steam_schinese_converted', '尚未轉繁', { short_description_language: 'zh-CN' })).description, '');
});

test('retired automatic sources only use their English originals and Steam English outranks IGDB English', () => {
  for (const source of ['steam_machine_zh_tw', 'igdb_machine_zh_tw']) {
    assert.equal(descriptionRecord(description(source, '不再採用的自動翻譯')).description, '');
    const original = descriptionRecord({ ...description(source, '不再採用的自動翻譯'), short_description_en: 'Saved English original' });
    assert.equal(original.description, 'Saved English original');
    assert.equal(original.descriptionLanguage, 'en');
    assert.equal(original.descriptionSource, source.startsWith('steam_') ? 'steam_english' : 'igdb_original');
    const normalized = descriptionRecord({ description: '舊中文', descriptionLanguage: 'zh-TW',
      descriptionSource: source, descriptionEn: 'Normalized English original' });
    assert.equal(normalized.description, 'Normalized English original');
    assert.equal(normalized.descriptionLanguage, 'en');
  }
  const fromSteam = { ...description('steam_english', 'Steam English', { short_description_language: 'en' }) };
  const fromIGDB = { ...description('igdb_original', 'IGDB English', { short_description_language: 'en' }) };
  for (const sources of [[fromSteam, fromIGDB], [fromIGDB, fromSteam]]) {
    assert.equal(chooseDescription(...sources).description, 'Steam English');
  }
});

test('catalog description provenance is atomic instead of combining current text with stale detail metadata', () => {
  const stale = steam(description('steam_tchinese', '舊介紹', { description_source_url: 'https://store.steampowered.com/app/42/',
    short_description_en: 'Stale English', description_checked_at: '2026-10-01T00:00:00Z' }));
  const current = steam({ short_description: 'New English', short_description_language: 'en' });
  const merged = detailCatalog({ games: [current] }, stale, 42).games[0];
  assert.equal(merged.short_description, 'New English');
  assert.equal(merged.short_description_language, 'en');
  assert.equal(Object.hasOwn(merged, 'short_description_source'), false);
  assert.equal(Object.hasOwn(merged, 'description_source_url'), false);
  assert.equal(Object.hasOwn(merged, 'short_description_en'), false);
  assert.equal(descriptionRecord(merged).descriptionSource, 'steam_english');
  const supplemental = detailCatalog({ games: [steam()] }, stale, 42).games[0];
  assert.equal(supplemental.short_description, '舊介紹');
  assert.equal(supplemental.short_description_source, 'steam_tchinese');
});

test('description source links reject unsafe URLs and use safe external link attributes', () => {
  for (const value of ['javascript:alert(1)', 'http://www.igdb.com/games/example',
    'https://user:pass@www.igdb.com/games/example', 'https://www.igdb.com:8443/games/example',
    'https://127.0.0.1/private', 'https://server.local/private']) assert.equal(descriptionSourceURL(value), '');
  const element = { children: [], replaceChildren() { this.children = []; }, append(child) { this.children.push(child); } };
  const node = (tag, className, textContent) => ({ tag, className, textContent });
  renderDescriptionSource(element, descriptionRecord(steam(description('steam_tchinese', '官方介紹'))), node);
  assert.equal(element.hidden, false);
  assert.equal(element.children[0].textContent, 'Steam 官方繁中');
  const link = element.children[1];
  assert.equal(link.href, 'https://store.steampowered.com/app/42/');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  renderDescriptionSource(element, descriptionRecord(null), node);
  assert.equal(element.hidden, true);
  assert.deepEqual(element.children, []);
});
