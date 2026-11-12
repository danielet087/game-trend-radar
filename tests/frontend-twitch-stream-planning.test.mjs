import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateStart, dayOf, detailHref } from '../src/features/twitch/series.js';
import { compareTrialTimes, trialWindow } from '../src/features/twitch/stream-planning-model.js';
import { analyzeStreamHeat, streamHeatDate } from '../src/features/twitch/stream-heat-model.js';
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
  const link = new URL(detailHref('2', '?view=streamer&sort=streamers&stream_hour=0&stream_region=compare&stream_order=competition&stream_q=Game&stream_date=2026-11-10'), 'https://example.com/');
  assert.equal(link.searchParams.get('region'), 'compare');
  assert.equal(link.searchParams.get('back'), 'sort=streamers&view=streamer&stream_hour=0&stream_date=2026-11-10&region=compare&stream_q=Game');
});

const game = { tracking_status:'active', release_reference:{ date:'2026-11-05', precision:'day' } };
const daily = (date, viewers, missing = []) => Array.from({ length:24 }, (_, hour) => ({
  hour:iso(dateStart(date) + hour * 3600000), status:missing.includes(hour) ? 'missing' : 'observed',
  viewer_count:typeof viewers === 'function' ? viewers(hour) : viewers,
}));
const heat = (rows, date, options = {}) => analyzeStreamHeat(rows, { game, region:'zh', date, now, ...options });
const high = hour => [4, 7, 11, 21].includes(hour) ? 100 : 0;

test('Chinese daily heat counts all Taipei hours and separates sustained, sporadic, low and missing days', () => {
  const date = '2026-11-10';
  const warm = heat(daily(date, high), date);
  assert.equal(warm.signal, 'hot');
  assert.equal(warm.hits, 4);
  assert.equal(warm.median, 0);
  assert.equal(heat(daily(date, h => h === 11 ? 848 : 0), date).signal, 'sporadic');
  assert.equal(heat(daily(date, 0, [0,1,2]), date).signal, 'low');
  const ambiguous = heat(daily(date, h => [0,11,23].includes(h) ? 150 : 0, [3,4,5]), date);
  assert.deepEqual([ambiguous.signal, ambiguous.hits, ambiguous.validHours], ['insufficient',3,21]);
});

test('open Taiwan day becomes hot at the fourth hit and retains its date across timezone boundaries', () => {
  const date = '2026-11-11';
  const rows = daily(date, h => [0,2,8,11].includes(h) ? 100 : 0);
  const morning = heat(rows, date, { now:dateStart(date) + 10 * 3600000 });
  assert.deepEqual([morning.signal, morning.hits, morning.validHours], ['pending',3,11]);
  const noon = heat(rows, date, { now:dateStart(date) + 11 * 3600000 });
  assert.deepEqual([noon.signal, noon.hits, noon.validHours], ['hot',4,12]);
  assert.equal(streamHeatDate('2026-11-12', now), '2026-11-11');
  assert.equal(streamHeatDate('2026-02-30', now), '2026-11-11');
});

test('daily cooldown requires earlier heat and three weak determinate days, pausing short ambiguous gaps', () => {
  const prior = daily('2026-11-05', high);
  const weak = [...daily('2026-11-06', 0), ...daily('2026-11-08', h => h === 7 ? 120 : 0), ...daily('2026-11-09', 0)];
  const shortGap = daily('2026-11-07', 0, [0,1,2,3]);
  const rows = [...prior, ...shortGap, ...weak, ...daily('2026-11-10', high)];
  assert.equal(heat(rows, '2026-11-07').signal, 'insufficient');
  assert.equal(heat(rows, '2026-11-08').signal, 'sporadic');
  const cooled = heat(rows, '2026-11-09');
  assert.deepEqual([cooled.signal, cooled.confirmedOn], ['cooled','2026-11-10']);
  assert.equal(heat(rows, '2026-11-10').signal, 'hot');
  assert.equal(heat([...weak, ...shortGap], '2026-11-09').signal, 'low');
  const longGap = daily('2026-11-07', 0, Array.from({ length:13 }, (_, h) => h));
  assert.equal(heat([...prior, ...weak, ...longGap], '2026-11-09').signal, 'low');
});

test('global daily heat uses the selected closed day median and excludes pre-release observations', () => {
  const date = '2026-11-10';
  const rows = [...daily('2026-11-04', 9000), ...daily(date, 4000)];
  assert.equal(heat(rows, '2026-11-04', { region:'global' }).signal, 'insufficient');
  const dailyGlobal = heat(rows, date, { region:'global' });
  assert.deepEqual([dailyGlobal.signal, dailyGlobal.median, dailyGlobal.validHours], ['hot',4000,24]);
});

test('the global outlook uses the last completed day before today has closed', () => {
  const rows = [...daily('2026-11-10', 4200), ...daily('2026-11-11', 0)];
  const result = heat(rows, '2026-11-11', { region:'global' });
  assert.equal(result.signal, 'pending');
  assert.equal(result.outlook.signal, 'hot');
  assert.equal(result.outlook.latest.date, '2026-11-10');
  assert.equal(result.outlook.latest.median, 4200);
});

test('Chinese outlook detects falling audiences when both periods reach the same number of hours', () => {
  const rows = Array.from({ length:6 }, (_, i) => daily(`2026-11-${String(i + 5).padStart(2, '0')}`, hour => {
    if (hour === 21) return 10000;
    return [4,7,11].includes(hour) ? i < 3 ? 400 : 200 : 0;
  })).flat();
  const open = daily('2026-11-11', 9000);
  const selected = heat([...rows, ...open], '2026-11-11');
  assert.equal(selected.signal, 'hot');
  assert.deepEqual(selected.outlook.comparison, { previous:400, recent:200, change:-50, signal:'falling' });
  assert.equal(selected.outlook.signal, 'falling');
  assert.equal(selected.outlook.latest.thresholdHits, 4);
  assert.equal(heat([...rows, ...open], '2026-11-09').outlook.comparison, null);
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
