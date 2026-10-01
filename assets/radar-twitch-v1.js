/* Twitch observation UI. Only public static JSON is requested. */
(() => {
  "use strict";
  const D = window.RadarTwitch;
  const $ = id => document.getElementById(id);
  const number = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 });
  const dateTime = new Intl.DateTimeFormat("zh-TW", { timeZone:"Asia/Taipei", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" });
  const filterNames = { signals:"全部追蹤", twitch_new:"Twitch 熱門新作", steam_recent:"Steam 近期上市", all:"所有觀測", official:"官方全新", twitch:"Twitch 推算命中", igdb:"IGDB 推算命中", pending:"官方待確認" };
  const sourceNames = ["Twitch 日期", "IGDB 日期"];
  const state = { data:null, query:"", filter:D.DEFAULT_FILTER, sort:"viewers", limit:24, loading:false };
  const cards = new Map(), historyCache = new Map(), chartDisposers = new Set();
  let searchTimer, composing = false;
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }
  function fmt(value) { return value === null || value === undefined ? "—" : number.format(value); }
  function legacyRecovery(g) { return g.tracking?.enrollment?.source === "user_requested_legacy_recovery"; }
  function pendingLegacyMeasurement(g) { return legacyRecovery(g) && g.observation_status === "retained" && g.viewer_count == null && g.streamer_count == null; }
  function sourceWindow(source) { return state.data.source_windows[source].map(fmt).join("／") + " 天"; }
  function audienceNote(a) {
    if (a.status === "unavailable") return "待新條件收集";
    if (a.status === "invalid") return "資料待確認";
    if (a.status === "partial") return `待查 ${fmt(a.unknown_follower_count)} 台`;
    return a.eligible_streamer_count ? `${fmt(a.eligible_streamer_count)} 台符合條件` : "無符合條件頻道";
  }
  function audienceDetails(g) {
    const a = g.filtered_audience, section = node("section","tw-audience-details");
    section.append(node("h4","","中位數納入條件"),node("p","","免費追隨者 > 1,000，且本次觀眾 ≥ 10；追隨數使用 24 小時內取得的紀錄。遊戲總觀眾與總開台數涵蓋全體頻道。"));
    if (pendingLegacyMeasurement(g)) section.append(node("p","","尚未取得完整類別量測，舊版局部樣本不拿來計算目前觀眾數或中位數。"));
    else if (g.observation_status === "retained") section.append(node("p","",`以下是 ${time(g.observation_at)} 保存的樣本，等待本輪更新，並非目前直播數據。`));
    if (["complete","partial"].includes(a.status)) {
      const list = node("dl","tw-audience-counts");
      keyValue(list,"符合條件",`${fmt(a.eligible_streamer_count)} 台`);
      keyValue(list,"觀眾不足 10 人",`${fmt(a.excluded_low_viewer_count)} 台`);
      keyValue(list,"追隨者未超過 1,000",`${fmt(a.excluded_low_follower_count)} 台`);
      keyValue(list,"追隨數待查",`${fmt(a.unknown_follower_count)} 台`);
      section.append(list);
      if (a.status === "partial") section.append(node("p","","尚有頻道追隨數未確認，本次篩選後中位數暫不顯示，避免只用部分樣本造成誤判。"));
      else if (!a.eligible_streamer_count) section.append(node("p","","本次沒有符合兩項條件的頻道，因此沒有可計算的中位數；不是 0 人。"));
    } else section.append(node("p","",a.status === "unavailable" ? pendingLegacyMeasurement(g) ? "等待排程查詢全部直播頻道後，再依上述條件計算中位數。" : "這筆快照尚未收集上述條件，保留遊戲與原始總量，等待新版量測。" : "篩選規則或資料欄位不完整，暫不呈現此中位數。"));
    if (g.median_viewer_count != null) section.append(node("p","tw-unfiltered-reference",`全體頻道中位數（未篩選，僅供參考）：${fmt(g.median_viewer_count)} 人。`));
    return section;
  }
  function time(value) { return D.timestamp(value) ? dateTime.format(new Date(value)) : "尚無紀錄"; }
  function urlState() {
    const p = new URLSearchParams(location.search);
    state.query = (p.get("q") || "").slice(0,160);
    state.filter = Object.hasOwn(filterNames, p.get("state")) ? p.get("state") : D.DEFAULT_FILTER;
    state.sort = ["viewers","streamers","median"].includes(p.get("sort")) ? p.get("sort") : "viewers";
    state.limit = 24;
    $("gameSearch").value = state.query;
    $("gameSort").value = state.sort;
    document.querySelector(".tw-signal-filters").open = ![D.DEFAULT_FILTER,"twitch_new","steam_recent"].includes(state.filter);
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
  function steamDetails(g) {
    if (!g.steam_matches.length) return null;
    const section = node("section","tw-steam-details");
    section.append(node("h4","","Steam 遊戲資訊"));
    g.steam_matches.forEach(s => {
      const item = node("article","tw-steam-match"), heading = node("div","tw-steam-heading"), title = node("h5");
      const link = node("a","",s.display_name); link.href = `./game.html?appid=${encodeURIComponent(s.steam_appid)}`;
      title.append(link); heading.append(title);
      if (s.store_url) { const store = node("a","tw-steam-store","Steam 商店 ↗"); store.href = s.store_url; store.target = "_blank"; store.rel = "noopener noreferrer"; heading.append(store); }
      const dates = node("dl","tw-steam-facts");
      keyValue(dates,"Steam 台灣上市日",s.release_date || (s.release_at ? time(s.release_at) : "待確認"));
      keyValue(dates,"Steam 關注人數",s.followers == null ? "尚無資料" : `${fmt(s.followers)} 人`);
      keyValue(dates,"Steam 追蹤至",g.tracking?.tracking_sources?.[`steam:${s.steam_appid}`]?.expires_at ? time(g.tracking.tracking_sources[`steam:${s.steam_appid}`].expires_at) : "僅補充資訊");
      item.append(heading,dates);
      if (s.tags.length) {
        const tags = node("div","tw-steam-tags"); tags.setAttribute("aria-label",`${s.display_name} 的 Steam TAG`);
        s.tags.slice(0,8).forEach(tag => { const a = node("a","",s.tag_labels_zh_tw[tag] || tag); a.href = `./explore.html?tag=${encodeURIComponent(tag)}`; tags.append(a); });
        item.append(tags);
      }
      section.append(item);
    });
    section.append(node("p","tw-steam-note","直播數據為整個 Twitch 遊戲類別，涵蓋不同平台；封面沿用 Twitch。"));
    return section;
  }
  function trackingDetails(g, pendingLegacy) {
    const retention = node("section","tw-tracking-details"), dates = node("dl");
    retention.append(node("h4","","追蹤來源與期限"));
    keyValue(dates,"首次收錄",time(g.tracking?.first_seen_at));
    const releaseLabel = value => value?.release_source === "igdb_first_release_date" ? "IGDB 首次發售日" : value?.release_source === "twitch_original_release_date" ? "Twitch 原始發售日" : "追蹤依據日期";
    const sources = g.tracking?.tracking_sources;
    if (sources) Object.entries(sources).forEach(([key, source]) => {
      const label = key === "twitch_new" ? "Twitch 熱門新作" : `Steam · ${g.steam_matches.find(s => `steam:${s.steam_appid}` === key)?.display_name || source.steam_appid || key.slice(6)}`;
      const active = Boolean(g.active_tracking_sources[key]);
      keyValue(dates,label,active ? source.expires_at ? `追蹤至 ${time(source.expires_at)}` : "發售日期待確認，持續保留" : "此來源已結束追蹤");
      keyValue(dates,key === "twitch_new" ? releaseLabel(source) : "Steam 台灣上市日",time(source.release_at));
    });
    else { keyValue(dates,releaseLabel(g.tracking),time(g.tracking?.release_at)); keyValue(dates,"Twitch 追蹤至",g.tracking?.expires_at ? time(g.tracking.expires_at) : "待確認發售日期，持續保留"); }
    retention.append(dates,node("p","","各來源分別計算追蹤期限；任何一個來源仍有效，就會繼續每小時觀測。暫時無人開台也保留，結束追蹤後仍可查看已保存的歷史。"));
    if (legacyRecovery(g)) {
      retention.append(node("p","",`指定補回；舊版局部樣本不代表完整類別觀眾。${pendingLegacy ? "等待首次完整量測。" : "後續數值依實際量測時間顯示。"}`));
      const source = g.tracking.enrollment.legacy_sample?.source_url || g.tracking.enrollment.source_url;
      try { const url = new URL(source); if (url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password) { const link = node("a","tw-source-link","查看舊版收錄來源 ↗"); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; retention.append(link); } } catch {}
    }
    if (g.observation_status === "retained" && !pendingLegacy) retention.append(node("p","",`目前顯示 ${time(g.observation_at)} 的保存數值，等待新一輪更新。`));
    return retention;
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
      card.append(node("h4","",`${sourceNames[index]}・${fmt(p.window_days)} 天推算`),predictionBadge(p));
      const list = node("dl");
      keyValue(list,"發售時間",time(p.release_at));
      keyValue(list,"日期擷取",time(p.metadata_observed_at));
      keyValue(list,"推算時間",time(p.evaluated_at));
      if (p.source_name) keyValue(list,"資料來源",String(p.source_name));
      card.append(list);
      card.append(node("p","",p.predicted_new === null ? (p.reason === "metadata_expired_or_future" ? "日期資料的有效時間不符本次量測，等待更新後再推算。" : "缺少有效日期，暫時無法推算。") : p.release_phase === "upcoming" ? "尚未發售也會命中這項規則；不代表已經上市或官方標示全新。" : `以快照當下距發售是否未滿 ${fmt(p.window_days)} 天判斷；此結果不確認官方 NEW 標記。`));
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
    const summary = node("summary","tw-history-toggle");
    summary.append(node("span","tw-history-title","查看逐時紀錄"),node("span","tw-history-kind","互動折線圖 · 24 小時"));
    details.append(summary);
    const content = node("div","tw-history-content"); details.append(content);
    let loaded = false, disposeChart = null, requestVersion = 0;
    async function renderHistory() {
      loaded = true;
      const version = ++requestVersion, snapshot = state.data;
      if (disposeChart) { disposeChart(); chartDisposers.delete(disposeChart); disposeChart = null; }
      content.replaceChildren(node("p","","正在讀取已保存的逐時紀錄…"));
      const anchor = snapshot.generated_at;
      const days = D.historyDays(anchor);
      const results = await Promise.allSettled(days.map(day => {
        if (!historyCache.has(day)) historyCache.set(day,readJSON(`./data/twitch_history/${day}.json`,true).then(file => {
          if (file && (file.schema_version !== 1 || file.date !== day || file.timezone !== "Asia/Taipei" || !file.hours || typeof file.hours !== "object")) throw new Error("INVALID_HISTORY");
          return file;
        }));
        return historyCache.get(day);
      }));
      if (version !== requestVersion || state.data !== snapshot) return;
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
      const chart = node("div","tw-history-chart"); content.append(chart);
      disposeChart = window.RadarTwitchChart.mount(chart,{ rows,gameName:g.game_name,anchor });
      chartDisposers.add(disposeChart);
      content.append(node("p","tw-history-note",`台灣時間 · 截至 ${time(anchor)}。總觀眾與開台為全體統計；篩選中位數只計追隨者 > 1,000 且觀眾 ≥ 10 的頻道。缺測及未入列保留空缺，不補成 0。`));
    }
    details.addEventListener("toggle",() => { if (details.open && !loaded) renderHistory(); });
    return details;
  }
  function gameCard(g) {
    const pendingLegacy = pendingLegacyMeasurement(g);
    const card = node("details","tw-game"); card.dataset.gameId = g.game_id; card.dataset.observation = g.observation_status;
    const summary = node("summary","tw-game-summary");
    const identity = node("div","tw-game-identity"), cover = node("span","tw-cover",g.game_name.charAt(0).toUpperCase()); cover.setAttribute("aria-hidden","true");
    if (g.box_art_url) {
      const image = node("img"); image.src = g.box_art_url; image.alt = ""; image.width = 144; image.height = 192; image.loading = "lazy"; image.decoding = "async";
      image.addEventListener("error",() => image.remove(),{ once:true }); cover.append(image);
    }
    const title = node("div","tw-game-title"); title.append(node("h3","",g.game_name),node("p","",`${g.twitch_name !== g.game_name ? g.twitch_name + " · " : ""}CATEGORY ${g.game_id}`));
    const labels = node("div","tw-source-labels");
    if (D.matches(g,"twitch_new")) labels.append(node("span","tw-tracking-label","Twitch 熱門新作"));
    if (g.is_steam_recent) labels.append(node("span","tw-tracking-label tw-steam-label","Steam 近期上市"));
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
    [officialBadge(g),...D.SOURCES.map(source => predictionBadge(g.release_experiment[source]))].forEach((b,i) => { const line = node("span","tw-signal"); line.append(node("span","",["官方觀測","Twitch 日期","IGDB 日期"][i]),b); signals.append(line); });
    const mark = node("span","tw-open-mark","+"); mark.setAttribute("aria-hidden","true"); summary.append(signals,mark); card.append(summary);
    let built = false;
    card.addEventListener("toggle",() => {
      if (!card.open || built) return;
      built = true;
      const body = node("div","tw-game-body"), line = node("p","tw-observation-line");
      line.append(node("span","",pendingLegacy ? "舊版補回・待首次完整量測，尚無完整類別觀眾與開台數。" : state.data.legacy ? "此筆來自舊版全球直播取樣，沒有完整類別量測。" : `量測 ${time(g.measurement_started_at)} → ${time(g.measurement_finished_at)}${g.pagination_complete === true ? " · 已讀完該類別分頁" : " · 分頁完整性未確認"}`));
      body.append(line);
      if (g.is_tracked) body.append(trackingDetails(g,pendingLegacy));
      const steamInfo = steamDetails(g); if (steamInfo) body.append(steamInfo);
      if (!state.data.legacy) body.append(historyPanel(g));
      body.append(audienceDetails(g),evidence(g));
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
    $("viewNotice").hidden = legacy || state.filter === D.DEFAULT_FILTER;
    document.querySelector(".tw-column-head").hidden = legacy;
    $("candidatesTitle").textContent = state.filter === "all" ? "所有觀測" : state.filter === "pending" ? "官方待確認候選" : ["twitch_new","steam_recent"].includes(state.filter) ? filterNames[state.filter] : "新作觀測";
    if (legacy) {
      $("resultsStatus").textContent = "新版新作觀測尚未發布";
      $("gameResults").replaceChildren(empty("等待新版新作觀測","現有檔案是未經新作篩選的舊版熱門取樣，暫不列入。新版排程成功發布後，這裡會自動顯示新作線索。"));
      $("gameResults").setAttribute("aria-busy","false"); $("loadMore").hidden = true;
      return;
    }
    $("viewNotice").textContent = state.filter === "twitch_new" ? "涵蓋不同平台的新作，未配對 Steam 也會持續觀測。" : state.filter === "steam_recent" ? "本站已收錄、Steam 台灣上市未滿 30 天且已配對 Twitch 類別的遊戲；不受 7,000 人門檻限制。" : state.filter === "all" ? "包含持續追蹤的新作與本輪達標候選。尚未確認的候選不會僅因熱門就自動加入新作追蹤。" : state.filter === "pending" ? "這些候選尚未確認官方全新標記；即使有日期推算結果，也不等於官方已確認。" : state.filter === "official" ? "只列快照中有效的官方全新觀測；請展開核對觀測時間。" : state.filter === D.DEFAULT_FILTER ? "" : `只列 ${state.filter === "twitch" ? "Twitch" : "IGDB"} 日期 ${sourceWindow(D.SOURCES[state.filter === "twitch" ? 0 : 1])}推算命中的遊戲；以各筆快照規則為準，不等於官方全新。`;
    $("resultsStatus").textContent = `${visible.length} 款 · ${filterNames[state.filter]}${visible.length > state.limit ? ` · 顯示前 ${state.limit} 款` : ""}`;
    const fragment = document.createDocumentFragment();
    visible.slice(0,state.limit).forEach(g => {
      if (!cards.has(g.game_id)) cards.set(g.game_id,gameCard(g));
      fragment.append(cards.get(g.game_id));
    });
    if (!visible.length) {
      const noSignals = games.length && state.filter === D.DEFAULT_FILTER && !state.query;
      const showAll = () => { state.filter = "all"; state.limit = 24; render(); syncURL(); };
      fragment.append(empty(noSignals ? "目前還沒有追蹤中的新作" : games.length ? "這個條件下，還沒有結果" : "目前沒有可呈現的觀測",noSignals ? "目前候選尚無有效的全新觀測或日期推算命中。可以另外查看全部候選，但它們不代表已確認的新作。" : games.length ? "試著調整關鍵字或重設篩選。未取得觀測與日期，不會自動算成全新。" : "這份快照沒有可呈現的達標遊戲。下一輪有資料後會出現在這裡。",noSignals ? showAll : games.length ? reset : null,noSignals ? "查看所有觀測" : "重設篩選"));
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
      const reason = g.reason === "non_game_category" ? "非遊戲類別 · 未量測觀眾" : g.reason === "observed_not_new" ? "已有非全新觀測 · 未量測觀眾" : g.reason === "tracking_expired" ? "發售已滿 30 天 · 已結束追蹤，保留歷史" : g.reason === "igdb_release_outside_window" ? `IGDB 日期未命中 ${fmt(g.release_experiment.igdb_first_release_date.window_days)} 天範圍 · 已停止本輪觀眾與追隨數收集` : "已排除 · 原因待確認";
      card.append(summary,node("p","",reason));
      let built = false; card.addEventListener("toggle",() => { if (card.open && !built) { built = true; card.append(evidence(g)); } }); fragment.append(card);
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
    $("twitchDateGuide").textContent = `使用有來源記錄的 Twitch 原始發售日期；本次快照採 ${sourceWindow(D.SOURCES[0])}範圍。未來發售也會命中，詳細規則見各款明細。`;
    $("igdbDateGuide").textContent = `使用 IGDB 首次發售日期；本次快照採 ${sourceWindow(D.SOURCES[1])}範圍。結果獨立保留；缺少 Twitch 日期時，不拿它冒充。`;
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
    $("tableNote").textContent = d.legacy ? "不以熱門程度推定新作，也不以舊取樣補出中位數或全新標記。" : "篩選後中位數只計免費追隨者 > 1,000 且觀眾 ≥ 10 的頻道，並標示納入台數。總觀眾與總開台維持全體頻道統計。「上次觀測」數值只供參考，排序置於本輪量測之後。展開可核對追蹤期限與樣本。";
    exclusions(); pendingSteam();
  }
  async function load() {
    if (state.loading) return;
    state.loading = true; $("snapshotRefresh").disabled = true; $("gameResults").setAttribute("aria-busy","true");
    $("resultsStatus").textContent = "正在讀取最新公開快照…";
    try {
      const [liveResult, trackingResult, mappingResult] = await Promise.allSettled([readJSON("./data/twitch_live.json"),readJSON("./data/twitch_tracking.json",true),readJSON("./data/twitch_steam_mapping.json",true)]);
      if (liveResult.status !== "fulfilled") throw liveResult.reason;
      const previousRegistry = state.data?.tracking_registry, previousMapping = state.data?.steam_mapping;
      let suppliedRegistry = trackingResult.status === "fulfilled" && trackingResult.value != null ? trackingResult.value : previousRegistry;
      let suppliedMapping = mappingResult.status === "fulfilled" && mappingResult.value != null ? mappingResult.value : previousMapping;
      let data = D.normalize(liveResult.value,suppliedRegistry,suppliedMapping);
      const invalidTracking = data.tracking_registry_invalid, invalidMapping = data.steam_mapping_invalid;
      if (invalidTracking) suppliedRegistry = previousRegistry;
      if (invalidMapping) suppliedMapping = previousMapping;
      if (invalidTracking || invalidMapping) data = D.normalize(liveResult.value,suppliedRegistry,suppliedMapping);
      data.tracking_warning = trackingResult.status !== "fulfilled" || (trackingResult.value == null && Boolean(previousRegistry)) || invalidTracking;
      data.mapping_warning = mappingResult.status !== "fulfilled" || (mappingResult.value == null && Boolean(previousMapping)) || invalidMapping;
      const same = data.generated_at === state.data?.generated_at && data.tracking_registry?.updated_at === state.data?.tracking_registry?.updated_at && data.steam_mapping?.updated_at === state.data?.steam_mapping?.updated_at;
      chartDisposers.forEach(dispose => dispose()); chartDisposers.clear();
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
