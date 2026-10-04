const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../assets/radar-data-v1.js');

function payload(release) {
  return { schema_version: 1, games: [{
    id: 'igdb:381222', igdb_id: 381222, name_en: 'Order of the Sinking Star',
    hypes: 30, sexual_content_screened: true,
    platforms: [{ id: 508, code: 'NS2' }],
    websites: [{ url: 'https://store.steampowered.com/app/499170/' }],
    releases: [{ date: '2026-10-08', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB', ...release }],
  }] };
}
const auditedIGDB = {
  source_date: '2026-10-08', source_timestamp: 1791417600,
  source_region: 'worldwide', time_zone: 'Asia/Taipei',
  timestamp_taipei_date: '2026-10-08', timezone_status: 'same_calendar_day',
  taiwan_release_confirmed: false, official_source_url: null, official_source_name: null,
};

test('legacy Nintendo release bundles stay readable during the audit rollout', () => {
  const [game] = D.nintendoGames(payload({}));
  assert.equal(game.date, '2026-10-08');
  assert.equal(game.releases[0].timezone_status, undefined);
});

test('an audited unchanged date retains its IGDB region and audit without claiming Taiwan confirmation', () => {
  const [game] = D.nintendoGames(payload(auditedIGDB));
  assert.equal(game.date, '2026-10-08');
  assert.equal(game.dateRegion, 'worldwide');
  assert.equal(game.releases[0].taiwan_release_confirmed, false);
  assert.equal(game.releases[0].source_timestamp, auditedIGDB.source_timestamp);
  const [dateOnly] = D.nintendoGames(payload({ ...auditedIGDB,
    source_timestamp: null, timestamp_taipei_date: null, timezone_status: 'date_only' }));
  assert.equal(dateOnly.date, '2026-10-08');
});

test('ambiguous, imprecise and inconsistent audited dates do not enter the calendar', () => {
  for (const overrides of [
    { timezone_status: 'requires_time_evidence' },
    { timezone_status: 'imprecise_date' },
    { timezone_status: 'unknown' },
    { time_zone: 'UTC' },
    { source_date: '2026-10-07' },
    { timestamp_taipei_date: '2026-10-09' },
    { taiwan_release_confirmed: true },
  ]) assert.deepEqual(D.nintendoGames(payload({ ...auditedIGDB, ...overrides })), []);
});

test('an official Taiwan date replaces its IGDB calendar candidate and survives Steam merging', () => {
  const release = { ...auditedIGDB, date: '2026-10-09', region: 'taiwan',
    source: 'official_registry', date_basis: 'taiwan_official_calendar_day',
    timezone_status: 'taiwan_official_date', taiwan_release_confirmed: true,
    official_source_url: 'https://www.nintendo.com/tw/schedule/', official_source_name: 'Nintendo 台灣' };
  const nintendo = payload(release);
  const [game] = D.nintendoGames(nintendo);
  assert.equal(game.date, '2026-10-09');
  assert.equal(game.releases[0].source_date, '2026-10-08');
  const catalog = { version: 3, games: [{ appid: 499170, name: 'Order of the Sinking Star',
    followers: 6000, release_start: '2026-10-09' }] };
  const merged = D.datasets(catalog, null, nintendo);
  assert.equal(merged.games.length, 1);
  const row = merged.games[0].releases.find(row => row.platform === 'NS2');
  assert.deepEqual(row, { date: '2026-10-09', platform: 'NS2', precision: 'day', ...release });
  assert.equal(merged.games.some(game => game.date === '2026-10-08'), false);
});

test('official audit status requires the publisher official-date contract', () => {
  for (const overrides of [
    {}, { source: 'official_registry' },
    { source: 'official_registry', region: 'taiwan', date_basis: 'taiwan_official_calendar_day', taiwan_release_confirmed: false },
  ]) assert.deepEqual(D.nintendoGames(payload({ ...auditedIGDB, timezone_status: 'taiwan_official_date', ...overrides })), []);
});

const hongKongRelease = (changes = {}) => ({ ...auditedIGDB, date: '2026-10-09', region: 'hong_kong',
  source: 'official_registry', date_basis: 'hong_kong_official_calendar_day',
  timezone_status: 'hong_kong_official_date', taiwan_release_confirmed: false,
  official_source_url: 'https://www.nintendo.com/hk/schedule', official_source_name: 'Nintendo 香港',
  official_verified_at: '2026-10-04T15:00:00Z', ...changes });

test('reviewed Hong Kong Nintendo calendar days remain unchanged in Taipei and merge with Steam', () => {
  for (const platform of ['NS', 'NS2']) {
    const native = payload(hongKongRelease({ platform }));
    native.games[0].platforms = [{ id: platform === 'NS' ? 130 : 508, code: platform }];
    const [game] = D.nintendoGames(native);
    assert.equal(game.date, '2026-10-09');
    assert.equal(game.dateRegion, 'hong_kong');
    assert.equal(game.releases[0].taiwan_release_confirmed, false);
    const merged = D.datasets({ version: 3, games: [{ appid: 499170, name: 'Order of the Sinking Star',
      followers: 6000, release_start: '2026-10-09' }] }, null, native);
    assert.equal(merged.games.length, 1);
    assert.equal(merged.games[0].appid, 499170);
    assert.equal(merged.games[0].releases.find(row => row.platform === platform).region, 'hong_kong');
  }
});

test('Hong Kong proof accepts only official regional Nintendo paths and a complete date audit', () => {
  for (const official_source_url of ['https://www.nintendo.com.hk/schedule/', 'https://nintendo.com.hk/software/test/',
    'https://store.nintendo.com.hk/70010000000001', 'https://www.nintendo.com/hk/schedule'])
    assert.equal(D.nintendoGames(payload(hongKongRelease({ official_source_url }))).length, 1);
  for (const changes of [{ region: 'taiwan' }, { region: 'worldwide' }, { taiwan_release_confirmed: true },
    { taiwan_release_confirmed: undefined }, { official_verified_at: null },
    { official_verified_at: '2026-10-04T15:00:00' }, { official_source_name: '' },
    { date_basis: 'regional_calendar_day' }, { source: 'IGDB' }, { timezone_status: undefined },
    { time_zone: 'UTC' }, { source_timestamp: true }, { source_timestamp: 1791493200 },
    ...['https://www.nintendo.com.hk/', 'https://www.nintendo.com.hk/index.html',
      'https://www.nintendo.com/hk/', 'https://www.nintendo.com/hk/index.htm',
      'https://www.nintendo.com/tw/schedule/', 'https://www.nintendo.com/us/schedule/',
      'https://www.nintendo.com.hk.evil.example/schedule/', 'https://other.nintendo.com.hk/schedule/',
      'http://www.nintendo.com.hk/schedule/', 'https://user:pass@www.nintendo.com.hk/schedule/',
      'https://www.nintendo.com.hk:8443/schedule/', 'https://www.nintendo.com.hk/schedule/#game',
      'https://www.nintendo.com.hk/schedule/?date=2026-10-09', 'https://ec.nintendo.com/HK/game/',
      'https://www.nintendo.com.hk:443/schedule/', 'https://www.nintendo.com/hk/../tw/schedule',
      'https://www.nintendo.com/hk/%2e%2e/tw/schedule', 'https://www.nintendo.com/hk/%2e%2e%2fus/schedule',
      'https://www.nintendo.com/hk/%5c../tw/schedule',
      'https://store.playstation.com/zh-hant-hk/concept/10009999/']
      .map(official_source_url => ({ official_source_url }))])
    assert.deepEqual(D.nintendoGames(payload(hongKongRelease(changes))), [], JSON.stringify(changes));
  const ps5 = payload(hongKongRelease({ platform: 'PS5' }));
  ps5.games[0].platforms = [{ id: 167, code: 'PS5' }];
  assert.deepEqual(D.nintendoGames(ps5), []);
});

test('Nintendo regional official preference chooses Taiwan before Hong Kong before IGDB', () => {
  const native = payload(hongKongRelease());
  native.games[0].releases.push({ date: '2026-10-08', platform: 'NS2', precision: 'day', region: 'worldwide',
    source: 'IGDB', ...auditedIGDB });
  assert.deepEqual(D.nintendoGames(native).map(game => game.date), ['2026-10-09']);
  native.games[0].releases.push({ ...hongKongRelease(), platform: 'NS2', precision: 'day', date: '2026-10-10', region: 'taiwan',
    date_basis: 'taiwan_official_calendar_day', timezone_status: 'taiwan_official_date', taiwan_release_confirmed: true,
    official_source_url: 'https://www.nintendo.com/tw/schedule/', official_source_name: 'Nintendo 台灣' });
  const [game] = D.nintendoGames(native);
  assert.equal(game.date, '2026-10-10');
  assert.equal(game.releases.length, 1);
  assert.equal(game.releases[0].source_date, '2026-10-08');
});

test('Hong Kong actual release timestamps must agree with the Taipei day while date-only evidence has no clock', () => {
  const [game] = D.nintendoGames(payload(hongKongRelease({ official_release_time_utc: '2026-10-08T18:00:00Z' })));
  assert.equal(game.date, '2026-10-09');
  assert.equal(D.officialTaiwanReleaseTime(game.releases[0]), Date.parse('2026-10-08T18:00:00Z'));
  for (const official_release_time_utc of ['2026-10-08T10:00:00Z', '2026-10-08T18:00:00', 'not-a-time'])
    assert.deepEqual(D.nintendoGames(payload(hongKongRelease({ official_release_time_utc }))), []);
  assert.equal(D.officialTaiwanReleaseTime(hongKongRelease()), null);
});
