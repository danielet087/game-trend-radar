/* One small, complete catalog for browsing; one AppID record for first paint. */
(function (root) {
  "use strict";
  const LIVE = "https://raw.githubusercontent.com/danielet087/game-trend-radar/main/data/";
  const inflight = new Map();
  const TTL = 60000;
  const CACHE = "game-trend-radar:data:v3:";
  function cached(filename) {
    try { return JSON.parse(sessionStorage.getItem(CACHE + filename) || "null"); }
    catch { return null; }
  }
  async function readJSON(path, validate = null, { force = false } = {}) {
    const filename = path.replace(/^\.\/data\//, "").replace(/^data\//, "");
    if (!/^[a-zA-Z0-9_/-]+\.json$/.test(filename) || filename.includes("..")) return null;
    const old = cached(filename);
    if (!force && old && Date.now() - old.at < TTL && (!validate || validate(old.data))) return old.data;
    if (inflight.has(filename)) return inflight.get(filename);
    const promise = (async () => {
      // Same-origin Pages has a warm connection. Keep stable URLs for HTTP
      // revalidation; raw GitHub is a fallback, not another mandatory request.
      for (const source of ["./data/" + filename, LIVE + filename]) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        try {
          const response = await fetch(source, { cache: "no-cache", signal: controller.signal });
          if (!response.ok) continue;
          const data = await response.json();
          if (validate && !validate(data)) continue;
          try { sessionStorage.setItem(CACHE + filename, JSON.stringify({ at: Date.now(), data })); } catch {}
          return data;
        } catch { /* Try the second published copy. */ }
        finally { clearTimeout(timer); }
      }
      return null;
    })();
    inflight.set(filename, promise);
    try { return await promise; } finally { inflight.delete(filename); }
  }
  function validCatalog(data) {
    if (!data || !Array.isArray(data.games)) return false;
    const ids = data.games.map(row => Number(row?.appid));
    return ids.every(id => Number.isSafeInteger(id) && id > 0) &&
      new Set(ids).size === ids.length &&
      (data.count == null || Number(data.count) === ids.length);
  }
  async function loadCatalog(options = {}) {
    const projection = await readJSON("./data/catalog.json", x => x?.version >= 3 && validCatalog(x), options);
    if (projection) return projection;
    const legacy = await readJSON("./data/steam_upcoming.json", validCatalog, options);
    if (legacy) return legacy;
    const index = await readJSON("./data/index.json", x => x?.version >= 2 && Array.isArray(x.months), options);
    if (!index) return null;
    const shards = await Promise.all(index.months.map(month =>
      /^\d{4}-\d{2}$/.test(month) ? readJSON(`./data/calendar/${month}.json`, validCatalog, options) : null));
    if (!shards.length || !shards.every(Boolean)) return null;
    const rows = shards.flatMap(shard => shard.games);
    const catalog = { version: 2, generated_at: index.generated_at, count: index.game_count, games: rows };
    return validCatalog(catalog) ? catalog : null;
  }
  async function loadSources(options = {}) {
    const catalog = await loadCatalog(options);
    // Version 2+ already includes retained released games and localized fields.
    // A legacy preview must not overwrite the accepted catalog's metadata.
    const preview = !catalog || !(catalog.version >= 2)
      ? await readJSON("./data/steam_preview.json", validCatalog, options) : null;
    return { catalog, preview };
  }
  async function loadGame(appid, options = {}) {
    const id = Number(appid);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    return readJSON(`./data/games/${id}.json`, x => x && Number(x.appid) === id, options);
  }
  root.RadarStorage = { readJSON, loadCatalog, loadSources, loadGame };
})(typeof window !== "undefined" ? window : globalThis);
