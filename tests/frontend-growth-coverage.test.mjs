import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growthCollectionNotice } from '../src/features/insights/growth.js';

test('a completed collection still explains the unavailable official follower measurements', () => {
  const notice = growthCollectionNotice({status:'completed',collection_complete:true,measurement_complete:false,
    coverage:{eligible:136,measured:123,unavailable:13,pending:0}});
  assert.match(notice,/123／136/);
  assert.match(notice,/13 款暫無官方 GroupID/);
  assert.match(notice,/保留有效歷史/);
  assert.match(notice,/不會計為零成長/);
  assert.doesNotMatch(notice,/等待後續重試/);
});

test('retryable coverage gaps remain visible independently of unavailable games', () => {
  const notice = growthCollectionNotice({status:'awaiting_group_resolution',
    coverage:{eligible:136,measured:123,unavailable:12,pending:1}});
  assert.match(notice,/12 款暫無官方 GroupID/);
  assert.match(notice,/1 款等待後續重試/);
  assert.match(growthCollectionNotice({status:'awaiting_group_resolution',measurements:123}),/未能完成量測/);
});

test('full measured coverage has no warning and legacy failures still preserve history', () => {
  assert.equal(growthCollectionNotice({status:'completed',coverage:{eligible:136,measured:136,unavailable:0,pending:0}}),'');
  assert.equal(growthCollectionNotice(null),'');
  assert.match(growthCollectionNotice({status:'rate_limited'}),/受到限流/);
  assert.match(growthCollectionNotice({status:'interrupted'}),/保留有效歷史/);
});
