import test from 'node:test';
import assert from 'node:assert/strict';
import { blockScopes, writeBlockScopes, regionsFor, projectRows } from '../src/features/twitch/region-views.js';
import { detailHref } from '../src/features/twitch/series.js';

test('each block round-trips independently even when the return page has a different region', () => {
  const params = new URLSearchParams({ back: 'view=archive&archive_region=zh', region: 'zh' });
  const scopes = blockScopes(params);
  assert.deepEqual(scopes, { summary: 'zh', history: 'zh', cooldown: 'zh', statistics: 'zh' });
  scopes.summary = 'compare'; scopes.history = 'global'; scopes.cooldown = 'global';
  writeBlockScopes(params, scopes);
  assert.deepEqual(blockScopes(params), scopes);
  assert.equal(params.has('region'), false);
  assert.equal(new URLSearchParams(params.get('back')).get('archive_region'), 'zh');
  for (const key of Object.keys(scopes)) scopes[key] = 'global';
  writeBlockScopes(params, scopes);
  assert.deepEqual(blockScopes(params), scopes);
});
test('comparison never projects the Chinese subset as global and never fills missing Chinese history', () => {
  const rows = [{ hour: '2026-10-31T00:00:00Z', status: 'observed', viewer_count: 20000, streamer_count: 4 },
    { hour: '2026-10-31T01:00:00Z', status: 'observed', viewer_count: 10000, streamer_count: 4,
      audience_regions: { zh: { viewer_count: 0, streamer_count: 0 } } }];
  const original = structuredClone(rows);
  assert.deepEqual(regionsFor('compare'), ['global', 'zh']);
  assert.deepEqual(projectRows(rows, 'global').map(row => row.viewer_count), [20000, 10000]);
  assert.deepEqual(projectRows(rows, 'zh').map(row => row.viewer_count), [null, 0]);
  assert.deepEqual(rows, original);
});
test('archive detail links use the archive view without overwriting the current list preference', () => {
  const link = new URL(detailHref('42', '?region=zh&view=archive&archive_region=compare&q=Test'), 'https://example.test/');
  assert.equal(link.searchParams.get('region'), 'compare');
  const back = new URLSearchParams(link.searchParams.get('back'));
  assert.equal(back.get('region'), 'zh');
  assert.equal(back.get('archive_region'), 'compare');
});
