const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../assets/radar-twitch-data-v1.js');
const at = '2026-09-29T12:20:00Z';
const forecast = (result, overrides = {}) => ({ status:'evaluated', predicted_new:result, evaluated_at:at, release_at:'2026-09-25T00:00:00Z', metadata_observed_at:at, ...overrides });
const candidate = (overrides = {}) => ({ game_id:'101', game_name:'Test Game', viewer_count:7000, streamer_count:21, median_viewer_count:0, verification:{status:'pending'}, ...overrides });
const snapshot = (rows, overrides = {}) => ({ schema_version:2, generated_at:at, min_viewers:7000, coverage:{collection_complete:true}, candidate_games:rows, ...overrides });

test('uses the complete candidate list, preserving pending and exact-threshold rows', () => {
  const d = D.normalize(snapshot([candidate(),candidate({game_id:'102',viewer_count:6999})],{top_games:[]}));
  assert.equal(d.games.length,1);
  assert.equal(d.games[0].verification.status,'pending');
  assert.equal(d.games[0].median_viewer_count,0);
  assert.equal(D.matches(d.games[0],'official'),false);
});
test('keeps legacy totals labelled as samples and never derives their median or NEW status', () => {
  const d = D.normalize({generated_at:at,top_games:[candidate({median_viewer_count:100,verification:{status:'new',observed_at:at},release_experiment:{igdb_first_release_date:forecast(true)}})]});
  assert.equal(d.legacy,true);
  assert.equal(d.games[0].median_viewer_count,null);
  assert.equal(d.games[0].verification.status,'pending');
  assert.equal(d.games[0].release_experiment.igdb_first_release_date.predicted_new,null);
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
test('expired or incomplete predictions and undated badge claims remain unknown', () => {
  const g = D.normalize(snapshot([candidate({verification:{status:'new'},release_experiment:{twitch_original_release_date:forecast(true,{status:'unknown'}),igdb_first_release_date:forecast(true,{release_at:null})}})])).games[0];
  assert.equal(g.verification.status,'pending');
  assert.equal(g.release_experiment.twitch_original_release_date.predicted_new,null);
  assert.equal(g.release_experiment.igdb_first_release_date.predicted_new,null);
});
test('unknown medians sort after real zero and fractional values; search supports IDs', () => {
  const d = D.normalize(snapshot([candidate(),candidate({game_id:'102',median_viewer_count:null}),candidate({game_id:'103',median_viewer_count:2.5})]));
  assert.deepEqual(D.select(d.games,{sort:'median'}).map(g=>g.game_id),['103','101','102']);
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
