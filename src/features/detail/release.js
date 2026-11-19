import { weekday } from './radar.js';

const PLATFORM_NAMES = { Steam: "STEAM", NS: "NINTENDO SWITCH", NS2: "NINTENDO SWITCH 2", PS5: "PLAYSTATION 5" };

export function createReleasePresenter(ctx, policy) {
  const { $, node, today } = ctx;
  const { detailReleaseRows, regionLabel, officialReleaseClock, unifiedIGDBRelease,
    hongKongOfficialRelease, taiwanOfficialRelease, releaseSourceName, releaseDateNote } = policy;
  const releaseDays = (date) => Math.round((Date.parse(date + "T12:00:00Z") -
    Date.parse(today + "T12:00:00Z")) / 86400000);
  const releaseCountdown = (date) => {
    const days = releaseDays(date);
    return days > 0 ? `還有 ${days} 天，準備好出發。` : days === 0
      ? "預定今天上市" : "原定日期已過，請以商店為準";
  };
  function ticketLabel(row) {
    const native = row.platform !== "Steam";
    const region = native ? regionLabel(row.region) : "台灣";
    const clock = native ? officialReleaseClock(row) : null;
    return unifiedIGDBRelease(row) ? row.date_basis === "igdb_timestamp_taipei"
      ? "IGDB 預定發售・台灣時區" : "IGDB 預定發售・日期資料"
      : hongKongOfficialRelease(row) ? "預定發售・香港官方"
      : native && !taiwanOfficialRelease(row) ? `預定發售・${region}日期（台灣待確認）`
        : `預定發售・${region}${clock ? "時間" : ""}`;
  }
  function renderReleaseDates(game) {
    const rows = detailReleaseRows(game);
    const primary = $("gameReleasePrimary");
    const tickets = rows.map((row, index) => {
      const native = row.platform !== "Steam";
      const region = native ? regionLabel(row.region) : "台灣";
      const ticket = index === 0 ? primary : node("div", "release-ticket");
      ticket.dataset.platform = row.platform;
      ticket.dataset.date = row.date;
      ticket.setAttribute("role", "listitem");
      ticket.setAttribute("aria-label", `${row.platform} 版本・${row.date.replaceAll("-", "/")}・${region}`);
      const month = index === 0 ? $("releaseMonth") : node("span");
      const day = index === 0 ? $("releaseDay") : node("strong");
      const year = index === 0 ? $("releaseYear") : node("small");
      month.textContent = `${Number(row.date.slice(5, 7))} 月`;
      day.textContent = row.date.slice(8);
      year.textContent = row.date.slice(0, 4);
      const platform = index === 0 ? $("gameReleasePlatform") : node("p", "release-platform-label");
      const label = index === 0 ? $("gameReleaseLabel") : node("p", "intel-label");
      const date = index === 0 ? $("gameDate") : node("time", "release-ticket-date");
      const countdown = index === 0 ? $("gameCountdown") : node("p", "game-countdown");
      const note = index === 0 ? $("gameReleaseNote") : node("p", "game-release-note");
      const clock = native ? officialReleaseClock(row) : null;
      platform.textContent = `${row.platform} 版本`;
      label.textContent = ticketLabel(row);
      date.textContent = `${row.date.replaceAll("-", "/")}${clock ? ` ${clock.time}（台灣時間）` : ""}`;
      date.dateTime = clock?.utc || row.date;
      countdown.textContent = releaseCountdown(row.date);
      note.hidden = !native;
      note.textContent = native ? `來源：${releaseSourceName(row)}。${releaseDateNote(row)}` : "";
      const stamp = node("div", "release-stamp");
      stamp.setAttribute("aria-hidden", "true");
      stamp.append(month, day, year);
      const copy = node("div", "release-ticket-copy");
      copy.append(platform, label, date, countdown, note);
      ticket.replaceChildren(stamp, copy);
      return ticket;
    });
    $("gameReleaseDates").replaceChildren(...tickets);
    renderHeroRelease(game, rows[0]);
  }
  // The title card repeats the primary release in large type, like a launch poster.
  function renderHeroRelease(game, row) {
    const date = row?.date || game.date;
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(date || "");
    const days = valid ? releaseDays(date) : null;
    const native = row && row.platform !== "Steam";
    const clock = native ? officialReleaseClock(row) : null;
    $("gameHeroLabel").textContent = !row ? "發售日" : native ? `${row.platform}・${ticketLabel(row).replace("預定發售・", "")}`
      : days !== null && days <= 0 ? "發售日・台灣時間" : "預定發售・台灣時間";
    $("gameHeroDate").textContent = valid ? date.replaceAll("-", ".") : "未定";
    $("gameHeroDate").dateTime = clock?.utc || (valid ? date : "");
    $("gameHeroWeekday").textContent = valid ? `（${weekday(date)}）` : "";
    $("gameHeroCountdown").textContent = days === null ? "日期待確認" : days > 0 ? `還有 ${days} 天`
      : days === 0 ? "今天發售" : `已發售 ${-days} 天`;
    $("gameHeroCountdown").dataset.state = days === null ? "unknown" : days > 0 ? "upcoming" : days === 0 ? "today" : "released";
    $("gameHeroNote").textContent = clock ? `${clock.time}（台灣時間）` : native ? `來源：${releaseSourceName(row)}` : "";
    $("gameHeroNote").hidden = !$("gameHeroNote").textContent;
    const platforms = (game.platforms || []).map(code => PLATFORM_NAMES[code] || code);
    $("gameState").textContent = `${days === null || days > 0 ? "UPCOMING" : days === 0 ? "OUT TODAY" : "RELEASED"}${platforms.length ? ` · ${platforms.join(" / ")}` : ""}`;
    return days;
  }
  return { renderReleaseDates, releaseDays, releaseCountdown };
}
