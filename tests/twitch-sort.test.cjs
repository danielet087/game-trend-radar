const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../assets/radar-twitch-data-v1.js');
const row = (id, streamers, median, extra = {}) => ({
  game_id:String(id), game_name:`Game ${id}`, is_tracked:true,
  observation_status:'current', streamer_count:streamers, viewer_count:10000,
  verification:{status:'pending'},
  release_experiment:Object.fromEntries(D.SOURCES.map(source=>[source,{predicted_new:null}])),
  filtered_audience:{median_viewer_count:median,eligible_streamer_count:1}, ...extra,
});
const ids = (rows, options) => D.select(rows, options).map(g => g.game_id);

test('default is filtered median with an inclusive total-streamer threshold of 40', () => {
  assert.equal(D.DEFAULT_SORT,'median');
  assert.equal(D.STREAMER_PRIORITY_THRESHOLD,40);
  const rows = [row(1,39,900),row(2,40,50),row(3,80,80),row(4,12,600),row(5,41,60)];
  assert.deepEqual(ids(rows),['3','5','2','1','4']);
  assert.deepEqual(ids(rows,{sort:'median'}),['3','5','2','1','4']);
});

test('within each group median wins over total viewers and total streamers', () => {
  const rows = [row(1,400,50,{viewer_count:900000}),row(2,40,60),row(3,39,100),row(4,1,200)];
  assert.deepEqual(ids(rows),['2','1','4','3']);
});

test('grouping uses total streamers, not eligible median sample size', () => {
  const rows = [row(1,39,900,{filtered_audience:{median_viewer_count:900,eligible_streamer_count:39}}),row(2,40,10)];
  assert.deepEqual(ids(rows),['2','1']);
});

test('missing medians go last within their group without becoming zero', () => {
  const rows = [row(1,40,null),row(2,41,30),row(3,39,900),row(4,0,null),row(5,null,20)];
  assert.deepEqual(ids(rows),['2','1','3','5','4']);
  assert.equal(rows[0].filtered_audience.median_viewer_count,null);
  assert.equal(rows[4].streamer_count,null);
});

test('saved observations remain below current rows regardless of old metrics', () => {
  const rows = [row(1,500,9000,{observation_status:'retained'}),row(2,2,10),row(3,40,20)];
  assert.deepEqual(ids(rows),['3','2','1']);
});

test('explicit viewer and streamer modes preserve their original ordering', () => {
  const rows = [row(1,39,900,{viewer_count:100000}),row(2,40,50,{viewer_count:20000}),row(3,80,80,{viewer_count:10000})];
  assert.deepEqual(ids(rows,{sort:'viewers'}),['1','2','3']);
  assert.deepEqual(ids(rows,{sort:'streamers'}),['3','2','1']);
});

test('ties are deterministic; source filtering, search and input order are preserved', () => {
  const rows = [row(3,40,50,{viewer_count:12000}),row(2,80,50),row(1,40,50),row(4,50,90,{is_tracked:false})];
  const before = rows.map(g=>g.game_id);
  assert.deepEqual(ids(rows,{filter:'signals'}),['3','1','2']);
  assert.deepEqual(ids(rows,{query:'Ｇａｍｅ ２'}),['2']);
  assert.deepEqual(rows.map(g=>g.game_id),before);
});

test('UI defaults, URL fallback, reset and HTML selection use the new default', () => {
  const ui = fs.readFileSync(path.join(__dirname,'../assets/radar-twitch-v1.js'),'utf8');
  const html = fs.readFileSync(path.join(__dirname,'../twitch.html'),'utf8');
  assert.match(ui,/sort:D\.DEFAULT_SORT/);
  assert.match(ui,/p\.get\("sort"\) : D\.DEFAULT_SORT/);
  assert.match(ui,/\["sort",state\.sort,D\.DEFAULT_SORT\]/);
  assert.match(ui,/state\.sort = D\.DEFAULT_SORT/);
  assert.match(ui,/\$\("gameSort"\)\.value = D\.DEFAULT_SORT/);
  assert.match(ui,/state\.sort === D\.DEFAULT_SORT/);
  assert.match(html,/<option value="median" selected>篩選後中位數（≥40 台優先）<\/option>/);
});
