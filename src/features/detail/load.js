import { detailCatalog } from '../../data/publication.mjs';
/** Progressive hero loading: optional console/catalog failures do not block a known Steam game. */
export function createDetailLoader(ctx, render, favorites, related) {
  const { $, D, R, storage, location, document, window, today,
    appid, igdbId, requestedDate, nintendoRoute } = ctx;
  const { updateSaveControls } = favorites;
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
        const stored = JSON.parse(window.sessionStorage.getItem("game-trend-radar:return:v1") || "null");
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
  async function loadConsoleDetail(force, active) {
    let catalog = null, preview = null, nintendo = null, sourcesDone = false, shown = false;
    function present() {
      if (!active()) return;
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
        storage.loadNintendo({ force }).then(result => { nintendo = result; present(); }),
        storage.loadSources({ force }).then(result => {
          catalog = result.catalog; preview = result.preview; sourcesDone = true; present();
        }),
      ]);
      if (!active()) return;
      if (!shown) setStatus(nintendo ? "這款遊戲目前不在公開清單中" : "IGDB 主機遊戲資料暫時無法讀取",
        nintendo ? "可能已調整平台、發售日期或未達收錄條件；請返回月曆看看其他遊戲。" : "請稍後再試，或返回遊戲清單。", !nintendo);
    } catch (error) {
      console.error("Unable to display IGDB console profile", error);
      if (!active()) return;
      if (!shown) setStatus("IGDB 主機遊戲資訊暫時無法呈現", "請稍後再試，或返回遊戲清單。", true);
    }
  }
  let generation = 0;
  async function main(force = false) {
    const requested = ++generation;
    const active = () => !ctx.disposed && generation === requested;
    updateSaveControls();
    setBackLink();
    if (nintendoRoute) {
      if (!igdbId || (requestedDate !== null && !D.validDate(requestedDate))) {
        setStatus("找不到這款遊戲", "連結沒有有效的 IGDB ID 或發售日期，請返回遊戲清單重新選擇。");
        return;
      }
      await loadConsoleDetail(force, active);
      return;
    }
    if (!appid || (requestedDate !== null && !D.validDate(requestedDate))) {
      setStatus("找不到這款遊戲", "連結沒有有效的 Steam AppID 或發售日期，請返回遊戲清單重新選擇。");
      return;
    }
    let rawGame = null, catalog = null, preview = null, nintendo = null;
    let catalogDone = false, shown = false;
    function present() {
      if (!active()) return;
      if (!rawGame && !catalog && !preview) return;
      const official = detailCatalog(catalog, rawGame, appid);
      const data = R.enrich(D.datasets(official, preview, nintendo), official, preview);
      if (!data) return;
      const matches = [...data.games, ...data.recent].filter(entry =>
        entry.appid === appid && (!requestedDate || entry.date === requestedDate),
      );
      const game = matches.find(entry => entry.dateReleases?.some(row => row.platform === "Steam")) || matches[0];
      if (!game) {
        // The late catalog may remove an initially displayed old direct record.
        // Published recent/console references still pass through datasets above.
        if (catalogDone && catalog) {
          shown = false;
          related.showMessage('目前沒有其他符合條件的遊戲。');
          setStatus('這款遊戲目前不在公開清單中',
            '可能已調整發售日期或未達收錄條件；你仍可返回月曆看看其他遊戲。');
        }
        return;
      }
      render(game, data, !catalogDone);
      shown = true;
      if (catalogDone && !catalog && !preview) {
        $("recommendationSummary").textContent = "相似遊戲暫時無法讀取";
        related.showMessage("這款遊戲仍可正常查看，稍後重新整理再試。");
        $("recommendationBasis").textContent = "";
      }
    }
    try {
      // Independent requests: the hero does not wait for the whole catalog.
      await Promise.all([
        storage.loadGame(appid, { force }).then(record => { rawGame = record; present(); }),
        storage.loadSources({ force }).then(result => {
          catalog = result.catalog; preview = result.preview; catalogDone = true; present();
        }),
        storage.loadNintendo({ force }).then(result => { nintendo = result; present(); })
          .catch(() => { /* Optional platform data must not block the Steam profile. */ }),
      ]);
      if (!active()) return;
      if (!shown) {
        if (!rawGame && !catalog && !preview)
          setStatus("遊戲資料暫時無法讀取", "請稍後再試，或返回遊戲清單。", true);
        else
          setStatus("這款遊戲目前不在公開清單中", "可能已調整發售日期或未達收錄條件；你仍可返回月曆看看其他遊戲。");
      }
    } catch (error) {
      console.error("Unable to display game profile", error);
      if (!active()) return;
      if (!shown) setStatus("遊戲資訊暫時無法呈現", "請稍後再試，或返回遊戲清單。", true);
    }
  }
  return { load: main, setStatus };
}
