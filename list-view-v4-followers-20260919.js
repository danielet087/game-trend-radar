(()=>{
"use strict";
const mode=document.body.dataset.mode==="released"?"released":"upcoming";
const int=new Intl.NumberFormat("zh-TW");
const el=id=>document.getElementById(id);
const taipeiParts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
const taipeiPart=type=>taipeiParts.find(part=>part.type===type)?.value||"";
const today=[taipeiPart("year"),taipeiPart("month"),taipeiPart("day")].join("-");
const start=new Date(today+"T12:00:00Z");
const dateOffset=days=>new Date(start.getTime()+days*86400000).toISOString().slice(0,10);
const model={items:[]};
const validDate=s=>typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+"T12:00:00Z"))&&new Date(s+"T12:00:00Z").toISOString().slice(0,10)===s;
function normalize(raw,recent=false,translation=null){
 if(!raw||typeof raw!=="object")return null;
 const date=raw.release_start||raw.release_date,followers=raw.followers==null?NaN:Number(raw.followers),appid=Number(raw.appid);
 if(!validDate(date)||raw.release_precision&&raw.release_precision!=="day"||!Number.isInteger(appid)||appid<=0)return null;
 if(recent?!(followers>3000&&["tracked_release","direct_release"].includes(raw.recent_source)):!(followers>=5000))return null;
 const nameEn=String(raw.name_en||raw.name||translation?.name_en||translation?.name||"").trim();
 const nameZh=String(raw.name_zh_tw||translation?.name_zh_tw||"").trim();
 return {appid,name:nameZh||nameEn||"Steam App "+appid,nameEn,followers,date,art:String(raw.capsule_image||raw.header_image||""),darkHorse:recent&&raw.recent_source==="direct_release"&&!!raw.first_week_qualified_at};
}
function display(items){
 const term=el("searchInput").value.trim().toLocaleLowerCase();
 const order=el("sortSelect").value;
 const filtered=items.filter(g=>!term||g.name.toLocaleLowerCase().includes(term)||g.nameEn.toLocaleLowerCase().includes(term)||String(g.appid).includes(term));
 filtered.sort((a,b)=>order==="followers"?(b.followers-a.followers||a.date.localeCompare(b.date)):order==="newest"?(b.date.localeCompare(a.date)||b.followers-a.followers):(a.date.localeCompare(b.date)||b.followers-a.followers));
 el("gameCount").textContent=term?`${filtered.length} / ${items.length} 款`:`${items.length} 款`;
 const area=el("fullList");area.replaceChildren();
 if(!filtered.length){
  const div=document.createElement("div");div.className="empty";
  div.textContent=items.length?"找不到符合搜尋條件的遊戲。":mode==="released"?"尚無符合近 30 天已上市且 Followers 超過 3,000 的遊戲。":"目前尚無未來 45 天內符合 Followers 門檻的新作。";
  area.append(div);return;
 }
 for(const game of filtered){
  const a=document.createElement("a");a.className="game";a.href="https://store.steampowered.com/app/"+game.appid+"/";a.target="_blank";a.rel="noopener noreferrer";
  a.title=game.name+(game.nameEn&&game.nameEn!==game.name?"（"+game.nameEn+"）":"");
  const cover=document.createElement("div");cover.className="cover";cover.textContent="✦";
  if(game.art&&/^https:\/\//.test(game.art)){
   const img=document.createElement("img");img.src=game.art;img.alt="";img.loading="lazy";img.onerror=()=>{img.remove();cover.textContent="✦"};cover.replaceChildren(img);
  }
  if(game.darkHorse){
   const badge=document.createElement("span");badge.className="badge";badge.textContent="近期黑馬";
   badge.title="直接上市，發售後首週內查得 Followers 超過 3,000";cover.append(badge);
  }
  const body=document.createElement("div");body.className="body";
  const name=document.createElement("h2");name.className="title";name.textContent=game.name;body.append(name);
  if(game.nameEn&&game.nameEn!==game.name){
   const en=document.createElement("p");en.className="en";en.textContent=game.nameEn;body.append(en);
  }
  const meta=document.createElement("div");meta.className="meta";
  const date=document.createElement("span");date.textContent=game.date.replace(/-/g,"/");
  const followers=document.createElement("span");followers.className="follow";followers.textContent=int.format(game.followers)+" Followers";
  meta.append(date,followers);body.append(meta);a.append(cover,body);area.append(a);
 }
}
el("searchInput").addEventListener("input",()=>display(model.items));
el("sortSelect").addEventListener("change",()=>display(model.items));
async function load(){
 const paths=["./data/steam_upcoming.json","./data/steam_preview.json"];
 const results=await Promise.all(paths.map(async path=>{
  try{
   const response=await fetch(path+"?t="+Math.floor(Date.now()/300000),{cache:"no-store"});
   if(!response.ok)return null;
   const payload=await response.json();
   return Array.isArray(payload.games)?payload:null;
  }catch(error){console.warn("Unable to read",path,error);return null}
 }));
 const [official,preview]=results;
 const source=official||preview;
 if(!source){display([]);return}
 const progress=el("followerProgress"),init=official?.initialization;
 if(progress&&init?.mode==="two_phase_steam_year"){
  const number=new Intl.NumberFormat("zh-TW"),batch=init.last_attempt||{};
  const checked=Number(init.next_follower_index)||0,total=Number(init.candidate_count)||0;
  const date=new Date(official.generated_at||"");
  const time=Number.isFinite(date.getTime())?new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(date):"待確認";
  const last=batch.phase==="followers"?" · 上批新查 "+number.format(batch.fresh_follower_requests||0)+" 筆、沿用快取 "+number.format(batch.cached_reuses||0)+" 筆":"";
  progress.textContent="全年候選 "+number.format(total)+" 筆 · Followers 已處理 "+number.format(checked)+" 筆 · 全年度合格 "+number.format(official.count||0)+" 款"+last+" · 最後更新（台灣）"+time+"。本頁只列出未來 45 天合格遊戲。";
  progress.hidden=false;
 }
 let items;
 if(mode==="released"){
  items=Array.isArray(preview?.recent_games)?preview.recent_games.map(row=>normalize(row,true)).filter(Boolean)
   .filter(g=>g.date>=dateOffset(-30)&&g.date<=today):[];
 }else{
  const translations=new Map((preview?.games||[]).map(row=>[Number(row.appid),row]));
  items=source.games.map(row=>normalize(row,false,translations.get(Number(row.appid)))).filter(Boolean)
   .filter(g=>g.date>=today&&g.date<=dateOffset(45));
 }
 model.items=Array.from(new Map(items.map(g=>[g.appid,g])).values());
 display(model.items);
}
load().catch(error=>{
 console.error("Steam game list failed to render:",error);
 const count=el("gameCount");
 const list=el("fullList");
 if(count)count.textContent="讀取失敗";
 if(list){list.replaceChildren();const message=document.createElement("div");message.className="empty";message.textContent="遊戲資料載入失敗，請重新整理頁面。若持續發生，請稍後再試。";list.append(message)}
});
})();
