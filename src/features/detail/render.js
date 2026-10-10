export function createDetailRenderer(ctx, policy, release, metadata, artwork, favorites, related) {
  const { $, node, D, R, state, today, number, isNativeConsole, document } = ctx;
  const { publicSourceURL } = policy;
  const { releaseDays, renderReleaseDates } = release;
  const { renderLanguages, renderPlatforms } = metadata;
  const { showArtwork } = artwork;
  const { updateSaveControls } = favorites;
  const { setupTags } = related;
  function render(game, data, pending = false) {
    const unchangedArt = state.currentGame?.art === game.art && state.currentGame?.art2x === game.art2x;
    state.currentGame = game;
    const nintendo = isNativeConsole(game);
    const displayNames = D.releaseDisplayNames(game);
    document.body.dataset.gameSource = game.source || "steam";
    renderPlatforms(game);
    state.recommendationsReady = !pending;
    if (state.selectedTag && !R.hasTag(game, state.selectedTag)) state.selectedTag = "";
    state.knownGames = D.cardGames([...data.games, ...data.recent]);
    state.candidates = D.cardGames([
      ...data.games.filter((row) => row.date >= today),
      ...D.selectGames(data, "released", today),
    ]);
    const days = releaseDays(game.date);
    document.body.dataset.gameTheme = R.theme(game);
    $("gameTitle").textContent = displayNames.name;
    $("gameEnglish").hidden = !displayNames.nameEn || displayNames.nameEn === displayNames.name;
    $("gameEnglish").textContent = displayNames.nameEn === displayNames.name ? "" : displayNames.nameEn;
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
    renderReleaseDates(game);
    const followersKnown = Number.isSafeInteger(game.followers);
    $("gameInterestLabel").textContent = nintendo ? "發售前的社群關注" : followersKnown ? "已經有這麼多人關注" : "Steam 關注數";
    $("gameFollowers").textContent = nintendo
      ? Number.isSafeInteger(game.hypes) ? number.format(game.hypes) : "未知"
      : followersKnown ? number.format(game.followers) : "未取得";
    $("gameInterestUnit").textContent = nintendo ? "次關注" : followersKnown ? "人" : "";
    $("gameInterestCaption").textContent = nintendo
      ? "IGDB hypes · 發售前關注數"
      : `${followersKnown ? "Steam Followers · 非願望清單數" : "本次未取得 GroupID"}${game.twitchAdmission ? " · 收錄依據 Twitch" : ""}`;
    const evidence = game.twitchAdmission?.source_enrollment;
    $("gameInterestCaption").title = evidence
      ? `Twitch 分類 ${game.twitchAdmission.twitch_game_id} · ${number.format(evidence.viewer_count)} 人觀看 · 達標時間 ${evidence.observed_at}` : "";
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
    const sourceName = !nintendo ? "Steam 商店" : new URL(sourceURL).hostname === "store.playstation.com"
      ? "PlayStation 商店" : /(?:^|\.)playstation\.com$/.test(new URL(sourceURL).hostname)
        ? "PlayStation 官網" : /(?:^|\.)nintendo\./.test(new URL(sourceURL).hostname)
          ? "Nintendo 官網" : new URL(sourceURL).pathname === "/search" ? "IGDB 搜尋" : "IGDB 遊戲頁";
    if (nintendo) game = { ...game, link: sourceURL };
    $("gameSteam").href = game.link;
    $("gameSteam").replaceChildren(node("span", "", `前往 ${sourceName}`), node("span", "", "↗"));
    $("gameSteamMobile").textContent = `${sourceName} ↗`;
    $("gameFootnote").textContent = nintendo
      ? "發售日期可能依平台、地區調整；平台與語言支援請以各平台官方及發行商最新公告為準。IGDB hypes 屬遊戲整體的發售前關注數，並非單一平台玩家人數。"
      : game.hasNativePlatforms === true || game.hasNintendo === true
        ? "各平台發售日期可能不同；實際上市時間與語言支援請以各平台官方公告為準。各版本語言依各自官方來源顯示；卡片主要語言標籤為 Steam 版本。IGDB hypes 與 Steam Followers 分別呈現，不合併計算。"
      : "發售日期可能調整，實際上市時間與語言支援請以 Steam 商店公告為準。";
    document.querySelectorAll("[data-game-steam]").forEach((link) => {
      link.href = game.link;
      link.setAttribute(
        "aria-label",
        `在 ${sourceName}開啟 ${game.name}（另開分頁）`,
      );
    });
    document.title = `${displayNames.name}｜遊戲資訊・Game Trend Radar`;
    if (!unchangedArt) showArtwork(game);
    updateSaveControls();
    setupTags(game);
    $("gameRelatedGrid").setAttribute("aria-busy", String(pending));
    if (pending) {
      $("recommendationSummary").textContent = "正在尋找相似遊戲…";
      related.showMessage("相似遊戲載入中，已可查看封面與發售資訊。");
      $("recommendationBasis").textContent = "";
    }
    $("detailStatus").hidden = true;
    $("detailPage").hidden = false;
  }
  return render;
}
