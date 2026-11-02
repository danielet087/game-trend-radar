import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyRows } from '../src/features/twitch/daily-series.js';
import { valueOf, statusOf } from '../src/features/twitch/chart.js';

const HOUR = 3600000;
const start = Date.parse('2026-10-01T00:00:00+08:00');
const day = (offset, values, missing = 0) => Array.from({ length: 24 }, (_, h) => ({
  hour: new Date(start + (offset * 24 + h) * HOUR).toISOString(),
  status: h < missing ? 'missing' : 'observed',
  viewer_count: h < missing ? null : typeof values === 'function' ? values(h) : values,
}));

test('daily audience uses Taipei dates and the median, retains real zero and does not mutate hours', () => {
  const rows = [...day(0, h => h < 12 ? 0 : 100), ...day(1, 0)], original = structuredClone(rows);
  const result = dailyRows(rows, { now: start + 3 * 24 * HOUR });
  assert.deepEqual(result.map(r => [r.date, valueOf(r, 'viewers')]), [['2026-10-01', 50], ['2026-10-02', 0]]);
  assert.match(statusOf(result[0], 'viewers'), /有效 24 \/ 24/);
  assert.deepEqual(rows, original);
});
test('twelve observations are sufficient; thirteen missing hours create a gap rather than a zero', () => {
  const result = dailyRows([...day(0, 4000, 12), ...day(1, 1000, 13), ...day(2, 2000)], { now: start + 4 * 24 * HOUR });
  assert.deepEqual(result.map(r => valueOf(r, 'viewers')), [4000, null, 2000]);
  assert.match(statusOf(result[1], 'viewers'), /未達 12 筆/);
});
test('an open Taipei day stays blank even with a full set of supplied future observations', () => {
  const [result] = dailyRows(day(0, 9999), { now: start + 23 * HOUR });
  assert.equal(valueOf(result, 'viewers'), null);
  assert.match(statusOf(result, 'viewers'), /尚未結束/);
});
test('a rolling range omits its partial first date, and unavailable Chinese history stays blank', () => {
  const rows = [...day(0, 9000).slice(8), ...day(1, null), ...day(2, 2000)];
  const result = dailyRows(rows, { now: start + 4 * 24 * HOUR });
  assert.deepEqual(result.map(r => r.date), ['2026-10-02', '2026-10-03']);
  assert.equal(valueOf(result[0], 'viewers'), null);
  assert.equal(valueOf(result[1], 'viewers'), 2000);
});
