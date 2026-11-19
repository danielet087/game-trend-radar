// Known platforms, completeness evidence and platform badge presentation.
import { nativePlatformIDs, cardPlatformNames } from './constants.mjs';

export function normalizeKnownPlatforms(rows) {
  const records = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !Number.isSafeInteger(row.id) || row.id <= 0 || records.has(row.id)) continue;
    records.set(row.id, { id: row.id,
      name: typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 120) : cardPlatformNames[row.id]?.label || "",
      ...(Object.entries(nativePlatformIDs).some(([, id]) => id === row.id)
        ? { code: Object.keys(nativePlatformIDs).find(code => nativePlatformIDs[code] === row.id) } : {}) });
  }
  return [...records.values()].sort((a, b) => a.id - b.id);
}

export function knownPlatformCompleteness(raw) {
  if (raw?.platform_data_complete !== true && raw?.platform_data_complete !== false) return null;
  if (!Array.isArray(raw.known_platforms) || !raw.known_platforms.length ||
    normalizeKnownPlatforms(raw.known_platforms).length !== raw.known_platforms.length) return null;
  if (raw.platform_data_complete === true && Array.isArray(raw.platforms)) {
    const known = new Set(raw.known_platforms.map(row => row.id));
    if (raw.platforms.some(row => Object.values(nativePlatformIDs).includes(row?.id) && !known.has(row.id))) return null;
  }
  return raw.platform_data_complete;
}

// The whole game's platform evidence: a verified Steam product, IGDB's known
// platforms and the native versions this site tracks.
function platformEvidence(game) {
  const native = (game?.platforms || []).filter(platform => Object.hasOwn(nativePlatformIDs, platform));
  const known = normalizeKnownPlatforms(game?.knownPlatforms);
  const ids = new Set(known.map(row => row.id));
  const nativeListed = native.every(platform => ids.has(nativePlatformIDs[platform]));
  for (const platform of native) ids.add(nativePlatformIDs[platform]);
  let steam = game?.source === "steam" && Number.isSafeInteger(game.appid) && game.appid > 0;
  if (!steam && Number.isSafeInteger(game?.steamAppid) && game.steamAppid > 0) {
    try {
      const url = new URL(game.steamLink);
      steam = url.protocol === "https:" && url.hostname === "store.steampowered.com" &&
        !url.username && !url.password && !url.port && /^\/app\/[1-9][0-9]*\/?$/.test(url.pathname) &&
        Number(url.pathname.split("/")[2]) === game.steamAppid;
    } catch { /* Only a verified Steam product identity establishes PC. */ }
  }
  const pc = steam || [...ids].some(id => cardPlatformNames[id]?.type === "pc");
  const consoles = [...ids].filter(id => cardPlatformNames[id]?.type === "console");
  const other = [...ids].some(id => !cardPlatformNames[id] || cardPlatformNames[id].type === "mobile");
  const complete = game?.platformDataComplete === true && nativeListed &&
    (!steam || known.some(row => cardPlatformNames[row.id]?.type === "pc"));
  const names = [];
  if (steam) names.push("PC（Steam）");
  for (const id of [6, 14, 3, 48, 167, 49, 169, 130, 508, 39, 34])
    if (ids.has(id) && !(steam && id === 6)) names.push(cardPlatformNames[id].label);
  for (const platform of known)
    if (!cardPlatformNames[platform.id] && platform.name) names.push(`${platform.name}（類型待確認）`);
  const scope = names.length ? `已確認平台：${names.join("／")}。` : "尚無可確認的平台清單。";
  const uncertain = !complete || [...ids].some(id => !cardPlatformNames[id]);
  const single = !pc && consoles.length === 1 && !other && native.length === 1 &&
    (complete || game?.multiPlatform !== true);
  const exclusive = single && complete && (game.platformBadges || []).some(badge =>
    ["exclusive", "playstation-exclusive"].includes(badge.status) && badge.label === `${native[0]} 獨佔`);
  return { native, ids, steam, pc, consoles, other, complete, single, exclusive,
    scope: scope + (uncertain ? "平台清單或類型仍待確認。" : "") };
}

export function cardPlatformBadge(game) {
  const { native, steam, pc, consoles, other, complete, single, exclusive, scope } = platformEvidence(game);
  const title = scope + "此標籤表示同款遊戲的平台範圍；版本內容以各平台詳情為準。";
  if (pc && consoles.length) return { label: "PC＋主機", status: "multi", title };
  if (!pc && consoles.length >= 2 && complete && !other) return { label: "主機多平台", status: "multi", title };
  if (single) {
    return { label: exclusive ? `${native[0]} 獨佔` : "主機",
      status: exclusive ? native[0] === "PS5" ? "playstation-exclusive" : "exclusive" : "nintendo",
      title: exclusive ? title : title + "尚未確認獨佔。" };
  }
  if (steam && !consoles.length && !other) return { label: "Steam", status: "steam", title };
  return { label: "平台待確認", status: "unknown", title };
}

// Short platform names for chips, in display order, with their color family.
const chipCodes = { 6: "PC", 14: "PC", 3: "PC", 508: "NS2", 130: "NS", 167: "PS5", 48: "PS4", 169: "Xbox", 49: "Xbox", 39: "手機", 34: "手機" };
export const platformChipOrder = Object.freeze(["Steam", "PC", "NS2", "NS", "PS5", "PS4", "Xbox", "手機"]);
export const platformFullNames = Object.freeze({ Steam: "Steam", PC: "PC", NS2: "Nintendo Switch 2", NS: "Nintendo Switch",
  PS5: "PlayStation 5", PS4: "PlayStation 4", Xbox: "Xbox", 手機: "手機" });
export function platformFamily(code) {
  return code === "Steam" ? "steam" : code === "NS2" || code === "NS" ? "nintendo"
    : code === "PS5" || code === "PS4" ? "playstation" : code === "Xbox" ? "xbox" : "other";
}

/** Every platform the game is known on today, as named chips. A game first seen
    on one platform simply gains a chip when a new version is announced; "獨佔"
    appears only with official proof. In a release event, the platforms that
    release on that date are marked as released. */
export function cardPlatformChips(game, releasePlatforms = null) {
  const evidence = platformEvidence(game);
  const released = new Set((releasePlatforms || []).filter(code => platformChipOrder.includes(code)));
  const scope = evidence.scope + "這些是目前已知的平台，之後可能增加；版本內容以各平台詳情為準。";
  const title = (released.size ? `本次發售：${platformChipOrder.filter(code => released.has(code)).join("／")}。` : "") + scope;
  if (evidence.exclusive) {
    const code = evidence.native[0];
    return { title, scope, chips: [{ code, label: `${code} 獨佔`, family: platformFamily(code), exclusive: true, released: released.has(code) }] };
  }
  const codes = new Set(released);
  if (evidence.steam) codes.add("Steam");
  for (const id of evidence.ids) {
    const code = chipCodes[id];
    if (code && !(code === "PC" && evidence.steam)) codes.add(code);
  }
  const chips = platformChipOrder.filter(code => codes.has(code))
    .map(code => ({ code, label: code, family: platformFamily(code), exclusive: false, released: released.has(code) }));
  return { title, scope, chips: chips.length ? chips : [{ code: "unknown", label: "平台待確認", family: "other", exclusive: false, released: false }] };
}
