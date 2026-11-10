export function growthCollectionNotice(run) {
  if (!run) return "";
  const coverage = run.coverage;
  if (coverage && Number.isSafeInteger(coverage.eligible) && Number.isSafeInteger(coverage.measured)
      && Number.isSafeInteger(coverage.unavailable) && Number.isSafeInteger(coverage.pending)
      && [coverage.eligible, coverage.measured, coverage.unavailable, coverage.pending].every(count => count >= 0)
      && coverage.measured + coverage.unavailable + coverage.pending === coverage.eligible
      && (coverage.unavailable > 0 || coverage.pending > 0)) {
    const gaps = [];
    if (coverage.unavailable) gaps.push(`${coverage.unavailable} 款暫無官方 GroupID 可供量測`);
    if (coverage.pending) gaps.push(`${coverage.pending} 款等待後續重試`);
    return `本輪已量測 ${coverage.measured}／${coverage.eligible} 款；${gaps.join("，")}。已保留有效歷史；缺漏不會計為零成長。`;
  }
  if (run.status === "rate_limited") return "Steam 本次查詢受到限流，已保留前次量測，等待下一次排程更新。";
  if (["source_unavailable", "interrupted", "awaiting_group_resolution", "bounded_run", "incomplete_coverage"].includes(run.status)) {
    return "本次未能完成量測，已保留有效歷史；缺漏不會計為零成長。";
  }
  return "";
}

export function createGrowthView(ctx, presentation) {
  const { $, node, I, state, document, today, number, percent, dateText, statusText } = ctx;
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
    change.append(node("strong", "", percent(metric.percent)), node("small", "", `${state.span} 日成長率`));
    row.append(change, sparkline(metric.series));
    const total = node("div", "growth-total");
    total.append(node("strong", "", number.format(metric.latest.followers)), node("small", "", `關注人數 · ${dateText(metric.latest.day)} 量測`));
    row.append(total);
    return row;
  }
  function renderGrowth() {
    const term = $("growthSearch").value.trim().toLocaleLowerCase();
    const eligible = state.games.filter(game => I.tracking(game.date, today) && game.date <= I.offset(today, 365) &&
      (!term || `${game.name} ${game.nameEn} ${game.appid}`.toLocaleLowerCase().includes(term)) &&
      (state.scope === "all" || (state.scope === "future" ? game.date > today : game.date <= today)));
    const entries = eligible.map(game => ({ game, metric: I.metric(history(game), state.span, today) }))
      .filter(entry => entry.metric.latest?.followers >= 5000);
    const canRank = entry => entry.metric.status === "ready" && Number.isFinite(entry.metric.percent);
    const ready = entries.filter(canRank);
    ready.sort((a, b) => b.metric.percent - a.metric.percent || a.game.appid - b.game.appid);
    const pending = entries.filter(entry => !canRank(entry));
    $("growthRanked").textContent = number.format(ready.length);
    $("growthTracked").textContent = number.format(entries.length);
    $("growthPending").textContent = number.format(pending.length);
    $("growthResultCount").textContent = `${state.span} 日成長率榜 · ${ready.length} 款可比較`;
    $("growthRows").replaceChildren(...ready.slice(0, state.limit).map(growthRow));
    if (!ready.length) $("growthRows").append(empty("rocket", entries.length ? "下一波上升曲線，正在累積" : "這次沒有符合上榜條件的遊戲", entries.length
      ? `需有最新有效量測及 ${state.span} 日前的同日紀錄，且基準日關注數大於 0，才會進入排行榜。缺少紀錄不會視為零成長。`
      : "最新官方量測須達 5,000 Followers 才能參與成長榜。可切換發售範圍，或清除搜尋條件。"));
    $("growthMore").hidden = ready.length <= state.limit;
    $("pendingTitle").textContent = `資料累積中 · ${pending.length} 款`;
    $("pendingList").replaceChildren(...pending.slice(0, 12).map(({ game, metric }) => {
      const item = node("article", "pending-game");
      item.append(gameLink(game), node("span", "pending-state", metric.status === "ready" ? "基準日關注數為 0" : statusText(metric.status)));
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
    } else if (growthCollectionNotice(run)) {
      $("growthNotice").textContent = growthCollectionNotice(run);
      $("growthNotice").hidden = false;
    }
    $("growthUpdated").textContent = "5,000 Followers 以上 · 依成長率由高到低";
    document.querySelectorAll("[data-growth-days]").forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.growthDays) === state.span)));
    $("growthScope").value = state.scope;
  }
  return { render: renderGrowth };
}
