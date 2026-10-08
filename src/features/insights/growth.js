export function createGrowthView(ctx, presentation) {
  const { $, node, I, state, document, today, number, signed, percent, dateText, statusText } = ctx;
  const { history, cover, gameLink, sparkline, empty } = presentation;
  function growthRow(entry, index) {
    const { game, metric } = entry;
    const row = node("article", "growth-row");
    row.dataset.appid = game.appid;
    row.append(node("span", "growth-rank", String(index + 1).padStart(2, "0")), cover(game));
    const copy = node("div", "growth-game-copy");
    copy.append(gameLink(game), node("p", "", `${dateText(game.date)} 上市${game.date <= today ? " · 上市後追蹤中" : " · 未上市"}`));
    row.append(copy);
    const change = node("div", "growth-change" + (metric.delta < 0 ? " is-down" : ""));
    change.append(node("strong", "", signed(metric.delta)), node("small", "", `${percent(metric.percent)} · ${state.span} 日新增關注`));
    row.append(change, sparkline(metric.series));
    const total = node("div", "growth-total");
    total.append(node("strong", "", number.format(metric.latest.followers)), node("small", "", `${dateText(metric.latest.day)} 量測`));
    row.append(total);
    return row;
  }
  function renderGrowth() {
    const term = $("growthSearch").value.trim().toLocaleLowerCase();
    const eligible = state.games.filter(game => I.tracking(game.date, today) && game.date <= I.offset(today, 365) &&
      (!term || `${game.name} ${game.nameEn} ${game.appid}`.toLocaleLowerCase().includes(term)) &&
      (state.scope === "all" || (state.scope === "future" ? game.date > today : game.date <= today)));
    const entries = eligible.map(game => ({ game, metric: I.metric(history(game), state.span, today) }));
    const ready = entries.filter(entry => entry.metric.status === "ready");
    ready.sort((a, b) => (state.sort === "percent" ? (b.metric.percent ?? -Infinity) - (a.metric.percent ?? -Infinity) : b.metric.delta - a.metric.delta) || b.game.followers - a.game.followers || a.game.appid - b.game.appid);
    const pending = entries.filter(entry => entry.metric.status !== "ready");
    $("growthRanked").textContent = number.format(ready.length);
    $("growthTracked").textContent = number.format(eligible.length);
    $("growthPending").textContent = number.format(pending.length);
    $("growthResultCount").textContent = `${state.span} 日成長榜 · ${ready.length} 款可比較`;
    $("growthRows").replaceChildren(...ready.slice(0, state.limit).map(growthRow));
    if (!ready.length) $("growthRows").append(empty("rocket", eligible.length ? "下一波上升曲線，正在累積" : "這次沒有符合的遊戲", eligible.length
      ? `需有最新有效量測及 ${state.span} 日前的同日紀錄，才會進入排行榜。缺少紀錄不會視為零成長。`
      : "試試其他日期範圍，或清除搜尋條件。"));
    $("growthMore").hidden = ready.length <= state.limit;
    $("pendingTitle").textContent = `資料累積中 · ${pending.length} 款`;
    $("pendingList").replaceChildren(...pending.slice(0, 12).map(({ game, metric }) => {
      const item = node("article", "pending-game");
      item.append(gameLink(game), node("span", "pending-state", statusText(metric.status)));
      item.append(node("p", "", metric.latest ? `${number.format(metric.latest.followers)} 人 · ${dateText(metric.latest.day)} 量測` : "尚無附查詢時間的官方關注數"));
      return item;
    }));
    $("pendingOverflow").textContent = pending.length > 12 ? `另有 ${pending.length - 12} 款正在累積；可輸入名稱查詢。` : "";
    $("pendingSection").hidden = !pending.length;
    const run = state.growthData?.collection;
    $("growthNotice").hidden = true;
    if (!state.growthData) {
      $("growthNotice").textContent = "成長紀錄暫時無法讀取，已保留目前收錄的遊戲清單。";
      $("growthNotice").hidden = false;
    } else if (run && ["rate_limited", "source_unavailable", "interrupted"].includes(run.status)) {
      $("growthNotice").textContent = run.status === "rate_limited" ? "Steam 本次查詢受到限流，已保留前次量測，等待下一次排程更新。" : "本次未能完成量測，已保留有效歷史；缺漏不會計為零成長。";
      $("growthNotice").hidden = false;
    }
    $("growthUpdated").textContent = "以各遊戲最新實測日回看 · 超過 2 天未更新暫不排名";
    document.querySelectorAll("[data-growth-days]").forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.growthDays) === state.span)));
    $("growthScope").value = state.scope; $("growthSort").value = state.sort;
  }
  return { render: renderGrowth };
}
