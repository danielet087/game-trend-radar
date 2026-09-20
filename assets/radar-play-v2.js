(() => {
  "use strict";
  const D = window.RadarData;
  const $ = (id) => document.getElementById(id);
  const mode = document.body.dataset.page;
  const today = D.todayInTaipei();
  const number = new Intl.NumberFormat("zh-TW");
  const storageKey = "game-trend-radar:saved:v1";
  const PAGE_SIZE = 36;
  const query = new URLSearchParams(location.search);
  const monthPattern = /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/;
  const requestedDate = query.get("date");
  const date = D.validDate(requestedDate) ? requestedDate : null;
  let saved = new Set();
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (Array.isArray(value))
      saved = new Set(value.filter((id) => Number.isInteger(id) && id > 0));
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
    limit: PAGE_SIZE,
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
    document.querySelectorAll("[data-saved-count]").forEach((el) => {
      el.textContent = saved.size;
    });
    document.querySelectorAll("button[data-save]").forEach((button) => {
      const active = saved.has(Number(button.dataset.save));
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
  function toggleSave(appid, name) {
    if (saved.has(appid)) saved.delete(appid);
    else saved.add(appid);
    let durable = true;
    try {
      localStorage.setItem(storageKey, JSON.stringify([...saved]));
    } catch {
      durable = false;
    }
    updateSavedControls();
    if (mode === "saved" || model.savedOnly) renderExplorer();
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
    if (button) toggleSave(Number(button.dataset.save), button.dataset.name);
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey && event.key !== null) return;
    try {
      const value = JSON.parse(event.newValue || "[]");
      saved = new Set(
        Array.isArray(value)
          ? value.filter((id) => Number.isInteger(id) && id > 0)
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
  function externalLink(game, className) {
    const a = node("a", className);
    a.href = game.link;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.setAttribute("aria-label", `在 Steam 開啟 ${game.name}（另開分頁）`);
    return a;
  }
  function makeCard(game) {
    const card = node("article", "game-card");
    const cover = externalLink(game, "cover-link");
    const fallback = node("span", "cover-placeholder");
    fallback.setAttribute("aria-hidden", "true");
    cover.append(fallback);
    if (game.art) {
      const img = node("img");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.src = game.art;
      img.addEventListener(
        "error",
        () => {
          img.remove();
          fallback.hidden = false;
        },
        { once: true },
      );
      fallback.hidden = true;
      cover.append(img);
    }
    const days = Math.round(
      (Date.parse(game.date + "T12:00:00Z") -
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
    save.dataset.name = game.name;
    save.innerHTML = heart;
    save.setAttribute(
      "aria-label",
      `${saved.has(game.appid) ? "取消收藏" : "收藏"} ${game.name}`,
    );
    save.setAttribute("aria-pressed", String(saved.has(game.appid)));
    const body = node("div", "card-body");
    const title = node("h3", "card-title");
    const titleLink = externalLink(game, "");
    titleLink.textContent = game.name;
    titleLink.title = game.name;
    title.append(titleLink);
    body.append(title);
    if (game.nameEn && game.nameEn !== game.name)
      body.append(node("p", "card-english", game.nameEn));
    if (game.darkHorse) {
      const badge = node("span", "dark-horse", "近期黑馬");
      badge.title = "直接上市，並於發售首週內確認超過 3,000 人關注";
      body.append(badge);
    }
    const meta = node("div", "card-meta");
    const time = node("time", "", game.date.replaceAll("-", "/"));
    time.dateTime = game.date;
    const followers = node(
      "span",
      "card-followers",
      number.format(game.followers),
    );
    followers.append(node("small", "", "人關注"));
    meta.append(time, followers);
    body.append(meta);
    const peek = node("button", "quick-view", "快速查看");
    peek.type = "button";
    peek.dataset.peek = game.appid;
    peek.setAttribute("aria-label", `快速查看 ${game.name}`);
    const arrow = node("span", "", "↗");
    arrow.setAttribute("aria-hidden", "true");
    peek.append(arrow);
    card.append(cover, save, body, peek);
    addTilt(card);
    return card;
  }
  function empty(title, text, action = null) {
    const area = node("div", "empty-state");
    const symbol = node("span", "empty-symbol", "◎");
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
    let coverage = `目前收錄 ${number.format(data.games.length)} 款具備明確日期、至少 5,000 人關注的遊戲。${data.partial ? "清單尚在持續補齊，不代表全部符合條件的遊戲。" : ""}`;
    if (init?.candidate_count)
      coverage += ` 已取得 ${number.format(init.candidate_count)} 款候選新作，逐步核對關注人數。`;
    if (mode === "released")
      coverage =
        "近期上市僅列出近 30 天內、已確認發售且關注人數嚴格超過 3,000 的遊戲。近期黑馬另須於上市首週達標。";
    if (data.source === "preview")
      coverage += " 正式清單暫時無法讀取，目前使用已公開的預覽資料。";
    $("coverageText").textContent = coverage;
  }
  function renderHome() {
    if (mode !== "home" || !model.data) return;
    const data = model.data;
    const upcoming = D.selectGames(data, "upcoming", today).sort(
      (a, b) => a.date.localeCompare(b.date) || b.followers - a.followers,
    );
    const recent = D.selectGames(data, "released", today).sort(
      (a, b) => b.followers - a.followers || b.date.localeCompare(a.date),
    );
    $("totalCount").textContent = number.format(data.games.length);
    $("upcomingCount").textContent = number.format(upcoming.length);
    $("releasedCount").textContent = data.recentAvailable
      ? number.format(recent.length)
      : "—";
    $("spotlightGames").replaceChildren(...upcoming.slice(0, 4).map(makeCard));
    $("spotlightGames").setAttribute("aria-busy", "false");
    renderFeature(upcoming);
    revealCards($("spotlightGames"));
    if (!upcoming.length)
      $("spotlightGames").append(
        empty(
          "下一波新作，正在路上",
          "目前尚無未來 45 天內符合關注門檻的遊戲。",
        ),
      );
    $("recentGames").replaceChildren(...recent.slice(0, 3).map(makeCard));
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
    set(
      "min",
      $("followersFilter").selectedIndex ? $("followersFilter").value : "",
    );
    set("saved", model.savedOnly ? "1" : "");
    set("sort", $("sortSelect").selectedIndex ? $("sortSelect").value : "");
    history.replaceState(null, "", url);
  }
  function activeFilters() {
    return !!(
      $("searchInput").value.trim() ||
      $("followersFilter").selectedIndex ||
      model.savedOnly
    );
  }
  function filteredGames() {
    if (!model.data) return { source: [], items: [] };
    let source = D.selectGames(model.data, mode, today, date);
    if (mode === "home")
      source = source.filter((game) => game.date.startsWith(model.month));
    if (mode === "saved")
      source = source.filter((game) => saved.has(game.appid));
    const term = $("searchInput").value.trim().toLocaleLowerCase();
    const min = Number($("followersFilter").value);
    const items = source.filter(
      (game) =>
        (!term ||
          `${game.name} ${game.nameEn} ${game.appid}`
            .toLocaleLowerCase()
            .includes(term)) &&
        game.followers >= min &&
        (!model.savedOnly || saved.has(game.appid)),
    );
    const order = $("sortSelect").value;
    items.sort((a, b) =>
      order === "followers"
        ? b.followers - a.followers || a.date.localeCompare(b.date)
        : order === "name"
          ? a.name.localeCompare(b.name, "zh-TW")
          : order === "newest"
            ? b.date.localeCompare(a.date) || b.followers - a.followers
            : a.date.localeCompare(b.date) || b.followers - a.followers,
    );
    return { source, items };
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
    byDate.forEach((list) => list.sort((a, b) => b.followers - a.followers));
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
      const link = node("a", "date-link", Number(day.slice(-2)));
      link.href = `./date.html?date=${day}`;
      link.setAttribute("aria-label", `${day} 發售遊戲完整清單`);
      if (day === today) {
        link.setAttribute("aria-current", "date");
        link.append(node("b", "", "今天"));
      }
      cell.append(link);
      dayGames.slice(0, 2).forEach((game, rank) => {
        const tag = externalLink(game, "day-game" + (rank ? " second" : ""));
        tag.textContent = game.name;
        tag.title = `${game.name} · ${number.format(game.followers)} 人關注`;
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
    if (mode === "home") {
      $("calendarArea").hidden = model.view !== "calendar";
      $("gamesGrid").hidden = model.view === "calendar";
      $("calendarView").setAttribute(
        "aria-pressed",
        String(model.view === "calendar"),
      );
      $("listView").setAttribute("aria-pressed", String(model.view === "list"));
      $("sortWrap").hidden = model.view === "calendar";
      $("monthLabel").textContent =
        `${model.month.slice(0, 4)} 年 ${Number(model.month.slice(5))} 月`;
    }
    const { source, items } = filteredGames();
    $("savedFilter").setAttribute("aria-pressed", String(model.savedOnly));
    $("resetFilters").hidden = !activeFilters();
    if (model.loading) {
      if (mode === "home") renderCalendar([]);
      return;
    }
    const filtered = activeFilters();
    $("resultCount").textContent = model.data
      ? `${mode === "home" ? "本月" : "共"} ${items.length} 款${filtered ? ` / ${source.length} 款` : ""}${mode === "home" && !items.length ? " · 尚無符合條件的遊戲" : ""}`
      : "資料暫時無法讀取";
    if (mode === "home") renderCalendar(items);
    $("gamesGrid").setAttribute("aria-busy", "false");
    $("gamesGrid").replaceChildren(
      ...items.slice(0, model.limit).map(makeCard),
    );
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
        text = "日期格式有誤，請回到月曆選擇日期。";
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
      $("gamesGrid").append(empty(title, text, action));
    }
    updateSavedControls();
  }
  function resetFilters() {
    $("searchInput").value = "";
    $("followersFilter").selectedIndex = 0;
    model.savedOnly = false;
    model.limit = PAGE_SIZE;
    writeURL();
    renderExplorer();
    $("searchInput").focus();
  }
  function changeFilters() {
    model.limit = PAGE_SIZE;
    writeURL();
    renderExplorer();
  }
  $("searchInput").value = query.get("q") || "";
  for (const [id, param] of [
    ["followersFilter", "min"],
    ["sortSelect", "sort"],
  ]) {
    if ([...$(id).options].some((option) => option.value === query.get(param)))
      $(id).value = query.get(param);
  }
  $("searchInput").addEventListener("input", changeFilters);
  $("followersFilter").addEventListener("change", changeFilters);
  $("sortSelect").addEventListener("change", changeFilters);
  $("savedFilter").addEventListener("click", () => {
    model.savedOnly = !model.savedOnly;
    changeFilters();
  });
  $("resetFilters").addEventListener("click", resetFilters);
  $("loadMore").addEventListener("click", () => {
    const previous = model.limit;
    model.limit += PAGE_SIZE;
    renderExplorer();
    $("gamesGrid").querySelectorAll(".card-title a")[previous]?.focus();
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
    $("searchInput").placeholder = "搜尋本月遊戲名稱或 AppID…";
    function stepMonth(direction) {
      const [year, month] = model.month.split("-").map(Number);
      const next = new Date(Date.UTC(year, month - 1 + direction, 1));
      if (next.getUTCFullYear() < 1900 || next.getUTCFullYear() > 2199) return;
      model.month = next.toISOString().slice(0, 7);
      changeFilters();
    }
    $("prevMonth").addEventListener("click", () => stepMonth(-1));
    $("nextMonth").addEventListener("click", () => stepMonth(1));
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
      upcoming: "未來 45 天 · 至少 5,000 人關注 · 僅列出明確發售日期",
      released: "近 30 天 · 關注人數超過 3,000 · 已確認發售",
      saved: "收藏儲存在此瀏覽器；此處顯示仍在目前公開資料內的遊戲。",
      date: "至少 5,000 人關注 · 依關注度排序",
    };
    $("scopeNote").textContent = notes[mode] || "";
    if (mode === "saved") {
      $("savedFilter").hidden = true;
      model.savedOnly = false;
    }
    if (mode === "date") {
      if (date) {
        const weekday = new Intl.DateTimeFormat("zh-TW", {
          weekday: "long",
          timeZone: "Asia/Taipei",
        }).format(new Date(date + "T12:00:00Z"));
        $("pageTitle").textContent =
          `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8))} 日・${weekday}`;
        $("scopeNote").textContent =
          `${date.slice(0, 4)} 年 · 至少 5,000 人關注 · 依關注度排序`;
        $("backCalendar").href = `./index.html?month=${date.slice(0, 7)}`;
        document.title = `${date} 發售遊戲｜Game Trend Radar`;
      } else $("pageTitle").textContent = "找不到指定日期";
    }
  }
  async function readJSON(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(
        `${path}?t=${Math.floor(Date.now() / 300000)}`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!response.ok) return null;
      const data = await response.json();
      return data && Array.isArray(data.games) ? data : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
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
    const [official, preview] = await Promise.all(
      ["./data/steam_upcoming.json", "./data/steam_preview.json"].map(readJSON),
    );
    try {
      model.data = D.datasets(official, preview);
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
          renderFeature([]);
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
    }
  }
  // Motion has one global switch; no animation is required to read or operate the site.
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let motionOn = !reducedMotion.matches;
  let featureGames = [];
  let featureIndex = 0;
  let featurePlaying = true;
  let featureHover = false;
  let featureTimer = null;
  let revealObserver = null;
  function updateMotion() {
    document.body.classList.toggle("motion-on", motionOn);
    document.body.classList.toggle("motion-off", !motionOn);
    const button = $("motionToggle");
    button.setAttribute("aria-pressed", String(motionOn));
    button.setAttribute(
      "aria-label",
      motionOn ? "關閉動態效果" : "開啟動態效果",
    );
    button.title = button.getAttribute("aria-label");
    button.querySelector("span").textContent = motionOn
      ? "動態 ON"
      : "動態 OFF";
    button
      .querySelector("path")
      .setAttribute("d", motionOn ? "M9 5v14M15 5v14" : "m8 5 11 7-11 7Z");
    if (!motionOn)
      document
        .querySelectorAll(".reveal-pending")
        .forEach((el) => el.classList.add("is-visible"));
    scheduleFeature();
  }
  function setupMotion() {
    try {
      if (localStorage.getItem("game-trend-radar:motion:v2") === "off")
        motionOn = false;
    } catch {}
    $("motionToggle").addEventListener("click", () => {
      motionOn = !motionOn;
      try {
        localStorage.setItem(
          "game-trend-radar:motion:v2",
          motionOn ? "on" : "off",
        );
      } catch {}
      updateMotion();
    });
    reducedMotion.addEventListener?.("change", (event) => {
      if (event.matches) {
        motionOn = false;
        updateMotion();
      }
    });
    if ("IntersectionObserver" in window) {
      revealObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              revealObserver.unobserve(entry.target);
              setTimeout(() => {
                entry.target.classList.remove("reveal-pending", "is-visible");
                entry.target.style.transitionDelay = "";
              }, 850);
            }
          });
        },
        { threshold: 0.08, rootMargin: "0px 0px -20px 0px" },
      );
      document
        .querySelectorAll(
          ".section-heading, .stats, .bottom-note, .page-heading",
        )
        .forEach((el) => {
          el.classList.add("reveal-pending");
          revealObserver.observe(el);
        });
    }
    updateMotion();
    document.addEventListener("visibilitychange", scheduleFeature);
  }
  function revealCards(area) {
    if (!revealObserver || !motionOn) return;
    area.querySelectorAll(".game-card").forEach((card, index) => {
      card.style.transitionDelay = Math.min(index % 4, 3) * 45 + "ms";
      card.classList.add("reveal-pending");
      revealObserver.observe(card);
    });
  }
  function addTilt(card) {
    let frame = null;
    card.addEventListener("pointermove", (event) => {
      if (!motionOn || event.pointerType !== "mouse") return;
      cancelAnimationFrame(frame);
      const x = event.clientX,
        y = event.clientY;
      frame = requestAnimationFrame(() => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty(
          "--tilt-x",
          ((0.5 - (y - rect.top) / rect.height) * 5).toFixed(2) + "deg",
        );
        card.style.setProperty(
          "--tilt-y",
          (((x - rect.left) / rect.width - 0.5) * 5).toFixed(2) + "deg",
        );
      });
    });
    card.addEventListener("pointerleave", () => {
      cancelAnimationFrame(frame);
      card.style.setProperty("--tilt-x", "0deg");
      card.style.setProperty("--tilt-y", "0deg");
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
  function featureImage(game) {
    const image = node("img");
    image.src = game.art;
    image.alt = "";
    image.decoding = "async";
    image.addEventListener(
      "error",
      () => image.replaceWith(node("span", "cover-placeholder")),
      { once: true },
    );
    return image;
  }
  function renderFeature(upcoming) {
    if (!$("featureStack")) return;
    // Prefer readable existing header artwork; all selections remain actual verified records.
    featureGames = [...upcoming]
      .sort(
        (a, b) =>
          Number(/header/.test(b.art)) - Number(/header/.test(a.art)) ||
          b.followers - a.followers,
      )
      .slice(0, 4);
    const stack = $("featureStack");
    stack.replaceChildren();
    stack.setAttribute("aria-busy", "false");
    $("featureDots").replaceChildren();
    if (!featureGames.length) {
      const fallback = node("div", "feature-placeholder");
      fallback.append(
        node("span", "", "◎"),
        node("p", "", "下一波新作，正在路上"),
      );
      stack.append(fallback);
      $("featureControls").hidden = true;
      clearTimeout(featureTimer);
      return;
    }
    featureIndex = 0;
    featureGames.forEach((game, index) => {
      const slide = node("article", "feature-slide");
      slide.id = "featureSlide" + index;
      slide.setAttribute(
        "aria-label",
        `${index + 1} / ${featureGames.length}：${game.name}`,
      );
      slide.hidden = index !== 0;
      const cover = externalLink(game, "feature-cover");
      if (game.art) cover.append(featureImage(game));
      else cover.append(node("span", "cover-placeholder"));
      cover.append(node("span", "feature-chip", "焦點新作"));
      const body = node("div", "feature-body");
      const heading = node("h2");
      const titleLink = externalLink(game, "");
      titleLink.textContent = game.name;
      titleLink.title = game.name;
      heading.append(titleLink);
      const metadata = node("div", "feature-meta");
      const release = node("time", "", game.date.replaceAll("-", "/"));
      release.dateTime = game.date;
      const follows = node("span");
      follows.append(
        node("strong", "", number.format(game.followers)),
        node("small", "", "人關注"),
      );
      metadata.append(release, follows);
      const open = externalLink(game, "feature-open");
      open.textContent = "↗";
      body.append(heading, metadata, open);
      slide.append(cover, body);
      stack.append(slide);
      const dot = node("button", "feature-dot");
      dot.type = "button";
      dot.setAttribute("aria-label", `顯示焦點遊戲：${game.name}`);
      dot.setAttribute("aria-pressed", String(index === 0));
      dot.setAttribute("aria-controls", slide.id);
      dot.addEventListener("click", () => showFeature(index, true));
      $("featureDots").append(dot);
    });
    $("featureControls").hidden = featureGames.length < 2;
    $("featureNumber").textContent =
      `01 / ${String(featureGames.length).padStart(2, "0")}`;
    scheduleFeature();
  }
  function showFeature(index, manual = false) {
    if (!featureGames.length) return;
    featureIndex = (index + featureGames.length) % featureGames.length;
    $("featureStack")
      .querySelectorAll(".feature-slide")
      .forEach((slide, i) => {
        slide.hidden = i !== featureIndex;
        slide.classList.remove("is-entering");
        if (i === featureIndex && motionOn) {
          void slide.offsetWidth;
          slide.classList.add("is-entering");
        }
      });
    $("featureDots")
      .querySelectorAll("button")
      .forEach((dot, i) =>
        dot.setAttribute("aria-pressed", String(i === featureIndex)),
      );
    $("featureNumber").textContent =
      `${String(featureIndex + 1).padStart(2, "0")} / ${String(featureGames.length).padStart(2, "0")}`;
    if (manual)
      $("featureAnnouncement").textContent =
        `目前焦點：${featureGames[featureIndex].name}`;
    scheduleFeature();
  }
  function scheduleFeature() {
    clearTimeout(featureTimer);
    if (!$("featurePlay")) return;
    const active = featurePlaying && motionOn;
    $("featurePlay").setAttribute("aria-pressed", String(active));
    $("featurePlay").setAttribute(
      "aria-label",
      active ? "暫停焦點輪播" : "播放焦點輪播",
    );
    $("featurePlay").textContent = active ? "Ⅱ" : "▷";
    if (
      active &&
      featureGames.length > 1 &&
      !featureHover &&
      !document.hidden &&
      !$("gameDialog").open
    ) {
      featureTimer = setTimeout(() => showFeature(featureIndex + 1), 6500);
    }
  }
  function setupFeature() {
    if (!$("featureStage")) return;
    const stage = $("featureStage");
    $("featurePrev").addEventListener("click", () =>
      showFeature(featureIndex - 1, true),
    );
    $("featureNext").addEventListener("click", () =>
      showFeature(featureIndex + 1, true),
    );
    $("featurePlay").addEventListener("click", () => {
      if (!motionOn) {
        motionOn = true;
        featurePlaying = true;
        updateMotion();
      } else {
        featurePlaying = !featurePlaying;
        scheduleFeature();
      }
    });
    stage.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse") {
        featureHover = true;
        scheduleFeature();
      }
    });
    stage.addEventListener("pointerleave", () => {
      featureHover = stage.contains(document.activeElement);
      scheduleFeature();
    });
    stage.addEventListener("focusin", () => {
      featureHover = true;
      scheduleFeature();
    });
    stage.addEventListener("focusout", (event) => {
      if (!stage.contains(event.relatedTarget)) {
        featureHover = false;
        scheduleFeature();
      }
    });
    let touch = null,
      swiped = false;
    stage.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch") {
        touch = { x: event.clientX, y: event.clientY };
        swiped = false;
      }
    });
    stage.addEventListener("pointerup", (event) => {
      if (!touch) return;
      const dx = event.clientX - touch.x,
        dy = event.clientY - touch.y;
      touch = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        swiped = true;
        showFeature(featureIndex + (dx < 0 ? 1 : -1), true);
      }
    });
    stage.addEventListener("pointercancel", () => {
      touch = null;
    });
    stage.addEventListener(
      "click",
      (event) => {
        if (swiped) {
          event.preventDefault();
          event.stopPropagation();
          swiped = false;
        }
      },
      true,
    );
    stage.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        showFeature(featureIndex + (event.key === "ArrowRight" ? 1 : -1), true);
      }
    });
  }
  function openGame(appid) {
    const game = [
      ...(model.data?.games || []),
      ...(model.data?.recent || []),
    ].find((item) => item.appid === appid);
    if (!game) return;
    const dialog = $("gameDialog"),
      content = $("dialogContent");
    content.replaceChildren();
    const art = node("div", "dialog-art");
    art.append(
      game.art ? featureImage(game) : node("span", "cover-placeholder"),
    );
    const body = node("div", "dialog-body");
    body.append(node("p", "eyebrow", "GAME SPOTLIGHT"));
    const title = node("h2", "", game.name);
    title.id = "dialogTitle";
    body.append(title);
    if (game.nameEn && game.nameEn !== game.name)
      body.append(node("p", "dialog-english", game.nameEn));
    const metrics = node("dl", "dialog-metrics");
    for (const [label, value] of [
      ["上市日期・台灣", game.date.replaceAll("-", "/")],
      ["Steam 關注人數", number.format(game.followers)],
    ]) {
      const metric = node("div");
      metric.append(node("dt", "", label), node("dd", "", value));
      metrics.append(metric);
    }
    body.append(metrics);
    const actions = node("div", "dialog-actions");
    const steam = externalLink(game, "button primary");
    steam.textContent = "前往 Steam 商店 ↗";
    const save = node("button", "save-button");
    save.type = "button";
    save.dataset.save = game.appid;
    save.dataset.name = game.name;
    save.innerHTML = heart;
    save.append(
      node("span", "save-label", saved.has(game.appid) ? "已收藏" : "加入收藏"),
    );
    actions.append(steam, save);
    body.append(
      actions,
      node(
        "p",
        "dialog-note",
        "關注人數不等同願望清單數。實際上市時間請以 Steam 商店為準。",
      ),
    );
    content.append(art, body);
    updateSavedControls();
    dialog.showModal();
    scheduleFeature();
    if (motionOn && dialog.animate)
      dialog.animate(
        [
          {
            opacity: 0,
            transform: "translateY(25px) scale(.94) rotate(-2deg)",
          },
          { opacity: 1, transform: "translateY(0) scale(1) rotate(0deg)" },
        ],
        { duration: 350, easing: "cubic-bezier(.16,1,.3,1)" },
      );
  }
  function setupDialog() {
    $("closeDialog").addEventListener("click", () => $("gameDialog").close());
    $("gameDialog").addEventListener("close", scheduleFeature);
    $("gameDialog").addEventListener("click", (event) => {
      if (event.target !== $("gameDialog")) return;
      const box = $("gameDialog").getBoundingClientRect();
      if (
        event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom
      )
        $("gameDialog").close();
    });
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("button[data-peek]");
      if (trigger) openGame(Number(trigger.dataset.peek));
    });
  }

  setupMotion();
  setupFeature();
  setupDialog();
  updateSavedControls();
  renderExplorer();
  load();
})();
