import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStreamHeat } from '../src/features/twitch/stream-heat-model.js';
import { projectRows } from '../src/features/twitch/region-views.js';
import { launchAdvice, launchDays, launchAnchor } from '../src/features/twitch/launch-model.js';
import { launchPeaks } from '../src/features/twitch/launches.js';
import { chineseVerdict, combineVerdicts, compactCount, extraLines, forecastLine, gameMeta, globalVerdict, lastDays, launchMeta,
  regionTile, sortEntries, sparkPoints, trendOf } from '../src/features/twitch/trend-verdict.js';
import { busiestSlot, channelsAboveRange, slotHours, slotLabel, slotOf, slotPeriod, slotStats } from '../src/features/twitch/stream-slot-model.js';
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
  assert.deepEqual(global, { group: 'hot', label: '還很熱', headline: '可以繼續播',
    reason: '每天還有約 5,400 人在看，比前 3 天少 7%，仍高於 3,000 人的熱門線。' });
  const tile = regionTile(days.global, 'global');
  assert.equal(tile.value, '5,400');
  assert.equal(tile.trend, '↓ 比前 3 天少 7%');
  assert.deepEqual(lastDays(days.global, 'global'), [6000, 6000, 5800, 5600, 5500, 5400, 5300]);
  assert.equal(tile.spark.split(' ').length, 7);
});

test('a popular game three days under 3,000 has cooled, by the fixed line or its own peak', () => {
  const cooled = judge([8000, 6000, 4000, 2500, 2400, 2300, 2200, 2100, 2000, 1900, 1800]).global;
  assert.deepEqual(cooled, { group: 'cooled', label: '已退燒', headline: '建議收尾或換題', reason: '11/07 確認退燒，每天約 2,000 人。' });
  const suspected = judge([8000, 7000, 6500, 6000, 6000, 5800, 5600, 5500, 5400, 2900, 2800]).global;
  assert.equal(suspected.label, '開始降溫');
  assert.equal(suspected.reason, '最近 1 天每天不到 3,000 人；連續 3 天就算退燒。');
});

test('small games follow the launch rules and an own-peak cooldown', () => {
  const faded = judge([2000, 1500, 600, 300, 200, 150, 120, 100, 90, 80, 80]);
  assert.equal(faded.launch.stage, 'skip');
  assert.deepEqual(faded.global, { group: 'cooled', label: '已退燒', headline: '建議收尾或換題',
    reason: '11/07 確認退燒：每天約 90 人，不到自己高峰 2,000 人的 25%。' });
  const holding = judge([400, 380, 350, 330, 300, 290, 280, 270, 260, 250, 240]).global;
  assert.deepEqual(holding, { group: 'trial', label: '值得試播', headline: '值得試播一場',
    reason: '上市第 10 天約 250 人，第 3 天還有首日的 88%，觀眾還在。' });
  const small = judge([120, 110, 100, 90, 80, 80, 80, 80, 80, 80, 80]).global;
  assert.deepEqual(small, { group: 'skip', label: '先不用排', headline: '先不用排', reason: '首日約 120 人，不到 300 人。' });
  const horse = judge([400, 450, 500, 520, 530, 540, 560], { from: '2026-11-05' }).global;
  assert.deepEqual(horse, { group: 'horse', label: '黑馬候選', headline: '可以趁早試播',
    reason: '第 3 天是首日的 1.3 倍，一般遊戲這時只剩約 34%。' });
});

test('the Chinese region needs four hours at 100 viewers in a day', () => {
  const daily = Array(11).fill(5000);
  const hot = judge(daily, { zh: (day, hour) => hour < 5 ? { viewer_count: 150, streamer_count: 2 } : { viewer_count: 10, streamer_count: 1 } });
  assert.deepEqual(hot.zh, { group: 'hot', label: '有熱度', headline: '中文台可以繼續播', reason: '最近 7 天每天都有 4 個小時過 100 人。' });
  assert.equal(regionTile(hot.days.zh, 'zh').value, '150');
  const sporadic = judge(daily, { zh: (day, hour) => hour < 2 ? { viewer_count: 150, streamer_count: 2 } : { viewer_count: 10, streamer_count: 1 } });
  assert.deepEqual(sporadic.zh, { group: 'skip', label: '零星有熱度', headline: '中文台先不用排',
    reason: '最近 7 天沒有一天達標，只偶爾有幾個小時過 100 人。' });
  const cooled = judge(daily, { zh: (day, hour) => day < 6 && hour < 5 ? { viewer_count: 150, streamer_count: 2 } : { viewer_count: 0, streamer_count: 0 } });
  assert.deepEqual(cooled.zh, { group: 'cooled', label: '已退燒', headline: '中文台建議收尾或換題',
    reason: '11/10 確認退燒；最近一天沒有一個小時過 100 人。' });
});

test('one verdict shows when both regions agree, both when they differ', () => {
  const zhHot = (day, hour) => hour < 5 ? { viewer_count: 150, streamer_count: 2 } : { viewer_count: 10, streamer_count: 1 };
  const same = judge([8000, 7000, 6500, 6000, 6000, 5800, 5600, 5500, 5400, 5300, 5200], { zh: zhHot });
  const both = combineVerdicts({ global: same.global, zh: same.zh });
  assert.equal(both.split, false);
  assert.equal(both.reason, '每天還有約 5,400 人在看，比前 3 天少 7%，仍高於 3,000 人的熱門線；中文區也有熱度。');
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

test('cards add the forecast and the same-age comparison as extra lines', () => {
  const forecast = { median: 490000, probabilities: { 100: 1, 1000: 1, 3000: 0.97 } };
  assert.equal(forecastLine(forecast), '第 7～9 天預估約 49 萬人；還有 3,000 人以上的機率超過 95%。');
  assert.equal(forecastLine({ median: 400, probabilities: { 100: 0.62, 1000: 0.2, 3000: 0 } }), '第 7～9 天預估約 400 人；還有 100 人以上的機率 60%。');
  const lines = extraLines({ forecast, peer: { verdict: 'outlasting', day: 19, ratio: 5.7, typical: 0.05 } }, { group: 'hot' });
  assert.deepEqual(lines, [forecastLine(forecast), '比同齡撐得久：上市第 20 天還有首日的 5.7 倍，同齡遊戲一般剩 5%。']);
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
