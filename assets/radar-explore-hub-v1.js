/* The discovery hub is navigation-first; routes work before data arrives. */
(() => {
  "use strict";
  const D = window.RadarData;
  const R = window.RadarDiscovery;
  const $ = (id) => document.getElementById(id);
  const savedKey = "game-trend-radar:saved:v1";
  const number = new Intl.NumberFormat("zh-TW");
  function updateSaved() {
    let count = 0;
    try {
      const ids = JSON.parse(localStorage.getItem(savedKey) || "[]");
      if (Array.isArray(ids)) count = new Set(ids.filter(id => Number.isSafeInteger(id) && id > 0)).size;
    } catch { /* Navigation remains available if storage is restricted. */ }
    document.querySelectorAll("[data-saved-count]").forEach(el => el.textContent = String(count));
  }
  async function load(force = false) {
    $("hubRetry").hidden = true;
    $("hubStatus").textContent = "正在整理已收錄的遊戲…";
    try {
      const { catalog, preview } = await window.RadarStorage.loadSources({ force });
      const raw = D.datasets(catalog, preview);
      if (!raw) throw new Error("No published catalog");
      const data = R.enrich(raw, catalog, preview);
      const today = D.todayInTaipei();
      $("hubTotal").textContent = `${number.format(D.selectGames(data, "all", today).length)} 款已收錄`;
      const counts = {
        upcoming: `${D.selectGames(data, "upcoming", today).length} 款即將上市`,
        released: `${D.selectGames(data, "released", today).length} 款近期上市`,
        tags: `${R.catalog(data.games.filter(game => game.date >= today)).length} 個遊戲 TAG`,
      };
      document.querySelectorAll("[data-hub-count]").forEach(el => el.textContent = counts[el.dataset.hubCount]);
      const updated = new Date(data.updated || "");
      $("hubStatus").textContent = Number.isFinite(updated.getTime())
        ? `資料更新 · ${new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(updated)}（台灣）`
        : "以目前公開收錄資料為準。";
    } catch {
      $("hubStatus").textContent = "收錄數量暫時無法讀取，仍可前往各功能頁。";
      $("hubRetry").hidden = false;
    }
  }
  $("hubRetry").addEventListener("click", () => load(true));
  window.addEventListener("storage", event => {
    if (event.key === savedKey || event.key === null) updateSaved();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey &&
        !event.target.matches('input,textarea,select,[contenteditable="true"]')) {
      event.preventDefault();
      $("hubSearch").focus();
    }
  });
  updateSaved();
  load();
})();
