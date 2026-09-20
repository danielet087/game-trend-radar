/* Standalone static game profile. Existing public JSON is the source of truth. */
(() => {
  "use strict";
  const D = window.RadarData;
  const $ = (id) => document.getElementById(id);
  const storageKey = "game-trend-radar:saved:v1";
  const number = new Intl.NumberFormat("zh-TW");
  const query = new URLSearchParams(location.search);
  const appidText = query.get("appid") || "";
  const appid = /^[1-9][0-9]{0,9}$/.test(appidText) ? Number(appidText) : null;

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
  function updateSavedCount() {
    document.querySelectorAll("[data-saved-count]").forEach((count) => {
      count.textContent = String(saved.size);
    });
  }
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
        /\/(?:index|upcoming|released|saved|date)\.html$/.test(
          previous.pathname,
        )
      ) {
        $("gameBack").href =
          previous.pathname + previous.search + previous.hash;
      }
    } catch {
      /* Direct entry stays linked to the public home calendar. */
    }
  }
  function updateSaveButton(game) {
    const active = saved.has(game.appid);
    $("gameSave").setAttribute("aria-pressed", String(active));
    $("gameSave").setAttribute(
      "aria-label",
      active ? `取消收藏 ${game.name}` : `收藏 ${game.name}`,
    );
    $("gameSaveLabel").textContent = active ? "已收藏" : "加入收藏";
    updateSavedCount();
  }
  function bindSave(game) {
    updateSaveButton(game);
    $("gameSave").addEventListener("click", () => {
      if (saved.has(game.appid)) saved.delete(game.appid);
      else saved.add(game.appid);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...saved]));
        $("gameSaveHint").textContent = saved.has(game.appid)
          ? "已加入我的收藏。下次來訪也能在收藏清單找到它。"
          : "已從我的收藏移除。";
      } catch {
        $("gameSaveHint").textContent =
          "本次收藏已變更；瀏覽器目前不允許永久儲存。";
      }
      updateSaveButton(game);
      if (window.RadarMotion?.enabled && $("gameSave").animate) {
        $("gameSave").animate(
          [
            { transform: "scale(1)" },
            { transform: "scale(1.06)" },
            { transform: "scale(1)" },
          ],
          { duration: 300 },
        );
      }
    });
    window.addEventListener("storage", (event) => {
      if (event.key !== storageKey && event.key !== null) return;
      saved = savedIds();
      updateSaveButton(game);
    });
  }
  function showArtwork(game) {
    const art = $("gameArt");
    const sources = game.artSources || (game.art ? [game.art] : []);
    const img = document.createElement("img");
    img.alt = `${game.name} 的 Steam 遊戲封面`;
    img.decoding = "async";
    const fallback = document.createElement("span");
    fallback.className = "cover-placeholder";
    fallback.setAttribute("aria-label", "暫無遊戲封面");
    art.prepend(fallback);
    img.addEventListener("load", () => fallback.remove());
    let index = 0;
    const next = () => {
      if (index >= sources.length) {
        img.remove();
        art.prepend(fallback);
        return;
      }
      img.src = sources[index++];
    };
    img.addEventListener("error", next);
    if (sources.length) {
      art.prepend(img);
      next();
    } else {
      art.prepend(fallback);
    }
  }
  function renderRelated(game, data) {
    const picks = [...data.games, ...data.recent]
      .filter((row) => row.appid !== game.appid)
      .sort(
        (a, b) =>
          Math.abs(Date.parse(a.date) - Date.parse(game.date)) -
            Math.abs(Date.parse(b.date) - Date.parse(game.date)) ||
          b.followers - a.followers,
      )
      .slice(0, 3);
    if (!picks.length) return;
    const grid = $("gameRelatedGrid");
    for (const nearby of picks) {
      const a = document.createElement("a");
      a.className = "game-related-link";
      a.href = `./game.html?appid=${nearby.appid}`;
      a.setAttribute("aria-label", `查看 ${nearby.name} 遊戲資訊`);
      if (nearby.art) {
        const img = document.createElement("img");
        img.src = nearby.art;
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener(
          "error",
          () => {
            img.remove();
            a.classList.add("art-unavailable");
          },
          { once: true },
        );
        a.append(img);
      } else {
        a.classList.add("art-unavailable");
      }
      const copy = document.createElement("div");
      copy.className = "game-related-copy";
      const title = document.createElement("strong");
      title.textContent = nearby.name;
      const date = document.createElement("span");
      date.textContent = `${nearby.date.replaceAll("-", "/")} · ${number.format(nearby.followers)} 人關注`;
      copy.append(title, date);
      a.append(copy);
      grid.append(a);
    }
    $("gameRelated").hidden = false;
  }
  function renderAbout(metadata) {
    const labels = (values) =>
      Array.isArray(values)
        ? [
            ...new Set(
              values
                .map((value) =>
                  typeof value === "string"
                    ? value
                    : value?.description || value?.name || "",
                )
                .filter((value) => typeof value === "string" && value.trim())
                .map((value) => value.trim()),
            ),
          ].slice(0, 20)
        : [];
    const genreNames = {
      Action: "動作",
      Adventure: "冒險",
      RPG: "角色扮演",
      Strategy: "策略",
      Simulation: "模擬",
      Casual: "休閒",
      Indie: "獨立製作",
      Racing: "競速",
      Sports: "運動",
      "Early Access": "搶先體驗",
      "Free To Play": "免費遊玩",
      "Massively Multiplayer": "大型多人連線",
    };
    const description =
      typeof metadata?.short_description === "string"
        ? metadata.short_description.trim()
        : "";
    const genres = labels(metadata?.genres);
    const tags = labels(metadata?.tags);
    $("gameDescription").textContent = description;
    $("gameDescription").hidden = !description;
    for (const [id, values, translate] of [
      ["gameGenres", genres, true],
      ["gameTags", tags, false],
    ]) {
      $(id).replaceChildren(
        ...values.map((value) => {
          const tag = document.createElement("span");
          tag.textContent = translate ? genreNames[value] || value : value;
          return tag;
        }),
      );
      $(id).hidden = !values.length;
    }
    $("gameAbout").hidden = !description && !genres.length && !tags.length;
  }
  function render(game, data) {
    const today = D.todayInTaipei();
    const days = Math.round(
      (Date.parse(game.date + "T12:00:00Z") -
        Date.parse(today + "T12:00:00Z")) /
        86400000,
    );
    $("gameTitle").textContent = game.name;
    $("gameEnglish").hidden = !game.nameEn || game.nameEn === game.name;
    $("gameEnglish").textContent = game.nameEn === game.name ? "" : game.nameEn;
    const languagePill = $("gameLanguagePill");
    const languageBadges = $("gameLanguageBadge");
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
    languagePill.replaceChildren();
    languageBadges.replaceChildren();
    for (const badge of game.languageBadges) {
      const pill = document.createElement("span");
      pill.className = `game-language-kicker language-${badge.status}`;
      pill.textContent = badge.label;
      languagePill.append(pill);
      const chip = document.createElement("span");
      chip.className = `game-language-chip language-${badge.status}`;
      chip.textContent = badge.label;
      languageBadges.append(chip);
    }
    const bothChinese =
      game.languages?.tchinese === true && game.languages?.schinese === true;
    $("gameLanguageLine").dataset.language = game.languageStatus;
    $("gameLanguageDescription").textContent = bothChinese
      ? "Steam 商店標示同時支援繁中與簡中。遊戲名稱優先使用 Steam 公布的繁中版本（如有）。"
      : game.languageStatus === "traditional"
        ? "Steam 商店標示支援繁中；名稱優先使用 Steam 官方繁中版本（如有）。"
        : game.languageStatus === "simplified"
          ? "Steam 商店標示支援簡中；名稱優先使用 Steam 官方簡中版本（如有）。"
          : game.languageStatus === "english"
            ? "Steam 商店未標示支援繁中或簡中，但有支援英文。"
            : game.languageStatus === "other"
              ? "Steam 商店未標示支援繁中、簡中或英文；顯示商店公布的其他支援語言。"
              : "Steam 尚未提供足以確認的語言資訊；請以官方商店語言表為準。";
    $("gameDate").textContent = game.date.replaceAll("-", "/");
    $("gameFollowers").textContent = number.format(game.followers);
    $("gameAppId").textContent = `Steam AppID：${game.appid}`;
    $("gameCountdown").textContent =
      days > 0
        ? `距離預定上市還有 ${days} 天`
        : days === 0
          ? "預定今天上市"
          : "原定上市日期已過，請以商店為準";
    $("gameState").textContent =
      days > 0
        ? `${days} 天後登場`
        : days === 0
          ? "預定今天登場"
          : "上市日期已過";
    $("gameSteam").href = game.link;
    $("gameSteam").setAttribute(
      "aria-label",
      `在 Steam 商店開啟 ${game.name}（另開分頁）`,
    );
    document.title = `${game.name}｜遊戲資訊・Game Trend Radar`;
    showArtwork(game);
    bindSave(game);
    renderRelated(game, data);
    $("detailStatus").hidden = true;
    $("detailPage").hidden = false;
  }
  async function readJSON(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(
        `${path}?t=${Math.floor(Date.now() / 300000)}`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!response.ok) return null;
      const data = await response.json();
      return data && Array.isArray(data.games) ? data : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  async function main() {
    updateSavedCount();
    setBackLink();
    if (!appid) {
      setStatus(
        "找不到這款遊戲",
        "連結沒有有效的 Steam AppID，請返回遊戲清單重新選擇。",
      );
      return;
    }
    const [official, preview] = await Promise.all([
      readJSON("./data/steam_upcoming.json"),
      readJSON("./data/steam_preview.json"),
    ]);
    if (!official && !preview) {
      setStatus("遊戲資料暫時無法讀取", "請稍後再試，或返回遊戲清單。", true);
      return;
    }
    try {
      const data = D.datasets(official, preview);
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
      const published = official || preview;
      const metadata = [
        ...(published.games || []),
        ...(preview?.recent_games || []),
      ].find((row) => Number(row?.appid) === game.appid);
      renderAbout(metadata);
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
