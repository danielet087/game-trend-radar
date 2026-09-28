const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const code = fs.readFileSync(require('node:path').join(__dirname, '../assets/radar-storage-v2.js'), 'utf8');
function boot(routes, shared = new Map()) {
  const calls = [];
  const context = { AbortController, setTimeout, clearTimeout, URL, console, Date,
    sessionStorage: { getItem:k=>shared.get(k), setItem:(k,v)=>shared.set(k,v) },
    fetch: async (url, options) => {
      calls.push({url,options}); const key=url.split('/data/')[1];
      return {ok: Object.hasOwn(routes,key), json: async()=>routes[key]};
    },
  };
  vm.createContext(context); vm.runInContext(code, context);
  return {api:context.RadarStorage,calls};
}
const catalog = {version:3,count:1,games:[{appid:123}]};
test('complete catalog takes one request, skips old preview and caches across page loads', async()=>{
  const shared=new Map(), first=boot({'catalog.json':catalog},shared);
  const data=await first.api.loadSources();
  assert.equal(data.catalog.count,1);assert.equal(data.preview,null);assert.equal(first.calls.length,1);
  assert.equal(first.calls[0].url,'./data/catalog.json');assert.equal(first.calls[0].options.cache,'no-cache');
  const second=boot({},shared);assert.equal((await second.api.loadSources()).catalog.count,1);assert.equal(second.calls.length,0);
  await first.api.loadSources({force:true});assert.equal(first.calls.length,2);
});
test('concurrent callers share one fetch and malformed counts fall back to accepted legacy',async()=>{
  const t=boot({'catalog.json':{...catalog,count:2},'steam_upcoming.json':{...catalog,version:2}});
  const [a,b]=await Promise.all([t.api.loadCatalog(),t.api.loadCatalog()]);
  assert.equal(a.version,2);assert.equal(b.count,1);
  assert.equal(t.calls.filter(x=>x.url==='./data/catalog.json').length,1);
});
test('partial or duplicate month shards never masquerade as a complete catalog',async()=>{
  const t=boot({'index.json':{version:2,months:['2026-09','2026-10'],game_count:2},
    'calendar/2026-09.json':{count:1,games:[{appid:123}]},'calendar/2026-10.json':{count:1,games:[{appid:123}]}});
  assert.equal(await t.api.loadCatalog(),null);
});
test('invalid AppIDs and traversal paths make no request',async()=>{
  const t=boot({});assert.equal(await t.api.loadGame(-1),null);assert.equal(await t.api.readJSON('../secrets.json'),null);assert.equal(t.calls.length,0);
});
