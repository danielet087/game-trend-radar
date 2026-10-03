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
  assert.match(html,/<option value="median" selected>篩選後中位數（萬人→40 台優先）<\/option>/);
});


test('10,000 total viewers is inclusive and takes priority over streamer count', () => {
  assert.equal(D.VIEWER_PRIORITY_THRESHOLD,10000);
  const rows = [row(1,300,900,{viewer_count:9999}),row(2,1,10,{viewer_count:10000})];
  assert.deepEqual(ids(rows),['2','1']);
  assert.deepEqual(ids(rows,{sort:'median'}),['2','1']);
});

test('four priority groups are ordered by viewer threshold then streamer threshold', () => {
  const rows = [
    row(4,39,900,{viewer_count:9999}),
    row(3,40,800,{viewer_count:9999}),
    row(2,39,100,{viewer_count:10000}),
    row(1,40,50,{viewer_count:10000}),
    row(5,90,60,{viewer_count:20000}),
    row(6,15,200,{viewer_count:11000}),
    row(7,45,850,{viewer_count:9500}),
    row(8,10,950,{viewer_count:9500}),
  ];
  assert.deepEqual(ids(rows),['5','1','6','2','7','3','8','4']);
});

test('viewer priority uses the total, not the filtered audience viewer count', () => {
  const rows = [
    row(1,40,100,{viewer_count:9999,filtered_audience:{median_viewer_count:100,eligible_viewer_count:9999}}),
    row(2,40,50,{viewer_count:10000,filtered_audience:{median_viewer_count:50,eligible_viewer_count:50}}),
  ];
  assert.deepEqual(ids(rows),['2','1']);
});

test('missing viewer totals do not become zero or qualify for viewer priority', () => {
  const rows = [row(1,100,900,{viewer_count:null}),row(2,1,10,{viewer_count:10000})];
  assert.deepEqual(ids(rows),['2','1']);
  assert.equal(rows[0].viewer_count,null);
});

test('a missing median remains within its viewer/streamer group', () => {
  const rows = [
    row(1,40,null,{viewer_count:10000}),row(2,40,10,{viewer_count:10000}),
    row(3,39,900,{viewer_count:10000}),row(4,400,900,{viewer_count:9999}),
  ];
  assert.deepEqual(ids(rows),['2','1','3','4']);
  assert.equal(rows[0].filtered_audience.median_viewer_count,null);
});

test('retained data cannot jump ahead using either threshold', () => {
  const rows = [row(1,500,9000,{viewer_count:999999,observation_status:'retained'}),row(2,1,10,{viewer_count:100})];
  for (const sort of ['median','viewers','streamers']) assert.deepEqual(ids(rows,{sort}),['2','1']);
});

test('threshold groups do not change explicit total-viewer or total-streamer sorting', () => {
  const rows = [row(1,500,900,{viewer_count:9999}),row(2,10,50,{viewer_count:10000}),row(3,40,20,{viewer_count:50000})];
  assert.deepEqual(ids(rows,{sort:'median'}),['3','2','1']);
  assert.deepEqual(ids(rows,{sort:'viewers'}),['3','2','1']);
  assert.deepEqual(ids(rows,{sort:'streamers'}),['1','3','2']);
});

test('HTML refreshes the data asset and describes both inclusive thresholds', () => {
  const html = fs.readFileSync(path.join(__dirname,'../twitch.html'),'utf8');
  assert.match(html,/radar-twitch-data-v1\.js\?v=1\.4\.1/);
  assert.match(html,/總觀眾 ≥ 10,000 人優先，再總開台 ≥ 40 台優先/);
});
