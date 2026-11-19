import { weekday } from './radar.js';
import { releaseDayText, versionName } from './versions.js';

const COUNT_WORDS = ['', '一', '兩', '三', '四'];

// The title card shows one date in large type — the requested calendar event,
// otherwise the earliest release — and says whether the other platforms match.
// Each platform's own dates and their sources live in 平台版本.
export function createReleasePresenter(ctx, policy) {
  const { $, D, today } = ctx;
  const { detailReleaseRows, officialReleaseClock, unifiedIGDBRelease, taiwanOfficialRelease,
    hongKongOfficialRelease, regionDateLabel } = policy;
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

  // Only Steam's Taiwan store and a verified Taiwan announcement need no caveat.
  function provenance(row) {
    if (!row || row.platform === "Steam" || taiwanOfficialRelease(row)) return "";
    const basis = unifiedIGDBRelease(row) ? "IGDB 日期" : hongKongOfficialRelease(row) ? "香港官方日期"
      : row.region === "taiwan" ? "" : regionDateLabel(row.region);
    return basis ? `${basis}，台灣上市日待確認` : "台灣上市日待確認";
  }

  /** Fills the title card's date block and returns the day count (null when undated). */
  function renderHeroRelease(game) {
    const rows = detailReleaseRows(game);
    const row = rows[0];
    const date = row?.date || game.date;
    const valid = D.validDate(date || "");
    const days = valid ? releaseDays(date) : null;
    const clock = row && row.platform !== "Steam" ? officialReleaseClock(row) : null;
    const first = firstDates(rows);
    const earliest = [...first.values()].reduce((value, entry) => !value || entry < value ? entry : value, "");
    // "最早" only when the versions launch on different days.
    const staggered = new Set(first.values()).size > 1;
    $("gameHeroLabel").textContent = !valid ? "發售日"
      : row && earliest && row.date !== earliest ? `${versionName(row.platform)}發售・台灣時間`
        : staggered ? "最早發售・台灣時間" : days > 0 ? "預定發售・台灣時間" : "發售日・台灣時間";
    $("gameHeroDate").textContent = valid ? date.replaceAll("-", ".") : "未定";
    $("gameHeroDate").dateTime = clock?.utc || (valid ? date : "");
    $("gameHeroWeekday").textContent = valid ? `（${weekday(date)}）` : "";
    $("gameHeroCountdown").textContent = releaseDayText(days);
    $("gameHeroCountdown").dataset.state = days === null ? "unknown" : days > 0 ? "upcoming" : days === 0 ? "today" : "released";
    $("gameHeroNote").textContent = [clock ? `${clock.time}（台灣時間）` : "", sameDayNote(first), provenance(row)]
      .filter(Boolean).join("・");
    $("gameHeroNote").hidden = !$("gameHeroNote").textContent;
    return { days, date: valid ? date : "" };
  }
  return { renderHeroRelease, releaseDays };
}
