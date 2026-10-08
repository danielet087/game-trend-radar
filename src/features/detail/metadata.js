export function createDetailMetadata(ctx, policy) {
  const { $, node, D, number, isNativeConsole } = ctx;
  const { nativePlatforms, regionLabel, releasePlatformOrder, publicSourceURL,
    officialReleaseClock, unifiedIGDBRelease, nativeOfficialRelease, releaseSourceName, releaseDateNote } = policy;
  function renderLanguages(game) {
    const nintendo = isNativeConsole(game);
    $("gameLanguageContent").hidden = false;
    $("steamLanguageSection").hidden = nintendo;
    $("gameLanguageBadge").replaceChildren(
      ...(!nintendo ? game.languageBadges || [] : []).map((badge) =>
        node(
          "span",
          `game-language-chip language-${badge.status}`,
          badge.label,
        ),
      ),
    );
    $("gameLanguageLine").dataset.language = game.languageStatus;
    const bothChinese =
      game.languages?.tchinese === true && game.languages?.schinese === true;
    $("gameLanguageDescription").textContent = nintendo
      ? ""
      : bothChinese
      ? "Steam 商店標示同時支援繁中與簡中；各語言的介面、字幕與配音項目請以商店為準。"
      : game.languageStatus === "traditional"
        ? "Steam 商店標示支援繁中；各語言的介面、字幕與配音項目請以商店為準。"
        : game.languageStatus === "simplified"
          ? "Steam 商店標示支援簡中；尚未標示繁中支援。"
          : game.languageStatus === "english"
            ? "Steam 商店未標示支援繁中或簡中，但有支援英文。"
            : game.languageStatus === "other"
              ? "Steam 商店未標示支援繁中、簡中或英文，請至商店查看其他支援語言。"
              : "Steam 尚未提供足以確認的語言資訊，請以官方商店語言表為準。";
    const platforms = (game.platforms || []).filter(code => nativePlatforms.includes(code));
    $("nintendoLanguageSections").hidden = !platforms.length;
    $("gameLanguagePolicy").hidden = !platforms.length;
    $("nintendoLanguageSections").replaceChildren(...platforms.map(code => {
      const support = game.platformLanguages?.[code] || D.platformLanguageSupport?.(null, code) || D.nintendoLanguageSupport();
      const section = node("section", "game-language-version");
      section.dataset.platform = code;
      section.setAttribute("aria-label", `${code} 版本遊戲支援語言`);
      section.append(node("p", "game-language-version-title", `${code} 版本`));
      const badges = node("div", "game-language-badges");
      badges.append(...support.languageBadges.map(badge => node("span", `game-language-chip language-${badge.status}`, badge.label)));
      section.append(badges);
      if (support.status === "unknown") {
        section.append(node("p", "game-language-source", "尚無可確認的此平台版本官方語言資料。"));
        return section;
      }
      section.append(node("p", "game-language-list", `已公布語言：${support.supported_languages.map(row => row.name).join("、")}`));
      const source = node("p", "game-language-source");
      const link = node("a", "", support.source);
      link.href = support.source_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const region = support.region === "worldwide" ? "全球公告" : `${regionLabel(support.region)}版本`;
      source.append(node("span", "", `來源：${region} · `), link);
      section.append(source);
      const notes = [];
      if (support.languages.chinese === true && support.languages.tchinese === null && support.languages.schinese === null)
        notes.push("官方僅標示中文，尚未區分繁體／簡體字體。");
      if (support.complete && support.languages.tchinese === false) notes.push("官方完整語言列表未列繁體中文。");
      if (support.complete && support.languages.schinese === false) notes.push("官方完整語言列表未列簡體中文。");
      if (support.region !== "taiwan") notes.push("台灣販售版本的語言是否相同仍待確認。");
      notes.push("介面、字幕與配音的細項請以此版本官方語言表為準。");
      section.append(node("p", "game-language-description", notes.join("")));
      return section;
    }));
  }
  function renderPlatforms(game) {
    const nintendo = isNativeConsole(game);
    $("gamePlatforms").hidden = false;
    $("gamePlatforms").replaceChildren(
      ...(game.platformBadges || []).map((badge) => {
        const chip = node("span", "game-platform-chip", badge.label);
        chip.title = badge.title || game.platformLabel || badge.label;
        return chip;
      }),
    );
    const editions = (game.platforms || []).filter(code => nativePlatforms.includes(code))
      .map(code => ({ code, edition: game.platformEditions?.[code] }))
      .filter(({ edition }) => edition?.label && edition.title && publicSourceURL(edition.source_url));
    $("gamePlatformSupport").hidden = false;
    $("gamePlatformLabel").textContent = game.platformLabel || "平台資訊待確認";
    $("gamePlatformNote").textContent = [...new Set((game.platformBadges || []).map(badge => badge.title).filter(Boolean))].join(" ");
    if (!nintendo && Number.isSafeInteger(game.hypes))
      $("gamePlatformNote").append(node("span", "", ` IGDB hypes ${number.format(game.hypes)}（遊戲整體關注數，與 Steam Followers 分開計算）。`));
    const rows = Array.isArray(game.releases) ? game.releases : [];
    const seen = new Set();
    const dates = rows.filter((row) => {
      if (!row || !releasePlatformOrder.includes(row.platform) || row.precision !== "day" || !D.validDate(row.date)) return false;
      const key = `${row.platform}|${row.date}|${row.region || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform));
    $("gamePlatformDates").replaceChildren(...dates.map(row => {
      const clock = officialReleaseClock(row);
      const displayedRegion = unifiedIGDBRelease(row) && row.date_basis === "igdb_timestamp_taipei"
        ? "台灣時區（UTC+8）" : row.platform === "Steam" ? "台灣" : regionLabel(row.region);
      const item = node("li", "", `${row.platform} · ${row.date.replaceAll("-", "/")}${clock ? ` ${clock.time}` : ""} · ${displayedRegion}${clock ? "時間（UTC+8）" : ""}`);
      item.dataset.platform = row.platform;
      if (row.platform === "Steam") {
        item.append(node("p", "game-release-edition-label game-release-steam-version", "Steam 版本"));
        return item;
      }
      const evidence = node("div", "game-release-source");
      const sourceURL = nativeOfficialRelease(row) ? publicSourceURL(row.official_source_url) : publicSourceURL(row.source);
      const source = node(sourceURL ? "a" : "span", "", releaseSourceName(row));
      if (sourceURL) {
        source.href = sourceURL;
        source.target = "_blank";
        source.rel = "noopener noreferrer";
      }
      evidence.append(node("span", "", "來源："), source, node("span", "", `。${releaseDateNote(row)}`));
      item.append(evidence);
      const edition = editions.find(entry => entry.code === row.platform)?.edition;
      if (edition) {
        const version = node("div", "game-release-edition");
        version.setAttribute("aria-label", `${row.platform} 已確認的版本與內容組合`);
        version.append(node("strong", "game-release-edition-label", `${row.platform} ${edition.label}`));
        version.append(node("p", "game-release-edition-title", `官方商品名稱：${edition.title}`));
        const origin = node("p", "game-release-edition-source");
        const link = node("a", "", `${row.platform === "PS5" ? "PlayStation" : "Nintendo"} 官方商品頁 ↗`);
        link.href = publicSourceURL(edition.source_url);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        origin.append(node("span", "", `版本資料：${regionLabel(edition.region)}版本 · `), link);
        version.append(origin);
        const contentNote = edition.type === "deluxe"
          ? "此平台發售的是上述 Deluxe 版本。"
          : "此平台發售的是包含本體與追加內容的版本。";
        version.append(node("p", "game-release-edition-note", `${contentNote}${unifiedIGDBRelease(row) ? "發售日期採 IGDB 平台資料。" : "發售日期對應上述版本與內容組合。"}${edition.region === "taiwan" ? "版本內容依台灣官方商品頁確認。" : "版本內容依此地區商品頁確認；台灣販售版本是否相同仍待確認。"}`));
        item.append(version);
      }
      return item;
    }));
    $("gamePlatformDates").hidden = !dates.length;
    $("gameNativeStoreLinks").replaceChildren(...nativePlatforms.flatMap(code => {
      if (!game.platforms?.includes(code)) return [];
      const merchant = game.platformLinks?.[code];
      const url = merchant && D.platformURL?.(merchant.url, code);
      if (!url || url === publicSourceURL(game.link)) return [];
      const label = code === "PS5" ? new URL(url).hostname === "store.playstation.com"
        ? "PlayStation 商店" : "PlayStation 官網" : "Nintendo 官網";
      const link = node("a", "button secondary", `${code} ${label} ↗`);
      link.dataset.platform = code;
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", `在 ${code} ${label}開啟 ${game.name}（另開分頁）`);
      return [link];
    }));
    $("gameNativeStoreLinks").hidden = !$("gameNativeStoreLinks").children.length;
  }
  return { renderLanguages, renderPlatforms };
}
