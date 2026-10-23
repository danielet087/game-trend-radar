import test from 'node:test';
import assert from 'node:assert/strict';
import { select } from '../src/features/twitch/selection.js';
import { DEFAULT_SORT, VIEWER_PRIORITY_THRESHOLD, VIEWER_SECONDARY_THRESHOLD, STREAMER_PRIORITY_THRESHOLD, SOURCES } from '../src/features/twitch/metrics.js';

const row = (id, viewers, streamers, median, extra = {}) => ({
  game_id: String(id), game_name: `Game ${id}`, is_tracked: true,
  observation_status: 'current', viewer_count: viewers, streamer_count: streamers,
  verification: { status: 'pending' },
  release_experiment: Object.fromEntries(SOURCES.map(source => [source, { predicted_new: null }])),
  filtered_audience: { median_viewer_count: median, eligible_streamer_count: 1 },
  ...extra,
});
const ids = (rows, options) => select(rows, options).map(game => game.game_id);

test('default median sorting keeps the six viewer and streamer groups ahead of median values', () => {
  assert.equal(DEFAULT_SORT, 'median');
  assert.equal(VIEWER_PRIORITY_THRESHOLD, 10000);
  assert.equal(VIEWER_SECONDARY_THRESHOLD, 1000);
  assert.equal(STREAMER_PRIORITY_THRESHOLD, 40);
  const rows = [
    row(6, 500, 39, 60), row(4, 1000, 39, 40), row(2, 10000, 39, 20),
    row(5, 500, 40, 50), row(3, 1000, 40, 30), row(1, 10000, 40, 10),
  ];
  assert.deepEqual(ids(rows), ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(ids(rows, { sort: 'median' }), ['1', '2', '3', '4', '5', '6']);
});

test('999, 1000, 9999 and 10000 viewers use inclusive thresholds with 39 and 40 streamers', () => {
  const rows = [
    row(8, 999, 39, 10), row(6, 1000, 39, 10), row(4, 1000, 40, 10),
    row(2, 10000, 39, 10), row(7, 999, 40, 10), row(5, 9999, 39, 10),
    row(3, 9999, 40, 10), row(1, 10000, 40, 10),
  ];
  assert.deepEqual(ids(rows), ['1', '2', '3', '4', '5', '6', '7', '8']);
});

test('grouping uses total category viewers and streamers rather than eligible median samples', () => {
  const rows = [
    row(3, 999, 500, 900, { filtered_audience: { median_viewer_count: 900, eligible_streamer_count: 100 } }),
    row(2, 1000, 39, 100, { filtered_audience: { median_viewer_count: 100, eligible_streamer_count: 39 } }),
    row(1, 1000, 40, 10, { filtered_audience: { median_viewer_count: 10, eligible_streamer_count: 1, eligible_viewer_count: 10 } }),
  ];
  assert.deepEqual(ids(rows), ['1', '2', '3']);
});

test('within every viewer tier median wins, followed by total viewers and the category ID', () => {
  for (const [low, high] of [[10000, 20000], [1000, 9999], [100, 999]]) {
    const rows = [
      row(2, low, 80, 50), row(3, high, 500, 50),
      row(1, low, 40, 50), row(4, low, 40, 60),
    ];
    assert.deepEqual(ids(rows), ['4', '3', '1', '2']);
  }
});

test('a missing median is last only within its own group and does not turn into zero', () => {
  const rows = [
    row(4, 1000, 40, 900), row(2, 10000, 40, 10),
    row(1, 10000, 40, null), row(3, 10000, 39, 900),
  ];
  assert.deepEqual(ids(rows), ['2', '1', '3', '4']);
  assert.equal(rows[2].filtered_audience.median_viewer_count, null);
  assert.deepEqual(ids([row(1, 1000, 40, null, { filtered_audience: undefined }), row(2, 1000, 40, 10)]), ['2', '1']);
});

test('missing totals receive no threshold priority and remain missing in the source data', () => {
  const rows = [
    row(1, null, 40, 900), row(2, 1000, 39, 10), row(3, 999, 40, 100),
    row(4, 10000, 39, 10), row(5, null, null, 800),
  ];
  assert.deepEqual(ids(rows), ['4', '2', '1', '3', '5']);
  assert.equal(rows[0].viewer_count, null);
  assert.equal(rows[4].viewer_count, null);
  assert.equal(rows[4].streamer_count, null);
});

test('retained observations stay after current measurements in every sort mode', () => {
  const rows = [row(1, 999999, 500, 9000, { observation_status: 'retained' }), row(2, 1, 1, 10)];
  for (const sort of ['median', 'viewers', 'streamers']) {
    assert.deepEqual(ids(rows, { sort }), ['2', '1']);
  }
});

test('explicit viewer and streamer modes ignore all threshold groups', () => {
  const rows = [row(1, 999, 500, 900), row(2, 1000, 100, 100), row(3, 10000, 1, 10), row(4, null, null, null)];
  assert.deepEqual(ids(rows, { sort: 'viewers' }), ['3', '2', '1', '4']);
  assert.deepEqual(ids(rows, { sort: 'streamers' }), ['1', '2', '3', '4']);
});

test('sorting preserves input records, source filters and normalized name searches', () => {
  const rows = [row(3, 999, 40, 100), row(2, 1000, 39, 10), row(1, 10000, 40, 10, { is_tracked: false })];
  const before = structuredClone(rows);
  assert.deepEqual(ids(rows, { filter: 'signals' }), ['2', '3']);
  assert.deepEqual(ids(rows, { query: 'Ｇａｍｅ ２' }), ['2']);
  assert.deepEqual(rows, before);
});
