// Recent searches stay on this device only: at most five, newest first.
const KEY = 'game-trend-radar:search:recent:v1';
export const RECENT_LIMIT = 5;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): Store | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function readRecent(storage: Store | null = store()): string[] {
  try {
    const value: unknown = JSON.parse(storage?.getItem(KEY) || '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()).slice(0, RECENT_LIMIT) : [];
  } catch { return []; }
}

function write(list: string[], storage: Store | null): string[] {
  try { if (list.length) storage?.setItem(KEY, JSON.stringify(list)); else storage?.removeItem(KEY); } catch { /* Private mode: keep it in memory. */ }
  return list;
}

export function rememberSearch(term: string, storage: Store | null = store()): string[] {
  const value = String(term || '').trim();
  if (!value) return readRecent(storage);
  const list = [value, ...readRecent(storage).filter(item => item.toLocaleLowerCase() !== value.toLocaleLowerCase())];
  return write(list.slice(0, RECENT_LIMIT), storage);
}

export function forgetSearch(term: string, storage: Store | null = store()): string[] {
  return write(readRecent(storage).filter(item => item !== term), storage);
}

export function clearRecent(storage: Store | null = store()): string[] {
  return write([], storage);
}
