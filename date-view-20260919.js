(()=>{
"use strict";
const el=id=>document.getElementById(id);
const int=new Intl.NumberFormat("zh-TW");
const validDate=str=>typeof str==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(str)&&!Number.isNaN(Date.parse(str+"T12:00:00Z"))&&new Date(str+"T12:00:00Z").toISOString().slice(0,10)===str;
const requested=new URLSearchParams(location.search).get("date")||"";
const date=validDate(requested)?requested:null;
const model={games:[]};
if(date){
 const [year,month,day]=date.split("-");
 const weekday=new Intl.DateTimeFormat("zh-TW",{timeZone:"UTC",weekday:"long"}).format(new Date(date+"T12:00:00Z"));
 el("dateTitle").textContent=Number(year)+" 年 "+Number(month)+" 月 "+Number(day)+" 日（"+weekday+"）";
 el("backCalendar").href="./index.html?month="+year+"-"+month;
 document.title=year+"/"+month+"/"+day+" 發售遊戲｜Game Trend Radar";
}else{
 el("dateTitle").textContent="找不到指定日期";
}
function normalize(raw,translated=null){
 if(!raw||typeof raw!=="object")return null;
 const day=raw.release_start||raw.release_date;
 const followers=Number(raw.followers),appid=Number(raw.appid);
 if(!validDate(day)||raw.release_precision&&raw.release_precision!=="day"||!Number.isInteger(appid)||appid<=0||!Number.isFinite(followers)||followers<5000)return null;
 const en=String(raw.name_en||raw.name||translated?.name_en||translated?.name||"").trim();
 const zh=String(raw.name_zh_tw||translated?.name_zh_tw||"").trim();
 return {appid,name:zh||en||"Steam App "+appid,nameEn:en,date:day,followers,art:String(raw.capsule_image||raw.header_image||"")};
}
function show(message){
 el("gameCount").textContent="0 款";
 const area=el("fullList");area.replaceChildren();
 const div=document.createElement("div");div.className="empty";div.textContent=message;area.append(div);
}
function render(){
 const term=el("searchInput").value.trim().toLocaleLowerCase();
 const sort=el("sortSelect").value;
 const games=model.games.filter(g=>!term||g.name.toLocaleLowerCase().includes(term)||g.nameEn.toLocaleLowerCase().includes(term)||String(g.appid).includes(term));
 games.sort((a,b)=>sort==="name"?(a.name.localeCompare(b.name,"zh-TW")||b.followers-a.followers):(b.followers-a.followers||a.name.localeCompare(b.name,"zh-TW")));
 el("gameCount").textContent=term?games.length+" / "+model.games.length+" 款":games.length+" 款";
 const area=el("fullList");area.replaceChildren();
 if(!games.length){show(model.games.length?"沒有符合搜尋條件的遊戲。":"這一天尚無符合 5,000 Followers 門檻、具備明確發售日的遊戲。");return}
 for(const g of games){
  const card=document.createElement("a");card.className="game";card.href="https://store.steampowered.com/app/"+g.appid+"/";card.target="_blank";card.rel="noopener noreferrer";card.title=g.name+(g.nameEn&&g.nameEn!==g.name?"（"+g.nameEn+"）":"");
  const cover=document.createElement("div");cover.className="cover";cover.textContent="✦";
  if(/^https:\/\//.test(g.art)){
   const img=document.createElement("img");img.src=g.art;img.alt="";img.loading="lazy";img.onerror=()=>{img.remove();cover.textContent="✦"};cover.replaceChildren(img);
  }
  const body=document.createElement("div");body.className="body";
  const name=document.createElement("h2");name.className="title";name.textContent=g.name;body.append(name);
  if(g.nameEn&&g.nameEn!==g.name){const en=document.createElement("p");en.className="en";en.textContent=g.nameEn;body.append(en)}
  const meta=document.createElement("div");meta.className="meta";const day=document.createElement("span");day.textContent=g.date.replace(/-/g,"/");const count=document.createElement("span");count.className="follow";count.textContent=int.format(g.followers)+" Followers";meta.append(day,count);body.append(meta);card.append(cover,body);area.append(card);
 }
}
el("searchInput").addEventListener("input",render);
el("sortSelect").addEventListener("change",render);
async function load(){
 if(!date){show("日期參數有誤，請返回發售月曆選擇日期。");return}
 const paths=["./data/steam_upcoming.json","./data/steam_preview.json"];
 const [official,preview]=await Promise.all(paths.map(async path=>{
  try{const r=await fetch(path+"?t="+Math.floor(Date.now()/300000),{cache:"no-store"});if(!r.ok)return null;const j=await r.json();return Array.isArray(j.games)?j:null}
  catch(error){console.warn("Cannot read Steam dataset",path,error);return null}
 }));
 const chosen=official||preview;
 if(!chosen){show("Steam 公開資料暫時無法讀取，請稍後重新整理。");return}
 const translations=new Map((preview?.games||[]).map(item=>[Number(item.appid),item]));
 model.games=Array.from(new Map(chosen.games.map(item=>normalize(item,translations.get(Number(item.appid)))).filter(g=>g&&g.date===date).map(g=>[g.appid,g])).values());
 render();
}
load().catch(error=>{console.error("Calendar day list failed:",error);show("遊戲資料載入失敗，請稍後重新整理。")});
})();
