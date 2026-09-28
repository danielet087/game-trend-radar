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
