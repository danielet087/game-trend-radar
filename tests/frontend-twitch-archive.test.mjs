import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveGames, archiveURLState, selectArchive } from '../src/features/twitch/archive-model.js';
import { windowFor, overviewQuery, detailHref } from '../src/features/twitch/series.js';

const period = { first_hour: '2026-09-30T00:00:00Z', last_hour: '2026-10-03T23:00:00Z' };
const games = archiveGames({ games: {
  '42': { ...period, name: 'Onimusha: Way of the Sword', display_name: '鬼武者 Way of the Sword', aliases: ['Onimusha', '鬼武者'], steam_appids: ['2638890'], tracking_status: 'ended', sample_count: 95, peak_viewer_count: 14066, box_art_url: 'https://static-cdn.jtvnw.net/ttv-boxart/42_IGDB-{width}x{height}.jpg' },
  '43': { ...period, name: 'Zero', tracking_status: 'active', sample_count: 1, peak_viewer_count: 0, box_art_url: 'https://other.test/cover.jpg' },
  '44': { ...period, name: 'Unknown metrics', tracking_status: 'untracked', sample_count: 2, peak_viewer_count: null },
  '45': { ...period, name: 'Corrected census removed all samples', sample_count: 0 },
  '../unsafe': { ...period, name: 'Invalid ID', sample_count: 1 },
} });
test('archive searches retained games by Chinese, English, Twitch ID and Steam ID', () => {
  assert.equal(games.length, 3);
  assert.equal(games[0].cover, 'https://static-cdn.jtvnw.net/ttv-boxart/42_IGDB-144x192.jpg');
  assert.equal(games[1].cover, null);
  assert.equal(games[2].cover, null);
  for (const query of ['鬼武者', 'ONIMUSHA', 'Way Sword', '42', '２６３８８９０']) {
    assert.equal(selectArchive(games, { query, filter: 'all', sort: 'recent' })[0].id, '42');
  }
  assert.deepEqual(selectArchive(games, { query: '', filter: 'active', sort: 'recent' }).map(g => g.id), ['43']);
  assert.deepEqual(selectArchive(games, { query: '鬼武者', filter: 'active', sort: 'recent' }), []);
});
test('archive sorts valid zero above unknown and keeps cumulative counts independent of status', () => {
  const state = { query: '', filter: 'all' };
  assert.deepEqual(selectArchive(games, { ...state, sort: 'peak' }).map(g => g.id), ['42', '43', '44']);
  assert.deepEqual(selectArchive(games, { ...state, sort: 'records' }).map(g => g.id), ['42', '44', '43']);
  assert.equal(games[0].samples, 95);
  assert.equal(games[2].peak, null);
});
test('archive URL state and detail return destination preserve search, filters, sort and page', () => {
  const search = 'view=archive&q=鬼武者&archive_state=ended&archive_sort=peak&archive_page=2&next=https://other.test';
  const link = new URL(detailHref('42', search), 'https://example.test/');
  const back = link.searchParams.get('back');
  assert.deepEqual(archiveURLState(back), { query: '鬼武者', filter: 'ended', sort: 'peak', page: 2 });
  assert.equal(new URLSearchParams(back).get('view'), 'archive');
  assert.equal(new URLSearchParams(back).has('next'), false);
  assert.deepEqual(archiveURLState('archive_state=__proto__&archive_sort=bad&archive_page=-1'), { query: '', filter: 'all', sort: 'recent', page: 1 });
  assert.equal(overviewQuery('view=https://other.test&archive_page=Infinity'), '');
});
test('old game opens at its last saved week while custom dates retain full coverage access', () => {
  const latest = '2026-10-22T07:00:00Z';
  const index = { months: { '2026-10': { [period.last_hour]: period.last_hour, [latest]: latest } } };
  const window = windowFor(new URLSearchParams(), index, period);
  assert.equal(window.end, Date.parse(period.last_hour));
  assert.equal(window.latest, Date.parse(latest));
  assert.equal((window.end - window.start) / 3600000 + 1, 168);
  const custom = windowFor(new URLSearchParams({ range: 'custom', start: '2026-10-22', end: '2026-10-22' }), index, period);
  assert.equal(custom.end, Date.parse(latest));
});
