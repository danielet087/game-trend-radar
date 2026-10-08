import { RadarTwitch as D } from "./data.js";
import { filterNames } from "./presentation.js";
export function createTwitchState() {
  return { data:null, sources:{}, disposed:false, query:"", filter:D.DEFAULT_FILTER, sort:D.DEFAULT_SORT, limit:24, loading:false };
}
export function createTwitchURLState(state, $) {
function urlState() {
  const p = new URLSearchParams(location.search);
  state.query = (p.get("q") || "").slice(0,160);
  state.filter = Object.hasOwn(filterNames, p.get("state")) ? p.get("state") : D.DEFAULT_FILTER;
  state.sort = ["viewers","streamers","median"].includes(p.get("sort")) ? p.get("sort") : D.DEFAULT_SORT;
  state.limit = 24;
  $("gameSearch").value = state.query;
  $("gameSort").value = state.sort;
  document.querySelector(".tw-signal-filters").open = ![D.DEFAULT_FILTER,"twitch_new","steam_recent"].includes(state.filter);
  if (p.has("state") && !Object.hasOwn(filterNames,p.get("state"))) syncURL();
}
function syncURL() {
  const url = new URL(location.href);
  for (const [key,value,defaultValue] of [["q",state.query,""],["state",state.filter,D.DEFAULT_FILTER],["sort",state.sort,D.DEFAULT_SORT]]) {
    if (value === defaultValue) url.searchParams.delete(key); else url.searchParams.set(key,value);
  }
  history.replaceState(null,"",url);
}
return { urlState, syncURL };
}
