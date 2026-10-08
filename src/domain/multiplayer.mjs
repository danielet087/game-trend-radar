// Verified player-mode evidence, scoped to the actual platform or game.
import { awareTime } from './dates.mjs';
import { nativePlatformIDs } from './constants.mjs';

export const steamMultiplayerCategories = new Map([
  [1, "多人"], [9, "合作"], [20, "大型多人線上"], [24, "共用／分割螢幕"],
  [27, "跨平台多人"], [36, "線上 PvP"], [37, "共用／分割螢幕 PvP"],
  [38, "線上合作"], [39, "共用／分割螢幕合作"], [47, "區域網路 PvP"],
  [48, "區域網路合作"], [49, "PvP"],
]);

export const igdbMultiplayerNames = new Map([
  ["Multiplayer", "多人"], ["Co-operative", "合作"], ["Split screen", "分割螢幕"],
  ["Massively Multiplayer Online (MMO)", "大型多人線上"], ["Battle Royale", "大逃殺"],
]);

export const multiplayerFlags = ["campaigncoop", "dropin", "lancoop", "offlinecoop", "onlinecoop", "splitscreen", "splitscreenonline"];

export const multiplayerCounts = ["offlinecoopmax", "offlinemax", "onlinecoopmax", "onlinemax"];

export const unknownMultiplayer = source => ({ status: "unknown", source, scope: "platform", modes: [] });

export function steamMultiplayer(record) {
  const verified = ["Steam IStoreBrowseService/GetItems supported_player_categoryids", "Steam Store appdetails cc=TW categories"]
    .includes(record?.categories_source) && awareTime(record?.categories_checked_at) !== null;
  const rows = verified && Array.isArray(record?.categories)
    ? record.categories.filter(row => Number.isSafeInteger(row?.id)) : [];
  const modes = [...new Set(rows.map(row => steamMultiplayerCategories.get(row.id)).filter(Boolean))];
  return { status: modes.length ? "multiplayer" : rows.some(row => row.id === 2) ? "single" : "unknown",
    source: "Steam", scope: "platform", modes };
}

export function nativeMultiplayer(raw, platforms) {
  const rows = (Array.isArray(raw.game_modes) ? raw.game_modes : [])
    .filter(row => Number.isSafeInteger(row?.id) && row.id > 0);
  const modes = [...new Set(rows.map(row => igdbMultiplayerNames.get(row.name)).filter(Boolean))];
  const single = rows.some(row => row.name === "Single player");
  const general = { status: modes.length ? "multiplayer" : single ? "single" : "unknown",
    source: "IGDB", scope: "game", modes };
  return Object.fromEntries(platforms.map(platform => {
    const rows = (Array.isArray(raw.multiplayer_modes) ? raw.multiplayer_modes : [])
      .filter(row => Number.isSafeInteger(row?.platform?.id) && row.platform.id === nativePlatformIDs[platform]);
    if (!rows.length) return [platform, { ...general }];
    const evidence = [...new Set(rows.flatMap(row => [
      ...multiplayerFlags.filter(field => row[field] === true).map(field => field),
      ...multiplayerCounts.filter(field => Number.isSafeInteger(row[field]) && row[field] > 1).map(field => `${field}=${row[field]}`),
    ]))];
    const completeSingle = rows.every(row => multiplayerFlags.every(field => row[field] === false) &&
      multiplayerCounts.every(field => Number.isSafeInteger(row[field]) && row[field] >= 0 && row[field] <= 1));
    return [platform, { status: evidence.length ? "multiplayer" : completeSingle ? "single" : "unknown",
      source: "IGDB", scope: "platform", modes: evidence }];
  }));
}

export function mergeMultiplayerEvidence(sources, platform) {
  const rows = sources.map(game => game.platformMultiplayer?.[platform]).filter(Boolean);
  if (!rows.length || rows.some(row => row.status !== rows[0].status))
    return unknownMultiplayer(platform === "Steam" ? "Steam" : "IGDB");
  return { ...rows[0], scope: rows.every(row => row.scope === "platform") ? "platform" : "game",
    modes: [...new Set(rows.flatMap(row => row.modes || []))] };
}

export function cardMultiplayerBadge(game, event = false) {
  const scope = event ? game?.releasePlatforms || [] : game?.platforms || [];
  const supported = scope.flatMap(platform => {
    const mode = game?.platformMultiplayer?.[platform];
    return mode?.status === "multiplayer" ? [{ platform, ...mode }] : [];
  });
  if (!supported.length) return null;
  return { label: "多人", title: supported.map(mode =>
    `${mode.platform}：${mode.source}${mode.scope === "game" ? " 遊戲模式資料（未提供各平台細分）" : " 平台模式資料"}` +
    ((mode.modes.length && mode.scope === "game") || mode.source === "Steam" ? `・${mode.modes.join("／")}` : "")
  ).join("；") };
}
