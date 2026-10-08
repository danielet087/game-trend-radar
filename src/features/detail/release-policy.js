/** Verified source, region, timestamp and edition policy for detail releases. */
export function createReleasePolicy({ D, isNativeConsole }) {
  const nativePlatforms = ["NS", "NS2", "PS5"];
  const releasePlatformOrder = ["Steam", ...nativePlatforms];
  const regionNames = {
    worldwide: "全球", asia: "亞洲", taiwan: "台灣", japan: "日本",
    north_america: "北美", europe: "歐洲", australia: "澳洲",
    brazil: "巴西", south_korea: "韓國", china: "中國", united_kingdom: "英國", hong_kong: "香港",
  };
  const regionLabel = (region) => regionNames[region] || "來源地區未確認";
  function publicSourceURL(value) {
    try {
      const consoleURL = D.platformURL?.(value, "PS5");
      if (consoleURL) return consoleURL;
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port && /(^|\.)(igdb\.com|nintendo\.com|nintendo\.com\.hk|nintendo\.co\.jp|sega\.com|konami\.com|playtombraider\.com|layton\.jp)$/.test(url.hostname)
        ? url.href : "";
    } catch { return ""; }
  }
  const taiwanOfficialRelease = (row) => row?.taiwan_release_confirmed === true &&
    row.source === "official_registry" && row.region === "taiwan" &&
    row.date_basis === "taiwan_official_calendar_day" && row.timezone_status === "taiwan_official_date" &&
    !!publicSourceURL(row.official_source_url) &&
    (row.platform !== "PS5" || D.nativeReleaseAudited?.(row) === true);
  const hongKongOfficialRelease = (row) => ["NS", "NS2"].includes(row?.platform) &&
    row?.source === "official_registry" && row.region === "hong_kong" &&
    row.timezone_status === "hong_kong_official_date" && D.nativeReleaseAudited?.(row) === true;
  const nativeOfficialRelease = (row) => taiwanOfficialRelease(row) || hongKongOfficialRelease(row);
  const unifiedIGDBRelease = (row) => row?.source === "IGDB" &&
    ["igdb_timestamp_taipei", "igdb_calendar_day"].includes(row.date_basis) && D.nativeReleaseAudited?.(row) === true;
  const officialReleasePriority = (row) => unifiedIGDBRelease(row) ? 3
    : taiwanOfficialRelease(row) ? 2 : hongKongOfficialRelease(row) ? 1 : 0;
  function officialReleaseClock(row) {
    if (!nativeOfficialRelease(row)) return null;
    const instant = D.officialTaiwanReleaseTime?.(row);
    if (instant == null) return null;
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit",
      minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));
    const utc = new Date(instant).toISOString();
    return { time, utc };
  }
  function releaseSourceName(row) {
    if (unifiedIGDBRelease(row)) return "IGDB 平台發售資料";
    if (nativeOfficialRelease(row)) return String(row.official_source_name ||
      (hongKongOfficialRelease(row) ? "Nintendo 香港" : "台灣官方發售資料")).slice(0, 120);
    const sourceURL = publicSourceURL(row?.source);
    if (sourceURL) return new URL(sourceURL).hostname.endsWith("igdb.com") ? "IGDB 平台發售資料" : "官方平台發售資料";
    if (row?.source === "official_registry") return "官方日期來源待確認";
    return row?.source ? String(row.source).slice(0, 120) : "IGDB 平台發售資料";
  }
  function releaseDateNote(row) {
    if (unifiedIGDBRelease(row)) {
      if (row.date_basis === "igdb_calendar_day") return `依 IGDB ${regionLabel(row.region)}發售日期顯示。來源僅提供年月日，未提供可換算的時刻；台灣官方上市日及解鎖時間尚未確認。`;
      const original = row.source_date !== row.date
        ? `原始 IGDB 日期為 ${row.source_date.replaceAll("-", "/")}，換算後為 ${row.date.replaceAll("-", "/")}。` : "";
      return `依 IGDB ${regionLabel(row.region)}發售資料換算為台灣時區（Asia/Taipei／UTC+8）的日期。${original}此處只顯示日期；IGDB 時間戳不視為實際解鎖時間，也不表示台灣官方已確認上市日。`;
    }
    if (hongKongOfficialRelease(row)) {
      const original = D.validDate(row.source_date) && row.source_date !== row.date
        ? `原始 IGDB 日期為 ${row.source_date.replaceAll("-", "/")}，已依香港官方日期修正。` : "";
      const clock = officialReleaseClock(row);
      return `已確認香港官方發售日（UTC+8，與台灣同時區）。${clock
        ? `台灣時間 ${row.date.replaceAll("-", "/")} ${clock.time}（UTC+8），依官方發售時間換算。官方原始時間：${clock.utc.slice(0, 16).replace("T", " ")} UTC。`
        : "官方僅提供日期，未另行推算解鎖時間。"}${original}`;
    }
    if (taiwanOfficialRelease(row)) {
      const original = D.validDate(row.source_date) && row.source_date !== row.date
        ? `原始 IGDB 日期為 ${row.source_date.replaceAll("-", "/")}，已依台灣官方日期修正。` : "";
      const clock = officialReleaseClock(row);
      if (clock) return `已確認台灣上市日（Asia/Taipei）；台灣時間 ${row.date.replaceAll("-", "/")} ${clock.time}（UTC+8），依官方發售時間換算。官方原始時間：${clock.utc.slice(0, 16).replace("T", " ")} UTC。${original}`;
      return `已確認台灣上市日（Asia/Taipei）；日期依台灣官方公告。${original}`;
    }
    return `依 ${regionLabel(row?.region)}發售資料顯示；來源僅提供日期，尚未另行確認台灣上市日，無法推算台灣解鎖時間。實際上市時間請以台灣官方公告為準。`;
  }
  function detailReleaseRows(game) {
    const records = new Map();
    for (const row of Array.isArray(game.releases) ? game.releases : []) {
      if (!row || !releasePlatformOrder.includes(row.platform) ||
        !game.platforms?.includes(row.platform) || row.precision !== "day" || !D.validDate(row.date)) continue;
      const key = `${row.platform}|${row.date}|${row.region || ""}`;
      if (!records.has(key) || officialReleasePriority(row) > officialReleasePriority(records.get(key))) records.set(key, row);
    }
    const rows = [...records.values()].sort((a, b) => a.date.localeCompare(b.date) ||
      releasePlatformOrder.indexOf(a.platform) - releasePlatformOrder.indexOf(b.platform));
    const preferred = rows.filter(row => row.platform === "Steam" ||
      !rows.some(other => other.platform === row.platform &&
        officialReleasePriority(other) > officialReleasePriority(row)));
    const selected = preferred.find(row => row.date === game.date) || rows.find(row => row.date === game.date);
    // Keep the requested calendar event visible in the version's date list.
    if (selected) return [selected, ...preferred.filter(row => row !== selected)];
    if (preferred.length) return preferred;
    const platform = isNativeConsole(game)
      ? (game.releasePlatforms || game.platforms || []).find(code => nativePlatforms.includes(code))
      : "Steam";
    return platform ? [{ platform, date: game.date, precision: "day", region: game.dateRegion,
      source: game.dateSource || (platform === "Steam" ? "Steam" : "IGDB") }] : [];
  }
  return { nativePlatforms, releasePlatformOrder, regionLabel, publicSourceURL,
    taiwanOfficialRelease, hongKongOfficialRelease, nativeOfficialRelease,
    unifiedIGDBRelease, officialReleasePriority, officialReleaseClock,
    releaseSourceName, releaseDateNote, detailReleaseRows };
}
