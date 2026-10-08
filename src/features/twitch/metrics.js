const SOURCES = ["twitch_original_release_date", "igdb_first_release_date"];
const HOUR = 3600000;
const DEFAULT_FILTER = "signals";
const DEFAULT_SORT = "median";
const VIEWER_PRIORITY_THRESHOLD = 10000;
const STREAMER_PRIORITY_THRESHOLD = 40;
const AUDIENCE_RULE = "followers_gt_1000_viewers_gte_10_v1";
function timestamp(value) {
  return typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}
function count(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null; }
function filteredAudience(value) {
  if (value == null) return { status: "unavailable", median_viewer_count: null };
  const invalid = { status: "invalid", median_viewer_count: null };
  if (typeof value !== "object" || value.rule !== AUDIENCE_RULE || value.min_followers_exclusive !== 1000 || value.min_viewers_inclusive !== 10 || value.followers_max_age_hours !== 24 || !["complete", "partial"].includes(value.status)) return invalid;
  const counters = ["eligible_streamer_count", "eligible_viewer_count", "excluded_low_viewer_count", "excluded_low_follower_count", "unknown_follower_count"];
  if (!counters.every(key => Number.isSafeInteger(value[key]) && value[key] >= 0)) return invalid;
  const samples = value.eligible_streamer_count, viewers = value.eligible_viewer_count;
  if (viewers < samples * 10 || (!samples && viewers !== 0) || (value.status === "complete" && value.unknown_follower_count !== 0) || (value.status === "partial" && value.unknown_follower_count === 0)) return invalid;
  const median = count(value.median_viewer_count);
  if (value.status === "complete" && (samples ? median === null || median < 10 || median > viewers : value.median_viewer_count !== null)) return invalid;
  return { ...value, median_viewer_count: value.status === "complete" && samples > 0 ? median : null };
}
function safeURL(value, host) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && (!host || url.hostname === host) ? url.href : null;
  } catch { return null; }
}
function canonicalID(value) {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value <= 0)) return null;
  return (typeof value === "string" || typeof value === "number") && /^[1-9]\d{0,15}$/.test(String(value)) ? String(value) : null;
}

export { SOURCES, HOUR, DEFAULT_FILTER, DEFAULT_SORT, VIEWER_PRIORITY_THRESHOLD, STREAMER_PRIORITY_THRESHOLD, AUDIENCE_RULE, timestamp, count, filteredAudience, safeURL, canonicalID };
