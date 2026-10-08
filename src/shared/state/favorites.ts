/** Browser-local collections shared by Vue islands and the feature controllers. */
export type SavedId = number | `igdb:${number}`;

export interface SavedTarget {
  appid?: unknown;
  savedAliases?: readonly unknown[];
}

export interface SavedSnapshot {
  ids: Set<SavedId>;
  count: number;
  durable: boolean;
}

export interface SavedToggleResult extends SavedSnapshot {
  saved: boolean;
}

type SavedListener = (snapshot: SavedSnapshot) => void;

export const SAVED_STORAGE_KEY = 'game-trend-radar:saved:v1';
export const SAVED_CHANGE_EVENT = 'radar:savedchange';

let initialized = false;
let ids = new Set<SavedId>();
let durable = true;
const listeners = new Set<SavedListener>();
// Alias relationships are metadata, not a rewrite of the user's stored IDs.
const parents = new Map<SavedId, SavedId>();

export function normalizeSavedId(value: unknown): SavedId | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^igdb:[1-9][0-9]*$/.test(value)) return value as SavedId;
  return null;
}

function parseSaved(value: string | null): Set<SavedId> | null {
  try {
    const parsed: unknown = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.map(normalizeSavedId).filter((id): id is SavedId => id !== null));
  } catch {
    return null;
  }
}

function representative(id: SavedId): SavedId {
  const parent = parents.get(id);
  if (parent === undefined || parent === id) return id;
  const root = representative(parent);
  parents.set(id, root);
  return root;
}

function targetIds(target: SavedTarget | string | number): SavedId[] {
  if (typeof target !== 'object' || target === null) {
    const id = normalizeSavedId(target);
    return id === null ? [] : [id];
  }
  return [...new Set([target.appid, ...(target.savedAliases || [])]
    .map(normalizeSavedId).filter((id): id is SavedId => id !== null))];
}

function countSaved(): number {
  return new Set([...ids].map(representative)).size;
}

function snapshot(): SavedSnapshot {
  return { ids: new Set(ids), count: countSaved(), durable };
}

function notify(): void {
  for (const listener of listeners) listener(snapshot());
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent(SAVED_CHANGE_EVENT, {
      detail: { ...snapshot(), source: 'shared-favorites' },
    }));
  }
}

function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;
  if (typeof window === 'undefined') return;
  try {
    ids = parseSaved(window.localStorage.getItem(SAVED_STORAGE_KEY)) || new Set();
  } catch {
    durable = false;
  }
  window.addEventListener('storage', event => {
    if (event.key !== SAVED_STORAGE_KEY && event.key !== null) return;
    const next = parseSaved(event.newValue);
    // Malformed writes in another tab do not erase a valid collection.
    if (next === null) return;
    ids = next;
    durable = true;
    notify();
  });
  // During migration a DOM controller may announce its localStorage write.
  document.addEventListener(SAVED_CHANGE_EVENT, event => {
    const detail = (event as CustomEvent<{ source?: string }>).detail;
    if (detail?.source !== 'shared-favorites') refreshSaved();
  });
  (window as unknown as { RadarSaved: typeof savedApi }).RadarSaved = savedApi;
}

/** Returns a copy: callers cannot mutate the store without announcing a change. */
export function readSaved(): Set<SavedId> {
  ensureInitialized();
  return new Set(ids);
}

export function savedCount(): number {
  ensureInitialized();
  return countSaved();
}

export function isSaved(target: SavedTarget | string | number): boolean {
  ensureInitialized();
  const targetGroups = new Set(targetIds(target).map(representative));
  return [...ids].some(id => targetGroups.has(representative(id)));
}

/** Register merged Steam/IGDB identities so aliases count as one saved game. */
export function registerSavedGames(games: readonly SavedTarget[]): void {
  ensureInitialized();
  const previousCount = countSaved();
  for (const game of games) {
    const aliases = targetIds(game);
    const primary = aliases[0];
    if (primary === undefined) continue;
    for (const alias of aliases.slice(1)) {
      const root = representative(alias);
      const primaryRoot = representative(primary);
      if (root !== primaryRoot) parents.set(root, primaryRoot);
    }
  }
  if (countSaved() !== previousCount) notify();
}

export function toggleSaved(target: SavedTarget | string | number): SavedToggleResult {
  ensureInitialized();
  const aliases = targetIds(target);
  const primary = aliases[0];
  if (primary === undefined) return { ...snapshot(), saved: false };
  const wasSaved = isSaved(target);
  if (wasSaved) {
    const groups = new Set(aliases.map(representative));
    for (const id of ids) if (groups.has(representative(id))) ids.delete(id);
  } else {
    ids.add(primary);
  }
  try {
    window.localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify([...ids]));
    durable = true;
  } catch {
    // Keep the same in-memory collection for every component in this session.
    durable = false;
  }
  notify();
  return { ...snapshot(), saved: !wasSaved };
}

export function subscribeSaved(
  listener: SavedListener,
  options: { immediate?: boolean } = {},
): () => void {
  ensureInitialized();
  listeners.add(listener);
  if (options.immediate !== false) listener(snapshot());
  return () => { listeners.delete(listener); };
}

/** Explicit bridge for a legacy controller which still writes localStorage. */
export function refreshSaved(): void {
  ensureInitialized();
  try {
    const next = parseSaved(window.localStorage.getItem(SAVED_STORAGE_KEY));
    if (next === null) return;
    ids = next;
    durable = true;
    notify();
  } catch {
    durable = false;
  }
}

export const savedApi = {
  readSaved, toggleSaved, subscribeSaved, registerSavedGames, savedCount,
  isSaved, refreshSaved, normalizeSavedId,
  read: readSaved, toggle: toggleSaved, subscribe: subscribeSaved,
};
