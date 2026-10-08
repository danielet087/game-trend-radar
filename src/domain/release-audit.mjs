// Reproducible release-date audits retain dates, timestamps and source claims separately.
import { nativePlatformOrder } from './constants.mjs';
import { validDate, todayInTaipei, awareTime } from './dates.mjs';
import { platformURL, playstationProduct, nintendoHongKongDateURL } from './storefronts.mjs';

export function nintendoReleaseAudited(release) {
  // The unified IGDB policy converts only the calendar date. A source
  // timestamp is retained for reproducibility, never as an unlock-time claim.
  if (["igdb_timestamp_taipei", "igdb_calendar_day"].includes(release.date_basis)) {
    if (!nativePlatformOrder.includes(release.platform) || release.precision !== "day" ||
      release.source !== "IGDB" || release.time_zone !== "Asia/Taipei" ||
      !validDate(release.date) || !validDate(release.source_date) ||
      typeof release.region !== "string" || !release.region || release.source_region !== release.region ||
      release.taiwan_release_confirmed !== false ||
      ["official_source_url", "official_source_name", "official_verified_at", "official_product_id",
        "official_concept_id", "official_release_time_utc"].some(field => release[field] != null)) return false;
    if (release.date_basis === "igdb_calendar_day") return release.timezone_status === "date_only" &&
      release.source_timestamp == null && release.timestamp_taipei_date == null && release.date === release.source_date;
    if (release.timezone_status !== "converted_to_taipei" ||
      !Number.isSafeInteger(release.source_timestamp) || release.source_timestamp < 0) return false;
    const instant = new Date(release.source_timestamp * 1000);
    return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === release.source_date &&
      todayInTaipei(instant) === release.timestamp_taipei_date && release.date === release.timestamp_taipei_date;
  }
  // Retain legacy audits for previously published and archived bundles.
  if (release.timezone_status == null) return release.platform !== "PS5" &&
    release.source !== "official_registry" && release.taiwan_release_confirmed !== true;
  if (release.time_zone !== "Asia/Taipei" ||
    !["same_calendar_day", "date_only", "taiwan_official_date", "hong_kong_official_date"].includes(release.timezone_status)) return false;
  if (release.source_date != null && !validDate(release.source_date)) return false;
  if (release.timestamp_taipei_date != null && !validDate(release.timestamp_taipei_date)) return false;
  if ((release.platform === "PS5" || release.timezone_status === "hong_kong_official_date") && release.source_timestamp != null) {
    if (!Number.isSafeInteger(release.source_timestamp) || release.source_timestamp < 0) return false;
    const instant = new Date(release.source_timestamp * 1000);
    if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== release.source_date ||
      todayInTaipei(instant) !== release.timestamp_taipei_date) return false;
  }
  if (release.timezone_status === "hong_kong_official_date") {
    return ["NS", "NS2"].includes(release.platform) && validDate(release.date) &&
      release.source === "official_registry" && release.region === "hong_kong" &&
      release.date_basis === "hong_kong_official_calendar_day" && release.taiwan_release_confirmed === false &&
      awareTime(release.official_verified_at) !== null &&
      typeof release.official_source_name === "string" && !!release.official_source_name.trim() &&
      !!nintendoHongKongDateURL(release.official_source_url) &&
      (release.official_release_time_utc == null || officialTaiwanReleaseTime(release) !== null);
  }
  if (release.timezone_status === "taiwan_official_date") {
    if (!(release.source === "official_registry" && release.region === "taiwan" &&
      release.date_basis === "taiwan_official_calendar_day" && release.taiwan_release_confirmed === true)) return false;
    if (release.platform !== "PS5") return true;
    if (awareTime(release.official_verified_at) === null ||
      typeof release.official_source_name !== "string" || !release.official_source_name.trim()) return false;
    const url = platformURL(release.official_source_url, "PS5", "taiwan");
    if (!url) return false;
    const product = playstationProduct(url, "taiwan");
    if (product?.kind === "concept") {
      if (release.official_concept_id !== product.id || release.official_product_id != null ||
        officialTaiwanReleaseTime(release) === null) return false;
    } else if (product && release.official_product_id !== product.id) return false;
    return release.official_release_time_utc == null || officialTaiwanReleaseTime(release) !== null;
  }
  if (release.platform === "PS5") {
    return release.source === "IGDB" && release.date_basis === "regional_calendar_day" &&
      release.region !== "taiwan" && release.source_region !== "taiwan" &&
      release.taiwan_release_confirmed === false && release.source_date === release.date &&
      (release.timestamp_taipei_date == null || release.timestamp_taipei_date === release.date) &&
      (release.timezone_status === "same_calendar_day" ? release.source_timestamp != null
        : release.timezone_status === "date_only" && release.source_timestamp == null);
  }
  return release.taiwan_release_confirmed !== true && release.source !== "official_registry" &&
    (release.source_date == null || release.source_date === release.date) &&
    (release.timestamp_taipei_date == null || release.timestamp_taipei_date === release.date);
}

export function officialTaiwanReleaseTime(release) {
  const instant = awareTime(release?.official_release_time_utc);
  return instant !== null && todayInTaipei(new Date(instant)) === release.date ? instant : null;
}
