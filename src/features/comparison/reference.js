export function createComparisonView(ctx, presentation, comparisonHistory) {
  const { $, node, D, R, I, state, document, today, number, dateText, compare, storage } = ctx;
  const { cover, gameLink, badges } = presentation;
  function searchChoices() {
    const term = $("compareSearch").value.trim().toLocaleLowerCase();
    const selected = compare.ids();
    const matches = state.games.filter(game => !selected.includes(game.appid) && (!term ||
      `${game.name} ${game.nameEn} ${game.appid} ${(game.tags || []).map(R.label).join(" ")}`.toLocaleLowerCase().includes(term)));
    const sorted = matches.sort((a, b) => b.followers - a.followers);
    $("compareSuggestions").replaceChildren(...sorted.slice(0, 6).map(game => {
      const button = node("button", "compare-suggestion"); button.type = "button";
      const text = node("span"); text.append(node("strong", "", game.name), node("small", "", `${dateText(game.date)} · ${number.format(game.followers)} 人關注`));
      button.append(cover(game, "suggestion-cover"), text, node("span", "suggestion-plus", "+"));
      button.setAttribute("aria-label", `加入比較：${game.name}`);
      button.disabled = selected.length >= 3;
      button.addEventListener("click", () => {
        if (compare.toggle(game.appid, game.name)) $("compareSearch").focus({ preventScroll: true });
      });
      return button;
    }));
    $("compareSearchHint").textContent = selected.length >= 3 ? "已選滿 3 款，可先移除其中一款再替換。" : !matches.length ? "找不到符合的遊戲，試試名稱、AppID 或 TAG。" : term ? `找到 ${matches.length} 款，顯示前 ${Math.min(matches.length, 6)} 款。` : "先從關注度較高的作品選起，或輸入名稱搜尋。";
  }
  function renderComparison() {
    const selected = compare.ids().map(id => state.games.find(game => game.appid === id)).filter(Boolean);
    const generation = ++state.analysisGeneration;
    $("compareSlots").replaceChildren(...[0, 1, 2].map(index => {
      const game = selected[index];
      const slot = node("div", "compare-slot" + (game ? " is-filled" : ""));
      slot.append(node("span", "slot-number", `0${index + 1}`));
      if (game) {
        slot.append(cover(game), gameLink(game));
        const remove = node("button", "slot-remove", "×"); remove.type = "button";
        remove.setAttribute("aria-label", `移除比較：${game.name}`);
        remove.addEventListener("click", () => { compare.set(compare.ids().filter(id => id !== game.appid)); $("compareSearch").focus({ preventScroll: true }); });
        slot.append(remove);
      } else {
        slot.append(node("span", "slot-empty-symbol", "+"), node("span", "", "選一款加入比較"));
      }
      return slot;
    }));
    $("compareCount").textContent = `${selected.length} / 3 款`;
    $("compareClear").disabled = !selected.length;
    $("compareShare").disabled = !selected.length;
    $("comparisonResults").hidden = selected.length < 2;
    $("compareJump").hidden = selected.length < 2;
    $("comparisonPrompt").hidden = selected.length >= 2;
    $("comparisonPrompt").textContent = selected.length ? "再選 1 款，就能比較每日歷史。" : "選擇 2～3 款遊戲，比較同一期間的每日關注變化。";
    searchChoices();
    if (selected.length < 2) return;
    comparisonHistory.render(selected.map(game => ({ ...game, history: state.observations.get(game.appid)?.history || [] })), state.growthData);
    const common = selected[0].tags.filter(tag => selected.every(game => R.hasTag(game, tag)));
    const head = node("tr");
    const corner = node("th", "", "比較項目"); corner.scope = "col"; head.append(corner);
    for (const game of selected) { const th = node("th"); th.scope = "col"; th.append(gameLink(game)); head.append(th); }
    $("comparisonHead").replaceChildren(head);
    const body = $("comparisonBody"); body.replaceChildren();
    const addRow = (label, get) => {
      const row = node("tr"), th = node("th", "", label); th.scope = "row"; row.append(th);
      for (const game of selected) { const cell = node("td"); const result = get(game); if (typeof result === "string") cell.textContent = result; else cell.append(result); row.append(cell); }
      body.append(row);
    };
    addRow("發售日期", game => dateText(game.date));
    addRow("發售狀態", game => game.date > today ? "尚未上市" : game.date === today ? "今日上市" : "已上市");
    addRow("追蹤期限", game => `${dateText(I.offset(game.date, 30))}${I.tracking(game.date, today) ? "（追蹤中）" : "（已結束）"}`);
    addRow("語言支援", badges);
    addRow("遊戲類型", game => game.genres.length ? game.genres.map(R.genreLabel).join("、") : "尚無資料");
    const tagLinks = tags => {
      const box = node("div", "comparison-tags");
      if (!tags.length) { box.textContent = "—"; return box; }
      for (const tag of tags) { const a = node("a", "", R.label(tag)); a.href = R.url(tag); box.append(a); }
      return box;
    };
    addRow("共同 TAG", () => common.length ? tagLinks(common.slice(0, 8)) : "目前沒有共同 TAG");
    addRow("其他 TAG", game => tagLinks(game.tags.filter(tag => !common.some(value => R.key(value) === R.key(tag))).slice(0, 8)));
    addRow("繁中簡介", game => { const p = node("p", "comparison-description", "正在讀取繁體中文介紹…"); p.dataset.descriptionFor = game.appid; return p; });
    let descriptionsStarted = false;
    state.loadComparisonDescriptions = () => {
      if (descriptionsStarted) return;
      descriptionsStarted = true;
      Promise.allSettled(selected.map(async game => {
        const raw = await storage.loadGame(game.appid);
        if (ctx.disposed || generation !== state.analysisGeneration) return;
        const cell = body.querySelector(`[data-description-for="${game.appid}"]`);
        if (!cell) return;
        cell.textContent = raw?.short_description_language === "zh-TW" && typeof raw.short_description === "string" ? raw.short_description : "繁體中文遊戲介紹整理中。";
      }));
    };
    if (document.querySelector('.comparison-reference').open) state.loadComparisonDescriptions();
  }
  return { render: renderComparison, searchChoices };
}
