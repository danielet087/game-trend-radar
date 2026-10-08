// Merge only verified product identities while preserving independent platform releases.
import { validDate } from './dates.mjs';
import { nativePlatformOrder } from './constants.mjs';
import { normalizeKnownPlatforms } from './platforms.mjs';
import { unknownMultiplayer, mergeMultiplayerEvidence } from './multiplayer.mjs';
import { platformLanguageSupport } from './languages.mjs';
import { unique } from './collections.mjs';

export function uniqueReleases(releases) {
  const result = new Map();
  for (const release of releases) {
    if (!release || !validDate(release.date) || release.precision !== "day" ||
      !["Steam", ...nativePlatformOrder].includes(release.platform)) continue;
    const key = `${release.platform}:${release.date}:${release.region || ""}`;
    if (!result.has(key)) result.set(key, release);
  }
  return [...result.values()].sort((a, b) => a.date.localeCompare(b.date) ||
    ["Steam", ...nativePlatformOrder].indexOf(a.platform) - ["Steam", ...nativePlatformOrder].indexOf(b.platform));
}

export function mergePlatformGames(steamRows, nintendoRows, steamReference = steamRows) {
  const steamByID = new Map(steamReference.map(game => [game.appid, game]));
  const groups = new Map();
  const unmatched = [];
  for (const game of nintendoRows) {
    if (!game.steamAppid || !steamByID.has(game.steamAppid)) {
      unmatched.push(game);
      continue;
    }
    if (!groups.has(game.steamAppid)) groups.set(game.steamAppid, []);
    groups.get(game.steamAppid).push(game);
  }
  const result = steamRows.filter(game => !groups.has(game.appid));
  for (const [appid, rows] of groups) {
    const steam = steamByID.get(appid);
    const nintendo = rows[0];
    const igdbIds = [...new Set(rows.map(game => game.igdbId))];
    const platforms = ["Steam", ...nativePlatformOrder.filter(code => rows.some(game => game.platforms.includes(code)))];
    const releases = uniqueReleases([...steam.releases, ...rows.flatMap(game => game.releases)]);
    // An event belongs to this dataset only if that date was admitted here.
    // The complete release list may also retain an older Steam version.
    const dates = [...new Set([...steamRows.filter(game => game.appid === appid), ...rows]
      .map(game => game.date))].sort();
    const translated = !/[\u3400-\u9fff]/.test(steam.name) && /[\u3400-\u9fff]/.test(nintendo.name);
    const platformSources = [...rows, ...(steam.knownPlatforms?.length ? [steam] : [])];
    const completeness = platformSources.map(row => row.platformDataComplete);
    const signatures = platformSources.map(row => JSON.stringify((row.knownPlatforms || []).map(platform => platform.id).sort((a, b) => a - b)));
    const platformDataComplete = completeness.every(value => value === true) && signatures.every(value => value === signatures[0])
      ? true : completeness.every(value => value === false) ? false : null;
    const metadata = {
      ...steam,
      ...(translated ? { name: nintendo.name, nameTw: nintendo.nameTw, nameCn: nintendo.nameCn } : {}),
      nameOriginalTw: steam.nameOriginalTw || nintendo.nameOriginalTw,
      nameOriginalCn: steam.nameOriginalCn || nintendo.nameOriginalCn,
      nameSearchAliases: [...new Set([steam, ...rows].flatMap(game => [
        game.name, game.nameEn, game.nameTw, game.nameCn, game.nameOriginalTw, game.nameOriginalCn,
        ...(Array.isArray(game.nameSearchAliases) ? game.nameSearchAliases : []),
      ]).filter(Boolean))],
      igdbId: igdbIds[0], igdbIds, hasNintendo: true, hasNativePlatforms: true,
      hasPlayStation: platforms.includes("PS5"), sourceProvider: "Steam／IGDB", multiPlatform: true,
      identityKey: `steam:${appid}`, steamAppid: appid, steamLink: steam.link,
      savedAliases: [appid, ...igdbIds.map(id => `igdb:${id}`)],
      nintendoLink: nintendo.link, nintendoLinkLabel: nintendo.linkLabel,
      platformLinks: Object.fromEntries(nativePlatformOrder.flatMap(code => {
        const links = rows.map(row => row.platformLinks?.[code]).filter(Boolean);
        return links.length && links.every(link => link.url === links[0].url) ? [[code, links[0]]] : [];
      })),
      hypes: nintendo.hypes, platforms, releases,
      platformMultiplayer: Object.fromEntries(platforms.map(code => [code,
        code === "Steam" ? steam.platformMultiplayer?.Steam || unknownMultiplayer("Steam")
          : mergeMultiplayerEvidence(rows.filter(row => row.platforms.includes(code)), code)])),
      platformLanguages: Object.fromEntries(platforms.filter(code => code !== "Steam").map(code => {
        const sources = rows.map(row => row.platformLanguages?.[code]).filter(Boolean);
        return [code, sources.length && sources.every(source => JSON.stringify(source) === JSON.stringify(sources[0]))
          ? sources[0] : platformLanguageSupport(null, code)];
      })),
      platformEditions: Object.fromEntries(platforms.filter(code => code !== "Steam").flatMap(code => {
        const versions = rows.filter(row => row.platforms.includes(code));
        const editions = versions.map(row => row.platformEditions?.[code]);
        return editions.length && editions[0] && editions.every(edition =>
          edition && JSON.stringify(edition) === JSON.stringify(editions[0])) ? [[code, editions[0]]] : [];
      })),
      platformLabel: platforms.join("／") + "・多平台",
      platformBadges: [
        ...platforms.map(code => ({ label: code,
          status: code === "Steam" ? "steam" : code === "PS5" ? "playstation" : "nintendo",
          title: `已確認的原生版本平台：${platforms.join("／")}` })),
        { label: "多平台", status: "multi", title: `同一款遊戲的 ${platforms.join("／")} 原生版本；各平台保留自己的發售日` },
      ],
      exclusivity: { status: "multi_platform" },
      knownPlatforms: normalizeKnownPlatforms([...(steam.knownPlatforms || []), ...rows.flatMap(row => row.knownPlatforms || [])]),
      platformDataComplete,
    };
    for (const date of dates) {
      const dateReleases = releases.filter(release => release.date === date);
      const releasePlatforms = platforms.filter(code => dateReleases.some(release => release.platform === code));
      result.push({
        ...metadata, key: `steam:${appid}@${date}`, date, dateReleases, releasePlatforms,
        platformShort: releasePlatforms.join("／"),
        dateRegion: dateReleases[0]?.region || "",
        dateSource: dateReleases[0]?.source || "IGDB",
      });
    }
  }
  return unique([...result, ...unmatched]);
}
