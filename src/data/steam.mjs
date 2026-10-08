// Steam public-record adapter; retains existing admission, localization and artwork policy.
import { validDate, todayInTaipei, awareTime } from '../domain/dates.mjs';
import { decimalID } from '../domain/identity.mjs';
import { normalizeKnownPlatforms, knownPlatformCompleteness } from '../domain/platforms.mjs';
import { steamMultiplayer } from '../domain/multiplayer.mjs';

export function imageURL(value, appid) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(
      value,
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/`,
    );
    return url.protocol === "https:" &&
      /(^|\.)(steamstatic\.com|steamcdn-a\.akamaihd\.net)$/.test(url.hostname)
      ? url.href
      : "";
  } catch {
    return "";
  }
}

export function exactReleaseDate(raw) {
  if (!raw || typeof raw !== "object") return false;
  if (hasTaiwanStoreDateAuthority(raw) && isTwitchQualified(raw)) return true;
  const date = raw.release_start || raw.release_date;
  if (!validDate(date) ||
    (raw.release_precision && raw.release_precision !== "day") ||
    (raw.release_end && raw.release_end !== date) ||
    raw.release_date_conflict === true ||
    (raw.release_timestamp_taipei_date && raw.release_timestamp_taipei_date !== date))
    return false;
  if (raw.release_time_utc != null) {
    const instant = awareTime(raw.release_time_utc);
    if (instant === null || todayInTaipei(new Date(instant)) !== date) return false;
  }
  return true;
}

export function hasTwitchAdmission(raw) {
  const proof = raw?.twitch_admission;
  const evidence = proof?.source_enrollment;
  const checked = awareTime(proof?.checked_at);
  const observed = awareTime(evidence?.observed_at);
  return !!proof && proof.schema_version === 1 &&
    proof.method === "twitch_igdb_external_steam_v1" &&
    decimalID(raw.appid) !== null && decimalID(proof.appid) === decimalID(raw.appid) &&
    decimalID(proof.twitch_game_id) !== null && decimalID(proof.igdb_id) !== null &&
    checked !== null && observed !== null && observed <= checked &&
    typeof proof.source_frontend_commit === "string" &&
    /^[0-9a-f]{40}$/.test(proof.source_frontend_commit) &&
    ["igdb_first_release_date", "twitch_original_release_date", "twitch_directory_dom"].includes(evidence.source) &&
    Number.isSafeInteger(evidence.viewer_count) && evidence.viewer_count >= 7000 &&
    evidence.min_viewers === 7000 && evidence.qualification !== "unverified";
}

export function hasTaiwanStoreDateAuthority(raw) {
  if (!hasTwitchAdmission(raw)) return false;
  const instant = awareTime(raw.release_time_utc);
  const day = raw.release_store_date;
  if (instant === null || !validDate(day)) return false;
  const timestampDay = todayInTaipei(new Date(instant));
  return raw.release_date_normalization === "steam_taiwan_store_date_authoritative" &&
    raw.release_display_provider === "Steam Store appdetails cc=TW l=tchinese" &&
    awareTime(raw.release_date_verified_at) !== null &&
    raw.release_start === day && raw.release_end === day &&
    raw.release_precision === "day" && raw.release_display_precision === "date_full" &&
    raw.release_date_timezone === "Asia/Taipei" &&
    raw.release_timestamp_taipei_date === timestampDay &&
    typeof raw.release_date_conflict === "boolean" &&
    raw.release_date_conflict === (day !== timestampDay);
}

export function isTwitchQualified(raw) {
  if (!hasTwitchAdmission(raw)) return false;
  const instant = awareTime(raw.release_time_utc);
  const consistentTimestampDay = raw.release_date_conflict !== true && instant !== null &&
    todayInTaipei(new Date(instant)) === raw.release_start &&
    (!Object.prototype.hasOwnProperty.call(raw, "release_timestamp_taipei_date") ||
      raw.release_timestamp_taipei_date === raw.release_start);
  return validDate(raw.release_start) &&
    raw.steam_type === "game" && raw.sexual_content_screened === true &&
    raw.release_precision === "day" && raw.release_display_precision === "date_full" &&
    raw.release_date_timezone === "Asia/Taipei" &&
    (consistentTimestampDay || hasTaiwanStoreDateAuthority(raw)) && raw.release_end === raw.release_start &&
    Number.isSafeInteger(raw.followers) && raw.followers >= 0 &&
    awareTime(raw.follower_checked_at) !== null;
}

export function normalize(raw, recent = false, translated = null) {
  if (!raw || typeof raw !== "object") return null;
  const date = raw.release_start || raw.release_date;
  const followers = raw.followers == null ? NaN : Number(raw.followers);
  const appid = Number(raw.appid);
  if (
    !exactReleaseDate(raw) ||
    !Number.isInteger(appid) ||
    appid <= 0 ||
    !Number.isFinite(followers)
  )
    return null;
  const twitchQualified = isTwitchQualified(raw);
  if (!twitchQualified && (
    recent
      ? !(
          followers >= 5000 ||
          (
            followers > 3000 &&
            ["tracked_release", "direct_release"].includes(raw.recent_source)
          )
        )
      : followers < 5000
  ))
    return null;
  const nameEn = String(
    raw.name_en || raw.name || translated?.name_en || translated?.name || "",
  ).trim();
  // Language support comes from Steam's game-level supported_languages,
  // not from which language the Store description was translated into.
  const languages = raw.language_support || translated?.language_support || null;
  // Display text is script-converted, but Steam's original tchinese/schinese
  // names stay untouched for provenance and searching in either script.
  const nameTw = String(
    raw.name_zh_tw_traditional ||
      translated?.name_zh_tw_traditional ||
      raw.name_zh_tw ||
      translated?.name_zh_tw ||
      "",
  ).trim();
  const nameCn = String(
    raw.name_zh_cn_traditional ||
      translated?.name_zh_cn_traditional ||
      "",
  ).trim();
  const nameEnDisplay = String(
    raw.name_en_traditional ||
      translated?.name_en_traditional ||
      nameEn,
  ).trim();
  // Storefront title localization and the game's supported languages are
  // independent. Prefer an available official Traditional Chinese title,
  // then a Simplified title converted into Traditional, then English.
  const name = String(
    raw.display_name ||
    translated?.display_name ||
    nameTw ||
    nameCn ||
    nameEnDisplay ||
    `Steam App ${appid}`,
  ).trim();
  // Independent badges: a game supporting both Chinese scripts gets BOTH.
  // Steam's supported_languages flags describe the game itself, not the
  // translated Store page or which language its marketing title uses.
  const languageBadges = [];
  if (languages?.tchinese === true)
    languageBadges.push({ label: "支援繁中", status: "traditional" });
  if (languages?.schinese === true)
    languageBadges.push({ label: "支援簡中", status: "simplified" });
  if (!languageBadges.length) {
    if (languages?.english === true)
      languageBadges.push({ label: "支援英文", status: "english" });
    else if (Array.isArray(languages?.other_languages) &&
      languages.other_languages.length)
      languageBadges.push({
        label: `支援${String(languages.other_languages[0]).trim()}`,
        status: "other",
      });
    else
      languageBadges.push({
        label: "語言支援待確認",
        status: "unknown",
      });
  }
  const languageBadge = languageBadges.map((badge) => badge.label).join("・");
  const languageStatus = languageBadges[0].status;
  // Steam's small capsule is only 231x87; stretching it over a large
  // homepage/card banner makes it visibly soft. Prefer store header assets.
  // Modern Steam assets can have a different hash for header vs capsule, so
  // NEVER replace the capsule filename inside its hashed URL.
  // A game's localized Steam header is often different from its language-neutral
  // main capsule. Prefer a *source-provided* Traditional Chinese asset when the
  // game's record explicitly supports Traditional Chinese; retain the main image
  // as the next fallback. Do not guess locale variants from image filenames.
  const traditionalHeader = languages?.tchinese === true
    ? [raw.header_image, translated?.header_image]
        .map((value) => imageURL(value, appid))
        .find((value) => /\/header_tchinese\.(?:jpe?g|png)(?:\?|$)/i.test(value))
    : "";
  const suppliedHeader = [
    traditionalHeader,
    raw.main_capsule_image,
    raw.header_image,
    translated?.main_capsule_image,
    translated?.header_image,
  ]
    .map((value) => imageURL(value, appid))
    .filter(Boolean);
  const fallbackHeaders = [
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appid}/capsule_616x353.jpg`,
  ];
  const smallCapsules = [
    raw.small_capsule_image,
    raw.capsule_image,
    translated?.small_capsule_image,
    translated?.capsule_image,
  ]
    .map((value) => imageURL(value, appid))
    .filter(Boolean);
  // Never delay the first painted image with a speculative _2x URL:
  // some modern hashed Steam artwork has no corresponding _2x asset.
  // Load the source-provided full-size image first; upgrade visible hero
  // cards in the background only if the optional _2x file really exists.
  const images = Array.from(new Set([
    ...suppliedHeader,
    ...fallbackHeaders,
    ...smallCapsules,
  ]));
  const artVariants = {};
  for (const record of [translated, raw]) {
    if (!record) continue;
    for (const field of ["header_image", "main_capsule_image"]) {
      const base = imageURL(record[field], appid);
      const high = imageURL(record[field + "_2x"], appid);
      if (base && high) artVariants[base] = high;
    }
  }
  return {
    appid,
    source: "steam",
    name,
    nameEn,
    nameTw,
    nameCn,
    // Keep source spellings searchable even when shown as Traditional.
    nameOriginalTw: raw.name_zh_tw || translated?.name_zh_tw || "",
    nameOriginalCn: raw.name_zh_cn || translated?.name_zh_cn || "",
    languages,
    languageBadges,
    languageBadge,
    languageStatus,
    date,
    identityKey: `steam:${appid}`,
    savedAliases: [appid],
    platforms: ["Steam"],
    knownPlatforms: normalizeKnownPlatforms(raw.known_platforms),
    platformDataComplete: knownPlatformCompleteness(raw),
    platformMultiplayer: { Steam: steamMultiplayer(Object.hasOwn(raw, "categories") ? raw : translated) },
    releasePlatforms: ["Steam"],
    platformShort: "Steam",
    platformLabel: "Steam",
    platformBadges: [{ label: "Steam", status: "steam", title: "Steam 商店收錄" }],
    releases: [{ platform: "Steam", date, precision: "day", source: "Steam" }],
    dateReleases: [{ platform: "Steam", date, precision: "day", source: "Steam" }],
    followers,
    twitchAdmission: twitchQualified ? raw.twitch_admission : null,
    art: images[0] || "",
    artSources: images,
    art2x: artVariants[images[0]] || "",
    artVariants,
    hasVerifiedHeader: suppliedHeader.length > 0,
    recent,
    darkHorse:
      recent &&
      raw.recent_source === "direct_release" &&
      !!raw.first_week_qualified_at,
    link: `https://store.steampowered.com/app/${appid}/`,
  };
}
