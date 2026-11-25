import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentLaunch, gameLaunches, launchLine, launchPeakText, launchPeaks, waitingText } from '../src/features/twitch/launches.js';
import { analyzeStreamHeat } from '../src/features/twitch/stream-heat-model.js';

const HOUR = 3600000;
const at = text => Date.parse(`${text}+08:00`);
const iso = moment => new Date(moment).toISOString().replace('.000Z', 'Z');
const steam = date => ({ date, source: 'Steam 台灣商店', source_type: 'steam_early_access' });
const record = (launches, reference = { date: '2026-10-20', precision: 'day', source: 'Steam 台灣商店', steam_appid: '7' }) =>
  ({ release_reference: reference, launches });
const ea = record({ early_access: steam('2026-10-20'), full_release: { ...steam('2026-11-05'), source_type: 'steam_full_release' } });

test('an Early Access game has two launches, a single launch has none', () => {
  assert.deepEqual(gameLaunches(ea), { earlyAccess: ea.launches.early_access, fullRelease: ea.launches.full_release });
  assert.equal(gameLaunches(record(undefined)), null);
  assert.equal(gameLaunches(record({ full_release: steam('2026-11-05') })), null);
  // A full release not after the start, or malformed, is no second launch.
  assert.equal(gameLaunches(record({ early_access: steam('2026-10-20'), full_release: steam('2026-10-20') })).fullRelease, null);
  assert.equal(gameLaunches(record({ early_access: { date: 'soon' } })), null);
});

test('the launch rules count from the latest launch that has begun', () => {
  const early = currentLaunch(ea, at('2026-11-04T23:00:00'));
  assert.equal(early.kind, 'early_access');
  assert.equal(early.steam_appid, '7'); // Steam's release time still applies to that day.
  const full = currentLaunch(ea, at('2026-11-05T00:00:00'));
  assert.deepEqual([full.kind, full.date, full.steam_appid], ['full_release', '2026-11-05', undefined]);
  assert.equal(currentLaunch(record(undefined), Date.now()).kind, 'release');
  assert.equal(currentLaunch({}, Date.now()), null);
  // After the Steam date moved to the full release, Early Access keeps its own day.
  const moved = record(ea.launches, { date: '2026-11-05', precision: 'day', steam_appid: '7' });
  assert.deepEqual([currentLaunch(moved, at('2026-10-25T00:00:00')).date, currentLaunch(moved, at('2026-11-06T00:00:00')).steam_appid],
    ['2026-10-20', '7']);
});

test('the release line names both launches and where the day falls', () => {
  assert.equal(launchLine(ea, '2026-10-19'), '搶先體驗 2026/10/20 · 正式上市 2026/11/05 · 還沒上市');
  assert.equal(launchLine(ea, '2026-10-25'), '搶先體驗 2026/10/20 · 正式上市 2026/11/05 · 搶先體驗中');
  assert.equal(launchLine(ea, '2026-11-05'), '搶先體驗 2026/10/20 · 正式上市 2026/11/05');
  assert.equal(launchLine(record({ early_access: steam('2026-10-20') }), '2026-11-05'), '搶先體驗 2026/10/20 · 正式上市日未定 · 搶先體驗中');
  assert.equal(launchLine(record(undefined), '2026-11-05'), null);
});

function rows(values) {
  return values.map(([hour, viewer_count]) => ({ hour: iso(at(hour)), generated_at: iso(at(hour) + 600000), status: 'observed', viewer_count }));
}

test('after the full release its peak is set against the Early Access peak', () => {
  const series = rows([['2026-10-19T23:00:00', 9999], ['2026-10-21T20:00:00', 3000], ['2026-11-05T20:00:00', 9000],
    ['2026-11-06T20:00:00', 8000]]);
  assert.equal(launchPeaks(series, ea, at('2026-11-04T00:00:00')), null);
  const peaks = launchPeaks(series, ea, at('2026-11-07T00:00:00'));
  assert.deepEqual(peaks, { earlyAccess: 3000, fullRelease: 9000, ratio: 3, newPeak: true });
  assert.deepEqual(launchPeakText(peaks), { label: '正式上市新高峰', text: '正式上市後最高 9,000 人，是搶先體驗時最高 3,000 人的 3.0 倍。' });
  assert.equal(launchPeakText({ earlyAccess: 10000, fullRelease: 6000, ratio: 0.6, newPeak: false }).text,
    '正式上市後最高 6,000 人，比搶先體驗時最高 10,000 人少 40%。');
  assert.equal(launchPeakText({ earlyAccess: 10000, fullRelease: 10200, ratio: 1.02, newPeak: true }).text,
    '正式上市後最高 10,200 人，跟搶先體驗時最高 10,000 人差不多。');
  // No Early Access hours on record: nothing to compare.
  assert.equal(launchPeaks(rows([['2026-11-05T20:00:00', 9000]]), ea, at('2026-11-07T00:00:00')), null);
});

test('a waiting game says what it waits for and when it resumes', () => {
  assert.equal(waitingText({ tracking_reason: 'awaiting_full_release', tracking_resumes_at: '2027-05-18T00:00:00Z' }),
    '等正式上市，2027/05/18 起恢復每小時記錄');
  assert.equal(waitingText({ tracking_reason: 'awaiting_full_release' }), '等正式上市；查到正式上市日會在前 14 天恢復記錄');
  assert.equal(waitingText({ tracking_reason: 'awaiting_launch' }), '等下一次上市；查到確切上市日會在前 14 天恢復記錄');
  assert.equal(waitingText({ tracking_reason: 'release_window_elapsed' }), null);
});

test('before the first launch an Early Access game is not yet released', () => {
  const series = rows(Array.from({ length: 24 }, (_, index) => [`2026-10-18T${String(index).padStart(2, '0')}:00:00`, 5000]));
  const game = { ...ea, release_reference: { date: '2026-11-05', precision: 'day' } };
  assert.equal(analyzeStreamHeat(series, { game, date: '2026-10-18', now: at('2026-10-19T12:00:00') }).prelaunch, true);
  assert.equal(analyzeStreamHeat(series, { game, date: '2026-10-25', now: at('2026-10-26T12:00:00') }).prelaunch, false);
});
