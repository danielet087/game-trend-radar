import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateStart } from '../src/features/twitch/series.js';
import { LAUNCH_RULES, launchAdvice, launchDays, launchInstant, steamAppOf } from '../src/features/twitch/launch-model.js';
import { launchAdviceShort, launchAdviceText, launchFlagShort, launchFlagText } from '../src/features/twitch/launch-advice.js';
import { streamerAdvice } from '../src/features/twitch/heat-overview.js';
import { analyzeStreamHeat } from '../src/features/twitch/stream-heat-model.js';

const HOUR = 3600000, DAY = 24 * HOUR;
const iso = at => new Date(at).toISOString().replace('.000Z', 'Z');
const release = Date.parse('2026-11-05T01:00:00+08:00');
// One observed row per hour from the release instant; `daily[k]` viewers on day k (0-based).
const series = (daily, { start = release, channels = () => 10, skip = () => false } = {}) => daily.flatMap((viewers, day) =>
  Array.from({ length: 24 }, (_, hour) => {
    const at = start + day * DAY + hour * HOUR;
    return { hour: iso(at), generated_at: iso(at + 600000), status: skip(day, hour) ? 'missing' : 'observed',
      viewer_count: viewers, streamer_count: channels(day) };
  }));
const advise = (daily, days = daily.length, options = {}) => {
  const now = release + days * DAY;
  return launchAdvice({ days: launchDays(series(daily, options), release, now), releaseAt: release, now });
};

test('the release instant uses Steam time to the hour near the Taiwan date, otherwise Taiwan midnight', () => {
  const reference = { date: '2026-11-05', precision: 'day', steam_appid: '4262460' };
  assert.equal(iso(launchInstant(reference, '2026-11-04T17:42:10Z')), '2026-11-04T17:00:00Z');
  assert.equal(launchInstant(reference, '2026-11-08T17:00:00Z'), dateStart('2026-11-05'));
  assert.equal(launchInstant(reference, null), dateStart('2026-11-05'));
  assert.equal(launchInstant({ date: '2026-11', precision: 'month' }, null), null);
  assert.equal(steamAppOf({ release_reference: reference }), '4262460');
  assert.equal(steamAppOf({ admission_sources: ['twitch_new', 'steam:88001'] }), '88001');
  assert.equal(steamAppOf({}), null);
});

test('launch days need 12 observed hours and ignore anything published after the as-of time', () => {
  const rows = series([500, 300, 200], { skip: (day, hour) => day === 1 && hour < 13, channels: day => 10 + day });
  const days = launchDays(rows, release, release + 3 * DAY);
  assert.deepEqual(days.map(day => day.median), [500, null, 200]);
  assert.deepEqual(days.map(day => day.validHours), [24, 11, 24]);
  assert.deepEqual(days.map(day => day.channels), [10, null, 12]);
  assert.deepEqual(launchDays(rows, release, release + 2 * DAY - 1).map(day => day.index), [0]);
  const late = rows.map(row => ({ ...row, generated_at: iso(release + 9 * DAY) }));
  assert.deepEqual(launchDays(late, release, release + 3 * DAY).map(day => day.median), [null, null, null]);
});

test('small games pass two gates: 300 in the first 24 hours, then 200 on the latest whole day', () => {
  assert.equal(launchAdvice({ days: [], releaseAt: release, now: release - HOUR }).stage, 'prelaunch');
  assert.equal(launchAdvice({ days: [], releaseAt: release, now: release + HOUR }).stage, 'first');
  assert.deepEqual([advise([299, 900, 900]).stage, advise([299, 900, 900]).basis], ['skip', 'first_day']);
  assert.equal(advise([300, 250], 2).stage, 'wait');
  const holding = advise([400, 300, 250]);
  assert.deepEqual([holding.stage, holding.trend, holding.latest.index, holding.latest.median], ['trial', 'holding', 2, 250]);
  assert.equal(advise([1000, 600, 300]).trend, 'fading');
  const dropped = advise([1000, 600, 300, 150]);
  assert.deepEqual([dropped.stage, dropped.basis, dropped.latest.median], ['skip', 'latest_day', 150]);
  // A missing latest day falls back to the last whole one.
  assert.equal(advise([1000, 600, 300, 150], 4, { skip: day => day === 3 }).latest.median, 300);
  // After two weeks the trend label is dropped.
  assert.equal(advise([400, 300, 300, ...Array(13).fill(250)]).trend, null);
});

test('a missing first day or release time falls back to the latest day only', () => {
  const noFirst = advise([500, 250, 220], 3, { skip: day => day === 0 });
  assert.deepEqual([noFirst.stage, noFirst.basis, noFirst.latest.index], ['trial', 'no_first_day', 2]);
  assert.deepEqual(launchAdvice({ fallback: { date: '2026-11-10', median: 199 } }), {
    stage: 'skip', basis: 'taiwan_day', latest: { date: '2026-11-10', median: 199 }, darkHorse: null });
  assert.equal(launchAdvice({ fallback: null }).stage, 'insufficient');
  assert.equal(advise([500, 400, 300], 3, { skip: day => day === 2 }).stage, 'insufficient');
});

test('dark horses: the third day at least the first, then twice the first a week on', () => {
  const candidate = advise([600, 700, 900, 800]);
  assert.equal(candidate.darkHorse.kind, 'candidate');
  assert.equal(candidate.darkHorse.ratio, 1.5);
  // The candidate label goes once the latest day falls below the first day.
  assert.equal(advise([600, 700, 900, 500]).darkHorse, null);
  assert.equal(advise([600, 500, 590]).darkHorse, null);
  const burning = advise([6000, 13000, 24000, 33000, 31000, 55000, 62000, 69000]);
  assert.deepEqual([burning.darkHorse.kind, burning.darkHorse.day], ['burning', 7]);
  assert.equal(advise([600, 700, 900, 800, 700, 700, 700, 1100]).darkHorse, null);
  assert.equal(advise([600, ...Array(14).fill(1500)]).darkHorse, null);
  // Under 300 viewers on the first day there is no label, even when it doubles.
  assert.equal(advise([200, 300, 600]).darkHorse, null);
  assert.equal(LAUNCH_RULES.firstDay, 300);
});

test('advice and labels read in Traditional Chinese with 1-based launch days', () => {
  assert.deepEqual(launchAdviceText(advise([400, 300, 250])),
    ['值得試播一場', '上市第 3 天中位數 250 人；第 3 天還有首日的 63%，觀眾還在。']);
  assert.equal(launchAdviceText(advise([1000, 600, 300]))[0], '值得試播一場，要播趁早');
  assert.match(launchAdviceText(advise([299, 900, 900]))[1], /首 24 小時中位數 299 人，不到 300 人/);
  assert.equal(launchAdviceText({ stage: 'skip', basis: 'taiwan_day', latest: { date: '2026-11-10', median: 150 } })[1],
    '沒有上市時間，只看最近一天（11/10）：中位數 150 人，不到 200 人。');
  assert.deepEqual(launchAdviceShort(advise([400, 300, 250])), { label: '值得試播', text: '第 3 天 250 人 · 觀眾還在' });
  assert.deepEqual(launchAdviceShort(advise([299, 900, 900])), { label: '先不用排', text: '首日 299 人' });
  assert.equal(launchAdviceShort({ stage: 'prelaunch' }), null);
  const flag = advise([600, 700, 900, 800], 4, { channels: day => [44, 50, 60][day] ?? 60 }).darkHorse;
  assert.equal(launchFlagText(flag), '黑馬候選：上市第 3 天（48～72 小時）是首日的 1.5 倍，一般遊戲這時只剩約 34%。開台數 44→60。');
  assert.match(launchFlagText(flag, 'zh'), /^黑馬候選（全球觀眾）：/);
  assert.deepEqual(launchFlagShort(flag), { label: '黑馬候選', text: '第 3 天是首日 1.5 倍 · 開台 44→60' });
  assert.deepEqual(launchFlagShort({ kind: 'burning', ratio: 11.5, day: 7 }), { label: '延燒中', text: '第 8 天是首日 11.5 倍' });
});

test('the game page uses the launch rules only for games never popular worldwide', () => {
  const now = Date.parse('2026-11-08T12:00:00+08:00');
  const data = { points: [{ hour: iso(now - HOUR), raw: 120 }], settings: { maxMissingHours: 12, threshold: 3000, confirmDays: 3 },
    latest: { lowDays: 0 } };
  const launch = { stage: 'trial', basis: 'latest_day', first: 400, third: 250, trend: 'holding', latest: { index: 2, median: 250 }, darkHorse: null };
  assert.deepEqual(streamerAdvice({ data, status: 'not_popular', launch: { ...launch, small: true } }, now),
    ['值得試播一場', '上市第 3 天中位數 250 人；第 3 天還有首日的 63%，觀眾還在。', 'launch']);
  assert.equal(streamerAdvice({ data, status: 'not_popular', launch: { ...launch, small: false } }, now)[0], '先試播一場');
  assert.equal(streamerAdvice({ data, status: 'not_popular' }, now)[0], '先試播一場');
});

test('a first rise above the trend floor is an ordinary rise, not a separate label', () => {
  const now = Date.parse('2026-11-12T09:00:00+08:00');
  const rows = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'].flatMap((date, day) =>
    Array.from({ length: 24 }, (_, hour) => {
      const at = dateStart(date) + hour * HOUR;
      return { hour: iso(at), generated_at: iso(at + 600000), status: 'observed', viewer_count: day < 4 ? 400 : 1800 };
    }));
  const result = analyzeStreamHeat(rows, { game: { tracking_status: 'active' }, region: 'global', date: '2026-11-11', now });
  assert.equal(result.outlook.comparison.signal, 'rising');
  assert.equal(result.popularAt, null);
});

test('the latest whole day is compared with same-age launches from the third to the 21st day', async () => {
  const { peerComparison, PEER_CURVE, launchAdvice } = await import('../src/features/twitch/launch-model.js');
  const { launchPeerShort, launchPeerText } = await import('../src/features/twitch/launch-advice.js');
  const days = medians => medians.map((median, index) => ({ index, median }));
  assert.deepEqual(peerComparison(days([1000, 700, 500, 400, 350, 330, 330, 330])),
    { verdict: 'outlasting', day: 7, ratio: 0.33, typical: 0.129 });
  assert.equal(peerComparison(days([1000, 700, 300, 100, 50, 30, 20, 10])).verdict, 'fading');
  assert.equal(peerComparison(days([1000, 700, 300, 250])).verdict, 'typical');
  assert.equal(peerComparison(days([299, 700, 300, 250])), null, 'first day under 300');
  assert.equal(peerComparison(days([1000, 700])), null, 'before the third day');
  assert.equal(peerComparison(days(Array(22).fill(1000))), null, 'after the 21st day');
  assert.equal(peerComparison(days([1000, 700, 300, null])).day, 2, 'the latest day with a median');
  for (const [day, [low, middle, high]] of Object.entries(PEER_CURVE)) {
    assert.ok(low <= middle && middle <= high, `day ${day}`);
    if (PEER_CURVE[+day + 1]) assert.ok(PEER_CURVE[+day + 1].every((value, i) => value <= [low, middle, high][i]), `day ${day} never rises`);
  }
  const now = Date.parse('2026-11-20T00:00:00Z'), releaseAt = now - 9 * 24 * 3600000;
  assert.equal(launchAdvice({ days: days([1000, 900, 800, 700, 600, 500, 400, 350, 340]), releaseAt, now }).peer.verdict, 'outlasting');
  assert.equal(launchPeerText({ verdict: 'outlasting', day: 7, ratio: 0.4, typical: 0.141 }),
    '比同齡撐得久：上市第 8 天還有首日的 40%，同齡遊戲一般剩 14%。');
  assert.equal(launchPeerText({ verdict: 'fading', day: 7, ratio: 0.003, typical: 0.141 }, 'zh'),
    '掉得比同齡快（全球觀眾）：上市第 8 天剩首日的不到 1%，同齡遊戲一般還有 14%。');
  assert.equal(launchPeerText({ verdict: 'outlasting', day: 3, ratio: 1.3, typical: 0.29 }),
    '比同齡撐得久：上市第 4 天還有首日的 1.3 倍，同齡遊戲一般剩 29%。');
  assert.equal(launchPeerText({ verdict: 'typical', day: 3, ratio: 0.3, typical: 0.29 }), null);
  assert.deepEqual(launchPeerShort({ verdict: 'fading', day: 9, ratio: 0.03, typical: 0.125 }),
    { label: '掉得比同齡快', text: '第 10 天是首日的 3% · 同齡一般 13%' });
});
