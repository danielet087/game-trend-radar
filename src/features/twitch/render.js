import { RadarTwitch as D } from "./data.js";
import { node, fmt, time, filterNames, IGDB_SOURCE, sourceWindow } from "./presentation.js";
export function createTwitchRenderer({ state, $, cards, gameCard, empty, evidence, reset, syncURL, signal }) {
function render() {
  if (!state.data) return;
  const { games,legacy } = state.data;
  const visible = D.select(games,state);
  document.querySelectorAll("[data-filter]").forEach(button => {
    button.setAttribute("aria-pressed",String(button.dataset.filter === state.filter));
    button.disabled = legacy;
    button.querySelector("span").textContent = legacy ? "—" : fmt(games.filter(g => D.matches(g,button.dataset.filter)).length);
  });
  $("gameSearch").disabled = legacy; $("gameSort").disabled = legacy;
  $("resetFilters").hidden = legacy || (!state.query && state.filter === D.DEFAULT_FILTER && state.sort === D.DEFAULT_SORT);
  $("viewNotice").hidden = legacy || state.filter === D.DEFAULT_FILTER;
  document.querySelector(".tw-column-head").hidden = legacy;
  $("candidatesTitle").textContent = state.filter === "all" ? "所有觀測" : ["twitch_new","steam_recent"].includes(state.filter) ? filterNames[state.filter] : "新作觀測";
  if (legacy) {
    $("resultsStatus").textContent = "新版新作觀測尚未發布";
    $("gameResults").replaceChildren(empty("等待新版新作觀測","現有檔案是未經新作篩選的舊版熱門取樣，暫不列入。新版排程成功發布後，這裡會自動顯示新作線索。"));
    $("gameResults").setAttribute("aria-busy","false"); $("loadMore").hidden = true;
    return;
  }
  $("viewNotice").textContent = state.filter === "twitch_new" ? "涵蓋不同平台的新作，未配對 Steam 也會持續觀測。" : state.filter === "steam_recent" ? "本站已收錄、Steam 台灣上市未滿 30 天且已配對 Twitch 類別的遊戲；不受 7,000 人門檻限制。" : state.filter === "all" ? "包含持續追蹤的新作與本輪達標候選。熱門程度本身不代表新作，請參考 IGDB 日期推算。" : state.filter === "igdb" ? `只列 IGDB 日期 ${sourceWindow(state, IGDB_SOURCE)}推算命中的遊戲；以各筆快照記錄的規則為準。` : "";
  $("resultsStatus").textContent = `${visible.length} 款 · ${filterNames[state.filter]}${visible.length > state.limit ? ` · 顯示前 ${state.limit} 款` : ""}`;
  const fragment = document.createDocumentFragment();
  visible.slice(0,state.limit).forEach(g => {
    if (!cards.has(g.game_id)) cards.set(g.game_id,gameCard(g));
    fragment.append(cards.get(g.game_id));
  });
  if (!visible.length) {
    const noSignals = games.length && state.filter === D.DEFAULT_FILTER && !state.query;
    const showAll = () => { state.filter = "all"; state.limit = 24; render(); syncURL(); };
    fragment.append(empty(noSignals ? "目前還沒有追蹤中的新作" : games.length ? "這個條件下，還沒有結果" : "目前沒有可呈現的觀測",noSignals ? "目前沒有符合追蹤條件的新作。可以另外查看所有觀測與 IGDB 日期推算。" : games.length ? "試著調整關鍵字或重設篩選。缺少有效日期時，IGDB 推算維持未知。" : "這份快照沒有可呈現的達標遊戲。下一輪有資料後會出現在這裡。",noSignals ? showAll : games.length ? reset : null,noSignals ? "查看所有觀測" : "重設篩選"));
  }
  $("gameResults").replaceChildren(fragment); $("gameResults").setAttribute("aria-busy","false");
  $("loadMore").hidden = visible.length <= state.limit;
  $("loadMore").textContent = `再看 ${Math.min(24,visible.length-state.limit)} 款 ↓`;
}
function exclusions() {
  const games = state.data.excluded;
  $("exclusions").hidden = !games.length; $("excludedCount").textContent = fmt(games.length);
  const fragment = document.createDocumentFragment();
  games.forEach(g => {
    const card = node("details","tw-excluded-game"), summary = node("summary","",g.game_name);
    const reason = g.reason === "non_game_category" ? "非遊戲類別 · 未量測觀眾" : g.reason === "observed_not_new" ? "既有排除紀錄 · 未量測觀眾" : g.reason === "tracking_expired" ? "發售已滿 30 天 · 已結束追蹤，保留歷史" : g.reason === "igdb_release_outside_window" ? `IGDB 日期未命中 ${fmt(g.release_experiment.igdb_first_release_date.window_days)} 天範圍 · 已停止本輪觀眾與追隨數收集` : "已排除 · 原因待確認";
    card.append(summary,node("p","",reason));
    let built = false; card.addEventListener("toggle",() => { if (card.open && !built) { built = true; card.append(evidence(g)); } }, { signal }); fragment.append(card);
  });
  $("excludedGames").replaceChildren(fragment);
}
function notice(title,message) {
  $("snapshotNotice").hidden = !title;
  $("noticeTitle").textContent = title || ""; $("noticeText").textContent = message || "";
}
function pendingSteam() {
  const entries = state.data.pending_steam;
  $("steamPending").hidden = !entries.length;
  $("steamPendingCount").textContent = fmt(entries.length);
  const fragment = document.createDocumentFragment();
  const names = { pending:"配對查詢中", ambiguous:"有多個候選，待確認", unmatched:"尚未找到 Twitch 類別" };
  entries.sort((a,b) => (b.steam.release_at || "").localeCompare(a.steam.release_at || "")).forEach(entry => {
    const item = node("article","tw-pending-game"), s = entry.steam, title = node("h3"), link = node("a","",s.display_name);
    link.href = `./game.html?appid=${encodeURIComponent(s.steam_appid)}`; title.append(link);
    item.append(title,node("p","",`${s.release_date || "上市日期待確認"} · ${names[entry.status]}`));
    fragment.append(item);
  });
  $("steamPendingGames").replaceChildren(fragment);
}
function metadata() {
  const d = state.data, coverage = d.coverage;
  $("snapshotTime").textContent = time(d.generated_at); $("snapshotTime").dateTime = d.generated_at;
  $("scopeLabel").textContent = d.legacy ? "等待新版觀測" : "全球觀測 · Twitch 熱門新作 + Steam 近期上市";
  $("igdbDateGuide").textContent = `使用 IGDB 首次發售日期；本次快照採 ${sourceWindow(state, IGDB_SOURCE)}範圍。尚未發售會另標「未上市」，缺少有效日期時保持未知。`;
  document.querySelector('[data-metric-label="viewers"]').textContent = d.legacy ? "取樣觀眾數" : "總觀眾人數";
  document.querySelector('[data-metric-label="streamers"]').textContent = d.legacy ? "取樣開台數" : "總開台數";
  if (d.legacy) {
    notice("舊版熱門取樣不列入新作清單","現有快照沒有新作判斷依據，不能僅憑觀眾數列為新作。新版資料發布後會自動切換。" );
  } else if (d.tracking_warning) {
    notice("持續追蹤清單暫時無法完整更新",d.tracking_registry ? "先保留已取得的追蹤名單與最新可讀取的量測；請稍後重新讀取。" : "目前只能呈現最新快照中可讀取的遊戲，追蹤總數可能不完整。請稍後重新讀取，不代表其他遊戲已結束追蹤。");
  } else if (d.mapping_warning) {
    notice("Steam 對照資訊暫時無法更新",d.steam_mapping ? "保留上次可讀取的 Steam 資訊與目前的 Twitch 觀測；請稍後重新讀取。" : "Twitch 觀測持續顯示，Steam 對照資訊等待更新。" );
  } else if (coverage.collection_complete !== true || d.invalidRows) {
    notice("這份快照有資料缺口",`本次資料的完整性未確認${d.invalidRows ? `，略過 ${d.invalidRows} 筆無效或重複資料` : ""}。以下只呈現可讀取的觀測。`);
  } else notice(null);
  const stale = Date.now() - Date.parse(d.generated_at) > 3 * 3600000;
  $("freshnessNote").hidden = !stale;
  $("freshnessNote").textContent = d.legacy ? "最近一份公開檔案仍為舊版，等待新版排程收集並發布。" : "這份快照已超過 3 小時未更新；以下是已保存的觀測，不代表目前直播狀態。";
  $("tableNote").textContent = d.legacy ? "不以熱門程度推定新作，也不以舊取樣補出中位數或日期推算結果。" : "篩選後中位數只計免費追隨者 > 1,000 且觀眾 ≥ 10 的頻道，並標示納入台數。總觀眾與總開台維持全體頻道統計。「上次觀測」數值只供參考，排序置於本輪量測之後。展開可查看逐時紀錄與 IGDB 日期推算。";
  exclusions(); pendingSteam();
}
return { render, metadata, notice };
}
