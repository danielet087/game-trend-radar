import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followerHistory, dailyFollowerPoints, withLatestFollowers } from '../src/domain/followers.mjs';
import { RadarInsights } from '../src/features/insights/metrics.js';

const point = (at, followers, source = 'steam_community') => ({ at, followers, source });
const today = '2026-11-10';
const game = { appid:5356470, source:'steam', followers:78, date:'2026-10-26' };
const record = { appid:5356470, followers:78, follower_checked_at:'2026-10-27T08:02:43.923534+08:00' };

test('Playable Archive detail and growth use the same newer dated official measurement', () => {
  const history = [point('2026-11-02T23:41:50Z', 500), point('2026-11-09T23:41:50Z', 807)];
  const original = structuredClone({ game, record, history });
  const growth = RadarInsights.metric(followerHistory(record, history), 7, today);
  const detail = withLatestFollowers(game, record, history, today);
  assert.equal(growth.latest.followers, 807);
  assert.equal(growth.latest.day, today);
  assert.equal(detail.followers, growth.latest.followers);
  assert.equal(detail.followersCheckedAt, growth.latest.at);
  assert.equal(detail.date, game.date, 'display measurements do not change catalog admission or dates');
  assert.deepEqual({ game, record, history }, original);
});

test('the measurement time wins even when the newer catalog count is lower or zero', () => {
  const history = [point('2026-11-09T23:41:50Z', 807)];
  for (const followers of [0, 500, 900]) {
    const current = { ...record, followers, follower_checked_at:'2026-11-10T09:00:00+08:00' };
    const detail = withLatestFollowers(game, current, history, today);
    const growth = RadarInsights.metric(followerHistory(current, history), 1, today);
    assert.equal(detail.followers, followers);
    assert.equal(detail.followers, growth.latest.followers);
    assert.equal(detail.followersCheckedAt, current.follower_checked_at);
  }
});

test('invalid, future, nonofficial and missing values never replace a valid observation', () => {
  const history = [
    point('2026-11-09T23:41:50Z', 807),
    point('2026-11-10T03:00:00Z', 99999, 'third_party'),
    point('2026-11-10T04:00:00', 99999),
    point('2026-11-10T04:00:00Z', null),
    point('2026-11-10T05:00:00Z', -1),
    point('2026-11-11T04:00:00Z', 99999),
    point('2026-02-30T04:00:00Z', 99999),
  ];
  assert.equal(withLatestFollowers(game, record, history, today).followers, 807);
  assert.equal(dailyFollowerPoints(history, today).length, 1);
  assert.equal(withLatestFollowers(game, null, null, today), game);
  const native = { source:'nintendo', followers:null, hypes:80 };
  assert.equal(withLatestFollowers(native, record, history, today), native);
});
