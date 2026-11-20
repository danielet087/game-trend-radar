import test from 'node:test';
import assert from 'node:assert/strict';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { readFileSync } from 'node:fs';
import { RadarData as D } from '../src/domain/index.mjs';
import { RadarDiscovery as R } from '../src/features/discovery/index.js';
import { FilterState, PAGE_SIZE } from '../src/features/catalog/filter-state.ts';
import { cardDate, selectCatalog } from '../src/features/catalog/selectors.ts';
import { GameCard } from '../src/features/catalog/GameCard.ts';
import { normalizeCatalog, catalogEntity, catalogCardDate } from '../src/features/catalog/boundary.ts';
import { artShape } from '../src/shared/artwork.js';

const TODAY = '2026-10-08';
function filters(mode = 'all', search = '') {
  const result = new FilterState(mode, TODAY, D, R, new URLSearchParams(search));
  result.configure({minimum:['0','5000','10000'],sort:['date','followers','name','newest'],period:['','future','past'],language:['','tchinese','schinese']});
  result.restore(new URLSearchParams(search));
  return result;
}
const raw = (overrides = {}) => ({appid:42,name:'Example',display_name:'遊戲範例',followers:6000,
  release_start:'2026-10-10',language_support:{tchinese:true,schinese:true},...overrides});
const native = (overrides = {}) => ({schema_version:1,games:[{id:'igdb:99',igdb_id:99,name_en:'Example',name_zh_tw:'遊戲範例',hypes:40,
  sexual_content_screened:true,platform_data_complete:true,platforms:[{id:167,code:'PS5'}],known_platforms:[{id:167,code:'PS5'},{id:6,name:'PC'}],
  releases:[{date:'2026-10-18',platform:'PS5',precision:'day',source:'IGDB',date_basis:'igdb_calendar_day',time_zone:'Asia/Taipei',
    timezone_status:'date_only',source_date:'2026-10-18',region:'worldwide',source_region:'worldwide',taiwan_release_confirmed:false}],
  websites:[{url:'https://store.steampowered.com/app/42/'}],url:'https://www.igdb.com/games/example',...overrides}]});
function dataset(...games) { return D.datasets({games}, null, null); }

test('FilterState validates restored controls and retains query aliases, repeated tags, and unrelated params', () => {
  const f=filters('explore','q= 火焰 &min=unknown&sort=unknown&tag=RPG&tag=Action&exclude=Horror&match=any&language=tchinese&appid=42');
  assert.equal(f.state.minimum,'0'); assert.equal(f.state.sort,'date');
  assert.deepEqual(f.state.tags.include,['RPG','Action']); assert.deepEqual(f.state.tags.exclude,['Horror']);
  f.state.term='火焰'; f.state.minimum='5000'; f.state.sort='followers';
  const url=f.url('https://radar.test/game-trend-radar/explore.html?appid=42&tag=Old');
  assert.equal(url.searchParams.get('appid'),'42');
  assert.deepEqual(url.searchParams.getAll('tag'),['RPG','Action']);
  assert.equal(url.searchParams.get('min'),'5000'); assert.equal(url.searchParams.get('q'),'火焰');
  assert.equal(url.searchParams.get('match'),'any');
  f.reset(); assert.equal(f.active,false); assert.equal(f.state.sort,'followers');
});

test('filter selectors use state without a DOM and find Taiwanese, original simplified, aliases, tags, and IDs', () => {
  const data=R.enrich(dataset(raw()), {games:[{...raw(),tags:['RPG']}]},null);
  for (const game of [...data.games,...data.recent]) { game.nameOriginalCn='游戏范例'; game.nameSearchAliases=['別稱']; }
  for (const term of ['遊戲範例','Example','游戏范例','別稱','角色扮演','42']) {
    const f=filters(); f.state.term=term;
    assert.equal(selectCatalog(data,f,D,R,new Set()).items.length,1,term);
  }
  const f=filters(); f.state.term='不存在';
  assert.equal(selectCatalog(data,f,D,R,new Set()).items.length,0);
});

test('one combined game remains distinct calendar events and summary date uses earliest platform release', () => {
  const data=D.datasets({games:[raw()]},null,native());
  const all=selectCatalog(data,filters(),D,R,new Set());
  assert.equal(all.items.length,1); assert.equal(all.events.length,2);
  assert.equal(cardDate(all.items[0],D),'2026-10-10');
  const home=selectCatalog(data,filters('home','month=2026-10'),D,R,new Set());
  assert.equal(home.items.length,2);
  const day=selectCatalog(data,filters('date','date=2026-10-18'),D,R,new Set());
  assert.equal(day.items.length,1); assert.equal(cardDate(day.items[0],D,true),'2026-10-18');
  assert.deepEqual(day.items[0].releasePlatforms,['PS5']);
});

test('Steam followers filter never treats IGDB hypes as followers and unknown languages do not count as supported', () => {
  const n=native({websites:[],name_en:'Other',name_zh_tw:'另一款',hypes:100000});
  const data=D.datasets({games:[raw()]},null,n);
  const f=filters();
  assert.equal(selectCatalog(data,f,D,R,new Set()).items.length,2);
  f.state.minimum='5000'; assert.equal(selectCatalog(data,f,D,R,new Set()).items.length,1);
  f.state.minimum='0'; f.state.language='tchinese'; assert.equal(selectCatalog(data,f,D,R,new Set()).items.length,1);
});

test('alias collections, past/future, invalid dates and sorting preserve catalog scope', () => {
  const data=D.datasets({games:[raw(),raw({appid:43,name:'Second',release_start:'2026-10-09',followers:12000}),
    raw({appid:44,name:'Released',release_start:'2026-10-01'})]},null,native());
  const f=filters(); f.state.savedOnly=true;
  assert.equal(selectCatalog(data,f,D,R,new Set(['igdb:99'])).items[0].appid,42);
  f.state.savedOnly=false; f.state.period='past'; assert.deepEqual(selectCatalog(data,f,D,R,new Set()).items.map(g=>g.appid),[44]);
  f.state.period='future'; f.state.sort='followers'; assert.equal(selectCatalog(data,f,D,R,new Set()).items[0].appid,43);
  assert.equal(filters('date','date=2026-02-30').state.date,null);
  assert.equal(selectCatalog(data,filters('date','date=2026-02-30'),D,R,new Set()).items.length,0);
  assert.equal(PAGE_SIZE,36);
});

test('the latest official count replaces an older catalog count on cards, sorting and the followers metric only', async () => {
  const checked='2026-10-08T01:00:00Z', latest='2026-10-08T04:00:00Z';
  const rows=[raw({follower_checked_at:checked}),
    raw({appid:43,name:'Second',release_start:'2026-10-09',followers:12000,follower_checked_at:checked}),
    raw({appid:44,name:'Third',release_start:'2026-10-11',followers:7000,follower_checked_at:'2026-10-08T05:00:00Z'})];
  const followers={schema_version:1,as_of:latest,games:{
    '42':[13000,latest],
    // Newer and below 5,000: shown, and the game stays listed because the catalog admitted it.
    '43':[4800,latest],
    // Older than the catalog's own measurement: ignored.
    '44':[9000,latest],
    '45':[1,latest], x:[1,latest], '46':[-1,latest], '47':[5,'yesterday'], '48':{followers:5}}};
  const original=structuredClone(rows);
  const data=D.datasets({games:rows},null,null,null,followers);
  const byId=new Map(data.games.map(game=>[game.appid,game]));
  assert.deepEqual([...byId.keys()].sort(),[42,43,44]);
  assert.deepEqual([42,43,44].map(id=>[byId.get(id).followers,byId.get(id).followersCheckedAt]),
    [[13000,latest],[4800,latest],[7000,'2026-10-08T05:00:00Z']]);
  assert.deepEqual(rows,original,'published rows stay unchanged');
  const f=filters(); f.state.sort='followers';
  assert.deepEqual(selectCatalog(data,f,D,R,new Set()).items.map(g=>g.appid),[42,44,43]);
  assert.match(await renderCard(D.cardGames(data.games).find(game=>game.appid===42)),/13,000<small>人關注<\/small>/);
  const {model}=normalizeCatalog({official:{games:rows},preview:null,native:null,references:null,followers},'all',R);
  const metric=model.entities.get('steam:42').metrics.find(item=>item.kind==='followers');
  assert.equal(metric.value,13000); assert.equal(metric.provenance.checkedAt,latest);
  // No file, or an unknown version of it: the catalog counts as before.
  for (const other of [null,{schema_version:2,games:followers.games},{schema_version:1,games:[]}])
    assert.equal(D.datasets({games:rows},null,null,null,other).games.find(g=>g.appid===42).followers,6000);
});

async function renderCard(game, options = {}, mode = 'all', model = null) {
  return renderToString(createSSRApp(GameCard,{game,options,environment:{domain:D,discovery:R,mode,today:TODAY,
    model:()=>model,tags:()=>({include:[],exclude:[],match:'all'}),isSaved:()=>false,subscribeSaved:()=>()=>{},artwork:{load(){}}}}));
}
test('Vue card names every known platform, and keeps accessibility, title metadata, and separate measured metrics', async () => {
  const data=D.datasets({games:[raw()]},null,native());
  const html=await renderCard(D.cardGames(data.games)[0]);
  assert.match(html,/class="game-card"[^>]*data-appid="42"/);
  assert.match(html,/<span class="platform-chip is-steam">Steam<\/span><span class="platform-chip is-playstation">PS5<\/span>/);
  assert.match(html,/class="card-platforms" title="已確認平台：PC（Steam）／PS5。[^"]*之後可能增加[^"]*" aria-label="平台：Steam、PS5"/);
  assert.match(html,/class="card-title" title="遊戲範例"/);
  assert.match(html,/class="card-english" title="Example"/);
  assert.match(html,/6,000<small>人關注<\/small>/); assert.match(html,/40<small>IGDB hypes<\/small>/);
  assert.equal((html.match(/<time /g)||[]).length,1);
  assert.match(html,/datetime="2026-10-10"/);
  // The summary date is the Steam day; the later PS5 day is named apart, as a worldwide IGDB day.
  assert.match(html,/>Steam 版 2 天後登場<\/span>/);
  assert.match(html,/class="card-release-platform" title="其他平台：PS5 10\/18 發售（全球日期）">PS5 10\/18 發售（全球日期）<\/span>/);
  assert.doesNotMatch(html,/class="card-release-basis"/);
  assert.match(html,/aria-label="收藏 遊戲範例" aria-pressed="false"/);
  assert.match(html,/class="card-detail-link" tabindex="-1" href="\.\/game.html\?appid=42&amp;date=/);
});

test('Vue event card honors the selected platform date and multiplayer language evidence', async () => {
  const data=D.datasets({games:[raw({categories:[{id:2}],categories_source:'Steam Store appdetails cc=TW categories',categories_checked_at:'2026-10-08T09:00:00Z'})]},
    null,native({multiplayer_modes:[{platform:{id:167},onlinemax:4}]}));
  const early=data.games.find(game=>game.date==='2026-10-10'),late=data.games.find(game=>game.date==='2026-10-18');
  const steam=await renderCard(early,{event:true},'date'), ps5=await renderCard(late,{event:true},'date');
  assert.doesNotMatch(steam,/class="card-multiplayer"/);
  assert.match(ps5,/class="card-multiplayer"/); assert.match(ps5,/多人遊戲；PS5/);
  assert.match(ps5,/datetime="2026-10-18"/); assert.match(ps5,/>PS5 版 10 天後登場<\/span>/);
  // A worldwide IGDB day says so beside the date, and the Steam day stays separate.
  assert.match(ps5,/class="card-release-basis"[^>]*>全球日期<\/span>/);
  assert.match(ps5,/class="card-release-platform"[^>]*>Steam 10\/10 發售<\/span>/);
  assert.match(steam,/>Steam 版 2 天後登場<\/span>/); assert.doesNotMatch(steam,/class="card-release-basis"/);
  assert.match(steam,/class="card-release-platform"[^>]*>PS5 10\/18 發售（全球日期）<\/span>/);
  assert.match(ps5,/<span class="platform-chip is-steam">Steam<\/span><span class="platform-chip is-playstation is-released">PS5<\/span>/);
  assert.match(ps5,/aria-label="平台：Steam、PS5；本次發售：PS5"/);
  assert.match(steam,/<span class="platform-chip is-steam is-released">Steam<\/span><span class="platform-chip is-playstation">PS5<\/span>/);
  assert.match(ps5,/aria-label="PS5 版本遊戲支援語言"/);
  assert.doesNotMatch(ps5,/支援繁中/);
});

test('Vue card shows the IGDB PopScore rank instead of a low hypes count for NS/NS2 games admitted by it', async () => {
  const ns2=[{id:508,code:'NS2'}], release={...native().games[0].releases[0],platform:'NS2'};
  const data=D.datasets(null,null,native({websites:[],hypes:7,popularity_basis:'igdb_popscore',
    popscore:{visits:0.001,want_to_play:0.002,top_percent:8},platforms:ns2,known_platforms:ns2,releases:[release]}));
  const html=await renderCard(data.games[0]);
  assert.match(html,/<span class="card-followers" title="IGDB 頁面瀏覽或「想玩」在 NS／NS2 遊戲中排名前 8%">前 8%<small>IGDB 熱度<\/small><\/span>/);
  assert.doesNotMatch(html,/IGDB hypes/);
});

test('Vue card reserves the blank English row and omits missing metrics while retaining measured zero', async () => {
  const game=D.normalize(raw()); game.nameEn=game.name; game.followers=0; game.hypes=null;
  const html=await renderCard(game);
  assert.match(html,/class="card-english" aria-hidden="true"><\/p>/);
  assert.match(html,/0<small>人關注<\/small>/); assert.doesNotMatch(html,/IGDB hypes/);
});

test('current public JSON uses canonical indexes while catalog view models and Vue card output stay identical', async () => {
  const read = name => JSON.parse(readFileSync(new URL(`./fixtures/site-data/${name}`, import.meta.url),'utf8'));
  const input = {official:read('steam_upcoming.json'),preview:read('steam_preview.json'),native:read('nintendo_upcoming.json')};
  const normalized=normalizeCatalog(input,'all');
  const baseline=R.enrich(D.datasets(input.official,input.preview,input.native),input.official,input.preview);
  assert.deepEqual(normalized.viewModel,baseline);
  assert.ok(normalized.model.entities.size>0); assert.ok(normalized.model.versions.size>0); assert.ok(normalized.model.releaseEvents.size>0);
  const rows=D.unique([...normalized.viewModel.games,...normalized.viewModel.recent]);
  for (const game of rows) {
    const entity=catalogEntity(game,normalized.model);
    assert.equal(entity.id,game.identityKey);
    for (const id of entity.releaseEventIds) {
      const event=normalized.model.releaseEvents.get(id);
      assert.equal(event.gameId,entity.id); assert.ok(normalized.model.versions.has(event.versionId));
    }
    for (const event of [false,true]) {
      assert.equal(catalogCardDate(game,D,event,normalized.model),cardDate(game,D,event),`${game.identityKey} event=${event}`);
      assert.equal(await renderCard(game,{event},'all',normalized.model),await renderCard(game,{event},'all'),`${game.identityKey} Vue output event=${event}`);
    }
  }
  for (const mode of ['home','all','upcoming','released','date','explore','saved']) {
    const f=filters(mode,'month=2026-10&date=2026-10-10');
    assert.deepEqual(selectCatalog(normalized.viewModel,f,D,R,new Set()),selectCatalog(baseline,f,D,R,new Set()));
  }
});

test('card art keeps its whole picture when its shape is not a Steam capsule', () => {
  const art = (width, height, src = 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg') =>
    artShape({ naturalWidth: width, naturalHeight: height, currentSrc: src });
  // 616×353 capsules and 16:9 art fill the box.
  assert.deepEqual(art(616, 353), { whole: false, backdrop: '' });
  assert.deepEqual(art(1280, 720), { whole: false, backdrop: '' });
  // IGDB portrait covers and 460×215 Steam headers sit over a blurred copy.
  assert.deepEqual(art(264, 374), { whole: true, backdrop: 'url("https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg")' });
  assert.equal(art(460, 215).whole, true);
  // Only plain https URLs reach CSS; an image that has not loaded changes nothing.
  assert.deepEqual(art(264, 374, 'https://x.test/a"),url(b.jpg'), { whole: true, backdrop: '' });
  assert.deepEqual(art(264, 374, 'http://images.igdb.com/a.jpg'), { whole: true, backdrop: '' });
  assert.deepEqual(art(0, 0), { whole: false, backdrop: '' });
  assert.deepEqual(artShape(null), { whole: false, backdrop: '' });
});
