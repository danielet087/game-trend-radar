import test from 'node:test';
import assert from 'node:assert/strict';
import { forRegion, DEFAULT_REGION, regionOf } from '../src/features/twitch/audience-region.js';
import { select } from '../src/features/twitch/selection.js';
import { seriesRows, csvRows, detailHref, overviewQuery } from '../src/features/twitch/series.js';
import { historyRows } from '../src/features/twitch/history.js';
import { archiveGames } from '../src/features/twitch/archive-model.js';
import { valueOf, statusOf } from '../src/features/twitch/chart.js';

const audience = (median = 100, unknown = 0) => ({
  rule: 'followers_gt_1000_viewers_gte_10_v1', min_followers_exclusive: 1000,
  min_viewers_inclusive: 10, followers_max_age_hours: 24,
  status: unknown ? 'partial' : 'complete', median_viewer_count: unknown ? null : median,
  eligible_streamer_count: 1, eligible_viewer_count: 100,
  excluded_low_viewer_count: 0, excluded_low_follower_count: 0, unknown_follower_count: unknown,
});
const raw = () => ({ game_id: '1', game_name: 'Test', status: 'observed', viewer_count: 10000, streamer_count: 10,
  filtered_audience: audience(1000), audience_regions: { zh: { viewer_count: 100, streamer_count: 1,
    median_viewer_count: 100, filtered_audience: audience() } } });

test('Chinese is the UI default; missing history is distinct from observed zero', () => {
  assert.equal(DEFAULT_REGION, 'zh'); assert.equal(regionOf('bad'), 'zh');
  const missing = forRegion({ ...raw(), audience_regions: undefined }, 'zh');
  assert.equal(missing.viewer_count, null); assert.equal(missing.filtered_audience.status, 'unavailable');
  assert.match(statusOf(missing, 'viewers'), /未收集中文區/);
  const zero = forRegion({ ...raw(), audience_regions: { zh: { viewer_count: 0, streamer_count: 0 } } }, 'zh');
  assert.equal(valueOf(zero, 'viewers'), 0); assert.equal(valueOf(zero, 'median'), null);
});
test('regional view replaces only metrics and sorting uses Chinese totals', () => {
  const one = raw(), two = { ...raw(), game_id: '2', viewer_count: 8000,
    audience_regions: { zh: { viewer_count: 500, streamer_count: 2 } } };
  assert.equal(select([one, two], { sort: 'viewers' })[0].game_id, '1');
  assert.equal(select([one, two].map(row => forRegion(row, 'zh')), { sort: 'viewers' })[0].game_id, '2');
  assert.equal(one.viewer_count, 10000); assert.equal(one.audience_regions.zh.viewer_count, 100);
  assert.equal(forRegion(one, 'global').viewer_count, 10000);
});
test('Chinese medians validate their own population and foreign unknowns do not leak in', () => {
  const row = raw(); row.filtered_audience = audience(100, 3);
  assert.equal(valueOf(forRegion(row, 'zh'), 'median'), 100);
  row.audience_regions.zh.filtered_audience = audience(100, 1);
  assert.equal(valueOf(forRegion(row, 'zh'), 'median'), null);
  assert.equal(forRegion(row, 'zh').filtered_audience.status, 'invalid');
  row.audience_regions.zh.viewer_count = 10001;
  assert.equal(forRegion(row, 'zh').viewer_count, null);
});
test('daily and monthly charts project the same region; CSV identifies missing Chinese data', () => {
  const hour = '2026-10-31T00:00:00Z', at = Date.parse(hour), generated = '2026-10-31T00:10:00Z';
  const index = { months: { '2026-10': { [hour]: generated } } };
  const chunks = { '2026-10': { hours: { [hour]: { ...raw(), generated_at: generated } } } };
  const [monthly] = seriesRows(index, chunks, '1', at, at, 'zh');
  const [daily] = historyRows([{ schema_version: 1, timezone: 'Asia/Taipei', date: '2026-10-31',
    hours: { [hour]: { generated_at: generated, games: [raw()] } } }], '1', '2026-10-31T00:10:00Z', 'zh').slice(-1);
  assert.equal(valueOf(monthly, 'viewers'), 100); assert.equal(valueOf(daily, 'viewers'), 100);
  assert.match(csvRows([monthly]), /語言區域/); assert.match(csvRows([monthly]), /中文區/);
  const missing = forRegion({ ...raw(), audience_regions: undefined }, 'zh');
  missing.hour = hour;
  assert.match(csvRows([missing]), /未收集中文區/);
});
test('region survives detail, return links, and archive ranking without borrowing global peaks', () => {
  const link = new URL(detailHref('1', '?region=global&q=Test&view=archive'), 'https://example.test/');
  assert.equal(link.searchParams.get('region'), 'global');
  assert.match(link.searchParams.get('back'), /region=global/);
  assert.equal(overviewQuery('?region=bad'), '');
  const game = { name: 'Test', archive_eligible: true, tracking_status: 'ended', first_hour: '2026-10-01T00:00:00Z',
    last_hour: '2026-10-31T00:00:00Z', sample_count: 100, peak_viewer_count: 9999 };
  assert.equal(archiveGames({ games: { '1': game } }, 'zh')[0].peak, null);
  game.audience_regions = { zh: { sample_count: 2, peak_viewer_count: 100 } };
  assert.equal(archiveGames({ games: { '1': game } }, 'zh')[0].peak, 100);
});
