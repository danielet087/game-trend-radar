import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStatistics, metricValue, quantile } from '../src/features/twitch/statistics-model.js';

const HOUR = 3600000, start = Date.parse('2026-10-20T00:00:00Z');
const row = (index, viewer_count, extra = {}) => ({ hour: new Date(start + index * HOUR).toISOString(),
  status: 'observed', viewer_count, streamer_count: 10, ...extra });
const audience = (extra = {}) => ({ rule: 'followers_gt_1000_viewers_gte_10_v1',
  min_followers_exclusive: 1000, min_viewers_inclusive: 10, followers_max_age_hours: 24,
  status: 'complete', eligible_streamer_count: 2, eligible_viewer_count: 60, median_viewer_count: 30,
  excluded_low_viewer_count: 0, excluded_low_follower_count: 0, unknown_follower_count: 0, ...extra });

test('distribution uses interpolated quartiles while preserving zero and excluding unobserved or malformed counts', () => {
  const data = [row(0, 0), row(1, 10), row(2, 20), row(3, 30), row(4, 900, { status: 'missing' }),
    row(5, 900, { status: 'absent' }), row(6, NaN), row(7, '100'), row(8, -1)];
  const result = analyzeStatistics(data).distribution;
  assert.deepEqual(result.values, [0, 10, 20, 30]);
  assert.equal(result.count, 4); assert.equal(result.total, 9); assert.equal(result.coverage, 4 / 9);
  assert.equal(result.mean, 15); assert.equal(result.median, 15);
  assert.equal(result.q1, 7.5); assert.equal(result.q3, 22.5);
  assert.equal(result.min, 0); assert.equal(result.max, 30);
  assert.equal(quantile([100], .25), 100); assert.equal(quantile([], .5), null);
  assert.equal(quantile([1, 2], 2), null);
});

test('24h rolling medians compare complete adjacent periods and leave gaps unsmoothed', () => {
  const data = Array.from({ length: 48 }, (_, n) => row(n, n));
  const result = analyzeStatistics(data).trend;
  assert.equal(result.points[22].value, null); assert.equal(result.points[23].value, 11.5);
  assert.equal(result.points[47].value, 35.5);
  assert.equal(result.points[0].raw, 0); assert.equal(result.rawPoints[0].value, 0);
  assert.equal(result.current.median, 35.5); assert.equal(result.current.count, 24);
  assert.equal(result.previous.median, 11.5); assert.equal(result.previous.count, 24);
  assert.equal(result.comparable, true);
  assert.ok(Math.abs(result.change - 24 / 11.5 * 100) < 1e-10);
  const missing = analyzeStatistics(data.map((item, n) => n === 30 ? { ...item, status: 'missing' } : item)).trend;
  assert.equal(missing.points[47].value, null); assert.equal(missing.current.count, 23);
  assert.equal(missing.comparable, false); assert.equal(missing.change, null); assert.ok(missing.reason);
  const absentSlot = analyzeStatistics(data.filter((_, n) => n !== 30)).trend;
  assert.equal(absentSlot.points.at(-1).value, null); assert.equal(absentSlot.comparable, false);
});

test('a 24h range never silently loads another period or divides by zero for change', () => {
  const onlyOne = analyzeStatistics(Array.from({ length: 24 }, (_, n) => row(n, 20))).trend;
  assert.equal(onlyOne.current.count, 24); assert.equal(onlyOne.previous.count, 0);
  assert.equal(onlyOne.comparable, false); assert.equal(onlyOne.change, null);
  const zeroBase = analyzeStatistics(Array.from({ length: 48 }, (_, n) => row(n, n < 24 ? 0 : 20))).trend;
  assert.equal(zeroBase.comparable, true); assert.equal(zeroBase.change, null);
  assert.match(zeroBase.reason, /為 0/);
});

test('threshold runs stop at a missing slot, physical time gap or a below-threshold observation', () => {
  const data = [row(0, 5000), row(1, 7000), row(2, 9000, { status: 'missing' }), row(3, 6000),
    row(4, 6000), row(6, 6000), row(7, 4000), row(8, 7000)];
  const result = analyzeStatistics(data, { threshold: 5000 }).persistence;
  assert.equal(result.totalSlots, 8); assert.equal(result.total, 7); assert.equal(result.count, 6);
  assert.equal(result.ratio, 6 / 7); assert.equal(result.longestHours, 2);
  assert.equal(result.longestStart, '2026-10-20T00:00:00Z');
  assert.equal(result.longestEnd, '2026-10-20T01:00:00Z');
  assert.equal(result.points[2].value, null); assert.equal(result.points[2].above, null);
  assert.equal(analyzeStatistics([row(0, 0)], { threshold: 0 }).persistence.count, 1);
});

test('filtered metrics require complete matching rules while totals use their own population', () => {
  const data = [row(0, 1000, { filtered_audience: audience() }),
    row(1, 2000, { filtered_audience: audience({ status: 'partial', unknown_follower_count: 1 }) }),
    row(2, 3000, { filtered_audience: audience({ rule: 'old_rule' }) }),
    row(3, 4000, { filtered_audience: audience({ eligible_viewer_count: 1 }) }),
    row(4, 5000)];
  const result = analyzeStatistics(data, { metric: 'median' });
  assert.equal(result.distribution.count, 1); assert.equal(result.distribution.median, 30);
  assert.equal(result.persistence.total, 5); assert.equal(result.supply.pairedCount, 5);
  assert.equal(result.supply.averageMedian, 300);
  assert.equal(metricValue(data[1], 'median'), null);
  assert.equal(metricValue(row(6, 0), 'viewers'), 0);
  assert.equal(metricValue(row(6, 0, { status: 'absent' }), 'viewers'), null);
});

test('supply uses valid paired total observations and handles zero channels without infinity', () => {
  const result = analyzeStatistics([row(0, 200), row(1, 300, { streamer_count: 0 }),
    row(2, 100, { streamer_count: null }), row(3, null, { streamer_count: 999 })]).supply;
  assert.equal(result.pairedCount, 2); assert.equal(result.viewersMedian, 250);
  assert.equal(result.streamersMedian, 5); assert.equal(result.averageMedian, 20);
  assert.equal(result.points[1].average, null); assert.equal(result.points[2].average, null);
  assert.equal(result.points[3].average, null);
});

test('hour-of-day summaries use Taiwan dates and count distinct observed days', () => {
  const result = analyzeStatistics([row(15, 10), row(16, 20), row(40, 60), row(41, 100, { status: 'missing' })]).hourly;
  assert.equal(result.hours.length, 24); assert.equal(result.observedDays, 3);
  assert.equal(result.hours[23].median, 10); assert.equal(result.hours[23].days, 1);
  assert.equal(result.hours[0].median, 40); assert.equal(result.hours[0].count, 2);
  assert.equal(result.hours[0].days, 2); assert.equal(result.hours[0].q1, 30); assert.equal(result.hours[0].q3, 50);
  assert.equal(result.hours[1].median, null); assert.equal(result.hours[1].count, 0);
});

test('normalization sorts and deduplicates instants without changing source rows', () => {
  const data = [row(1, 20), row(0, 10), { ...row(0, 30), hour: '2026-10-20T08:00:00+08:00' },
    { ...row(2, 999), hour: 'invalid' }, { ...row(3, 999), hour: '2026-10-20T03:30:00Z' }];
  const before = JSON.stringify(data), result = analyzeStatistics(data);
  assert.deepEqual(result.distribution.values, [30, 20]); assert.equal(result.distribution.total, 2);
  assert.equal(result.trend.points[0].hour, '2026-10-20T00:00:00Z');
  assert.equal(JSON.stringify(data), before);
  const empty = analyzeStatistics(null);
  assert.equal(empty.distribution.median, null); assert.equal(empty.persistence.ratio, null);
  assert.equal(empty.trend.comparable, false); assert.equal(empty.hourly.observedDays, 0);
  assert.doesNotThrow(() => JSON.stringify(empty));
});
