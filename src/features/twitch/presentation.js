import { RadarTwitch as D } from "./data.js";
const number = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat("zh-TW", { timeZone:"Asia/Taipei", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" });
const filterNames = { signals:"全部追蹤", twitch_new:"Twitch 熱門新作", steam_recent:"Steam 近期上市", all:"所有觀測", igdb:"IGDB 推算命中" };
const IGDB_SOURCE = "igdb_first_release_date";
function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}
function fmt(value) { return value === null || value === undefined ? "—" : number.format(value); }
function legacyRecovery(g) { return g.tracking?.enrollment?.source === "user_requested_legacy_recovery"; }
function pendingLegacyMeasurement(g) { return legacyRecovery(g) && g.observation_status === "retained" && g.viewer_count == null && g.streamer_count == null; }
function audienceNote(a) {
  if (a.status === "unavailable") return "待新條件收集";
  if (a.status === "invalid") return "資料待確認";
  if (a.status === "partial") return `待查 ${fmt(a.unknown_follower_count)} 台`;
  return a.eligible_streamer_count ? `${fmt(a.eligible_streamer_count)} 台符合條件` : "無符合條件頻道";
}
function time(value) { return D.timestamp(value) ? dateTime.format(new Date(value)) : "尚無紀錄"; }
export { node, fmt, time, filterNames, IGDB_SOURCE, audienceNote, legacyRecovery, pendingLegacyMeasurement };
export function sourceWindow(state, source) { return state.data.source_windows[source].map(fmt).join("／") + " 天"; }
