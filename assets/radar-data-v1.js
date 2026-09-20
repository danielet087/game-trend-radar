/* Shared, presentation-only adapter for the existing public Steam JSON contract. */
(function (root) {
  "use strict";
  const DAY = 86400000;
  const validDate = (value) =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T12:00:00Z")) &&
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value;
  function todayInTaipei(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    return ["year", "month", "day"]
      .map((key) => parts.find((part) => part.type === key).value)
      .join("-");
  }
  const offsetDate = (date, days) =>
    new Date(Date.parse(date + "T12:00:00Z") + days * DAY)
      .toISOString()
      .slice(0, 10);
  function imageURL(value, appid) {
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
  function normalize(raw, recent = false, translated = null) {
    if (!raw || typeof raw !== "object") return null;
    const date = raw.release_start || raw.release_date;
    const followers = raw.followers == null ? NaN : Number(raw.followers);
    const appid = Number(raw.appid);
    if (
      !validDate(date) ||
      (raw.release_precision && raw.release_precision !== "day") ||
      !Number.isInteger(appid) ||
      appid <= 0 ||
      !Number.isFinite(followers)
    )
      return null;
    if (
      recent
        ? !(
            followers > 3000 &&
            ["tracked_release", "direct_release"].includes(raw.recent_source)
          )
        : followers < 5000
    )
      return null;
    const nameEn = String(
      raw.name_en || raw.name || translated?.name_en || translated?.name || "",
    ).trim();
    // Language support comes from Steam's game-level supported_languages,
    // not from which language the Store description was translated into.
    const languages = raw.language_support || translated?.language_support || null;
    const nameTw = String(
      raw.name_zh_tw || translated?.name_zh_tw || "",
    ).trim();
    const nameCn = String(
      raw.name_zh_cn || translated?.name_zh_cn || "",
    ).trim();
    const useTw = !!nameTw && (languages ? languages.tchinese === true : true);
    const useCn = !!nameCn && (languages ? languages.schinese === true : true);
    const name = String(
      (useTw && nameTw) ||
      (useCn && nameCn) ||
      nameEn ||
      `Steam App ${appid}`,
    ).trim();
    const languageBadge = !languages ||
      languages.tchinese == null ||
      languages.schinese == null
      ? "語言待確認"
      : languages.tchinese
        ? "支援繁體中文"
        : languages.schinese
          ? "支援簡體中文"
          : "未標示支援中文";
    const languageStatus = !languages ||
      languages.tchinese == null ||
      languages.schinese == null
      ? "unknown"
      : languages.tchinese
        ? "traditional"
        : languages.schinese
          ? "simplified"
          : "other";
    // Steam's small capsule is only 231x87; stretching it over a large
    // homepage/card banner makes it visibly soft. Prefer store header assets.
    // Modern Steam assets can have a different hash for header vs capsule, so
    // NEVER replace the capsule filename inside its hashed URL.
    const suppliedHeader = [
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
    const smallCapsules = [raw.capsule_image, translated?.capsule_image]
      .map((value) => imageURL(value, appid))
      .filter(Boolean);
    const images = Array.from(new Set([
      ...suppliedHeader, ...fallbackHeaders, ...smallCapsules,
    ]));
    return {
      appid,
      name,
      nameEn,
      nameTw,
      nameCn,
      languages,
      languageBadge,
      languageStatus,
      date,
      followers,
      art: images[0] || "",
      artSources: images,
      hasVerifiedHeader: suppliedHeader.length > 0,
      recent,
      darkHorse:
        recent &&
        raw.recent_source === "direct_release" &&
        !!raw.first_week_qualified_at,
      link: `https://store.steampowered.com/app/${appid}/`,
    };
  }
  const unique = (items) =>
    Array.from(new Map(items.map((game) => [game.appid, game])).values());
  function datasets(official, preview) {
    const chosen = official || preview;
    if (!chosen) return null;
    const translations = new Map(
      (preview?.games || [])
        .filter(Boolean)
        .map((game) => [Number(game.appid), game]),
    );
    return {
      games: unique(
        chosen.games
          .map((game) =>
            normalize(game, false, translations.get(Number(game?.appid))),
          )
          .filter(Boolean),
      ),
      recent: unique(
        (preview?.recent_games || [])
          .map((game) => normalize(game, true))
          .filter(Boolean),
      ),
      updated: chosen.generated_at || chosen.updated_at || null,
      recentUpdated: preview?.generated_at || null,
      partial:
        !!chosen.is_partial_preview ||
        chosen.initialization?.complete === false,
      initialization: chosen.initialization || null,
      recentAvailable: !!preview && Array.isArray(preview.recent_games),
      source: official ? "official" : "preview",
    };
  }
  function selectGames(data, mode, today, date = null) {
    if (mode === "released")
      return data.recent.filter(
        (game) => game.date >= offsetDate(today, -30) && game.date <= today,
      );
    if (mode === "upcoming")
      return data.games.filter(
        (game) => game.date >= today && game.date <= offsetDate(today, 45),
      );
    if (mode === "date") return data.games.filter((game) => game.date === date);
    if (mode === "saved") return unique([...data.games, ...data.recent]);
    return data.games;
  }
  const api = {
    validDate,
    todayInTaipei,
    offsetDate,
    imageURL,
    normalize,
    unique,
    datasets,
    selectGames,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RadarData = api;
})(typeof window !== "undefined" ? window : globalThis);
