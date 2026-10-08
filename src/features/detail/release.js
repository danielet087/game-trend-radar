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
      label.textContent = unifiedIGDBRelease(row) ? row.date_basis === "igdb_timestamp_taipei"
        ? "IGDB 預定發售・台灣時區" : "IGDB 預定發售・日期資料"
        : hongKongOfficialRelease(row) ? "預定發售・香港官方"
        : native && !taiwanOfficialRelease(row) ? `預定發售・${region}日期（台灣待確認）`
          : `預定發售・${region}${clock ? "時間" : ""}`;
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
  }
  return { renderReleaseDates, releaseDays, releaseCountdown };
}
