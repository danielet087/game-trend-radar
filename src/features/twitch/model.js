import { RadarData as SteamData } from "../../domain/index.mjs";
import { SOURCES, HOUR, timestamp, count, filteredAudience, safeURL, canonicalID } from "./metrics.js";
function windowDays(value, fallback = 14) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
function prediction(value, reportWindow) {
  const p = value && typeof value === "object" ? value : {};
  return {
    ...p,
    window_days: windowDays(p.window_days, windowDays(reportWindow)),
    predicted_new: p.status === "evaluated" && typeof p.predicted_new === "boolean" && timestamp(p.release_at) && timestamp(p.evaluated_at) ? p.predicted_new : null,
    release_at: timestamp(p.release_at),
    evaluated_at: timestamp(p.evaluated_at),
    metadata_observed_at: timestamp(p.metadata_observed_at),
    source_url: safeURL(p.source_url),
  };
}
function verification(value) {
  const v = value && typeof value === "object" ? value : {};
  return { ...v, status: ["new", "not_new"].includes(v.status) && timestamp(v.observed_at) ? v.status : "pending", observed_at: timestamp(v.observed_at), expires_at: timestamp(v.expires_at), source_url: safeURL(v.source_url) };
}
function game(value, legacy, report = {}) {
  if (!value || !/^\d+$/.test(String(value.game_id || ""))) return null;
  const cover = typeof value.box_art_url === "string" ? value.box_art_url.replaceAll("{width}", "144").replaceAll("{height}", "192") : "";
  return {
    ...value, game_id: String(value.game_id), game_name: String(value.game_name || "未命名遊戲"),
    viewer_count: count(value.viewer_count), streamer_count: count(value.streamer_count),
    median_viewer_count: legacy ? null : count(value.median_viewer_count),
    filtered_audience: filteredAudience(legacy ? null : value.filtered_audience),
    box_art_url: safeURL(cover, "static-cdn.jtvnw.net"),
    verification: verification(legacy ? null : value.verification),
    release_experiment: Object.fromEntries(SOURCES.map(source => [source, prediction(legacy ? null : value.release_experiment?.[source], legacy ? null : report[source]?.window_days)])),
    measurement_started_at: timestamp(value.measurement_started_at),
    measurement_finished_at: timestamp(value.measurement_finished_at),
  };
}
function tracking(value) {
  if (!value || typeof value !== "object" || !["active", "expired", "excluded"].includes(value.status)) return null;
  const sources = value.tracking_sources && typeof value.tracking_sources === "object" && !Array.isArray(value.tracking_sources) ? Object.fromEntries(Object.entries(value.tracking_sources).filter(([key, source]) => (key === "twitch_new" || /^steam:\d+$/.test(key)) && source && typeof source === "object" && ["active", "expired", "excluded"].includes(source.status)).map(([key, source]) => [key, { ...source, first_seen_at:timestamp(source.first_seen_at), release_at:timestamp(source.release_at), expires_at:timestamp(source.expires_at) }])) : null;
  return { ...value, tracking_sources:sources, first_seen_at: timestamp(value.first_seen_at), release_at: timestamp(value.release_at), expires_at: timestamp(value.expires_at) };
}
function registry(value) {
  return value?.schema_version === 1 && timestamp(value.updated_at) && value.games && typeof value.games === "object" && !Array.isArray(value.games) ? value : null;
}
function mapping(value) {
  if (value?.schema_version !== 1 || !timestamp(value.updated_at) || !value.games || typeof value.games !== "object" || Array.isArray(value.games)) return null;
  const valid = Object.entries(value.games).every(([appid, entry]) => /^\d+$/.test(appid) && entry && typeof entry === "object" && ["matched","ambiguous","unmatched","pending"].includes(entry.status) && entry.steam && typeof entry.steam === "object" && !Array.isArray(entry.steam) && String(entry.steam.steam_appid || appid) === appid && (entry.status !== "matched" || /^\d+$/.test(String(entry.twitch_game_id || ""))));
  return valid ? value : null;
}
function publicCatalog(value) {
  if (![2,3].includes(value?.version) || !timestamp(value.generated_at) || !Array.isArray(value.games) || !Number.isSafeInteger(value.count) || value.count !== value.games.length || typeof SteamData?.normalize !== "function") return null;
  const ids = value.games.map(row => canonicalID(row?.appid));
  return ids.every(id => id && Number.isSafeInteger(Number(id))) && new Set(ids).size === ids.length ? value : null;
}
function catalogSteam(raw, asOf) {
  // Reuse the calendar's admission rules, including its verified TW date policy.
  if (raw.steam_type != null && raw.steam_type !== "game" || Object.hasOwn(raw,"sexual_content_screened") && raw.sexual_content_screened !== true || raw.twitch_admission != null && !SteamData.isTwitchQualified(raw)) return null;
  const accepted = SteamData.normalize(raw,true);
  if (!accepted) return null;
  const release = Date.parse(accepted.date + "T00:00:00+08:00"), expiry = release + 30 * 24 * HOUR;
  return steam({ ...raw, steam_appid:accepted.appid, display_name:accepted.name, name_en:accepted.nameEn, followers:accepted.followers, store_url:accepted.link, release_date:accepted.date, release_at:new Date(release).toISOString(), expires_at:new Date(expiry).toISOString(), is_recent:release <= asOf && asOf < expiry });
}
function steam(value, fallbackID) {
  if (!value || typeof value !== "object" || !/^\d+$/.test(String(value.steam_appid || fallbackID || ""))) return null;
  const id = String(value.steam_appid || fallbackID);
  const strings = values => Array.isArray(values) ? [...new Set(values.filter(v => typeof v === "string" && v.trim()).map(v => v.trim()))] : [];
  const labels = values => values && typeof values === "object" && !Array.isArray(values) ? Object.fromEntries(Object.entries(values).filter(([key,label]) => typeof key === "string" && typeof label === "string")) : {};
  return { steam_appid:id, display_name:String(value.display_name || value.name || value.name_en || `Steam ${id}`), name:String(value.name || value.display_name || ""), name_en:String(value.name_en || ""), followers:count(value.followers), store_url:safeURL(value.store_url,"store.steampowered.com"), release_at:timestamp(value.release_at), release_date:typeof value.release_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.release_date) ? value.release_date : null, expires_at:timestamp(value.expires_at), is_recent:value.is_recent === true, tags:strings(value.tags), genres:strings(value.genres), tag_labels_zh_tw:labels(value.tag_labels_zh_tw), genre_labels_zh_tw:labels(value.genre_labels_zh_tw),
    ...(value.follower_status === "unavailable_group_id" && SteamData.isTwitchQualified(value) ? {
      follower_status: value.follower_status, follower_unavailable_at: value.follower_unavailable_at,
      twitch_admission: value.twitch_admission,
    } : {}),
    ...(value.release_time_utc != null ? {release_time_utc:timestamp(value.release_time_utc)} : {}),
    ...(value.release_timestamp_taipei_date != null ? {release_timestamp_taipei_date:value.release_timestamp_taipei_date} : {}),
    ...(value.release_date_normalization != null ? {release_date_normalization:value.release_date_normalization} : {}),
  };
}
function sourceActive(value, asOf, isSteam = false) {
  return value?.status === "active" && (!value.expires_at || Date.parse(value.expires_at) > asOf) && (!isSteam || value.release_at && value.expires_at && Date.parse(value.release_at) <= asOf);
}
function activeSources(value, asOf) {
  return Object.fromEntries(Object.entries(value?.tracking_sources || {}).filter(([key, source]) => sourceActive(source,asOf,key.startsWith("steam:"))));
}

export { windowDays, prediction, verification, game, tracking, registry, mapping, publicCatalog, catalogSteam, steam, sourceActive, activeSources };
