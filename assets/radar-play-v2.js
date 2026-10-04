(() => {
  "use strict";
  const D = window.RadarData;
  const R = window.RadarDiscovery;
  const $ = (id) => document.getElementById(id);
  const mode = document.body.dataset.page;
  const today = D.todayInTaipei();
  const number = new Intl.NumberFormat("zh-TW");
  const storageKey = "game-trend-radar:saved:v1";
  const PAGE_SIZE = 36;
  const cardGames = new WeakMap();
  let searchTimer, dateAnimation;
  const query = new URLSearchParams(location.search);
  const monthPattern = /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/;
  const requestedDate = query.get("date");
  let date = D.validDate(requestedDate) ? requestedDate : null;
  let saved = new Set();
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (Array.isArray(value))
      saved = new Set(value.map(D.savedID).filter(id => id !== null));
  } catch {
    /* Browsers with storage disabled still support this session's collection. */
  }
  const model = {
    data: null,
    month: monthPattern.test(query.get("month") || "")
      ? query.get("month")
      : today.slice(0, 7),
    view: ["calendar", "list"].includes(query.get("view"))
      ? query.get("view")
      : matchMedia("(max-width: 520px)").matches
        ? "list"
        : "calendar",
    savedOnly: query.get("saved") === "1",
    tagFilters: mode === "explore" ? R.tagFilters(query) : { include: [], exclude: [], match: "all" },
    limit: Math.max(PAGE_SIZE, window.RadarJourney?.restore?.limit || PAGE_SIZE),
    loading: true,
  };
  function node(tag, className = "", text = null) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }
  function notify(message) {
    $("toast").textContent = message;
    $("toast").classList.add("visible");
    clearTimeout(notify.timer);
    notify.timer = setTimeout(
      () => $("toast").classList.remove("visible"),
      3200,
    );
  }
  function updateSavedControls() {
    const knownSaved = new Set(saved);
    if (model.data) {
      for (const game of D.cardGames([...model.data.games, ...model.data.recent])) {
        if (!D.isSaved(game, saved)) continue;
        for (const id of game.savedAliases || [game.appid]) knownSaved.delete(id);
        knownSaved.add(D.saveID(game));
      }
    }
    document.querySelectorAll("[data-saved-count]").forEach((el) => {
      el.textContent = knownSaved.size;
    });
    document.querySelectorAll("button[data-save]").forEach((button) => {
      const game = cardGames.get(button.closest(".game-card"));
      const active = game ? D.isSaved(game, saved) : saved.has(D.savedID(button.dataset.save.startsWith("igdb:") ? button.dataset.save : Number(button.dataset.save)));
      button.setAttribute("aria-pressed", String(active));
      button.setAttribute(
        "aria-label",
        `${active ? "取消收藏" : "收藏"} ${button.dataset.name}`,
      );
      button.title = active ? "取消收藏" : "加入我的收藏";
      const label = button.querySelector(".save-label");
      if (label) label.textContent = active ? "已收藏" : "加入收藏";
    });
  }
  function toggleSave(appid, name, game = null) {
    const previousCards = [...$("gamesGrid").querySelectorAll(".game-card")];
    const activeCard = document.activeElement?.closest(".game-card");
    const activeIndex = previousCards.indexOf(activeCard);
    const wasSaved = game ? D.isSaved(game, saved) : saved.has(appid);
    if (wasSaved) {
      for (const id of game?.savedAliases || [appid]) saved.delete(id);
    } else saved.add(appid);
    let durable = true;
    try {
      localStorage.setItem(storageKey, JSON.stringify([...saved]));
    } catch {
      durable = false;
    }
    updateSavedControls();
    window.RadarEnhancements?.pulseSaved();
    if (mode === "saved" || model.savedOnly) {
      renderExplorer();
      if (activeIndex >= 0) {
        const cards = $("gamesGrid").querySelectorAll(".game-card");
        const target =
          cards[Math.min(activeIndex, cards.length - 1)]?.querySelector(
            "[data-save]",
          ) || $("resultCount");
        if (target === $("resultCount")) target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
    }
    celebrateSave(appid);
    notify(
      durable
        ? saved.has(appid)
          ? `已收藏「${name}」`
          : `已取消收藏「${name}」`
        : "已更新本次收藏；瀏覽器限制儲存，關閉頁面後可能不會保留。",
    );
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-save]");
    if (button) toggleSave(D.savedID(button.dataset.save.startsWith("igdb:") ? button.dataset.save : Number(button.dataset.save)), button.dataset.name, cardGames.get(button.closest(".game-card")));
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey && event.key !== null) return;
    try {
      const value = JSON.parse(event.newValue || "[]");
      saved = new Set(
        Array.isArray(value)
          ? value.map(D.savedID).filter(id => id !== null)
          : [],
      );
      updateSavedControls();
      if (mode === "saved" || model.savedOnly) renderExplorer();
    } catch {
      /* Ignore malformed storage from another tab. */
    }
  });
  const heart =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.8a5.6 5.6 0 0 0-7.9 0L12 5.7l-.9-.9a5.6 5.6 0 0 0-7.9 7.9L12 21l8.8-8.3a5.6 5.6 0 0 0 0-7.9Z"/></svg>';
  function externalLink(game, className, name = game.name) {
    const a = node("a", className);
    a.href = game.link;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.setAttribute("aria-label", `在 ${game.source === "nintendo" ? game.linkLabel : "Steam"} 開啟 ${name}（另開分頁）`);
    return a;
  }
  function detailLink(game, className = "", name = game.name) {
    const link = node("a", className);
    link.href = D.detailURL(game);
    link.setAttribute("aria-label", `查看 ${name} 的遊戲資訊`);
    return link;
  }
  function cardDate(game, event = false) {
    if (event) return game.date;
    const dates = (Array.isArray(game.releases) ? game.releases : [])
      .filter(release => release?.precision === "day" && D.validDate(release.date) && ["Steam", "NS", "NS2"].includes(release.platform))
      .map(release => release.date);
    return dates.sort()[0] || game.date;
  }
  function releaseEventGames(games) {
    const events = new Map();
    for (const game of games) {
      const key = `${game.identityKey || game.appid}@${game.date}`;
      if (!events.has(key)) events.set(key, game);
    }
    return [...events.values()];
  }
  function makeCard(game, options = {}) {
    const display = D.releaseDisplayNames?.(game, game.releasePlatforms) || { name: game.name, nameEn: game.nameEn };
    const card = node("article", "game-card");
    card.dataset.appid = game.appid;
    card.dataset.gameKey = D.gameKey(game);
    card.dataset.source = game.source || "steam";
    cardGames.set(card, game);
    const cover = node("div", "cover-link");
    const fallback = node("span", "cover-placeholder");
    fallback.setAttribute("aria-hidden", "true");
    cover.append(fallback);
    if (game.art) {
      const img = node("img");
      img.alt = "";
      img.loading = options.eager ? "eager" : "lazy";
      img.decoding = "async";
      img.fetchPriority = options.priority ? "high" : "auto";
      img.width = 616;
      img.height = 288;
      window.RadarArtwork.load(img, game, {
        onLoad: () => { fallback.hidden = true; img.classList.add("art-loaded"); },
        onExhausted: () => { img.remove(); fallback.hidden = false; },
      });
      cover.append(img);
    }
    const event = options.event ?? mode === "date";
    const displayedDate = cardDate(game, event);
    const days = Math.round(
      (Date.parse(displayedDate + "T12:00:00Z") -
        Date.parse(today + "T12:00:00Z")) /
        86400000,
    );
    const countdown = node(
      "span",
      "countdown" + (days < 0 ? " released" : ""),
      days === 0 ? "今日登場" : days > 0 ? `${days} 天後登場` : "已上市",
    );
    cover.append(countdown);
    const save = node("button", "save-button");
    save.type = "button";
    save.dataset.save = game.appid;
    save.dataset.name = display.name;
    save.innerHTML = heart;
    save.setAttribute(
      "aria-label",
      `${D.isSaved(game, saved) ? "取消收藏" : "收藏"} ${display.name}`,
    );
    save.setAttribute("aria-pressed", String(D.isSaved(game, saved)));
    const body = node("div", "card-body");
    const names = detailLink(game, "card-names", display.name);
    const title = node("h3", "card-title", display.name);
    title.title = display.name;
    names.append(title);
    const originalName = display.nameEn && display.nameEn !== display.name ? display.nameEn : "";
    const english = node("p", "card-english", originalName);
    if (originalName) english.title = originalName;
    else english.setAttribute("aria-hidden", "true");
    names.append(english);
    body.append(names);
    const languages = node("div", "card-languages");
    const nativePlatforms = (game.releasePlatforms || []).filter(platform => ["NS", "NS2"].includes(platform));
    const nativeEvent = event && nativePlatforms.length > 0 && !game.releasePlatforms.includes("Steam");
    const nativeLanguages = nativeEvent || game.source === "nintendo";
    const support = nativeEvent
      ? D.nintendoCardLanguages?.(game.platformLanguages || {}, nativePlatforms) ||
        { languageBadges: [{ label: "語言支援待確認", status: "unknown", title: "Nintendo 此版本語言支援待確認" }] }
      : game;
    languages.setAttribute("aria-label", nativeLanguages ? "Nintendo 版本遊戲支援語言" : "Steam 版本遊戲支援語言");
    if (!nativeLanguages && game.hasNintendo) languages.title = "此處標籤為 Steam 版本語言支援；Nintendo 各版本請進入遊戲頁查看";
    for (const badge of support.languageBadges || []) {
      const language = node(
        "span",
        `card-language language-${badge.status}`,
        badge.label,
      );
      language.title = nativeLanguages ? badge.title || "Nintendo 此版本語言支援待確認" :
        "Steam 版本公布的遊戲語言支援；介面、字幕及配音的詳細項目請以商店為準";
      languages.append(language);
    }
    if (["explore", "all"].includes(mode) && game.tags?.length) {
      const tags = node("div", "explorer-card-tags");
      const ordered = [...game.tags].sort(
        (a, b) =>
          Number(model.tagFilters.include.some(tag => R.key(tag) === R.key(b))) -
          Number(model.tagFilters.include.some(tag => R.key(tag) === R.key(a))),
      );
      ordered.slice(0, 2).forEach((tag) => {
        const badge = node("span", "", R.label(tag));
        badge.title = tag;
        tags.append(badge);
      });
      body.append(tags);
    }
    if (game.darkHorse) {
      const badge = node("span", "dark-horse", "近期黑馬");
      badge.title = "直接上市，並於發售首週內確認超過 3,000 人關注";
      body.append(badge);
    }
    if (languages.children.length) body.append(languages);
    const meta = node("div", "card-meta");
    const dates = node("div", "card-release-dates");
    const line = node("div", "card-release-date");
    const time = node("time", "", displayedDate.replaceAll("-", "/"));
    time.dateTime = displayedDate;
    time.title = event ? "本次平台發售日期" : "最早發售日期；各平台日期可於遊戲資訊查看";
    line.append(time);
    dates.append(line);
    if (event && game.releasePlatforms?.length) {
      const releasePlatforms = node("span", "card-release-platform", game.releasePlatforms.join("／"));
      releasePlatforms.title = "本次發售的平台";
      dates.append(releasePlatforms);
    }
    const metrics = node("div", "card-interest");
    for (const [value, label] of [[game.followers, "人關注"], [game.hypes, "IGDB hypes"]]) {
      if (!Number.isFinite(value)) continue;
      const interest = node("span", "card-followers", number.format(value));
      interest.append(node("small", "", label));
      metrics.append(interest);
    }
    meta.append(dates, metrics);
    body.append(meta);
    const detail = detailLink(game, "card-detail-link", display.name);
    detail.tabIndex = -1;
    const steam = externalLink(game, "steam-store-link", game.source === "nintendo" ? display.name : game.name);
    steam.textContent = "Steam 商店";
    if (game.source === "nintendo") steam.textContent = game.linkLabel;
    const arrow = node("span", "", "↗");
    arrow.setAttribute("aria-hidden", "true");
    steam.append(arrow);
    const footer = node("div", "card-footer");
    const platforms = node("div", "card-platforms");
    platforms.setAttribute("aria-label", "遊戲平台與獨佔狀態");
    const badge = D.cardPlatformBadge(game);
    const platform = node("span", "platform-badge platform-" + badge.status, badge.label);
    platform.title = badge.title;
    platforms.append(platform);
    const right = node("div", "card-footer-right");
    right.append(steam);
    footer.append(platforms, right);
    body.append(footer);
    card.append(cover, body, detail, save);
    return card;
  }
  function empty(title, text, action = null) {
    const area = node("div", "empty-state");
    const symbol = window.RadarEnhancements?.illustration(mode === "explore" ? "tags" : mode === "released" ? "rocket" : "calendar") || node("span", "empty-symbol", "◎");
    symbol.setAttribute("aria-hidden", "true");
    const copy = node("div");
    copy.append(node("h3", "", title), node("p", "", text));
    area.append(symbol, copy);
    if (action) {
      const button = node("button", "button secondary", action.label);
      button.addEventListener("click", action.run);
      area.append(button);
    }
    return area;
  }
  function formatUpdate(value) {
    const date = new Date(value || "");
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("zh-TW", {
          timeZone: "Asia/Taipei",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(date)
      : "更新時間待確認";
  }
  function renderStatus() {
    const data = model.data;
    if (!data) return;
    const prefix = data.partial ? "新作持續收錄中" : "遊戲資料已更新";
    const updated = mode === "released" ? data.recentUpdated : data.updated;
    $("updateText").textContent =
      `${prefix} · ${formatUpdate(updated)}（台灣）`;
    const init = data.initialization;
    const nintendoCount = new Set(data.games.flatMap(game => game.igdbIds || (game.igdbId ? [game.igdbId] : []))).size;
    const steamCount = new Set(data.games.filter(game => game.source !== "nintendo").map(game => game.appid)).size;
    let coverage = `目前收錄 ${number.format(steamCount)} 款 Steam 遊戲、${number.format(nintendoCount)} 款 NS／NS2 遊戲。Steam 新作需至少 5,000 人關注，已驗證 Twitch 新作可另行收錄；Nintendo 試行門檻為 IGDB hypes ≥ 30。各平台以確切發售日收錄；僅有年、月或季度的遊戲持續觀察。${data.partial ? "清單尚在持續補齊，不代表全部符合條件的遊戲。" : ""}`;
    if (init?.candidate_count)
      coverage += ` 已取得 ${number.format(init.candidate_count)} 款候選新作，逐步核對關注人數。`;
    if (mode === "released")
      coverage =
        "近期上市列出近 30 天內、已確認發售的收錄遊戲，包含已驗證的 Twitch 新作。近期黑馬須於上市首週確認超過 3,000 人關注。";
    if (mode === "all")
      coverage = `目前可查詢 ${number.format(D.cardGames(D.selectGames(data, "all", today)).length)} 款已公開收錄的遊戲，包含待上市與既有上市紀錄，不限近期日期範圍。這是本站收錄清單，並非 Steam 全站遊戲。`;
    if (data.source === "preview")
      coverage += " 正式清單暫時無法讀取，目前使用已公開的預覽資料。";
    if (data.steamUpdated) coverage += ` Steam 更新：${formatUpdate(data.steamUpdated)}（台灣）。`;
    if (!data.nintendoAvailable) coverage += " Nintendo 資料暫時無法讀取，Steam 清單仍可查看。";
    else coverage += ` Nintendo 更新：${formatUpdate(data.nintendoUpdated)}（台灣）。TAG 顯示整款遊戲的平台類別；移上標籤查看已確認平台，月曆標籤另提供本次發售資訊。NS／NS2 僅在官方確認獨佔時作為標籤。`;
    $("coverageText").textContent = coverage;
  }
  function renderHome() {
    if (mode !== "home" || !model.data) return;
    const data = model.data;
    const upcoming = D.cardGames(D.selectGames(data, "upcoming", today)).sort(
      (a, b) => cardDate(a).localeCompare(cardDate(b)) || D.popularityCompare(a, b),
    );
    const recent = D.cardGames(D.selectGames(data, "released", today), "latest").sort(
      (a, b) => cardDate(b).localeCompare(cardDate(a)) || D.popularityCompare(a, b),
    );
    $("spotlightGames").replaceChildren(
      ...upcoming.slice(0, 4).map((game, index) =>
        makeCard(game, {
          eager: false,
          priority: false,
        }),
      ),
    );
    $("spotlightGames").setAttribute("aria-busy", "false");
    revealCards($("spotlightGames"));
    if (!upcoming.length)
      $("spotlightGames").append(
        empty(
          "下一波新作，正在路上",
          "目前尚無未來 45 天內已收錄的遊戲。",
        ),
      );
    $("recentGames").replaceChildren(
      ...recent.slice(0, 3).map((game, index) =>
        makeCard(game, {
          eager: false,
          priority: false,
          upgrade: false,
        }),
      ),
    );
    revealCards($("recentGames"));
    if (!recent.length)
      $("recentGames").append(
        empty(
          data.recentAvailable
            ? "下一匹黑馬，值得等待"
            : "近期上市資料暫時無法讀取",
          data.recentAvailable
            ? "目前沒有符合條件的近期上市遊戲，確認發售與關注人數後就會加入。"
            : "稍後再試；已收錄的新作仍可正常瀏覽。",
        ),
      );
  }
  function writeURL() {
    const url = new URL(location.href);
    const set = (key, value) =>
      value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
    if (mode === "home") {
      set("month", model.month);
      set("view", model.view);
    }
    set("q", $("searchInput").value.trim());
    if (mode === "explore") {
      url.searchParams.delete("tag");
      url.searchParams.delete("exclude");
      model.tagFilters.include.forEach(tag => url.searchParams.append("tag", tag));
      model.tagFilters.exclude.forEach(tag => url.searchParams.append("exclude", tag));
      set("match", model.tagFilters.match === "any" ? "any" : "");
      set("language", $("languageFilter").value);
    }
    set(
      "min",
      $("followersFilter").selectedIndex ? $("followersFilter").value : "",
    );
    set("saved", model.savedOnly ? "1" : "");
    set("sort", $("sortSelect").selectedIndex ? $("sortSelect").value : "");
    if (mode === "all") {
      set("period", $("releaseFilter").value);
      set("language", $("languageFilter").value);
    }
    history.replaceState(history.state, "", url);
    if (mode === "date") refreshDateLinks();
  }
  function refreshDateLinks() {
    for (const [id, direction] of [["prevDate", -1], ["nextDate", 1]]) {
      const link = $(id);
      const adjacent = date ? D.offsetDate(date, direction) : null;
      const valid = D.validDate(adjacent) && adjacent >= $("datePicker").min && adjacent <= $("datePicker").max;
      link.hidden = !date;
      link.setAttribute("aria-disabled", String(!valid));
      if (!valid) {
        link.removeAttribute("href");
        link.tabIndex = -1;
        continue;
      }
      const url = new URL(location.href);
      url.searchParams.set("date", adjacent);
      url.hash = "";
      link.href = url.pathname + url.search;
      link.removeAttribute("tabindex");
      $(id + "Label").textContent = `${Number(adjacent.slice(5, 7))} / ${Number(adjacent.slice(8))}`;
      const label = `${direction < 0 ? "前一天" : "後一天"}：${adjacent.replaceAll("-", "/")}`;
      link.setAttribute("aria-label", label);
      link.title = label;
    }
  }
  function renderDateHeading() {
    if (date) {
      const weekday = new Intl.DateTimeFormat("zh-TW", {
        weekday: "long", timeZone: "Asia/Taipei",
      }).format(new Date(date + "T12:00:00Z"));
      $("dateTitle").textContent = `${date.slice(0, 4)} 年 ${Number(date.slice(5, 7))} 月 ${Number(date.slice(8))} 日`;
      $("dateWeekday").textContent = weekday;
      $("backCalendar").href = `./index.html?month=${date.slice(0, 7)}`;
      document.title = `${date} 發售遊戲｜Game Trend Radar`;
    } else {
      $("dateTitle").textContent = "選擇發售日期";
      $("dateWeekday").textContent = "";
      $("backCalendar").href = "./index.html";
      document.title = "找不到指定日期｜Game Trend Radar";
    }
    $("dateWeekday").hidden = !date;
    $("datePicker").value = date || "";
    $("dateCurrent").classList.toggle("date-invalid", !date);
    refreshDateLinks();
  }
  function changeDate(nextDate) {
    if (!D.validDate(nextDate)) return;
    clearTimeout(searchTimer);
    writeURL();
    if (nextDate === date) return;
    const direction = date && nextDate < date ? -1 : 1;
    const url = new URL(location.href);
    date = nextDate;
    url.searchParams.set("date", date);
    url.hash = "";
    history.pushState(null, "", url);
    model.limit = PAGE_SIZE;
    renderDateHeading();
    renderExplorer();
    dateAnimation?.cancel();
    if (window.RadarMotion?.enabled && $("dateCurrent").animate)
      dateAnimation = $("dateCurrent").animate(
        [{ opacity: 0.5, transform: `translateX(${direction * 6}px)` },
         { opacity: 1, transform: "translateX(0)" }],
        { duration: 170, easing: "ease-out" },
      );
  }
  function restoreQueryFilters(params) {
    $("searchInput").value = params.get("q") || "";
    model.savedOnly = params.get("saved") === "1";
    const fields = [["followersFilter", "min"], ["sortSelect", "sort"]];
    if (mode === "all") fields.push(["releaseFilter", "period"]);
    if (["all", "explore"].includes(mode)) fields.push(["languageFilter", "language"]);
    if (mode === "explore") {
      model.tagFilters = R.tagFilters(params);
      $("tagMatch").value = model.tagFilters.match;
    }
    for (const [id, param] of fields) {
      $(id).selectedIndex = 0;
      if ([...$(id).options].some((option) => option.value === params.get(param)))
        $(id).value = params.get(param);
    }
  }
  function activeFilters() {
    return !!(
      $("searchInput").value.trim() ||
      $("followersFilter").selectedIndex ||
      model.tagFilters.include.length || model.tagFilters.exclude.length ||
      model.savedOnly ||
      (mode === "all" && $("releaseFilter").value) ||
      (["all", "explore"].includes(mode) && $("languageFilter").value)
    );
  }
  function filteredGames() {
    if (!model.data) return { source: [], items: [], events: [] };
    let source = D.selectGames(model.data, mode, today, date);
    if (mode === "explore")
      source = source.filter((game) => game.date >= today);
    if (mode === "home")
      source = source.filter((game) => game.date.startsWith(model.month));
    if (mode === "saved")
      source = source.filter((game) => D.isSaved(game, saved));
    const term = $("searchInput").value.trim().toLocaleLowerCase();
    const min = Number($("followersFilter").value);
    const period = mode === "all" ? $("releaseFilter").value : "";
    const language = ["all", "explore"].includes(mode) ? $("languageFilter").value : "";
    const events = releaseEventGames(source.filter(
      (game) =>
        (!term ||
          `${game.name} ${game.nameEn} ${game.nameOriginalTw || ""} ${game.nameOriginalCn || ""} ${(game.nameSearchAliases || []).join(" ")} ${game.appid} ${mode === "all" ? (game.tags || []).map(tag => tag + " " + R.label(tag)).join(" ") : ""}`
            .toLocaleLowerCase()
            .includes(term)) &&
        (min === 0 || (game.source !== "nintendo" && game.followers >= min)) &&
        (mode !== "explore" || R.matchesTags(game, model.tagFilters)) &&
        (!period || (period === "future" ? game.date >= today : game.date < today)) &&
        (!language || game.languages?.[language] === true) &&
        (!model.savedOnly || D.isSaved(game, saved)),
    ));
    const order = $("sortSelect").value;
    const eventScoped = mode === "home" || mode === "date";
    const items = eventScoped ? [...events] : D.cardGames(events, order === "newest" || mode === "released" ? "latest" : "earliest");
    items.sort((a, b) =>
      order === "followers"
        ? D.popularityCompare(a, b)
        : order === "name"
          ? a.name.localeCompare(b.name, "zh-TW")
          : order === "newest"
            ? cardDate(b, eventScoped).localeCompare(cardDate(a, eventScoped)) || D.popularityCompare(a, b)
            : cardDate(a, eventScoped).localeCompare(cardDate(b, eventScoped)) || D.popularityCompare(a, b),
    );
    return { source: eventScoped ? releaseEventGames(source) : D.cardGames(source), items, events };
  }
  function renderCalendar(games) {
    const [year, month] = model.month.split("-").map(Number);
    $("monthLabel").textContent = `${year} 年 ${month} 月`;
    const first = new Date(Date.UTC(year, month - 1, 1, 12));
    const dayOffset = first.getUTCDay();
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const count = Math.ceil((dayOffset + days) / 7) * 7;
    const byDate = new Map();
    games.forEach((game) => {
      if (!byDate.has(game.date)) byDate.set(game.date, []);
      byDate.get(game.date).push(game);
    });
    byDate.forEach((list) => list.sort(D.popularityCompare));
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const day = new Date(first.getTime() + (i - dayOffset) * 86400000)
        .toISOString()
        .slice(0, 10);
      const inMonth = day.startsWith(model.month);
      const cell = node(
        "div",
        "calendar-day" +
          (!inMonth ? " other-month" : "") +
          (day === today ? " today" : ""),
      );
      const dayGames = inMonth ? byDate.get(day) || [] : [];
      if (dayGames.length) cell.classList.add("has-games");
      const link = node("a", "date-link", Number(day.slice(-2)));
      link.href = `./date.html?date=${day}`;
      link.setAttribute("aria-label", `${day} 發售遊戲完整清單`);
      if (day === today) {
        link.setAttribute("aria-current", "date");
        link.append(node("b", "", "今天"));
      }
      cell.append(link);
      D.calendarFeatured(dayGames).forEach((game, rank) => {
        const releasePlatforms = game.releasePlatforms || [game.source === "nintendo" ? game.platformShort : "Steam"];
        const display = D.releaseDisplayNames?.(game, releasePlatforms) || { name: game.name, nameEn: game.nameEn };
        const tag = detailLink(game, "day-game" + (rank ? " second" : ""), display.name);
        const nativePlatforms = (game.releasePlatforms || []).filter(platform => ["NS", "NS2"].includes(platform));
        const badge = D.cardPlatformBadge(game);
        tag.classList.add("day-game-platform");
        if (nativePlatforms.length) tag.classList.add("day-game-nintendo");
        const platform = node("span", "day-platform", badge.label);
        platform.title = `${badge.title} 本日發售：${releasePlatforms.join("／")}。`;
        tag.append(platform,
          node("span", "day-game-name", display.name));
        tag.title = `${display.name}${display.nameEn && display.nameEn !== display.name ? ` · ${display.nameEn}` : ""} · ${platform.title}${Number.isFinite(game.hypes) ? ` · ${number.format(game.hypes)} IGDB hypes` : ""}${Number.isFinite(game.followers) ? ` · ${number.format(game.followers)} 人關注` : ""}`;
        cell.append(tag);
      });
      if (dayGames.length > 2) {
        const more = node("a", "day-more", `+${dayGames.length - 2} 款新作`);
        more.href = link.href;
        more.setAttribute(
          "aria-label",
          `${day} 尚有 ${dayGames.length - 2} 款遊戲，查看全部`,
        );
        cell.append(more);
      }
      cell.addEventListener("click", (event) => {
        if (!event.target.closest("a,button")) location.href = link.href;
      });
      fragment.append(cell);
    }
    $("calendarGrid").replaceChildren(fragment);
    if (motionOn && !model.loading && $("calendarGrid").animate)
      $("calendarGrid").animate(
        [
          { opacity: 0.35, transform: "translateY(6px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 230, easing: "ease-out" },
      );
  }
  function renderExplorer() {
    if (mode === "explore") renderTagSelection();
    if (mode === "home") {
      $("calendarArea").hidden = model.view !== "calendar";
      $("gamesGrid").hidden = model.view === "calendar";
      $("calendarView").setAttribute(
        "aria-pressed",
        String(model.view === "calendar"),
      );
      $("listView").setAttribute("aria-pressed", String(model.view === "list"));
      $("sortWrap").hidden = model.view === "calendar";
      $("monthPicker").value = model.month;
      $("monthLabel").textContent =
        `${model.month.slice(0, 4)} 年 ${Number(model.month.slice(5))} 月`;
    }
    const { source, items, events } = filteredGames();
    $("savedFilter").setAttribute("aria-pressed", String(model.savedOnly));
    $("resetFilters").hidden = !activeFilters();
    if (model.loading) {
      if (mode === "home") renderCalendar([]);
      return;
    }
    const filtered = activeFilters();
    const resultUnit = mode === "home" ? "筆發售" : "款";
    $("resultCount").textContent = model.data
      ? `${mode === "home" ? "本月" : "共"} ${items.length} ${resultUnit}${filtered ? ` / ${source.length} ${resultUnit}` : ""}${mode === "home" && !items.length ? " · 尚無符合條件的遊戲" : ""}`
      : "資料暫時無法讀取";
    if (mode === "home") renderCalendar(events);
    $("gamesGrid").setAttribute("aria-busy", "false");
    $("gamesGrid")
      .querySelectorAll(".reveal-pending")
      .forEach((card) => revealObserver?.unobserve(card));
    // Calendar mode does not create an invisible duplicate grid of image cards.
    if (mode === "home" && model.view === "calendar") {
      $("gamesGrid").replaceChildren();
      $("loadMoreWrap").hidden = true;
      document.dispatchEvent(new CustomEvent("radar:content-ready", { detail: { limit: model.limit } }));
      return;
    }
    const grid = $("gamesGrid");
    const retained = new Map([...grid.querySelectorAll(".game-card[data-appid]")]
      .map(card => [card.dataset.gameKey || card.dataset.appid, card]));
    grid.replaceChildren(...items.slice(0, model.limit).map(game => cardGames.get(retained.get(String(D.gameKey(game)))) === game ? retained.get(String(D.gameKey(game))) : makeCard(game, { event: mode === "home" || mode === "date" })));
    document.dispatchEvent(new CustomEvent("radar:content-ready", { detail: { limit: model.limit } }));
    $("loadMoreWrap").hidden =
      items.length <= model.limit ||
      (mode === "home" && model.view === "calendar");
    if (!items.length) {
      let title = "這裡還有位置，留給下一款好遊戲";
      let text = "目前沒有符合日期與關注人數條件的遊戲，資料會持續更新。";
      let action = null;
      if (!model.data) {
        title = "遊戲資料暫時無法讀取";
        text = "請稍後再試，你的收藏仍保留在這個瀏覽器。";
        action = { label: "重新讀取", run: load };
      } else if (mode === "date" && !date) {
        title = "找不到指定日期";
        text = "請使用上方「跳轉日期」選擇有效日期，或返回發售月曆。";
      } else if (filtered) {
        title = "雷達暫時沒有收到訊號";
        text = "試試其他關鍵字，或清除篩選看看所有遊戲。";
        action = { label: "清除篩選", run: resetFilters };
      } else if (mode === "saved") {
        title = saved.size
          ? "收藏的遊戲暫不在目前資料中"
          : "把第一款心動，放進收藏";
        text = saved.size
          ? "收藏記錄仍然保留；遊戲重新出現在公開資料時，就會再次顯示。"
          : "在遊戲卡片點一下愛心，就能在這裡找到它。";
      } else if (mode === "released" && !model.data.recentAvailable) {
        title = "近期上市資料暫時無法讀取";
        text = "請稍後再試。";
        action = { label: "重新讀取", run: load };
      }
      if (mode === "date" && date && model.data && !filtered) {
        title = "這一天，還沒有收錄的新作";
        text = "使用上方的前一天／後一天，或跳轉日期，繼續看看其他新作。";
      }
      $("gamesGrid").append(empty(title, text, action));
    }
    if (mode !== "home" || model.view === "list") revealCards($("gamesGrid"));
    updateSavedControls();
  }
  function resetFilters() {
    $("searchInput").value = "";
    $("followersFilter").selectedIndex = 0;
    model.savedOnly = false;
    model.tagFilters = { include: [], exclude: [], match: "all" };
    if (mode === "all") {
      $("releaseFilter").selectedIndex = 0;
      $("languageFilter").selectedIndex = 0;
    }
    if (mode === "explore") {
      $("tagSearch").value = "";
      $("languageFilter").selectedIndex = 0;
      $("tagMatch").value = "all";
      renderTagCatalog();
    }
    model.limit = PAGE_SIZE;
    writeURL();
    renderExplorer();
    $("searchInput").focus();
  }
  function changeFilters() {
    clearTimeout(searchTimer);
    model.limit = PAGE_SIZE;
    writeURL();
    renderExplorer();
  }
  let allTagChoices = [];
  let showAllTags = false;
  let tagIntent = "include";
  function renderTagSelection() {
    const f = model.tagFilters;
    $("tagActive").hidden = !f.include.length && !f.exclude.length;
    $("allTags").setAttribute("aria-pressed", String(!f.include.length && !f.exclude.length));
    const chips = [];
    for (const kind of ["include", "exclude"]) for (const tag of f[kind]) {
      const button = node("button", "selected-tag" + (kind === "exclude" ? " excluded" : ""));
      button.type = "button";
      button.append(node("span", "", (kind === "exclude" ? "排除 · " : "") + R.label(tag)), node("span", "", "×"));
      button.setAttribute("aria-label", `移除${kind === "exclude" ? "排除" : ""} ${R.label(tag)} 篩選`);
      button.addEventListener("click", () => {
        f[kind] = f[kind].filter(value => R.key(value) !== R.key(tag));
        changeFilters();
        $("tagSelectionSummary").focus({ preventScroll: true });
      });
      chips.push(button);
    }
    $("selectedTags").replaceChildren(...chips);
    $("tagSelectionSummary").textContent = `${f.match === "all" ? "全部符合" : "任一符合"} ${f.include.length} 個 TAG${f.exclude.length ? ` · 排除 ${f.exclude.length} 個` : ""}`;
    $("tagMatch").value = f.match;
    $("tagIntentInclude").setAttribute("aria-pressed", String(tagIntent === "include"));
    $("tagIntentExclude").setAttribute("aria-pressed", String(tagIntent === "exclude"));
    document.querySelectorAll("#tagCatalog button").forEach(button => {
      const included = f.include.some(tag => R.key(tag) === R.key(button.dataset.tag));
      const excluded = f.exclude.some(tag => R.key(tag) === R.key(button.dataset.tag));
      button.setAttribute("aria-pressed", String(included || excluded));
      button.classList.toggle("is-excluded", excluded);
      button.title = `${button.dataset.tag}${excluded ? "（已排除）" : included ? "（已選取）" : ""}`;
    });
  }
  function renderTagCatalog() {
    if (mode !== "explore") return;
    const term = R.key($("tagSearch").value);
    const matches = allTagChoices.filter(entry => R.key(entry.tag + " " + entry.label).includes(term));
    const visible = term || showAllTags ? matches : matches.slice(0, 14);
    const selected = [...model.tagFilters.include, ...model.tagFilters.exclude];
    if (!term && !showAllTags) for (const tag of selected) {
      const entry = allTagChoices.find(value => R.key(value.tag) === R.key(tag));
      if (entry && !visible.includes(entry)) visible.push(entry);
    }
    $("tagCatalog").replaceChildren(...visible.map(entry => {
      const button = node("button", "explore-tag");
      button.type = "button";
      button.dataset.tag = entry.tag;
      button.setAttribute("aria-label", `${entry.label}，${entry.count} 款遊戲`);
      const count = node("small", "", String(entry.count));
      count.setAttribute("aria-hidden", "true");
      button.append(node("span", "", entry.label), count);
      button.addEventListener("click", () => {
        const f = model.tagFilters;
        const already = f[tagIntent].some(tag => R.key(tag) === R.key(entry.tag));
        if (!already && f[tagIntent].length >= 12) { notify("同一組最多選擇 12 個 TAG。"); return; }
        f[tagIntent] = already ? f[tagIntent].filter(tag => R.key(tag) !== R.key(entry.tag)) : [...f[tagIntent], entry.tag];
        const other = tagIntent === "include" ? "exclude" : "include";
        f[other] = f[other].filter(tag => R.key(tag) !== R.key(entry.tag));
        changeFilters();
      });
      return button;
    }));
    $("tagCatalogEmpty").hidden = visible.length > 0;
    $("tagCatalogEmpty").textContent = term ? "找不到這個 TAG，試試中文或英文名稱。" : "目前尚未提供 TAG，仍可瀏覽下方清單。";
    $("moreTags").hidden = !!term || allTagChoices.length <= 14;
    $("moreTags").textContent = showAllTags ? "收合 TAG −" : `查看全部 ${allTagChoices.length} 個 TAG ＋`;
    $("moreTags").setAttribute("aria-expanded", String(showAllTags));
    $("tagCatalogCount").textContent = `${allTagChoices.length} 個 TAG · 數字為各 TAG 的全部收錄數`;
    renderTagSelection();
  }
  if (mode === "explore") {
    $("tagSearch").addEventListener("input", renderTagCatalog);
    $("moreTags").addEventListener("click", () => { showAllTags = !showAllTags; renderTagCatalog(); });
    $("allTags").addEventListener("click", () => {
      model.tagFilters.include = []; model.tagFilters.exclude = []; changeFilters();
    });
    $("clearTags").addEventListener("click", () => {
      model.tagFilters.include = []; model.tagFilters.exclude = []; changeFilters(); $("allTags").focus();
    });
    $("tagIntentInclude").addEventListener("click", () => { tagIntent = "include"; renderTagSelection(); });
    $("tagIntentExclude").addEventListener("click", () => { tagIntent = "exclude"; renderTagSelection(); });
    $("tagMatch").addEventListener("change", () => { model.tagFilters.match = $("tagMatch").value; changeFilters(); });
    $("languageFilter").addEventListener("change", changeFilters);
    window.addEventListener("popstate", () => {
      restoreQueryFilters(new URLSearchParams(location.search));
      renderTagCatalog(); model.limit = PAGE_SIZE; renderExplorer();
    });
  }
  restoreQueryFilters(query);
  $("followersFilter").title = "數字門檻只篩選 Steam Followers；查看 Nintendo 請選全部關注度";
  $("searchInput").addEventListener("input", (event) => {
    clearTimeout(searchTimer);
    if (!event.isComposing) searchTimer = setTimeout(changeFilters, 120);
  });
  $("searchInput").addEventListener("compositionend", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(changeFilters, 120);
  });
  $("followersFilter").addEventListener("change", changeFilters);
  $("sortSelect").addEventListener("change", changeFilters);
  if (mode === "all") {
    $("releaseFilter").addEventListener("change", changeFilters);
    $("languageFilter").addEventListener("change", changeFilters);
    window.addEventListener("popstate", () => {
      restoreQueryFilters(new URLSearchParams(location.search));
      model.limit = PAGE_SIZE;
      renderExplorer();
    });
  }
  $("savedFilter").addEventListener("click", () => {
    model.savedOnly = !model.savedOnly;
    changeFilters();
  });
  $("resetFilters").addEventListener("click", resetFilters);
  $("loadMore").addEventListener("click", () => {
    const previous = model.limit;
    model.limit += PAGE_SIZE;
    renderExplorer();
    $("gamesGrid").querySelectorAll(".card-detail-link")[previous]?.focus();
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "/" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.target.matches('input,textarea,select,[contenteditable="true"]')
    ) {
      event.preventDefault();
      $("searchInput").focus();
    }
    if (event.key === "Escape" && event.target === $("searchInput")) {
      $("searchInput").value = "";
      changeFilters();
    }
  });
  if (mode === "home") {
    $("searchInput").placeholder = "搜尋本月遊戲名稱或 ID…";
    function stepMonth(direction) {
      const [year, month] = model.month.split("-").map(Number);
      const next = new Date(Date.UTC(year, month - 1 + direction, 1));
      if (next.getUTCFullYear() < 1900 || next.getUTCFullYear() > 2199) return;
      model.month = next.toISOString().slice(0, 7);
      changeFilters();
    }
    $("prevMonth").addEventListener("click", () => stepMonth(-1));
    $("nextMonth").addEventListener("click", () => stepMonth(1));
    $("monthPicker").addEventListener("change", (event) => {
      if (!monthPattern.test(event.target.value)) {
        event.target.value = model.month;
        return;
      }
      model.month = event.target.value;
      changeFilters();
    });
    $("todayButton").addEventListener("click", () => {
      model.month = today.slice(0, 7);
      changeFilters();
    });
    $("calendarView").addEventListener("click", () => {
      model.view = "calendar";
      changeFilters();
    });
    $("listView").addEventListener("click", () => {
      model.view = "list";
      changeFilters();
    });
  } else {
    const notes = {
      upcoming: "未來 45 天 · Steam／NS／NS2 平台別確切發售日",
      released: "近 30 天 · Steam／NS／NS2 已收錄發售紀錄",
      saved: "收藏儲存在此瀏覽器；此處顯示仍在目前公開資料內的遊戲。",
      date: "Steam／NS／NS2 平台別確切發售日 · 平台類別 TAG 可移上查看完整平台",
      explore: "已收錄的 Steam／NS／NS2 遊戲 · TAG 依各資料來源",
      all: "本站所有公開收錄 · 包含待上市與既有上市紀錄",
    };
    $("scopeNote").textContent = notes[mode] || "";
    if (mode === "saved") {
      $("savedFilter").hidden = true;
      model.savedOnly = false;
    }
    if (mode === "date") {
      renderDateHeading();
      for (const [id, direction] of [["prevDate", -1], ["nextDate", 1]]) {
        $(id).addEventListener("click", (event) => {
          if (!date || $(id).getAttribute("aria-disabled") === "true") {
            event.preventDefault();
            return;
          }
          // Preserve native open-in-new-tab behavior and the latest filters.
          if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
            clearTimeout(searchTimer);
            writeURL();
            return;
          }
          event.preventDefault();
          changeDate(D.offsetDate(date, direction));
        });
      }
      $("datePicker").addEventListener("change", (event) => {
        if (!event.target.validity.valid || !D.validDate(event.target.value)) {
          event.target.value = date || "";
          return;
        }
        changeDate(event.target.value);
      });
      window.addEventListener("popstate", () => {
        clearTimeout(searchTimer);
        const params = new URLSearchParams(location.search);
        date = D.validDate(params.get("date")) ? params.get("date") : null;
        restoreQueryFilters(params);
        model.limit = PAGE_SIZE;
        renderDateHeading();
        renderExplorer();
      });
    }
  }

  async function load() {
    if (load.running) return;
    load.running = true;
    model.loading = true;
    $("notice").hidden = true;
    $("updateText").textContent = "正在讀取遊戲資料…";
    $("resultCount").textContent = "正在讀取遊戲資料…";
    $("gamesGrid").setAttribute("aria-busy", "true");
    const [{ catalog: official, preview }, nintendo] = await Promise.all([
      window.RadarStorage.loadSources(), window.RadarStorage.loadNintendo(),
    ]);
    try {
      model.data = D.datasets(official, preview, nintendo);
      if (mode === "all" && model.data)
        model.data = R.enrich(model.data, official, preview);
      if (mode === "explore" && model.data) {
        model.data = R.enrich(model.data, official, preview);
        allTagChoices = R.catalog(
          D.cardGames(model.data.games.filter((game) => game.date >= today)),
        );
        for (const kind of ["include", "exclude"]) model.tagFilters[kind] = model.tagFilters[kind].map(tag =>
          allTagChoices.find(entry => R.key(entry.tag) === R.key(tag))?.tag || tag);
        renderTagCatalog();
      }
      if (!model.data) {
        $("updateText").textContent = "資料暫時無法讀取";
        $("notice").replaceChildren(
          node("span", "", "暫時連不上遊戲資料，請稍後再試。"),
        );
        const retry = node("button", "", "重新讀取");
        retry.addEventListener("click", load);
        $("notice").append(retry);
        $("notice").hidden = false;
        if (mode === "home") {
          $("spotlightGames").replaceChildren(
            empty("新作資料暫時無法讀取", "請使用下方「重新讀取」再試一次。"),
          );
          $("spotlightGames").setAttribute("aria-busy", "false");
          $("recentGames").replaceChildren(
            empty("近期上市資料暫時無法讀取", "稍後再回來看看。"),
          );
        }
      } else {
        renderStatus();
        renderHome();
      }
    } catch (error) {
      console.error("Unable to render game data", error);
      model.data = null;
      $("updateText").textContent = "資料格式暫時無法讀取";
      $("notice").textContent = "遊戲資料格式暫時無法讀取，請稍後再試。";
      $("notice").hidden = false;
    } finally {
      model.loading = false;
      load.running = false;
      renderExplorer();
      updateSavedControls();
    }
  }
  let motionOn = window.RadarMotion?.enabled !== false;
  let revealObserver = null;
  function setupMotion() {
    document.addEventListener("radar:motionchange", () => {
      motionOn = window.RadarMotion.enabled;
      if (!motionOn)
        document.querySelectorAll(".reveal-pending").forEach((el) => {
          el.classList.remove("reveal-pending", "is-visible");
          el.style.transitionDelay = "";
        });
    });
    if ("IntersectionObserver" in window) {
      revealObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.dataset.revealed = "true";
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
            setTimeout(() => {
              entry.target.classList.remove("reveal-pending", "is-visible");
              entry.target.style.transitionDelay = "";
            }, 650);
          }
        },
        { threshold: 0.04 },
      );
    }
  }
  function revealCards(area) {
    if (!revealObserver || !motionOn) return;
    area.querySelectorAll(".game-card").forEach((card, index) => {
      if (card.dataset.revealed) return;
      card.style.transitionDelay = Math.min(index % 4, 3) * 45 + "ms";
      card.classList.add("reveal-pending");
      revealObserver.observe(card);
    });
  }
  function celebrateSave(appid) {
    if (!motionOn || !saved.has(appid)) return;
    document
      .querySelectorAll(`button[data-save="${appid}"]`)
      .forEach((button) => {
        button.classList.remove("celebrate");
        void button.offsetWidth;
        button.classList.add("celebrate");
        setTimeout(() => button.classList.remove("celebrate"), 700);
      });
    document.querySelectorAll("[data-saved-count]").forEach((badge) => {
      badge.classList.add("bounce");
      setTimeout(() => badge.classList.remove("bounce"), 700);
    });
  }
  setupMotion();
  updateSavedControls();
  renderExplorer();
  load();
})();
