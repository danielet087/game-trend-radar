const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../assets/radar-insights-v1.js');
const observation = (date, followers, source = 'steam_community') => ({ at: date + 'T01:00:00Z', followers, source });

test('daily observations use Taipei dates and the latest authentic measurement without filling gaps', () => {
  const points = I.points([
    observation('2026-09-21', 6000), observation('2026-09-28', 6500),
    { at: '2026-09-27T18:00:00Z', followers: 6400, source: 'steam_community' },
    observation('2026-09-29', 7000), observation('2026-09-28', -1),
    observation('2026-09-28', 9999, 'third_party'),
    { at: '2026-09-28T10:00:00', followers: 9999, source: 'steam_community' },
  ], '2026-09-28');
  assert.deepEqual(points.map(p => [p.day, p.followers]), [['2026-09-21', 6000], ['2026-09-28', 6500]]);
  assert.equal(I.taipeiDay('2026-09-27T16:01:00Z'), '2026-09-28');
  assert.equal(I.day('2026-02-30'), null);
});

test('growth requires an exact baseline and a fresh latest measurement; missing is never zero', () => {
  const ready = I.metric([observation('2026-09-21', 6000), observation('2026-09-28', 6600)], 7, '2026-09-28');
  assert.equal(ready.status, 'ready'); assert.equal(ready.delta, 600); assert.equal(ready.percent, 10);
  assert.equal(I.metric([], 7, '2026-09-28').status, 'missing');
  assert.equal(I.metric([observation('2026-09-20', 6000), observation('2026-09-28', 6600)], 7, '2026-09-28').status, 'accumulating');
  assert.equal(I.metric([observation('2026-09-18', 6000), observation('2026-09-25', 6600)], 7, '2026-09-28').status, 'stale');
  const falling = I.metric([observation('2026-09-21', 6000), observation('2026-09-28', 5900)], 7, '2026-09-28');
  assert.equal(falling.delta, -100);
  assert.equal(I.metric([observation('2026-09-21', 0), observation('2026-09-28', 10)], 7, '2026-09-28').percent, null);
});

test('tracking includes release plus 30 days, excludes the next day and validates dates', () => {
  assert.equal(I.tracking('2026-08-29', '2026-09-28'), true);
  assert.equal(I.tracking('2026-08-28', '2026-09-28'), false);
  assert.equal(I.tracking('2026-10-01', '2026-09-28'), true);
  assert.equal(I.tracking('bad', '2026-09-28'), false);
  assert.equal(I.offset('2026-12-15', 30), '2027-01-14');
});

test('comparison URLs retain at most three unique valid app IDs', () => {
  assert.deepEqual(I.comparisonIds('12,12,34,0,-1,Infinity,56,78'), [12, 34, 56]);
  assert.deepEqual(I.comparisonIds([1, '2', null, true, '3x']), [1, 2]);
});

test('comparison aligns different measurement dates to one exact shared window', () => {
  const result = I.comparisonWindow([
    { appid: 1, date: '2026-10-01', history: [observation('2026-09-21', 100), observation('2026-09-28', 140)] },
    { appid: 2, date: '2026-10-01', history: [observation('2026-09-20', 200), observation('2026-09-27', 300)] },
  ], 7, undefined, '2026-09-28');
  assert.equal(result.start, '2026-09-21'); assert.equal(result.end, '2026-09-28');
  assert.equal(result.days.length, 8);
  assert.deepEqual(result.series[0].values, [100, null, null, null, null, null, null, 140]);
  assert.equal(result.series[0].delta, 40); assert.equal(result.series[0].percent, 40);
  assert.equal(result.series[0].status, 'ready');
  assert.equal(result.series[1].status, 'partial');
  assert.equal(result.series[1].baseline, null); assert.equal(result.series[1].endPoint, null);
  assert.equal(result.series[1].delta, null); assert.equal(result.series[1].percent, null);
  assert.equal(result.series[1].observedDays, 1);
  assert.ok(result.series.every(series => series.daily.every(value => value === null)));
});

test('comparison deduplicates Taipei daily observations and never bridges gaps', () => {
  const result = I.comparisonWindow([{ appid: 1, date: '2026-10-01', history: [
    { at: '2026-09-21T15:59:59Z', followers: 100, source: 'steam_community' },
    { at: '2026-09-21T16:00:00Z', followers: 110, source: 'steam_community' },
    { at: '2026-09-22T07:00:00Z', followers: 120, source: 'steam_community' },
    observation('2026-09-24', 140), observation('2026-09-25', 145),
    observation('2026-09-28', 150), observation('2026-09-29', 900),
  ] }], 7, '2026-09-28', '2026-09-28').series[0];
  assert.deepEqual(result.values, [100, 120, null, 140, 145, null, null, 150]);
  assert.deepEqual(result.daily, [null, 20, null, null, 5, null, null, null]);
  assert.equal(result.observedDays, 5);
  assert.equal(result.points[1].at, '2026-09-22T07:00:00Z');
});

test('comparison retains archived history through release plus thirty days inclusive', () => {
  const games = [{ appid: 1, date: '2026-08-01', history: [
    observation('2026-08-24', 5000), observation('2026-08-31', 5500),
    observation('2026-09-01', 9999),
  ] }];
  const archived = I.comparisonWindow(games, 7, undefined, '2026-09-28');
  assert.equal(archived.end, '2026-08-31'); assert.equal(archived.start, '2026-08-24');
  assert.equal(archived.series[0].status, 'ready'); assert.equal(archived.series[0].delta, 500);
  assert.equal(archived.series[0].trackUntil, '2026-08-31');
  assert.equal(archived.series[0].tracking, false);
  assert.equal(I.metric(games[0].history.slice(0, 2), 7, '2026-09-28').status, 'stale');
  const stopped = I.comparisonWindow(games, 7, '2026-09-01', '2026-09-28').series[0];
  assert.equal(stopped.status, 'partial'); assert.equal(stopped.delta, null);
  assert.equal(stopped.values.at(-1), null);
  assert.equal(I.comparisonWindow(games, 7, undefined, '2026-08-31').series[0].tracking, true);
});

test('comparison accepts actual zero and negative growth while keeping absent values null', () => {
  const result = I.comparisonWindow([
    { appid: 1, date: '2026-10-01', history: [observation('2026-09-21', 100), observation('2026-09-22', 0), observation('2026-09-23', 0), observation('2026-09-28', 0)] },
    { appid: 2, date: '2026-10-01', history: [observation('2026-09-21', 0), observation('2026-09-28', 10)] },
  ], 7, '2026-09-28', '2026-09-28');
  assert.deepEqual(result.series[0].daily.slice(0, 4), [null, -100, 0, null]);
  assert.equal(result.series[0].delta, -100); assert.equal(result.series[0].percent, -100);
  assert.equal(result.series[1].delta, 10); assert.equal(result.series[1].percent, null);
});

test('comparison validates records, source provenance and calendar bounds without changing input', () => {
  const games = [null, { appid: -1 }, { appid: 1, date: '2026-10-01', history: [
    observation('2026-09-20', 20), observation('2026-09-28', 30, 'third_party'),
    observation('2026-09-22', -1), observation('2026-09-23', '40'),
    observation('2026-02-30', 900),
    { at: '2026-09-27T10:00:00', followers: 50, source: 'steam_community' },
  ] }, { appid: '1', date: '2026-10-01', history: [observation('2026-09-28', 900)] },
  { appid: 2, date: '2026-02-30', history: [observation('2026-09-28', 900)] },
  { appid: 3, date: '2026-10-01' }, { appid: 4, date: '2026-10-01' }];
  const copy = structuredClone(games);
  const result = I.comparisonWindow(games, 42, '2026-09-29', '2026-09-28');
  assert.equal(result.span, 30); assert.equal(result.days.length, 31);
  assert.equal(result.end, '2026-09-20');
  assert.deepEqual(result.series.map(series => series.appid), [1, 2, 3]);
  assert.equal(result.series[0].observedDays, 1);
  assert.equal(result.series[1].status, 'invalid'); assert.equal(result.series[1].trackUntil, null);
  assert.equal(result.series[2].status, 'missing');
  assert.deepEqual(games, copy);
  assert.throws(() => I.comparisonWindow(games, 7, undefined, 'invalid'), TypeError);
  const empty = I.comparisonWindow(null, '90', 'invalid', '2026-09-28');
  assert.equal(empty.end, '2026-09-28'); assert.equal(empty.days.length, 91);
  assert.deepEqual(empty.series, []);
});
