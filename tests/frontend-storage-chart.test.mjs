import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueOf, statusOf } from '../src/features/twitch/chart.js';

test('history chart preserves real zero and keeps absent or missing measurements empty', () => {
  assert.equal(valueOf({status:'observed',viewer_count:0},'viewers'),0);
  for (const status of ['absent','missing']) assert.equal(valueOf({status,viewer_count:0},'viewers'),null);
  assert.match(statusOf({status:'absent'},'viewers'),/不代表觀眾為 0/);
  assert.match(statusOf({status:'missing'},'viewers'),/沒有收集紀錄/);
});
test('filtered median charts exclude partial, invalid and empty complete samples', () => {
  const filtered = {status:'complete',eligible_streamer_count:2,unknown_follower_count:0,median_viewer_count:12};
  assert.equal(valueOf({status:'observed',filtered_audience:filtered},'median'),12);
  for (const change of [{status:'partial'},{status:'invalid'},{unknown_follower_count:1},{eligible_streamer_count:0}]) {
    assert.equal(valueOf({status:'observed',filtered_audience:{...filtered,...change}},'median'),null);
  }
});
