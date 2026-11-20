import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRadarStorage } from '../src/data/storage.ts';
import { validCatalog, validNintendo } from '../src/data/contracts.ts';

const catalog = { version:3, revision:'current', generated_at:'2026-10-08T09:00:00Z', count:1, games:[{appid:123}] };
function boot(routes = {}, shared = new Map(), clock = { at:1_000 }) {
  const calls = [];
  const api = createRadarStorage({
    now: () => clock.at,
    sessionStorage: { getItem:key => shared.get(key) ?? null, setItem:(key,value) => shared.set(key,value) },
    fetch: async (url, options) => {
      calls.push({url,options});
      const filename = url.split('/data/')[1].split('?')[0];
      const value = typeof routes[filename] === 'function' ? routes[filename](url) : routes[filename];
      return { ok:value !== undefined, status:value !== undefined ? 200 : 404, json:async () => value };
    },
  });
  return { api, calls, clock, shared };
}
const catalogCalls = calls => calls.filter(call => !call.url.includes('steam_references') && !call.url.includes('followers'));
test('one complete catalog skips preview and preserves publication metadata across cached page loads', async () => {
  const shared = new Map(), first = boot({'catalog.json':catalog},shared);
  const result = await first.api.loadSources();
  assert.equal(result.catalogResult.status,'fresh');
  assert.equal(result.catalogResult.lastUpdated,catalog.generated_at);
  assert.equal(result.catalogResult.revision,'current');
  assert.equal(result.catalogResult.source,'./data/catalog.json');
  assert.equal(result.preview,null); assert.equal(catalogCalls(first.calls).length,1);
  assert.equal(first.calls[0].options.cache,'no-cache');
  // No published Steam references is an ordinary state, not an error.
  assert.equal(result.references,null);
  const second = boot({},shared);
  assert.equal((await second.api.loadSources()).catalogResult.status,'cached');
  assert.equal(catalogCalls(second.calls).length,0);
  await first.api.loadSources({force:true}); assert.equal(catalogCalls(first.calls).length,2);
});
test('the Steam versions of console games load beside the catalog when they are valid', async () => {
  const references = {schema_version:1, generated_at:'2026-11-19T02:00:00Z', games:[{appid:500}]};
  const {api} = boot({'catalog.json':catalog, 'steam_references.json':references});
  assert.deepEqual((await api.loadSources()).references, references);
  const invalid = boot({'catalog.json':catalog, 'steam_references.json':{schema_version:2, games:[]}});
  assert.equal((await invalid.api.loadSources()).references, null);
});
test('the latest official counts load beside the catalog; a missing or invalid file changes nothing', async () => {
  const followers = {schema_version:1, as_of:'2026-11-20T03:00:00Z', games:{'123':[6200, '2026-11-20T03:00:00Z']}};
  const {api} = boot({'catalog.json':catalog, 'followers.json':followers});
  const result = await api.loadSources();
  assert.deepEqual(result.followers, followers);
  assert.equal(result.catalogResult.status, 'fresh');
  for (const value of [undefined, {schema_version:2, games:{}}, {schema_version:1, games:[]}]) {
    const other = boot({'catalog.json':catalog, ...(value ? {'followers.json':value} : {})});
    const loaded = await other.api.loadSources();
    assert.equal(loaded.followers, null);
    assert.equal(loaded.catalogResult.status, 'fresh');
  }
});
test('concurrent requests deduplicate transport while each caller still validates the JSON', async () => {
  const {api,calls} = boot({'catalog.json':{...catalog,count:2},'steam_upcoming.json':{...catalog,version:2}});
  const [a,b] = await Promise.all([api.loadCatalog(),api.loadCatalog()]);
  assert.equal(a.version,2); assert.equal(b.count,1);
  assert.equal(calls.filter(call => call.url==='./data/catalog.json').length,1);
  const strict = await api.readJSON('catalog.json',validCatalog);
  assert.equal(strict,null);
});
test('unavailable updates retain validated stale snapshots and retain their source time', async () => {
  const routes = {'catalog.json':catalog}, {api,clock,calls} = boot(routes);
  await api.loadCatalog(); clock.at += 60_000; delete routes['catalog.json'];
  const old = await api.loadCatalogResult();
  assert.equal(old.status,'stale'); assert.equal(old.lastUpdated,catalog.generated_at);
  assert.equal(old.fetchedAt,1_000); assert.equal(old.source,'./data/catalog.json');
  assert.equal(calls.length,3);
  assert.equal((await api.readJSONResult('catalog.json',validCatalog,{allowStale:false})).data,null);
});
test('declared catalog revision rejects an old cached game and asks for it past the CDN cache', async () => {
  const routes = {'catalog.json':catalog,'games/123.json':{appid:123,revision:'old'}};
  const {api,clock,calls} = boot(routes);
  await api.loadGame(123); await api.loadCatalog();
  // An edge copy cached before the newest deploy is older than the catalog.
  routes['games/123.json'] = url => ({appid:123, revision:url.includes('?r=') ? 'current' : 'old'});
  const game = await api.loadGameResult(123);
  assert.equal(game.revision,'current'); assert.equal(game.status,'fresh');
  assert.equal(game.source,'./data/games/123.json?r=current');
  routes['games/123.json'] = {appid:123,revision:'old'};
  clock.at += 60_000;
  const rejected = await api.loadGameResult(123,{allowStale:false});
  assert.equal(rejected.data,null); assert.equal(rejected.error,'revision_mismatch');
  // Data is no longer read from Git.
  assert.ok(calls.every(call => call.url.startsWith('./data/')));
});
test('existing game records without revision remain valid against revisioned catalogs', async () => {
  const {api} = boot({'catalog.json':catalog,'games/123.json':{appid:123,description_checked_at:'2026-10-08T08:00:00Z'}});
  await api.loadCatalog();
  assert.equal((await api.loadGame(123)).appid,123);
});
test('partial duplicate or mismatched revision shards cannot claim a complete catalog', async () => {
  const index = {version:2,catalog_revision:'current',months:['2026-09','2026-10'],game_count:2};
  const routes = {'index.json':index,'calendar/2026-09.json':{revision:'current',count:1,games:[{appid:123}]},'calendar/2026-10.json':{revision:'current',count:1,games:[{appid:123}]}};
  assert.equal(await boot(routes).api.loadCatalog(),null);
  routes['calendar/2026-10.json'] = {revision:'old',count:1,games:[{appid:456}]};
  assert.equal(await boot(routes).api.loadCatalog(),null);
  delete routes['calendar/2026-10.json'];
  assert.equal(await boot(routes).api.loadCatalog(),null);
});
test('invalid paths and IDs cannot fetch; Nintendo rejects duplicate or incompatible identities', async () => {
  const {api,calls} = boot();
  assert.equal(await api.loadGame(-1),null); assert.equal(await api.readJSON('../secrets.json'),null);
  assert.equal(await api.readJSON('https://evil.example/test.json'),null); assert.equal(calls.length,0);
  const game = {id:'igdb:123',igdb_id:123};
  assert.equal(validNintendo({schema_version:1,games:[game]}),true);
  assert.equal(validNintendo({schema_version:1,games:[game,game]}),false);
  assert.equal(validNintendo({schema_version:1,games:[{...game,igdb_id:456}]}),false);
});
test('timeouts cancel requests and allow fallback without inventing data', async () => {
  let aborted = 0;
  const api = createRadarStorage({timeoutMs:2,fetch:async (url,{signal}) => new Promise((resolve,reject) => {
    signal.addEventListener('abort',() => {aborted++;reject(new Error('aborted'));},{once:true});
  })});
  const result = await api.readJSONResult('catalog.json',validCatalog);
  assert.equal(aborted,2); assert.equal(result.data,null); assert.equal(result.status,'unavailable');
});
