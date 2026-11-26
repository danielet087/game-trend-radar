import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStreamHeat } from '../src/features/twitch/stream-heat-model.js';
import { projectRows } from '../src/features/twitch/region-views.js';
import { launchAdvice, launchDays, launchAnchor } from '../src/features/twitch/launch-model.js';
import { launchPeaks } from '../src/features/twitch/launches.js';
import { chineseVerdict, combineVerdicts, compactCount, extraTags, gameMeta, globalVerdict, lastDays, launchMeta,
  recentHours, regionTile, sortEntries, sparkPoints, trendOf } from '../src/features/twitch/trend-verdict.js';
import { busiestSlot, channelsAboveRange, latestRanks, slotHours, slotLabel, slotOf, slotPeriod, slotStats } from '../src/features/twitch/stream-slot-model.js';
import { trialWindow } from '../src/features/twitch/stream-planning-model.js';

const HOUR = 3600000;
const now = Date.parse('2026-11-11T12:00:00+08:00');
const iso = at => new Date(at).toISOString().replace('.000Z', 'Z');

// Hourly rows from one value per Taipei day, with the Chinese counts per hour.
function hourly(daily, { from = '2026-11-01', zh = () => ({ viewer_count: 0, streamer_count: 0 }) } = {}) {
  const start = Date.parse(`${from}T00:00:00+08:00`), rows = [];
  daily.forEach((value, day) => {
    for (let hour = 0; hour < 24; hour++) {
      const at = start + (day * 24 + hour) * HOUR;
      if (at > now) return;
      rows.push({ hour: iso(at), generated_at: iso(at + 600000), status: 'observed', viewer_count: value, streamer_count: 20,
        audience_regions: { zh: zh(day, hour) } });
    }
  });
  return rows;
}

function judge(daily, { from = '2026-11-01', zh, record } = {}) {
  const rows = hourly(daily, { from, zh });
  const game = record ?? { release_reference: { date: from, precision: 'day' } };
  const days = Object.fromEntries(['global', 'zh'].map(region => [region,
    analyzeStreamHeat(region === 'global' ? rows : projectRows(rows, region), { game, region, date: '2026-11-11', now })]));
  const anchor = launchAnchor(game, rows, now, null), startAt = anchor?.startAt ?? null;
  const launch = { ...launchAdvice({ days: launchDays(rows, startAt, now), releaseAt: startAt, now }),
    small: !days.global.popularAt, peaks: launchPeaks(rows, game, now) };
  return { days, launch, global: globalVerdict(days.global, launch), zh: chineseVerdict(days.zh) };
}

test('counts read in two significant figures and 萬 from 10,000', () => {
  assert.deepEqual([5, 28, 170.4, 2240, 9960, 28123, 36000, 570123, 1234567].map(compactCount),
    ['5', '28', '170', '2,200', '1 萬', '2.8 萬', '3.6 萬', '57 萬', '120 萬']);
  assert.equal(compactCount(null), '—');
});

test('trends compare the last three days with the three before, holding small changes flat', () => {
  assert.deepEqual(trendOf({ previous: 100, recent: 150, change: 50 }, 'global'), { text: '↑ 比前 3 天多 50%', direction: 'up' });
  assert.deepEqual(trendOf({ previous: 1000, recent: 500, change: -50 }, 'zh'), { text: '↓ 少 50%', direction: 'down' });
  assert.deepEqual(trendOf({ previous: 100, recent: 98, change: -2 }, 'global'), { text: '持平', direction: 'flat' });
  // Below 50 Chinese viewers the change is in viewers, not percent.
  assert.deepEqual(trendOf({ previous: 20, recent: 35, change: 75 }, 'zh'), { text: '↑ 多 15 人', direction: 'up' });
  assert.deepEqual(trendOf(null, 'global'), { text: '還不能比較', direction: null });
});

test('a popular game still above 3,000 a day is worth streaming', () => {
  const { global, days } = judge([8000, 7000, 6500, 6000, 6000, 5800, 5600, 5500, 5400, 5300, 5200]);
  // The reason in words; the numbers are the tile's.
  assert.deepEqual(global, { group: 'hot', label: '還很熱', headline: '可以繼續播', reason: '還是很多人在看，雖然比前幾天少一些。' });
  const tile = regionTile(days.global, 'global');
  assert.equal(tile.value, '5,400');
  assert.equal(tile.trend, '↓ 比前 3 天少 7%');
  assert.deepEqual(lastDays(days.global, 'global'), [6000, 6000, 5800, 5600, 5500, 5400, 5300]);
  assert.equal(tile.spark.split(' ').length, 7);
});

test('a popular game three days under 3,000 has cooled, by the fixed line or its own peak', () => {
  const cooled = judge([8000, 6000, 4000, 2500, 2400, 2300, 2200, 2100, 2000, 1900, 1800]).global;
  assert.deepEqual(cooled, { group: 'cooled', label: '已退燒', headline: '建議收尾或換題', reason: '連續幾天都掉到熱門線以下，已經退燒。' });
  const suspected = judge([8000, 7000, 6500, 6000, 6000, 5800, 5600, 5500, 5400, 2900, 2800]).global;
  assert.equal(suspected.label, '開始降溫');
  assert.equal(suspected.reason, '這幾天掉到熱門線以下，再這樣幾天就算退燒。');
});

test('small games follow the launch rules and an own-peak cooldown', () => {
  const faded = judge([2000, 1500, 600, 300, 200, 150, 120, 100, 90, 80, 80]);
  assert.equal(faded.launch.stage, 'skip');
  assert.deepEqual(faded.global, { group: 'cooled', label: '已退燒', headline: '建議收尾或換題',
    reason: '跟最熱的時候比，現在看的人少很多，已經退燒。' });
  const holding = judge([400, 380, 350, 330, 300, 290, 280, 270, 260, 250, 240]).global;
  assert.deepEqual(holding, { group: 'trial', label: '值得試播', headline: '值得試播一場', reason: '首日過關，到第 3 天觀眾還留著。' });
  const small = judge([120, 110, 100, 90, 80, 80, 80, 80, 80, 80, 80]).global;
  assert.deepEqual(small, { group: 'skip', label: '先不用排', headline: '先不用排', reason: '首日看的人不多，沒過第一關。' });
  const horse = judge([400, 450, 500, 520, 530, 540, 560], { from: '2026-11-05' }).global;
  assert.deepEqual(horse, { group: 'horse', label: '黑馬候選', headline: '可以趁早試播',
    reason: '第 3 天看的人沒有比首日少，一般新作這時已經掉很多。' });
  // No reason names viewers, a share or a multiple: those are the tiles'.
  for (const verdict of [faded.global, holding, small, horse]) assert.doesNotMatch(verdict.reason, /\d[\d,.]*\s*(萬|人|%|倍)/);
});

// A launch at 00:00 on 11-11 seen at 12:00: [viewers, channels] for its first hours.
function launchDay(hours) {
  const game = { release_reference: { date: '2026-11-11', precision: 'day' } }, start = Date.parse('2026-11-11T00:00:00+08:00');
  const rows = hours.map(([viewers, channels], hour) => ({ hour: iso(start + hour * HOUR), generated_at: iso(start + hour * HOUR + 600000),
    status: 'observed', viewer_count: viewers, streamer_count: channels, audience_regions: { zh: { viewer_count: 0, streamer_count: 0 } } }));
  const day = analyzeStreamHeat(rows, { game, region: 'global', date: '2026-11-11', now });
  const anchor = launchAnchor(game, rows, now, null);
  const launch = launchAdvice({ days: launchDays(rows, anchor.startAt, now), releaseAt: anchor.startAt, now, rows });
  return globalVerdict(day, launch);
}

test('on the launch day the hours so far call the first day', () => {
  assert.deepEqual(launchDay([[500, 20], [600, 25], [700, 30], [650, 28]]), { group: 'trial', label: '首日大概過關', headline: '可以先試播一場',
    reason: '剛上市就有一定人氣，也有不少台在播，第 3 天再決定要不要長播。' });
  assert.deepEqual(launchDay([[7800, 129], [11900, 186], [9000, 200], [9400, 195], [6700, 204]]), { group: 'hot', label: '首日熱門', headline: '值得開',
    reason: '剛上市就很熱，而且很多台一起在播，不是靠一兩台撐的。' });
  assert.deepEqual(launchDay([[40, 3], [80, 5], [120, 6], [90, 4], [60, 3], [70, 4]]), { group: 'skip', label: '先不用排', headline: '先不用排',
    reason: '上市好幾個小時都沒什麼人看，首日大概過不了關。' });
  assert.deepEqual(launchDay([[11593, 4], [13055, 11], [4433, 10]]), { group: 'trial', label: '等首日數據', headline: '等首日數據',
    reason: '人數大多是一兩台大實況主帶起來的，其他台很少，還不能算熱度。' });
  assert.equal(launchDay([[300, 12], [320, 13], [280, 11]]).reason, '剛上市，人氣不上不下，還看不出首日會不會過關。');
  assert.equal(launchDay([[500, 20]]).reason, '剛上市，紀錄還不夠，再等一兩個小時。');
  // The list sorts a launch-day pass after the games that passed the whole first day.
  const entry = (label, viewers) => ({ verdicts: { global: { label } }, tiles: { global: { raw: viewers } } });
  assert.deepEqual(sortEntries([entry('等首日數據', 900), entry('首日大概過關', 500), entry('第 3 天後再確認', 400)], 'advice', 'global')
    .map(item => item.verdicts.global.label), ['第 3 天後再確認', '首日大概過關', '等首日數據']);
});

test('the Chinese region needs four hours at 100 viewers in a day', () => {
  const daily = Array(11).fill(5000);
  const hot = judge(daily, { zh: (day, hour) => hour < 5 ? { viewer_count: 150, streamer_count: 2 } : { viewer_count: 10, streamer_count: 1 } });
  assert.deepEqual(hot.zh, { group: 'hot', label: '有熱度', headline: '中文台可以繼續播', reason: '最近每天中文台都有熱度。' });
  assert.equal(regionTile(hot.days.zh, 'zh').value, '150');
  const hotOn = days => (day, hour) => days(day) && hour < 5 ? { viewer_count: 150, streamer_count: 2 } : { viewer_count: 10, streamer_count: 1 };
  assert.equal(judge(daily, { zh: hotOn(day => day !== 8) }).zh.reason, '最近大部分的日子中文台都有熱度。');
  assert.equal(judge(daily, { zh: hotOn(day => [6, 8, 10].includes(day)) }).zh.reason, '最近有幾天中文台有熱度。');
  const sporadic = judge(daily, { zh: (day, hour) => hour < 2 ? { viewer_count: 150, streamer_count: 2 } : { viewer_count: 10, streamer_count: 1 } });
  assert.deepEqual(sporadic.zh, { group: 'skip', label: '零星有熱度', headline: '中文台先不用排',
    reason: '中文台只偶爾有幾個小時比較多人看，還不算有熱度。' });
  const cooled = judge(daily, { zh: (day, hour) => day < 6 && hour < 5 ? { viewer_count: 150, streamer_count: 2 } : { viewer_count: 0, streamer_count: 0 } });
  assert.deepEqual(cooled.zh, { group: 'cooled', label: '已退燒', headline: '中文台建議收尾或換題',
    reason: '中文區已經退燒，最近都沒什麼人看。' });
});

test('one verdict shows when both regions agree, both when they differ', () => {
  const zhHot = (day, hour) => hour < 5 ? { viewer_count: 150, streamer_count: 2 } : { viewer_count: 10, streamer_count: 1 };
  const same = judge([8000, 7000, 6500, 6000, 6000, 5800, 5600, 5500, 5400, 5300, 5200], { zh: zhHot });
  const both = combineVerdicts({ global: same.global, zh: same.zh });
  assert.equal(both.split, false);
  assert.equal(both.main, same.global);
  const differ = judge([8000, 6000, 4000, 2500, 2400, 2300, 2200, 2100, 2000, 1900, 1800], { zh: zhHot });
  const split = combineVerdicts({ global: differ.global, zh: differ.zh });
  assert.equal(split.split, true);
  assert.equal(combineVerdicts({ global: differ.global, zh: differ.zh }, 'zh').main.group, 'hot');
  // No Chinese data: the worldwide verdict alone.
  assert.equal(combineVerdicts({ global: differ.global, zh: chineseVerdict(null) }).split, false);
});

test('a list sorts each group by advice, viewers or the recent change', () => {
  const entry = (label, raw, change) => ({ verdicts: { global: { label } }, tiles: { global: { raw, change } } });
  const entries = [entry('開始降溫', 9000, -40), entry('還很熱', 4000, 5), entry('回到高檔', 6000, 60)];
  assert.deepEqual(sortEntries(entries, 'advice', 'global').map(item => item.tiles.global.raw), [4000, 6000, 9000]);
  assert.deepEqual(sortEntries(entries, 'viewers', 'global').map(item => item.tiles.global.raw), [9000, 6000, 4000]);
  assert.deepEqual(sortEntries(entries, 'change', 'global').map(item => item.tiles.global.raw), [6000, 4000, 9000]);
});

test('the launch line counts Taiwan calendar days from each launch', () => {
  assert.equal(launchMeta({ release_reference: { date: '2026-11-01', precision: 'day' } }, '2026-11-11'), '上市第 11 天・11/01 上市');
  assert.equal(launchMeta({ release_reference: { date: '2027-01-20', precision: 'day' } }, '2026-11-11'), '還沒上市・2027/01/20 上市');
  const earlyAccess = { launches: { early_access: { date: '2026-10-20' }, full_release: { date: '2026-11-05' } } };
  assert.equal(launchMeta(earlyAccess, '2026-11-11'), '正式上市第 7 天・11/05 上市');
  assert.equal(launchMeta(earlyAccess, '2026-11-01'), '搶先體驗中・10/20 開始');
  assert.equal(launchMeta({}, '2026-11-11'), '');
  const steam = { release_reference: { date: '2026-11-16', precision: 'day', source: 'Steam 台灣商店' } };
  assert.equal(gameMeta(steam, '2026-11-25'), 'Steam 11/16 上市・今天第 10 天');
  assert.equal(gameMeta({ ...earlyAccess, release_reference: steam.release_reference }, '2026-11-11'), 'Steam 11/05 正式上市・今天第 7 天');
  assert.equal(gameMeta(earlyAccess, '2026-11-01'), '10/20 開始搶先體驗・今天第 13 天');
});

test('cards add the same-age, peak and dark-horse labels as tags, without their numbers', () => {
  assert.deepEqual(extraTags({ peer: { verdict: 'outlasting', day: 19, ratio: 5.7, typical: 0.05 } }, { group: 'hot' }), ['比同齡撐得久']);
  assert.deepEqual(extraTags({ peer: { verdict: 'fading', day: 9, ratio: 0.03, typical: 0.125 },
    peaks: { earlyAccess: 2000, fullRelease: 5000, ratio: 2.5, newPeak: true }, darkHorse: { kind: 'horse', ratio: 1.5 } }, { group: 'trial' }),
  ['掉得比同齡快', '正式上市新高峰', '黑馬候選']);
  // The dark horse's own verdict already says so.
  assert.deepEqual(extraTags({ darkHorse: { kind: 'burning', ratio: 11.5, day: 7 } }, { group: 'horse' }), []);
  assert.deepEqual(extraTags(null, { group: 'hot' }), []);
  assert.equal(sparkPoints([1, null]), null);
  assert.equal(sparkPoints([2, 2, 2]), '4.0,16.0 60.0,16.0 116.0,16.0');
});

function slotFixture({ legacyDays = 3 } = {}) {
  const period = trialWindow(0, now);
  const index = { months: {}, games: { '1': { release_reference: { date: '2026-11-01', precision: 'day' } } } }, chunks = {};
  for (const [i, day] of [...period.slots, period.today].entries()) {
    for (let hour = 0; hour < 24; hour++) {
      const at = day + hour * HOUR;
      if (at > now) break;
      const stamp = iso(at), month = new Date(at + 8 * HOUR).toISOString().slice(0, 7), generated_at = iso(at + 60000);
      (index.months[month] ||= {})[stamp] = generated_at;
      (chunks[month] ||= { hours: {} }).hours[stamp] = { generated_at, viewer_count: 100 * hour + 1000, streamer_count: 10,
        streamer_counts_above_viewers: i < legacyDays ? [9, 6, 2] : [9, 6, 4, 2] };
    }
  }
  return { period, index, chunks };
}

test('a slot averages its hours each day and takes the median day', () => {
  assert.deepEqual(slotOf(undefined, undefined), { start: 11, end: 15 });
  assert.deepEqual(slotOf('22', '2'), { start: 22, end: 2 });
  assert.deepEqual(slotHours({ start: 22, end: 2 }), [22, 23, 24, 25]);
  assert.equal(slotLabel({ start: 20, end: 24 }), '20:00～24:00');
  const { period, index, chunks } = slotFixture();
  const stats = slotStats(index, chunks, '1', period, { start: 11, end: 15 }, 'global', 60);
  assert.equal(stats.days, 7);
  assert.equal(stats.viewers, 2250);
  assert.equal(stats.streamers, 10);
  assert.equal(stats.perStream, 225);
  // Four days counted the 60-viewer tier: the rank is exact.
  assert.deepEqual(stats.rank, { ahead: 4, days: 4 });
  assert.equal(slotPeriod({ tracking_status: 'ended', last_hour: '2026-11-05T03:00:00Z' }, now).slots.length, 7);
});

test('before the 60-viewer tier the rank is a range between the 50 and 100 tiers', () => {
  assert.deepEqual(channelsAboveRange([9, 6, 2], 60), { low: 2, high: 6, exact: false });
  assert.deepEqual(channelsAboveRange([9, 6, 4, 2], 60), { low: 4, high: 4, exact: true });
  assert.equal(channelsAboveRange([9, 6, 2], 20), null);
  assert.deepEqual(channelsAboveRange([9, 6, 2], 150), { low: 0, high: 2, exact: false });
  const { period, index, chunks } = slotFixture({ legacyDays: 5 });
  assert.deepEqual(slotStats(index, chunks, '1', period, { start: 11, end: 15 }, 'global', 60).rank, { low: 2, high: 6, days: 7 });
  assert.deepEqual(slotStats(index, chunks, '1', period, { start: 11, end: 15 }, 'global', 50).rank, { ahead: 6, days: 7 });
});

test('the comparison takes the busiest slot of the same length that does not overlap', () => {
  const { period, index, chunks } = slotFixture();
  const best = busiestSlot(index, chunks, '1', period, { start: 11, end: 15 }, 'global', 60);
  assert.deepEqual(best.slot, { start: 20, end: 24 });
  assert.equal(best.viewers, 3150);
});

test('without three days of slot records, the latest hour gives 現在開的話 in both regions', () => {
  const { index, chunks } = slotFixture();
  // 11:00 was collected at 11:01; the 12:00 hour is not in yet at 12:00.
  const latest = latestRanks(index, chunks, '1', now, 60);
  assert.equal(iso(latest.at), '2026-11-11T03:00:00Z');
  assert.deepEqual(latest.global, { low: 4, high: 4, exact: true });
  // The fixture has no Chinese counts.
  assert.equal(latest.zh, null);
  // Between tiers the place is a range; an hour older than three hours or an ended game gives none.
  assert.deepEqual(latestRanks(index, chunks, '1', now, 70).global, { low: 2, high: 4, exact: false });
  assert.equal(latestRanks(index, chunks, '1', now + 4 * HOUR, 60), null);
  assert.equal(latestRanks({ ...index, games: { '1': { ...index.games['1'], tracking_status: 'ended' } } }, chunks, '1', now, 60), null);
});

test('before the first whole day the tiles show the hours so far instead of a blank', () => {
  const start = Date.parse('2026-11-11T08:00:00+08:00'), at = start + 5 * HOUR + 300000;
  const rows = [[7800, 129], [11900, 186], [9000, 200], [9400, 195], [6700, 204], [8400, 190]].map(([viewers, channels], hour) => ({
    hour: iso(start + hour * HOUR), generated_at: iso(start + hour * HOUR + 600000), status: 'observed', viewer_count: viewers, streamer_count: channels }));
  const hours = recentHours(rows, at, start);
  // At 13:05 the 13:00 hour is not published yet (13:10).
  assert.deepEqual(hours, { hours: 5, viewers: 9000, channels: 195 });
  assert.deepEqual(regionTile(null, 'global', hours), { per: '每小時', value: '9,000', raw: 9000, trend: '195 台在播', direction: null, change: null, spark: null });
  // Only the last 24 hours, and a whole day keeps the daily tile.
  assert.equal(recentHours(rows, start + 40 * HOUR, start), null);
  assert.equal(regionTile(null, 'global', null).value, '—');
  const { days } = judge([8000, 7000, 6500, 6000, 6000, 5800, 5600, 5500, 5400, 5300, 5200]);
  assert.equal(regionTile(days.global, 'global', hours).per, '每天');
});

test('before two whole days the daily chart draws the last 48 hours, from the first hour anyone streamed', async () => {
  const { hourlyPoints } = await import('../src/features/twitch/game-verdict.js');
  const start = Date.parse('2026-11-11T08:00:00+08:00');
  const row = (hour, status, viewers, zh = 0) => ({ hour: iso(start + hour * HOUR), generated_at: iso(start + hour * HOUR + 600000), status,
    viewer_count: viewers, streamer_count: viewers === null ? null : 10, audience_regions: { zh: { viewer_count: zh, streamer_count: zh ? 2 : 0 } } });
  const rows = [row(0, 'absent', null), row(1, 'observed', 500, 120), row(2, 'missing', null), row(3, 'absent', null, 0), row(4, 'observed', 800, 300)];
  // At 12:05 the 12:00 hour is not published yet: the line ends at the last known hour.
  assert.deepEqual(hourlyPoints(rows, 'global', start + 4 * HOUR + 300000), [
    { date: '2026-11-11 09:00', value: 500 }, { date: '2026-11-11 10:00', value: null }, { date: '2026-11-11 11:00', value: 0 }]);
  assert.deepEqual(hourlyPoints(rows, 'global', start + 5 * HOUR).map(point => point.value), [500, null, 0, 800]);
  assert.deepEqual(hourlyPoints(rows, 'zh', start + 5 * HOUR).map(point => point.value), [120, null, 0, 300]);
  assert.deepEqual(hourlyPoints([], 'global', start), []);
});
