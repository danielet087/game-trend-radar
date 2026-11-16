import { HOUR, timestamp, count, filteredAudience } from "./metrics.js";
import { forRegion } from './audience-region.js';
function taipeiDay(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() + 8 * HOUR).toISOString().slice(0, 10) : null;
}
function historyDays(at) {
  const end = Math.floor(Date.parse(at) / HOUR) * HOUR;
  return Number.isFinite(end) ? [...new Set([taipeiDay(end - 23 * HOUR), taipeiDay(end)])] : [];
}
function* validHistoryHours(file, cutoff) {
  if (file?.schema_version !== 1 || file.timezone !== 'Asia/Taipei' || !file.hours) return;
  for (const [key, entry] of Object.entries(file.hours)) {
    const time = timestamp(key) ? Date.parse(key) : NaN;
    const observed = timestamp(entry?.generated_at) ? Date.parse(entry.generated_at) : NaN;
    const started = entry?.collection_schedule && timestamp(entry.collection_started_at);
    const bucketAt = started ? Date.parse(started) : observed;
    if (!Number.isFinite(time) || time % HOUR || !Number.isFinite(observed) || observed > cutoff ||
        Math.floor(bucketAt / HOUR) * HOUR !== time || taipeiDay(bucketAt) !== file.date || !Array.isArray(entry.games)) continue;
    yield { time, observed, entry };
  }
}

function latestHistorySnapshot(file, cutoff) {
  let latest;
  for (const hour of validHistoryHours(file, cutoff)) {
    if (!latest || hour.time > latest.time) latest = hour;
  }
  return latest?.entry ?? null;
}

function historyRows(files, gameID, at, region = 'global') {
  const cutoff = Date.parse(at), end = Math.floor(cutoff / HOUR) * HOUR;
  if (!Number.isFinite(end)) return [];
  const hours = new Map();
  for (const file of files) {
    for (const { time, observed, entry } of validHistoryHours(file, cutoff)) {
      const previous = hours.get(time);
      if (!previous || observed > Date.parse(previous.generated_at)) hours.set(time, entry);
    }
  }
  return Array.from({ length: 24 }, (_, i) => {
    const time = end - (23 - i) * HOUR, snapshot = hours.get(time);
    const row = snapshot?.games.find(g => String(g.game_id) === String(gameID) && !["retained", "stale"].includes(g.observation_status) && g.observation_freshness !== "stale");
    return forRegion({ hour: new Date(time).toISOString(), generated_at: snapshot?.generated_at || null,
      status: row ? "observed" : snapshot ? "absent" : "missing",
      viewer_count: count(row?.viewer_count), streamer_count: count(row?.streamer_count), median_viewer_count: count(row?.median_viewer_count),
      filtered_audience: filteredAudience(row?.filtered_audience),
      audience_regions: row?.audience_regions,
    }, region);
  });
}

export { taipeiDay, historyDays, historyRows, latestHistorySnapshot, validHistoryHours };

