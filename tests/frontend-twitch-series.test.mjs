import test from 'node:test';
import assert from 'node:assert/strict';
import { validIndex, validChunk, windowFor, monthsFor, seriesRows, detailHref, overviewQuery, csvRows } from '../src/features/twitch/series.js';
import { valueOf } from '../src/features/twitch/chart.js';

const hour = '2026-09-30T16:00:00Z', generated = '2026-09-30T16:12:00Z';
const index = { schema_version: 1, timezone: 'Asia/Taipei', generated_at: generated, games: { '42': { name: 'Test', months: ['2026-10'] } },
  months: { '2026-10': { [hour]: generated, '2026-09-30T17:00:00Z': '2026-09-30T17:12:00Z' } } };
const filtered = { rule: 'followers_gt_1000_viewers_gte_10_v1', min_followers_exclusive: 1000,
  min_viewers_inclusive: 10, followers_max_age_hours: 24, status: 'complete', median_viewer_count: 10,
  eligible_streamer_count: 1, eligible_viewer_count: 10, excluded_low_viewer_count: 0, excluded_low_follower_count: 0, unknown_follower_count: 0 };
const chunk = { schema_version: 1, timezone: 'Asia/Taipei', game_id: '42', month: '2026-10', hours: {
  [hour]: { generated_at: generated, viewer_count: 0, streamer_count: 0, filtered_audience: filtered },
} };

test('monthly history keeps observed zero, absent census and missing hour distinct', () => {
  assert.equal(validIndex(index), true);
  assert.equal(validChunk(chunk, '42', '2026-10'), true);
  assert.equal(validChunk(chunk, '43', '2026-10'), false);
  const start = Date.parse(hour);
  const rows = seriesRows(index, { '2026-10': chunk }, '42', start, start + 2 * 3600000);
  assert.deepEqual(rows.map(row => row.status), ['observed', 'absent', 'missing']);
  assert.deepEqual(rows.map(row => valueOf(row, 'viewers')), [0, null, null]);
  assert.equal(valueOf(rows[0], 'median'), 10);
  assert.match(csvRows(rows), /"已觀測","0","0","10"/);
  assert.match(csvRows(rows), /"未列入本次觀測","","",""/);
});

test('incomplete and unverifiable filtered medians never become valid measurements', () => {
  for (const audience of [{ ...filtered, status: 'partial', unknown_follower_count: 2 }, { ...filtered, rule: 'legacy' }]) {
    const copy = structuredClone(chunk); copy.hours[hour].filtered_audience = audience;
    const [row] = seriesRows(index, { '2026-10': copy }, '42', Date.parse(hour), Date.parse(hour));
    assert.equal(valueOf(row, 'median'), null);
    assert.equal(row.viewer_count, 0);
  }
  const mixed = structuredClone(chunk); mixed.hours[hour].generated_at = '2026-09-30T16:13:00Z';
  assert.throws(() => seriesRows(index, { '2026-10': mixed }, '42', Date.parse(hour), Date.parse(hour)), /正在更新/);
});

test('date controls use Taiwan calendar boundaries and bound work to 31 days', () => {
  const defaultWindow = windowFor(new URLSearchParams(), index);
  assert.equal((defaultWindow.end - defaultWindow.start) / 3600000 + 1, 168);
  const custom = windowFor(new URLSearchParams({ range: 'custom', start: '2026-10-01', end: '2026-10-01' }), index);
  assert.equal(custom.start, Date.parse(hour));
  assert.equal(custom.end, defaultWindow.latest);
  assert.deepEqual(monthsFor(Date.parse('2026-09-30T15:00:00Z'), Date.parse(hour)), ['2026-09', '2026-10']);
  for (const [start, end] of [['2026-08-31', '2026-10-01'], ['2026-10-01', '2026-09-01'], ['2026-02-30', '2026-03-01'], ['2027-01-01', '2027-01-02']]) {
    assert.throws(() => windowFor(new URLSearchParams({ range: 'custom', start, end }), index), /有效日期/);
  }
});

test('detail links preserve only supported overview filters without an external return destination', () => {
  const link = new URL(detailHref('42', '?q=Test&state=steam_recent&sort=viewers&next=https://evil.test'), 'https://example.test/');
  assert.equal(link.searchParams.get('game'), '42');
  assert.equal(overviewQuery(link.searchParams.get('back')), 'q=Test&state=steam_recent&sort=viewers');
  assert.equal(overviewQuery('https://evil.test/'), '');
});
