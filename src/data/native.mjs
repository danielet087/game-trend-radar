// Native console public-record adapter for NS, NS2 and PS5.
import { decimalID, nintendoSteamIdentity } from '../domain/identity.mjs';
import { nativePlatformIDs, nativePlatformOrder } from '../domain/constants.mjs';
import { validDate } from '../domain/dates.mjs';
import { platformLanguageSupport, nintendoCardLanguages } from '../domain/languages.mjs';
import { platformEdition } from '../domain/editions.mjs';
import { nintendoURL, platformURL } from '../domain/storefronts.mjs';
import { normalizeKnownPlatforms, knownPlatformCompleteness } from '../domain/platforms.mjs';
import { nativeMultiplayer } from '../domain/multiplayer.mjs';
import { nintendoReleaseAudited } from '../domain/release-audit.mjs';
import { unique } from '../domain/collections.mjs';

export function nintendoGames(payload) {
  if (!payload || payload.schema_version !== 1 || !Array.isArray(payload.games)) return [];
  const games = [];
  for (const raw of payload.games) {
    const id = decimalID(raw?.igdb_id);
    if (!id || !Number.isSafeInteger(Number(id)) || raw.id !== `igdb:${id}` || raw.sexual_content_screened !== true ||
      !Number.isSafeInteger(raw.hypes) || raw.hypes < 30 || !Array.isArray(raw.platforms) ||
      !Array.isArray(raw.releases)) continue;
    const platforms = nativePlatformOrder.filter(code => raw.platforms.some(platform =>
      platform?.code === code && Number(platform.id) === nativePlatformIDs[code]));
    if (!platforms.length) continue;
    const platformLanguages = Object.fromEntries(platforms.map(code =>
      [code, platformLanguageSupport(raw.platform_language_support?.[code], code)]));
    const platformEditions = Object.fromEntries(platforms.flatMap(code => {
      const edition = platformEdition(raw.platform_editions?.[code], code);
      return edition ? [[code, edition]] : [];
    }));
    const nameEn = String(raw.name_en || raw.name || "").trim();
    const nameTw = String(raw.name_zh_tw_traditional || raw.name_zh_tw || "").trim();
    const nameCn = String(raw.name_zh_cn_traditional || "").trim();
    const name = String(raw.display_name || nameTw || nameCn || raw.name_en_traditional || nameEn || `IGDB ${id}`).trim();
    const steamAppid = nintendoSteamIdentity(raw);
    const grouped = new Map();
    const admittedReleases = raw.releases.filter(release => release?.precision === "day" &&
      validDate(release.date) && platforms.includes(release.platform) && nintendoReleaseAudited(release));
    const officialPriority = release => ["igdb_timestamp_taipei", "igdb_calendar_day"].includes(release.date_basis) ? 3
      : release.timezone_status === "taiwan_official_date" ? 2
      : release.timezone_status === "hong_kong_official_date" ? 1 : 0;
    for (const release of admittedReleases) {
      if (admittedReleases.some(other => other.platform === release.platform &&
        officialPriority(other) > officialPriority(release))) continue;
      if (!grouped.has(release.date)) grouped.set(release.date, []);
      const rows = grouped.get(release.date);
      if (!rows.some(row => row.platform === release.platform && row.region === release.region)) rows.push(release);
    }
    for (const [date, releases] of grouped) {
      const releasePlatforms = platforms.filter(code => releases.some(release => release.platform === code));
      const exclusive = raw.exclusivity || {};
      const knownPlatforms = normalizeKnownPlatforms(raw.known_platforms);
      const soleKnown = knownPlatforms.length === 1 &&
        Number(knownPlatforms[0]?.id) === nativePlatformIDs[platforms[0]];
      const otherPlatforms = knownPlatforms.some(platform => !platforms.some(code =>
        nativePlatformIDs[code] === Number(platform?.id)));
      const exclusiveURL = platformURL(exclusive.url, platforms[0]);
      const confirmed = !steamAppid && exclusive.status === "confirmed" && platforms.length === 1 &&
        soleKnown && raw.platform_data_complete === true && exclusive.platform === platforms[0] &&
        !!exclusiveURL && !new URL(exclusiveURL).hostname.endsWith("igdb.com");
      const listed = !steamAppid && !confirmed && exclusive.status === "listed_only" && platforms.length === 1 &&
        soleKnown && raw.platform_data_complete === true && exclusive.platform === platforms[0];
      const platformShort = confirmed ? `${platforms[0]}獨佔` : releasePlatforms.join("／");
      const multiPlatform = !!steamAppid || otherPlatforms || platforms.length > 1;
      const platformLabel = confirmed ? `${platforms[0]} 獨佔` : listed
        ? `${platforms[0]}（目前僅此平台）` : platforms.join("／") + (multiPlatform ? "・多平台" : "");
      const platformTitle = confirmed ? `官方確認 ${platforms[0]} 獨佔；原生版本平台`
        : listed ? `IGDB 目前僅列 ${platforms[0]}；尚未視為官方獨佔確認`
        : `原生版本平台：${platforms.join("／")}${steamAppid ? "；另有已對應的 Steam 版本" : otherPlatforms ? "；另有其他平台" : ""}；向下相容不視為另一平台版本`;
      const art = nintendoURL(raw.cover_image, "image");
      const platformLinks = Object.fromEntries(platforms.flatMap(code => {
        const url = platformURL(raw.platform_urls?.[code] ||
          (code === "PS5" ? raw.playstation_url : raw.nintendo_url), code);
        return url ? [[code, { url, label: code === "PS5"
          ? new URL(url).hostname === "store.playstation.com" ? "PlayStation 商店" : "PlayStation 官網"
          : "Nintendo 官網" }]] : [];
      }));
      const igdbLink = nintendoURL(raw.url);
      const eventLink = releasePlatforms.map(code => platformLinks[code]).find(Boolean);
      const link = eventLink?.url || igdbLink || "https://www.igdb.com/";
      games.push({
        appid: `igdb:${id}`, key: `igdb:${id}@${date}`, igdbId: Number(id), source: "nintendo",
        igdbIds: [Number(id)], identityKey: steamAppid ? `steam:${steamAppid}` : `igdb:${id}`,
        savedAliases: [`igdb:${id}`, ...(steamAppid ? [steamAppid] : [])],
        steamAppid, steamLink: steamAppid ? `https://store.steampowered.com/app/${steamAppid}/` : "",
        hasNintendo: true, hasNativePlatforms: true, hasPlayStation: platforms.includes("PS5"),
        sourceProvider: "IGDB", platformLinks,
        multiPlatform, knownPlatforms, platformDataComplete: knownPlatformCompleteness(raw),
        name, nameEn, nameTw, nameCn, nameOriginalTw: raw.name_zh_tw || "", nameOriginalCn: raw.name_zh_cn || "",
        nameSearchAliases: [...new Set(Object.values(platformEditions).flatMap(edition => [edition.title, edition.label]))],
        date, releases: [...grouped.values()].flat(), dateReleases: releases, dateRegion: releases[0]?.region || "",
        dateSource: releases[0]?.source || "IGDB", releasePlatforms, platforms,
        platformShort, platformLabel, platformBadges: [
          ...platforms.map(code => ({ label: confirmed ? `${code} 獨佔` : code,
            status: confirmed ? code === "PS5" ? "playstation-exclusive" : "exclusive"
              : code === "PS5" ? "playstation" : "nintendo", title: platformTitle })),
          ...(multiPlatform ? [{ label: "多平台", status: "multi", title: platformTitle }] : []),
        ],
        hypes: raw.hypes, followers: null, platformLanguages, platformEditions,
        platformMultiplayer: nativeMultiplayer(raw, platforms),
        ...nintendoCardLanguages(platformLanguages, releasePlatforms),
        art, artSources: art ? [art] : [], art2x: "", artVariants: {}, hasVerifiedHeader: !!art,
        recent: false, darkHorse: false, link,
        linkLabel: eventLink?.label || (igdbLink ? "IGDB 遊戲資料" : "IGDB 官網"),
        updated: raw.checked_at || payload.generated_at || null, exclusivity: exclusive,
        tags: Array.isArray(raw.tags) ? raw.tags.filter(tag => typeof tag === "string") : [],
        genres: Array.isArray(raw.genres) ? raw.genres.filter(genre => typeof genre === "string") : [],
        description: raw.short_description_language === "zh-TW" && typeof raw.short_description === "string" ? raw.short_description : "",
        descriptionSource: raw.short_description_source || "",
      });
    }
  }
  return unique(games);
}
