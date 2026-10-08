import { RadarTwitch as D } from "./data.js";
import { node, fmt, time, IGDB_SOURCE, audienceNote, pendingLegacyMeasurement } from "./presentation.js";
export function createTwitchCards({ state, historyPanel, signal: eventSignal }) {
function badge(text, tone = "unknown") {
  const el = node("span","tw-state",text); el.dataset.tone = tone; return el;
}
function predictionBadge(p) {
  if (p.predicted_new === true) return p.release_phase === "upcoming" ? badge("未上市・命中","future") : badge("推算命中","yes");
  if (p.predicted_new === false) return badge("未命中","no");
  return badge(state.data.legacy ? "未收集" : p.reason === "metadata_expired_or_future" ? "日期待更新" : "缺少日期");
}
function keyValue(list, label, value) {
  const line = node("div"); line.append(node("dt","",label),node("dd","",value)); list.append(line);
}
function sourceLink(parent, url, label) {
  const safe = D.safeURL(url); if (!safe) return;
  const p = node("p"), a = node("a","",label + " ↗"); a.href = safe; a.target = "_blank"; a.rel = "noopener noreferrer"; p.append(a); parent.append(p);
}
function evidence(g) {
  const grid = node("div","tw-evidence-grid tw-igdb-only");
  const p = g.release_experiment[IGDB_SOURCE], card = node("section","tw-evidence-card tw-evidence-igdb");
  card.append(node("h4","",`IGDB 日期・${fmt(p.window_days)} 天推算`),predictionBadge(p));
  const list = node("dl");
  keyValue(list,"發售時間",time(p.release_at));
  keyValue(list,"日期擷取",time(p.metadata_observed_at));
  keyValue(list,"推算時間",time(p.evaluated_at));
  if (p.source_name) keyValue(list,"資料來源",String(p.source_name));
  card.append(list);
  card.append(node("p","",p.predicted_new === null ? (p.reason === "metadata_expired_or_future" ? "日期資料的有效時間不符本次量測，等待更新後再推算。" : "缺少有效日期，暫時無法推算。") : p.release_phase === "upcoming" ? "尚未發售也會命中這項規則；不代表已經上市。" : `以快照當下距 IGDB 首次發售是否未滿 ${fmt(p.window_days)} 天判斷；結果屬日期推算。`));
  sourceLink(card,p.source_url,"查看日期來源");
  grid.append(card);
  return grid;
}
function gameCard(g) {
  const pendingLegacy = pendingLegacyMeasurement(g);
  const storeLinks = D.steamStoreLinks(g);
  const card = node("details","tw-game"); card.dataset.gameId = g.game_id; card.dataset.observation = g.observation_status;
  const summary = node("summary","tw-game-summary");
  const identity = node("div","tw-game-identity"), cover = node("span","tw-cover",g.game_name.charAt(0).toUpperCase()); cover.setAttribute("aria-hidden","true");
  if (g.box_art_url) {
    const image = node("img"); image.src = g.box_art_url; image.alt = ""; image.width = 144; image.height = 192; image.loading = "lazy"; image.decoding = "async";
    image.addEventListener("error",() => image.remove(),{ once:true, signal: eventSignal }); cover.append(image);
  }
  const title = node("div","tw-game-title"); title.append(node("h3","",g.game_name),node("p","",`${g.twitch_name !== g.game_name ? g.twitch_name + " · " : ""}CATEGORY ${g.game_id}`));
  const labels = node("div","tw-source-labels");
  if (D.matches(g,"twitch_new")) labels.append(node("span","tw-tracking-label","Twitch 熱門新作"));
  if (g.is_steam_recent) labels.append(node("span","tw-tracking-label tw-steam-label","Steam 近期上市"));
  if (storeLinks.length) labels.append(node("span","tw-tracking-label tw-steam-label","已對應 Steam"));
  if (labels.children.length) title.append(labels);
  if (g.observation_status === "retained") title.append(node("span","tw-retained-note",pendingLegacy ? "舊版補回・待首次完整量測" : `上次觀測 ${time(g.observation_at)} · 待更新`));
  identity.append(cover,title); summary.append(identity);
  const metricNames = ["總觀眾人數","總開台數","篩選後中位數"];
  [g.viewer_count,g.streamer_count,g.filtered_audience.median_viewer_count].forEach((value,i) => {
    const metric = node("div","tw-metric"); metric.dataset.kind = ["viewers","streamers","median"][i];
    metric.append(node("span","tw-metric-label",metricNames[i]),node("strong","",fmt(value)),node("small","",pendingLegacy ? "待首次完整量測" : g.observation_status === "retained" ? value == null ? "待更新・無保存數值" : "上次觀測・待更新" : i === 2 ? audienceNote(g.filtered_audience) : value == null ? "尚未收集" : i === 1 ? "個頻道・全體" : "人・全體"));
    if (i === 2) metric.setAttribute("aria-label",`${pendingLegacy ? "舊版補回，待首次完整量測；" : g.observation_status === "retained" ? "上次觀測，待更新；" : ""}篩選後觀眾中位數 ${fmt(value)} 人，${audienceNote(g.filtered_audience)}；免費追隨者超過 1,000 且觀眾至少 10 人`);
    summary.append(metric);
  });
  const signals = node("div","tw-signals");
  const signal = node("span","tw-signal");
  signal.append(node("span","","IGDB 日期"),predictionBadge(g.release_experiment[IGDB_SOURCE]));
  signals.append(signal);
  const mark = node("span","tw-open-mark","+"); mark.setAttribute("aria-hidden","true"); summary.append(signals,mark); card.append(summary);
  let built = false;
  card.addEventListener("toggle",() => {
    if (!card.open || built) return;
    built = true;
    const body = node("div","tw-game-body");
    if (storeLinks.length) {
      const actions = node("div","tw-game-actions");
      storeLinks.forEach(link => {
        const button = node("a","tw-steam-store",`Steam 商店${storeLinks.length > 1 ? ` · ${link.steam_appid}` : ""} ↗`);
        button.href = link.store_url; button.target = "_blank"; button.rel = "noopener noreferrer";
        actions.append(button);
      });
      body.append(actions);
    }
    if (!state.data.legacy) body.append(historyPanel(g));
    body.append(evidence(g));
    card.append(body);
  }, { signal: eventSignal });
  return card;
}
function empty(title, message, action, label) {
  const div = node("div","tw-empty"), symbol = node("span","","◎"); symbol.setAttribute("aria-hidden","true");
  div.append(symbol,node("h3","",title),node("p","",message));
  if (action) { const button = node("button","",label); button.type = "button"; button.addEventListener("click",action, { signal: eventSignal }); div.append(button); }
  return div;
}
return { gameCard, empty, evidence };
}
