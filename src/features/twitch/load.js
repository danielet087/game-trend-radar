import { RadarTwitch as D } from "./data.js";
import { RadarStorage } from "../../data/storage.ts";
import { isRecord } from "../../data/contracts.ts";
import { registry, mapping, publicCatalog } from "./model.js";

function publishedContract(path, value) {
  if (!isRecord(value)) return false;
  if (path.endsWith("/twitch_live.json")) return Boolean(D.timestamp(value.generated_at)) &&
    (value.schema_version === 2 && Array.isArray(value.candidate_games) || value.schema_version == null && Array.isArray(value.top_games));
  if (path.endsWith("/twitch_tracking.json")) return Boolean(registry(value));
  if (path.endsWith("/twitch_steam_mapping.json")) return Boolean(mapping(value));
  if (path.endsWith("/catalog.json")) return Boolean(publicCatalog(value));
  const day = path.match(/\/twitch_history\/(\d{4}-\d{2}-\d{2})\.json$/)?.[1];
  return !day || value.schema_version === 1 && value.date === day && value.timezone === "Asia/Taipei" && isRecord(value.hours);
}
export async function readPublishedJSON(path, optional = false, sources = null) {
  const result = await RadarStorage.readJSONResult(path, value => publishedContract(path, value), { force:true, allowStale:false });
  if (sources) sources[path] = result;
  if (result.data) return result.data;
  if (optional && result.status === "unavailable" && result.error === "http_404") return null;
  throw new Error(result.error || "INVALID_JSON");
}
export function createTwitchLoader({ state, $, cards, historyCache, chartDisposers, metadata, render, notice, empty }) {
  const readJSON = (path, optional) => readPublishedJSON(path, optional, state.sources);
async function load() {
  if (state.loading || state.disposed) return;
  state.loading = true; $("snapshotRefresh").disabled = true; $("gameResults").setAttribute("aria-busy","true");
  $("resultsStatus").textContent = "正在讀取最新公開快照…";
  try {
    const [liveResult, trackingResult, mappingResult, catalogResult] = await Promise.allSettled([readJSON("./data/twitch_live.json"),readJSON("./data/twitch_tracking.json",true),readJSON("./data/twitch_steam_mapping.json",true),readJSON("./data/catalog.json",true)]);
    if (state.disposed) return;
    if (liveResult.status !== "fulfilled") throw liveResult.reason;
    const previousRegistry = state.data?.tracking_registry, previousMapping = state.data?.steam_mapping, previousCatalog = state.data?.public_catalog;
    let suppliedRegistry = trackingResult.status === "fulfilled" && trackingResult.value != null ? trackingResult.value : previousRegistry;
    let suppliedMapping = mappingResult.status === "fulfilled" && mappingResult.value != null ? mappingResult.value : previousMapping;
    let suppliedCatalog = catalogResult.status === "fulfilled" && catalogResult.value != null ? catalogResult.value : previousCatalog;
    let data = D.normalize(liveResult.value,suppliedRegistry,suppliedMapping,suppliedCatalog);
    const invalidTracking = data.tracking_registry_invalid, invalidMapping = data.steam_mapping_invalid, invalidCatalog = data.public_catalog_invalid;
    if (invalidTracking) suppliedRegistry = previousRegistry;
    if (invalidMapping) suppliedMapping = previousMapping;
    if (invalidCatalog) suppliedCatalog = previousCatalog;
    if (invalidTracking || invalidMapping || invalidCatalog) data = D.normalize(liveResult.value,suppliedRegistry,suppliedMapping,suppliedCatalog);
    data.tracking_warning = trackingResult.status !== "fulfilled" || (trackingResult.value == null && Boolean(previousRegistry)) || invalidTracking;
    data.mapping_warning = mappingResult.status !== "fulfilled" || (mappingResult.value == null && Boolean(previousMapping)) || invalidMapping || catalogResult.status !== "fulfilled" || (catalogResult.value == null && Boolean(previousCatalog)) || invalidCatalog;
    const same = data.generated_at === state.data?.generated_at && data.tracking_registry?.updated_at === state.data?.tracking_registry?.updated_at && data.steam_mapping?.updated_at === state.data?.steam_mapping?.updated_at && data.public_catalog_revision === state.data?.public_catalog_revision;
    chartDisposers.forEach(dispose => dispose()); chartDisposers.clear();
    state.data = data; cards.clear(); historyCache.clear();
    metadata(); render();
    if (same) $("resultsStatus").textContent += " · 已是最新公開快照";
  } catch {
    if (state.disposed) return;
    if (state.data) {
      notice("暫時無法更新，保留上次讀取的快照","可以稍後按右上方重新讀取；目前的量測時間保持不變。"); render();
    } else {
      $("snapshotTime").textContent = "暫時無法讀取";
      $("resultsStatus").textContent = "資料尚未就緒";
      $("gameResults").replaceChildren(empty("觀測資料暫時無法讀取","可能尚未發布，或檔案暫時無法取得。你可以稍後重新讀取。",load,"重新讀取資料 ↻"));
    }
  } finally { state.loading = false; if (!state.disposed) { $("snapshotRefresh").disabled = false; $("gameResults").setAttribute("aria-busy","false"); } }
}
return { load };
}
