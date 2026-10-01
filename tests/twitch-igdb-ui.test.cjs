const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const ui = read('assets/radar-twitch-v1.js');
const html = read('twitch.html');

test('IGDB is the only rendered release-date signal and evidence source', () => {
  assert.match(ui,/const IGDB_SOURCE = "igdb_first_release_date"/);
  assert.match(ui,/predictionBadge\(g\.release_experiment\[IGDB_SOURCE\]\)/);
  assert.match(ui,/g\.release_experiment\[IGDB_SOURCE\], card/);
  assert.doesNotMatch(ui,/officialBadge|audienceDetails|twitchDateGuide|sourceNames|D\.SOURCES|reference_checks/);
  assert.doesNotMatch(ui + html,/中位數納入條件|官方全新觀測|Twitch 日期|三種線索/);
});

test('removed filters have no UI entry and old URLs are normalized', () => {
  assert.doesNotMatch(html,/data-filter="(?:official|twitch|pending)"/);
  assert.match(html,/data-filter="igdb"/);
  assert.match(ui,/if \(p\.has\("state"\) && !Object\.hasOwn\(filterNames,p\.get\("state"\)\)\) syncURL\(\)/);
});

test('history, median metrics and single-column IGDB styles are retained', () => {
  assert.match(ui,/body\.append\(historyPanel\(g\)\)/);
  assert.match(ui,/g\.filtered_audience\.median_viewer_count/);
  assert.match(ui,/body\.append\(evidence\(g\)\)/);
  assert.match(html,/radar-twitch-v1\.js\?v=\d+\.\d+\.\d+/);
  assert.match(html,/radar-twitch-igdb-v1\.css/);
  assert.match(read('assets/radar-twitch-igdb-v1.css'),/grid-template-columns:minmax\(0,1fr\)/);
});
