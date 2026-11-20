import { weekday } from './radar.js';
import { releaseDayText, versionName } from './versions.js';

const COUNT_WORDS = ['', '一', '兩', '三', '四'];

// The title card shows one date in large type — the requested calendar event,
// otherwise the earliest release — and says whether the other platforms match.
// Each platform's own dates and their sources live in 平台版本.
export function createReleasePresenter(ctx, policy) {
  const { $, D, today } = ctx;
  const { detailReleaseRows } = policy;
  const releaseDays = (date) => Math.round((Date.parse(date + "T12:00:00Z") -
    Date.parse(today + "T12:00:00Z")) / 86400000);

  // Each platform's first date: whether the versions launch together.
  function firstDates(rows) {
    const first = new Map();
    for (const row of rows) if (!first.has(row.platform) || row.date < first.get(row.platform)) first.set(row.platform, row.date);
    return first;
  }
  function sameDayNote(first) {
    if (first.size < 2) return "";
    const count = COUNT_WORDS[first.size] ? `${COUNT_WORDS[first.size]}個` : `${first.size} 個`;
    return new Set(first.values()).size === 1 ? `${count}平台同一天` : "各平台日期不同，見平台版本";
  }

  /** Fills the title card's date block and returns the day count (null when undated). */
  function renderHeroRelease(game) {
    const rows = detailReleaseRows(game);
    const row = rows[0];
    const date = row?.date || game.date;
    const valid = D.validDate(date || "");
    const days = valid ? releaseDays(date) : null;
    const dayRows = valid ? rows.filter(entry => entry.date === date) : [];
    const shown = [...new Set(dayRows.map(entry => entry.platform))];
    // Platforms that are not on this day: already out, later, or undated.
    const others = valid && shown.length ? D.otherPlatformReleases(game, shown, today) : [];
    // "台灣時間" when a version on this day has a Taiwan day; otherwise whose day it is.
    const unconfirmed = D.dayEvidence(dayRows);
    const basis = unconfirmed && !unconfirmed.mixed ? `${unconfirmed.label}${unconfirmed.source === "IGDB" ? "（IGDB）" : ""}` : "台灣時間";
    // A label that already says 待確認 needs no second caveat.
    const caveat = unconfirmed && unconfirmed.badge !== unconfirmed.label;
    const pendingNote = !unconfirmed ? ""
      : unconfirmed.mixed ? `${unconfirmed.pending.join("、")} ${caveat ? `為${unconfirmed.label}，台灣上市日待確認` : unconfirmed.label}`
      : caveat ? "台灣上市日待確認" : "";
    const named = others.length ? shown.length === 1 ? versionName(shown[0]) : `${shown.join("、")} 版` : "";
    $("gameHeroLabel").textContent = !valid ? "發售日"
      : `${named ? `${named}發售` : days > 0 ? "預定發售" : days === 0 ? "今天發售" : "發售日"}・${basis}`;
    $("gameHeroDate").textContent = valid ? date.replaceAll("-", ".") : "未定";
    const clock = days !== null && days >= 0 ? dayRows.map(D.releaseClock).find(Boolean) : null;
    $("gameHeroDate").dateTime = clock?.utc || (valid ? date : "");
    $("gameHeroWeekday").textContent = valid ? `（${weekday(date)}）` : "";
    $("gameHeroCountdown").textContent = releaseDayText(days);
    $("gameHeroCountdown").dataset.state = days === null ? "unknown" : days > 0 ? "upcoming" : days === 0 ? "today" : "released";
    $("gameHeroNote").textContent = [
      clock ? `${clock.time}（台灣時間）${clock.source === "steam" ? "・Steam 預定" : ""}` : "",
      others.length ? "" : sameDayNote(firstDates(rows)),
      pendingNote,
    ].filter(Boolean).join("・");
    $("gameHeroNote").hidden = !$("gameHeroNote").textContent;
    renderOthers(others);
    return { days, date: valid ? date : "" };
  }

  // The other platforms, so a later or earlier version is never read as this day;
  // versions with the same day and state share one line.
  function renderOthers(others) {
    const list = $("gameHeroOthers");
    if (!list) return;
    const groups = new Map();
    for (const entry of others) {
      const key = entry.state === "released" ? `released|${entry.date}`
        : [entry.state, entry.date, entry.clock?.time || "", entry.evidence?.badge || ""].join("|");
      if (!groups.has(key)) groups.set(key, { ...entry, platforms: [] });
      groups.get(key).platforms.push(entry.platform);
    }
    list.replaceChildren(...[...groups.values()].map(entry => {
      const item = ctx.node("li", `game-hero-other is-${entry.state}`);
      item.append(ctx.node("strong", "", `${entry.platforms.join("、")} 版`));
      if (entry.state === "undated" || entry.state === "unlisted") {
        const state = ctx.node("span", "game-hero-other-state", D.releaseStateText[entry.state]);
        if (entry.state === "unlisted") state.title = D.unlistedReleaseNote;
        item.append(state);
        return item;
      }
      const clock = entry.state !== "released" && entry.clock ? ` ${entry.clock.time}` : "";
      item.append(ctx.node("span", "game-hero-other-date", `${entry.date.replaceAll("-", ".")}（${weekday(entry.date)}）${clock}`),
        ctx.node("span", "game-hero-other-state", entry.state === "released" ? "已發售" : releaseDayText(releaseDays(entry.date))));
      if (entry.state !== "released" && entry.evidence && !entry.evidence.taiwan)
        item.append(ctx.node("span", "game-hero-other-basis", entry.evidence.badge));
      return item;
    }));
    list.hidden = !others.length;
  }
  return { renderHeroRelease, releaseDays };
}
