import { RadarArtwork, cancelArtwork } from '../../shared/artwork.js';
export function createDetailArtwork(ctx) {
  const { $, node, state, isNativeConsole, document, on } = ctx;
  function loadArtwork(img, game, onLoad, onExhausted) {
    RadarArtwork.load(img, game, {
      large: img.fetchPriority === "high", onLoad, onExhausted,
    });
  }
  // Console games show their portrait cover whole in the title card (the hero
  // behind it is the same cover, blurred). Steam games have wide key art instead.
  function showArtwork(game) {
    const art = $("gameCover");
    const prior = art.querySelector("img");
    if (prior) cancelArtwork(prior);
    art.hidden = !isNativeConsole(game);
    art.disabled = true;
    if (art.hidden) { art.replaceChildren(); return; }
    const img = node("img");
    img.alt = `${game.name} 的遊戲封面`;
    img.loading = "eager";
    img.fetchPriority = "high";
    img.decoding = "async";
    img.width = 264;
    img.height = 374;
    art.setAttribute("aria-label", `放大 ${game.name} 的遊戲封面`);
    art.replaceChildren(img);
    loadArtwork(
      img,
      game,
      () => { art.disabled = false; },
      () => { img.remove(); art.hidden = true; },
    );
  }
  let previousOverflow = "";
  on($("gameCover"), "click", () => {
    const img = $("gameCover").querySelector("img");
    if (!img || !state.currentGame) return;
    RadarArtwork.load($("artDialogImage"), state.currentGame, { large: true });
    $("artDialogImage").alt = `${state.currentGame.name} 的遊戲封面大圖`;
    $("artDialogCaption").textContent = state.currentGame.name;
    // The same dialog also pages through screenshots (media.js).
    $("artDialog").dataset.mode = "cover";
    $("artDialogCount").textContent = "";
    $("artPrev").hidden = $("artNext").hidden = true;
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
    const hero = $('gameCover').querySelector('img');
    if (hero) cancelArtwork(hero);
    cancelArtwork($('artDialogImage'));
    if ($('artDialog').open) { $('artDialog').close(); document.documentElement.style.overflow = previousOverflow; }
  } };
}
