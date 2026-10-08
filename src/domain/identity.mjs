// Exact provider identities and bookmark aliases; never merge by a title.

export const decimalID = (value) =>
  (typeof value === "string" || Number.isSafeInteger(value)) &&
  /^[1-9][0-9]*$/.test(String(value)) ? String(value) : null;

export const savedID = (value) => Number.isSafeInteger(value) && value > 0
  ? value : typeof value === "string" && /^igdb:[1-9][0-9]*$/.test(value) ? value : null;

export const saveID = (game) => savedID(game?.appid);

export const gameKey = (game) => game?.key || game?.appid;

export function isSaved(game, saved) {
  return !!saved && [saveID(game), ...(game?.savedAliases || [])]
    .some(id => savedID(id) !== null && saved.has(id));
}

export function nintendoSteamIdentity(raw) {
  const ids = new Set();
  for (const entry of Array.isArray(raw?.websites) ? raw.websites : []) {
    if (typeof entry?.url !== "string") continue;
    try {
      const url = new URL(entry.url);
      if (url.protocol !== "https:" || url.hostname !== "store.steampowered.com" ||
        url.username || url.password || url.port) continue;
      const match = /^\/app\/([1-9][0-9]*)(?:\/[^/]*)?\/?$/.exec(url.pathname);
      if (match && Number.isSafeInteger(Number(match[1]))) ids.add(Number(match[1]));
    } catch { /* An unrelated or invalid website is not Steam evidence. */ }
  }
  if (ids.size !== 1) return null;
  const appid = [...ids][0];
  if (raw.steam_appid != null &&
    (decimalID(raw.steam_appid) === null || Number(raw.steam_appid) !== appid)) return null;
  return appid;
}
