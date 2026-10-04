/* A static game spotlight and tag discovery over published Steam and Nintendo JSON. */
(() => {
  "use strict";
  const D = window.RadarData;
  const R = window.RadarDiscovery;
  const $ = (id) => document.getElementById(id);
  const storageKey = "game-trend-radar:saved:v1";
  const number = new Intl.NumberFormat("zh-TW");
  const query = new URLSearchParams(location.search);
  const appidText = query.get("appid") || "";
  const appid = /^[1-9][0-9]{0,9}$/.test(appidText) ? Number(appidText) : null;
  const igdbText = query.get("igdb") || "";
  const igdbId = /^[1-9][0-9]{0,9}$/.test(igdbText) ? Number(igdbText) : null;
  const nintendoRoute = query.has("igdb");
  const requestedDate = query.get("date");
  const today = D.todayInTaipei();
  const isNintendo = (game) => game?.source === "nintendo";
  const regionNames = {
    worldwide: "全球", asia: "亞洲", taiwan: "台灣", japan: "日本",
    north_america: "北美", europe: "歐洲", australia: "澳洲",
    brazil: "巴西", south_korea: "韓國", china: "中國", united_kingdom: "英國", hong_kong: "香港",
  };
  const regionLabel = (region) => regionNames[region] || "來源地區未確認";
  function detailURL(game) {
    if (D.detailURL) return D.detailURL(game);
    return isNintendo(game)
      ? `./game.html?igdb=${game.igdbId}&date=${game.date}`
      : `./game.html?appid=${game.appid}`;
  }
  function publicSourceURL(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port && /(^|\.)(igdb\.com|nintendo\.com|nintendo\.com\.hk|nintendo\.co\.jp|sega\.com|konami\.com|playtombraider\.com|layton\.jp)$/.test(url.hostname)
        ? url.href : "";
    } catch { return ""; }
  }
  const taiwanOfficialRelease = (row) => row?.taiwan_release_confirmed === true &&
    row.source === "official_registry" && row.region === "taiwan" &&
    row.date_basis === "taiwan_official_calendar_day" && row.timezone_status === "taiwan_official_date" &&
    !!publicSourceURL(row.official_source_url);
  function releaseSourceName(row) {
    if (taiwanOfficialRelease(row)) return String(row.official_source_name || "台灣官方發售資料").slice(0, 120);
    const sourceURL = publicSourceURL(row?.source);
    if (sourceURL) return new URL(sourceURL).hostname.endsWith("igdb.com") ? "IGDB 平台發售資料" : "官方平台發售資料";
    if (row?.source === "official_registry") return "官方日期來源待確認";
    return row?.source ? String(row.source).slice(0, 120) : "IGDB 平台發售資料";
  }
  function releaseDateNote(row) {
    if (taiwanOfficialRelease(row)) {
      const original = D.validDate(row.source_date) && row.source_date !== row.date
        ? `原始 IGDB 日期為 ${row.source_date.replaceAll("-", "/")}，已依台灣官方日期修正。` : "";
      return `已確認台灣上市日（Asia/Taipei）；日期依台灣官方公告。${original}`;
    }
    const audit = row?.time_zone === "Asia/Taipei"
      ? "日期已核對台灣時區（Asia/Taipei），不代表確切解鎖時間。" : "";
    return `依 ${regionLabel(row?.region)}發售資料顯示；此日期尚未另行確認台灣上市日。${audit}實際上市時間請以台灣官方公告為準。`;
  }
  const interestText = (game) => isNintendo(game)
    ? Number.isSafeInteger(game.hypes) ? `IGDB hypes ${number.format(game.hypes)}` : "IGDB hypes 未知"
    : `${number.format(game.followers)} 人關注`;
  let currentGame = null,
    candidates = [],
    knownGames = [],
    tagsExpanded = false,
    selectedTag = "",
    recommendationsReady = false;
  let feedbackTimer;
  const node = (tag, className = "", text = null) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== null) element.textContent = text;
    return element;
  };
  function savedIds() {
    try {
      const values = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return new Set(
        Array.isArray(values)
          ? values.filter((value) => (Number.isSafeInteger(value) && value > 0) ||
            (typeof value === "string" && /^igdb:[1-9][0-9]{0,9}$/.test(value)))
          : [],
      );
    } catch {
      return new Set();
    }
  }
  let saved = savedIds();
  const savedAliases = (game) => Array.isArray(game?.savedAliases)
    ? game.savedAliases : [game?.appid];
  const isSaved = (game) => savedAliases(game).some((id) => saved.has(id));
  function updateSaveControls() {
    const remaining = new Set(saved);
    let knownSaved = 0;
    for (const game of knownGames) {
      const aliases = savedAliases(game);
      if (!aliases.some((id) => remaining.has(id))) continue;
      knownSaved++;
      aliases.forEach((id) => remaining.delete(id));
    }
    document.querySelectorAll("[data-saved-count]").forEach((count) => {
      count.textContent = String(knownSaved + remaining.size);
    });
    if (!currentGame) return;
    const active = isSaved(currentGame);
    document.querySelectorAll("[data-game-save]").forEach((button) => {
      button.setAttribute("aria-pressed", String(active));
      button.setAttribute(
        "aria-label",
        `${active ? "取消收藏" : "收藏"} ${currentGame.name}`,
      );
      button.querySelector("[data-save-label]").textContent = active
        ? "已收藏"
        : "加入收藏";
    });
  }
  function toggleSave(event) {
    if (!currentGame) return;
    const game = currentGame;
    if (isSaved(game)) savedAliases(game).forEach((id) => saved.delete(id));
    else saved.add(game.appid);
    let message;
    try {
      localStorage.setItem(storageKey, JSON.stringify([...saved]));
      message = isSaved(game)
        ? `已把「${game.name}」加入收藏。`
        : `已取消收藏「${game.name}」。`;
    } catch {
      message = "本次收藏已變更；瀏覽器目前不允許永久儲存。";
    }
    $("gameSaveHint").textContent = message;
    $("gameSaveHint").classList.add("visible");
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(
      () => $("gameSaveHint").classList.remove("visible"),
      3500,
    );
    updateSaveControls();
    window.RadarEnhancements?.pulseSaved();
    if (window.RadarMotion?.enabled && event.currentTarget.animate)
      event.currentTarget.animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(1.06)" },
          { transform: "scale(1)" },
        ],
        { duration: 300 },
      );
  }
  document
    .querySelectorAll("[data-game-save]")
    .forEach((button) => button.addEventListener("click", toggleSave));
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey && event.key !== null) return;
    saved = savedIds();
    updateSaveControls();
  });
  function setStatus(title, message, retry = false) {
    $("detailRetry").hidden = !retry;
    $("detailPage").hidden = true;
    $("detailStatus").hidden = false;
    $("detailStatusTitle").textContent = title;
    $("detailStatusMessage").textContent = message;
    $("detailStatusBack").hidden = false;
  }
  function setBackLink() {
    try {
      const previous = new URL(document.referrer);
      if (previous.origin === location.origin && previous.pathname.endsWith("/game.html")) {
        const stored = JSON.parse(sessionStorage.getItem("game-trend-radar:return:v1") || "null");
        if (stored && Date.now() - stored.at < 3600000) {
          const destination = new URL(stored.path, location.href);
          if (destination.origin === location.origin && /\/(?:index|games|upcoming|released|saved|date|explore|growth|analysis)\.html$/.test(destination.pathname))
            $("gameBack").href = destination.pathname + destination.search;
        }
      }
      if (
        previous.origin === location.origin &&
        /\/(?:index|games|upcoming|released|saved|date|explore|growth|analysis)\.html$/.test(
          previous.pathname,
        )
      ) {
        $("gameBack").href =
          previous.pathname + previous.search + previous.hash;
      }
    } catch {
      /* Direct entry returns to the calendar. */
    }
  }
  function loadArtwork(img, game, onLoad, onExhausted) {
    window.RadarArtwork.load(img, game, {
      large: img.fetchPriority === "high", onLoad, onExhausted,
    });
  }
  function showArtwork(game) {
    const art = $("gameArt");
    const hint = $("artHint");
    const fallback = node("span", "cover-placeholder");
    fallback.setAttribute("aria-hidden", "true");
    const img = node("img");
    img.alt = `${game.name} 的遊戲封面`;
    img.loading = "eager";
    img.fetchPriority = "high";
    img.decoding = "async";
    img.width = 616;
    img.height = 353;
    art.disabled = true;
    art.setAttribute("aria-label", `放大 ${game.name} 的遊戲封面`);
    art.replaceChildren(fallback, img, hint);
    loadArtwork(
      img,
      game,
      () => {
        fallback.remove();
        art.disabled = false;
        hint.textContent = `${isNintendo(game) ? "IGDB" : "STEAM"} 遊戲封面 · 點一下看大圖`;
      },
      () => {
        img.remove();
        art.disabled = true;
        hint.textContent = "封面暫時無法載入";
      },
    );
  }
  let previousOverflow = "";
  $("gameArt").addEventListener("click", () => {
    const img = $("gameArt").querySelector("img");
    if (!img || !currentGame) return;
    window.RadarArtwork.load($("artDialogImage"), currentGame, { large: true });
    $("artDialogImage").alt = `${currentGame.name} 的遊戲封面大圖`;
    $("artDialogCaption").textContent = currentGame.name;
    previousOverflow = document.documentElement.style.overflow;
    $("artDialog").showModal();
    document.documentElement.style.overflow = "hidden";
  });
  $("closeArtwork").addEventListener("click", () => $("artDialog").close());
  $("artDialog").addEventListener("click", (event) => {
    if (event.target === $("artDialog")) $("artDialog").close();
  });
  $("artDialog").addEventListener("close", () => {
    document.documentElement.style.overflow = previousOverflow;
  });
  function relatedCard(game, basis) {
    const a = node("a", "game-related-link");
    a.href = detailURL(game);
    a.setAttribute("aria-label", `查看 ${game.name} 遊戲資訊`);
    const cover = node("div", "related-cover");
    const fallback = node("span", "cover-placeholder");
    fallback.setAttribute("aria-hidden", "true");
    cover.append(fallback);
    if (game.art) {
      const img = node("img");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      cover.append(img);
      loadArtwork(
        img,
        game,
        () => fallback.remove(),
        () => img.remove(),
      );
    }
    const copy = node("div", "game-related-copy");
    const title = node("strong", "", game.name);
    title.title = game.name;
    const tags = node("div", "match-tags");
    const shared = selectedTag
      ? [selectedTag, ...game.sharedTags.filter((tag) => R.key(tag) !== R.key(selectedTag))]
      : game.sharedTags;
    if (basis === "date") tags.append(node("span", "", "發售時間相近"));
    else
      for (const tag of shared.slice(0, 2)) {
        const badge = node("span", "", R.label(tag));
        badge.title = `共同 TAG：${tag}`;
        tags.append(badge);
      }
    const meta = node("div", "related-meta");
    const date = node("time", "", game.date.replaceAll("-", "/"));
    date.dateTime = game.date;
    meta.append(date, node("b", "", interestText(game)));
    const action = node("span", "related-action", "認識這款遊戲");
    const arrow = node("span", "", "↗");
    arrow.setAttribute("aria-hidden", "true");
    action.append(arrow);
    copy.append(title, tags, meta, action);
    a.append(cover, copy);
    return a;
  }
  function renderRelated(animate = false) {
    const result = R.recommendations(currentGame, candidates, selectedTag, 3);
    $("recommendationSummary").textContent = selectedTag
      ? `「${R.label(selectedTag)}」・${result.count} 款相近遊戲`
      : result.basis === "shared"
        ? `共同喜好，串起 ${result.count} 款新發現`
        : "發售日相近，也可以看看";
    $("tagExplore").href = R.url(selectedTag);
    $("tagExploreLabel").textContent = selectedTag
      ? `探索「${R.label(selectedTag)}」TAG`
      : "探索所有 TAG";
    const grid = $("gameRelatedGrid");
    grid.replaceChildren(
      ...result.games.map((game) => relatedCard(game, result.basis)),
    );
    if (!result.games.length) {
      const empty = node("div", "empty-state");
      empty.append(
        node("span", "empty-symbol", "◎"),
        node("h3", "", selectedTag ? "這個 TAG 還沒有其他相近遊戲" : "下一款新發現，正在路上"),
        node("p", "", selectedTag
          ? "換個 TAG 試試，或選「綜合推薦」看看其他新作。"
          : "目前沒有其他符合條件的遊戲，之後有新作就會出現在這裡。"),
      );
      grid.append(empty);
    }
    $("recommendationBasis").textContent = !result.games.length ? "" : result.basis === "date"
      ? "尚無共同 TAG 可供比對，改依發售日接近程度推薦。"
      : `${selectedTag ? `符合「${R.label(selectedTag)}」的遊戲，` : ""}依共同 TAG 數量排序，同分時優先發售日接近的遊戲。${result.count > result.games.length ? `先呈現 ${result.games.length} 款。` : ""}`;
    document.querySelectorAll(".game-tag-panel .tag-option").forEach((button) => {
      button.setAttribute("aria-pressed", String(R.key(button.dataset.tag) === R.key(selectedTag)));
      button.disabled = !recommendationsReady;
    });
    updateTagVisibility();
    if (animate && window.RadarMotion?.enabled && grid.animate) {
      grid.getAnimations?.().forEach((animation) => animation.cancel());
      grid.animate(
        [{ opacity: 0.55, transform: "translateY(7px)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: 220, easing: "ease-out" },
      );
    }
  }
  function selectTag(tag) {
    if (!recommendationsReady || selectedTag === tag) return;
    selectedTag = tag;
    renderRelated(true);
  }
  $("allRelatedTags").addEventListener("click", () => selectTag(""));
  function updateTagVisibility() {
    document.querySelectorAll("#gameTags button").forEach((button, index) => {
      button.hidden = !tagsExpanded && index >= 8 && button.dataset.tag !== selectedTag;
    });
    $("showTags").setAttribute("aria-expanded", String(tagsExpanded));
    $("showTags").textContent = tagsExpanded
      ? "收合 TAG −"
      : `展開全部 ${currentGame.tags.length} 個 TAG ＋`;
  }
  $("showTags").addEventListener("click", () => {
    tagsExpanded = !tagsExpanded;
    updateTagVisibility();
  });
  function tagLink(tag, className) {
    const link = node("a", className);
    link.href = R.url(tag);
    link.dataset.tag = tag;
    link.setAttribute("aria-label", `探索「${R.label(tag)}」遊戲`);
    link.title = tag;
    return link;
  }
  function setupTags(game) {
    $("gameTagPreview").hidden = !game.tags.length;
    $("gameIntro").hidden = false;
    $("heroTags").replaceChildren(
      ...game.tags.slice(0, 4).map((tag) => {
        const link = tagLink(tag, "hero-tag");
        const arrow = node("span", "", "↗");
        arrow.setAttribute("aria-hidden", "true");
        link.append(node("span", "", R.label(tag)), arrow);
        return link;
      }),
    );
    const counts = new Map(
      R.catalog(candidates.filter((row) => row.appid !== game.appid)).map((entry) => [R.key(entry.tag), entry.count]),
    );
    $("gameTags").replaceChildren(
      ...game.tags.map((tag) => {
        const count = counts.get(R.key(tag)) || 0;
        const button = node("button", "tag-option");
        button.type = "button";
        button.dataset.tag = tag;
        button.setAttribute("aria-controls", "gameRelatedGrid");
        button.setAttribute("aria-label", `預覽「${R.label(tag)}」的相近遊戲${recommendationsReady ? `，共 ${count} 款` : ""}`);
        button.append(node("span", "", R.label(tag)));
        if (recommendationsReady) {
          const total = node("small", "", `${count} 款`);
          total.setAttribute("aria-hidden", "true");
          button.append(total);
        }
        button.addEventListener("click", () => selectTag(tag));
        return button;
      }),
    );
    $("showTags").hidden = game.tags.length <= 8;
    $("tagsEmpty").hidden = game.tags.length > 0;
    if (!game.tags.length) $("gameJump").textContent = "看看其他新作 ↓";
    renderRelated();
  }
  function render(game, data, pending = false) {
    const unchangedArt = currentGame?.art === game.art && currentGame?.art2x === game.art2x;
    currentGame = game;
    const comparison = $("gameCompare");
    const nintendo = isNintendo(game);
    const nativeRelease = (game.dateReleases || game.releases || []).find((row) =>
      ["NS", "NS2"].includes(row.platform) && row.date === game.date,
    );
    const nativeDate = nintendo || (game.hasNintendo === true && !!nativeRelease &&
      !(game.releases || []).some((row) => row.platform === "Steam" && row.date === game.date));
    const dateRegion = nativeRelease?.region || game.dateRegion;
    document.body.dataset.gameSource = game.source || "steam";
    comparison.hidden = nintendo;
    if (nintendo) {
      delete comparison.dataset.compare;
      delete comparison.dataset.gameName;
      comparison.setAttribute("aria-pressed", "false");
    } else {
      comparison.dataset.compare = game.appid;
      comparison.dataset.gameName = game.name;
      comparison.setAttribute("aria-pressed", String(window.RadarCompare.ids().includes(game.appid)));
      comparison.textContent = window.RadarCompare.ids().includes(game.appid) ? "✓ 已加入比較" : "＋ 加入比較";
    }
    renderPlatforms(game);
    recommendationsReady = !pending;
    if (selectedTag && !R.hasTag(game, selectedTag)) selectedTag = "";
    knownGames = D.cardGames([...data.games, ...data.recent]);
    candidates = D.cardGames([
      ...data.games.filter((row) => row.date >= today),
      ...D.selectGames(data, "released", today),
    ]);
    const days = Math.round(
      (Date.parse(game.date + "T12:00:00Z") -
        Date.parse(today + "T12:00:00Z")) /
        86400000,
    );
    document.body.dataset.gameTheme = R.theme(game);
    $("gameTitle").textContent = game.name;
    $("gameEnglish").hidden = !game.nameEn || game.nameEn === game.name;
    $("gameEnglish").textContent = game.nameEn === game.name ? "" : game.nameEn;
    $("gameDescription").textContent = game.description || "繁體中文遊戲介紹整理中。";
    $("gameDescription").hidden = false;
    $("gameDescription").lang = "zh-Hant";
    $("descriptionSource").hidden = !game.description || game.descriptionSource !== "editorial_zh_tw";
    $("gameGenres").replaceChildren(
      node("small", "game-genres-label", "遊戲類型"),
      ...game.genres
        .slice(0, 4)
        .map((genre) => node("span", "", R.genreLabel(genre))),
    );
    $("gameGenres").hidden = !game.genres.length;
    renderLanguages(game);
    $("gameDate").textContent = game.date.replaceAll("-", "/");
    $("gameDate").dateTime = game.date;
    $("releaseMonth").textContent = `${Number(game.date.slice(5, 7))} 月`;
    $("releaseDay").textContent = game.date.slice(8);
    $("releaseYear").textContent = game.date.slice(0, 4);
    $("gameInterestLabel").textContent = nintendo ? "發售前的社群關注" : "已經有這麼多人關注";
    $("gameFollowers").textContent = nintendo
      ? Number.isSafeInteger(game.hypes) ? number.format(game.hypes) : "未知"
      : number.format(game.followers);
    $("gameInterestUnit").textContent = nintendo ? "次關注" : "人";
    $("gameInterestCaption").textContent = nintendo
      ? "IGDB hypes · 發售前關注數"
      : "Steam Followers · 非願望清單數";
    $("gameReleaseLabel").textContent = nativeDate
      ? `預定發售・${regionLabel(dateRegion)}`
      : "預定發售・台灣";
    $("gameReleaseNote").hidden = !nativeDate;
    const releaseEvidence = nativeRelease || { source: game.dateSource || "IGDB", region: dateRegion };
    $("gameReleaseNote").textContent = nativeDate
      ? `來源：${releaseSourceName(releaseEvidence)}。${releaseDateNote(releaseEvidence)}`
      : "";
    $("gameCountdown").textContent =
      days > 0
        ? `還有 ${days} 天，準備好出發。`
        : days === 0
          ? "預定今天上市"
          : "原定日期已過，請以商店為準";
    $("gameState").textContent =
      days > 0
        ? "值得期待的新作"
        : days === 0
          ? "預定今天登場"
          : "上市日期已過";
    $("gameAppId").textContent = nintendo ? `IGDB ID：${game.igdbId}` : `Steam AppID：${game.appid}`;
    const timestamp = new Date((nintendo ? game.updated : data.updated) || "");
    $("gameUpdated").textContent = Number.isFinite(timestamp.getTime())
      ? "資料更新 · " +
        new Intl.DateTimeFormat("zh-TW", {
          timeZone: "Asia/Taipei",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(timestamp) +
        "（台灣）"
      : nintendo ? "資料更新時間未提供" : "日期以台灣時間為準";
    const sourceURL = nintendo ? publicSourceURL(game.link) || `https://www.igdb.com/search?type=1&q=${encodeURIComponent(game.nameEn || game.name)}` : game.link;
    const sourceName = nintendo && /(?:^|\.)nintendo\./.test(new URL(sourceURL).hostname) ? "Nintendo 官網" : nintendo ? new URL(sourceURL).pathname === "/search" ? "IGDB 搜尋" : "IGDB 遊戲頁" : "Steam 商店";
    if (nintendo) game = { ...game, link: sourceURL };
    $("gameSteam").href = game.link;
    $("gameSteam").replaceChildren(node("span", "", `前往 ${sourceName}`), node("span", "", "↗"));
    $("gameSteamMobile").textContent = `${sourceName} ↗`;
    $("gameFootnote").textContent = nintendo
      ? "發售日期可能依平台、地區調整；平台與語言支援請以任天堂及發行商最新公告為準。IGDB hypes 屬遊戲整體的發售前關注數，並非單一平台玩家人數。"
      : game.hasNintendo === true
        ? "各平台發售日期可能不同；實際上市時間與語言支援請以各平台官方公告為準。各版本語言依各自官方來源顯示；卡片主要語言標籤為 Steam 版本。IGDB hypes 與 Steam Followers 分別呈現，不合併計算。"
      : "發售日期可能調整，實際上市時間與語言支援請以 Steam 商店公告為準。";
    document.querySelectorAll("[data-game-steam]").forEach((link) => {
      link.href = game.link;
      link.setAttribute(
        "aria-label",
        `在 ${sourceName}開啟 ${game.name}（另開分頁）`,
      );
    });
    document.title = `${game.name}｜遊戲資訊・Game Trend Radar`;
    if (!unchangedArt) showArtwork(game);
    updateSaveControls();
    setupTags(game);
    $("gameRelatedGrid").setAttribute("aria-busy", String(pending));
    if (pending) {
      $("recommendationSummary").textContent = "正在尋找相似遊戲…";
      $("gameRelatedGrid").replaceChildren(node("p", "related-loading", "相似遊戲載入中，已可查看封面與發售資訊。"));
      $("recommendationBasis").textContent = "";
    }
    $("detailStatus").hidden = true;
    $("detailPage").hidden = false;
  }
  function renderLanguages(game) {
    const nintendo = isNintendo(game);
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
    const platforms = (game.platforms || []).filter(code => ["NS", "NS2"].includes(code));
    $("nintendoLanguageSections").hidden = !platforms.length;
    $("gameLanguagePolicy").hidden = !platforms.length;
    $("nintendoLanguageSections").replaceChildren(...platforms.map(code => {
      const support = game.platformLanguages?.[code] || D.nintendoLanguageSupport();
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
    const nintendo = isNintendo(game);
    const supported = nintendo || game.hasNintendo === true;
    $("gamePlatforms").hidden = !supported;
    $("gamePlatforms").replaceChildren(
      ...(supported ? game.platformBadges || [] : []).map((badge) => {
        const chip = node("span", "game-platform-chip", badge.label);
        chip.title = badge.title || game.platformLabel || badge.label;
        return chip;
      }),
    );
    const editions = (game.platforms || []).filter(code => ["NS", "NS2"].includes(code))
      .map(code => ({ code, edition: game.platformEditions?.[code] }))
      .filter(({ edition }) => edition?.label && edition.title && publicSourceURL(edition.source_url));
    for (const { code, edition } of editions) {
      const chip = node("span", "game-platform-chip game-edition-chip", `${code} ${edition.label}`);
      chip.title = `${edition.title} · ${regionLabel(edition.region)}版本`;
      $("gamePlatforms").append(chip);
    }
    $("gamePlatformSupport").hidden = !supported;
    if (!supported) return;
    $("gamePlatformLabel").textContent = game.platformLabel || "平台資訊待確認";
    $("gamePlatformNote").textContent = [...new Set((game.platformBadges || []).map(badge => badge.title).filter(Boolean))].join(" ");
    if (!nintendo && Number.isSafeInteger(game.hypes))
      $("gamePlatformNote").append(node("span", "", ` IGDB hypes ${number.format(game.hypes)}（遊戲整體關注數，與 Steam Followers 分開計算）。`));
    const rows = Array.isArray(game.releases) ? game.releases : [];
    const seen = new Set();
    const dates = rows.filter((row) => {
      if (!row || !["NS", "NS2", "Steam"].includes(row.platform) || row.precision !== "day" || !D.validDate(row.date)) return false;
      const key = `${row.platform}|${row.date}|${row.region || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform));
    $("gamePlatformDates").replaceChildren(...dates.map(row => {
      const item = node("li", "", `${row.platform} · ${row.date.replaceAll("-", "/")} · ${row.platform === "Steam" ? "台灣" : regionLabel(row.region)}`);
      item.dataset.platform = row.platform;
      if (row.platform === "Steam") {
        item.append(node("p", "game-release-edition-label game-release-steam-version", "Steam 版本"));
        return item;
      }
      const evidence = node("div", "game-release-source");
      const sourceURL = taiwanOfficialRelease(row) ? publicSourceURL(row.official_source_url) : publicSourceURL(row.source);
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
        const link = node("a", "", "Nintendo 官方商品頁 ↗");
        link.href = publicSourceURL(edition.source_url);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        origin.append(node("span", "", `版本資料：${regionLabel(edition.region)}版本 · `), link);
        version.append(origin);
        const contentNote = edition.type === "deluxe"
          ? "此平台發售的是上述 Deluxe 版本。"
          : "此平台發售的是包含本體與追加內容的版本。";
        version.append(node("p", "game-release-edition-note", `${contentNote}發售日期對應上述版本與內容組合。${edition.region === "taiwan" ? "版本內容依台灣官方商品頁確認。" : "版本內容依此地區商品頁確認；台灣販售版本是否相同仍待確認。"}`));
        item.append(version);
      }
      return item;
    }));
    $("gamePlatformDates").hidden = !dates.length;
  }
  async function loadNintendoDetail(force) {
    let catalog = null, preview = null, nintendo = null, sourcesDone = false, shown = false;
    function present() {
      if (!nintendo) return;
      const data = D.datasets(catalog, preview, nintendo);
      if (!data) return;
      const enriched = R.enrich(data, catalog, preview);
      const matches = [...enriched.games, ...enriched.recent].filter(entry =>
        (entry.igdbId === igdbId || entry.igdbIds?.includes(igdbId)) &&
        (!requestedDate || entry.date === requestedDate),
      );
      const game = matches.find(entry => entry.date >= today) || matches[0];
      if (!game) return;
      render(game, enriched, !sourcesDone);
      shown = true;
    }
    try {
      await Promise.all([
        window.RadarStorage.loadNintendo({ force }).then(result => { nintendo = result; present(); }),
        window.RadarStorage.loadSources({ force }).then(result => {
          catalog = result.catalog; preview = result.preview; sourcesDone = true; present();
        }),
      ]);
      if (!shown) setStatus(nintendo ? "這款遊戲目前不在公開清單中" : "Nintendo 遊戲資料暫時無法讀取",
        nintendo ? "可能已調整平台、發售日期或未達收錄條件；請返回月曆看看其他遊戲。" : "請稍後再試，或返回遊戲清單。", !nintendo);
    } catch (error) {
      console.error("Unable to display Nintendo profile", error);
      if (!shown) setStatus("Nintendo 遊戲資訊暫時無法呈現", "請稍後再試，或返回遊戲清單。", true);
    }
  }
  async function main(force = false) {
    updateSaveControls();
    setBackLink();
    if (nintendoRoute) {
      if (!igdbId || (requestedDate !== null && !D.validDate(requestedDate))) {
        setStatus("找不到這款遊戲", "連結沒有有效的 IGDB ID 或發售日期，請返回遊戲清單重新選擇。");
        return;
      }
      await loadNintendoDetail(force);
      return;
    }
    if (!appid || (requestedDate !== null && !D.validDate(requestedDate))) {
      setStatus("找不到這款遊戲", "連結沒有有效的 Steam AppID 或發售日期，請返回遊戲清單重新選擇。");
      return;
    }
    let rawGame = null, catalog = null, preview = null, nintendo = null;
    let catalogDone = false, shown = false;
    function present() {
      if (!rawGame && !catalog && !preview) return;
      const rows = catalog?.games || [];
      const official = rawGame ? {
        ...(catalog || {}),
        generated_at: catalog?.generated_at || rawGame.content_enriched_at || rawGame.follower_checked_at,
        games: [{ ...rows.find(row => Number(row.appid) === appid), ...rawGame },
          ...rows.filter(row => Number(row.appid) !== appid)]
      } : catalog;
      const data = R.enrich(D.datasets(official, preview, nintendo), official, preview);
      const matches = [...data.games, ...data.recent].filter(entry =>
        entry.appid === appid && (!requestedDate || entry.date === requestedDate),
      );
      const game = matches.find(entry => entry.dateReleases?.some(row => row.platform === "Steam")) || matches[0];
      if (!game) return;
      render(game, data, !catalogDone);
      shown = true;
      if (catalogDone && !catalog && !preview) {
        $("recommendationSummary").textContent = "相似遊戲暫時無法讀取";
        $("gameRelatedGrid").replaceChildren(node("p", "related-loading", "這款遊戲仍可正常查看，稍後重新整理再試。"));
        $("recommendationBasis").textContent = "";
      }
    }
    try {
      // Independent requests: the hero does not wait for the whole catalog.
      await Promise.all([
        window.RadarStorage.loadGame(appid, { force }).then(record => { rawGame = record; present(); }),
        window.RadarStorage.loadSources({ force }).then(result => {
          catalog = result.catalog; preview = result.preview; catalogDone = true; present();
        }),
        window.RadarStorage.loadNintendo({ force }).then(result => { nintendo = result; present(); })
          .catch(() => { /* Optional platform data must not block the Steam profile. */ }),
      ]);
      if (!shown) {
        if (!rawGame && !catalog && !preview)
          setStatus("遊戲資料暫時無法讀取", "請稍後再試，或返回遊戲清單。", true);
        else
          setStatus("這款遊戲目前不在公開清單中", "可能已調整發售日期或未達收錄條件；你仍可返回月曆看看其他遊戲。");
      }
    } catch (error) {
      console.error("Unable to display game profile", error);
      if (!shown) setStatus("遊戲資訊暫時無法呈現", "請稍後再試，或返回遊戲清單。", true);
    }
  }
  $("detailRetry").addEventListener("click", async () => {
    $("detailRetry").disabled = true;
    $("detailStatusTitle").textContent = "正在重新讀取…";
    try {
      await main(true);
    } finally {
      $("detailRetry").disabled = false;
    }
  });
  main();
})();
