import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateStart, dayOf, detailHref } from '../src/features/twitch/series.js';
import { compareTrialTimes, trialWindow } from '../src/features/twitch/stream-planning-model.js';
import { analyzeStreamHeat, streamHeatWindow } from '../src/features/twitch/stream-heat-model.js';
import { analyzeCooldown } from '../src/features/twitch/cooldown-model.js';
import { streamerAdvice } from '../src/features/twitch/heat-overview.js';

const now = Date.parse('2026-11-11T09:00:00+08:00');
const iso = at => new Date(at).toISOString().replace('.000Z', 'Z');

test('trial windows use the selected Taipei hour across seven closed days', () => {
  const midnight = trialWindow('0', now);
  assert.equal(midnight.slots.length, 7);
  assert.equal(iso(midnight.start), '2026-11-03T16:00:00Z');
  assert.equal(iso(midnight.end), '2026-11-09T16:00:00Z');
  assert.equal(dayOf(midnight.end), '2026-11-10');
});

test('trial detail links carry the shared current filters and accept the previous region parameter', () => {
  const link = new URL(detailHref('2', '?view=streamer&sort=streamers&stream_hour=0&stream_region=compare&stream_order=competition&stream_q=Game'), 'https://example.com/');
  assert.equal(link.searchParams.get('region'), 'compare');
  assert.equal(link.searchParams.get('back'), 'sort=streamers&view=streamer&stream_hour=0&region=compare&stream_q=Game');
});

function heatFixture(values, region, releaseDate = '2026-11-05') {
  const period = streamHeatWindow(now);
  const rows = [...period.previous, ...period.recent].flatMap((day, i) =>
    Array.from({ length:values[i] === null ? 11 : 24 }, (_, hour) => ({
      hour:iso(dateStart(day) + hour * 3600000), status:'observed', viewer_count:values[i] ?? 80000,
    })));
  rows.push({ hour:iso(dateStart(dayOf(now)) + 8 * 3600000), status:'observed', viewer_count:100000 });
  const game = { tracking_status:'active', release_reference:{ date:releaseDate, precision:'day' } };
  return analyzeStreamHeat(rows, { game, region, period });
}

test('stream heat uses closed Taipei days and the established cooldown date and coverage', () => {
  const period = streamHeatWindow(now);
  assert.deepEqual(period.previous, ['2026-11-05', '2026-11-06', '2026-11-07']);
  assert.deepEqual(period.recent, ['2026-11-08', '2026-11-09', '2026-11-10']);
  const cooled = heatFixture([3600, 3800, 4000, 1600, 1400, 1200], 'global');
  assert.equal(cooled.signal, 'cooled');
  assert.equal(cooled.confirmedOn, '2026-11-11');
  assert.equal(cooled.lowDays, 3);
  assert.equal(cooled.previous.median, 3800);
  assert.equal(cooled.recent.median, 1400);
  const gap = heatFixture([3600, 3800, 4000, 1600, null, 1200], 'global');
  assert.equal(gap.signal, 'suspected');
  assert.equal(gap.lowDays, 1);
  assert.equal(gap.recent.median, null);
  assert.equal(heatFixture([2200, 2500, 2800, 1000, 900, 800], 'global').signal, 'falling');
});

test('stream heat requires a meaningful regional breakout with two qualifying days and a qualifying last day', () => {
  const counts = [0, 0, 2, 7, 150, 100];
  const breakout = heatFixture(counts, 'zh');
  assert.equal(breakout.signal, 'breakout');
  assert.equal(breakout.growthDays, 2);
  assert.equal(breakout.previous.median, 0);
  assert.equal(breakout.recent.median, 100);
  assert.equal(breakout.change, null);
  assert.equal(heatFixture(counts, 'global').signal, 'not_popular');
  assert.equal(heatFixture([0, 0, 2, 150, 100, 7], 'zh').signal, 'suspected');
  assert.equal(heatFixture([0, 0, 2, 7, 150, 7], 'zh').signal, 'suspected');
  assert.equal(heatFixture([0, 50, 2, 7, 150, 100], 'zh').signal, 'rising');
  assert.equal(heatFixture(counts, 'zh', '2026-11-06').previous.median, null);
  assert.equal(heatFixture([0, 0, 2, 7, 150, null], 'zh').signal, 'insufficient');
});

function trialFixture(period, hours, counts, releaseDate) {
  const index = { months:{}, games:{ '1':{ release_reference:{ date:releaseDate, precision:'day' } } } }, chunks = {};
  period.slots.forEach((day, i) => hours.forEach((hour, j) => {
    const at = day + hour * 3600000, stamp = iso(at), month = dayOf(at).slice(0, 7), generated_at = iso(at + 60000);
    (index.months[month] ||= {})[stamp] = generated_at;
    const values = counts[i]?.[j];
    if (!values) return;
    const [viewer_count, streamer_count, zh] = values;
    (chunks[month] ||= { hours:{} }).hours[stamp] = { generated_at, viewer_count, streamer_count,
      audience_regions: zh ? { zh:{ viewer_count:zh[0], streamer_count:zh[1] } } : undefined };
  }));
  return { index, chunks };
}

test('time comparison uses matched Taiwan dates across months and keeps regional coverage independent', () => {
  const period = trialWindow(0, Date.parse('2026-11-04T09:00:00+08:00')), hours = [0, 22];
  const counts = [
    [[9000,12],[9000,14]], [[9000,12],[9000,14]],
    [[0,0,[0,0]],[500,15,[1,1]]], [[50000,20,[40,1]],null], [null,[60000,25,[40,1]]],
    [[600,3,[10,1]],[500,6]], [[700,4,[20,1]],[500,8,[5,1]]],
  ];
  const { index, chunks } = trialFixture(period, hours, counts, '2026-10-30');
  const global = compareTrialTimes(index, chunks, '1', period, hours, 'global');
  assert.deepEqual(global.dates, ['2026-10-30', '2026-11-02', '2026-11-03']);
  assert.deepEqual(global.slots, [
    { hour:0, observed:4, viewers:600, streamers:3, strongerDays:2 },
    { hour:22, observed:4, viewers:500, streamers:8, strongerDays:0 },
  ]);
  assert.equal(global.preferred.hour, 0);
  const chinese = compareTrialTimes(index, chunks, '1', period, hours, 'zh');
  assert.deepEqual(chinese.dates, ['2026-10-30','2026-11-03']);
  assert.deepEqual(chinese.slots.map(slot => [slot.observed, slot.viewers]), [[4,null],[3,null]]);
  assert.equal(chinese.preferred, null);
});

test('time comparison withholds a preferred hour when the median advantage lacks a majority of paired days', () => {
  const period = trialWindow(0, now), hours = [20, 22];
  const { index, chunks } = trialFixture(period, hours,
    [[[10,2],[9,3]], [[11,2],[9,3]], [[5,2],[10,3]], [[200,9],[9,3]]], '2026-11-01');
  const comparison = compareTrialTimes(index, chunks, '1', period, hours, 'global');
  assert.equal(comparison.typicalLead.hour, 20);
  assert.equal(comparison.typicalLead.strongerDays, 2);
  assert.equal(comparison.preferred, null);
});

test('confirmed cooldown can suggest a wrap-up while stale and archived data prompt a fresh check', () => {
  const rows = Array.from({ length:4*24+9 }, (_, i) => ({
    hour:iso(dateStart('2026-11-07')+i*3600000), status:'observed', viewer_count:i<24 ? 4000 : 1500,
  }));
  const data = analyzeCooldown(rows, { now });
  assert.equal(data.status, 'cooled');
  const snapshot = { data, status:data.status, historical:false };
  assert.equal(streamerAdvice(snapshot, now)[0], '考慮收尾或換題');
  assert.equal(streamerAdvice(snapshot, now + 13*3600000)[0], '先等有效資料');
  assert.equal(streamerAdvice({ ...snapshot, historical:true }, now)[0], '先核對近期表現');
});
