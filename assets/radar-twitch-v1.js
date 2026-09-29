/* Twitch observation UI. Only public static JSON is requested. */
(() => {
  "use strict";
  const D = window.RadarTwitch;
  const $ = id => document.getElementById(id);
  const number = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 });
  const dateTime = new Intl.DateTimeFormat("zh-TW", { timeZone:"Asia/Taipei", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" });
  const hourTime = new Intl.DateTimeFormat("zh-TW", { timeZone:"Asia/Taipei", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" });
  const filterNames = { signals:"新作線索", all:"全部候選", official:"官方全新", twitch:"Twitch 推算命中", igdb:"IGDB 推算命中", pending:"官方待確認" };
  const sourceNames = ["Twitch 日期", "IGDB 日期"];
  const state = { data:null, query:"", filter:D.DEFAULT_FILTER, sort:"viewers", limit:24, loading:false };
  const cards = new Map(), historyCache = new Map();
  let searchTimer, composing = false;
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }
  function fmt(value) { return value === null || value === undefined ? "—" : number.format(value); }
  function time(value) { return D.timestamp(value) ? dateTime.format(new Date(value)) : "尚無紀錄"; }
  function urlState() {
    const p = new URLSearchParams(location.search);
    state.query = (p.get("q") || "").slice(0,160);
    state.filter = Object.hasOwn(filterNames, p.get("state")) ? p.get("state") : D.DEFAULT_FILTER;
    state.sort = ["viewers","streamers","median"].includes(p.get("sort")) ? p.get("sort") : "viewers";
    state.limit = 24;
    $("gameSearch").value = state.query;
    $("gameSort").value = state.sort;
  }
  function syncURL() {
    const url = new URL(location.href);
    for (const [key,value,defaultValue] of [["q",state.query,""],["state",state.filter,D.DEFAULT_FILTER],["sort",state.sort,"viewers"]]) {
      if (value === defaultValue) url.searchParams.delete(key); else url.searchParams.set(key,value);
    }
    history.replaceState(null,"",url);
  }
  function badge(text, tone = "unknown") {
    const el = node("span","tw-state",text); el.dataset.tone = tone; return el;
  }
  function officialBadge(g) {
    const v = g.verification;
    return v.status === "new" ? badge("曾見全新","official") : v.status === "not_new" ? badge("曾見非全新","no") : badge(state.data.legacy ? "未收集" : "待確認");
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
    const wrapper = node("div"), grid = node("div","tw-evidence-grid"), v = g.verification;
    const official = node("section","tw-evidence-card");
    official.append(node("h4","","官方全新觀測"),officialBadge(g));
    const officialList = node("dl");
    keyValue(officialList,"觀測時間",time(v.observed_at));
    keyValue(officialList,"有效期限",time(v.expires_at));
    official.append(officialList);
    official.append(node("p","",v.status === "pending" ? (v.previous_status ? "先前觀測已失效，這次保持待確認。" : "尚未取得可用的官方標記觀測；不以發售日期代替。") : v.expires_at && Date.parse(v.expires_at) <= Date.now() ? "這筆觀測的有效期已過，不能代表目前的官方標記。" : "此為記錄時間點的觀測，並非即時查詢。"));
    sourceLink(official,v.source_url,"查看觀測來源");
    grid.append(official);
    D.SOURCES.forEach((source,index) => {
      const p = g.release_experiment[source], card = node("section","tw-evidence-card");
      card.append(node("h4","",sourceNames[index] + "・14 天推算"),predictionBadge(p));
      const list = node("dl");
      keyValue(list,"發售時間",time(p.release_at));
      keyValue(list,"日期擷取",time(p.metadata_observed_at));
      keyValue(list,"推算時間",time(p.evaluated_at));
      if (p.source_name) keyValue(list,"資料來源",String(p.source_name));
      card.append(list);
      card.append(node("p","",p.predicted_new === null ? (p.reason === "metadata_expired_or_future" ? "日期資料的有效時間不符本次量測，等待更新後再推算。" : "缺少有效日期，暫時無法推算。") : p.release_phase === "upcoming" ? "尚未發售也會命中這項規則；不代表已經上市或官方標示全新。" : "以快照當下距發售是否未滿 14 天判斷；此結果不確認官方 NEW 標記。"));
      sourceLink(card,p.source_url,"查看日期來源");
      grid.append(card);
    });
    wrapper.append(grid);
    const checks = state.data.reference_checks.filter(c => c.game_id === g.game_id && D.SOURCES.includes(c.source) && typeof c.agrees_with_reference === "boolean");
    if (checks.length) {
      const ref = node("div","tw-reference");
      checks.forEach(c => ref.append(node("p","",`${sourceNames[D.SOURCES.indexOf(c.source)]}：${c.agrees_with_reference ? "與當時標記一致" : "與當時標記不同"}（${c.comparison_kind === "same_timestamp" ? "同時點對照" : "回溯對照"}，官方觀測 ${time(c.badge_observed_at)}）。`)));
      ref.append(node("p","","回溯對照是將發售資料套回較早的觀測時間，不能視為官方規則驗證或準確率。"));
      wrapper.append(ref);
    }
    return wrapper;
  }
  async function readJSON(path, optional = false) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(),15000);
    try {
      const response = await fetch(path,{ cache:"no-cache",signal:controller.signal });
      if (optional && response.status === 404) return null;
      if (!response.ok) throw new Error("HTTP_" + response.status);
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  function historyPanel(g) {
    const details = node("details","tw-history");
    details.append(node("summary","","查看逐時紀錄 · 最近 24 小時"));
    const content = node("div","tw-history-content"); details.append(content);
    let loaded = false;
    async function renderHistory() {
      loaded = true;
      content.replaceChildren(node("p","","正在讀取已保存的逐時紀錄…"));
      const anchor = state.data.generated_at;
      const days = D.historyDays(anchor);
      const results = await Promise.allSettled(days.map(day => {
        if (!historyCache.has(day)) historyCache.set(day,readJSON(`./data/twitch_history/${day}.json`,true).then(file => {
          if (file && (file.schema_version !== 1 || file.date !== day || file.timezone !== "Asia/Taipei" || !file.hours || typeof file.hours !== "object")) throw new Error("INVALID_HISTORY");
          return file;
        }));
        return historyCache.get(day);
      }));
      const files = results.filter(r => r.status === "fulfilled").map(r => r.value).filter(Boolean);
      const failed = results.some(r => r.status === "rejected");
      const rows = D.historyRows(files,g.game_id,anchor);
      content.replaceChildren();
      if (failed) {
        content.append(node("p","","部分歷史檔案暫時無法讀取，以下僅顯示已取得的紀錄。"));
        const retry = node("button","tw-text-button","重新讀取歷史"); retry.type = "button";
        retry.addEventListener("click",() => { historyCache.clear(); renderHistory(); }); content.append(retry);
      }
      if (!rows.some(r => r.status === "observed")) {
        content.append(node("p","","這段期間尚無此遊戲可讀取的逐時紀錄。歷史會在新版排程保存資料後出現；缺測不計為 0。")); return;
      }
      content.append(node("p","",`以 ${time(anchor)} 這筆快照為截止點。未入列可能是未達門檻或已排除，不代表零觀眾；缺測保留空白。`));
      const table = node("table","tw-history-table"), caption = node("caption","sr-only",g.game_name + " 最近 24 小時實測紀錄，台灣時間");
      const head = node("thead"), tr = node("tr");
      ["時間 / 狀態","觀眾","開台","中位數"].forEach(label => { const th = node("th","",label); th.scope = "col"; tr.append(th); }); head.append(tr);
      const body = node("tbody");
      rows.slice().reverse().forEach(row => {
        const line = node("tr"), cell = node("td","",hourTime.format(new Date(row.hour)));
        cell.append(node("small","",row.status === "observed" ? "有紀錄" : row.status === "absent" ? "該次未入列" : "無可用紀錄"));
        if (row.generated_at) cell.title = "實際快照 " + time(row.generated_at);
        line.append(cell);
        ["viewer_count","streamer_count","median_viewer_count"].forEach(key => line.append(node("td","",fmt(row[key])))); body.append(line);
      });
      table.append(caption,head,body);
      const scroll = node("div","tw-history-scroll"); scroll.tabIndex = 0; scroll.setAttribute("role","region"); scroll.setAttribute("aria-label",g.game_name + " 逐時紀錄，可上下捲動");
      scroll.append(table); content.append(scroll);
    }
    details.addEventListener("toggle",() => { if (details.open && !loaded) renderHistory(); });
    return details;
  }
  function gameCard(g) {
    const card = node("details","tw-game"); card.dataset.gameId = g.game_id;
    const summary = node("summary","tw-game-summary");
    const identity = node("div","tw-game-identity"), cover = node("span","tw-cover",g.game_name.charAt(0).toUpperCase()); cover.setAttribute("aria-hidden","true");
    if (g.box_art_url) {
      const image = node("img"); image.src = g.box_art_url; image.alt = ""; image.width = 144; image.height = 192; image.loading = "lazy"; image.decoding = "async";
      image.addEventListener("error",() => image.remove(),{ once:true }); cover.append(image);
    }
    const title = node("div","tw-game-title"); title.append(node("h3","",g.game_name),node("p","","CATEGORY " + g.game_id)); identity.append(cover,title); summary.append(identity);
    const metricNames = state.data.legacy ? ["取樣觀眾數","取樣開台數","觀眾中位數"] : ["觀眾人數","開台數","觀眾中位數"];
    ["viewer_count","streamer_count","median_viewer_count"].forEach((key,i) => {
      const metric = node("div","tw-metric"); metric.dataset.kind = ["viewers","streamers","median"][i];
      metric.append(node("span","tw-metric-label",metricNames[i]),node("strong","",fmt(g[key])),node("small","",g[key] == null ? "尚未收集" : i === 1 ? "個頻道" : "人")); summary.append(metric);
    });
    const signals = node("div","tw-signals");
    [officialBadge(g),...D.SOURCES.map(source => predictionBadge(g.release_experiment[source]))].forEach((b,i) => { const line = node("span","tw-signal"); line.append(node("span","",["官方觀測","Twitch 日期","IGDB 日期"][i]),b); signals.append(line); });
    const mark = node("span","tw-open-mark","+"); mark.setAttribute("aria-hidden","true"); summary.append(signals,mark); card.append(summary);
    let built = false;
    card.addEventListener("toggle",() => {
      if (!card.open || built) return;
      built = true;
      const body = node("div","tw-game-body"), line = node("p","tw-observation-line");
      line.append(node("span","",state.data.legacy ? "此筆來自舊版全球直播取樣，沒有完整類別量測。" : `量測 ${time(g.measurement_started_at)} → ${time(g.measurement_finished_at)}${g.pagination_complete === true ? " · 已讀完該類別分頁" : " · 分頁完整性未確認"}`));
      body.append(line,evidence(g));
      if (!state.data.legacy) body.append(historyPanel(g));
      card.append(body);
    });
    return card;
  }
  function empty(title, message, action, label) {
    const div = node("div","tw-empty"), symbol = node("span","","◎"); symbol.setAttribute("aria-hidden","true");
    div.append(symbol,node("h3","",title),node("p","",message));
    if (action) { const button = node("button","",label); button.type = "button"; button.addEventListener("click",action); div.append(button); }
    return div;
  }
  function reset() {
    clearTimeout(searchTimer); state.query = ""; state.filter = D.DEFAULT_FILTER; state.sort = "viewers"; state.limit = 24;
    $("gameSearch").value = ""; $("gameSort").value = "viewers"; render(); syncURL();
  }
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
    $("resetFilters").hidden = legacy || (!state.query && state.filter === D.DEFAULT_FILTER && state.sort === "viewers");
    $("viewNotice").hidden = legacy;
    document.querySelector(".tw-column-head").hidden = legacy;
    $("candidatesTitle").textContent = state.filter === "all" ? "全部候選" : state.filter === "pending" ? "官方待確認候選" : "新作觀測";
    if (legacy) {
      $("resultsStatus").textContent = "新版新作觀測尚未發布";
      $("gameResults").replaceChildren(empty("等待新版新作觀測","現有檔案是未經新作篩選的舊版熱門取樣，暫不列入。新版排程成功發布後，這裡會自動顯示新作線索。"));
      $("gameResults").setAttribute("aria-busy","false"); $("loadMore").hidden = true;
      return;
    }
    $("viewNotice").textContent = state.filter === "all" ? "全部候選包含尚未確認的遊戲；達到觀眾門檻，不代表是新作。" : state.filter === "pending" ? "這些候選尚未確認官方全新標記；即使有日期推算結果，也不等於官方已確認。" : state.filter === "official" ? "只列快照中有效的官方全新觀測；請展開核對觀測時間。" : state.filter === D.DEFAULT_FILTER ? "只列官方曾見全新或日期推算命中的遊戲；日期推算仍屬實驗，不等於官方全新。" : `只列 ${state.filter === "twitch" ? "Twitch" : "IGDB"} 日期推算命中的遊戲；推算仍屬實驗，不等於官方全新。`;
    $("resultsStatus").textContent = `${visible.length} 款 · ${filterNames[state.filter]}${visible.length > state.limit ? ` · 顯示前 ${state.limit} 款` : ""}`;
    const fragment = document.createDocumentFragment();
    visible.slice(0,state.limit).forEach(g => {
      if (!cards.has(g.game_id)) cards.set(g.game_id,gameCard(g));
      fragment.append(cards.get(g.game_id));
    });
    if (!visible.length) {
      const noSignals = games.length && state.filter === D.DEFAULT_FILTER && !state.query;
      const showAll = () => { state.filter = "all"; state.limit = 24; render(); syncURL(); };
      fragment.append(empty(noSignals ? "目前還沒有新作線索" : games.length ? "這個條件下，還沒有結果" : "這次沒有達標候選",noSignals ? "目前候選尚無有效的全新觀測或日期推算命中。可以另外查看全部候選，但它們不代表已確認的新作。" : games.length ? "試著調整關鍵字或重設篩選。未取得觀測與日期，不會自動算成全新。" : "這份快照沒有可呈現的達標遊戲。下一輪有資料後會出現在這裡。",noSignals ? showAll : games.length ? reset : null,noSignals ? "查看全部候選" : "重設篩選"));
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
      card.append(summary,node("p","",g.reason === "non_game_category" ? "非遊戲類別 · 未量測觀眾" : g.reason === "observed_not_new" ? "已有非全新觀測 · 未量測觀眾" : "已排除 · 原因待確認"));
      let built = false; card.addEventListener("toggle",() => { if (card.open && !built) { built = true; card.append(evidence(g)); } }); fragment.append(card);
    });
    $("excludedGames").replaceChildren(fragment);
  }
  function notice(title,message) {
    $("snapshotNotice").hidden = !title;
    $("noticeTitle").textContent = title || ""; $("noticeText").textContent = message || "";
  }
  function metadata() {
    const d = state.data, coverage = d.coverage;
    $("snapshotTime").textContent = time(d.generated_at); $("snapshotTime").dateTime = d.generated_at;
    $("scopeLabel").textContent = `${d.legacy ? "等待新版觀測" : "全球觀測"} · 觀眾 ≥ ${fmt(d.threshold)}`;
    document.querySelector('[data-metric-label="viewers"]').textContent = d.legacy ? "取樣觀眾數" : "觀眾人數";
    document.querySelector('[data-metric-label="streamers"]').textContent = d.legacy ? "取樣開台數" : "開台數";
    if (d.legacy) {
      notice("舊版熱門取樣不列入新作清單","現有快照沒有新作判斷依據，不能僅憑觀眾數列為新作。新版資料發布後會自動切換。" );
    } else if (coverage.collection_complete !== true || d.invalidRows) {
      notice("這份快照有資料缺口",`本次資料的完整性未確認${d.invalidRows ? `，略過 ${d.invalidRows} 筆無效或重複資料` : ""}。以下只呈現可讀取的觀測。`);
    } else notice(null);
    const stale = Date.now() - Date.parse(d.generated_at) > 3 * 3600000;
    $("freshnessNote").hidden = !stale;
    $("freshnessNote").textContent = d.legacy ? "最近一份公開檔案仍為舊版，等待新版排程收集並發布。" : "這份快照已超過 3 小時未更新；以下是已保存的觀測，不代表目前直播狀態。";
    $("tableNote").textContent = d.legacy ? "不以熱門程度推定新作，也不以舊取樣補出中位數或全新標記。" : "中位數以各開台頻道的觀眾人數計算，不是平均值。各類別依序量測；展開遊戲可核對時間與判讀依據。";
    exclusions();
  }
  async function load() {
    if (state.loading) return;
    state.loading = true; $("snapshotRefresh").disabled = true; $("gameResults").setAttribute("aria-busy","true");
    $("resultsStatus").textContent = "正在讀取最新公開快照…";
    try {
      const data = D.normalize(await readJSON("./data/twitch_live.json"));
      const same = data.generated_at === state.data?.generated_at;
      state.data = data; cards.clear(); historyCache.clear();
      metadata(); render();
      if (same) $("resultsStatus").textContent += " · 已是最新公開快照";
    } catch {
      if (state.data) {
        notice("暫時無法更新，保留上次讀取的快照","可以稍後按右上方重新讀取；目前的量測時間保持不變。"); render();
      } else {
        $("snapshotTime").textContent = "暫時無法讀取";
        $("resultsStatus").textContent = "資料尚未就緒";
        $("gameResults").replaceChildren(empty("觀測資料暫時無法讀取","可能尚未發布，或檔案暫時無法取得。你可以稍後重新讀取。",load,"重新讀取資料 ↻"));
      }
    } finally { state.loading = false; $("snapshotRefresh").disabled = false; $("gameResults").setAttribute("aria-busy","false"); }
  }
  function savedCount() {
    let count = 0;
    try { const value = JSON.parse(localStorage.getItem("game-trend-radar:saved:v1") || "[]"); if (Array.isArray(value)) count = new Set(value.filter(id => Number.isInteger(id) && id > 0)).size; } catch {}
    document.querySelectorAll("[data-saved-count]").forEach(el => { el.textContent = count; });
  }
  document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click",() => { clearTimeout(searchTimer); state.query = $("gameSearch").value; state.filter = button.dataset.filter; state.limit = 24; render(); syncURL(); }));
  function search() { clearTimeout(searchTimer); if (composing) return; searchTimer = setTimeout(() => { state.query = $("gameSearch").value; state.limit = 24; render(); syncURL(); },140); }
  $("gameSearch").addEventListener("compositionstart",() => { composing = true; clearTimeout(searchTimer); });
  $("gameSearch").addEventListener("compositionend",() => { composing = false; search(); });
  $("gameSearch").addEventListener("input",search);
  $("gameSort").addEventListener("change",() => { state.sort = $("gameSort").value; render(); syncURL(); });
  $("resetFilters").addEventListener("click",reset);
  $("snapshotRefresh").addEventListener("click",load);
  $("loadMore").addEventListener("click",() => { const next = state.limit; state.limit += 24; render(); $("gameResults").children[next]?.querySelector("summary")?.focus({ preventScroll:true }); });
  document.addEventListener("keydown",event => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "/" && !event.target.closest("input,textarea,select,[contenteditable]")) { event.preventDefault(); $("gameSearch").focus(); }
    if (event.key === "Escape" && event.target === $("gameSearch")) { clearTimeout(searchTimer); $("gameSearch").value = ""; state.query = ""; state.limit = 24; render(); syncURL(); }
  });
  window.addEventListener("popstate",() => { clearTimeout(searchTimer); urlState(); render(); });
  window.addEventListener("storage",savedCount);
  urlState(); savedCount(); load();
})();
