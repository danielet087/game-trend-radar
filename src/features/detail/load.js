import { detailCatalog } from '../../data/publication.mjs';
import { withLatestFollowers, followerHistory } from '../../domain/followers.mjs';
import { steamMedia } from './media.js';
import { storeFacts } from './store.js';
const validActivity = value => !!value && typeof value === 'object' && Array.isArray(value.events);
// catalog.json leaves out descriptions; a Steam game's own file brings them.
// Until it arrives the page holds the description's place.
const awaitsDescription = (catalog, appid) => {
  const row = catalog?.games?.find(entry => Number(entry?.appid) === Number(appid));
  return !!row && !['short_description', 'short_description_en'].some(field => Object.hasOwn(row, field));
};
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
      if (previous.origin !== location.origin) return;
      if (previous.pathname.endsWith("/stream-planning.html") ||
          previous.pathname.endsWith("/twitch.html") && previous.searchParams.get("view") === "streamer") {
        const back = previous.pathname + previous.search + previous.hash;
        $("gameBack").href = $("detailStatusBack").href = back;
        $("gameBack").textContent = "← 返回開台選題";
        $("detailStatusBack").textContent = "返回開台選題";
        return;
      }
      if (previous.pathname.endsWith("/game.html")) {
        const stored = JSON.parse(window.sessionStorage.getItem("game-trend-radar:return:v1") || "null");
        if (stored && Date.now() - stored.at < 3600000) {
          const destination = new URL(stored.path, location.href);
          if (destination.origin === location.origin && /\/(?:index|games|upcoming|released|saved|date|explore|growth|analysis)\.html$/.test(destination.pathname))
            $("gameBack").href = destination.pathname + destination.search;
        }
      }
      if (
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
  // Small optional files: the page renders without them and fills in when they arrive.
  const readActivity = force => Promise.resolve(storage.readJSON?.('./data/activity.json', validActivity, { force }))
    .then(value => validActivity(value) ? value : null);
  async function loadConsoleDetail(force, active) {
    let catalog = null, preview = null, references = null, nintendo = null, activity = null, sourcesDone = false, shown = false;
    let media = null, mediaDone = false, store = null, mediaFor = null, steamRecord = null, steamDone = true;
    // A console game shown on its Steam version gets that version's media and prices.
    function loadSteamExtras(appid) {
      if (mediaFor === appid) return;
      mediaFor = appid;
      steamRecord = null; steamDone = false;
      Promise.resolve(storage.loadGame?.(appid, { force }))
        .then(record => { if (mediaFor === appid) steamRecord = record; })
        .catch(() => { /* The catalog row still shows the game. */ })
        .finally(() => { if (mediaFor === appid) { steamDone = true; present(); } });
      // A missing media file settles too: the Store capsule then stands in.
      Promise.resolve(storage.loadMedia?.(appid, { force }))
        .then(result => { media = steamMedia(result, appid); mediaDone = true; present(); })
        .catch(() => { mediaDone = true; present(); });
      Promise.resolve(storage.loadStoreFacts?.({ force }))
        .then(result => { store = storeFacts(result, appid); if (store) present(); })
        .catch(() => { /* Price, rating and Steam Deck rows are optional. */ });
    }
    function present() {
      if (!active()) return;
      if (!nintendo) return;
      const official = catalog && mediaFor ? detailCatalog(catalog, steamRecord, mediaFor) : catalog;
      const data = D.datasets(official, preview, nintendo, references);
      if (!data) return;
      const enriched = R.enrich(data, official, preview, references);
      const matches = [...enriched.games, ...enriched.recent].filter(entry =>
        (entry.igdbId === igdbId || entry.igdbIds?.includes(igdbId)) &&
        (!requestedDate || entry.date === requestedDate),
      );
      const game = matches.find(entry => entry.date >= today) || matches[0];
      if (!game) return;
      if (game.source !== 'nintendo' && game.appid) loadSteamExtras(game.appid);
      render(game, enriched, !sourcesDone, { activity, media, mediaDone, store,
        descriptionPending: !steamDone && awaitsDescription(catalog, mediaFor) });
      shown = true;
    }
    try {
      await Promise.all([
        storage.loadNintendo({ force }).then(result => { nintendo = result; present(); }),
        storage.loadSources({ force }).then(result => {
          catalog = result.catalog; preview = result.preview; references = result.references || null;
          sourcesDone = true; present();
        }),
        readActivity(force).then(result => { activity = result; if (activity) present(); })
          .catch(() => { /* The news list is optional. */ }),
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
    let rawGame = null, catalog = null, preview = null, references = null, nintendo = null, growth = null, media = null, activity = null, store = null;
    let mediaDone = false;
    let catalogDone = false, nintendoDone = false, gameDone = false, shown = false;
    function present() {
      if (!active()) return;
      if (!rawGame && !catalog && !preview) return;
      const official = detailCatalog(catalog, rawGame, appid);
      const data = R.enrich(D.datasets(official, preview, nintendo, references), official, preview, references);
      if (!data) return;
      const matches = [...data.games, ...data.recent].filter(entry =>
        entry.appid === appid && (!requestedDate || entry.date === requestedDate),
      );
      const game = matches.find(entry => entry.dateReleases?.some(row => row.platform === "Steam")) || matches[0];
      if (!game) {
        // The late catalog may remove an initially displayed old direct record.
        // Published recent/console references still pass through datasets above.
        // A console game's Steam version only exists once the console list arrives.
        const referenced = references?.games?.some(row => Number(row?.appid) === appid);
        if (catalogDone && catalog && (nintendoDone || !referenced)) {
          shown = false;
          related.showMessage('目前沒有其他符合條件的遊戲。');
          setStatus('這款遊戲目前不在公開清單中',
            '可能已調整發售日期或未達收錄條件；你仍可返回月曆看看其他遊戲。');
        }
        return;
      }
      const record = official?.games?.find(row => Number(row.appid) === appid);
      const history = growth?.games?.find(row => row?.appid === appid)?.history;
      render(withLatestFollowers(game, record, history, today), data, !catalogDone, {
        media, mediaDone, activity, store, record: rawGame || record, history: followerHistory(record, history),
        descriptionPending: !gameDone && awaitsDescription(catalog, appid),
      });
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
        storage.loadGame(appid, { force }).then(record => { rawGame = record; })
          .finally(() => { gameDone = true; present(); }),
        storage.loadSources({ force }).then(result => {
          catalog = result.catalog; preview = result.preview; references = result.references || null;
          catalogDone = true; present();
        }),
        storage.loadNintendo({ force }).then(result => { nintendo = result; nintendoDone = true; present(); })
          .catch(() => { nintendoDone = true; present(); /* Optional platform data must not block the Steam profile. */ }),
        Promise.resolve(storage.readJSON?.('./data/growth.json',
          value => value?.version === 1 && Array.isArray(value.games), { force }))
          .then(result => { growth = result; present(); })
          .catch(() => { /* Retain the catalog measurement when history is unavailable. */ }),
        // A missing media file settles too: the Store capsule then stands in.
        Promise.resolve(storage.loadMedia?.(appid, { force }))
          .then(result => { media = steamMedia(result, appid); mediaDone = true; present(); })
          .catch(() => { mediaDone = true; present(); }),
        Promise.resolve(storage.loadStoreFacts?.({ force }))
          .then(result => { store = storeFacts(result, appid); if (store) present(); })
          .catch(() => { /* Price, rating and Steam Deck rows are optional. */ }),
        readActivity(force).then(result => { activity = result; if (activity) present(); })
          .catch(() => { /* The news list is optional. */ }),
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
