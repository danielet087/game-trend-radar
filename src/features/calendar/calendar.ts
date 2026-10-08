import { element as $, node, detailLink } from '../catalog/dom';
import type { CatalogAPI, CatalogGame, CatalogState } from '../catalog/types';
import type { FilterState } from '../catalog/filter-state';

export function createCalendarFeature(D: CatalogAPI, filters: FilterState, state: CatalogState, motion: { enabled: boolean }) {
  const today = filters.today;
  const number = new Intl.NumberFormat('zh-TW');
  function renderCalendar(games: CatalogGame[]) {
    const [year, month] = filters.state.month.split("-").map(Number);
    $("monthLabel").textContent = `${year} 年 ${month} 月`;
    const first = new Date(Date.UTC(year, month - 1, 1, 12));
    const dayOffset = first.getUTCDay();
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const count = Math.ceil((dayOffset + days) / 7) * 7;
    const byDate = new Map<string, CatalogGame[]>();
    games.forEach((game) => {
      if (!byDate.has(game.date)) byDate.set(game.date, []);
      byDate.get(game.date)!.push(game);
    });
    byDate.forEach((list) => list.sort(D.popularityCompare));
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const day = new Date(first.getTime() + (i - dayOffset) * 86400000)
        .toISOString()
        .slice(0, 10);
      const inMonth = day.startsWith(filters.state.month);
      const cell = node(
        "div",
        "calendar-day" +
          (!inMonth ? " other-month" : "") +
          (day === today ? " today" : ""),
      );
      const dayGames = inMonth ? byDate.get(day) || [] : [];
      if (dayGames.length) cell.classList.add("has-games");
      const link = node("a", "date-link", Number(day.slice(-2))) as HTMLAnchorElement;
      link.href = `./date.html?date=${day}`;
      link.setAttribute("aria-label", `${day} 發售遊戲完整清單`);
      if (day === today) {
        link.setAttribute("aria-current", "date");
        link.append(node("b", "", "今天"));
      }
      cell.append(link);
      D.calendarFeatured(dayGames).forEach((game: CatalogGame, rank: number) => {
        const releasePlatforms = game.releasePlatforms || [game.source === "nintendo" ? game.platformShort : "Steam"];
        const display = D.releaseDisplayNames?.(game, releasePlatforms) || { name: game.name, nameEn: game.nameEn };
        const tag = detailLink(game, D, "day-game" + (rank ? " second" : ""), display.name);
        const badge = D.cardPlatformBadge(game);
        tag.classList.add("day-game-platform", "day-game-" + badge.status);
        const platform = node("span", "day-platform", badge.label);
        platform.title = `${badge.title} 本日發售：${releasePlatforms.join("／")}。`;
        tag.append(platform,
          node("span", "day-game-name", display.name));
        tag.title = `${display.name}${display.nameEn && display.nameEn !== display.name ? ` · ${display.nameEn}` : ""} · ${platform.title}${Number.isFinite(game.hypes) ? ` · ${number.format(game.hypes)} IGDB hypes` : ""}${Number.isFinite(game.followers) ? ` · ${number.format(game.followers)} 人關注` : ""}`;
        cell.append(tag);
      });
      if (dayGames.length > 2) {
        const more = node("a", "day-more", `+${dayGames.length - 2} 款新作`) as HTMLAnchorElement;
        more.href = link.href;
        more.setAttribute(
          "aria-label",
          `${day} 尚有 ${dayGames.length - 2} 款遊戲，查看全部`,
        );
        cell.append(more);
      }
      cell.addEventListener("click", (event) => {
        if (!(event.target as Element).closest("a,button")) location.href = link.href;
      });
      fragment.append(cell);
    }
    $("calendarGrid").replaceChildren(fragment);
    if (motion.enabled && !state.loading && $("calendarGrid").animate)
      $("calendarGrid").animate(
        [
          { opacity: 0.35, transform: "translateY(6px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 230, easing: "ease-out" },
      );
  }
  return { render: renderCalendar };
}
