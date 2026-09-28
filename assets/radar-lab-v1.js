/* Growth rankings and the experimental comparison page share accepted catalog data. */
(() => {
  "use strict";
  const D = window.RadarData, R = window.RadarDiscovery, I = window.RadarInsights;
  const E = window.RadarEnhancements;
  const $ = id => document.getElementById(id);
  const node = E.make;
  const today = D.todayInTaipei();
  const number = new Intl.NumberFormat("zh-TW");
  const mode = document.body.dataset.page;
  const params = new URLSearchParams(location.search);
  let games = [], observations = new Map(), rawCatalog = null, growthData = null;
  let span = [1, 7, 30].includes(Number(params.get("days"))) ? Number(params.get("days")) : 7;
  let scope = ["all", "future", "released"].includes(params.get("period")) ? params.get("period") : "all";
  let sort = params.get("sort") === "percent" ? "percent" : "delta";
  let limit = 25, searchTimer, initialized = false;
  const signed = value => `${value > 0 ? "+" : ""}${number.format(value)}`;
  const percent = value => value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
  const dateText = value => value?.replaceAll("-", "/") || "—";
  const statusText = status => ({ missing: "尚無有效量測", stale: "等待更新", accumulating: "歷史累積中" })[status] || "";
  function history(game) {
    const stored = observations.get(game.appid)?.history || [];
    const row = rawCatalog?.games.find(value => Number(value.appid) === game.appid);
    return [...stored, ...(row?.follower_checked_at ? [{ at: row.follower_checked_at, followers: row.followers, source: "steam_community" }] : [])];
  }
  function cover(game, className = "lab-cover") {
    const box = node("div", className);
    box.append(E.illustration("rocket"));
    if (!game.art) return box;
    const img = node("img");
    img.alt = ""; img.width = 616; img.height = 288; img.loading = "lazy"; img.decoding = "async";
    window.RadarArtwork.load(img, game, { onLoad: () => box.classList.add("has-art"), onExhausted: () => img.remove() });
    box.append(img);
    return box;
  }
  function gameLink(game) {
    const a = node("a", "lab-game-name", game.name);
    a.href = `./game.html?appid=${game.appid}`;
    return a;
  }
  function badges(game) {
    const box = node("div", "card-languages");
    for (const item of game.languageBadges) box.append(node("span", `card-language language-${item.status}`, item.label));
    return box;
  }
  function sparkline(series) {
    const box = node("div", "growth-sparkline");
    const values = series.slice(-31);
    if (values.length < 2) { box.append(node("span", "", "累積更多量測後顯示曲線")); return box; }
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 180 42");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${dateText(values[0].day)} 至 ${dateText(values.at(-1).day)}，${values.length} 次日量測，由 ${number.format(values[0].followers)} 至 ${number.format(values.at(-1).followers)} 人關注；獨立刻度`);
    const min = Math.min(...values.map(p => p.followers)), max = Math.max(...values.map(p => p.followers));
    const first = Date.parse(values[0].day), elapsed = Date.parse(values.at(-1).day) - first || 1;
    const line = document.createElementNS(ns, "polyline");
    line.setAttribute("points", values.map(p => `${4 + (Date.parse(p.day) - first) / elapsed * 172},${max === min ? 21 : 36 - (p.followers - min) / (max - min) * 30}`).join(" "));
    line.setAttribute("fill", "none"); line.setAttribute("stroke", "currentColor"); line.setAttribute("stroke-width", "2.5");
    svg.append(line); box.append(svg);
    return box;
  }
  function saveURL() {
    const url = new URL(location.href);
    if (mode === "growth") {
      for (const [key, value] of [["q", $("growthSearch").value.trim()], ["days", span === 7 ? "" : span], ["period", scope === "all" ? "" : scope], ["sort", sort === "delta" ? "" : sort]]) {
        if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
      }
    } else {
      const ids = window.RadarCompare.ids();
      if (ids.length) url.searchParams.set("ids", ids.join(",")); else url.searchParams.delete("ids");
    }
    window.history.replaceState(window.history.state, "", url);
  }
  function empty(kind, title, text) {
    const box = node("div", "lab-empty");
    box.append(E.illustration(kind), node("h2", "", title), node("p", "", text));
    return box;
  }
  function growthRow(entry, index) {
    const { game, metric } = entry;
    const row = node("article", "growth-row");
    row.dataset.appid = game.appid;
    row.append(node("span", "growth-rank", String(index + 1).padStart(2, "0")), cover(game));
    const copy = node("div", "growth-game-copy");
    copy.append(gameLink(game), node("p", "", `${dateText(game.date)} 上市${game.date <= today ? " · 上市後追蹤中" : " · 未上市"}`));
    row.append(copy);
    const change = node("div", "growth-change" + (metric.delta < 0 ? " is-down" : ""));
    change.append(node("strong", "", signed(metric.delta)), node("small", "", `${percent(metric.percent)} · ${span} 日新增關注`));
    row.append(change, sparkline(metric.series));
    const total = node("div", "growth-total");
    total.append(node("strong", "", number.format(metric.latest.followers)), node("small", "", `${dateText(metric.latest.day)} 量測`));
    row.append(total);
    return row;
  }
  function renderGrowth() {
    const term = $("growthSearch").value.trim().toLocaleLowerCase();
    const eligible = games.filter(game => I.tracking(game.date, today) && game.date <= I.offset(today, 365) &&
      (!term || `${game.name} ${game.nameEn} ${game.appid}`.toLocaleLowerCase().includes(term)) &&
      (scope === "all" || (scope === "future" ? game.date > today : game.date <= today)));
    const entries = eligible.map(game => ({ game, metric: I.metric(history(game), span, today) }));
    const ready = entries.filter(entry => entry.metric.status === "ready");
    ready.sort((a, b) => (sort === "percent" ? (b.metric.percent ?? -Infinity) - (a.metric.percent ?? -Infinity) : b.metric.delta - a.metric.delta) || b.game.followers - a.game.followers || a.game.appid - b.game.appid);
    const pending = entries.filter(entry => entry.metric.status !== "ready");
    $("growthRanked").textContent = number.format(ready.length);
    $("growthTracked").textContent = number.format(eligible.length);
    $("growthPending").textContent = number.format(pending.length);
    $("growthResultCount").textContent = `${span} 日成長榜 · ${ready.length} 款可比較`;
    $("growthRows").replaceChildren(...ready.slice(0, limit).map(growthRow));
    if (!ready.length) $("growthRows").append(empty("rocket", eligible.length ? "下一波上升曲線，正在累積" : "這次沒有符合的遊戲", eligible.length
      ? `需有最新有效量測及 ${span} 日前的同日紀錄，才會進入排行榜。缺少紀錄不會視為零成長。`
      : "試試其他日期範圍，或清除搜尋條件。"));
    $("growthMore").hidden = ready.length <= limit;
    $("pendingTitle").textContent = `資料累積中 · ${pending.length} 款`;
    $("pendingList").replaceChildren(...pending.slice(0, 12).map(({ game, metric }) => {
      const item = node("article", "pending-game");
      item.append(gameLink(game), node("span", "pending-state", statusText(metric.status)));
      item.append(node("p", "", metric.latest ? `${number.format(metric.latest.followers)} 人 · ${dateText(metric.latest.day)} 量測` : "尚無附查詢時間的官方關注數"));
      return item;
    }));
    $("pendingOverflow").textContent = pending.length > 12 ? `另有 ${pending.length - 12} 款正在累積；可輸入名稱查詢。` : "";
    $("pendingSection").hidden = !pending.length;
    const run = growthData?.collection;
    $("growthNotice").hidden = true;
    if (!growthData) {
      $("growthNotice").textContent = "成長紀錄暫時無法讀取，已保留目前收錄的遊戲清單。";
      $("growthNotice").hidden = false;
    } else if (run && ["rate_limited", "source_unavailable", "interrupted"].includes(run.status)) {
      $("growthNotice").textContent = run.status === "rate_limited" ? "Steam 本次查詢受到限流，已保留前次量測，等待下一次排程更新。" : "本次未能完成量測，已保留有效歷史；缺漏不會計為零成長。";
      $("growthNotice").hidden = false;
    }
    $("growthUpdated").textContent = "以各遊戲最新實測日回看 · 超過 2 天未更新暫不排名";
    document.querySelectorAll("[data-growth-days]").forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.growthDays) === span)));
    $("growthScope").value = scope; $("growthSort").value = sort;
  }
  let analysisGeneration = 0, loadComparisonDescriptions = null;
  function searchChoices() {
    const term = $("compareSearch").value.trim().toLocaleLowerCase();
    const selected = window.RadarCompare.ids();
    const matches = games.filter(game => !selected.includes(game.appid) && (!term ||
      `${game.name} ${game.nameEn} ${game.appid} ${(game.tags || []).map(R.label).join(" ")}`.toLocaleLowerCase().includes(term)));
    const sorted = matches.sort((a, b) => b.followers - a.followers);
    $("compareSuggestions").replaceChildren(...sorted.slice(0, 6).map(game => {
      const button = node("button", "compare-suggestion"); button.type = "button";
      const text = node("span"); text.append(node("strong", "", game.name), node("small", "", `${dateText(game.date)} · ${number.format(game.followers)} 人關注`));
      button.append(cover(game, "suggestion-cover"), text, node("span", "suggestion-plus", "+"));
      button.setAttribute("aria-label", `加入比較：${game.name}`);
      button.disabled = selected.length >= 3;
      button.addEventListener("click", () => {
        if (window.RadarCompare.toggle(game.appid, game.name)) $("compareSearch").focus({ preventScroll: true });
      });
      return button;
    }));
    $("compareSearchHint").textContent = selected.length >= 3 ? "已選滿 3 款，可先移除其中一款再替換。" : !matches.length ? "找不到符合的遊戲，試試名稱、AppID 或 TAG。" : term ? `找到 ${matches.length} 款，顯示前 ${Math.min(matches.length, 6)} 款。` : "先從關注度較高的作品選起，或輸入名稱搜尋。";
  }
  function renderComparison() {
    const selected = window.RadarCompare.ids().map(id => games.find(game => game.appid === id)).filter(Boolean);
    const generation = ++analysisGeneration;
    $("compareSlots").replaceChildren(...[0, 1, 2].map(index => {
      const game = selected[index];
      const slot = node("div", "compare-slot" + (game ? " is-filled" : ""));
      slot.append(node("span", "slot-number", `0${index + 1}`));
      if (game) {
        slot.append(cover(game), gameLink(game));
        const remove = node("button", "slot-remove", "×"); remove.type = "button";
        remove.setAttribute("aria-label", `移除比較：${game.name}`);
        remove.addEventListener("click", () => { window.RadarCompare.set(window.RadarCompare.ids().filter(id => id !== game.appid)); $("compareSearch").focus({ preventScroll: true }); });
        slot.append(remove);
      } else {
        slot.append(node("span", "slot-empty-symbol", "+"), node("span", "", "選一款加入比較"));
      }
      return slot;
    }));
    $("compareCount").textContent = `${selected.length} / 3 款`;
    $("compareClear").disabled = !selected.length;
    $("compareShare").disabled = !selected.length;
    $("comparisonResults").hidden = selected.length < 2;
    $("compareJump").hidden = selected.length < 2;
    $("comparisonPrompt").hidden = selected.length >= 2;
    $("comparisonPrompt").textContent = selected.length ? "再選 1 款，就能比較每日歷史。" : "選擇 2～3 款遊戲，比較同一期間的每日關注變化。";
    searchChoices();
    if (selected.length < 2) return;
    window.RadarComparisonHistory.render(selected.map(game => ({ ...game, history: observations.get(game.appid)?.history || [] })), growthData);
    const common = selected[0].tags.filter(tag => selected.every(game => R.hasTag(game, tag)));
    const head = node("tr");
    const corner = node("th", "", "比較項目"); corner.scope = "col"; head.append(corner);
    for (const game of selected) { const th = node("th"); th.scope = "col"; th.append(gameLink(game)); head.append(th); }
    $("comparisonHead").replaceChildren(head);
    const body = $("comparisonBody"); body.replaceChildren();
    const addRow = (label, get) => {
      const row = node("tr"), th = node("th", "", label); th.scope = "row"; row.append(th);
      for (const game of selected) { const cell = node("td"); const result = get(game); if (typeof result === "string") cell.textContent = result; else cell.append(result); row.append(cell); }
      body.append(row);
    };
    addRow("發售日期", game => dateText(game.date));
    addRow("發售狀態", game => game.date > today ? "尚未上市" : game.date === today ? "今日上市" : "已上市");
    addRow("追蹤期限", game => `${dateText(I.offset(game.date, 30))}${I.tracking(game.date, today) ? "（追蹤中）" : "（已結束）"}`);
    addRow("語言支援", badges);
    addRow("遊戲類型", game => game.genres.length ? game.genres.map(R.genreLabel).join("、") : "尚無資料");
    const tagLinks = tags => {
      const box = node("div", "comparison-tags");
      if (!tags.length) { box.textContent = "—"; return box; }
      for (const tag of tags) { const a = node("a", "", R.label(tag)); a.href = R.url(tag); box.append(a); }
      return box;
    };
    addRow("共同 TAG", () => common.length ? tagLinks(common.slice(0, 8)) : "目前沒有共同 TAG");
    addRow("其他 TAG", game => tagLinks(game.tags.filter(tag => !common.some(value => R.key(value) === R.key(tag))).slice(0, 8)));
    addRow("繁中簡介", game => { const p = node("p", "comparison-description", "正在讀取繁體中文介紹…"); p.dataset.descriptionFor = game.appid; return p; });
    let descriptionsStarted = false;
    loadComparisonDescriptions = () => {
      if (descriptionsStarted) return;
      descriptionsStarted = true;
      Promise.allSettled(selected.map(async game => {
        const raw = await window.RadarStorage.loadGame(game.appid);
        if (generation !== analysisGeneration) return;
        const cell = body.querySelector(`[data-description-for="${game.appid}"]`);
        if (!cell) return;
        cell.textContent = raw?.short_description_language === "zh-TW" && typeof raw.short_description === "string" ? raw.short_description : "繁體中文遊戲介紹整理中。";
      }));
    };
    if (document.querySelector('.comparison-reference').open) loadComparisonDescriptions();
  }
  async function load(force = false) {
    $("labRetry").hidden = true;
    $("labStatus").textContent = "正在整理遊戲與量測紀錄…";
    const results = await Promise.allSettled([
      window.RadarStorage.loadSources({ force }),
      window.RadarStorage.readJSON("./data/growth.json", value => value?.version === 1 && Array.isArray(value.games), { force }),
    ]);
    const source = results[0].status === "fulfilled" ? results[0].value : {};
    rawCatalog = source.catalog;
    growthData = results[1].status === "fulfilled" ? results[1].value : null;
    const data = R.enrich(D.datasets(rawCatalog, source.preview), rawCatalog, source.preview);
    if (!data) {
      $("labStatus").textContent = "目前無法讀取遊戲資料，請稍後重試。";
      $("labRetry").hidden = false;
      return;
    }
    games = D.selectGames(data, "all", today);
    observations = new Map((growthData?.games || []).map(row => [Number(row.appid), row]));
    $("labRetry").hidden = !!growthData;
    $("labStatus").textContent = `共 ${games.length} 款公開收錄 · 日期以台灣時間為準`;
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem("game-trend-radar:saved:v1") || "[]"); } catch {}
    document.querySelectorAll("[data-saved-count]").forEach(el => el.textContent = String(new Set(Array.isArray(saved) ? saved : []).size));
    if (mode === "growth") renderGrowth();
    else {
      if (!initialized) {
        const requested = params.has("ids") ? I.comparisonIds(params.get("ids")) : window.RadarCompare.ids();
        const valid = requested.filter(id => games.some(game => game.appid === id));
        $("compareWarning").hidden = valid.length === requested.length;
        $("compareWarning").textContent = "部分遊戲目前不在公開收錄清單中，已保留其餘可比較的遊戲。";
        window.RadarCompare.set(valid, true);
      }
      else { renderComparison(); saveURL(); }
    }
    initialized = true;
  }
  $("labRetry").addEventListener("click", () => load(true));
  if (mode === "growth") {
    $("growthSearch").value = params.get("q") || "";
    const refresh = () => { limit = 25; saveURL(); renderGrowth(); };
    $("growthSearch").addEventListener("input", event => { clearTimeout(searchTimer); if (!event.isComposing) searchTimer = setTimeout(refresh, 120); });
    $("growthSearch").addEventListener("compositionend", refresh);
    $("growthScope").addEventListener("change", () => { scope = $("growthScope").value; refresh(); });
    $("growthSort").addEventListener("change", () => { sort = $("growthSort").value; refresh(); });
    document.querySelectorAll("[data-growth-days]").forEach(button => button.addEventListener("click", () => { span = Number(button.dataset.growthDays); refresh(); }));
    $("growthMore").addEventListener("click", () => { limit += 25; renderGrowth(); });
    window.addEventListener("popstate", () => {
      const next = new URLSearchParams(location.search);
      span = [1, 7, 30].includes(Number(next.get("days"))) ? Number(next.get("days")) : 7;
      scope = ["all", "future", "released"].includes(next.get("period")) ? next.get("period") : "all";
      sort = next.get("sort") === "percent" ? "percent" : "delta";
      $("growthSearch").value = next.get("q") || "";
      limit = 25; renderGrowth();
    });
  } else {
    document.querySelector('.comparison-reference').addEventListener('toggle', event => {
      if (event.currentTarget.open) loadComparisonDescriptions?.();
    });
    $("compareSearch").addEventListener("input", event => { clearTimeout(searchTimer); if (!event.isComposing) searchTimer = setTimeout(searchChoices, 100); });
    $("compareSearch").addEventListener("compositionend", searchChoices);
    $("compareClear").addEventListener("click", () => { window.RadarCompare.set([]); $("compareSearch").focus(); });
    $("compareShare").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(location.href); E.feedback("比較連結已複製，可分享目前選取的遊戲。"); }
      catch { E.feedback("目前無法自動複製，請直接複製網址列的比較連結。"); }
    });
    document.addEventListener("radar:comparechange", () => { if (!games.length) return; renderComparison(); saveURL(); });
    window.addEventListener("popstate", () => {
      const ids = I.comparisonIds(new URLSearchParams(location.search).get("ids"));
      window.RadarCompare.set(ids.filter(id => games.some(game => game.appid === id)), true);
    });
  }
  load();
})();
