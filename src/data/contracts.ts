/** Published JSON contracts. Network data is checked at runtime before use. */
export type JsonRecord = Record<string, unknown>;
export interface CatalogGame extends JsonRecord { appid: number | string }
export interface Catalog extends JsonRecord {
  version?: number;
  revision?: string;
  catalog_revision?: string;
  generated_at?: string;
  count?: number | null;
  games: CatalogGame[];
}
export interface CatalogIndex extends JsonRecord {
  version: number;
  months: string[];
  game_count: number;
  generated_at?: string;
  catalog_revision?: string;
}
export interface NintendoCatalog extends JsonRecord {
  schema_version: 1;
  games: (JsonRecord & { id: string; igdb_id: number | string })[];
}
export type DataStatus = "fresh" | "cached" | "stale" | "unavailable" | "invalid";
export interface DataResult<T> {
  data: T | null;
  status: DataStatus;
  /** Actual published copy used, including for retained cache results. */
  source: string | null;
  /** Source publication time, never replaced with browser fetch time. */
  lastUpdated: string | null;
  fetchedAt: number | null;
  revision: string | null;
  error: string | null;
}
export interface LoadOptions {
  force?: boolean;
  allowStale?: boolean;
  /** Compare only declared revisions. Existing game records may omit one. */
  expectedRevision?: string | null;
}
export type Validator<T> = (value: unknown) => value is T;
export function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function publicationTime(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const key of ["generated_at", "updated_at", "published_at"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(candidate) && Number.isFinite(Date.parse(candidate))) return candidate;
  }
  return null;
}
export function declaredRevision(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const candidate = value.revision ?? value.catalog_revision;
  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}
export function validCatalog(value: unknown): value is Catalog {
  if (!isRecord(value) || !Array.isArray(value.games)) return false;
  if (value.version !== undefined && (!Number.isSafeInteger(value.version) || Number(value.version) < 1) ||
      value.generated_at !== undefined && typeof value.generated_at !== "string" ||
      value.revision !== undefined && (typeof value.revision !== "string" || !value.revision.trim()) ||
      value.catalog_revision !== undefined && (typeof value.catalog_revision !== "string" || !value.catalog_revision.trim())) return false;
  const ids = value.games.map(row => isRecord(row) && (typeof row.appid === "number" || typeof row.appid === "string" && /^[1-9]\d*$/.test(row.appid)) ? Number(row.appid) : NaN);
  return ids.every(id => Number.isSafeInteger(id) && id > 0) && new Set(ids).size === ids.length &&
    (value.count == null || typeof value.count === "number" && value.count === ids.length);
}
export function validIndex(value: unknown): value is CatalogIndex {
  return isRecord(value) && typeof value.version === "number" && value.version >= 2 &&
    (value.generated_at === undefined || typeof value.generated_at === "string") &&
    (value.catalog_revision === undefined || typeof value.catalog_revision === "string" && Boolean(value.catalog_revision.trim())) && Array.isArray(value.months) &&
    value.months.every(month => typeof month === "string" && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) &&
    new Set(value.months).size === value.months.length && Number.isSafeInteger(value.game_count) && Number(value.game_count) >= 0;
}
export function validNintendo(value: unknown): value is NintendoCatalog {
  return isRecord(value) && value.schema_version === 1 && Array.isArray(value.games) &&
    value.games.every(game => isRecord(game) && typeof game.id === "string" && /^igdb:[1-9][0-9]*$/.test(game.id) &&
      ["string", "number"].includes(typeof game.igdb_id) && String(game.igdb_id) === game.id.slice(5)) &&
    new Set(value.games.map(game => game.id)).size === value.games.length;
}
