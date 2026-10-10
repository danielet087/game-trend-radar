const test = require('node:test');
const assert = require('node:assert/strict');
const legacy = require('../assets/radar-data-v1.js');
const fixture = require('./fixtures/twitch-unavailable-group.json');
const clone = () => structuredClone(fixture);

test('verified missing GroupID admits a Twitch game without inventing a Followers observation', async () => {
  const { RadarData: canonical, normalizeBoundary } = await import('../src/domain/index.mjs');
  for (const D of [legacy, canonical]) {
    const raw = clone(), before = structuredClone(raw);
    assert.equal(D.isTwitchQualified(raw), true);
    for (const recent of [false, true]) {
      const game = D.normalize(raw, recent);
      assert.equal(game.followers, null);
      assert.equal(game.followerStatus, 'unavailable_group_id');
      assert.equal(game.followerUnavailableAt, fixture.follower_unavailable_at);
      assert.deepEqual(game.twitchAdmission, fixture.twitch_admission);
    }
    assert.deepEqual(raw, before);
  }
  assert.deepEqual(canonical.normalize(clone()), legacy.normalize(clone()));
  const model = normalizeBoundary({ official: { games: [clone()] } });
  assert.deepEqual(model.entities[0].metrics.map(m => [m.kind, m.value, m.status]), [
    ['followers', null, 'unknown'], ['viewers', 7200, 'observed'],
  ]);
  assert.equal(model.entities[0].metrics[0].provenance.checkedAt, null);
  assert.equal(model.entities[0].metrics[1].provenance.checkedAt, fixture.twitch_admission.source_enrollment.observed_at);
});

test('nullable counts cannot bypass absence evidence, GroupID, exact date, content or Twitch identity checks', async () => {
  const { RadarData: canonical } = await import('../src/domain/index.mjs');
  const changes = [
    { follower_status: null }, { follower_status: 'source_unavailable' },
    { follower_unavailable_at: null }, { follower_unavailable_at: '2026-10-10T03:00:00' },
    { follower_unavailable_at: '2026-10-10T01:59:59Z' },
    { follower_checked_at: fixture.follower_unavailable_at }, { follower_source: 'steam_community' },
    { official_ge5000: true }, { official_ge5000: 0 }, { official_ge5000: null },
    { group_id64: '103582791429523071' }, { official_group_id64: '103582791429523071' },
    { group_short_id: 45078866 }, { group_id64: '' },
    { steam_type: 'dlc' }, { sexual_content_screened: false },
    { release_start: '2026-10-13' }, { release_end: '2026-10-13' },
    { release_precision: 'month' }, { release_display_precision: 'date_month' },
    { release_date_timezone: 'UTC' }, { release_time_utc: null },
    { release_timestamp_taipei_date: '2026-10-11' }, { twitch_admission: null },
    { twitch_admission: { ...fixture.twitch_admission, appid: 1 } },
    { twitch_admission: { ...fixture.twitch_admission, igdb_id: null } },
    { twitch_admission: { ...fixture.twitch_admission, twitch_game_id: 'series' } },
    { twitch_admission: { ...fixture.twitch_admission, source_frontend_commit: 'main' } },
    { twitch_admission: { ...fixture.twitch_admission, source_enrollment: {
      ...fixture.twitch_admission.source_enrollment, viewer_count: 6999 } } },
    { twitch_admission: { ...fixture.twitch_admission, source_enrollment: {
      ...fixture.twitch_admission.source_enrollment, qualification: 'unverified' } } },
  ];
  for (const D of [legacy, canonical]) {
    for (const fields of changes) {
      const raw = { ...clone(), ...fields };
      assert.equal(D.isTwitchQualified(raw), false, JSON.stringify(fields));
      assert.equal(D.normalize(raw), null, JSON.stringify(fields));
      assert.equal(D.normalize(raw, true), null, JSON.stringify(fields));
    }
    for (const field of ['followers', 'follower_checked_at', 'follower_source', 'official_ge5000']) {
      const raw = clone(); delete raw[field];
      assert.equal(D.normalize(raw), null, `missing ${field}`);
    }
  }
});

test('a later real zero or positive measurement keeps its numeric value and ranks ahead of unknown Followers', async () => {
  const { RadarData: D } = await import('../src/domain/index.mjs');
  const unknown = D.normalize(clone());
  const zero = D.normalize({ ...clone(), followers: 0, follower_checked_at: fixture.follower_unavailable_at,
    follower_status: null, follower_unavailable_at: null });
  const positive = D.normalize({ ...clone(), followers: 5000, follower_checked_at: fixture.follower_unavailable_at,
    follower_status: null, follower_unavailable_at: null });
  assert.equal(zero.followers, 0); assert.equal(zero.followerStatus, undefined);
  assert.equal(positive.followers, 5000); assert.equal(positive.followerUnavailableAt, undefined);
  assert.deepEqual([unknown, zero, positive].sort(D.popularityCompare).map(g => g.followers), [5000, 0, null]);
  assert.equal(Number.isNaN(D.popularityCompare(unknown, unknown)), false);
  assert.equal(D.isTwitchQualified({ ...clone(), followers: 0, follower_checked_at: fixture.follower_unavailable_at }), false);
  assert.equal(D.isTwitchQualified({ ...clone(), followers: 0, follower_checked_at: fixture.follower_unavailable_at, follower_status:null }), false);
});
