import { savedCount, subscribeSaved } from "../../shared/state/favorites.ts";
import { RadarTwitch as D } from "./data.js";
import { createTwitchState, createTwitchURLState } from "./state.js";
import { createTwitchHistory } from "./history-ui.js";
import { createTwitchCards } from "./cards.js";
import { createTwitchRenderer } from "./render.js";
import { createTwitchLoader } from "./load.js";
import { createTwitchArchive } from "./archive.js";
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
  let searchTimer, composing = false, view = 'current';
  const archive = createTwitchArchive({ $, signal });
  const { urlState, syncURL } = createTwitchURLState(state, $);
  const { historyPanel } = createTwitchHistory({ state, historyCache, chartDisposers, signal });
  const { gameCard, empty, evidence } = createTwitchCards({ state, historyPanel, signal });
  let renderer, loader;
  function reset() {
    clearTimeout(searchTimer); state.query = ""; state.filter = D.DEFAULT_FILTER; state.sort = D.DEFAULT_SORT; state.limit = 24;
    $("gameSearch").value = ""; $("gameSort").value = D.DEFAULT_SORT; syncURL(); render();
  }
  const render = () => { renderer.render(); archive.updateHint(state.query); };
  const load = () => loader.load();
  renderer = createTwitchRenderer({ state, $, cards, gameCard, empty, evidence, reset, syncURL, signal });
  loader = createTwitchLoader({ state, $, cards, historyCache, chartDisposers, ...renderer, render, empty });
  function showView() {
    clearTimeout(searchTimer);
    view = new URLSearchParams(location.search).get('view') === 'archive' ? 'archive' : 'current';
    $('currentObservation').hidden = $('currentSnapshot').hidden = view !== 'current';
    $('historyArchive').hidden = view !== 'archive';
    document.querySelectorAll('[data-twitch-view]').forEach(button => {
      const selected = button.dataset.twitchView === view;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    });
    urlState(); archive.readURL();
    if (view === 'archive') archive.load();
    else if (state.data) render(); else load();
  }
  function switchView(next) {
    if (next === view) return;
    if (view === 'archive') archive.flushSearch(false);
    else { clearTimeout(searchTimer); state.query = $('gameSearch').value; syncURL(); }
    const url = new URL(location.href);
    if (next === 'archive') url.searchParams.set('view', 'archive'); else url.searchParams.delete('view');
    history.pushState(null, '', url); showView();
  }
  const tabs = [...document.querySelectorAll('[data-twitch-view]')];
  tabs.forEach((button, i) => {
    on(button, 'click', () => switchView(button.dataset.twitchView));
    on(button, 'keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus(); switchView(tabs[next].dataset.twitchView);
    });
  });
document.querySelectorAll("[data-filter]").forEach(button => on(button, "click",() => { clearTimeout(searchTimer); state.query = $("gameSearch").value; state.filter = button.dataset.filter; state.limit = 24; syncURL(); render(); }));
function search() { clearTimeout(searchTimer); if (composing) return; searchTimer = setTimeout(() => { state.query = $("gameSearch").value; state.limit = 24; syncURL(); render(); },140); }
on($("gameSearch"), "compositionstart",() => { composing = true; clearTimeout(searchTimer); });
on($("gameSearch"), "compositionend",() => { composing = false; search(); });
on($("gameSearch"), "input",search);
on($("gameSort"), "change",() => { state.sort = $("gameSort").value; syncURL(); render(); });
on($('audienceRegion'), 'change', () => {
  clearTimeout(searchTimer);
  state.region = $('audienceRegion').value; state.limit = 24;
  chartDisposers.forEach(dispose => dispose()); chartDisposers.clear(); cards.clear();
  if (view === 'archive') {
    archive.flushSearch(false);
    const url = new URL(location.href);
    if (state.region === 'global') url.searchParams.set('region', 'global'); else url.searchParams.delete('region');
    history.replaceState(null, '', url); archive.render();
  } else { state.query = $('gameSearch').value; syncURL(); render(); }
});
on($("resetFilters"), "click",reset);
on($("snapshotRefresh"), "click",load);
on($("loadMore"), "click",() => { const next = state.limit; state.limit += 24; render(); $("gameResults").children[next]?.querySelector("summary")?.focus({ preventScroll:true }); });
on(document, "keydown",event => {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "/" && !event.target.closest("input,textarea,select,[contenteditable]")) { event.preventDefault(); $(view === 'archive' ? 'archiveSearch' : 'gameSearch').focus(); }
  if (event.key === "Escape" && event.target === $("gameSearch")) { clearTimeout(searchTimer); $("gameSearch").value = ""; state.query = ""; state.limit = 24; syncURL(); render(); }
});
on(window, "popstate",showView);
  const controller = { state, refresh: () => view === 'archive' ? archive.load(true) : load(), destroy() {
    if (state.disposed) return;
    state.disposed = true; events.abort(); clearTimeout(searchTimer); archive.destroy(); unsubscribeSaved();
    chartDisposers.forEach(dispose => dispose()); chartDisposers.clear();
    cards.clear(); historyCache.clear(); controllers.delete(anchor); activeControllers.delete(controller);
  } };
  controllers.set(anchor, controller);
  activeControllers.add(controller);
  showView();
  return controller;
}

