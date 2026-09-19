(()=>{
"use strict";
const mode=document.body.dataset.mode==="released"?"released":"upcoming";
const int=new Intl.NumberFormat("zh-TW");
const el=id=>document.getElementById(id);
const dateText=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const todayMatch=dateText.match(/(\d{4})\D(\d{2})\D(\d{2})/);
const today=todayMatch?todayMatch.slice(1).join("-"):new Date().toISOString().slice(0,10);
const start=new Date(today+"T12:00:00Z");
const dateOffset=days=>new Date(start.getTime()+days*86400000).toISOString().slice(0,10);
const model={items:[],updatedAt:null,source:""};
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
 if(!source){el("updateStatus").textContent="等待 Steam 公開資料，請稍後再試。";display([]);return}
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
 model.updatedAt=(mode==="released"?preview?.generated_at:null)||source.generated_at||source.updated_at||null;
 model.source=mode==="released"?"Steam 最近上市資料":official?"正式 Steam 資料":"初始化預覽";
 const stamp=model.updatedAt?new Date(model.updatedAt).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}):"時間未知";
 el("updateStatus").textContent="資料更新："+stamp+" · "+model.source+"。點擊遊戲卡片可前往 Steam 商店。";
 display(model.items);
}
load();
})();
