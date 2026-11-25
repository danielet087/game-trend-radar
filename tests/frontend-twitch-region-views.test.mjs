import test from 'node:test';
import assert from 'node:assert/strict';
import { regionsFor, projectRows } from '../src/features/twitch/region-views.js';
import { detailHref } from '../src/features/twitch/series.js';

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
