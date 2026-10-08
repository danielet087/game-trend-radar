import { createInsightsContext } from './context.js';
import { createInsightsPresentation } from './presentation.js';
import { createGrowthView } from './growth.js';
import { createComparisonView } from '../comparison/reference.js';
import { createComparisonHistory } from '../comparison/history.js';
import { registerSavedGames, savedCount } from '../../shared/state/favorites.ts';

const controllers = new WeakMap();
export function initInsightsPage(options = {}) {
  const ctx = createInsightsContext(options);
  const { $, D, R, I, E, state, document, window, location, today, mode, params, compare, storage, on } = ctx;
  const host = $('labStatus');
  if (!host) return null;
  controllers.get(host)?.destroy();
  const presentation = createInsightsPresentation(ctx);
  const growth = mode === 'growth' ? createGrowthView(ctx, presentation) : null;
  const comparisonHistory = mode === 'analysis' ? createComparisonHistory({ ...options, document, window, enhancements:E, today }) : null;
  const comparison = mode === 'analysis' ? createComparisonView(ctx, presentation, comparisonHistory) : null;
  const renderGrowth = () => growth?.render();
  const renderComparison = () => comparison?.render();
  const searchChoices = () => comparison?.searchChoices();
  let loadGeneration = 0;
  function saveURL() {
    const url = new URL(location.href);
    if (mode === "growth") {
      for (const [key, value] of [["q", $("growthSearch").value.trim()], ["days", state.span === 7 ? "" : state.span], ["period", state.scope === "all" ? "" : state.scope], ["sort", state.sort === "delta" ? "" : state.sort]]) {
        if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
      }
    } else {
      const ids = compare.ids();
      if (ids.length) url.searchParams.set("ids", ids.join(",")); else url.searchParams.delete("ids");
    }
    window.history.replaceState(window.history.state, "", url);
  }
  async function load(force = false) {
    $("labRetry").hidden = true;
    $("labStatus").textContent = "正在整理遊戲與量測紀錄…";
    const requested = ++loadGeneration;
    const results = await Promise.allSettled([
      storage.loadSources({ force }),
      storage.readJSON("./data/growth.json", value => value?.version === 1 && Array.isArray(value.games), { force }),
    ]);
    if (ctx.disposed || requested !== loadGeneration) return;
    const source = results[0].status === "fulfilled" ? results[0].value : {};
    state.rawCatalog = source.catalog;
    state.growthData = results[1].status === "fulfilled" ? results[1].value : null;
    const data = R.enrich(D.datasets(state.rawCatalog, source.preview), state.rawCatalog, source.preview);
    if (!data) {
      $("labStatus").textContent = "目前無法讀取遊戲資料，請稍後重試。";
      $("labRetry").hidden = false;
      return;
    }
    state.games = D.selectGames(data, "all", today);
    state.observations = new Map((state.growthData?.games || []).map(row => [Number(row.appid), row]));
    $("labRetry").hidden = !!state.growthData;
    $("labStatus").textContent = `共 ${state.games.length} 款公開收錄 · 日期以台灣時間為準`;
    registerSavedGames([...data.games, ...data.recent]);
    document.querySelectorAll("[data-saved-count]").forEach(el => { el.textContent = String(savedCount()); });
    if (mode === "growth") renderGrowth();
    else {
      if (!state.initialized) {
        const requested = params.has("ids") ? I.comparisonIds(params.get("ids")) : compare.ids();
        const valid = requested.filter(id => state.games.some(game => game.appid === id));
        $("compareWarning").hidden = valid.length === requested.length;
        $("compareWarning").textContent = "部分遊戲目前不在公開收錄清單中，已保留其餘可比較的遊戲。";
        compare.set(valid, true);
      }
      else { renderComparison(); saveURL(); }
    }
    state.initialized = true;
  }
  on($("labRetry"), "click", () => load(true));
  if (mode === "growth") {
    $("growthSearch").value = params.get("q") || "";
    const refresh = () => { state.limit = 25; saveURL(); renderGrowth(); };
    on($("growthSearch"), "input", event => { clearTimeout(state.searchTimer); if (!event.isComposing) state.searchTimer = setTimeout(refresh, 120); });
    on($("growthSearch"), "compositionend", refresh);
    on($("growthScope"), "change", () => { state.scope = $("growthScope").value; refresh(); });
    on($("growthSort"), "change", () => { state.sort = $("growthSort").value; refresh(); });
    document.querySelectorAll("[data-growth-days]").forEach(button => on(button, "click", () => { state.span = Number(button.dataset.growthDays); refresh(); }));
    on($("growthMore"), "click", () => { state.limit += 25; renderGrowth(); });
    on(window, "popstate", () => {
      const next = new URLSearchParams(location.search);
      state.span = [1, 7, 30].includes(Number(next.get("days"))) ? Number(next.get("days")) : 7;
      state.scope = ["all", "future", "released"].includes(next.get("period")) ? next.get("period") : "all";
      state.sort = next.get("sort") === "percent" ? "percent" : "delta";
      $("growthSearch").value = next.get("q") || "";
      state.limit = 25; renderGrowth();
    });
  } else {
    on(document.querySelector('.comparison-reference'), 'toggle', event => {
      if (event.currentTarget.open) state.loadComparisonDescriptions?.();
    });
    on($("compareSearch"), "input", event => { clearTimeout(state.searchTimer); if (!event.isComposing) state.searchTimer = setTimeout(searchChoices, 100); });
    on($("compareSearch"), "compositionend", searchChoices);
    on($("compareClear"), "click", () => { compare.set([]); $("compareSearch").focus(); });
    on($("compareShare"), "click", async () => {
      try { await window.navigator.clipboard.writeText(location.href); E.feedback("比較連結已複製，可分享目前選取的遊戲。"); }
      catch { E.feedback("目前無法自動複製，請直接複製網址列的比較連結。"); }
    });
    on(document, "radar:comparechange", () => { if (!state.games.length) return; renderComparison(); saveURL(); });
    on(window, "popstate", () => {
      const ids = I.comparisonIds(new URLSearchParams(location.search).get("ids"));
      compare.set(ids.filter(id => state.games.some(game => game.appid === id)), true);
    });
  }
  const controller = {
    ready:load(), reload:() => load(true),
    destroy() { ctx.disposed = true; clearTimeout(state.searchTimer); comparisonHistory?.destroy(); ctx.dispose(); controllers.delete(host); },
  };
  controllers.set(host, controller);
  return controller;
}
export { RadarInsights } from './metrics.js';
