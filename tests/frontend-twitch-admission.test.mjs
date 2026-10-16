import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as modular from '../src/data/steam.mjs';
import { datasets } from '../src/data/datasets.mjs';
import { detailCatalog } from '../src/data/publication.mjs';

const legacy = createRequire(import.meta.url)('../assets/radar-data-v1.js');

// Saved qualification from the affected public game, independent of changing
// production files and the current date. Its Followers are below Steam's gate.
const hauntedHeist = () => ({
  appid: 4024440, name: 'Haunted Heist', display_name: '鬧鬼大劫掠',
  followers: 2043, follower_checked_at: '2026-10-16T15:02:39.425473+08:00',
  steam_type: 'game', sexual_content_screened: true,
  release_start: '2026-10-13', release_end: '2026-10-13', release_precision: 'day',
  release_display_precision: 'date_full', release_date_timezone: 'Asia/Taipei',
  release_time_utc: '2026-10-12T17:00:30Z', release_timestamp_taipei_date: '2026-10-13',
  release_date_conflict: false,
  twitch_admission: {
    schema_version: 1, method: 'twitch_igdb_external_steam_v1', appid: 4024440,
    twitch_game_id: '2056280692', igdb_id: '391023', checked_at: '2026-10-15T20:15:14Z',
    source_database_revision: 'b9680e2df2a94188330b6d5745ee0a900f33d88f71bed858aeccf150b1002393',
    source_database_generation: 22, source_database_namespace: 'danielet087/game-trend-radar@main',
    source_enrollment: { min_viewers: 7000, observed_at: '2026-10-15T20:15:14Z',
      source: 'igdb_first_release_date', viewer_count: 10729 },
  },
});
const legacyProof = () => {
  const proof = hauntedHeist().twitch_admission;
  for (const field of ['source_database_revision', 'source_database_generation', 'source_database_namespace']) delete proof[field];
  return { ...proof, source_frontend_commit: 'a'.repeat(40) };
};

for (const [name, adapter] of [['modular', modular], ['legacy', legacy]]) {
  test(`${name}: database admission keeps Haunted Heist public below 5,000 Followers`, () => {
    const raw = hauntedHeist();
    assert.equal(adapter.hasTwitchAdmission(raw), true);
    assert.equal(adapter.isTwitchQualified(raw), true);
    for (const recent of [false, true]) {
      const row = adapter.normalize(raw, recent);
      assert.equal(row.appid, 4024440);
      assert.equal(row.followers, 2043);
      assert.equal(row.twitchAdmission.source_database_generation, 22);
    }
    for (const followers of [0, 1, 4999]) {
      assert.equal(adapter.normalize({ ...raw, followers }).followers, followers);
    }
  });

  test(`${name}: legacy Git admission remains supported without database fields`, () => {
    const raw = { ...hauntedHeist(), twitch_admission: legacyProof() };
    assert.equal(adapter.hasTwitchAdmission(raw), true);
    assert.equal(adapter.isTwitchQualified(raw), true);
    assert.equal(adapter.normalize(raw).appid, 4024440);
    for (const commit of ['main', 'a'.repeat(39), 'A'.repeat(40), null]) {
      assert.equal(adapter.hasTwitchAdmission({ ...raw,
        twitch_admission: { ...raw.twitch_admission, source_frontend_commit: commit } }), false);
    }
  });

  test(`${name}: incomplete, mixed or spoofed database locators cannot bypass Followers`, () => {
    const raw = hauntedHeist(), proof = raw.twitch_admission;
    const invalid = [
      ...['source_database_revision', 'source_database_generation', 'source_database_namespace'].map(field => {
        const copy = { ...proof }; delete copy[field]; return copy;
      }),
      ...['a'.repeat(63), 'a'.repeat(40), 'A'.repeat(64), 'main', null].map(value =>
        ({ ...proof, source_database_revision: value })),
      ...[0, -1, 1.5, '22', true, null, Number.MAX_SAFE_INTEGER + 1].map(value =>
        ({ ...proof, source_database_generation: value })),
      ...['other/game-trend-radar@main', 'danielet087/game-trend-radar@steam-state',
        'danielet087/game-trend-radar-twitch-backend@main', 'danielet087/game-trend-radar@main ', null].map(value =>
        ({ ...proof, source_database_namespace: value })),
      ...['a'.repeat(40), null, undefined].map(value => ({ ...proof, source_frontend_commit: value })),
      ...['source_database_revision', 'source_database_generation', 'source_database_namespace'].map(field =>
        ({ ...legacyProof(), [field]: proof[field] })),
    ];
    for (const twitch_admission of invalid) {
      const candidate = { ...raw, twitch_admission };
      assert.equal(adapter.hasTwitchAdmission(candidate), false, JSON.stringify(twitch_admission));
      assert.equal(adapter.normalize(candidate), null);
      assert.equal(adapter.normalize(candidate, true), null);
    }
  });

  test(`${name}: database provenance preserves Twitch identity, viewers and enrollment checks`, () => {
    const raw = hauntedHeist(), proof = raw.twitch_admission;
    const invalid = [
      { ...proof, schema_version: true }, { ...proof, method: 'manual_match' },
      { ...proof, appid: 10 }, { ...proof, twitch_game_id: 'name' }, { ...proof, igdb_id: '0' },
      { ...proof, checked_at: '2026-10-15T20:15:13Z' },
      ...[{ source: 'steam_recent_release' }, { source: 'historical_manual_restore' },
        { viewer_count: 6999 }, { viewer_count: '10729' }, { min_viewers: 6999 },
        { qualification: 'unverified' }, { observed_at: '2026-10-15T20:15:14' }].map(fields =>
        ({ ...proof, source_enrollment: { ...proof.source_enrollment, ...fields } })),
    ];
    for (const twitch_admission of invalid) {
      const candidate = { ...raw, twitch_admission };
      assert.equal(adapter.hasTwitchAdmission(candidate), false, JSON.stringify(twitch_admission));
      assert.equal(adapter.normalize(candidate), null);
    }
  });

  test(`${name}: database admission still requires real Followers and verified Steam content/date`, () => {
    const raw = hauntedHeist();
    const invalid = [
      { steam_type: 'dlc' }, { sexual_content_screened: false },
      { release_precision: 'month' }, { release_display_precision: 'month' },
      { release_date_timezone: 'UTC' }, { release_end: '2026-10-14' },
      { release_date_conflict: true }, { release_timestamp_taipei_date: '2026-10-12' },
      { release_time_utc: '2026-10-12T12:00:00Z' }, { follower_checked_at: null },
      ...[null, undefined, '2043', -1, 1.5, Infinity, NaN].map(followers => ({ followers })),
    ];
    for (const fields of invalid) {
      const candidate = { ...raw, ...fields };
      assert.equal(adapter.isTwitchQualified(candidate), false, JSON.stringify(fields));
      assert.equal(adapter.normalize(candidate), null, JSON.stringify(fields));
      assert.equal(adapter.normalize(candidate, true), null, JSON.stringify(fields));
    }
  });
}

test('database-admitted catalog row survives the same authoritative detail dataset pipeline', () => {
  const raw = hauntedHeist();
  const catalog = { version: 3, revision: 'haunted-heist-regression', games: [raw] };
  const official = detailCatalog(catalog, raw, 4024440);
  const data = datasets(official, null);
  assert.equal(data.games.find(game => game.appid === 4024440)?.name, '鬧鬼大劫掠');
  assert.equal(data.recent.find(game => game.appid === 4024440)?.followers, 2043);
  // A supplemental detail file still cannot restore a game the catalog removed.
  assert.deepEqual(datasets(detailCatalog({ games: [] }, raw, 4024440), null).games, []);
});
