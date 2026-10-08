import { RadarArtwork, cancelArtwork } from '../../shared/artwork.js';
export function createDetailArtwork(ctx) {
  const { $, node, state, isNativeConsole, document, on } = ctx;
  function loadArtwork(img, game, onLoad, onExhausted) {
    RadarArtwork.load(img, game, {
      large: img.fetchPriority === "high", onLoad, onExhausted,
    });
  }
  function showArtwork(game) {
    const art = $("gameArt");
    const prior = art.querySelector("img");
    if (prior) cancelArtwork(prior);
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
        hint.textContent = `${isNativeConsole(game) ? "IGDB" : "STEAM"} 遊戲封面 · 點一下看大圖`;
      },
      () => {
        img.remove();
        art.disabled = true;
        hint.textContent = "封面暫時無法載入";
      },
    );
  }
  let previousOverflow = "";
  on($("gameArt"), "click", () => {
    const img = $("gameArt").querySelector("img");
    if (!img || !state.currentGame) return;
    RadarArtwork.load($("artDialogImage"), state.currentGame, { large: true });
    $("artDialogImage").alt = `${state.currentGame.name} 的遊戲封面大圖`;
    $("artDialogCaption").textContent = state.currentGame.name;
    previousOverflow = document.documentElement.style.overflow;
    $("artDialog").showModal();
    document.documentElement.style.overflow = "hidden";
  });
  on($("closeArtwork"), "click", () => $("artDialog").close());
  on($("artDialog"), "click", (event) => {
    if (event.target === $("artDialog")) $("artDialog").close();
  });
  on($("artDialog"), "close", () => {
    document.documentElement.style.overflow = previousOverflow;
  });
  return { showArtwork, destroy() {
    const hero = $('gameArt').querySelector('img');
    if (hero) cancelArtwork(hero);
    cancelArtwork($('artDialogImage'));
    if ($('artDialog').open) { $('artDialog').close(); document.documentElement.style.overflow = previousOverflow; }
  } };
}
