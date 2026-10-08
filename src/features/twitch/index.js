import { savedCount, subscribeSaved } from "../../shared/state/favorites.ts";
import { RadarTwitch as D } from "./data.js";
import { createTwitchState, createTwitchURLState } from "./state.js";
import { createTwitchHistory } from "./history-ui.js";
import { createTwitchCards } from "./cards.js";
import { createTwitchRenderer } from "./render.js";
import { createTwitchLoader } from "./load.js";
export { RadarTwitch } from "./data.js";
export { RadarTwitchChart } from "./chart.js";

const controllers = new WeakMap();
const activeControllers = new Set();
if (import.meta.hot) import.meta.hot.dispose(() => { for (const controller of activeControllers) controller.destroy(); });

export function initTwitchPage() {
  const $ = id => document.getElementById(id);
  const anchor = $("gameResults");
  if (!anchor) return;
  if (controllers.has(anchor)) return controllers.get(anchor);
  const events = new AbortController();
  const signal = events.signal;
  const on = (target, event, handler) => target.addEventListener(event, handler, { signal });
  const state = createTwitchState();
  state.savedCount = savedCount();
  const unsubscribeSaved = subscribeSaved(snapshot => { state.savedCount = snapshot.count; });
  const cards = new Map(), historyCache = new Map(), chartDisposers = new Set();
  let searchTimer, composing = false;
  const { urlState, syncURL } = createTwitchURLState(state, $);
  const { historyPanel } = createTwitchHistory({ state, historyCache, chartDisposers, signal });
  const { gameCard, empty, evidence } = createTwitchCards({ state, historyPanel, signal });
  let renderer, loader;
  function reset() {
    clearTimeout(searchTimer); state.query = ""; state.filter = D.DEFAULT_FILTER; state.sort = D.DEFAULT_SORT; state.limit = 24;
    $("gameSearch").value = ""; $("gameSort").value = D.DEFAULT_SORT; render(); syncURL();
  }
  const render = () => renderer.render();
  const load = () => loader.load();
  renderer = createTwitchRenderer({ state, $, cards, gameCard, empty, evidence, reset, syncURL, signal });
  loader = createTwitchLoader({ state, $, cards, historyCache, chartDisposers, ...renderer, empty });
document.querySelectorAll("[data-filter]").forEach(button => on(button, "click",() => { clearTimeout(searchTimer); state.query = $("gameSearch").value; state.filter = button.dataset.filter; state.limit = 24; render(); syncURL(); }));
function search() { clearTimeout(searchTimer); if (composing) return; searchTimer = setTimeout(() => { state.query = $("gameSearch").value; state.limit = 24; render(); syncURL(); },140); }
on($("gameSearch"), "compositionstart",() => { composing = true; clearTimeout(searchTimer); });
on($("gameSearch"), "compositionend",() => { composing = false; search(); });
on($("gameSearch"), "input",search);
on($("gameSort"), "change",() => { state.sort = $("gameSort").value; render(); syncURL(); });
on($("resetFilters"), "click",reset);
on($("snapshotRefresh"), "click",load);
on($("loadMore"), "click",() => { const next = state.limit; state.limit += 24; render(); $("gameResults").children[next]?.querySelector("summary")?.focus({ preventScroll:true }); });
on(document, "keydown",event => {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "/" && !event.target.closest("input,textarea,select,[contenteditable]")) { event.preventDefault(); $("gameSearch").focus(); }
  if (event.key === "Escape" && event.target === $("gameSearch")) { clearTimeout(searchTimer); $("gameSearch").value = ""; state.query = ""; state.limit = 24; render(); syncURL(); }
});
on(window, "popstate",() => { clearTimeout(searchTimer); urlState(); render(); });
  const controller = { state, refresh: load, destroy() {
    if (state.disposed) return;
    state.disposed = true; events.abort(); clearTimeout(searchTimer); unsubscribeSaved();
    chartDisposers.forEach(dispose => dispose()); chartDisposers.clear();
    cards.clear(); historyCache.clear(); controllers.delete(anchor); activeControllers.delete(controller);
  } };
  controllers.set(anchor, controller);
  activeControllers.add(controller);
  urlState(); load();
  return controller;
}
