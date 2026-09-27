/* A static game spotlight and tag discovery. Only existing public JSON is read. */
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
  const today = D.todayInTaipei();
  let currentGame = null,
    candidates = [],
    selectedTag = "",
    tagsExpanded = false;
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
          ? values.filter((value) => Number.isSafeInteger(value) && value > 0)
          : [],
      );
    } catch {
      return new Set();
    }
  }
  let saved = savedIds();
  function updateSaveControls() {
    document.querySelectorAll("[data-saved-count]").forEach((count) => {
      count.textContent = String(saved.size);
    });
    if (!currentGame) return;
    const active = saved.has(currentGame.appid);
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
    if (saved.has(game.appid)) saved.delete(game.appid);
    else saved.add(game.appid);
    let message;
    try {
      localStorage.setItem(storageKey, JSON.stringify([...saved]));
      message = saved.has(game.appid)
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
      if (
        previous.origin === location.origin &&
        /\/(?:index|upcoming|released|saved|date|explore)\.html$/.test(
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
    const sources = game.artSources || (game.art ? [game.art] : []);
    let index = 0;
    const next = () => {
      if (index >= sources.length) {
        onExhausted();
        return;
      }
      img.src = sources[index++];
    };
    img.addEventListener("error", next);
    img.addEventListener("load", onLoad, { once: true });
    next();
  }
  function showArtwork(game) {
    const art = $("gameArt");
    const hint = $("artHint");
    const fallback = node("span", "cover-placeholder");
    fallback.setAttribute("aria-hidden", "true");
    const img = node("img");
    img.alt = `${game.name} 的 Steam 遊戲封面`;
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
        hint.textContent = "STEAM 遊戲封面 · 點一下看大圖";
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
    $("artDialogImage").src = img.currentSrc || img.src;
    $("artDialogImage").alt = `${currentGame.name} 的 Steam 遊戲封面大圖`;
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
    a.href = `./game.html?appid=${game.appid}`;
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
    const shared = [...game.sharedTags].sort(
      (a, b) =>
        Number(R.key(b) === R.key(selectedTag)) -
        Number(R.key(a) === R.key(selectedTag)),
    );
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
    meta.append(date, node("b", "", `${number.format(game.followers)} 人關注`));
    const action = node("span", "related-action", "認識這款遊戲");
    const arrow = node("span", "", "↗");
    arrow.setAttribute("aria-hidden", "true");
    action.append(arrow);
    copy.append(title, tags, meta, action);
    a.append(cover, copy);
    return a;
  }
  function renderRelated(animate = false) {
    const result = R.recommendations(currentGame, candidates, selectedTag);
    $("allSimilar").setAttribute("aria-pressed", String(!selectedTag));
    document
      .querySelectorAll("#gameTags button, #heroTags button")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(R.key(button.dataset.tag) === R.key(selectedTag)),
        ),
      );
    $("recommendationSummary").textContent = selectedTag
      ? `${R.label(selectedTag)} · 找到 ${result.count} 款其他遊戲`
      : result.basis === "shared"
        ? `共同喜好，串起 ${result.count} 款新發現`
        : "發售日相近，也可以看看";
    $("tagExplore").href = R.url(selectedTag);
    $("tagExplore").textContent = selectedTag
      ? `探索「${R.label(selectedTag)}」↗`
      : "看更多新作 ↗";
    const grid = $("gameRelatedGrid");
    grid.replaceChildren(
      ...result.games.map((game) => relatedCard(game, result.basis)),
    );
    if (!result.games.length) {
      const empty = node("div", "empty-state");
      empty.append(
        node("span", "empty-symbol", "◎"),
        node(
          "h3",
          "",
          selectedTag ? "這個喜好，還在等待下一款" : "下一款新發現，正在路上",
        ),
        node(
          "p",
          "",
          selectedTag
            ? `目前沒有其他已收錄的「${R.label(selectedTag)}」遊戲，試試另一個 TAG。`
            : "目前沒有其他符合條件的遊戲，之後有新作就會出現在這裡。",
        ),
      );
      if (selectedTag) {
        const reset = node("button", "button secondary", "看看其他相近遊戲");
        reset.type = "button";
        reset.addEventListener("click", () => {
          selectTag("");
          $("allSimilar").focus();
        });
        empty.append(reset);
      }
      grid.append(empty);
    }
    $("recommendationBasis").textContent =
      result.basis === "date"
        ? "尚無共同 TAG 可供比對，改依發售日接近程度推薦。"
        : `依共同 TAG 數量排序，同分時優先發售日接近的遊戲。${result.count > result.games.length ? `先呈現 ${result.games.length} 款。` : ""}`;
    updateTagVisibility();
    if (animate && window.RadarMotion?.enabled && grid.animate)
      grid.animate(
        [
          { opacity: 0.3, transform: "translateY(8px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 240, easing: "ease-out" },
      );
  }
  function updateTagVisibility() {
    document.querySelectorAll("#gameTags button").forEach((button, index) => {
      button.hidden =
        !tagsExpanded &&
        index >= 8 &&
        R.key(button.dataset.tag) !== R.key(selectedTag);
    });
    $("showTags").setAttribute("aria-expanded", String(tagsExpanded));
    $("showTags").textContent = tagsExpanded
      ? "收合 TAG −"
      : `展開全部 ${currentGame.tags.length} 個 TAG ＋`;
  }
  function selectTag(tag) {
    selectedTag = tag;
    const url = new URL(location.href);
    if (tag) url.searchParams.set("tag", tag);
    else url.searchParams.delete("tag");
    history.replaceState(null, "", url);
    renderRelated(true);
  }
  $("allSimilar").addEventListener("click", () => selectTag(""));
  $("showTags").addEventListener("click", () => {
    tagsExpanded = !tagsExpanded;
    updateTagVisibility();
  });
  function setupTags(game) {
    selectedTag =
      game.tags.find((tag) => R.key(tag) === R.key(query.get("tag"))) || "";
    tagsExpanded = game.tags.findIndex((tag) => tag === selectedTag) >= 8;
    $("gameTagPreview").hidden = !game.tags.length;
    $("gameIntro").hidden = !game.tags.length && !game.description;
    $("heroTags").replaceChildren(
      ...game.tags.slice(0, 4).map((tag) => {
        const button = node("button", "hero-tag");
        button.type = "button";
        button.dataset.tag = tag;
        button.setAttribute("aria-label", `用 ${R.label(tag)} 找相似遊戲`);
        button.setAttribute("aria-controls", "gameRelatedGrid");
        button.title = tag;
        const arrow = node("span", "", "↘");
        arrow.setAttribute("aria-hidden", "true");
        button.append(node("span", "", R.label(tag)), arrow);
        button.addEventListener("click", () => {
          selectTag(tag);
          const target = [...$("gameTags").querySelectorAll("button")].find(
            (entry) => entry.dataset.tag === tag,
          );
          target?.focus({ preventScroll: true });
          $("gameDiscovery").scrollIntoView({
            behavior: window.RadarMotion?.enabled ? "smooth" : "auto",
            block: "start",
          });
        });
        return button;
      }),
    );
    const counts = new Map(
      R.catalog(candidates.filter((row) => row.appid !== game.appid)).map(
        (entry) => [R.key(entry.tag), entry.count],
      ),
    );
    $("gameTags").replaceChildren(
      ...game.tags.map((tag) => {
        const count = counts.get(R.key(tag)) || 0;
        const button = node("button", "tag-option");
        button.type = "button";
        button.dataset.tag = tag;
        button.setAttribute("aria-pressed", "false");
        button.setAttribute(
          "aria-label",
          `${R.label(tag)}，${count} 款其他遊戲`,
        );
        button.title = tag;
        const total = node("small", "", String(count));
        total.setAttribute("aria-hidden", "true");
        button.append(node("span", "", R.label(tag)), total);
        button.addEventListener("click", () =>
          selectTag(R.key(selectedTag) === R.key(tag) ? "" : tag),
        );
        return button;
      }),
    );
    $("showTags").hidden = game.tags.length <= 8;
    $("tagsEmpty").hidden = game.tags.length > 0;
    if (!game.tags.length) $("gameJump").textContent = "看看其他新作 ↓";
    renderRelated();
  }
  function render(game, data) {
    currentGame = game;
    candidates = D.unique([
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
    $("gameDescription").textContent = game.description;
    $("gameDescription").hidden = !game.description;
    $("gameGenres").replaceChildren(
      ...game.genres
        .slice(0, 4)
        .map((genre) => node("span", "", R.label(genre))),
    );
    $("gameGenres").hidden = !game.genres.length;
    $("gameLanguageBadge").replaceChildren(
      ...game.languageBadges.map((badge) =>
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
    $("gameLanguageDescription").textContent = bothChinese
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
    $("gameDate").textContent = game.date.replaceAll("-", "/");
    $("gameDate").dateTime = game.date;
    $("releaseMonth").textContent = `${Number(game.date.slice(5, 7))} 月`;
    $("releaseDay").textContent = game.date.slice(8);
    $("releaseYear").textContent = game.date.slice(0, 4);
    $("gameFollowers").textContent = number.format(game.followers);
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
    $("gameAppId").textContent = `Steam AppID：${game.appid}`;
    const timestamp = new Date(data.updated || "");
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
      : "日期以台灣時間為準";
    $("gameSteam").href = game.link;
    document.querySelectorAll("[data-game-steam]").forEach((link) => {
      link.href = game.link;
      link.setAttribute(
        "aria-label",
        `在 Steam 商店開啟 ${game.name}（另開分頁）`,
      );
    });
    document.title = `${game.name}｜遊戲資訊・Game Trend Radar`;
    showArtwork(game);
    updateSaveControls();
    setupTags(game);
    $("detailStatus").hidden = true;
    $("detailPage").hidden = false;
  }
  const LIVE_DATA_ROOT =
    "https://raw.githubusercontent.com/danielet087/game-trend-radar/main/data/";
  async function readJSON(path) {
    const filename = path.startsWith("./data/") ? path.slice(7) : "";
    const sources = filename ? [LIVE_DATA_ROOT + filename, path] : [path];
    for (const source of sources) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const separator = source.includes("?") ? "&" : "?";
        const response = await fetch(`${source}${separator}t=${Date.now()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) continue;
        const data = await response.json();
        if (data && Array.isArray(data.games)) return data;
      } catch {
        /* Try the next source. The Pages copy is the offline fallback. */
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }
  async function main() {
    updateSaveControls();
    setBackLink();
    if (!appid) {
      setStatus(
        "找不到這款遊戲",
        "連結沒有有效的 Steam AppID，請返回遊戲清單重新選擇。",
      );
      return;
    }
    const [rawGame, catalog, preview] = await Promise.all([
      window.RadarStorage?.loadGame?.(appid) || Promise.resolve(null),
      window.RadarStorage?.loadCatalog?.() ||
        readJSON("./data/steam_upcoming.json"),
      readJSON("./data/steam_preview.json"),
    ]);
    if (!rawGame && !catalog && !preview) {
      setStatus("遊戲資料暫時無法讀取", "請稍後再試，或返回遊戲清單。", true);
      return;
    }
    try {
      // Preserve the current AppID/month storage flow, with the detailed
      // record taking precedence and missing metadata inherited from its shard.
      const catalogRows = catalog?.games || [];
      const official = rawGame
        ? {
            ...(catalog || {}),
            games: [
              {
                ...catalogRows.find((row) => Number(row.appid) === appid),
                ...rawGame,
              },
              ...catalogRows.filter((row) => Number(row.appid) !== appid),
            ],
          }
        : catalog;
      const data = R.enrich(D.datasets(official, preview), official, preview);
      const game = [...data.games, ...data.recent].find(
        (entry) => entry.appid === appid,
      );
      if (!game) {
        setStatus(
          "這款遊戲目前不在公開清單中",
          "可能已調整發售日期或未達收錄條件；你仍可返回月曆看看其他遊戲。",
        );
        return;
      }
      render(game, data);
    } catch (error) {
      console.error("Unable to display game profile", error);
      setStatus("遊戲資訊暫時無法呈現", "請稍後再試，或返回遊戲清單。", true);
    }
  }
  $("detailRetry").addEventListener("click", async () => {
    $("detailRetry").disabled = true;
    $("detailStatusTitle").textContent = "正在重新讀取…";
    try {
      await main();
    } finally {
      $("detailRetry").disabled = false;
    }
  });
  main();
})();
