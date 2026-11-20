// One Taiwan release day per platform: which days may be called Taiwan days,
// the clock times sources give, and how the other platforms are described.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const D = require('../src/domain/index.mjs').RadarData;

const TODAY = '2026-12-03';
const steamRow = (date, extra = {}) => ({ platform: 'Steam', date, precision: 'day', source: 'Steam', ...extra });
const igdbRow = (platform, date, region = 'worldwide', extra = {}) =>
  ({ platform, date, precision: 'day', source: 'IGDB', region, ...extra });
const taiwanOfficial = (platform, date, extra = {}) => ({ platform, date, precision: 'day', region: 'taiwan',
  source: 'official_registry', date_basis: 'taiwan_official_calendar_day', time_zone: 'Asia/Taipei',
  timezone_status: 'taiwan_official_date', taiwan_release_confirmed: true,
  official_source_url: 'https://www.nintendo.com/tw/schedule/', official_source_name: 'Nintendo 台灣', ...extra });
const hongKongOfficial = (extra = {}) => ({ platform: 'NS2', date: '2027-01-16', precision: 'day', region: 'hong_kong',
  source: 'official_registry', date_basis: 'hong_kong_official_calendar_day', time_zone: 'Asia/Taipei',
  timezone_status: 'hong_kong_official_date', taiwan_release_confirmed: false,
  official_source_url: 'https://www.nintendo.com/hk/schedule', official_source_name: 'Nintendo 香港',
  official_verified_at: '2026-10-04T15:00:00Z', ...extra });
const summary = evidence => [evidence.taiwan, evidence.label, evidence.badge, evidence.short, evidence.source];

test('only Steam days and verified Taiwan official days are called Taiwan days', () => {
  assert.deepEqual(summary(D.releaseEvidence(steamRow('2026-12-04'))), [true, '台灣時間', '台灣時間', '', 'Steam']);
  assert.deepEqual(summary(D.releaseEvidence(taiwanOfficial('NS2', '2026-12-04'))), [true, '台灣官方', '台灣官方', '', 'official']);
  // A Taiwan claim without a safe official link is still only a claim, and says so once.
  const unsafe = D.releaseEvidence(taiwanOfficial('NS2', '2026-12-04', { official_source_url: 'javascript:alert(1)' }));
  assert.deepEqual(summary(unsafe), [false, '台灣日期待確認', '台灣日期待確認', '待確認', 'other']);
  assert.deepEqual(summary(D.releaseEvidence(hongKongOfficial())),
    [false, '香港官方日期', '香港官方日期・台灣待確認', '香港', 'official']);
  for (const [region, label, short] of [['worldwide', '全球日期', '全球'], ['japan', '日本日期', '日本'],
    ['north_america', '北美日期', '北美'], [null, '地區未確認的日期', '他區']]) {
    const evidence = D.releaseEvidence(igdbRow('PS5', TODAY, region));
    assert.deepEqual(summary(evidence), [false, label, `${label}・台灣待確認`, short, 'IGDB']);
    assert.equal(evidence.title, `IGDB ${label}，台灣上市日待確認`);
  }
});

test('a day shared with Steam is a Taiwan day with only the console part unconfirmed', () => {
  assert.equal(D.dayEvidence([steamRow(TODAY), taiwanOfficial('NS2', TODAY)]), null);
  const alone = D.dayEvidence([igdbRow('NS2', TODAY), igdbRow('PS5', TODAY)]);
  assert.deepEqual([alone.mixed, alone.pending, alone.chip, alone.detail],
    [false, ['NS2', 'PS5'], '全球日期', 'IGDB 全球日期，台灣上市日待確認']);
  const shared = D.dayEvidence([steamRow(TODAY), igdbRow('NS2', TODAY), igdbRow('PS5', TODAY)]);
  assert.deepEqual([shared.mixed, shared.confirmed, shared.pending, shared.chip, shared.detail],
    [true, ['Steam'], ['NS2', 'PS5'], '主機全球日期', 'NS2、PS5：IGDB 全球日期，台灣上市日待確認']);
  assert.equal(D.dayEvidence([]), null);
});

test('a clock time appears only when its source gives one on the same Taiwan day', () => {
  // Steam's planned launch at 17:00 UTC is 01:00 the next day in Taiwan.
  assert.deepEqual(D.releaseClock(steamRow('2026-12-04', { time_utc: '2026-12-03T17:00:00Z' })),
    { time: '01:00', utc: '2026-12-03T17:00:00.000Z', source: 'steam' });
  assert.equal(D.releaseClock(steamRow('2026-12-03', { time_utc: '2026-12-03T17:00:00Z' })), null);
  assert.equal(D.releaseClock(steamRow('2026-12-04')), null);
  assert.deepEqual(D.releaseClock(hongKongOfficial({ official_release_time_utc: '2027-01-15T18:00:00Z' })),
    { time: '02:00', utc: '2027-01-15T18:00:00.000Z', source: 'official' });
  // An IGDB row never gets an unlock time, whatever it carries.
  assert.equal(D.releaseClock(igdbRow('NS2', '2027-01-16', 'worldwide', { official_release_time_utc: '2027-01-15T18:00:00Z' })), null);
  assert.equal(D.releaseClock(steamRow('2026-02-30', { time_utc: '2026-02-29T17:00:00Z' })), null);
});

test('each tracked platform keeps its own first day, and the others are described apart', () => {
  const game = { platforms: ['Steam', 'NS', 'NS2', 'PS5'], releases: [
    steamRow('2025-02-28'), igdbRow('NS2', '2027-01-01'), igdbRow('NS2', TODAY),
    // The same day from a Taiwan official source wins over the IGDB day.
    igdbRow('NS', '2026-12-10', 'japan'), taiwanOfficial('NS', '2026-12-10'),
    { platform: 'PS5', date: '2027', precision: 'year', source: 'IGDB' },
  ] };
  assert.deepEqual(D.platformFirstReleases(game).map(({ platform, row }) => [platform, row?.date || null, row?.source || null]),
    [['Steam', '2025-02-28', 'Steam'], ['NS', '2026-12-10', 'official_registry'], ['NS2', TODAY, 'IGDB'], ['PS5', null, null]]);
  assert.deepEqual(D.platformsOnDate(game, TODAY), ['NS2']);
  const others = D.otherPlatformReleases(game, ['NS2'], TODAY);
  assert.deepEqual(others.map(entry => [entry.platform, entry.date, entry.state, entry.evidence?.taiwan ?? null]),
    [['Steam', '2025-02-28', 'released', true], ['NS', '2026-12-10', 'upcoming', true], ['PS5', '', 'undated', null]]);
  assert.deepEqual(D.otherPlatformPhrases(others, TODAY), ['Steam 2025/02/28 已上市', 'NS 12/10 發售', 'PS5 日期未定']);
  assert.deepEqual(D.releaseStatusGroups(game, TODAY), [
    { state: 'released', platforms: ['Steam'] }, { state: 'today', platforms: ['NS2'] },
    { state: 'upcoming', platforms: ['NS'] }, { state: 'undated', platforms: ['PS5'] }]);
  assert.equal(D.releaseStateText.today, '今天發售');
  assert.deepEqual(D.otherPlatformReleases(game, [], TODAY), []);
});

test('a tracked version with no release in the data is unlisted, never "date to be announced"', () => {
  // Monster Hunter Wilds: Steam since 2025, NS2 on 12/04, and no PS5 release in the console data.
  const game = { platforms: ['Steam', 'NS2', 'PS5'], releases: [steamRow('2025-02-27'), igdbRow('NS2', '2026-12-04')] };
  assert.deepEqual(D.platformFirstReleases(game).map(({ platform, listed }) => [platform, listed]),
    [['Steam', true], ['NS2', true], ['PS5', false]]);
  const others = D.otherPlatformReleases(game, ['NS2'], TODAY);
  assert.deepEqual(others.map(entry => [entry.platform, entry.state]), [['Steam', 'released'], ['PS5', 'unlisted']]);
  assert.deepEqual(D.otherPlatformPhrases(others, '2026-12-04'), ['Steam 2025/02/27 已上市']);
  assert.deepEqual(D.releaseStatusGroups(game, TODAY), [
    { state: 'released', platforms: ['Steam'] }, { state: 'upcoming', platforms: ['NS2'] }]);
  assert.equal(D.releaseStateText.unlisted, '日期未收錄');
  assert.match(D.unlistedReleaseNote, /可能早已上市/);
});

test('platforms sharing a day and state share one phrase, and unconfirmed days say whose day it is', () => {
  const game = { platforms: ['Steam', 'NS', 'NS2', 'PS5'], releases: [
    steamRow('2026-12-04', { time_utc: '2026-12-03T17:00:00Z' }),
    igdbRow('NS', TODAY), igdbRow('NS2', TODAY), igdbRow('PS5', TODAY)] };
  const fromSteamDay = D.otherPlatformReleases(game, ['Steam'], '2026-12-02');
  assert.deepEqual(D.otherPlatformPhrases(fromSteamDay, '2026-12-04'), ['NS、NS2、PS5 12/03 發售（全球日期）']);
  // Steam's planned time is part of its phrase until launch.
  assert.deepEqual(D.otherPlatformPhrases(D.otherPlatformReleases(game, ['NS', 'NS2', 'PS5'], '2026-12-02'), TODAY),
    ['Steam 12/04 01:00 發售']);
  const released = { platforms: ['Steam', 'PS5'], releases: [steamRow('2026-10-27', { time_utc: '2026-10-26T17:00:00Z' }),
    igdbRow('PS5', '2026-10-27'), igdbRow('NS2', TODAY)] };
  released.platforms.push('NS2');
  // Released platforms group by day alone: a clock time no longer matters.
  assert.deepEqual(D.otherPlatformPhrases(D.otherPlatformReleases(released, ['NS2'], TODAY), TODAY), ['Steam、PS5 10/27 已上市']);
  assert.deepEqual(D.otherPlatformPhrases(D.otherPlatformReleases({ platforms: ['Steam', 'NS2'],
    releases: [steamRow(TODAY), igdbRow('NS2', '2026-12-24')] }, ['NS2'], TODAY), '2026-12-24'), ['Steam 今天發售']);
  assert.equal(D.shortReleaseDay('2026-12-04', TODAY), '12/04');
  assert.equal(D.shortReleaseDay('2025-02-28', TODAY), '2025/02/28');
  assert.equal(D.shortReleaseDay('', TODAY), '');
});

test('the Steam release instant reaches the release row only when it falls on the shown Taiwan day', () => {
  const rows = D.datasets({ games: [
    { appid: 1, name: 'Planned', followers: 6000, release_start: '2026-12-04', release_time_utc: '2026-12-03T17:00:00Z' },
    { appid: 3, name: 'Dated', followers: 6000, release_start: '2026-12-06' },
  ] }, null, null).games;
  const release = appid => rows.find(game => game.appid === appid).releases[0];
  assert.equal(release(1).time_utc, '2026-12-03T17:00:00Z');
  assert.equal(D.releaseClock(release(1)).time, '01:00');
  assert.equal(Object.hasOwn(release(3), 'time_utc'), false);
  // A Taiwan store date that differs from the release instant never borrows its clock time.
  const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'site-data', 'steam_upcoming.json'), 'utf8'));
  const stores = fixture.games.filter(row => row.release_date_normalization === 'steam_taiwan_store_date_authoritative');
  assert.ok(stores.length > 0);
  const games = D.datasets(fixture, null, null).games;
  for (const store of stores) {
    const [row] = games.find(game => game.appid === Number(store.appid)).releases;
    assert.equal(row.date, store.release_start);
    assert.equal(Object.hasOwn(row, 'time_utc'), false);
    assert.equal(D.releaseClock(row), null);
  }
});

test('the Store page day rides along only when it is one day off the Taiwan day', () => {
  const rows = D.datasets({ games: [
    { appid: 1, name: 'Evening', followers: 6000, release_start: '2026-12-04',
      release_time_utc: '2026-12-03T17:00:00Z', release_store_date: '2026-12-03' },
    { appid: 2, name: 'Same', followers: 6000, release_start: '2026-12-05', release_store_date: '2026-12-05' },
    { appid: 3, name: 'Wide', followers: 6000, release_start: '2026-12-06', release_store_date: '2026-12-01' },
  ] }, null, null).games;
  const release = appid => rows.find(game => game.appid === appid).releases[0];
  assert.equal(release(1).store_date, '2026-12-03');
  assert.equal(Object.hasOwn(release(2), 'store_date'), false);
  assert.equal(Object.hasOwn(release(3), 'store_date'), false);
});
