import { SOURCES, timestamp, canonicalID } from "./metrics.js";
import { discovery, verifiedSteamIdentity, verifiedRelatedSteamIdentity, compatibleForwardIdentity } from "./identity.js";
import { windowDays, game, tracking, registry, mapping, publicCatalog, catalogSteam, steam, sourceActive, activeSources } from "./model.js";
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
  // Identity metadata may refresh while the original census and tracking clock stay unchanged.
  const identityAsOf = Date.now();
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
    const relatedIdentity = verifiedRelatedSteamIdentity(g,steamDiscovery,identityAsOf).filter(link => compatibleForwardIdentity(g,link,steamMapping));
    g.steam_store_links = [...new Map([...verifiedSteamIdentity(g,steamDiscovery,identityAsOf),...relatedIdentity].map(link => [link.steam_appid,link])).values()];
    g.steam_identity_metadata = g.steam_store_links.map(link => link.steam_identity_metadata).filter(Boolean);
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
    g.game_name = g.steam_matches[0]?.display_name || g.steam_identity_metadata[0]?.display_name || g.twitch_name;
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

export { normalize };
