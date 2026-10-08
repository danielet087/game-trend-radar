import { element as $ } from './dom';
import type { CatalogAPI, CatalogState, CatalogMode } from './types';
export function createCatalogStatus(D: CatalogAPI, model: CatalogState, mode: CatalogMode, today: string) {
  const number = new Intl.NumberFormat('zh-TW');
  function formatUpdate(value: string | null) {
    const date = new Date(value || "");
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("zh-TW", {
          timeZone: "Asia/Taipei",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(date)
      : "更新時間待確認";
  }
  function renderStatus() {
    const data = model.viewModel;
    if (!data) return;
    const prefix = data.partial ? "新作持續收錄中" : "遊戲資料已更新";
    const updated = mode === "released" ? data.recentUpdated : data.updated;
    $("updateText").textContent =
      `${prefix} · ${formatUpdate(updated)}（台灣）`;
    const init = data.initialization;
    const consoleCount = (codes: string[]) => new Set(data.games.filter(game => game.platforms?.some((code: string) => codes.includes(code)))
      .flatMap(game => game.igdbIds || (game.igdbId ? [game.igdbId] : []))).size;
    const nintendoCount = consoleCount(["NS", "NS2"]);
    const ps5Count = consoleCount(["PS5"]);
    const steamCount = new Set(data.games.filter(game => game.source !== "nintendo").map(game => game.appid)).size;
    let coverage = `目前收錄 ${number.format(steamCount)} 款 Steam 遊戲、${number.format(nintendoCount)} 款 NS／NS2 遊戲、${number.format(ps5Count)} 款 PS5 遊戲。Steam 新作需至少 5,000 人關注，已驗證 Twitch 新作可另行收錄；IGDB 主機新作試行門檻為 hypes ≥ 30。各平台以確切發售日收錄；僅有年、月或季度的遊戲持續觀察。${data.partial ? "清單尚在持續補齊，不代表全部符合條件的遊戲。" : ""}`;
    if (init?.candidate_count)
      coverage += ` 已取得 ${number.format(init.candidate_count)} 款候選新作，逐步核對關注人數。`;
    if (mode === "released")
      coverage =
        "近期上市列出近 30 天內、已確認發售的收錄遊戲，包含已驗證的 Twitch 新作。近期黑馬須於上市首週確認超過 3,000 人關注。";
    if (mode === "all")
      coverage = `目前可查詢 ${number.format(D.cardGames(D.selectGames(data, "all", today)).length)} 款已公開收錄的遊戲，包含待上市與既有上市紀錄，不限近期日期範圍。這是本站收錄清單，並非 Steam 全站遊戲。`;
    if (data.source === "preview")
      coverage += " 正式清單暫時無法讀取，目前使用已公開的預覽資料。";
    if (data.steamUpdated) coverage += ` Steam 更新：${formatUpdate(data.steamUpdated)}（台灣）。`;
    if (!data.nintendoAvailable) coverage += " IGDB 主機資料暫時無法讀取，Steam 清單仍可查看。";
    else coverage += ` IGDB 主機更新：${formatUpdate(data.nintendoUpdated)}（台灣）。TAG 顯示整款遊戲的平台類別；移上標籤查看已確認平台，月曆標籤另提供本次發售資訊。NS／NS2／PS5 僅在官方確認獨佔時作為獨佔標籤。`;
    $("coverageText").textContent = coverage;
  }
  return { render: renderStatus };
}
