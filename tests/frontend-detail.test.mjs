import test from 'node:test';
import assert from 'node:assert/strict';
import { RadarData } from '../src/domain/index.mjs';
import { RadarInsights } from '../src/features/insights/metrics.js';
import { RadarDiscovery } from '../src/features/discovery/index.js';
import { createReleasePolicy } from '../src/features/detail/release-policy.js';
import { createDetailLoader } from '../src/features/detail/load.js';

const policy = createReleasePolicy({ D: RadarData, isNativeConsole: game => game?.source === 'nintendo' });

// Existing URLs and platform dates must continue to identify distinct release events.
test('detail release rows preserve the selected event and reject undated or unsupported releases', () => {
  const selected = { platform:'PS5', date:'2026-11-08', precision:'day', region:'asia', source:'IGDB' };
  const game = { source:'steam', date:'2026-11-08', platforms:['Steam','PS5'], releases:[
    { platform:'Steam', date:'2026-11-01', precision:'day', source:'Steam' },
    selected,
    { platform:'Xbox', date:'2026-11-08', precision:'day', source:'IGDB' },
    { platform:'PS5', date:'2026-11-30', precision:'month', source:'IGDB' },
    { platform:'PS5', date:'2026-02-30', precision:'day', source:'IGDB' },
    { ...selected },
  ] };
  const rows = policy.detailReleaseRows(game);
  assert.equal(rows.length, 2);
  assert.equal(rows[0], selected);
  assert.equal(rows[1].platform, 'Steam');
});

test('calendar-only IGDB release stays a calendar day without an invented unlock time', () => {
  const row = { platform:'PS5', source:'IGDB', date:'2026-11-08', source_date:'2026-11-08',
    date_basis:'igdb_calendar_day', region:'worldwide', precision:'day' };
  const p = createReleasePolicy({ D:{...RadarData, nativeReleaseAudited:()=>true}, isNativeConsole:()=>true });
  assert.equal(p.unifiedIGDBRelease(row), true);
  assert.equal(p.officialReleaseClock(row), null);
  assert.match(p.releaseDateNote(row), /僅提供年月日/);
  assert.equal(row.date, '2026-11-08');
});

test('detail public links reject credential URLs and unexpected hosts', () => {
  assert.equal(policy.publicSourceURL('https://user:pass@www.igdb.com/games/game'), '');
  assert.equal(policy.publicSourceURL('javascript:alert(1)'), '');
  assert.equal(policy.publicSourceURL('https://www.igdb.com.evil.test/games/game'), '');
  assert.equal(policy.publicSourceURL('https://www.igdb.com/games/game'), 'https://www.igdb.com/games/game');
});

test('history metric keeps missing and measured zero separate and uses Taipei observation days', () => {
  const history = [
    {at:'2026-10-01T16:30:00Z',followers:0,source:'steam_community'},
    {at:'2026-10-08T16:30:00Z',followers:5,source:'steam_community'},
  ];
  const measured = RadarInsights.metric(history, 7, '2026-10-09');
  assert.equal(measured.status, 'ready');
  assert.equal(measured.delta, 5);
  assert.equal(measured.percent, null);
  assert.equal(RadarInsights.metric(history.slice(1), 7, '2026-10-09').status, 'accumulating');
  assert.equal(RadarInsights.metric([], 7, '2026-10-09').status, 'missing');
});

test('discovery honors explicit empty primary metadata over stale preview tags', () => {
  const game = {appid:42,name:'Game',source:'steam',tags:[],genres:[]};
  const enriched = RadarDiscovery.enrich({games:[game],recent:[]},
    {games:[{appid:42,tags:[],genres:[]}]},
    {games:[{appid:42,tags:['RPG'],genres:['Adventure']}]});
  assert.deepEqual(enriched.games[0].tags, []);
  assert.deepEqual(enriched.games[0].genres, []);
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve=yes; reject=no; });
  return {promise, resolve, reject};
};
const tick = () => new Promise(resolve => setImmediate(resolve));
function loaderFixture(storage) {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, {hidden:false, textContent:'', href:''});
    return elements.get(id);
  };
  const renders = [];
  const ctx = { $, storage, D:{
    validDate:RadarData.validDate,
    datasets:(catalog)=>catalog ? {games:catalog.games.map(row=>({...row,date:row.release_start})),recent:[]} : null,
  }, R:{enrich:data=>data}, document:{referrer:''}, window:{},
    location:{origin:'https://radar.test',href:'https://radar.test/game.html?appid=42'},
    today:'2026-10-08',appid:42,igdbId:null,requestedDate:null,nintendoRoute:false };
  const loader = createDetailLoader(ctx, (game,data,pending)=>renders.push({game,data,pending}),
    {updateSaveControls(){}}, {showMessage(){}});
  return {ctx, loader, renders, elements};
}
const raw = name => ({appid:42,name,release_start:'2026-11-08',content_enriched_at:'2026-10-08T09:00:00Z'});

test('detail shows the known Steam hero before the catalog and optional console request settle', async () => {
  const sources=deferred(), native=deferred();
  const f=loaderFixture({loadGame:async()=>raw('Hero'),loadSources:()=>sources.promise,loadNintendo:()=>native.promise});
  const done=f.loader.load();
  await tick();
  assert.equal(f.renders[0].game.name,'Hero');
  assert.equal(f.renders[0].pending,true);
  sources.resolve({catalog:{games:[raw('Hero')]},preview:null});
  native.reject(new Error('Optional source offline'));
  await done;
  assert.equal(f.renders.at(-1).pending,false);
  assert.equal(f.elements.get('detailStatus')?.hidden ?? true,true);
});

test('a retry generation discards late results from the superseded request', async () => {
  const oldGame=deferred();
  let calls=0;
  const f=loaderFixture({loadGame:()=>++calls===1?oldGame.promise:Promise.resolve(raw('New')),
    loadSources:async()=>({catalog:null,preview:null}),loadNintendo:async()=>null});
  const first=f.loader.load();
  await tick();
  await f.loader.load(true);
  oldGame.resolve(raw('Old'));
  await first;
  assert.equal(f.renders.at(-1).game.name,'New');
  assert.equal(f.renders.some(row=>row.game.name==='Old'),false);
});

test('disposed detail does not render late responses or an obsolete error state', async () => {
  const game=deferred();
  const f=loaderFixture({loadGame:()=>game.promise,loadSources:async()=>({catalog:null,preview:null}),loadNintendo:async()=>null});
  const done=f.loader.load();
  f.ctx.disposed=true;
  game.resolve(raw('Late'));
  await done;
  assert.equal(f.renders.length,0);
  assert.equal(f.elements.has('detailStatus'),false);
});

test('late authoritative catalog controls release dates over an unversioned direct record', async () => {
  const source=deferred();
  const f=loaderFixture({loadGame:async()=>raw('Old'),loadSources:()=>source.promise,loadNintendo:async()=>null});
  const done=f.loader.load();
  await tick();
  assert.equal(f.renders.at(-1).game.date,'2026-11-08');
  source.resolve({catalog:{games:[{...raw('Current'),release_start:'2026-11-09'}]},preview:null});
  await done;
  assert.equal(f.renders.at(-1).game.date,'2026-11-09');
  assert.equal(f.renders.at(-1).game.name,'Current');
});

test('late catalog exclusion hides a previously displayed old direct record', async () => {
  const source=deferred();
  const f=loaderFixture({loadGame:async()=>raw('Removed'),loadSources:()=>source.promise,loadNintendo:async()=>null});
  const done=f.loader.load();
  await tick();
  const provisionalRenders=f.renders.length;
  assert.ok(provisionalRenders>0);
  source.resolve({catalog:{games:[]},preview:null});
  await done;
  assert.equal(f.renders.length,provisionalRenders);
  assert.equal(f.elements.get('detailPage').hidden,true);
  assert.equal(f.elements.get('detailStatus').hidden,false);
  assert.match(f.elements.get('detailStatusTitle').textContent,/公開清單/);
});
