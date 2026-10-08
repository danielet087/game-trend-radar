import { SOURCES, DEFAULT_SORT, VIEWER_PRIORITY_THRESHOLD, STREAMER_PRIORITY_THRESHOLD, count } from "./metrics.js";
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

export { matches, select };
