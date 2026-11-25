import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateStart, dayOf, detailHref, fullSeriesRows, HEAT_PROJECTION, streamPlanningHref, validHeatChunk } from '../src/features/twitch/series.js';
import { projectRows } from '../src/features/twitch/region-views.js';
import { CHINESE_MEASUREMENT_CHANGE_AT } from '../src/features/twitch/audience-region.js';
import { latestHistorySnapshot } from '../src/features/twitch/history.js';
import { trialWindow } from '../src/features/twitch/stream-planning-model.js';
import { slotStats } from '../src/features/twitch/stream-slot-model.js';
import { launchComparison, launchEntry, launchStatus, validCurves } from '../src/features/twitch/launch-curves.js';
import { analyzeStreamHeat, remainingAudienceTrend, streamHeatDate } from '../src/features/twitch/stream-heat-model.js';
import { analyzeCooldown } from '../src/features/twitch/cooldown-model.js';
import { globalVerdict } from '../src/features/twitch/trend-verdict.js';

const now = Date.parse('2026-11-11T09:00:00+08:00');
const iso = at => new Date(at).toISOString().replace('.000Z', 'Z');

test('trial windows use the selected Taipei hour across seven closed days', () => {
  const midnight = trialWindow('0', now);
  assert.equal(midnight.slots.length, 7);
  assert.equal(iso(midnight.start), '2026-11-03T16:00:00Z');
  assert.equal(iso(midnight.end), '2026-11-09T16:00:00Z');
  assert.equal(dayOf(midnight.end), '2026-11-10');
});

test('game page links carry the planning filters back and turn older planning parameters into the new ones', () => {
  const link = new URL(detailHref('2', '?view=streamer&sort=change&group=cooled&region=zh&q=Game&stream_date=2026-11-10'), 'https://example.com/');
  assert.equal(link.searchParams.get('region'), 'zh');
  assert.equal(link.searchParams.get('back'), 'q=Game&sort=change&region=zh&view=streamer&stream_date=2026-11-10&group=cooled');
  const planning = new URL(streamPlanningHref(link.searchParams.get('back')), 'https://example.com/');
  assert.equal(planning.pathname, '/stream-planning.html');
  assert.equal(planning.searchParams.get('stream_date'), '2026-11-10');
  assert.equal(planning.searchParams.get('sort'), 'change');
  assert.equal(planning.searchParams.get('group'), 'cooled');
  assert.equal(planning.searchParams.get('view'), null);
  // Older planning links: an hour, a page size and a search of their own.
  const older = new URL(streamPlanningHref('view=streamer&sort=streamers&stream_hour=0&stream_region=zh&stream_q=Game&stream_limit=48'), 'https://example.com/');
  assert.deepEqual([...older.searchParams.keys()].sort(), ['q', 'region']);
  assert.equal(older.searchParams.get('q'), 'Game');
});

test('planning replay selects the latest valid Taipei snapshot before the cutoff', () => {
  const earlier = { generated_at:'2026-11-10T02:18:00Z', games:[{ game_id:'1' }] };
  const latest = { generated_at:'2026-11-10T14:18:00Z', games:[{ game_id:'2' }] };
  const hours = {
    '2026-11-10T14:00:00Z':latest,
    '2026-11-10T02:00:00Z':earlier,
    '2026-11-10T15:00:00Z':{ generated_at:'2026-11-10T16:01:00Z', collection_started_at:'2026-11-10T15:50:00Z',
      collection_schedule:{ trigger_source:'cloudflare' }, games:[{ game_id:'3' }] },
  };
  const file = { schema_version:1, date:'2026-11-10', timezone:'Asia/Taipei', hours };
  assert.equal(latestHistorySnapshot(file, dateStart('2026-11-11') - 1), latest);
  assert.equal(latestHistorySnapshot(file, Date.parse('2026-11-10T11:00:00+08:00')), earlier);
  assert.equal(latestHistorySnapshot(file, dateStart('2026-11-10')), null);
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

test('global daily heat uses the selected closed day median, before the release date too', () => {
  const date = '2026-11-10';
  const rows = [...daily('2026-11-04', 9000), ...daily(date, 4000)];
  // Viewers before the release (a demo, a beta, early access) are real heat.
  const before = heat(rows, '2026-11-04', { region:'global' });
  assert.deepEqual([before.signal, before.median, before.prelaunch], ['hot', 9000, true]);
  const dailyGlobal = heat(rows, date, { region:'global' });
  assert.deepEqual([dailyGlobal.signal, dailyGlobal.median, dailyGlobal.validHours, dailyGlobal.prelaunch], ['hot',4000,24,false]);
});

test('the global outlook uses the last completed day before today has closed', () => {
  const rows = [...daily('2026-11-10', 4200), ...daily('2026-11-11', 0)];
  const result = heat(rows, '2026-11-11', { region:'global' });
  assert.equal(result.signal, 'pending');
  assert.equal(result.outlook.signal, 'hot');
  assert.equal(result.outlook.latest.date, '2026-11-10');
  assert.equal(result.outlook.latest.median, 4200);
});

test('a Chinese fall is listed without a label once both periods reach the same number of hours', () => {
  const rows = Array.from({ length:6 }, (_, i) => daily(`2026-11-${String(i + 5).padStart(2, '0')}`, hour => {
    if (hour === 21) return 10000;
    return [4,7,11].includes(hour) ? i < 3 ? 400 : 200 : 0;
  })).flat();
  const open = daily('2026-11-11', 9000);
  const selected = heat([...rows, ...open], '2026-11-11');
  assert.equal(selected.signal, 'hot');
  // New games fall anyway: a fall is shown as numbers, never labelled.
  assert.deepEqual(selected.outlook.comparison, { previous:400, recent:200, change:-50, signal:null });
  assert.equal(selected.outlook.signal, 'hot');
  assert.equal(selected.outlook.latest.thresholdHits, 4);
  assert.equal(heat([...rows, ...open], '2026-11-09').outlook.comparison, null);
  const mixed = [...rows.slice(0, 72), ...rows.slice(72).map(independentlyMeasured)];
  assert.equal(heat(mixed, '2026-11-11').outlook.comparison, null);
  assert.deepEqual(heat(mixed, '2026-11-11').week, heat(rows, '2026-11-11').week);
  assert.deepEqual(heat(rows.map(independentlyMeasured), '2026-11-11').outlook.comparison, selected.outlook.comparison);
});

const independentlyMeasured = row => ({ ...row, audience_regions: { zh: { measurement_source: 'helix_language_filter' } } });

test('weekly heat counts closed days, before the release too, and preserves uncertain and fully missing days', () => {
  const rows = [
    ...daily('2026-11-04', 1000), ...daily('2026-11-05', high),
    ...daily('2026-11-06', high, [21]), ...daily('2026-11-07', 0),
    ...daily('2026-11-09', 0), ...daily('2026-11-10', high), ...daily('2026-11-11', 2000),
  ];
  // 11-04 comes before the 11-05 release and still counts as a hot day.
  assert.deepEqual(heat(rows, '2026-11-11').week, { total:7, hot:3, unknown:2 });
  assert.deepEqual(heat(rows, '2026-11-07').week, { total:4, hot:2, unknown:1 });
  assert.equal(heat(daily('2026-11-11', 1000), '2026-11-11').week, null);
});

test('today is compared only against previously published observations for the same hours', () => {
  const days = ['2026-11-08', '2026-11-09', '2026-11-10'];
  const past = days.flatMap(date => daily(date, hour => hour < 6 ? 50 : 1000));
  const current = daily('2026-11-11', hour => hour < 6 ? 100 : 2000).map((row, hour) => ({
    ...row, generated_at:iso(Date.parse(row.hour) + (hour < 6 ? 60000 : 6 * 3600000)),
  }));
  assert.deepEqual(heat([...past, ...current], '2026-11-11').todayChange, { change:50, hours:6 });
  assert.equal(heat([...past, ...current.slice(1)], '2026-11-11').todayChange, null);
  assert.equal(heat([...past, ...current], '2026-11-10').todayChange, null);
  assert.equal(heat([...past, ...current.map(independentlyMeasured)], '2026-11-11').todayChange, null);
  assert.deepEqual(heat([...past, ...current].map(independentlyMeasured), '2026-11-11').todayChange, { change:50, hours:6 });
});

test('other-stream trends pair hours across days, retain measured zero, and skip legacy records', () => {
  const day = '2026-11-10', previous = '2026-11-09';
  const rows = [
    ...daily(previous, hour => hour < 6 ? 0 : 1000).map((row, hour) => ({
      ...row, streamer_count:hour < 6 ? 0 : 5, largest_stream_viewer_count:hour < 6 ? 0 : null,
    })),
    ...daily(day, 120).map(row => ({ ...row, streamer_count:3, largest_stream_viewer_count:90 })),
  ];
  const options = { date:day, now };
  const paired = { date:day, share:75, viewers:30, streams:3, hours:6, partial:false };
  assert.deepEqual(remainingAudienceTrend(rows, options), [paired]);
  assert.deepEqual(remainingAudienceTrend(rows.slice(1), options), [{ ...paired, viewers:null, streams:null, hours:5 }]);
  assert.deepEqual(remainingAudienceTrend(rows, { ...options, releaseDate:day }), [{ ...paired, viewers:null, streams:null, hours:0 }]);
  assert.deepEqual(remainingAudienceTrend(rows, { ...options, date:previous }), []);
  assert.deepEqual(remainingAudienceTrend(rows.slice(0, 26), { ...options, releaseDate:day }), []);
  const mixed = [...rows.slice(0, 24), ...rows.slice(24).map(independentlyMeasured)];
  assert.deepEqual(remainingAudienceTrend(mixed, options), [{ ...paired, viewers:null, streams:null, hours:0 }]);
  assert.deepEqual(remainingAudienceTrend(rows.map(independentlyMeasured), options), [paired]);
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

const hourSlot = hour => ({ start:hour, end:hour + 1 });

test('a stream slot counts each region on its own days across months, from the release date', () => {
  const period = trialWindow(0, Date.parse('2026-11-04T09:00:00+08:00')), hours = [0, 22];
  const counts = [
    [[9000,12],[9000,14]], [[9000,12],[9000,14]],
    [[0,0,[0,0]],[500,15,[1,1]]], [[50000,20,[40,1]],null], [null,[60000,25,[40,1]]],
    [[600,3,[10,1]],[500,6]], [[700,4,[20,1]],[500,8,[5,1]]],
  ];
  const { index, chunks } = trialFixture(period, hours, counts, '2026-10-30');
  const midnight = slotStats(index, chunks, '1', period, hourSlot(0), 'global', 50);
  assert.deepEqual(midnight.dates, ['2026-10-30', '2026-10-31', '2026-11-02', '2026-11-03']);
  assert.deepEqual([midnight.viewers, midnight.streamers], [650, 3.5]);
  const late = slotStats(index, chunks, '1', period, hourSlot(22), 'global', 50);
  assert.deepEqual(late.dates, ['2026-10-30', '2026-11-01', '2026-11-02', '2026-11-03']);
  assert.deepEqual([late.viewers, late.streamers], [500, 11.5]);
  // Measured zero Chinese viewers count; a missing Chinese count does not.
  const chinese = slotStats(index, chunks, '1', period, hourSlot(22), 'zh', 50);
  assert.deepEqual(chinese.dates, ['2026-10-30', '2026-11-01', '2026-11-03']);
  assert.equal(chinese.viewers, 5);
});

test('the rank needs three days with the tier and keeps a measured zero', () => {
  const period = trialWindow(0, now), slot = hourSlot(11);
  const counts = [[[900,10,[200,5]]], [[900,10,[200,5]]], [[900,10,[200,5]]], [[900,10,[200,5]]]];
  const { index, chunks } = trialFixture(period, [11], counts, '2026-11-05');
  const rows = Object.values(chunks['2026-11'].hours);
  for (const row of rows.slice(1)) row.streamer_counts_above_viewers = [5, 3, 2];
  rows[1].audience_regions.zh.streamer_counts_above_viewers = [2, 0, 0];
  rows[2].audience_regions.zh.streamer_counts_above_viewers = [2, 1, 0];
  rows[3].audience_regions.zh.streamer_counts_above_viewers = [2, 1, 0];
  assert.deepEqual(slotStats(index, chunks, '1', period, slot, 'global', 50).rank, { ahead:3, days:3 });
  assert.deepEqual(slotStats(index, chunks, '1', period, slot, 'zh', 100).rank, { ahead:0, days:3 });
  rows[3].audience_regions.zh.streamer_counts_above_viewers = [50, 50, 50];
  assert.equal(slotStats(index, chunks, '1', period, slot, 'zh', 50).rank, null);
});

test('a Chinese slot uses the collection active at the end of the period', () => {
  const period = trialWindow(0, Date.parse('2026-11-16T09:00:00+08:00'));
  const counts = period.slots.map(() => [[900,10,[500,5]], [900,10,[500,5]]]);
  const { index, chunks } = trialFixture(period, [11, 22], counts, '2026-11-01');
  const rows = chunks['2026-11'].hours;
  for (const row of Object.values(rows)) {
    row.streamer_counts_above_viewers = [5, 4, 2];
    row.audience_regions.zh.streamer_counts_above_viewers = [5, 4, 2];
  }
  const hour = '2026-11-15T14:00:00Z';
  rows[hour].audience_regions.zh = { viewer_count:40, streamer_count:2,
    measurement_source:'helix_language_filter', streamer_counts_above_viewers:[1, 0, 0] };
  // 22:00 on 11/15 comes after the switch to the language filter: only that hour counts.
  assert.deepEqual(slotStats(index, chunks, '1', period, hourSlot(22), 'zh', 50).dates, ['2026-11-15']);
  assert.deepEqual(slotStats(index, chunks, '1', period, hourSlot(11), 'zh', 50).rank, { ahead:4, days:7 });
  assert.equal(slotStats(index, chunks, '1', period, hourSlot(22), 'global', 50).days, 7);
  delete rows[hour].audience_regions.zh.measurement_source;
  assert.equal(slotStats(index, chunks, '1', period, hourSlot(22), 'zh', 50).days, 0);
});

// A launch entry of twitch-launch-curves.json (schema 2): days every 24 hours from its start.
const curveLaunch = (date, daily, extra = {}) => ({ kind:'release', date, launch_at:iso(dateStart(date)),
  start_at:iso(dateStart(date)), start_basis:'launch', daily, ...extra });
const curveGame = (launches, genres = ['Action']) => ({ genres, launches });

test('launch curves use complete older peers in the same group and hide days that end after the selected time', () => {
  const peer = curveLaunch('2026-10-01', [100,90,80,70,60,50,40]);
  const games = Object.fromEntries([1,2,3,4,5].map(id => [String(id), curveGame([peer])]));
  const payload = { games:{ ...games, '6':curveGame([curveLaunch('2026-11-01', [200,200,160,150,130,110,80])]),
    '7':curveGame([{ ...peer, kind:'early_access' }]), '8':curveGame([curveLaunch('2026-10-29', peer.daily)]),
    '9':curveGame([curveLaunch('2026-10-01', [100,null,80,70,60,50,40])]),
    '10':curveGame([peer], ['Strategy']) } };
  const selected = launchComparison(payload, '6', 'Action', dateStart('2026-11-04'));
  assert.equal(selected.peers, 5);
  assert.deepEqual(selected.typicalDay, peer.daily);
  assert.deepEqual(selected.launch.daily, [200,200,160,null,null,null,null]);
  assert.equal(selected.gameRemaining, null);
  assert.equal(selected.remainingOnDay7, 40);
  assert.equal(selected.closedDays, 3);
  assert.deepEqual(selected.heat, { hot:0, observed:3, longest:0, firstHot:null, firstDrop:null, returnDay:null });
  assert.deepEqual(selected.peerHeat, { hot:0, longest:null });
  // An hour short of the third day's end keeps it hidden.
  assert.equal(launchComparison(payload, '6', 'Action', dateStart('2026-11-04') - 3600000).closedDays, 2);
});

test('a full release is its own launch, compared with releases, and its start can come before the launch', () => {
  const peer = curveLaunch('2026-10-01', [100,90,80,70,60,50,40]);
  const games = Object.fromEntries([1,2,3,4,5].map(id => [String(id), curveGame([{ ...peer, kind:id === 1 ? 'full_release' : 'release' }])]));
  const early = { ...curveLaunch('2025-03-01', [50,40,30,30,20,20,20]), kind:'early_access' };
  const full = { ...curveLaunch('2026-11-01', [900,600,500,400,300,300,200]), kind:'full_release' };
  games['6'] = curveGame([early, full]);
  assert.equal(launchEntry(games['6'], 'full_release'), full);
  assert.equal(launchEntry(games['6'], 'early_access'), early);
  assert.equal(launchEntry(curveGame([early]), 'full_release'), null);
  const comparison = launchComparison({ games }, '6', 'Action', Infinity, 'global', 'full_release');
  assert.equal(comparison.launch.kind, 'full_release');
  assert.equal(comparison.peers, 5);
  assert.deepEqual(comparison.launch.daily, full.daily);
  assert.equal(launchComparison({ games }, '6', 'Action', Infinity, 'global', 'early_access').peers, 0);
  const moved = { ...curveLaunch('2026-10-07', Array(7).fill(5000)), launch_at:'2026-10-06T16:00:00Z', start_at:'2026-10-01T15:00:00Z', start_basis:'pre_launch' };
  assert.equal(launchStatus(moved, 'global'), '2026-10-07 · Steam 商店上市 · 上市前 5 天就有人實況，從 10/01 23:00 起算 · 全球 Twitch');
  assert.equal(launchStatus({ ...moved, start_at:'2026-10-06T11:00:00Z' }, 'zh', 'mixed'),
    '2026-10-07 · Steam 商店上市 · 上市前 5 小時就有人實況，從 10/06 19:00 起算 · 中文區 Twitch · 首週量測方式曾切換');
  assert.equal(launchStatus(full, 'global'), '2026-11-01 · Steam 正式上市（結束搶先體驗） · 全球 Twitch');
  assert.equal(launchStatus({ ...moved, start_at:'2026-10-06T15:00:00Z' }, 'global'), '2026-10-07 · Steam 商店上市 · 全球 Twitch');
});

test('the launch curves file must be schema 2 with valid launches', () => {
  const data = { schema_version:2, generated_at:'2026-11-10T00:00:00Z', genres:{ Action:'動作' },
    games:{ '1':curveGame([curveLaunch('2026-11-01', Array(7).fill(null))]) }, forecast:null };
  assert.equal(validCurves(data), true);
  assert.equal(validCurves({ ...data, schema_version:1 }), false);
  assert.equal(validCurves({ ...data, games:{ '1':curveGame([]) } }), false);
  const late = { ...curveLaunch('2026-11-01', Array(7).fill(null)), start_at:'2026-11-02T00:00:00Z' };
  assert.equal(validCurves({ ...data, games:{ '1':curveGame([late]) } }), false);
  assert.equal(validCurves({ ...data, games:{ '1':curveGame([{ ...late, start_at:late.launch_at, kind:'beta' }]) } }), false);
});

test('launch heat counts runs and visible re-entry using the same number of days for peers', () => {
  const peer = curveLaunch('2026-10-15', [4000,3000,2400,2500,3000,3000,3000]);
  const games = Object.fromEntries([1,2,3,4,5].map(id => [String(id), curveGame([peer])]));
  games['6'] = curveGame([curveLaunch('2026-11-01', [3000,5000,2500,2400,2500,3600,3700])]);
  const data = { generated_at:'2026-11-10T00:00:00+08:00', games };
  const full = launchComparison(data, '6', 'Action');
  assert.deepEqual(full.heat, { hot:4, observed:7, longest:2, firstHot:1, firstDrop:3, returnDay:6 });
  assert.deepEqual(full.peerHeat, { hot:5, longest:3 });
  const early = launchComparison(data, '6', 'Action', dateStart('2026-11-05'));
  assert.deepEqual(early.heat, { hot:2, observed:4, longest:2, firstHot:1, firstDrop:3, returnDay:null });
  assert.deepEqual(early.peerHeat, { hot:5, longest:2 });
});

test('launch heat stops at the published day and does not infer a change across missing days', () => {
  const games = { '1':curveGame([{ ...curveLaunch('2026-11-01', [3000,null,0,4500,6000,7000,7500]), kind:'early_access' }]) };
  const data = { generated_at:'2026-11-05T00:00:00+08:00', games };
  const result = launchComparison(data, '1', 'Action');
  assert.equal(result.closedDays, 4);
  assert.deepEqual(result.launch.daily, [3000,null,0,4500,null,null,null]);
  assert.deepEqual(result.heat, { hot:2, observed:3, longest:1, firstHot:1, firstDrop:null, returnDay:null });
  assert.equal(result.peerHeat, null);
});

test('Chinese launch heat retains exact hourly threshold decisions and matches peers by measurement method', () => {
  const legacy = 'global_census', independent = 'helix_language_filter';
  const curve = { daily:[80,90,12,30,50,70,80], heat:[true,true,false,false,false,true,true],
    measurement_sources:Array(7).fill(legacy) };
  const candidate = curveLaunch('2026-10-01', Array(7).fill(200), { audience_regions:{ zh:curve } });
  const games = Object.fromEntries([1,2,3,4,5].map(id => [String(id), curveGame([candidate])]));
  games['6'] = curveGame([{ ...candidate, audience_regions:{ zh:{ ...curve, measurement_sources:Array(7).fill(independent) } } }]);
  games['7'] = curveGame([curveLaunch('2026-11-01', Array(7).fill(200), { audience_regions:{ zh:{ ...curve,
    measurement_sources:[legacy,legacy,legacy,legacy,legacy,independent,independent] } } })]);
  const data = { games };
  const early = launchComparison(data, '7', 'Action', dateStart('2026-11-05'), 'zh');
  assert.equal(early.peers, 5);
  assert.equal(early.measurementSource, legacy);
  assert.deepEqual(early.heat, { hot:2, observed:4, longest:2, firstHot:1, firstDrop:3, returnDay:null });
  const mixed = launchComparison(data, '7', 'Action', dateStart('2026-11-10'), 'zh');
  assert.equal(mixed.peers, 0);
  assert.equal(mixed.typicalDay, null);
  assert.equal(mixed.gameRemaining, null);
  assert.equal(mixed.heat.hot, 4);
});

test('a confirmed cooldown suggests wrapping up', () => {
  const rows = Array.from({ length:4*24+9 }, (_, i) => ({
    hour:iso(dateStart('2026-11-07')+i*3600000), status:'observed', viewer_count:i<24 ? 4000 : 1500,
  }));
  const data = analyzeCooldown(rows, { now });
  assert.equal(data.status, 'cooled');
  const verdict = globalVerdict(heat(rows, '2026-11-11', { region:'global' }), { small:false });
  assert.deepEqual([verdict.group, verdict.headline], ['cooled', '建議收尾或換題']);
});

// The Twitch backend's heat projection (twitch_series.heat_projection).
const HEAT_FIELDS = ['generated_at', 'viewer_count', 'streamer_count'];
const HEAT_REGION_FIELDS = ['viewer_count', 'streamer_count', 'largest_stream_viewer_count', 'measurement_source'];
const pick = (value, names) => Object.fromEntries(names.filter(name => Object.hasOwn(value, name)).map(name => [name, value[name]]));
function heatFile(chunk, regionFields = HEAT_REGION_FIELDS) {
  return { ...chunk, projection:HEAT_PROJECTION, hours:Object.fromEntries(Object.entries(chunk.hours).map(([hour, row]) => {
    const chinese = row.audience_regions?.zh;
    return [hour, { ...pick(row, HEAT_FIELDS),
      ...(chinese && typeof chinese === 'object' && !Array.isArray(chinese) ? { audience_regions:{ zh:pick(chinese, regionFields) } } : {}) }];
  })) };
}

test('heat files give the planning page the same results as full months', () => {
  // Seeded hours cross the Chinese measurement change and include uncollected
  // hours, absent censuses, invalid concentration values and every extra field.
  let seed = 20261117;
  const random = () => (seed = seed * 48271 % 2147483647) / 2147483647;
  const start = dateStart('2026-11-01'), end = dateStart('2026-11-20') + 8 * 3600000;
  const changeAt = Date.parse(CHINESE_MEASUREMENT_CHANGE_AT);
  const months = {}, full = {};
  const audience = (viewers, streamers) => ({ rule:'followers_gt_1000_viewers_gte_10_v1', min_followers_exclusive:1000,
    min_viewers_inclusive:10, followers_max_age_hours:24, status:random() < .8 ? 'complete' : 'partial',
    eligible_streamer_count:Math.min(streamers, 2), eligible_viewer_count:viewers, median_viewer_count:Math.max(10, viewers >> 1),
    excluded_low_viewer_count:Math.max(0, streamers - 2), excluded_low_follower_count:0, unknown_follower_count:random() < .2 ? 1 : 0 });
  for (let at = start; at <= end; at += 3600000) {
    if (random() < .04) continue;
    const hour = iso(at), month = dayOf(at).slice(0, 7), generated_at = iso(at + 600000);
    (months[month] ||= {})[hour] = generated_at;
    full[month] ||= { schema_version:1, timezone:'Asia/Taipei', game_id:'7', month, hours:{} };
    if (random() < .04) continue;
    const day = Math.floor((at - start) / 86400000);
    const viewers = Math.round((day < 7 ? 6000 : day < 13 ? 1800 : 900) * (.4 + random()));
    const streamers = 1 + Math.floor(random() * 30);
    const independent = at >= changeAt;
    const chineseViewers = Math.round((independent ? 260 : 120) * random() * (day < 7 ? 2 : 1));
    const chineseStreamers = chineseViewers ? 1 + Math.floor(random() * Math.min(streamers, 5)) : 0;
    const chinese = { viewer_count:chineseViewers, streamer_count:independent && random() < .2 ? streamers + 2 : chineseStreamers,
      median_viewer_count:chineseViewers ? Math.ceil(chineseViewers / 2) : null,
      streamer_counts_above_viewers:[chineseStreamers, 0, 0], filtered_audience:audience(chineseViewers, chineseStreamers) };
    const largest = random();
    if (largest < .5) chinese.largest_stream_viewer_count = Math.ceil(chineseViewers * (.5 + random() / 2));
    else if (largest < .6) chinese.largest_stream_viewer_count = chineseViewers + 5;
    if (independent) Object.assign(chinese, { measurement_source:'helix_language_filter',
      measurement_started_at:iso(at + 60000), measurement_finished_at:iso(at + 300000) });
    full[month].hours[hour] = { generated_at, viewer_count:viewers, streamer_count:streamers,
      streamer_counts_above_viewers:[Math.min(streamers, 9), 3, 1], filtered_audience:audience(viewers, streamers),
      ...(random() < .1 ? {} : { audience_regions:{ zh:random() < .05 ? null : chinese, en:{ viewer_count:viewers } } }) };
  }
  const hours = Object.values(months).flatMap(Object.keys).sort();
  const index = { months, games:{ '7':{ months:Object.keys(full), first_hour:hours[0], last_hour:hours.at(-1),
    release_reference:{ date:'2026-11-02', precision:'day' } } } };
  const heat = Object.fromEntries(Object.entries(full).map(([month, chunk]) => [month, heatFile(chunk)]));
  for (const [month, chunk] of Object.entries(heat)) assert.equal(validHeatChunk(chunk, '7', month), true);
  assert.ok(JSON.stringify(heat).length < JSON.stringify(full).length / 3);
  const cases = [];
  for (let at = dateStart('2026-11-01'); at <= end; at += 86400000) {
    cases.push({ date:dayOf(at), now:end + 1800000 }, { date:dayOf(at), now:at + 14 * 3600000 });
  }
  const results = chunks => {
    const rows = fullSeriesRows(index, chunks, '7');
    return ['global', 'zh'].map(region => cases.map(({ date, now }) =>
      analyzeStreamHeat(region === 'global' ? rows : projectRows(rows, region), { game:index.games['7'], region, date, now })));
  };
  const expected = results(full);
  assert.deepEqual(results(heat), expected);
  const exercised = expected.flat();
  assert.ok(exercised.some(day => day.concentration) && exercised.some(day => day.todayChange) &&
    exercised.some(day => day.outlook.comparison) && exercised.some(day => day.signal === 'cooled'));
  // Each Chinese field in the projection changes some result when it is left out.
  for (const field of ['largest_stream_viewer_count', 'measurement_source', 'streamer_count']) {
    const without = Object.fromEntries(Object.entries(full).map(([month, chunk]) =>
      [month, heatFile(chunk, HEAT_REGION_FIELDS.filter(name => name !== field))]));
    assert.notDeepEqual(results(without), expected, field);
  }
});

test('worldwide, a game cooled on its own peak is labelled cooled with that peak, and advice names the peak', () => {
  // Release 11-05; the peak day 1,200 then three days under 300 confirm on 11-10.
  const rows = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']
    .map((date, i) => daily(date, [800, 1200, 600, 250, 200, 150][i])).flat();
  const result = heat(rows, '2026-11-11', { region:'global' });
  assert.equal(result.outlook.signal, 'cooled');
  assert.equal(result.outlook.cooledBy, 'peak');
  assert.equal(result.outlook.peak, 1200);
  assert.equal(result.outlook.confirmedOn, '2026-11-11');
  // A small game under 200 a day that fell under a quarter of its own peak has cooled.
  const launch = { small:true, stage:'skip', basis:'latest_day', latest:{ index:5, median:150 } };
  const verdict = globalVerdict(result, launch);
  assert.deepEqual([verdict.group, verdict.label], ['cooled', '已退燒']);
  assert.match(verdict.reason, /^11\/11 確認退燒：每天約 \d+ 人，不到自己高峰 1,200 人的 25%。$/);
  // Still 200 a day: the launch rules say it is worth a trial, the cooldown rides along.
  const trial = globalVerdict(result, { small:true, stage:'trial', basis:'latest_day', first:800, third:600, trend:'holding', latest:{ index:5, median:250 } });
  assert.equal(trial.group, 'trial');
  assert.match(trial.reason, /已不到自己高峰 1,200 人的 25%。$/);
});

test('a rise of half again over three days is still a rise; a fall is never labelled worldwide either', () => {
  const rising = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']
    .map((date, i) => daily(date, [2000, 2000, 2000, 3500, 3600, 3700][i])).flat();
  assert.equal(heat(rising, '2026-11-11', { region:'global' }).outlook.signal, 'rising');
  const falling = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']
    .map((date, i) => daily(date, [8000, 8000, 8000, 4000, 4000, 4000][i])).flat();
  const result = heat(falling, '2026-11-11', { region:'global' });
  assert.equal(result.outlook.comparison.signal, null);
  assert.equal(result.outlook.comparison.change, -50);
  assert.equal(result.outlook.signal, 'hot');
});
