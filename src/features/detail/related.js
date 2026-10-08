import { createApp, h, Fragment } from 'vue';
import RelatedGameCard from './components/RelatedGameCard.vue';
export function createRelatedGames(ctx) {
  const { $, node, D, R, state, document, motion, on } = ctx;
  let cardsApp = null;
  function clearCards() { cardsApp?.unmount(); cardsApp = null; }
  function mountCards(result) {
    clearCards();
    $('gameRelatedGrid').replaceChildren();
    if (!result.games.length) return;
    cardsApp = createApp({ render: () => h(Fragment, result.games.map(game => h(RelatedGameCard,
      { key: D.detailURL(game), game, basis: result.basis, selectedTag: state.selectedTag, ctx }))) });
    cardsApp.mount($('gameRelatedGrid'));
  }
  function renderRelated(animate = false) {
    const result = R.recommendations(state.currentGame, state.candidates, state.selectedTag, 3);
    $("recommendationSummary").textContent = state.selectedTag
      ? `「${R.label(state.selectedTag)}」・${result.count} 款相近遊戲`
      : result.basis === "shared"
        ? `共同喜好，串起 ${result.count} 款新發現`
        : "發售日相近，也可以看看";
    $("tagExplore").href = R.url(state.selectedTag);
    $("tagExploreLabel").textContent = state.selectedTag
      ? `探索「${R.label(state.selectedTag)}」TAG`
      : "探索所有 TAG";
    const grid = $("gameRelatedGrid");
    mountCards(result);
    if (!result.games.length) {
      const empty = node("div", "empty-state");
      empty.append(
        node("span", "empty-symbol", "◎"),
        node("h3", "", state.selectedTag ? "這個 TAG 還沒有其他相近遊戲" : "下一款新發現，正在路上"),
        node("p", "", state.selectedTag
          ? "換個 TAG 試試，或選「綜合推薦」看看其他新作。"
          : "目前沒有其他符合條件的遊戲，之後有新作就會出現在這裡。"),
      );
      grid.append(empty);
    }
    $("recommendationBasis").textContent = !result.games.length ? "" : result.basis === "date"
      ? "尚無共同 TAG 可供比對，改依發售日接近程度推薦。"
      : `${state.selectedTag ? `符合「${R.label(state.selectedTag)}」的遊戲，` : ""}依共同 TAG 數量排序，同分時優先發售日接近的遊戲。${result.count > result.games.length ? `先呈現 ${result.games.length} 款。` : ""}`;
    document.querySelectorAll(".game-tag-panel .tag-option").forEach((button) => {
      button.setAttribute("aria-pressed", String(R.key(button.dataset.tag) === R.key(state.selectedTag)));
      button.disabled = !state.recommendationsReady;
    });
    updateTagVisibility();
    if (animate && motion?.enabled && grid.animate) {
      grid.getAnimations?.().forEach((animation) => animation.cancel());
      grid.animate(
        [{ opacity: 0.55, transform: "translateY(7px)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: 220, easing: "ease-out" },
      );
    }
  }
  function selectTag(tag) {
    if (!state.recommendationsReady || state.selectedTag === tag) return;
    state.selectedTag = tag;
    renderRelated(true);
  }
  on($("allRelatedTags"), "click", () => selectTag(""));
  function updateTagVisibility() {
    document.querySelectorAll("#gameTags button").forEach((button, index) => {
      button.hidden = !state.tagsExpanded && index >= 8 && button.dataset.tag !== state.selectedTag;
    });
    $("showTags").setAttribute("aria-expanded", String(state.tagsExpanded));
    $("showTags").textContent = state.tagsExpanded
      ? "收合 TAG −"
      : `展開全部 ${state.currentGame.tags.length} 個 TAG ＋`;
  }
  on($("showTags"), "click", () => {
    state.tagsExpanded = !state.tagsExpanded;
    updateTagVisibility();
  });
  function setupTags(game) {
    $("gameIntro").hidden = false;
    const counts = new Map(
      R.catalog(state.candidates.filter((row) => row.appid !== game.appid)).map((entry) => [R.key(entry.tag), entry.count]),
    );
    $("gameTags").replaceChildren(
      ...game.tags.map((tag) => {
        const count = counts.get(R.key(tag)) || 0;
        const button = node("button", "tag-option");
        button.type = "button";
        button.dataset.tag = tag;
        button.setAttribute("aria-controls", "gameRelatedGrid");
        button.setAttribute("aria-label", `預覽「${R.label(tag)}」的相近遊戲${state.recommendationsReady ? `，共 ${count} 款` : ""}`);
        button.append(node("span", "", R.label(tag)));
        if (state.recommendationsReady) {
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
    renderRelated();
  }
  function showMessage(message) {
    clearCards();
    $('gameRelatedGrid').replaceChildren(node('p', 'related-loading', message));
  }
  return { setupTags, renderRelated, showMessage, destroy: clearCards };
}
