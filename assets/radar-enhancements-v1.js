/* Small shared interactions; public JSON and local browser preferences only. */
(() => {
  "use strict";
  const I = window.RadarInsights;
  const make = (tag, className = "", text = null) => {
    const el = document.createElement(tag);
    el.className = className;
    if (text !== null) el.textContent = text;
    return el;
  };
  const shapes = {
    calendar: '<rect x="13" y="18" width="49" height="47" rx="10"/><path d="M13 33h49M26 12v13m22-13v13M27 47h8m-8 10h8"/><circle cx="59" cy="58" r="15"/><path d="m53 58 5 5 8-10"/>',
    rocket: '<path d="m24 49 3-15 26-20 13 13-20 26-15 3-7-7Z"/><circle cx="50" cy="30" r="6"/><path d="m29 56-5 13-2-11-11-2 13-6M43 20l-17-1-9 16 12-1m31 12 1 17-16 9 1-19"/>',
    tags: '<path d="m13 37 27-24 24 4 4 24-27 27-28-31Z"/><circle cx="52" cy="28" r="5"/><path d="m25 40 12 13m-5-20 13 13M13 17l-4-6m55 48 7 2M49 72l1 5"/>',
  };
  function illustration(kind = "calendar") {
    const el = make("span", "empty-illustration illustration-" + kind);
    el.setAttribute("aria-hidden", "true");
    // Constant original drawings; never insert game data as markup.
    el.innerHTML = `<svg viewBox="0 0 80 80">${shapes[kind] || shapes.calendar}</svg>`;
    return el;
  }
  function pulseSaved() {
    if (!window.RadarMotion?.enabled) return;
    document.querySelectorAll("[data-saved-count]").forEach(el => {
      el.animate?.([{ transform: "scale(1)" }, { transform: "scale(1.25)", background: "#d7efd6" }, { transform: "scale(1)" }], { duration: 280 });
    });
  }
  const compareKey = "game-trend-radar:compare:v1";
  let selected = [];
  try { selected = I.comparisonIds(JSON.parse(localStorage.getItem(compareKey) || "[]")); } catch {}
  const names = new Map();
  const onAnalysis = document.body.dataset.page === "analysis";
  const dock = make("aside", "compare-dock");
  dock.hidden = true;
  dock.setAttribute("aria-label", "遊戲比較清單");
  const dockLabel = make("span", "compare-dock-label");
  const dockLink = make("a", "compare-open", "開啟比較 ↗");
  const dockClear = make("button", "compare-clear", "清空");
  dockClear.type = "button";
  dock.append(dockLabel, dockLink, dockClear);
  if (!onAnalysis) document.body.append(dock);
  function compareURL(ids = selected) { return "./analysis.html" + (ids.length ? "?ids=" + ids.join(",") : ""); }
  function updateCompare() {
    dock.hidden = !selected.length;
    document.body.classList.toggle("has-comparison", !!selected.length && !onAnalysis);
    dockLabel.textContent = `已選 ${selected.length} / 3 款`;
    dockLink.href = compareURL();
    dockLink.title = selected.map(id => names.get(id) || `App ${id}`).join("、");
    document.querySelectorAll("button[data-compare]").forEach(button => {
      const active = selected.includes(Number(button.dataset.compare));
      button.setAttribute("aria-pressed", String(active));
      button.textContent = button.classList.contains("card-compare")
        ? (active ? "✓ 已選比較" : "＋ 比較") : (active ? "✓ 已加入比較" : "＋ 加入比較");
      button.setAttribute("aria-label", `${active ? "移出" : "加入"}比較：${button.dataset.gameName}`);
    });
  }
  function feedback(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(feedback.timer);
    feedback.timer = setTimeout(() => toast.classList.remove("visible"), 2800);
  }
  function setCompared(ids, silent = false) {
    selected = I.comparisonIds(ids);
    let durable = true;
    try { localStorage.setItem(compareKey, JSON.stringify(selected)); } catch { durable = false; }
    updateCompare();
    document.dispatchEvent(new CustomEvent("radar:comparechange", { detail: [...selected] }));
    if (!durable && !silent) feedback("已更新本次比較；瀏覽器目前無法儲存比較清單。");
  }
  function toggleCompared(id, name) {
    if (!selected.includes(id) && selected.length === 3) {
      feedback("一次最多比較 3 款，請先移除其中一款。");
      return false;
    }
    const exists = selected.includes(id);
    setCompared(exists ? selected.filter(value => value !== id) : [...selected, id]);
    feedback(exists ? `已將「${name}」移出比較` : `已加入「${name}」 · ${selected.length} / 3 款`);
    return true;
  }
  function attachCompare(card, game) {
    if (game.source === "nintendo") return;
    names.set(game.appid, game.name);
    if (card.querySelector("[data-compare]")) return;
    const button = make("button", "card-compare");
    button.type = "button";
    button.dataset.compare = game.appid;
    button.dataset.gameName = game.name;
    const active = selected.includes(game.appid);
    button.textContent = active ? "✓ 已選比較" : "＋ 比較";
    button.setAttribute("aria-label", `${active ? "移出" : "加入"}比較：${game.name}`);
    button.setAttribute("aria-pressed", String(active));
    card.append(button);
  }
  document.addEventListener("click", event => {
    const button = event.target.closest("button[data-compare]");
    if (button) toggleCompared(Number(button.dataset.compare), button.dataset.gameName);
  });
  dockClear.addEventListener("click", () => {
    const target = document.querySelector("button[data-compare][aria-pressed=true]");
    setCompared([]);
    target?.focus({ preventScroll: true });
  });
  window.addEventListener("storage", event => {
    if (event.key !== compareKey && event.key !== null) return;
    try { selected = I.comparisonIds(JSON.parse(event.newValue || "[]")); } catch { selected = []; }
    updateCompare();
    document.dispatchEvent(new CustomEvent("radar:comparechange", { detail: [...selected] }));
  });
  updateCompare();
  window.RadarCompare = { ids: () => [...selected], set: setCompared, toggle: toggleCompared, url: compareURL };

  // Remember a list's exact filters, pagination and position before opening a game.
  const journeyKey = "game-trend-radar:journey:v1:" + location.pathname + location.search;
  let returnState = null;
  try {
    const previous = new URL(document.referrer || location.href);
    if ((previous.origin === location.origin && previous.pathname.endsWith("/game.html")) || performance.getEntriesByType?.("navigation")[0]?.type === "back_forward") {
      const stored = JSON.parse(sessionStorage.getItem(journeyKey) || "null");
      if (stored && Date.now() - stored.at < 3600000 && Number.isFinite(stored.y) && stored.y >= 0 && stored.y < 1000000)
        returnState = { ...stored, limit: Math.min(360, Math.max(36, Number(stored.limit) || 36)) };
    }
  } catch {}
  window.RadarJourney = { restore: returnState };
  let listLimit = 36, restored = false;
  document.addEventListener("radar:content-ready", event => {
    listLimit = event.detail?.limit || listLimit;
    if (returnState && !restored) {
      restored = true;
      requestAnimationFrame(() => {
        const id = Number(returnState.appid);
        document.querySelector(`.game-card[data-appid="${id}"] .card-detail-link`)?.focus({ preventScroll: true });
        window.scrollTo({ top: returnState.y, behavior: "instant" });
      });
    }
  });
  document.addEventListener("click", event => {
    const link = event.target.closest('a[href*="game.html?appid="]');
    if (!link || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === "_blank") return;
    let url;
    try { url = new URL(link.href); } catch { return; }
    if (url.origin !== location.origin) return;
    const appid = Number(url.searchParams.get("appid"));
    try {
      sessionStorage.setItem(journeyKey, JSON.stringify({ y: window.scrollY, limit: listLimit, appid, at: Date.now() }));
      sessionStorage.setItem("game-trend-radar:return:v1", JSON.stringify({ path: location.pathname + location.search, at: Date.now() }));
    } catch {}
  });
  for (const type of ["pageswap", "pagereveal"]) window.addEventListener(type, event => {
    if (!window.RadarMotion?.enabled) event.viewTransition?.skipTransition();
  });
  window.addEventListener("pageshow", () => {
    document.querySelectorAll('.cover-link[style*="view-transition-name"]').forEach(el => el.style.viewTransitionName = "");
  });
  window.RadarEnhancements = { attachCompare, illustration, pulseSaved, feedback, make };

  const ticker = document.getElementById("activityTicker");
  if (!ticker) return;
  const viewport = document.getElementById("activityViewport");
  const track = document.getElementById("activityTrack");
  const pause = document.getElementById("activityPause");
  const open = document.getElementById("activityMore");
  const dialog = document.getElementById("activityDialog");
  const list = document.getElementById("activityList");
  open.disabled = true;
  let manualPause = false, events = [], featured = [], current = 0, timer = null, flip = null;
  const dateLabel = value => String(value || "").replaceAll("-", "/");
  function eventLink(event, clone = false) {
    const a = make("a", "activity-item");
    a.href = I.activityURL(event);
    const addedDay = I.taipeiDay(event.at);
    const added = make("time", "activity-added-at", addedDay ? dateLabel(addedDay) : "日期未提供");
    if (addedDay) added.dateTime = addedDay;
    added.title = "這則動態的新增日期（台灣時間）";
    const type = make("span", "activity-kind " + (event.type === "added" ? "is-new" : "is-date"),
      event.type === "added" ? "新收錄" : event.type === "platform_added" ? "新增平台" : "日期更新");
    a.append(added, type);
    if (event.source === "nintendo") a.append(make("span", "activity-kind", I.activityPlatform(event)));
    a.append(make("span", "activity-name", event.name));
    if (event.type === "release_date") a.append(make("span", "activity-change", `${dateLabel(event.previous_date)} → ${dateLabel(event.date)}`));
    else a.append(make("span", "activity-change", dateLabel(event.date) + " 上市"));
    a.title = [...a.children].map(child => child.textContent).join(" · ");
    a.setAttribute("aria-label", a.title);
    if (clone) { a.tabIndex = -1; a.setAttribute("aria-hidden", "true"); }
    return a;
  }
  function cancelFlip() {
    if (!flip) return;
    const animation = flip;
    flip = null;
    animation.cancel();
    track.lastElementChild?.remove();
  }
  function canFlip() {
    return !!window.RadarMotion?.enabled && featured.length > 1 && typeof track.animate === "function" &&
      !manualPause && !document.hidden && !dialog.open && !ticker.matches(":hover, :focus-within");
  }
  function schedule() {
    clearTimeout(timer);
    timer = canFlip() && !flip ? setTimeout(advance, 4500) : null;
  }
  function advance() {
    if (!canFlip()) { schedule(); return; }
    const next = (current + 1) % featured.length;
    track.append(eventLink(featured[next], true));
    const animation = track.animate([
      { transform: "translateY(0)" },
      { transform: `translateY(-${viewport.clientHeight}px)` },
    ], { duration: 460, easing: "cubic-bezier(.22,1,.36,1)" });
    flip = animation;
    animation.finished.then(() => {
      if (flip !== animation) return;
      flip = null;
      current = next;
      track.replaceChildren(eventLink(featured[current]));
      schedule();
    }, () => {});
  }
  function motion() {
    const animated = !!window.RadarMotion?.enabled && featured.length > 1 && typeof track.animate === "function";
    ticker.classList.toggle("ticker-static", !animated);
    ticker.classList.toggle("ticker-paused", manualPause);
    pause.disabled = !animated;
    pause.setAttribute("aria-pressed", String(manualPause || !animated));
    pause.setAttribute("aria-label", manualPause || !animated ? "播放雷達動態" : "暫停雷達動態");
    pause.textContent = manualPause || !animated ? "▶" : "Ⅱ";
    if (!canFlip()) cancelFlip();
    schedule();
  }
  pause.addEventListener("click", () => { manualPause = !manualPause; motion(); });
  document.addEventListener("radar:motionchange", motion);
  ticker.addEventListener("mouseenter", motion);
  ticker.addEventListener("mouseleave", motion);
  ticker.addEventListener("focusin", motion);
  ticker.addEventListener("focusout", () => queueMicrotask(motion));
  document.addEventListener("visibilitychange", () => { ticker.classList.toggle("ticker-background", document.hidden); motion(); });
  open.addEventListener("click", () => { dialog.showModal(); ticker.classList.add("ticker-reading"); motion(); });
  document.getElementById("activityClose").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { ticker.classList.remove("ticker-reading"); open.focus({ preventScroll: true }); motion(); });
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  async function loadActivity() {
    const data = await window.RadarStorage.readJSON("./data/activity.json", value => value?.version === 1 && Array.isArray(value.events));
    events = I.activityEvents(data?.events);
    if (!events.length) {
      track.replaceChildren(make("span", "activity-empty", data ? "近期沒有新收錄、發售日期或平台異動。" : "更新動態暫時無法讀取。"));
      open.hidden = true; pause.hidden = true; motion(); return;
    }
    featured = events.slice(0, 8);
    track.replaceChildren(eventLink(featured[current]));
    open.disabled = false;
    list.replaceChildren(...events.map(event => {
      const item = make("li");
      item.append(eventLink(event));
      return item;
    }));
    motion();
  }
  loadActivity();
})();
