const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../assets/radar-twitch-data-v1.js');
const at = '2026-09-29T12:20:00Z';
const forecast = (result, overrides = {}) => ({ status:'evaluated', predicted_new:result, evaluated_at:at, release_at:'2026-09-25T00:00:00Z', metadata_observed_at:at, ...overrides });
const candidate = (overrides = {}) => ({ game_id:'101', game_name:'Test Game', viewer_count:7000, streamer_count:21, median_viewer_count:0, verification:{status:'pending'}, ...overrides });
const filtered = (overrides = {}) => ({ rule:D.AUDIENCE_RULE, min_followers_exclusive:1000, min_viewers_inclusive:10, followers_max_age_hours:24, status:'complete', median_viewer_count:12.5, eligible_streamer_count:2, eligible_viewer_count:25, excluded_low_viewer_count:15, excluded_low_follower_count:4, unknown_follower_count:0, ...overrides });
const snapshot = (rows, overrides = {}) => ({ schema_version:2, generated_at:at, min_viewers:7000, coverage:{collection_complete:true}, candidate_games:rows, ...overrides });

test('uses the complete candidate list, preserving pending and exact-threshold rows', () => {
  const d = D.normalize(snapshot([candidate(),candidate({game_id:'102',viewer_count:6999})],{top_games:[]}));
  assert.equal(d.games.length,1);
  assert.equal(d.games[0].verification.status,'pending');
  assert.equal(d.games[0].median_viewer_count,0);
  assert.equal(D.matches(d.games[0],'official'),false);
});
test('never admits legacy popularity samples to any candidate or new-release view', () => {
  const d = D.normalize({generated_at:at,top_games:[candidate({median_viewer_count:100,verification:{status:'new',observed_at:at},release_experiment:{igdb_first_release_date:forecast(true)}})]});
  assert.equal(d.legacy,true);
  assert.equal(d.legacy_sample_count,1);
  assert.deepEqual(d.games,[]);
  assert.deepEqual(D.select(d.games,{filter:'all'}),[]);
});
test('default new-release view requires positive evidence, not popularity or unknown status', () => {
  const d = D.normalize(snapshot([
    candidate({game_id:'21779',game_name:'League of Legends',viewer_count:69070,release_experiment:{igdb_first_release_date:forecast(false,{release_at:'2009-10-27T00:00:00Z'})}}),
    candidate({game_id:'102',release_experiment:{igdb_first_release_date:forecast(true)}}),
    candidate({game_id:'103',verification:{status:'new',observed_at:at}}),
    candidate({game_id:'104'}),
    candidate({game_id:'105',verification:{status:'not_new',observed_at:at},release_experiment:{igdb_first_release_date:forecast(true)}}),
  ]));
  assert.equal(D.DEFAULT_FILTER,'signals');
  assert.deepEqual(D.select(d.games,{filter:D.DEFAULT_FILTER}).map(g=>g.game_id),['102','103']);
  assert.equal(D.select(d.games,{filter:'all'}).length,5);
  assert.ok(D.select(d.games,{filter:'pending'}).some(g=>g.game_id==='21779'));
});
test('does not promote IGDB predictions to Twitch metadata or official observations', () => {
  const g = D.normalize(snapshot([candidate({release_experiment:{igdb_first_release_date:forecast(true)}})])).games[0];
  assert.equal(D.matches(g,'igdb'),true);
  assert.equal(D.matches(g,'twitch'),false);
  assert.equal(D.matches(g,'official'),false);
  assert.equal(D.matches(g,'pending'),true);
});
test('keeps the saved prediction including upcoming releases, rather than recomputing at browser time', () => {
  const d = D.normalize(snapshot([candidate({release_experiment:{twitch_original_release_date:forecast(true,{release_phase:'upcoming',release_at:'2027-01-01T00:00:00Z'})}})]));
  assert.equal(d.games[0].release_experiment.twitch_original_release_date.predicted_new,true);
  assert.equal(d.games[0].release_experiment.twitch_original_release_date.release_phase,'upcoming');
});
test('uses independent date windows without reinterpreting historical predictions', () => {
  const old = D.normalize(snapshot([candidate({release_experiment:{igdb_first_release_date:forecast(false,{release_at:'2026-09-09T00:00:00Z'})}})]));
  assert.equal(old.games[0].release_experiment.igdb_first_release_date.window_days,14);
  assert.equal(old.games[0].release_experiment.igdb_first_release_date.predicted_new,false);
  assert.deepEqual(old.source_windows.igdb_first_release_date,[14]);
  const current = D.normalize(snapshot([candidate({release_experiment:{twitch_original_release_date:forecast(false,{window_days:14}),igdb_first_release_date:forecast(true,{window_days:30})}})]));
  assert.equal(current.games[0].release_experiment.twitch_original_release_date.window_days,14);
  assert.equal(current.games[0].release_experiment.igdb_first_release_date.window_days,30);
  assert.deepEqual(current.source_windows.igdb_first_release_date,[30]);
});
test('uses source report windows as fallback and retains per-prediction overrides', () => {
  const report = {twitch_original_release_date:{window_days:14},igdb_first_release_date:{window_days:30}};
  const d = D.normalize(snapshot([
    candidate({release_experiment:{igdb_first_release_date:forecast(true)}}),
    candidate({game_id:'102',release_experiment:{igdb_first_release_date:forecast(false,{window_days:14})}}),
    candidate({game_id:'103',release_experiment:{igdb_first_release_date:forecast(null,{status:'unknown',release_at:null,window_days:-1})}}),
  ],{newness_experiment:report}));
  assert.deepEqual(d.games.map(g=>g.release_experiment.igdb_first_release_date.window_days),[30,14,30]);
  assert.equal(d.games[2].release_experiment.igdb_first_release_date.predicted_new,null);
  assert.deepEqual(d.source_windows.igdb_first_release_date,[14,30]);
  assert.deepEqual(D.normalize(snapshot([],{newness_experiment:report})).source_windows.igdb_first_release_date,[30]);
});
test('retains date exclusions and evidence without creating zero measurements', () => {
  const d = D.normalize(snapshot([],{excluded_games:[{
    game_id:'104',game_name:'Outside release window',reason:'igdb_release_outside_window',metrics_collected:false,
    release_experiment:{igdb_first_release_date:forecast(false,{window_days:30,release_at:'2026-08-01T00:00:00Z'})},
  }]}));
  assert.equal(d.games.length,0);
  assert.equal(d.excluded[0].reason,'igdb_release_outside_window');
  assert.equal(d.excluded[0].release_experiment.igdb_first_release_date.predicted_new,false);
  assert.equal(d.excluded[0].viewer_count,null);
  assert.equal(d.excluded[0].streamer_count,null);
  assert.equal(d.excluded[0].filtered_audience.median_viewer_count,null);
  assert.deepEqual(d.source_windows.igdb_first_release_date,[30]);
});
test('expired or incomplete predictions and undated badge claims remain unknown', () => {
  const g = D.normalize(snapshot([candidate({verification:{status:'new'},release_experiment:{twitch_original_release_date:forecast(true,{status:'unknown'}),igdb_first_release_date:forecast(true,{release_at:null})}})])).games[0];
  assert.equal(g.verification.status,'pending');
  assert.equal(g.release_experiment.twitch_original_release_date.predicted_new,null);
  assert.equal(g.release_experiment.igdb_first_release_date.predicted_new,null);
});
test('filtered medians sort without using large old medians; search supports IDs', () => {
  const d = D.normalize(snapshot([candidate({median_viewer_count:9000}),candidate({game_id:'102',filtered_audience:filtered({median_viewer_count:10,eligible_viewer_count:20})}),candidate({game_id:'103',filtered_audience:filtered()})]));
  assert.deepEqual(D.select(d.games,{sort:'median'}).map(g=>g.game_id),['103','102','101']);
  assert.deepEqual(D.select(d.games,{query:'１０２'}).map(g=>g.game_id),['102']);
  assert.equal(D.count('7'),null);
  assert.equal(D.count(Infinity),null);
});
test('validates schema, skips corrupt rows, and restricts external URLs', () => {
  assert.throws(()=>D.normalize({generated_at:at,schema_version:3,candidate_games:[]}));
  assert.throws(()=>D.normalize(snapshot([],{generated_at:'yesterday'})));
  const d = D.normalize(snapshot([candidate(),candidate(),candidate({game_id:'bad'}),candidate({game_id:'103',viewer_count:null})]));
  assert.equal(d.games.length,1); assert.equal(d.invalidRows,3);
  assert.equal(D.safeURL('javascript:alert(1)'),null);
  assert.equal(D.safeURL('https://user:token@example.com'),null);
  const g = D.normalize(snapshot([candidate({box_art_url:'https://evil.example/art.jpg'})])).games[0];
  assert.equal(g.box_art_url,null);
  const good = D.normalize(snapshot([candidate({box_art_url:'https://static-cdn.jtvnw.net/ttv-boxart/101-{width}x{height}.jpg'})])).games[0];
  assert.match(good.box_art_url,/144x192/);
});
test('history requests Taipei day files across UTC midnight and year boundaries', () => {
  assert.deepEqual(D.historyDays('2026-09-29T17:20:00Z'),['2026-09-29','2026-09-30']);
  assert.deepEqual(D.historyDays('2027-01-01T00:20:00Z'),['2026-12-31','2027-01-01']);
  assert.equal(D.taipeiDay('2026-09-29T16:00:00Z'),'2026-09-30');
});
test('historical absence differs from zero; rejects future snapshots and incorrect day files', () => {
  const hours = {
    '2026-09-29T09:00:00Z':{generated_at:'2026-09-29T09:02:00Z',games:[candidate()]},
    '2026-09-29T10:00:00Z':{generated_at:'2026-09-29T10:02:00Z',games:[]},
    '2026-09-29T12:00:00Z':{generated_at:'2026-09-29T12:25:00Z',games:[candidate()]},
  };
  const file = {schema_version:1,date:'2026-09-29',timezone:'Asia/Taipei',hours};
  const rows = D.historyRows([file],'101',at);
  assert.equal(rows.length,24);
  const zero = rows.find(r=>r.hour.includes('T09:'));
  assert.equal(zero.status,'observed'); assert.equal(zero.median_viewer_count,0);
  assert.equal(rows.find(r=>r.hour.includes('T10:')).status,'absent');
  assert.equal(rows.find(r=>r.hour.includes('T11:')).status,'missing');
  assert.equal(rows.at(-1).status,'missing');
  assert.equal(rows.at(-1).viewer_count,null);
  assert.ok(D.historyRows([{...file,date:'2026-09-28'}],'101',at).every(r=>r.status==='missing'));
});

test('complete filtered audience requires exact thresholds and valid sample data', () => {
  const g = D.normalize(snapshot([candidate({filtered_audience:filtered()})])).games[0];
  assert.equal(g.filtered_audience.median_viewer_count,12.5);
  assert.equal(g.filtered_audience.eligible_streamer_count,2);
  assert.equal(g.viewer_count,7000);
  assert.equal(g.streamer_count,21);
  assert.equal(g.median_viewer_count,0);
  for (const change of [
    {rule:'different_rule'}, {min_followers_exclusive:999}, {min_viewers_inclusive:9}, {followers_max_age_hours:48},
    {median_viewer_count:0}, {median_viewer_count:9}, {median_viewer_count:null}, {median_viewer_count:'12.5'},
    {eligible_streamer_count:1.5}, {eligible_viewer_count:19}, {unknown_follower_count:1}, {excluded_low_viewer_count:-1},
    {status:'partial',unknown_follower_count:0},
  ]) {
    const a = D.filteredAudience(filtered(change));
    assert.equal(a.status,'invalid',JSON.stringify(change));
    assert.equal(a.median_viewer_count,null);
  }
});
test('missing, pending and empty filtered samples stay distinct and never become zero', () => {
  const missing = D.normalize(snapshot([candidate()])).games[0];
  assert.equal(missing.filtered_audience.status,'unavailable');
  assert.equal(missing.filtered_audience.median_viewer_count,null);
  const pending = D.filteredAudience(filtered({status:'partial',unknown_follower_count:3}));
  assert.equal(pending.status,'partial');
  assert.equal(pending.unknown_follower_count,3);
  assert.equal(pending.median_viewer_count,null);
  const empty = D.filteredAudience(filtered({eligible_streamer_count:0,eligible_viewer_count:0,median_viewer_count:null}));
  assert.equal(empty.status,'complete');
  assert.equal(empty.median_viewer_count,null);
  assert.equal(D.filteredAudience(filtered({eligible_streamer_count:0,eligible_viewer_count:0,median_viewer_count:0})).status,'invalid');
  const games = D.normalize(snapshot([
    candidate({game_id:'101',viewer_count:100000,filtered_audience:filtered({status:'partial',unknown_follower_count:3,median_viewer_count:10000})}),
    // Same viewer/streamer priority group: only the usable median should decide.
    candidate({game_id:'102',viewer_count:10000,filtered_audience:filtered()}),
  ])).games;
  assert.deepEqual(D.select(games,{sort:'median'}).map(g=>g.game_id),['102','101']);
});
test('hourly history retains each measurement definition, including old and partial snapshots', () => {
  const rows = D.historyRows([{schema_version:1,date:'2026-09-29',timezone:'Asia/Taipei',hours:{
    '2026-09-29T08:00:00Z':{generated_at:'2026-09-29T08:02:00Z',games:[candidate({median_viewer_count:999})]},
    '2026-09-29T09:00:00Z':{generated_at:'2026-09-29T09:02:00Z',games:[candidate({filtered_audience:filtered({status:'partial',unknown_follower_count:1})})]},
    '2026-09-29T10:00:00Z':{generated_at:'2026-09-29T10:02:00Z',games:[candidate({filtered_audience:filtered()})]},
  }}],'101',at);
  const old = rows.find(r=>r.hour.includes('T08:'));
  assert.equal(old.median_viewer_count,999);
  assert.equal(old.filtered_audience.median_viewer_count,null);
  assert.equal(old.filtered_audience.status,'unavailable');
  assert.equal(rows.find(r=>r.hour.includes('T09:')).filtered_audience.median_viewer_count,null);
  assert.equal(rows.find(r=>r.hour.includes('T10:')).filtered_audience.median_viewer_count,12.5);
});

const entry = (id, overrides = {}) => ({ game_id:id, game_name:`Tracked ${id}`, status:'active', first_seen_at:'2026-09-25T10:00:00Z', release_at:'2026-09-25T00:00:00Z', expires_at:'2026-10-25T00:00:00Z', enrollment:{source:'igdb_first_release_date'}, ...overrides });
const registry = (games, updated_at = at) => ({schema_version:1,updated_at,games});
test('enrolled games stay visible below threshold, at zero, and after badge/date signal disappears', () => {
  const state = registry({'101':entry('101'),'102':entry('102')});
  const d = D.normalize(snapshot([], {tracked_games:[
    candidate({viewer_count:450,tracking:entry('101'),verification:{status:'not_new',observed_at:at},release_experiment:{twitch_original_release_date:forecast(false)}}),
    candidate({game_id:'102',viewer_count:0,streamer_count:0,tracking:entry('102')}),
  ]}),state);
  assert.deepEqual(D.select(d.games,{filter:'signals'}).map(g=>g.game_id),['101','102']);
  assert.equal(d.games[1].viewer_count,0);
  assert.equal(D.matches(d.games[0],'official'),false);
  assert.equal(D.matches(d.games[0],'twitch'),false);
});
test('restores registry-only games with last values clearly retained and never ranked as current', () => {
  const past = '2026-09-28T10:05:00Z';
  const d = D.normalize(snapshot([candidate({viewer_count:7100,release_experiment:{igdb_first_release_date:forecast(true)}})]),registry({
    '102':entry('102',{observation_at:past,last_observation:candidate({game_id:'102',viewer_count:999999,measurement_finished_at:past,filtered_audience:filtered()})}),
    '103':entry('103'),
  }));
  assert.deepEqual(D.select(d.games,{filter:'signals',sort:'viewers'}).map(g=>g.game_id),['101','102','103']);
  const retained = d.games.find(g=>g.game_id==='102');
  assert.equal(retained.observation_status,'retained');
  assert.equal(retained.observation_at,past);
  assert.equal(retained.viewer_count,999999);
  assert.equal(d.games.find(g=>g.game_id==='103').viewer_count,null);
  assert.equal(d.games.find(g=>g.game_id==='103').observation_at,null);
  assert.deepEqual(D.select(d.games,{sort:'median'}).map(g=>g.game_id),['101','102','103']);
});
test('fresh tracked measurement replaces duplicate candidate and historical copy without invalid-row warning', () => {
  const d = D.normalize(snapshot([candidate()],{tracked_games:[candidate({viewer_count:7800,tracking:entry('101'),observation_status:'current',observation_at:at})]}),registry({'101':entry('101',{last_observation:candidate({viewer_count:100000})})}));
  assert.equal(d.games.length,1);
  assert.equal(d.games[0].viewer_count,7800);
  assert.equal(d.games[0].observation_status,'current');
  assert.equal(d.invalidRows,0);
});
test('manual legacy recovery stays visible without converting sampled counts into metrics or history', () => {
  const id = '2106755390';
  const stored = entry(id, {game_name:'Graveyard Keeper II',enrollment:{source:'user_requested_legacy_recovery',qualification:'unverified',min_viewers:7000,legacy_sample:{observed_at:'2026-09-28T16:02:42Z',viewer_count:6542,streamer_count:5,scope:'partial_global_stream_sample'}}});
  const d = D.normalize(snapshot([]),registry({[id]:stored}));
  assert.equal(D.select(d.games,{filter:'signals'}).length,1);
  const game = d.games[0];
  assert.equal(game.observation_status,'retained');
  assert.equal(game.observation_at,null);
  assert.equal(game.viewer_count,null);
  assert.equal(game.streamer_count,null);
  assert.equal(game.filtered_audience.median_viewer_count,null);
  assert.equal(D.matches(game,'official'),false);
  assert.equal(D.matches(game,'igdb'),false);
  const rows = D.historyRows([{schema_version:1,date:'2026-09-29',timezone:'Asia/Taipei',hours:{'2026-09-29T10:00:00Z':{generated_at:'2026-09-29T10:05:00Z',games:[game]}}}],id,at);
  assert.equal(rows.filter(row=>row.status==='observed').length,0);
  assert.ok(rows.every(row=>row.viewer_count===null));
  const fresh = D.normalize(snapshot([],{tracked_games:[candidate({game_id:id,game_name:stored.game_name,viewer_count:1200,streamer_count:10,tracking:stored,observation_status:'current',observation_at:at})]}),registry({[id]:stored}));
  assert.equal(fresh.games[0].observation_status,'current');
  assert.equal(fresh.games[0].viewer_count,1200);
  assert.equal(fresh.games[0].tracking.enrollment.qualification,'unverified');
});
test('registry ends tracking at release plus 30 days, preserves undated games, and always excludes non-games', () => {
  const state = registry({
    '101':entry('101',{expires_at:at}),
    '102':entry('102',{status:'expired'}),
    '103':entry('103',{status:'excluded'}),
    '104':entry('104',{release_at:null,expires_at:null}),
    '105':entry('105'),
  });
  const d = D.normalize(snapshot([candidate({release_experiment:{igdb_first_release_date:forecast(true)}})],{excluded_games:[{game_id:'105',game_name:'Music',reason:'non_game_category'}]}),state);
  assert.deepEqual(d.games.map(g=>g.game_id),['104']);
  assert.equal(d.games[0].is_tracked,true);
  assert.deepEqual(d.excluded.map(g=>g.game_id),['105']);
});
test('latest registry state wins while old transient exclusions do not remove enrolled games', () => {
  const old = registry({'101':entry('101',{status:'expired'})},'2026-09-28T00:00:00Z');
  const current = registry({'101':entry('101',{last_observation:candidate()})});
  const d = D.normalize(snapshot([],{tracking_state:old,excluded_games:[{game_id:'101',reason:'observed_not_new'}]}),current);
  assert.equal(d.games.length,1);
  assert.equal(d.excluded.length,0);
  const fresh = D.normalize(snapshot([],{tracking_state:registry({'101':entry('101',{status:'expired'})},'2026-09-30T00:00:00Z')}),current);
  assert.equal(fresh.games.length,0);
  assert.equal(D.normalize(snapshot([]),{schema_version:1,updated_at:at,games:[]}).tracking_registry_invalid,true);
});
test('retained snapshots cannot create artificial hourly chart points', () => {
  const files=[{schema_version:1,date:'2026-09-29',timezone:'Asia/Taipei',hours:{
    '2026-09-29T10:00:00Z':{generated_at:'2026-09-29T10:05:00Z',games:[candidate({observation_status:'retained'})]},
    '2026-09-29T11:00:00Z':{generated_at:'2026-09-29T11:05:00Z',games:[candidate({observation_freshness:'stale'})]},
  }}];
  const rows=D.historyRows(files,'101',at);
  assert.equal(rows.find(r=>r.hour.includes('T10:')).viewer_count,null);
  assert.equal(rows.find(r=>r.hour.includes('T11:')).viewer_count,null);
  assert.equal(rows.filter(r=>r.status==='observed').length,0);
});

test('scheduled collections spanning an hour retain their actual collection-start bucket', () => {
  const file={schema_version:1,date:'2026-09-29',timezone:'Asia/Taipei',hours:{
    '2026-09-29T15:00:00Z':{collection_schedule:{observed_slot:'2026-09-29T15:00:00Z'},collection_started_at:'2026-09-29T15:55:00Z',generated_at:'2026-09-29T16:20:00Z',games:[candidate()]},
  }};
  const row=D.historyRows([file],'101','2026-09-29T16:25:00Z').find(r=>r.hour.includes('T15:'));
  assert.equal(row.status,'observed');
  assert.equal(row.viewer_count,7000);
  assert.equal(D.historyRows([file],'101','2026-09-29T16:05:00Z').find(r=>r.hour.includes('T15:')).status,'missing');
});

const steamGame = (overrides = {}) => ({ steam_appid:'4358690', display_name:'守墓人 2', name:'守墓人 2', name_en:'Graveyard Keeper 2', store_url:'https://store.steampowered.com/app/4358690/', followers:52000, release_at:'2026-09-25T00:00:00Z', release_date:'2026-09-25', expires_at:'2026-10-25T00:00:00Z', is_recent:true, tags:['Simulation','Adventure'], tag_labels_zh_tw:{Simulation:'模擬',Adventure:'冒險'}, ...overrides });
const steamMap = (games, updated_at = at) => ({ schema_version:1, updated_at, games });
const source = (kind, overrides = {}) => ({ source:kind, status:'active', release_at:'2026-09-25T00:00:00Z', expires_at:'2026-10-25T00:00:00Z', first_seen_at:at, ...overrides });

test('dual admission sources share one census while Steam-only releases bypass popularity and NEW evidence', () => {
  const s = steamGame(), tracked = entry('101',{tracking_sources:{twitch_new:source('twitch_new'), 'steam:4358690':source('steam_recent',{steam_appid:'4358690'})},steam_matches:[s]});
  const steamOnly = entry('102',{tracking_sources:{'steam:4358691':source('steam_recent',{steam_appid:'4358691'})},steam_matches:[steamGame({steam_appid:'4358691',display_name:'Steam 另一款'})]});
  const d = D.normalize(snapshot([candidate({tracking:tracked})],{tracked_games:[candidate({viewer_count:450,tracking:tracked}),candidate({game_id:'102',viewer_count:0,streamer_count:0,tracking:steamOnly,verification:{status:'not_new',observed_at:at},release_experiment:{igdb_first_release_date:forecast(false)}})]}),registry({'101':tracked,'102':steamOnly}));
  assert.equal(d.games.length,2);
  assert.equal(d.invalidRows,0);
  assert.equal(d.games[0].viewer_count,450);
  assert.deepEqual(D.select(d.games,{filter:'signals'}).map(g=>g.game_id),['101','102']);
  assert.deepEqual(D.select(d.games,{filter:'twitch_new'}).map(g=>g.game_id),['101']);
  assert.deepEqual(D.select(d.games,{filter:'steam_recent'}).map(g=>g.game_id),['101','102']);
  assert.equal(D.matches(d.games[1],'official'),false);
  assert.equal(D.matches(d.games[1],'igdb'),false);
});
test('each source expires independently and Steam release dates never replace IGDB first-release predictions', () => {
  const twitchOld = source('twitch_new',{status:'expired',release_at:'2026-08-01T00:00:00Z',expires_at:'2026-08-31T00:00:00Z'});
  const steamActive = source('steam_recent',{steam_appid:'4358690'});
  const sources = { twitch_new:twitchOld, 'steam:4358690':steamActive };
  const d = D.normalize(snapshot([],{tracked_games:[candidate({viewer_count:300,tracking:entry('101',{expires_at:'2026-08-31T00:00:00Z',tracking_sources:sources}),steam_matches:[steamGame()],release_experiment:{igdb_first_release_date:forecast(false,{release_at:'2026-08-01T00:00:00Z'})}})]}));
  assert.equal(d.games.length,1);
  assert.equal(D.matches(d.games[0],'twitch_new'),false);
  assert.equal(D.matches(d.games[0],'steam_recent'),true);
  assert.equal(d.games[0].release_experiment.igdb_first_release_date.release_at,'2026-08-01T00:00:00Z');
  assert.equal(d.games[0].release_experiment.igdb_first_release_date.predicted_new,false);
  const expiry = D.normalize(snapshot([], {tracked_games:[candidate({tracking:entry('101',{tracking_sources:{twitch_new:twitchOld,'steam:4358690':source('steam_recent',{expires_at:at})}})})]}));
  assert.equal(expiry.games.length,0);
  const unknownTwitch = D.normalize(snapshot([], {tracked_games:[candidate({viewer_count:0,tracking:entry('101',{tracking_sources:{twitch_new:source('twitch_new',{release_at:null,expires_at:null}),'steam:4358690':source('steam_recent',{status:'expired',expires_at:at})}})})]}));
  assert.equal(unknownTwitch.games.length,1);
  assert.equal(D.matches(unknownTwitch.games[0],'twitch_new'),true);
  assert.equal(D.matches(unknownTwitch.games[0],'steam_recent'),false);
});
test('Steam enrichment preserves Twitch artwork and all searchable names without admitting upcoming Steam-only games', () => {
  const cover = 'https://static-cdn.jtvnw.net/ttv-boxart/101-{width}x{height}.jpg';
  const metadata = steamGame({release_at:'2027-01-01T00:00:00Z',release_date:'2027-01-01',is_recent:false,box_art_url:'https://steam.example/cover.jpg'});
  const d = D.normalize(snapshot([candidate({game_name:'Graveyard Keeper II',box_art_url:cover,tracking:entry('101'),release_experiment:{igdb_first_release_date:forecast(true)}})]),registry({'101':entry('101')}),steamMap({'4358690':{status:'matched',twitch_game_id:'101',steam:metadata}}));
  const g = d.games[0];
  assert.equal(g.game_name,'守墓人 2');
  assert.equal(g.twitch_name,'Graveyard Keeper II');
  assert.match(g.box_art_url,/static-cdn\.jtvnw\.net.*144x192/);
  assert.equal(g.steam_matches[0].followers,52000);
  assert.equal(g.steam_matches[0].tag_labels_zh_tw.Simulation,'模擬');
  for (const query of ['守墓人','Graveyard Keeper II','Graveyard Keeper 2','４３５８６９０','Simulation']) assert.equal(D.select(d.games,{query}).length,1,query);
  assert.equal(D.matches(g,'steam_recent'),false);
  const futureOnly = D.normalize(snapshot([], {tracked_games:[candidate({viewer_count:400,tracking:entry('103',{tracking_sources:{'steam:4358690':source('steam_recent',{release_at:'2027-01-01T00:00:00Z'})}})})]}));
  assert.equal(futureOnly.games.length,0);
  assert.equal(D.normalize(snapshot([]),null,steamMap({'4358690':{status:'matched',twitch_game_id:'101',steam:steamGame()}})).games.length,0);
});
test('unmatched Steam releases stay pending with no fake Twitch rows or zero metrics; consoles remain independent', () => {
  const mapping = steamMap({
    '4358690':{status:'pending',steam:steamGame()},
    '4358691':{status:'ambiguous',twitch_game_id:'101',steam:steamGame({steam_appid:'4358691',display_name:'不可套用'})},
    '4358692':{status:'unmatched',steam:steamGame({steam_appid:'4358692',expires_at:at})},
    '4358693':{status:'unmatched',steam:steamGame({steam_appid:'4358693',release_at:'2027-01-01T00:00:00Z'})},
  });
  const d = D.normalize(snapshot([candidate({game_name:'Console Game',release_experiment:{igdb_first_release_date:forecast(true)}})]),null,mapping);
  assert.equal(d.games.length,1);
  assert.equal(d.games[0].game_name,'Console Game');
  assert.equal(d.games[0].steam_matches.length,0);
  assert.equal(D.matches(d.games[0],'twitch_new'),true);
  assert.equal(D.matches(d.games[0],'steam_recent'),false);
  assert.deepEqual(d.pending_steam.map(e=>e.steam.steam_appid),['4358690','4358691']);
  assert.ok(d.pending_steam.every(e=>!Object.hasOwn(e,'viewer_count')));
});
test('valid embedded mapping survives supplemental invalidity and chooses the newer mapping state', () => {
  const older = steamMap({'4358690':{status:'matched',twitch_game_id:'101',steam:steamGame({display_name:'舊名稱'})}},'2026-09-28T00:00:00Z');
  const newer = steamMap({'4358690':{status:'matched',twitch_game_id:'101',steam:steamGame()}});
  const d = D.normalize(snapshot([candidate()],{steam_mapping_state:newer}),null,older);
  assert.equal(d.games[0].game_name,'守墓人 2');
  const invalid = D.normalize(snapshot([candidate()],{steam_mapping_state:newer}),null,{schema_version:1,updated_at:at,games:[]});
  assert.equal(invalid.steam_mapping_invalid,true);
  assert.equal(invalid.games[0].game_name,'守墓人 2');
  assert.equal(D.normalize(snapshot([candidate()])).steam_mapping_invalid,false);
  const corruptRow = D.normalize(snapshot([candidate()],{steam_mapping_state:newer}),null,steamMap({'4358690':{status:'matched',steam:steamGame()}}));
  assert.equal(corruptRow.steam_mapping_invalid,true);
  assert.equal(corruptRow.games[0].game_name,'守墓人 2');
});

const onimusha = (overrides = {}) => candidate({game_id:'327598602',game_name:'Onimusha: Way of the Sword',igdb_id:'325602',...overrides});
const discoveryEntry = (overrides = {}) => ({twitch_game_id:'327598602',igdb_id:'325602',status:'matched',active:true,method:'twitch_igdb_external_steam_v1',checked_at:at,updated_at:at,steam_appids:['2638890'],links:[{external_game_id:'2969574',external_game_source:'1',uid:'2638890',game:'325602',steam_appid:'2638890',url:'https://store.steampowered.com/app/2638890/'}],public_steam_appids:[],missing_public_appids:['2638890'],...overrides});
const discoveryState = (row = discoveryEntry(), overrides = {}) => ({schema_version:1,updated_at:at,steam_source_id:'1',games:{'327598602':row},...overrides});

test('verified Onimusha store identity appears on current, tracked and retained rows without admitting it to the Steam catalog', () => {
  const tracked = entry('327598602',{last_observation:onimusha({viewer_count:1636})});
  const snapshots = [
    snapshot([onimusha()],{steam_discovery_state:discoveryState()}),
    snapshot([],{tracked_games:[onimusha({viewer_count:1636,tracking:tracked})],steam_discovery_state:discoveryState()}),
    snapshot([],{tracking_state:registry({'327598602':tracked}),steam_discovery_state:discoveryState()}),
  ];
  for (const payload of snapshots) {
    const d = D.normalize(payload), g = d.games[0];
    assert.equal(g.game_name,'Onimusha: Way of the Sword');
    assert.deepEqual(g.steam_matches,[]);
    assert.deepEqual(g.steam_store_links,[{steam_appid:'2638890',store_url:'https://store.steampowered.com/app/2638890/',igdb_id:'325602',checked_at:at,source:'twitch_igdb_external_steam_v1'}]);
    assert.deepEqual(D.steamStoreLinks(g),[{steam_appid:'2638890',store_url:'https://store.steampowered.com/app/2638890/'}]);
    assert.equal(D.matches(g,'steam_recent'),false);
    assert.deepEqual(D.select(d.games,{filter:'steam_recent'}),[]);
    assert.equal(D.select(d.games,{query:'２６３８８９０'}).length,1);
    assert.deepEqual(d.pending_steam,[]);
  }
});

test('discovery rejects broken ID chains, unsafe store URLs and stale or inactive identities', () => {
  const link = discoveryEntry().links[0];
  const invalidRows = [
    {status:'no_steam_link'}, {active:false}, {method:'name_similarity'}, {twitch_game_id:'101'}, {igdb_id:'325603'},
    {checked_at:null}, {checked_at:'2026-09-30T00:00:00Z'}, {updated_at:'not-a-date'}, {steam_appids:['02638890']},
    {links:[{...link,external_game_id:'0'}]}, {links:[{...link,external_game_source:'2'}]},
    {links:[{...link,game:'325603'}]}, {links:[{...link,uid:'2638891'}]},
    ...['javascript:alert(1)','https://store.steampowered.com.evil.test/app/2638890/','https://user@store.steampowered.com/app/2638890/','https://store.steampowered.com:443/app/2638890/','https://store.steampowered.com/app/2638890/?x=1','https://store.steampowered.com/app/2638890/#x','https://store.steampowered.com/app/02638890/'].map(url=>({links:[{...link,url}]})),
  ];
  for (const overrides of invalidRows) {
    const g = D.normalize(snapshot([onimusha()],{steam_discovery_state:discoveryState(discoveryEntry(overrides))})).games[0];
    assert.deepEqual(g.steam_store_links,[],JSON.stringify(overrides));
  }
  const changedCategory = D.normalize(snapshot([onimusha({igdb_id:'325603'})],{steam_discovery_state:discoveryState()})).games[0];
  assert.deepEqual(changedCategory.steam_store_links,[]);
  for (const state of [null,discoveryState(undefined,{schema_version:2}),discoveryState(undefined,{steam_source_id:'01'}),discoveryState(undefined,{games:[]})]) {
    assert.deepEqual(D.normalize(snapshot([onimusha()],{steam_discovery_state:state})).games[0].steam_store_links,[]);
  }
});

test('verified store links use the registry Steam source and deduplicate canonical app identities', () => {
  const link = {...discoveryEntry().links[0],external_game_source:'7'};
  const state = discoveryState(discoveryEntry({links:[link,link]}),{steam_source_id:'7'});
  const g = D.normalize(snapshot([onimusha()],{steam_discovery_state:state})).games[0];
  assert.equal(g.steam_store_links.length,1);
  assert.equal(D.steamStoreURL('02638890'),null);
  assert.equal(D.steamStoreURL('2638890?x=1'),null);
  assert.equal(D.steamStoreURL(2638890),'https://store.steampowered.com/app/2638890/');
});

test('public Steam metadata remains preferred and separate from identity-only links', () => {
  const metadata = steamGame({steam_appid:'2638890',display_name:'鬼武者：劍之道',name_en:'Onimusha',followers:12345,is_recent:false});
  const d = D.normalize(snapshot([onimusha()],{steam_discovery_state:discoveryState()}),null,steamMap({'2638890':{status:'matched',twitch_game_id:'327598602',steam:metadata}}));
  const g = d.games[0];
  assert.equal(g.game_name,'鬼武者：劍之道');
  assert.equal(g.twitch_name,'Onimusha: Way of the Sword');
  assert.equal(g.steam_matches.length,1);
  assert.equal(g.steam_matches[0].followers,12345);
  assert.deepEqual(g.steam_matches[0].tags,['Simulation','Adventure']);
  assert.equal(D.steamStoreLinks(g).length,1);
  assert.equal(D.matches(g,'steam_recent'),false);
});

test('a missing or nonmatched discovery never reuses injected or older identity links', () => {
  const raw = onimusha({steam_store_links:[{steam_appid:'2638890',store_url:'https://store.steampowered.com/app/2638890/'}]});
  for (const state of [undefined,discoveryState(discoveryEntry({status:'no_steam_link'}))]) {
    const g = D.normalize(snapshot([raw],{steam_discovery_state:state})).games[0];
    assert.deepEqual(g.steam_store_links,[]);
    assert.deepEqual(D.steamStoreLinks(g),[]);
  }
});

const publicOnimusha = (overrides = {}) => ({appid:2638890,name:'Onimusha: Way of the Sword',name_en:'Onimusha: Way of the Sword',display_name:'鬼武者 Way of the Sword',followers:812,follower_checked_at:at,steam_type:'game',sexual_content_screened:true,release_start:'2026-09-03',release_end:'2026-09-03',release_store_date:'2026-09-03',release_precision:'day',release_display_precision:'date_full',release_date_timezone:'Asia/Taipei',release_time_utc:'2026-09-04T04:02:14Z',release_timestamp_taipei_date:'2026-09-04',release_date_conflict:true,release_date_normalization:'steam_taiwan_store_date_authoritative',release_display_provider:'Steam Store appdetails cc=TW l=tchinese',release_date_verified_at:at,tags:['Action'],genres:['Action'],tag_labels_zh_tw:{Action:'動作'},twitch_admission:{schema_version:1,method:'twitch_igdb_external_steam_v1',appid:2638890,twitch_game_id:'327598602',igdb_id:'325602',checked_at:at,source_frontend_commit:'a'.repeat(40),source_enrollment:{source:'igdb_first_release_date',viewer_count:7200,min_viewers:7000,observed_at:'2026-09-25T00:00:00Z'}},...overrides});
const publicCatalog = (rows = [publicOnimusha()], overrides = {}) => ({version:3,generated_at:at,count:rows.length,games:rows,...overrides});

test('fresh public catalog enriches a verified reverse identity before forward mapping catches up, preserving every Twitch observation', () => {
  const payload=snapshot([onimusha({box_art_url:'https://static-cdn.jtvnw.net/ttv-boxart/327598602-144x192.jpg',filtered_audience:filtered()})],{steam_discovery_state:discoveryState()});
  const newerMapping=steamMap({},'2026-09-29T12:21:00Z');
  newerMapping.source_catalog={generated_at:'2026-09-29T12:00:00Z'};
  const before=D.normalize(payload,null,newerMapping),after=D.normalize(payload,null,newerMapping,publicCatalog());
  const g=after.games[0];
  assert.equal(g.game_name,'鬼武者 Way of the Sword');
  assert.equal(g.twitch_name,'Onimusha: Way of the Sword');
  assert.equal(g.steam_matches[0].followers,812);
  assert.deepEqual(g.steam_matches[0].tags,['Action']);
  assert.equal(g.steam_matches[0].tag_labels_zh_tw.Action,'動作');
  assert.equal(g.is_steam_recent,false);
  const originalFields=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['game_name','steam_matches'].includes(key)));
  assert.deepEqual(originalFields(g),originalFields(before.games[0]));
  for(const query of ['鬼武者','Onimusha: Way of the Sword','2638890','Action'])assert.equal(D.select(after.games,{query}).length,1,query);
  assert.deepEqual(D.select(after.games,{filter:'steam_recent'}),[]);
  assert.equal(after.games.length,before.games.length);
});

test('released catalog metadata still localizes retained Twitch observations after the Steam 30-day window, without enrolling a source', () => {
  const tracked=entry('327598602',{last_observation:onimusha({viewer_count:1636})});
  const payload=snapshot([],{generated_at:'2026-10-03T13:00:00Z',tracking_state:registry({'327598602':tracked}),steam_discovery_state:discoveryState()});
  const before=D.normalize(payload),after=D.normalize(payload,null,null,publicCatalog());
  assert.equal(after.games[0].game_name,'鬼武者 Way of the Sword');
  assert.equal(after.games[0].observation_status,'retained');
  assert.deepEqual(after.games[0].tracking,before.games[0].tracking);
  assert.deepEqual(after.games[0].active_tracking_sources,before.games[0].active_tracking_sources);
  assert.equal(after.games[0].is_steam_recent,false);
});

test('catalog joins only confirmed reverse IDs or a matched forward AppID, without name guessing or overriding newer catalog metadata', () => {
  const payload=snapshot([onimusha()]);
  assert.equal(D.normalize(payload,null,null,publicCatalog()).games[0].game_name,'Onimusha: Way of the Sword');
  const known=steamMap({'2638890':{status:'matched',twitch_game_id:'327598602',steam:steamGame({steam_appid:'2638890',display_name:'Older title'})}});
  assert.equal(D.normalize(payload,null,known,publicCatalog()).games[0].game_name,'鬼武者 Way of the Sword');
  known.source_catalog={generated_at:'2026-09-29T13:00:00Z'};
  assert.equal(D.normalize(payload,null,known,publicCatalog()).games[0].game_name,'Older title');
  const ambiguous=steamMap({'2638890':{status:'ambiguous',twitch_game_id:'327598602',steam:steamGame({steam_appid:'2638890'})}});
  assert.equal(D.normalize(payload,null,ambiguous,publicCatalog()).games[0].game_name,'Onimusha: Way of the Sword');
  const changedIGDB=onimusha({igdb_id:'325603'});
  assert.equal(D.normalize(snapshot([changedIGDB],{steam_discovery_state:discoveryState()}),null,null,publicCatalog()).games[0].game_name,'Onimusha: Way of the Sword');
});

test('malformed complete catalogs fail softly and cannot supply identity or localized names', () => {
  const payload=snapshot([onimusha()],{steam_discovery_state:discoveryState()});
  const bad=[publicCatalog(undefined,{version:1}),publicCatalog(undefined,{generated_at:'2026-09-29T12:20:00'}),publicCatalog(undefined,{count:2}),publicCatalog([publicOnimusha(),publicOnimusha()]),publicCatalog([publicOnimusha({appid:'02638890'})]),publicCatalog([publicOnimusha({appid:true})]),publicCatalog([publicOnimusha({appid:'9999999999999999'})])];
  for(const catalog of bad){
    const d=D.normalize(payload,null,null,catalog);
    assert.equal(d.public_catalog_invalid,true);
    assert.equal(d.games[0].game_name,'Onimusha: Way of the Sword');
    assert.deepEqual(d.games[0].steam_matches,[]);
    assert.equal(d.games[0].steam_store_links.length,1);
  }
});

test('catalog rows require the shared exact-date admission and reject bad type, adult screening and forged proof', () => {
  const payload=snapshot([onimusha()],{steam_discovery_state:discoveryState()});
  const raw=publicOnimusha();
  const bad=[{steam_type:'dlc'},{sexual_content_screened:false},{sexual_content_screened:'true'},{twitch_admission:null},{twitch_admission:{...raw.twitch_admission,appid:10}},{twitch_admission:{...raw.twitch_admission,twitch_game_id:'101'}},{twitch_admission:{...raw.twitch_admission,igdb_id:'325603'}},{release_date_conflict:false},{release_timestamp_taipei_date:'2026-09-03'},{release_display_provider:'Steam Store cc=US'},{follower_checked_at:null}];
  for(const fields of bad){
    const d=D.normalize(payload,null,null,publicCatalog([publicOnimusha(fields)]));
    assert.equal(d.games[0].game_name,'Onimusha: Way of the Sword',JSON.stringify(fields));
    assert.deepEqual(d.games[0].steam_matches,[],JSON.stringify(fields));
  }
});

test('catalog revision notices a metadata-only update with the same source generation date', () => {
  const payload=snapshot([onimusha()],{steam_discovery_state:discoveryState()});
  const before=D.normalize(payload,null,null,publicCatalog());
  const after=D.normalize(payload,null,null,publicCatalog([publicOnimusha({display_name:'鬼武者・劍之道'})]));
  assert.equal(before.public_catalog.generated_at,after.public_catalog.generated_at);
  assert.notEqual(before.public_catalog_revision,after.public_catalog_revision);
  assert.equal(after.games[0].game_name,'鬼武者・劍之道');
});

test('catalog name enrichment preserves a verified forward release window and keeps actual UTC diagnostic separate from the TW day', () => {
  const known=steamMap({'2638890':{status:'matched',twitch_game_id:'327598602',steam:steamGame({steam_appid:'2638890',display_name:'Older title',release_at:'2026-09-02T16:00:00Z',release_date:'2026-09-03',expires_at:'2026-10-02T16:00:00Z',is_recent:true})}});
  const payload=snapshot([onimusha()],{steam_discovery_state:discoveryState()});
  const before=D.normalize(payload,null,known),after=D.normalize(payload,null,known,publicCatalog());
  for(const key of ['release_at','release_date','expires_at','is_recent'])assert.equal(after.games[0].steam_matches[0][key],before.games[0].steam_matches[0][key],key);
  assert.equal(after.games[0].steam_matches[0].release_time_utc,'2026-09-04T04:02:14Z');
  assert.equal(after.games[0].steam_matches[0].release_timestamp_taipei_date,'2026-09-04');
  const first=D.normalize(payload,null,null,publicCatalog()).games[0];
  assert.equal(first.steam_matches[0].release_at,'2026-09-02T16:00:00.000Z');
  assert.equal(first.steam_matches[0].expires_at,'2026-10-02T16:00:00.000Z');
  assert.equal(first.steam_matches[0].release_date,'2026-09-03');
  assert.equal(first.steam_matches[0].release_time_utc,'2026-09-04T04:02:14Z');
  assert.equal(first.is_steam_recent,false);
});

test('newer canonical forward decisions cannot be overwritten by an older reverse identity or catalog proof', () => {
  const payload=snapshot([onimusha()],{steam_discovery_state:discoveryState()});
  const metadata=steamGame({steam_appid:'2638890'});
  const decisions=[{status:'matched',twitch_game_id:'101'}, {status:'matched',twitch_game_id:'327598602',igdb_id:'325603'}, {status:'ambiguous'}, {status:'unmatched',checked_at:'2026-09-29T12:21:00Z'}, {status:'pending',checked_at:at}];
  for(const decision of decisions){
    const known=steamMap({'2638890':{steam:metadata,...decision}});
    const g=D.normalize(payload,null,known,publicCatalog()).games[0];
    assert.notEqual(g.game_name,'鬼武者 Way of the Sword',JSON.stringify(decision));
  }
  const olderNegative=steamMap({'2638890':{status:'unmatched',checked_at:'2026-09-29T12:00:00Z',steam:metadata}});
  assert.equal(D.normalize(payload,null,olderNegative,publicCatalog()).games[0].game_name,'鬼武者 Way of the Sword');
  const noCurrentIGDB=snapshot([onimusha({igdb_id:undefined})]);
  const otherIdentity=steamMap({'2638890':{status:'matched',twitch_game_id:'327598602',igdb_id:'325603',steam:metadata}});
  assert.notEqual(D.normalize(noCurrentIGDB,null,otherIdentity,publicCatalog()).games[0].game_name,'鬼武者 Way of the Sword');
});

const witcher = (overrides = {}) => candidate({game_id:'1254042066',game_name:'The Witcher 3: Wild Hunt Remastered',igdb_id:'415005',...overrides});
const websiteIdentity = (overrides = {}) => ({method:'twitch_igdb_steam_website_v1',twitch_game_id:'1254042066',igdb_id:'415005',steam_appid:'292030',checked_at:at,website_links:[{website_id:'9421',game:'415005',steam_appid:'292030',source_url:'https://store.steampowered.com/app/292030/The_Witcher_3_Wild_Hunt/',url:'https://store.steampowered.com/app/292030/'}],steam_identity_metadata:{steam_appid:'292030',steam_type:'game',display_name:'巫師 3：狂獵',store_url:'https://store.steampowered.com/app/292030/',sexual_content_screened:true,content_descriptor_ids:[1,5],release_store_date:'2015-05-18',release_date_raw:'2015 年 5 月 18 日',raw_release_date:{coming_soon:false,date:'2015 年 5 月 18 日'},checked_at:at,provider:'Steam Store appdetails cc=TW l=tchinese'},...overrides});
const relatedEntry = (overrides = {}) => ({twitch_game_id:'1254042066',igdb_id:'415005',status:'no_steam_link',active:true,method:'twitch_igdb_external_steam_v1',checked_at:at,updated_at:at,steam_appids:[],links:[],related_steam_identity:websiteIdentity(),...overrides});
const relatedState = (row = relatedEntry()) => ({schema_version:1,updated_at:at,steam_source_id:'1',games:{'1254042066':row}});

test('official IGDB website identity supplies an old Steam Chinese name and link without pretending to be a direct chain or public catalog member', () => {
  const payload=snapshot([witcher({filtered_audience:filtered(),tracking:entry('1254042066')})],{steam_discovery_state:relatedState()});
  const before=D.normalize({...payload,steam_discovery_state:relatedState(relatedEntry({related_steam_identity:null}))}),after=D.normalize(payload),g=after.games[0];
  assert.equal(g.game_name,'巫師 3：狂獵');
  assert.equal(g.twitch_name,'The Witcher 3: Wild Hunt Remastered');
  assert.deepEqual(g.steam_matches,[]);
  assert.equal(g.steam_store_links[0].source,'twitch_igdb_steam_website_v1');
  assert.deepEqual(D.steamStoreLinks(g),[{steam_appid:'292030',store_url:'https://store.steampowered.com/app/292030/'}]);
  assert.equal(g.steam_identity_metadata[0].release_store_date,'2015-05-18');
  assert.equal(g.steam_identity_metadata[0].release_date_raw,'2015 年 5 月 18 日');
  assert.equal(g.is_steam_recent,false);
  assert.deepEqual(g.active_tracking_sources,before.games[0].active_tracking_sources);
  for(const key of ['game_id','igdb_id','viewer_count','streamer_count','filtered_audience','box_art_url','tracking','release_experiment'])assert.deepEqual(g[key],before.games[0][key],key);
  for(const query of ['巫師','Wild Hunt Remastered','292030'])assert.equal(D.select(after.games,{query,filter:'signals'}).length,1);
  assert.deepEqual(D.select(after.games,{filter:'steam_recent'}),[]);
});

test('related website identity rejects broken official IDs, unsafe URLs, stale proof and direct-method impersonation', () => {
  const proof=websiteIdentity(),link=proof.website_links[0];
  const invalid=[{method:'twitch_igdb_external_steam_v1'},{twitch_game_id:'101'},{igdb_id:'1942'},{steam_appid:'0292030'},{checked_at:null},{checked_at:'2026-09-29T12:21:00Z'},{website_links:[]},{website_links:[{...link,website_id:'0'}]},{website_links:[{...link,game:'1942'}]},{website_links:[{...link,steam_appid:'292031'}]},{website_links:[{...link,source_url:'https://store.steampowered.com/app/292031/'}]},{website_links:[{...link,source_url:'https://store.steampowered.com.evil.test/app/292030/'}]},{website_links:[{...link,url:'https://store.steampowered.com/app/292030/?x=1'}]}];
  for(const fields of invalid){const g=D.normalize(snapshot([witcher()],{steam_discovery_state:relatedState(relatedEntry({related_steam_identity:websiteIdentity(fields)}))})).games[0];assert.deepEqual(g.steam_store_links,[],JSON.stringify(fields));assert.equal(g.game_name,'The Witcher 3: Wild Hunt Remastered');}
  const mismatch=D.normalize(snapshot([witcher({igdb_id:'1942'})],{steam_discovery_state:relatedState()})).games[0];
  assert.deepEqual(mismatch.steam_store_links,[]);
  const direct=relatedEntry({status:'matched',steam_appids:['292030'],links:[{external_game_id:'12345',external_game_source:'1',uid:'292030',game:'1942',steam_appid:'292030',url:'https://store.steampowered.com/app/292030/'}],related_steam_identity:null});
  assert.deepEqual(D.normalize(snapshot([witcher()],{steam_discovery_state:relatedState(direct)})).games[0].steam_store_links,[]);
});

test('unverified identity-only Steam names cannot bypass type, content, provider or AppID screening', () => {
  const raw=websiteIdentity().steam_identity_metadata;
  const bad=[{steam_type:'dlc'},{sexual_content_screened:false},{content_descriptor_ids:[3]},{content_descriptor_ids:[4]},{content_descriptor_ids:['1']},{content_descriptor_ids:null},{provider:'Steam Store cc=US'},{steam_appid:'292031'},{store_url:'https://store.steampowered.com/app/292031/'},{checked_at:null},{checked_at:'2026-09-29T12:21:00Z'},{release_store_date:'2015-02-30'},{raw_release_date:{coming_soon:false,date:'2026 年 9 月 29 日'}},{display_name:''}];
  for(const fields of bad){const proof=websiteIdentity({steam_identity_metadata:{...raw,...fields}}),g=D.normalize(snapshot([witcher()],{steam_discovery_state:relatedState(relatedEntry({related_steam_identity:proof}))})).games[0];assert.deepEqual(g.steam_store_links,[],JSON.stringify(fields));assert.equal(g.steam_identity_metadata.length,0,JSON.stringify(fields));assert.equal(g.game_name,'The Witcher 3: Wild Hunt Remastered');assert.deepEqual(g.steam_matches,[]);assert.equal(g.is_steam_recent,false);}
  const ambiguous=websiteIdentity({steam_identity_metadata:{...raw,release_store_date:null,release_date_raw:'待宣布',raw_release_date:{coming_soon:true,date:'待宣布'}}});
  const g=D.normalize(snapshot([witcher()],{steam_discovery_state:relatedState(relatedEntry({related_steam_identity:ambiguous}))})).games[0];
  assert.equal(g.game_name,'巫師 3：狂獵');
  assert.equal(g.steam_identity_metadata[0].release_store_date,null);
  assert.equal(g.is_steam_recent,false);
});

test('missing Helix IGDB ID requires an exact official Twitch UID proof before direct Steam identity can be recovered', () => {
  const gid='1288749557',igdb='365465',appid='4019220';
  const row={twitch_game_id:gid,igdb_id:igdb,status:'matched',active:true,method:'twitch_igdb_external_steam_v1',checked_at:at,updated_at:at,steam_appids:[appid],links:[{external_game_id:'12345',external_game_source:'1',uid:appid,game:igdb,steam_appid:appid,url:`https://store.steampowered.com/app/${appid}/`}],igdb_identity:{method:'igdb_external_twitch_uid_v1',twitch_game_id:gid,igdb_id:igdb,twitch_source_id:'14',checked_at:at,links:[{external_game_id:'67890',external_game_source:'14',uid:gid,game:igdb}]}};
  const payload=snapshot([candidate({game_id:gid,game_name:'Dressmaker (2026)',igdb_id:null})],{steam_discovery_state:{schema_version:1,updated_at:at,steam_source_id:'1',twitch_source_id:'14',games:{[gid]:row}}});
  assert.equal(D.normalize(payload).games[0].steam_store_links[0].steam_appid,appid);
  for(const proof of [null,{...row.igdb_identity,method:'cached_name_match'},{...row.igdb_identity,igdb_id:'365466'},{...row.igdb_identity,twitch_game_id:'101'},{...row.igdb_identity,twitch_source_id:'1'},{...row.igdb_identity,checked_at:'2026-09-29T12:21:00Z'},{...row.igdb_identity,links:[{...row.igdb_identity.links[0],uid:'101'}]},{...row.igdb_identity,links:[row.igdb_identity.links[0],{...row.igdb_identity.links[0],game:'365466'}]}]){
    const bad=structuredClone(payload);bad.steam_discovery_state.games[gid].igdb_identity=proof;assert.deepEqual(D.normalize(bad).games[0].steam_store_links,[],JSON.stringify(proof));
  }
  for(const alter of [state=>delete state.twitch_source_id,state=>state.twitch_source_id='1',state=>state.games[gid].igdb_identity.links.push({...row.igdb_identity.links[0]}),state=>{state.games[gid].igdb_identity.twitch_source_id='1';state.games[gid].igdb_identity.links[0].external_game_source='1';},state=>state.games[gid].igdb_identity.links[0].external_game_id=67890,state=>state.updated_at='2999-09-29T12:21:00Z']){
    const bad=structuredClone(payload);alter(bad.steam_discovery_state);assert.deepEqual(D.normalize(bad).games[0].steam_store_links,[]);
  }
});

test('accepted public Steam metadata stays preferred over related identity-only names', () => {
  const payload=snapshot([witcher()],{steam_discovery_state:relatedState()});
  const known=steamMap({'292030':{status:'matched',twitch_game_id:'1254042066',steam:steamGame({steam_appid:'292030',display_name:'已收錄的官方名稱'})}});
  const g=D.normalize(payload,null,known).games[0];
  assert.equal(g.game_name,'已收錄的官方名稱');
  assert.equal(g.steam_identity_metadata[0].display_name,'巫師 3：狂獵');
});

test('website identity rejects forged evidence shape, duplicate IDs and noncanonical or unsafe source URLs', () => {
  const proof=websiteIdentity(),link=proof.website_links[0];
  const urls=['http://store.steampowered.com/app/292030/','https://store.steampowered.com:443/app/292030/','https://user@store.steampowered.com/app/292030/','https://store.steampowered.com/app/292030/?','https://store.steampowered.com/app/292030/#','https://store.steampowered.com/app/292030/game/extra','https://store.steampowered.com/app/292030/%57itcher','https://store.steampowered.com/app/292030/../292031/','https://store.steampowered.com\\app\\292030\\',' https://store.steampowered.com/app/292030/','https://store.steampowered.com/app/292030/\n'];
  const bad=[...urls.map(source_url=>({...proof,website_links:[{...link,source_url}]})),{...proof,steam_appid:292030},{...proof,extra_evidence:true},{...proof,website_links:[link,{...link}]},{...proof,website_links:[{...link,website_id:9421}]},{...proof,website_links:[{...link,unverified:true}]},{...proof,steam_identity_metadata:{...proof.steam_identity_metadata,checked_at:'2026-09-29T12:19:00Z'}},{...proof,steam_identity_metadata:{...proof.steam_identity_metadata,unverified:true}},{...proof,steam_identity_metadata:{...proof.steam_identity_metadata,content_descriptor_ids:[true]}}];
  for(const related_steam_identity of bad){
    const g=D.normalize(snapshot([witcher()],{steam_discovery_state:relatedState(relatedEntry({related_steam_identity}))})).games[0];
    assert.deepEqual(g.steam_store_links,[],JSON.stringify(related_steam_identity));
    assert.deepEqual(g.steam_identity_metadata,[]);
  }
  const future=relatedState();future.updated_at='2999-09-29T12:21:00Z';
  assert.deepEqual(D.normalize(snapshot([witcher()],{steam_discovery_state:future})).games[0].steam_store_links,[]);
});

test('identity store date must be the exact parsed official literal and supports the backend TW and English formats', () => {
  const raw=websiteIdentity().steam_identity_metadata;
  for(const release_date_raw of ['2015-05-18',' 2015 年5月18日 ','18 May 2015','May 18, 2015','18 May., 2015','May. 18 2015']){
    const metadata={...raw,release_date_raw,raw_release_date:{coming_soon:false,date:release_date_raw}};
    const g=D.normalize(snapshot([witcher()],{steam_discovery_state:relatedState(relatedEntry({related_steam_identity:websiteIdentity({steam_identity_metadata:metadata})}))})).games[0];
    assert.equal(g.game_name,'巫師 3：狂獵',release_date_raw);
    assert.equal(g.steam_identity_metadata[0].release_store_date,'2015-05-18');
  }
  for(const [release_date_raw,release_store_date] of [['2015 年 5 月 18 日','2026-09-29'],['2015 年 5 月 18 日',null],['2015-02-30','2015-02-30'],['18 Sept. 2015','2015-09-17'],['0000-05-18','0000-05-18'],['2015 年 5 月 18 日',undefined]]){
    const metadata={...raw,release_date_raw,release_store_date,raw_release_date:{coming_soon:false,date:release_date_raw}};
    const g=D.normalize(snapshot([witcher()],{steam_discovery_state:relatedState(relatedEntry({related_steam_identity:websiteIdentity({steam_identity_metadata:metadata})}))})).games[0];
    assert.deepEqual(g.steam_store_links,[],String(release_date_raw));
  }
  const metadata={...raw,content_descriptor_ids:[0,1,5],release_store_date:'2015-09-18',release_date_raw:'18 Sept. 2015',raw_release_date:{coming_soon:false,date:'18 Sept. 2015'}};
  const g=D.normalize(snapshot([witcher()],{steam_discovery_state:relatedState(relatedEntry({related_steam_identity:websiteIdentity({steam_identity_metadata:metadata})}))})).games[0];
  assert.equal(g.steam_identity_metadata[0].release_store_date,'2015-09-18');
  assert.equal(g.is_steam_recent,false);
});

test('related identity-only names and store links respect canonical forward conflicts and newer negative decisions', () => {
  const payload=snapshot([witcher()],{steam_discovery_state:relatedState()}),steam=steamGame({steam_appid:'292030',display_name:'Forward canonical name'});
  for(const decision of [{status:'matched',twitch_game_id:'101'},{status:'matched',twitch_game_id:'1254042066',igdb_id:'1942'},{status:'ambiguous'},{status:'unmatched',checked_at:at},{status:'pending',checked_at:'2026-09-29T12:21:00Z'}]){
    const g=D.normalize(payload,null,steamMap({'292030':{steam,...decision}})).games[0];
    assert.deepEqual(g.steam_store_links,[],JSON.stringify(decision));
    assert.deepEqual(g.steam_identity_metadata,[]);
    assert.notEqual(g.game_name,'巫師 3：狂獵');
    assert.equal(g.is_steam_recent,false);
  }
  const g=D.normalize(payload,null,steamMap({'292030':{status:'unmatched',checked_at:'2026-09-29T12:19:00Z',steam}})).games[0];
  assert.equal(g.game_name,'巫師 3：狂獵');
  assert.equal(g.steam_store_links.length,1);
});

test('a newer metadata-only identity refresh localizes the unchanged census without moving tracking or recent eligibility clocks', () => {
  const refreshed='2026-09-29T12:25:00Z',proof=websiteIdentity();
  proof.checked_at=refreshed;proof.steam_identity_metadata.checked_at=refreshed;
  const state=relatedState(relatedEntry({checked_at:refreshed,updated_at:refreshed,related_steam_identity:proof}));state.updated_at=refreshed;
  const tracked=entry('1254042066'),payload=snapshot([witcher({tracking:tracked,filtered_audience:filtered()})],{tracking_state:registry({'1254042066':tracked}),steam_discovery_state:state});
  const before=D.normalize({...payload,steam_discovery_state:null}),after=D.normalize(payload),g=after.games[0];
  assert.equal(g.game_name,'巫師 3：狂獵');
  assert.equal(g.steam_store_links[0].checked_at,refreshed);
  assert.equal(after.generated_at,before.generated_at);
  assert.equal(after.tracking_registry.updated_at,before.tracking_registry.updated_at);
  for(const key of ['viewer_count','streamer_count','filtered_audience','measurement_started_at','measurement_finished_at','tracking','active_tracking_sources','is_tracked','is_twitch_new','is_steam_recent','release_experiment'])assert.deepEqual(g[key],before.games[0][key],key);
  assert.equal(g.is_steam_recent,false);
});
