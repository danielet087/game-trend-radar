/* Static Twitch snapshots. Missing measurements never become zero or NEW. */
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./radar-data-v1.js") : root.RadarData);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RadarTwitch = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (SteamData) {
  "use strict";
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
  function steamStoreURL(appid) {
    const id = canonicalID(appid);
    return id ? `https://store.steampowered.com/app/${id}/` : null;
  }
  function discovery(value) {
    return value?.schema_version === 1 && timestamp(value.updated_at) && canonicalID(value.steam_source_id) && value.games && typeof value.games === "object" && !Array.isArray(value.games) ? value : null;
  }
  function verifiedSteamIdentity(g, state) {
    const entry = state?.games[g.game_id], gameID = canonicalID(g.game_id);
    if (!entry || !gameID || canonicalID(entry.twitch_game_id) !== gameID || entry.status !== "matched" || entry.active !== true || entry.method !== "twitch_igdb_external_steam_v1" || !timestamp(entry.checked_at) || Date.parse(entry.checked_at) > Date.parse(state.updated_at)) return [];
    const igdbID = canonicalID(entry.igdb_id);
    if (!igdbID || g.igdb_id != null && canonicalID(g.igdb_id) !== igdbID || entry.updated_at != null && (!timestamp(entry.updated_at) || Date.parse(entry.updated_at) > Date.parse(state.updated_at))) return [];
    if (!Array.isArray(entry.steam_appids) || !entry.steam_appids.length || entry.steam_appids.some(id => !canonicalID(id)) || !Array.isArray(entry.links)) return [];
    const appids = new Set(entry.steam_appids.map(canonicalID));
    const links = entry.links.flatMap(link => {
      const appid = canonicalID(link?.steam_appid), url = steamStoreURL(appid);
      if (!appid || !canonicalID(link.external_game_id) || canonicalID(link.external_game_source) !== canonicalID(state.steam_source_id) || canonicalID(link.game) !== igdbID || canonicalID(link.uid) !== appid || !appids.has(appid) || link.url !== url) return [];
      return [{ steam_appid:appid, store_url:url, igdb_id:igdbID, checked_at:entry.checked_at, source:entry.method }];
    });
    return [...new Map(links.map(link => [link.steam_appid,link])).values()];
  }
  function steamStoreLinks(g) {
    // Store identity never makes a game a member of the published Steam catalog.
    const links = [...(g.steam_matches || []), ...(g.steam_store_links || [])].flatMap(link => {
      const url = steamStoreURL(link.steam_appid);
      return url ? [{ steam_appid:String(link.steam_appid), store_url:url }] : [];
    });
    return [...new Map(links.map(link => [link.steam_appid,link])).values()];
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
  function normalize(payload, supplementalRegistry = null, supplementalMapping = null, supplementalCatalog = null) {
    if (!payload || typeof payload !== "object" || !timestamp(payload.generated_at)) throw new Error("INVALID_SNAPSHOT");
    const legacy = payload.schema_version == null && Array.isArray(payload.top_games);
    if (!legacy && (payload.schema_version !== 2 || !Array.isArray(payload.candidate_games))) throw new Error("UNSUPPORTED_SNAPSHOT");
    const threshold = !legacy && Number.isInteger(payload.min_viewers) && payload.min_viewers > 0 ? payload.min_viewers : 7000;
    const report = legacy ? {} : payload.newness_experiment || {};
    const supplied = registry(supplementalRegistry), embedded = registry(payload.tracking_state);
    const trackingRegistry = [supplied, embedded].filter(Boolean).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0] || null;
    const suppliedMapping = mapping(supplementalMapping), embeddedMapping = mapping(payload.steam_mapping_state || payload.steam_mapping);
    const steamMapping = [suppliedMapping, embeddedMapping].filter(Boolean).sort((a,b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0] || null;
    const steamDiscovery = legacy ? null : discovery(payload.steam_discovery_state);
    const asOf = Math.max(Date.parse(payload.generated_at), Date.parse(trackingRegistry?.updated_at) || 0);
    const steamCatalog = legacy ? null : publicCatalog(supplementalCatalog);
    const catalogGames = new Map();
    if (steamCatalog) steamCatalog.games.forEach(raw => {
      const metadata = catalogSteam(raw,asOf);
      if (metadata) catalogGames.set(metadata.steam_appid,{ raw, metadata });
    });
    const trackedRows = !legacy && Array.isArray(payload.tracked_games) ? payload.tracked_games : [];
    const active = value => value?.status !== "excluded" && (value?.tracking_sources ? Object.keys(activeSources(value,asOf)).length > 0 : sourceActive(value,asOf));
    const mappedGames = new Map();
    if (steamMapping) Object.entries(steamMapping.games).forEach(([appid, entry]) => {
      const metadata = steam(entry?.steam,appid);
      if (entry?.status !== "matched" || !/^\d+$/.test(String(entry.twitch_game_id || "")) || !metadata) return;
      const id = String(entry.twitch_game_id);
      if (!mappedGames.has(id)) mappedGames.set(id,[]);
      mappedGames.get(id).push(metadata);
    });
    const seen = new Map(), excluded = legacy ? [] : (Array.isArray(payload.excluded_games) ? payload.excluded_games : []).map(g => game(g, false, report)).filter(Boolean);
    const nonGames = new Set(excluded.filter(g => g.reason === "non_game_category").map(g => g.game_id));
    let invalidRows = 0;
    const record = (value, fromTracked = false, retained = false) => {
      const g = game(value, legacy, report);
      if (!g) { invalidRows++; return; }
      const stored = trackingRegistry?.games[g.game_id];
      g.tracking = tracking(stored) || tracking(value.tracking);
      if (nonGames.has(g.game_id) || (g.tracking && !active(g.tracking))) return;
      g.is_tracked = active(g.tracking) || (fromTracked && !g.tracking);
      g.active_tracking_sources = activeSources(g.tracking,asOf);
      const steamRows = [...(Array.isArray(g.tracking?.steam_matches) ? g.tracking.steam_matches : []), ...(Array.isArray(value.steam_matches) ? value.steam_matches : []), ...(mappedGames.get(g.game_id) || [])];
      g.steam_matches = [...new Map(steamRows.map(value => steam(value)).filter(Boolean).map(value => [value.steam_appid,value])).values()];
      g.steam_store_links = verifiedSteamIdentity(g,steamDiscovery);
      const knownIDs = new Set([...g.steam_store_links, ...(mappedGames.get(g.game_id) || [])].map(s => s.steam_appid));
      const freshMetadata = [];
      knownIDs.forEach(appid => {
        const match = catalogGames.get(appid), proof = match?.raw.twitch_admission;
        if (!match || proof && (canonicalID(proof.twitch_game_id) !== canonicalID(g.game_id) || g.igdb_id != null && canonicalID(proof.igdb_id) !== canonicalID(g.igdb_id))) return;
        const forward = steamMapping?.games[appid], reverse = g.steam_store_links.find(s => s.steam_appid === appid);
        if (forward?.status === "ambiguous" || forward?.status === "matched" && canonicalID(forward.twitch_game_id) !== canonicalID(g.game_id)) return;
        const forwardIGDB = canonicalID(forward?.igdb_id), identityIGDB = reverse?.igdb_id || forwardIGDB || canonicalID(g.igdb_id);
        if (forward?.status === "matched" && forwardIGDB && (reverse && forwardIGDB !== reverse.igdb_id || g.igdb_id != null && forwardIGDB !== canonicalID(g.igdb_id))) return;
        if (proof && identityIGDB && canonicalID(proof.igdb_id) !== identityIGDB) return;
        if (["unmatched","pending"].includes(forward?.status) && reverse) {
          const decisionAt = timestamp(forward.checked_at) || timestamp(forward.updated_at) || steamMapping.updated_at;
          if (Date.parse(decisionAt) >= Date.parse(reverse.checked_at)) return;
        }
        // Registry build time is not the date of its source catalog.
        if (steamMapping?.source_catalog && timestamp(steamMapping.source_catalog.generated_at) && Date.parse(steamMapping.source_catalog.generated_at) > Date.parse(steamCatalog.generated_at) && g.steam_matches.some(s => s.steam_appid === appid)) return;
        const existing = g.steam_matches.find(s => s.steam_appid === appid);
        freshMetadata.push(existing ? { ...match.metadata, release_at:existing.release_at, release_date:existing.release_date, expires_at:existing.expires_at, is_recent:existing.is_recent } : match.metadata);
      });
      g.steam_matches = [...new Map([...g.steam_matches,...freshMetadata].map(s => [s.steam_appid,s])).values()];
      g.twitch_name = g.game_name;
      g.game_name = g.steam_matches[0]?.display_name || g.twitch_name;
      g.is_twitch_new = Boolean(g.active_tracking_sources.twitch_new) || !g.tracking?.tracking_sources && g.is_tracked;
      g.is_steam_recent = Object.keys(g.active_tracking_sources).some(key => key.startsWith("steam:"));
      g.observation_status = retained || value.observation_status === "retained" || value.observation_status === "stale" || value.observation_freshness === "stale" ? "retained" : "current";
      g.observation_at = timestamp(value.observation_at) || g.measurement_finished_at || (g.observation_status === "current" ? payload.generated_at : null);
      if ((!g.is_tracked && (g.viewer_count === null || g.viewer_count < threshold)) || (g.viewer_count === null && !fromTracked && !g.is_tracked)) {
        if (g.viewer_count === null) invalidRows++;
        return;
      }
      const previous = seen.get(g.game_id);
      if (previous) {
        if (!fromTracked && !retained) invalidRows++;
        if (previous.observation_status === "current" && retained) return;
        if (!fromTracked) return;
      }
      seen.set(g.game_id, g);
    };
    (legacy ? payload.top_games : payload.candidate_games).forEach(value => record(value));
    trackedRows.forEach(value => record(value, true));
    if (!legacy && trackingRegistry) Object.entries(trackingRegistry.games).forEach(([id, entry]) => {
      if (!/^\d+$/.test(id) || !active(tracking(entry)) || seen.has(id)) return;
      const observation = entry.last_observation && typeof entry.last_observation === "object" ? entry.last_observation : {};
      record({ ...entry, ...observation, game_id:id, tracking:entry, observation_at:timestamp(entry.observation_at) || timestamp(observation.observation_at) || timestamp(observation.measurement_finished_at), observation_status:"retained" }, true, true);
    });
    const games = [...seen.values()];
    const pendingSteam = steamMapping ? Object.entries(steamMapping.games).map(([appid, entry]) => ({ ...entry, steam:steam(entry?.steam,appid) })).filter(entry => ["pending","unmatched","ambiguous"].includes(entry.status) && entry.steam?.is_recent && entry.steam.release_at && Date.parse(entry.steam.release_at) <= asOf && entry.steam.expires_at && Date.parse(entry.steam.expires_at) > asOf) : [];
    const activeIDs = new Set(games.filter(g => g.is_tracked).map(g => g.game_id));
    const visibleExcluded = excluded.filter(g => !activeIDs.has(g.game_id));
    const source_windows = Object.fromEntries(SOURCES.map(source => {
      const windows = [...new Set([...games, ...excluded].map(g => g.release_experiment[source].window_days))];
      if (!windows.length) windows.push(windowDays(report[source]?.window_days));
      return [source, windows.sort((a, b) => a - b)];
    }));
    return { legacy, generated_at: payload.generated_at, threshold, games: legacy ? [] : games, legacy_sample_count: legacy ? games.length : 0, excluded:visibleExcluded, invalidRows,
      tracking_registry: trackingRegistry, tracking_registry_invalid: supplementalRegistry != null && !supplied,
      steam_mapping:steamMapping, steam_mapping_invalid:supplementalMapping != null && !suppliedMapping, pending_steam:pendingSteam,
      public_catalog:steamCatalog, public_catalog_invalid:supplementalCatalog != null && !steamCatalog, public_catalog_revision:steamCatalog ? JSON.stringify(steamCatalog) : null,
      source_windows,
      coverage: payload.coverage || {},
      reference_checks: !legacy && Array.isArray(payload.newness_experiment?.reference_checks) ? payload.newness_experiment.reference_checks : [],
    };
  }
  function matches(game, filter) {
    if (filter === "signals") return game.is_tracked || game.verification.status !== "not_new" && (game.verification.status === "new" || SOURCES.some(source => game.release_experiment[source].predicted_new === true));
    if (filter === "twitch_new") return game.is_twitch_new || !game.tracking && game.verification.status !== "not_new" && (game.verification.status === "new" || SOURCES.some(source => game.release_experiment[source].predicted_new === true));
    if (filter === "steam_recent") return game.is_steam_recent;
    if (filter === "official") return game.verification.status === "new";
    if (filter === "twitch") return game.release_experiment[SOURCES[0]].predicted_new === true;
    if (filter === "igdb") return game.release_experiment[SOURCES[1]].predicted_new === true;
    if (filter === "pending") return game.verification.status === "pending";
    return true;
  }
  function select(games, { query = "", filter = "all", sort = DEFAULT_SORT } = {}) {
    const search = query.normalize("NFKC").trim().toLocaleLowerCase();
    const metric = { viewers: "viewer_count", streamers: "streamer_count" }[sort] || "viewer_count";
    const measure = g => g.observation_status === "retained" ? null : sort === "median" ? g.filtered_audience?.median_viewer_count : g[metric];
    const viewerPriority = g => count(g.viewer_count) !== null && g.viewer_count >= VIEWER_PRIORITY_THRESHOLD;
    const streamerPriority = g => count(g.streamer_count) !== null && g.streamer_count >= STREAMER_PRIORITY_THRESHOLD;
    return games.filter(g => matches(g, filter) && `${g.game_name} ${g.twitch_name || ""} ${g.game_id} ${(g.steam_matches || []).map(s => `${s.name} ${s.name_en} ${s.steam_appid} ${s.tags.join(" ")}`).join(" ")} ${(g.steam_store_links || []).map(s => s.steam_appid).join(" ")}`.normalize("NFKC").toLocaleLowerCase().includes(search)).sort((a, b) => {
      // Saved observations stay behind current measurements in every sorting mode.
      const freshness = Number(a.observation_status === "retained") - Number(b.observation_status === "retained");
      if (freshness) return freshness;
      if (a.observation_status === "retained") return a.game_id.localeCompare(b.game_id);
      // In median mode, prioritize total viewers >= 10,000 before total streamers >= 40.
      // Both thresholds are inclusive and use whole-category totals, not filtered samples.
      const viewerGroup = sort === "median" ? Number(viewerPriority(b)) - Number(viewerPriority(a)) : 0;
      const streamerGroup = sort === "median" ? Number(streamerPriority(b)) - Number(streamerPriority(a)) : 0;
      return viewerGroup || streamerGroup || (measure(b) ?? -1) - (measure(a) ?? -1) || (b.viewer_count ?? -1) - (a.viewer_count ?? -1) || a.game_id.localeCompare(b.game_id);
    });
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
        const bucketAt = entry?.collection_schedule && timestamp(entry.collection_started_at) ? Date.parse(entry.collection_started_at) : observed;
        if (!Number.isFinite(time) || time % HOUR || !Number.isFinite(observed) || observed > cutoff || Math.floor(bucketAt / HOUR) * HOUR !== time || taipeiDay(bucketAt) !== file.date || !Array.isArray(entry.games)) continue;
        const previous = hours.get(time);
        if (!previous || observed > Date.parse(previous.generated_at)) hours.set(time, entry);
      }
    }
    return Array.from({ length: 24 }, (_, i) => {
      const time = end - (23 - i) * HOUR, snapshot = hours.get(time);
      const row = snapshot?.games.find(g => String(g.game_id) === String(gameID) && !["retained", "stale"].includes(g.observation_status) && g.observation_freshness !== "stale");
      return { hour: new Date(time).toISOString(), generated_at: snapshot?.generated_at || null,
        status: row ? "observed" : snapshot ? "absent" : "missing",
        viewer_count: count(row?.viewer_count), streamer_count: count(row?.streamer_count), median_viewer_count: count(row?.median_viewer_count),
        filtered_audience: filteredAudience(row?.filtered_audience),
      };
    });
  }
  return { SOURCES, DEFAULT_FILTER, DEFAULT_SORT, VIEWER_PRIORITY_THRESHOLD, STREAMER_PRIORITY_THRESHOLD, AUDIENCE_RULE, timestamp, count, filteredAudience, safeURL, steamStoreURL, steamStoreLinks, normalize, matches, select, taipeiDay, historyDays, historyRows };
});
