import { renderDescriptionSource } from '../../domain/descriptions.mjs';
import { hasChineseName } from './overview.js';
import { consoleMedia } from './media.js';

// Long descriptions (console summaries) open as four lines with a toggle.
const CLAMP_CHARS = 180;

export function createDetailRenderer(ctx, policy, release, metadata, artwork, favorites, related, sections = {}) {
  const { $, node, D, R, state, today, number, isNativeConsole, document, on } = ctx;
  const { publicSourceURL } = policy;
  const { renderHeroRelease } = release;
  const { renderHeroChips } = metadata;
  const { showArtwork } = artwork;
  const { updateSaveControls } = favorites;
  const { setupTags } = related;
  const { media, radar, overview, versions, translation, navigation } = sections;
  on?.($("gameDescriptionMore"), "click", () => {
    const open = $("gameDescriptionMore").getAttribute("aria-expanded") !== "true";
    $("gameDescription").classList.toggle("is-clamped", !open);
    $("gameDescriptionMore").setAttribute("aria-expanded", String(open));
    $("gameDescriptionMore").textContent = open ? "收合" : "展開全文";
  });

  // While the game's own file is on its way (load.js), hold the place: no
  // "not yet public" note, and no stand-in text that the Steam copy replaces.
  function renderDescription(game, waiting = false) {
    const text = waiting ? "" : game.description || "簡介尚未公開，後續將持續更新。";
    const long = text.length > CLAMP_CHARS;
    $("gameDescription").textContent = text;
    $("gameDescription").hidden = false;
    $("gameDescription").lang = game.descriptionLanguage === 'en' ? 'en' : 'zh-Hant';
    $("gameDescription").classList.toggle("is-pending", waiting);
    $("gameDescription").setAttribute("aria-busy", String(waiting));
    $("gameDescription").classList.toggle("is-clamped", long);
    $("gameDescriptionMore").hidden = !long;
    $("gameDescriptionMore").setAttribute("aria-expanded", "false");
    $("gameDescriptionMore").textContent = "展開全文";
    const shown = waiting ? { ...game, description: "" } : game;
    renderDescriptionSource($("descriptionSource"), shown, node);
    translation?.render(shown);
  }

  // One buy button: a single store opens directly; several stores scroll to 平台版本.
  // Versions sold on one store page (NS and NS2 on one Nintendo page) are one store.
  function renderBuyButtons(game, versionTargets) {
    const targets = [...new Map(versionTargets.map(target => [target.url, target])).values()];
    let href, label, short, external = true;
    if (targets.length > 1) {
      href = "#gameVersions"; label = "選擇平台購買"; short = "選擇平台購買 ↓"; external = false;
    } else if (targets.length === 1) {
      href = targets[0].url; label = `前往 ${targets[0].label}`; short = `${targets[0].label} ↗`;
    } else {
      const nintendo = isNativeConsole(game);
      href = nintendo ? publicSourceURL(game.link) || `https://www.igdb.com/search?type=1&q=${encodeURIComponent(game.nameEn || game.name)}` : game.link;
      const host = new URL(href).hostname;
      const name = !nintendo ? "Steam 商店" : host === "store.playstation.com" ? "PlayStation 商店"
        : /(?:^|\.)playstation\.com$/.test(host) ? "PlayStation 官網" : /(?:^|\.)nintendo\./.test(host)
          ? "Nintendo 官網" : new URL(href).pathname === "/search" ? "IGDB 搜尋" : "IGDB 遊戲頁";
      label = `前往 ${name}`; short = `${name} ↗`;
    }
    $("gameSteam").replaceChildren(node("span", "", label), node("span", "", external ? "↗" : "↓"));
    $("gameSteamMobile").textContent = short;
    document.querySelectorAll("[data-game-steam]").forEach((link) => {
      link.href = href;
      if (external) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", `${label}開啟 ${game.name}（另開分頁）`);
      } else {
        link.removeAttribute("target");
        link.removeAttribute("rel");
        link.setAttribute("aria-label", "選擇平台購買：跳到平台版本");
      }
    });
  }

  function render(game, data, pending = false, extras = {}) {
    const unchangedArt = state.currentGame?.art === game.art && state.currentGame?.art2x === game.art2x;
    state.currentGame = game;
    const nintendo = isNativeConsole(game);
    // The page is about the game. A platform's edition (bundle, Deluxe) is a
    // fact of that version and is shown in 平台版本, never as the page title.
    const name = String(game.name || ""), nameEn = String(game.nameEn || "");
    document.body.dataset.gameSource = game.source || "steam";
    document.body.dataset.gameHero = "on";
    state.recommendationsReady = !pending;
    if (state.selectedTag && !R.hasTag(game, state.selectedTag)) state.selectedTag = "";
    state.knownGames = D.cardGames([...data.games, ...data.recent]);
    state.candidates = D.cardGames([
      ...data.games.filter((row) => row.date >= today),
      ...D.selectGames(data, "released", today),
    ]);
    document.body.dataset.gameTheme = R.theme(game);
    $("gameTitle").textContent = name;
    $("gameTitle").lang = hasChineseName(name) ? "zh-Hant" : /^[\x20-\x7e]+$/.test(name) ? "en" : "";
    const subline = !hasChineseName(name) ? "暫無官方中文名稱" : nameEn && nameEn !== name ? nameEn : "";
    $("gameEnglish").textContent = subline;
    $("gameEnglish").hidden = !subline;
    $("gameEnglish").dataset.kind = hasChineseName(name) ? "original" : "missing";
    renderDescription(game, extras.descriptionPending === true);
    $("gameGenres").replaceChildren(
      node("small", "game-genres-label", "遊戲類型"),
      ...game.genres
        .slice(0, 4)
        .map((genre) => node("span", "", R.genreLabel(genre))),
    );
    $("gameGenres").hidden = !game.genres.length;
    const hero = renderHeroRelease(game);
    renderHeroChips(game, hero.days);
    const targets = versions?.render(game, extras.store, hero.date) || [];
    // A Steam version the radar does not measure leads with the console interest it has.
    const consoleInterest = !nintendo ? D.consoleInterest(game) : null;
    const leadConsole = !nintendo && !Number.isFinite(game.followers) && !!consoleInterest;
    const consoleMode = nintendo || leadConsole;
    // NS/NS2 games admitted by IGDB PopScore show their rank, not a low hypes count.
    const popscore = consoleMode && game.popularityBasis === "igdb_popscore" ? D.consoleInterest(game) : null;
    $("gameInterestLabel").textContent = popscore ? "IGDB 熱度" : consoleMode ? "發售前的社群關注" : "Steam 關注數";
    $("gameFollowers").textContent = popscore ? popscore.value : consoleMode
      ? Number.isSafeInteger(game.hypes) ? number.format(game.hypes) : "未知"
      : Number.isFinite(game.followers) ? number.format(game.followers) : "未取得";
    $("gameInterestUnit").textContent = popscore ? "" : consoleMode ? "次關注" : Number.isFinite(game.followers) ? "人" : "";
    const steamUnmeasured = game.steamReference ? "Steam 版不在雷達的 Steam 清單，沒有量 Followers" : "Steam Followers 尚未取得";
    $("gameInterestCaption").textContent = (popscore
      ? D.popscoreTop(game.popscoreTop) === null ? "IGDB PopScore · 曾排進 NS／NS2 前 20%" : "IGDB PopScore · NS／NS2 頁面瀏覽或「想玩」排名"
      : consoleMode
      ? "IGDB hypes · 發售前關注數"
      : game.twitchAdmission && !Number.isFinite(game.followers)
        ? "收錄依據 Twitch · Steam Followers 尚未取得"
        : game.steamReference && !Number.isFinite(game.followers)
          ? "Steam 版不在雷達的 Steam 清單，沒有量 Followers"
          : "Steam Followers · 非願望清單數") + (leadConsole ? `・${steamUnmeasured}` : "");
    // Every measurement says when it was taken: Steam Followers or the IGDB check.
    const measuredAt = new Date((consoleMode ? nintendo ? game.updated : game.consoleUpdated : game.followersCheckedAt) || "");
    const measuredLabel = consoleMode ? "IGDB 資料確認" : "關注數量測";
    $("gameFollowersMeasured").hidden = !Number.isFinite(measuredAt.getTime());
    $("gameFollowersMeasured").textContent = $("gameFollowersMeasured").hidden ? ""
      : `${measuredLabel} · ` + new Intl.DateTimeFormat("zh-TW", {
        timeZone:"Asia/Taipei", year:"numeric", month:"2-digit", day:"2-digit",
        hour:"2-digit", minute:"2-digit", hour12:false,
      }).format(measuredAt) + "（台灣）";
    // Console versions of a measured Steam game keep their own interest number in the heat card.
    $("gameHeatConsole").hidden = !consoleInterest || leadConsole;
    $("gameHeatConsole").textContent = $("gameHeatConsole").hidden ? "" : `主機版本：${consoleInterest.text}（${
      consoleInterest.basis === "hypes" ? "遊戲整體的發售前關注數" : "NS／NS2 頁面瀏覽或「想玩」排名"}，不跟 Steam 合併）`;
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
    $("gameFootnote").textContent = consoleMode
      ? popscore
        ? "IGDB 熱度是 IGDB 頁面瀏覽或「想玩」在 NS／NS2 遊戲間的排名，並非玩家人數。"
        : "IGDB hypes 屬遊戲整體的發售前關注數，並非單一平台玩家人數。"
      : game.hasNativePlatforms === true || game.hasNintendo === true
        ? "IGDB hypes 與 Steam Followers 分別呈現，不合併計算。"
        : "";
    $("gameFootnote").hidden = !$("gameFootnote").textContent;
    renderBuyButtons(game, targets);
    document.title = `${name}｜遊戲資訊・Game Trend Radar`;
    // A Steam game whose media is not fetched yet (a new admission) has no key
    // art: its Store capsule stands in, blurred as the hero and whole in the card.
    const capsule = !isNativeConsole(game) && extras.mediaDone === true && !extras.media?.hero && Boolean(game.art);
    if (!unchangedArt || state.capsule !== capsule) showArtwork(game, capsule);
    state.capsule = capsule;
    // A console game's own IGDB artwork, screenshots, trailers and companies.
    const shown = extras.media || (isNativeConsole(game) ? consoleMedia(game) : null);
    media?.render(game, shown, capsule);
    overview?.renderFacts(game, shown, extras.store);
    radar?.render(game, extras);
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
    navigation?.update();
  }
  return render;
}
