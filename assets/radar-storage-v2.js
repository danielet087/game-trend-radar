/* Sharded Steam data loader: month shards for lists, AppID files for details. */
(function (root) {
  "use strict";
  const LIVE_DATA_ROOT =
    "https://raw.githubusercontent.com/danielet087/game-trend-radar/main/data/";

  async function readJSON(path, validate = null) {
    const filename = path.startsWith("./data/") ? path.slice(7) : path.replace(/^data\//, "");
    const sources = filename ? [LIVE_DATA_ROOT + filename, "./data/" + filename] : [path];
    for (const source of sources) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        // Keep URLs stable so the browser can reuse cached month/AppID
        // responses between pages. Revalidate the tiny index for freshness.
        const freshIndex = filename === "index.json";
        const separator = source.includes("?") ? "&" : "?";
        const url = freshIndex ? `${source}${separator}t=${Date.now()}` : source;
        const response = await fetch(url, {
          cache: freshIndex ? "no-store" : "no-cache",
          signal: controller.signal,
        });
        if (!response.ok) continue;
        const data = await response.json();
        if (!validate || validate(data)) return data;
      } catch {
        /* Try raw GitHub first, then the Pages copy. */
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  async function loadCatalog() {
    const index = await readJSON("./data/index.json", (x) =>
      x && x.version >= 2 && Array.isArray(x.months),
    );
    if (index) {
      const shards = await Promise.all(
        index.months.map((month) =>
          readJSON(`./data/calendar/${month}.json`, (x) =>
            x && Array.isArray(x.games),
          ),
        ),
      );
      if (shards.length && shards.every(Boolean)) {
        const byId = new Map();
        for (const shard of shards.filter(Boolean)) {
          for (const game of shard.games) {
            const id = Number(game?.appid);
            if (Number.isInteger(id) && id > 0) byId.set(id, game);
          }
        }
        return {
          generated_at: index.generated_at,
          storage_version: 2,
          source: { catalog: "Steam AppID/month shards" },
          initialization: { complete: true, mode: "sharded_public_catalog" },
          count: byId.size,
          games: [...byId.values()],
        };
      }
    }
    return readJSON("./data/steam_upcoming.json", (x) =>
      x && Array.isArray(x.games),
    );
  }

  async function loadGame(appid) {
    const id = Number(appid);
    if (!Number.isInteger(id) || id <= 0) return null;
    return readJSON(`./data/games/${id}.json`, (x) =>
      x && Number(x.appid) === id,
    );
  }

  root.RadarStorage = { readJSON, loadCatalog, loadGame };
})(typeof window !== "undefined" ? window : globalThis);
