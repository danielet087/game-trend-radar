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
