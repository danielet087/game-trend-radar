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
  const decimalID = (value) =>
    (typeof value === "string" || Number.isSafeInteger(value)) &&
    /^[1-9][0-9]*$/.test(String(value)) ? String(value) : null;
  function awareTime(value) {
    if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !validDate(value.slice(0, 10)) || Number(value.slice(11, 13)) > 23 ||
      Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return null;
    const result = Date.parse(value);
    return Number.isFinite(result) ? result : null;
  }
  function exactReleaseDate(raw) {
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
  // Followers exceptions require the complete importer proof and verified Steam
  // row. A source name or an unverified manual Twitch entry cannot admit a game.
  function hasTwitchAdmission(raw) {
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
  function hasTaiwanStoreDateAuthority(raw) {
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
  function isTwitchQualified(raw) {
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
  function normalize(raw, recent = false, translated = null) {
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
  const savedID = (value) => Number.isSafeInteger(value) && value > 0
    ? value : typeof value === "string" && /^igdb:[1-9][0-9]*$/.test(value) ? value : null;
  const saveID = (game) => savedID(game?.appid);
  const gameKey = (game) => game?.key || game?.appid;
  function isSaved(game, saved) {
    return !!saved && [saveID(game), ...(game?.savedAliases || [])]
      .some(id => savedID(id) !== null && saved.has(id));
  }
  // The public Nintendo entry must link to an exact Steam product. Names,
  // search pages and a bare, self-declared AppID are not identity evidence.
  function nintendoSteamIdentity(raw) {
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
  function nintendoURL(value, kind = "link") {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value.startsWith("//") ? "https:" + value : value);
      const allowed = /(^|\.)(igdb\.com|nintendo\.com|nintendo\.com\.hk|nintendo\.co\.jp)$/.test(url.hostname);
      return url.protocol === "https:" && !url.username && !url.password && allowed ? url.href : "";
    } catch { return ""; }
  }
  const languageRegionNames = { taiwan: "台灣", north_america: "北美", japan: "日本", hong_kong: "香港", asia: "亞洲", worldwide: "全球公告",
    united_kingdom: "英國", europe: "歐洲", australia: "澳洲" };
  const officialLanguageHosts = new Set(["www.nintendo.com", "www.nintendo.co.jp", "www.nintendo.com.hk",
    "ec.nintendo.com", "asia.sega.com", "www.konami.com", "www.playtombraider.com", "www.layton.jp"]);
  function nintendoLanguageURL(value, region = null) {
    if (typeof value !== "string") return "";
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
        !officialLanguageHosts.has(url.hostname)) return "";
      if (region) {
        if (region === "australia" && !["www.nintendo.com", "ec.nintendo.com"].includes(url.hostname)) return "";
        if (url.hostname === "www.nintendo.com" && !url.pathname.startsWith(
          { taiwan: "/tw/", north_america: "/us/", united_kingdom: "/en-gb/", europe: "/en-gb/", australia: "/au/" }[region] || "\0")) return "";
        if (url.hostname === "www.nintendo.co.jp" && region !== "japan") return "";
        if (url.hostname === "www.nintendo.com.hk" && region !== "hong_kong") return "";
        if (url.hostname === "ec.nintendo.com" && !url.pathname.startsWith(
          { taiwan: "/TW/", hong_kong: "/HK/", japan: "/JP/", australia: "/AU/" }[region] || "\0")) return "";
      }
      return url.href;
    } catch { return ""; }
  }
  function nintendoLanguageSupport(raw) {
    const unknown = { status: "unknown", region: null,
      languages: { tchinese: null, schinese: null, english: null, chinese: null },
      supported_languages: [], complete: false, source: null, source_url: null, checked_at: null,
      evidence_type: null, languageBadges: [{ label: "語言支援待確認", status: "unknown" }] };
    if (!raw || !["confirmed", "partial"].includes(raw.status) ||
      !Object.hasOwn(languageRegionNames, raw.region) || !nintendoLanguageURL(raw.source_url, raw.region) ||
      typeof raw.source !== "string" || !raw.source.trim() || awareTime(raw.checked_at) === null ||
      !["official_product_languages", "official_chinese_unspecified"].includes(raw.evidence_type) ||
      typeof raw.complete !== "boolean" || !raw.languages || !Array.isArray(raw.supported_languages) ||
      !raw.supported_languages.length || raw.supported_languages.length > 32) return unknown;
    const sourceURL = nintendoLanguageURL(raw.source_url);
    const rows = [], codes = new Set();
    for (const row of raw.supported_languages) {
      if (!row || typeof row.code !== "string" || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(row.code) ||
        typeof row.name !== "string" || !row.name.trim() || codes.has(row.code.toLowerCase())) return unknown;
      codes.add(row.code.toLowerCase());
      rows.push({ code: row.code, name: row.name.trim().slice(0, 80) });
    }
    const genericChinese = codes.has("zh");
    const traditional = [...codes].some(code => /^zh-(?:hant(?:-|$)|tw$|hk$|mo$)/.test(code));
    const simplified = [...codes].some(code => /^zh-(?:hans(?:-|$)|cn$|sg$)/.test(code));
    const english = [...codes].some(code => /^en(?:-|$)/.test(code));
    const complete = raw.complete === true;
    const expected = {
      tchinese: traditional ? true : genericChinese ? null : complete ? false : null,
      schinese: simplified ? true : genericChinese ? null : complete ? false : null,
      english: english ? true : complete ? false : null,
      chinese: genericChinese || traditional || simplified ? true : complete ? false : null,
    };
    if (Object.keys(expected).some(key => raw.languages[key] !== expected[key]) ||
      (raw.status === "confirmed" && (!complete || raw.evidence_type !== "official_product_languages")) ||
      (raw.status === "partial" && complete) ||
      (raw.evidence_type === "official_chinese_unspecified" &&
        (raw.status !== "partial" || codes.size !== 1 || !genericChinese))) return unknown;
    const badges = [];
    if (expected.tchinese === true) badges.push({ label: "支援繁中", status: "traditional" });
    if (expected.schinese === true) badges.push({ label: "支援簡中", status: "simplified" });
    if (expected.chinese === true && !badges.length) badges.push({ label: "中文（字體待確認）", status: "chinese" });
    if (!badges.length && expected.english === true) badges.push({ label: "支援英文", status: "english" });
    if (!badges.length && rows.length) badges.push({ label: `支援${rows[0].name}`, status: "other" });
    return { status: raw.status, region: raw.region, languages: expected, supported_languages: rows, complete,
      source: raw.source.trim().slice(0, 120), source_url: sourceURL, checked_at: raw.checked_at,
      evidence_type: raw.evidence_type, languageBadges: badges.length ? badges : unknown.languageBadges };
  }
  function nintendoCardLanguages(platformLanguages = {}, platforms = []) {
    const selected = platforms.map(platform => ({ platform, support: platformLanguages[platform] || nintendoLanguageSupport() }));
    const badges = selected.flatMap(({ platform, support }) => support.languageBadges.map(badge => ({
      ...badge, label: `${selected.length > 1 ? platform + " " : ""}${badge.label}`,
      title: support.status === "unknown" ? `${platform} 版本語言支援待確認`
        : `${platform} 版本 · ${languageRegionNames[support.region]}來源；${support.source}。介面、字幕與配音請以該版本官方語言表為準。${support.region !== "taiwan" ? "尚未確認台灣販售版本是否相同。" : ""}`,
    })));
    const languages = Object.fromEntries(["tchinese", "schinese", "english", "chinese"].map(key =>
      [key, selected.length && selected.every(({ support }) => support.languages[key] === true) ? true : null]));
    return { languages, languageBadges: badges, languageBadge: badges.map(badge => badge.label).join("・"),
      languageStatus: badges[0]?.status || "unknown" };
  }
  function nintendoEdition(raw) {
    if (!raw || !["base_plus_expansion", "deluxe", "base_plus_dlc"].includes(raw.type) ||
      typeof raw.label !== "string" || !raw.label.trim() || raw.label.trim().length > 120 ||
      typeof raw.title !== "string" || !raw.title.trim() || raw.title.trim().length > 240 ||
      typeof raw.product_id !== "string" || !/^[1-9][0-9]{13}$/.test(raw.product_id) ||
      !Object.hasOwn(languageRegionNames, raw.region) || awareTime(raw.checked_at) === null) return null;
    const sourceURL = nintendoLanguageURL(raw.source_url, raw.region);
    if (!sourceURL) return null;
    const url = new URL(sourceURL);
    if (!["www.nintendo.com", "www.nintendo.co.jp", "www.nintendo.com.hk", "ec.nintendo.com"].includes(url.hostname)) return null;
    if (url.hostname === "ec.nintendo.com") {
      const product = /^\/(?:TW|HK|JP|AU)\/[A-Za-z-]+\/titles\/([1-9][0-9]{13})\/?$/.exec(url.pathname);
      if (!product || product[1] !== raw.product_id) return null;
    }
    return { type: raw.type, label: raw.label.trim(), title: raw.title.trim(), product_id: raw.product_id,
      region: raw.region, source_url: sourceURL, checked_at: raw.checked_at };
  }
  function releaseEditionBadges(game, platforms = game?.releasePlatforms || []) {
    return [...new Set(Array.isArray(platforms) ? platforms : [])]
      .filter(platform => ["NS", "NS2"].includes(platform) && game?.platforms?.includes(platform))
      .flatMap(platform => {
        const edition = nintendoEdition(game?.platformEditions?.[platform]);
        return edition ? [{ platform, ...edition }] : [];
      });
  }
  function releaseDisplayNames(game, platforms = game?.releasePlatforms || []) {
    const original = { name: String(game?.name || ""), nameEn: String(game?.nameEn || "") };
    const selected = [...new Set(Array.isArray(platforms) ? platforms : [])]
      .filter(platform => game?.platforms?.includes(platform));
    const editions = releaseEditionBadges(game, selected);
    if (!editions.length) return original;
    const groups = new Map();
    for (const edition of editions) {
      const key = JSON.stringify([edition.type, edition.label, edition.title]);
      if (!groups.has(key)) groups.set(key, { label: edition.label, title: edition.title, platforms: [] });
      groups.get(key).platforms.push(edition.platform);
    }
    const versions = [...groups.values()];
    const scoped = versions.length > 1 || selected.some(platform => !editions.some(edition => edition.platform === platform));
    const platformPrefix = (version) => scoped ? version.platforms.join("／") + " " : "";
    const nameEn = versions.map(version => platformPrefix(version) + version.title).join("／");
    if (!/[\u3400-\u9fff]/.test(original.name)) return { name: nameEn, nameEn };
    // Canonical names stay intact. Repeated suffixes in a localized display
    // name are replaced by one version suffix with the current event's scope.
    const normalize = value => value.replace(/[\s：:]/g, "").toLocaleLowerCase("en-US");
    const labels = new Set(versions.map(version => normalize(version.label)));
    let base = original.name.trim();
    while (base) {
      const suffix = /[（(]([^（）()]*)[）)]$/.exec(base);
      if (!suffix || !labels.has(normalize(suffix[1].replace(/^(?:(?:NS2?|Steam)[／\s：:]*)+/, "")))) break;
      base = base.slice(0, suffix.index).trim();
    }
    for (const version of versions) {
      if (normalize(base).endsWith(normalize(version.label))) {
        const words = version.label.trim().split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        const suffix = new RegExp(words.join("\\s*") + "\\s*$", "i");
        base = base.replace(suffix, "").replace(/[\s：:·・＋+／/—-]+$/, "").trim();
      }
    }
    const label = versions.map(version => platformPrefix(version) + version.label).join("；");
    return { name: `${base || original.name}（${label}）`, nameEn };
  }
  function nintendoGames(payload) {
    if (!payload || payload.schema_version !== 1 || !Array.isArray(payload.games)) return [];
    const games = [];
    for (const raw of payload.games) {
      const id = decimalID(raw?.igdb_id);
      if (!id || !Number.isSafeInteger(Number(id)) || raw.id !== `igdb:${id}` || raw.sexual_content_screened !== true ||
        !Number.isSafeInteger(raw.hypes) || raw.hypes < 30 || !Array.isArray(raw.platforms) ||
        !Array.isArray(raw.releases)) continue;
      const platforms = [...new Set(raw.platforms.filter(platform =>
        ["NS", "NS2"].includes(platform?.code) &&
        Number(platform.id) === (platform.code === "NS" ? 130 : 508)).map(platform => platform.code))];
      if (!platforms.length) continue;
      const platformLanguages = Object.fromEntries(platforms.map(code =>
        [code, nintendoLanguageSupport(raw.platform_language_support?.[code])]));
      const platformEditions = Object.fromEntries(platforms.flatMap(code => {
        const edition = nintendoEdition(raw.platform_editions?.[code]);
        return edition ? [[code, edition]] : [];
      }));
      const nameEn = String(raw.name_en || raw.name || "").trim();
      const nameTw = String(raw.name_zh_tw_traditional || raw.name_zh_tw || "").trim();
      const nameCn = String(raw.name_zh_cn_traditional || "").trim();
      const name = String(raw.display_name || nameTw || nameCn || raw.name_en_traditional || nameEn || `IGDB ${id}`).trim();
      const steamAppid = nintendoSteamIdentity(raw);
      const grouped = new Map();
      for (const release of raw.releases) {
        if (release?.precision !== "day" || !validDate(release.date) ||
          !platforms.includes(release.platform) || !nintendoReleaseAudited(release)) continue;
        if (!grouped.has(release.date)) grouped.set(release.date, []);
        const rows = grouped.get(release.date);
        if (!rows.some(row => row.platform === release.platform && row.region === release.region)) rows.push(release);
      }
      for (const [date, releases] of grouped) {
        const releasePlatforms = platforms.filter(code => releases.some(release => release.platform === code));
        const exclusive = raw.exclusivity || {};
        const knownPlatforms = Array.isArray(raw.known_platforms) ? raw.known_platforms : [];
        const soleKnown = knownPlatforms.length === 1 &&
          Number(knownPlatforms[0]?.id) === (platforms[0] === "NS" ? 130 : 508);
        const otherPlatforms = knownPlatforms.some(platform => ![130, 508].includes(Number(platform?.id)));
        const confirmed = !steamAppid && exclusive.status === "confirmed" && platforms.length === 1 &&
          soleKnown && raw.platform_data_complete === true && exclusive.platform === platforms[0] &&
          !!nintendoURL(exclusive.url) && !new URL(nintendoURL(exclusive.url)).hostname.endsWith("igdb.com");
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
        const nintendoLink = nintendoURL(raw.nintendo_url);
        const igdbLink = nintendoURL(raw.url);
        const link = nintendoLink || igdbLink || "https://www.igdb.com/";
        games.push({
          appid: `igdb:${id}`, key: `igdb:${id}@${date}`, igdbId: Number(id), source: "nintendo",
          igdbIds: [Number(id)], identityKey: steamAppid ? `steam:${steamAppid}` : `igdb:${id}`,
          savedAliases: [`igdb:${id}`, ...(steamAppid ? [steamAppid] : [])],
          steamAppid, steamLink: steamAppid ? `https://store.steampowered.com/app/${steamAppid}/` : "",
          hasNintendo: true, multiPlatform, knownPlatforms,
          name, nameEn, nameTw, nameCn, nameOriginalTw: raw.name_zh_tw || "", nameOriginalCn: raw.name_zh_cn || "",
          nameSearchAliases: [...new Set(Object.values(platformEditions).flatMap(edition => [edition.title, edition.label]))],
          date, releases: [...grouped.values()].flat(), dateReleases: releases, dateRegion: releases[0]?.region || "",
          dateSource: releases[0]?.source || "IGDB", releasePlatforms, platforms,
          platformShort, platformLabel, platformBadges: [
            ...platforms.map(code => ({ label: confirmed ? `${code} 獨佔` : code,
              status: confirmed ? "exclusive" : "nintendo", title: platformTitle })),
            ...(multiPlatform ? [{ label: "多平台", status: "multi", title: platformTitle }] : []),
          ],
          hypes: raw.hypes, followers: null, platformLanguages, platformEditions,
          ...nintendoCardLanguages(platformLanguages, releasePlatforms),
          art, artSources: art ? [art] : [], art2x: "", artVariants: {}, hasVerifiedHeader: !!art,
          recent: false, darkHorse: false, link, linkLabel: nintendoLink ? "Nintendo 官網" : igdbLink ? "IGDB 遊戲資料" : "IGDB 官網",
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
  function nintendoReleaseAudited(release) {
    // Old public bundles remain readable during the publisher transition. New
    // audited records must not turn an ambiguous timestamp into a calendar day.
    if (release.timezone_status == null) return true;
    if (release.time_zone !== "Asia/Taipei" ||
      !["same_calendar_day", "date_only", "taiwan_official_date"].includes(release.timezone_status)) return false;
    if (release.source_date != null && !validDate(release.source_date)) return false;
    if (release.timestamp_taipei_date != null && !validDate(release.timestamp_taipei_date)) return false;
    if (release.timezone_status === "taiwan_official_date") {
      return release.source === "official_registry" && release.region === "taiwan" &&
        release.date_basis === "taiwan_official_calendar_day" && release.taiwan_release_confirmed === true;
    }
    return release.taiwan_release_confirmed !== true && release.source !== "official_registry" &&
      (release.source_date == null || release.source_date === release.date) &&
      (release.timestamp_taipei_date == null || release.timestamp_taipei_date === release.date);
  }
  function detailURL(game) {
    return game.source === "nintendo"
      ? `./game.html?igdb=${game.igdbId}&date=${game.date}`
      : `./game.html?appid=${game.appid}${game.hasNintendo ? `&date=${game.date}` : ""}`;
  }
  function popularityCompare(a, b) {
    // Counts belong to different communities; only compare within their source.
    if ((a.source === "nintendo") !== (b.source === "nintendo")) return a.source === "nintendo" ? 1 : -1;
    return (a.source === "nintendo" ? b.hypes - a.hypes : b.followers - a.followers) ||
      a.date.localeCompare(b.date) || a.name.localeCompare(b.name, "zh-TW");
  }
  function calendarFeatured(games) {
    const ranked = [...games].sort(popularityCompare);
    const steam = ranked.filter(game => game.source !== "nintendo");
    const nintendo = ranked.filter(game => game.source === "nintendo");
    return steam.length && nintendo.length ? [steam[0], nintendo[0]] : ranked.slice(0, 2);
  }
  const unique = (items) =>
    Array.from(new Map(items.map((game) => [gameKey(game), game])).values());
  function uniqueReleases(releases) {
    const result = new Map();
    for (const release of releases) {
      if (!release || !validDate(release.date) || release.precision !== "day" ||
        !["Steam", "NS", "NS2"].includes(release.platform)) continue;
      const key = `${release.platform}:${release.date}:${release.region || ""}`;
      if (!result.has(key)) result.set(key, release);
    }
    return [...result.values()].sort((a, b) => a.date.localeCompare(b.date) ||
      ["Steam", "NS", "NS2"].indexOf(a.platform) - ["Steam", "NS", "NS2"].indexOf(b.platform));
  }
  function mergePlatformGames(steamRows, nintendoRows, steamReference = steamRows) {
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
      const platforms = ["Steam", ...["NS", "NS2"].filter(code => rows.some(game => game.platforms.includes(code)))];
      const releases = uniqueReleases([...steam.releases, ...rows.flatMap(game => game.releases)]);
      // An event belongs to this dataset only if that date was admitted here.
      // The complete release list may also retain an older Steam version.
      const dates = [...new Set([...steamRows.filter(game => game.appid === appid), ...rows]
        .map(game => game.date))].sort();
      const translated = !/[\u3400-\u9fff]/.test(steam.name) && /[\u3400-\u9fff]/.test(nintendo.name);
      const metadata = {
        ...steam,
        ...(translated ? { name: nintendo.name, nameTw: nintendo.nameTw, nameCn: nintendo.nameCn } : {}),
        nameOriginalTw: steam.nameOriginalTw || nintendo.nameOriginalTw,
        nameOriginalCn: steam.nameOriginalCn || nintendo.nameOriginalCn,
        nameSearchAliases: [...new Set([steam, ...rows].flatMap(game => [
          game.name, game.nameEn, game.nameTw, game.nameCn, game.nameOriginalTw, game.nameOriginalCn,
          ...(Array.isArray(game.nameSearchAliases) ? game.nameSearchAliases : []),
        ]).filter(Boolean))],
        igdbId: igdbIds[0], igdbIds, hasNintendo: true, multiPlatform: true,
        identityKey: `steam:${appid}`, steamAppid: appid, steamLink: steam.link,
        savedAliases: [appid, ...igdbIds.map(id => `igdb:${id}`)],
        nintendoLink: nintendo.link, nintendoLinkLabel: nintendo.linkLabel,
        hypes: nintendo.hypes, platforms, releases,
        platformLanguages: Object.fromEntries(platforms.filter(code => code !== "Steam").map(code => {
          const sources = rows.map(row => row.platformLanguages?.[code]).filter(Boolean);
          return [code, sources.length && sources.every(source => JSON.stringify(source) === JSON.stringify(sources[0]))
            ? sources[0] : nintendoLanguageSupport()];
        })),
        platformEditions: Object.fromEntries(platforms.filter(code => code !== "Steam").flatMap(code => {
          const versions = rows.filter(row => row.platforms.includes(code));
          const editions = versions.map(row => row.platformEditions?.[code]);
          return editions.length && editions[0] && editions.every(edition =>
            edition && JSON.stringify(edition) === JSON.stringify(editions[0])) ? [[code, editions[0]]] : [];
        })),
        platformLabel: platforms.join("／") + "・多平台",
        platformBadges: [
          ...platforms.map(code => ({ label: code, status: code === "Steam" ? "steam" : "nintendo",
            title: `已確認的原生版本平台：${platforms.join("／")}` })),
          { label: "多平台", status: "multi", title: `同一款遊戲的 Steam／Nintendo 版本；各平台保留自己的發售日` },
        ],
        exclusivity: { status: "multi_platform" },
        knownPlatforms: nintendo.knownPlatforms,
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
  // Cards represent one physical game; calendar entries still represent dates.
  // Call this after date/language/search filters so the visible date belongs to
  // the requested scope rather than an older port hidden by that scope.
  function cardGames(items, direction = "earliest") {
    const groups = new Map();
    for (const game of items) {
      const key = game.identityKey || `game:${game.appid}`;
      const current = groups.get(key);
      if (!current || (direction === "latest" ? game.date > current.date : game.date < current.date))
        groups.set(key, game);
    }
    return [...groups.values()];
  }
  function latestSourceUpdate(...values) {
    const valid = values.map(value => ({ value, instant: awareTime(value) }))
      .filter(entry => entry.instant !== null);
    return valid.sort((a, b) => b.instant - a.instant)[0]?.value || null;
  }
  function datasets(official, preview, nintendo = null) {
    const chosen = official || preview;
    const nintendoRows = nintendoGames(nintendo);
    if (!chosen && !nintendo) return null;
    const translations = new Map(
      (preview?.games || [])
        .filter(Boolean)
        .map((game) => [Number(game.appid), game]),
    );
    const steamUpdated = latestSourceUpdate(chosen?.generated_at, chosen?.updated_at);
    const nintendoUpdated = latestSourceUpdate(nintendo?.generated_at);
    const steamGames = unique((chosen?.games || []).map(game =>
      normalize(game, false, translations.get(Number(game?.appid)))).filter(Boolean));
    const steamRecent = unique([
      ...(preview?.recent_games || []).map(game => normalize(game, true)),
      ...(chosen?.games || []).map(game => normalize(game, true, translations.get(Number(game?.appid)))),
    ].filter(Boolean));
    const steamReference = unique([...steamRecent, ...steamGames]);
    return {
      games: mergePlatformGames(steamGames, nintendoRows, steamReference),
      recent: mergePlatformGames(steamRecent, nintendoRows, steamReference),
      updated: latestSourceUpdate(steamUpdated, nintendoUpdated),
      steamUpdated,
      recentUpdated: chosen?.generated_at || preview?.generated_at || nintendo?.generated_at || null,
      nintendoUpdated,
      nintendoAvailable: !!nintendo,
      partial:
        !!chosen?.is_partial_preview ||
        chosen?.initialization?.complete === false || !chosen,
      initialization: chosen?.initialization || null,
      recentAvailable: chosen?.version >= 2 || (!!preview && Array.isArray(preview.recent_games)) || !!nintendo,
      source: official ? "official" : preview ? "preview" : "nintendo",
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
    if (mode === "saved" || mode === "all")
      return unique([...data.games, ...data.recent]);
    return data.games;
  }
  const api = {
    validDate,
    todayInTaipei,
    offsetDate,
    imageURL,
    exactReleaseDate,
    hasTwitchAdmission,
    hasTaiwanStoreDateAuthority,
    isTwitchQualified,
    normalize,
    savedID,
    saveID,
    isSaved,
    gameKey,
    nintendoSteamIdentity,
    nintendoURL,
    nintendoLanguageURL,
    nintendoLanguageSupport,
    nintendoCardLanguages,
    nintendoEdition,
    releaseEditionBadges,
    releaseDisplayNames,
    nintendoGames,
    detailURL,
    popularityCompare,
    calendarFeatured,
    unique,
    cardGames,
    datasets,
    selectGames,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RadarData = api;
})(typeof window !== "undefined" ? window : globalThis);
