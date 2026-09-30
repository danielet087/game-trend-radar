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
    candidate({game_id:'102',filtered_audience:filtered()}),
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
