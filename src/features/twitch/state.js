import { RadarTwitch as D } from "./data.js";
import { filterNames } from "./presentation.js";
import { DEFAULT_REGION, viewOf } from './audience-region.js';
export const OBSERVATION_PAGE_SIZE = 24;
export function createTwitchState() {
  return { data:null, sources:{}, disposed:false, query:"", filter:D.DEFAULT_FILTER, sort:D.DEFAULT_SORT, region:DEFAULT_REGION, limit:OBSERVATION_PAGE_SIZE, loading:false };
}
export function createTwitchURLState(state, $) {
function urlState() {
  const p = new URLSearchParams(location.search);
  const old = [state.region,state.query,state.filter,state.sort];
  const streamer = p.get('view') === 'streamer';
  state.region = viewOf(p.get('region') ?? (streamer ? p.get('stream_region') : null));
  if ($('audienceRegion')) $('audienceRegion').value = state.region;
  state.query = (p.get("q") || "").slice(0,160);
  state.filter = Object.hasOwn(filterNames, p.get("state")) ? p.get("state") : D.DEFAULT_FILTER;
  state.sort = ["viewers","streamers","median"].includes(p.get("sort")) ? p.get("sort") : D.DEFAULT_SORT;
  const current = [state.region,state.query,state.filter,state.sort];
  if (old.some((value, i) => value !== current[i])) state.limit = OBSERVATION_PAGE_SIZE;
  $("gameSearch").value = state.query;
  $("gameSort").value = state.sort;
  document.querySelector(".tw-signal-filters").open = ![D.DEFAULT_FILTER,"twitch_new","steam_recent"].includes(state.filter);
  if (p.has("state") && !Object.hasOwn(filterNames,p.get("state")) || streamer && (p.has('stream_region') || p.has('stream_order'))) syncURL();
}
function syncURL() {
  const url = new URL(location.href);
  if (url.searchParams.get('view') === 'streamer') {
    url.searchParams.delete('stream_region'); url.searchParams.delete('stream_order');
  }
  for (const [key,value,defaultValue] of [["q",state.query,""],["state",state.filter,D.DEFAULT_FILTER],["sort",state.sort,D.DEFAULT_SORT],['region',state.region,DEFAULT_REGION]]) {
    if (value === defaultValue) url.searchParams.delete(key); else url.searchParams.set(key,value);
  }
  history.replaceState(null,"",url);
}
return { urlState, syncURL };
}

