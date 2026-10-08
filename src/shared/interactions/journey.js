export function createJourney(motion) {
  // Remember a list's exact filters, pagination and position before opening a game.
  const journeyKey = "game-trend-radar:journey:v1:" + location.pathname + location.search;
  let returnState = null;
  try {
    const previous = new URL(document.referrer || location.href);
    if ((previous.origin === location.origin && previous.pathname.endsWith("/game.html")) || performance.getEntriesByType?.("navigation")[0]?.type === "back_forward") {
      const stored = JSON.parse(sessionStorage.getItem(journeyKey) || "null");
      if (stored && Date.now() - stored.at < 3600000 && Number.isFinite(stored.y) && stored.y >= 0 && stored.y < 1000000)
        returnState = { ...stored, limit: Math.min(360, Math.max(36, Number(stored.limit) || 36)) };
    }
  } catch {}
  const journey = { restore: returnState };
  let listLimit = 36, restored = false;
  document.addEventListener("radar:content-ready", event => {
    listLimit = event.detail?.limit || listLimit;
    if (returnState && !restored) {
      restored = true;
      requestAnimationFrame(() => {
        const id = String(returnState.appid);
        if (/^(?:[1-9][0-9]*|igdb:[1-9][0-9]*)$/.test(id))
          document.querySelector(`.game-card[data-appid="${id}"] .card-detail-link`)?.focus({ preventScroll: true });
        window.scrollTo({ top: returnState.y, behavior: "instant" });
      });
    }
  });
  document.addEventListener("click", event => {
    const link = event.target.closest('a[href*="game.html?"]');
    if (!link || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === "_blank") return;
    let url;
    try { url = new URL(link.href); } catch { return; }
    if (url.origin !== location.origin) return;
    const steam = url.searchParams.get('appid'), native = url.searchParams.get('igdb');
    const appid = steam && /^[1-9][0-9]*$/.test(steam) ? Number(steam)
      : native && /^[1-9][0-9]*$/.test(native) ? `igdb:${native}` : null;
    if (appid === null) return;
    try {
      sessionStorage.setItem(journeyKey, JSON.stringify({ y: window.scrollY, limit: listLimit, appid, at: Date.now() }));
      sessionStorage.setItem("game-trend-radar:return:v1", JSON.stringify({ path: location.pathname + location.search, at: Date.now() }));
    } catch {}
  });
  for (const type of ["pageswap", "pagereveal"]) window.addEventListener(type, event => {
    if (!motion?.enabled) event.viewTransition?.skipTransition();
  });
  window.addEventListener("pageshow", () => {
    document.querySelectorAll('.cover-link[style*="view-transition-name"]').forEach(el => el.style.viewTransitionName = "");
  });



return journey;
}
