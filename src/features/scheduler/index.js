import { JOBS } from "./primitives.js";
import { createSchedulerState } from "./state.js";
import { createSchedulerLoader } from "./load.js";
import { createSchedulerRenderer } from "./render.js";
export { RadarScheduler } from "./data.js";
const controllers = new WeakMap();
const activeControllers = new Set();
if (import.meta.hot) import.meta.hot.dispose(() => { for (const controller of activeControllers) controller.destroy(); });

export function initSchedulerPage() {
const $ = id => document.getElementById(id);
const anchor = $("scheduleTimeline");
if (!anchor) return;
if (controllers.has(anchor)) return controllers.get(anchor);
const events = new AbortController();
const on = (target, event, handler) => target.addEventListener(event, handler, { signal:events.signal });
const state = createSchedulerState();
const { snapshotLoad, readReceipt, readRuns } = createSchedulerLoader(state);
const { render, renderQueue } = createSchedulerRenderer(state, $);
async function refresh() {
  if (state.busy || state.disposed) return; state.busy = true; $("refreshButton").disabled = true; $("errorMessage").hidden = true;
  try { await snapshotLoad(); } catch { if (state.disposed) return; $("errorMessage").hidden = false; $("errorMessage").textContent = state.queue ? "佇列更新失敗，目前保留上次快照。" : "佇列暫時無法讀取；待查數量保留未知，稍後可再更新。"; }
  if (state.disposed) return;
  render();
  const results = await Promise.allSettled([readReceipt("growth.json"), readReceipt("content_refresh_status.json"), readReceipt("twitch_collection_status.json"), readReceipt("nintendo_refresh_status.json"), ...[...new Set(JOBS.map(j => j.repo))].map(readRuns)]);
  if (state.disposed) return;
  for (const [i, key] of ["growth", "content", "twitch", "igdb"].entries()) if (results[i].status === "fulfilled" && results[i].value) state[key] = results[i].value;
  render(); state.busy = false; $("refreshButton").disabled = false;
}
on($("refreshButton"), "click", refresh);
on($("queueSearch"), "input", renderQueue); on($("queueFilter"), "change", renderQueue);
on($("scheduleTimeline"), "click", e => { const button = e.target.closest("[data-slot-note]"); if (button) $("scheduleCaption").textContent = button.dataset.slotNote; });
const interval = setInterval(() => { if (!document.hidden) refresh(); }, 60000);
on(document, "visibilitychange", () => { if (!document.hidden) refresh(); });
const controller = { state, refresh, destroy() {
  if (state.disposed) return;
  state.disposed = true; events.abort(); clearInterval(interval); controllers.delete(anchor); activeControllers.delete(controller);
} };
controllers.set(anchor, controller);
activeControllers.add(controller);
refresh();
return controller;
}
