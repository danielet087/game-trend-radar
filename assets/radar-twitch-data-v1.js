/* Static Twitch snapshots. Missing measurements never become zero or NEW. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RadarTwitch = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const SOURCES = ["twitch_original_release_date", "igdb_first_release_date"];
  const HOUR = 3600000;
  const DEFAULT_FILTER = "signals";
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
  function normalize(payload) {
    if (!payload || typeof payload !== "object" || !timestamp(payload.generated_at)) throw new Error("INVALID_SNAPSHOT");
    const legacy = payload.schema_version == null && Array.isArray(payload.top_games);
    if (!legacy && (payload.schema_version !== 2 || !Array.isArray(payload.candidate_games))) throw new Error("UNSUPPORTED_SNAPSHOT");
    const threshold = !legacy && Number.isInteger(payload.min_viewers) && payload.min_viewers > 0 ? payload.min_viewers : 7000;
    const report = legacy ? {} : payload.newness_experiment || {};
    const seen = new Set();
    let invalidRows = 0;
    const games = (legacy ? payload.top_games : payload.candidate_games).flatMap(value => {
      const g = game(value, legacy, report);
      if (!g || g.viewer_count === null || seen.has(g.game_id)) { invalidRows++; return []; }
      seen.add(g.game_id);
      return g.viewer_count >= threshold ? [g] : [];
    });
    const excluded = legacy ? [] : (Array.isArray(payload.excluded_games) ? payload.excluded_games : []).map(g => game(g, false, report)).filter(Boolean);
    const source_windows = Object.fromEntries(SOURCES.map(source => {
      const windows = [...new Set([...games, ...excluded].map(g => g.release_experiment[source].window_days))];
      if (!windows.length) windows.push(windowDays(report[source]?.window_days));
      return [source, windows.sort((a, b) => a - b)];
    }));
    return { legacy, generated_at: payload.generated_at, threshold, games: legacy ? [] : games, legacy_sample_count: legacy ? games.length : 0, excluded, invalidRows,
      source_windows,
      coverage: payload.coverage || {},
      reference_checks: !legacy && Array.isArray(payload.newness_experiment?.reference_checks) ? payload.newness_experiment.reference_checks : [],
    };
  }
  function matches(game, filter) {
    if (filter === "signals") return game.verification.status !== "not_new" && (game.verification.status === "new" || SOURCES.some(source => game.release_experiment[source].predicted_new === true));
    if (filter === "official") return game.verification.status === "new";
    if (filter === "twitch") return game.release_experiment[SOURCES[0]].predicted_new === true;
    if (filter === "igdb") return game.release_experiment[SOURCES[1]].predicted_new === true;
    if (filter === "pending") return game.verification.status === "pending";
    return true;
  }
  function select(games, { query = "", filter = "all", sort = "viewers" } = {}) {
    const search = query.normalize("NFKC").trim().toLocaleLowerCase();
    const metric = { viewers: "viewer_count", streamers: "streamer_count" }[sort] || "viewer_count";
    const measure = g => sort === "median" ? g.filtered_audience?.median_viewer_count : g[metric];
    return games.filter(g => matches(g, filter) && `${g.game_name} ${g.game_id}`.normalize("NFKC").toLocaleLowerCase().includes(search)).sort((a, b) => (measure(b) ?? -1) - (measure(a) ?? -1) || (b.viewer_count ?? -1) - (a.viewer_count ?? -1) || a.game_id.localeCompare(b.game_id));
  }
  function taipeiDay(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Date(date.getTime() + 8 * HOUR).toISOString().slice(0, 10) : null;
  }
  function historyDays(at) {
    const end = Math.floor(Date.parse(at) / HOUR) * HOUR;
    return Number.isFinite(end) ? [...new Set([taipeiDay(end - 23 * HOUR), taipeiDay(end)])] : [];
  }
  function historyRows(files, gameID, at) {
    const cutoff = Date.parse(at), end = Math.floor(cutoff / HOUR) * HOUR;
    if (!Number.isFinite(end)) return [];
    const hours = new Map();
    for (const file of files) {
      if (file?.schema_version !== 1 || file.timezone !== "Asia/Taipei" || !file.hours) continue;
      for (const [key, entry] of Object.entries(file.hours)) {
        const time = timestamp(key) ? Date.parse(key) : NaN;
        const observed = timestamp(entry?.generated_at) ? Date.parse(entry.generated_at) : NaN;
        if (!Number.isFinite(time) || time % HOUR || !Number.isFinite(observed) || observed > cutoff || Math.floor(observed / HOUR) * HOUR !== time || taipeiDay(observed) !== file.date || !Array.isArray(entry.games)) continue;
        const previous = hours.get(time);
        if (!previous || observed > Date.parse(previous.generated_at)) hours.set(time, entry);
      }
    }
    return Array.from({ length: 24 }, (_, i) => {
      const time = end - (23 - i) * HOUR, snapshot = hours.get(time);
      const row = snapshot?.games.find(g => String(g.game_id) === String(gameID));
      return { hour: new Date(time).toISOString(), generated_at: snapshot?.generated_at || null,
        status: row ? "observed" : snapshot ? "absent" : "missing",
        viewer_count: count(row?.viewer_count), streamer_count: count(row?.streamer_count), median_viewer_count: count(row?.median_viewer_count),
        filtered_audience: filteredAudience(row?.filtered_audience),
      };
    });
  }
  return { SOURCES, DEFAULT_FILTER, AUDIENCE_RULE, timestamp, count, filteredAudience, safeURL, normalize, matches, select, taipeiDay, historyDays, historyRows };
});
