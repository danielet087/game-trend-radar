import test from 'node:test';
import assert from 'node:assert/strict';
import { RadarData as D } from '../src/domain/index.mjs';
import { RadarDiscovery as R } from '../src/features/discovery/index.js';
import { FilterState } from '../src/features/catalog/filter-state.ts';
import { cardDate, selectCatalog } from '../src/features/catalog/selectors.ts';
import { normalizeCatalog, catalogCardDate } from '../src/features/catalog/boundary.ts';
import { newsItems } from '../src/features/detail/radar.js';

const TODAY = '2026-10-08';
const reference = {
  appid: 2552450, name: 'KINGDOM HEARTS III + Re Mind (DLC)', name_en: 'KINGDOM HEARTS III + Re Mind (DLC)',
  display_name: 'KINGDOM HEARTS III + Re Mind (DLC)', steam_type: 'game', followers: null, sexual_content_screened: true,
  language_support: { tchinese: true }, release_start: '2024-06-13', release_precision: 'day',
  release_coming_soon: false, release_date_timezone: 'Asia/Taipei',
  tags: ['Action'], tag_labels_zh_tw: { Action: '動作' }, genres: ['Action'], genre_labels_zh_tw: { Action: '動作' },
  short_description: '此為系列最新作品。', short_description_language: 'zh-TW', short_description_source: 'steam_tchinese',
  reference: { method: 'igdb_console_steam_link_v1', igdb_ids: [2933], console_titles: ['Kingdom Hearts III'] },
  checked_at: '2026-10-01T00:00:00Z',
};
const native = { schema_version: 1, generated_at: '2026-10-01T00:00:00Z', games: [{
  id: 'igdb:2933', igdb_id: 2933, name_en: 'Kingdom Hearts III', hypes: 120, sexual_content_screened: true,
  platform_data_complete: true, platforms: [{ id: 508, code: 'NS2' }], known_platforms: [{ id: 508, code: 'NS2' }],
  releases: [{ date: '2026-10-20', platform: 'NS2', precision: 'day', source: 'IGDB', region: 'worldwide' }],
  websites: [{ url: 'https://store.steampowered.com/app/2552450/' }], url: 'https://www.igdb.com/games/kingdom-hearts-iii',
}] };
const official = { version: 3, generated_at: '2026-10-01T00:00:00Z', games: [{ appid: 42, name: 'Example',
  followers: 6000, release_start: '2026-10-10', language_support: { english: true } }] };
const references = { schema_version: 1, generated_at: '2026-10-01T00:00:00Z', games: [reference] };
const input = { official, preview: null, native, references };

function filters(mode) {
  const result = new FilterState(mode, TODAY, D, R, new URLSearchParams(''));
  result.configure({ minimum: ['0', '5000'], sort: ['date', 'followers', 'name', 'newest'], period: ['', 'future', 'past'],
    language: ['', 'tchinese', 'schinese'] });
  return result;
}

test('cards date a reference game by its console release, never the older Steam day', () => {
  const normalized = normalizeCatalog(input, 'upcoming', R);
  const game = normalized.viewModel.games.find(row => row.appid === 2552450);
  assert.equal(game.steamReference, true);
  for (const event of [false, true]) {
    assert.equal(cardDate(game, D, event), '2026-10-20');
    assert.equal(catalogCardDate(game, D, event, normalized.model), '2026-10-20');
  }
  const steamEvent = normalized.model.releaseEvents.get([...normalized.model.releaseEvents.keys()]
    .find(key => key.includes(':Steam:2024-06-13')));
  assert.equal(steamEvent.reference, true);
  const upcoming = selectCatalog(normalized.viewModel, filters('upcoming'), D, R, new Set());
  assert.deepEqual(upcoming.items.map(row => cardDate(row, D)), ['2026-10-10', '2026-10-20']);
});

test('the reference supplies tags and its description to the merged game', () => {
  const normalized = normalizeCatalog(input, 'all', R);
  const game = normalized.viewModel.games.find(row => row.appid === 2552450);
  assert.deepEqual(game.tags, ['Action']);
  assert.equal(R.label('Action'), '動作');
  assert.equal(game.description, '此為系列最新作品。');
});

test('the game page news keeps the console version events of a Steam-based game', () => {
  const game = normalizeCatalog(input, 'all', R).viewModel.games.find(row => row.appid === 2552450);
  const event = (igdb_id, name) => ({ source: 'nintendo', igdb_id, game_id: `igdb:${igdb_id}`, platforms: ['NS2'],
    type: 'added', name, date: '2026-10-20', at: '2026-10-02T01:00:00Z', update_reason: 'igdb_update' });
  const activity = { events: [event(2933, 'Kingdom Hearts III'), event(1, 'Another console game')] };
  const items = newsItems({ game, record: null, history: [], activity, media: null, today: TODAY, number: new Intl.NumberFormat('zh-TW') });
  assert.equal(items.filter(item => item.kind === 'added').length, 1);
});
