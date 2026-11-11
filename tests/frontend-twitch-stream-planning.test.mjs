import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateStart, dayOf, detailHref } from '../src/features/twitch/series.js';
import { compareTrialTimes, trialWindow, trialGames, trialSample, sortTrialGames, trialBenchmarks, trialReason } from '../src/features/twitch/stream-planning-model.js';
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

test('trial comparisons exclude prelaunch and missing observations and keep real zeroes', () => {
  const period = trialWindow('20', now);
  const month = '2026-11';
  const index = { months:{ [month]:{} } }, chunks = { [month]:{ hours:{} } };
  const counts = [[90000,20], [90000,20], [0,0], [1000,2], [3000,4], null, [2000,3]];
  period.slots.forEach((at, i) => {
    const hour = iso(at), generated_at = iso(at + 60000);
    index.months[month][hour] = generated_at;
    if (!counts[i]) return;
    const [viewer_count, streamer_count] = counts[i];
    chunks[month].hours[hour] = { generated_at, viewer_count, streamer_count,
      audience_regions: i === 2 || i === 3 ? { zh:{ viewer_count:0, streamer_count:0 } } : undefined };
  });
  const game = { id:'1', released:dateStart('2026-11-06') };
  assert.deepEqual(trialSample(index, chunks, game, period, 'global'), { days:4,totalDays:7,viewers:1500,streamers:2.5 });
  assert.deepEqual(trialSample(index, chunks, game, period, 'zh'), { days:2,totalDays:7,viewers:null,streamers:null });
});

test('trial selection keeps archived and unreleased games out, with separate competition sorting', () => {
  const period = trialWindow('20', now);
  const games = ['1','2','3','4'].map(id => ({ id, status:id === '3' ? 'ended' : 'active', last:iso(now), peak:1000, chinesePeak:100 }));
  const index = { games:Object.fromEntries(games.map(game => [game.id, { release_reference:{
    precision:'day', date:game.id === '4' ? '2026-11-12' : '2026-11-01',
  } }])) };
  const candidates = trialGames(index, games, period, 'global');
  assert.deepEqual(candidates.map(game => game.id), ['1','2']);
  const rows = candidates.map((game, i) => ({ game, samples:{global:{viewers:1000-i*100,streamers:5-i*2}} }));
  assert.deepEqual(sortTrialGames(rows, 'global', 'viewers').map(row => row.game.id), ['1','2']);
  assert.deepEqual(sortTrialGames(rows, 'global', 'competition').map(row => row.game.id), ['2','1']);
  const link = new URL(detailHref('2', '?view=streamer&stream_hour=0&stream_region=compare&stream_order=competition&stream_q=Game'), 'https://example.com/');
  assert.equal(link.searchParams.get('region'), 'compare');
  assert.equal(link.searchParams.get('back'), 'view=streamer&stream_hour=0&stream_region=compare&stream_order=competition&stream_q=Game');
});

test('trial card reasons compare visible games within each region and distinguish zero from missing data', () => {
  const sample = (viewers, streamers) => ({ viewers, streamers });
  const rows = [
    { samples:{ global:sample(300, 2), zh:sample(10, 5) } },
    { samples:{ global:sample(200, 3), zh:sample(0, 0) } },
    { samples:{ global:sample(100, 4), zh:sample(null, null) } },
  ];
  const global = trialBenchmarks(rows, 'global'), zh = trialBenchmarks(rows, 'zh');
  assert.equal(trialReason(rows[0].samples.global, global), '觀眾較多 · 同播較少');
  assert.equal(trialReason(rows[1].samples.global, global), '觀眾與同播居中');
  assert.equal(trialReason(rows[2].samples.global, global), '觀眾較少 · 同播較多');
  assert.equal(trialReason(rows[0].samples.zh, zh), '有觀眾 · 同區可比遊戲較少');
  assert.equal(trialReason(rows[1].samples.zh, zh), '常見觀眾為 0');
  assert.equal(trialReason(rows[2].samples.zh, zh), '這個時段資料不足');
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
