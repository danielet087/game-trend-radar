import {
  declaredRevision, isRecord, publicationTime, validCatalog, validIndex, validNintendo,
  type Catalog, type DataResult, type JsonRecord, type LoadOptions, type Validator,
} from "./contracts.ts";

const LIVE = "https://raw.githubusercontent.com/danielet087/game-trend-radar/main/data/";
const TTL = 60_000;
const CACHE = "game-trend-radar:data:v4:";
interface StoredJSON { at: number; data: unknown; source: string }
interface StorageEnvironment {
  fetch?: typeof fetch;
  sessionStorage?: Pick<Storage, "getItem" | "setItem">;
  now?: () => number;
  timeoutMs?: number;
}

/** Injectable transport keeps validation, cache lifetime and fallback testable. */
export function createRadarStorage(environment: StorageEnvironment = {}) {
  const request = environment.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const now = environment.now ?? Date.now;
  const inflight = new Map<string, Promise<unknown>>();
  const session = () => { try { return environment.sessionStorage ?? globalThis.sessionStorage; } catch { return undefined; } };
  let acceptedRevision: string | null = null;

  function cached(filename: string): StoredJSON | null {
    try {
      const value: unknown = JSON.parse(session()?.getItem(CACHE + filename) || "null");
      return isRecord(value) && typeof value.at === "number" && Number.isFinite(value.at) && typeof value.source === "string"
        ? value as unknown as StoredJSON : null;
    } catch { return null; }
  }
  function result<T>(data: T | null, status: DataResult<T>["status"], source: string | null, fetchedAt: number | null, error: string | null = null): DataResult<T> {
    return { data, status, source, fetchedAt, lastUpdated: publicationTime(data), revision: declaredRevision(data), error };
  }
  function revisionMatches(data: unknown, expected: string | null | undefined) {
    const revision = declaredRevision(data);
    // The publisher has not yet added revision fields to all AppID files.
    return !expected || !revision || revision === expected;
  }
  async function transport(source: string): Promise<unknown> {
    const existing = inflight.get(source);
    if (existing) return existing;
    const promise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), environment.timeoutMs ?? 6_000);
      try {
        const response = await request(source, { cache: "no-cache", signal: controller.signal });
        if (!response.ok) throw new Error("http_" + response.status);
        return await response.json();
      } finally { clearTimeout(timer); }
    })();
    inflight.set(source, promise);
    try { return await promise; } finally { if (inflight.get(source) === promise) inflight.delete(source); }
  }
  async function readJSONResult<T = unknown>(path: string, validate: Validator<T> | ((value: unknown) => boolean) | null = null, options: LoadOptions = {}): Promise<DataResult<T>> {
    const filename = path.replace(/^\.\/data\//, "").replace(/^data\//, "");
    if (!/^[a-zA-Z0-9_/-]+\.json$/.test(filename) || filename.includes("..")) return result<T>(null, "invalid", null, null, "invalid_path");
    const accepts = (data: unknown): data is T => {
      try { return (!validate || validate(data)) && revisionMatches(data, options.expectedRevision); }
      catch { return false; }
    };
    const old = cached(filename);
    if (!options.force && old && now() >= old.at && now() - old.at < TTL && accepts(old.data)) return result(old.data, "cached", old.source, old.at);
    let error = "unavailable", invalid = false;
    for (const source of ["./data/" + filename, LIVE + filename]) {
      try {
        const data = await transport(source);
        if (!accepts(data)) { invalid = true; error = revisionMatches(data, options.expectedRevision) ? "invalid_json_contract" : "revision_mismatch"; continue; }
        const fetchedAt = now();
        try { session()?.setItem(CACHE + filename, JSON.stringify({ at: fetchedAt, data, source })); } catch { /* Browsing still works when storage is full. */ }
        return result(data, "fresh", source, fetchedAt);
      } catch (cause) { if (!invalid) error = cause instanceof Error ? cause.message : "unavailable"; }
    }
    if (options.allowStale !== false && old && accepts(old.data)) return result(old.data, "stale", old.source, old.at, error);
    return result<T>(null, invalid ? "invalid" : "unavailable", null, null, error);
  }
  async function readJSON<T = unknown>(path: string, validate: Validator<T> | ((value: unknown) => boolean) | null = null, options: LoadOptions = {}) {
    return (await readJSONResult<T>(path, validate, options)).data;
  }
  async function loadCatalogResult(options: LoadOptions = {}): Promise<DataResult<Catalog>> {
    const projection = await readJSONResult<Catalog>("./data/catalog.json", value => isRecord(value) && Number(value.version) >= 3 && validCatalog(value), options);
    if (projection.data) { acceptedRevision = projection.revision; return projection; }
    const legacy = await readJSONResult<Catalog>("./data/steam_upcoming.json", validCatalog, options);
    if (legacy.data) { acceptedRevision = legacy.revision; return legacy; }
    const index = await readJSONResult("./data/index.json", validIndex, options);
    if (!index.data) return result<Catalog>(null, index.status, index.source, index.fetchedAt, index.error);
    const revision = declaredRevision(index.data);
    const shards = await Promise.all(index.data.months.map(month => readJSONResult<Catalog>(`./data/calendar/${month}.json`, validCatalog, { ...options, expectedRevision: revision })));
    if (!shards.length || shards.some(shard => !shard.data)) return result<Catalog>(null, "invalid", index.source, index.fetchedAt, "incomplete_catalog_shards");
    const catalog: Catalog = { version: 2, generated_at: index.data.generated_at, count: index.data.game_count, games: shards.flatMap(shard => shard.data!.games), ...(revision ? { revision } : {}) };
    if (!validCatalog(catalog)) return result<Catalog>(null, "invalid", index.source, index.fetchedAt, "invalid_catalog_shards");
    acceptedRevision = revision;
    return result(catalog, shards.some(shard => shard.status === "stale") || index.status === "stale" ? "stale" : "fresh", index.source, index.fetchedAt);
  }
  async function loadCatalog(options: LoadOptions = {}) { return (await loadCatalogResult(options)).data; }
  async function loadSources(options: LoadOptions = {}) {
    const catalogResult = await loadCatalogResult(options);
    const catalog = catalogResult.data;
    const previewResult = !catalog || !(Number(catalog.version) >= 2) ? await readJSONResult("./data/steam_preview.json", validCatalog, options) : null;
    return { catalog, preview: previewResult?.data ?? null, catalogResult, previewResult };
  }
  async function loadNintendoResult(options: LoadOptions = {}) { return readJSONResult("./data/nintendo_upcoming.json", validNintendo, options); }
  async function loadNintendo(options: LoadOptions = {}) { return (await loadNintendoResult(options)).data; }
  async function loadGameResult(appid: number | string, options: LoadOptions = {}): Promise<DataResult<JsonRecord>> {
    const id = Number(appid);
    if (!Number.isSafeInteger(id) || id <= 0) return result<JsonRecord>(null, "invalid", null, null, "invalid_appid");
    return readJSONResult<JsonRecord>(`./data/games/${id}.json`, value => isRecord(value) && Number(value.appid) === id,
      { ...options, expectedRevision: options.expectedRevision === undefined ? acceptedRevision : options.expectedRevision });
  }
  async function loadGame(appid: number | string, options: LoadOptions = {}) { return (await loadGameResult(appid, options)).data; }
  return { readJSON, readJSONResult, loadCatalog, loadCatalogResult, loadSources, loadNintendo, loadNintendoResult, loadGame, loadGameResult };
}
export const RadarStorage = createRadarStorage();
export const { readJSON, readJSONResult, loadCatalog, loadCatalogResult, loadSources, loadNintendo, loadNintendoResult, loadGame, loadGameResult } = RadarStorage;
