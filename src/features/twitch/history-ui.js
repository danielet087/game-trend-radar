import { RadarTwitch as D } from "./data.js";
import { RadarTwitchChart } from "./chart.js";
import { node, time } from "./presentation.js";
import { readPublishedJSON } from "./load.js";
export function createTwitchHistory({ state, historyCache, chartDisposers, signal }) {
const readJSON = readPublishedJSON;
function historyPanel(g) {
  const details = node("details","tw-history");
  const summary = node("summary","tw-history-toggle");
  summary.append(node("span","tw-history-title","查看逐時紀錄"),node("span","tw-history-kind","互動折線圖 · 24 小時"));
  details.append(summary);
  const content = node("div","tw-history-content"); details.append(content);
  let loaded = false, disposeChart = null, requestVersion = 0;
  async function renderHistory() {
    if (state.disposed) return;
    loaded = true;
    const version = ++requestVersion, snapshot = state.data;
    if (disposeChart) { disposeChart(); chartDisposers.delete(disposeChart); disposeChart = null; }
    content.replaceChildren(node("p","","正在讀取已保存的逐時紀錄…"));
    const anchor = snapshot.generated_at;
    const days = D.historyDays(anchor);
    const results = await Promise.allSettled(days.map(day => {
      if (!historyCache.has(day)) historyCache.set(day,readJSON(`./data/twitch_history/${day}.json`,true).then(file => {
        if (file && (file.schema_version !== 1 || file.date !== day || file.timezone !== "Asia/Taipei" || !file.hours || typeof file.hours !== "object")) throw new Error("INVALID_HISTORY");
        return file;
      }));
      return historyCache.get(day);
    }));
    if (state.disposed || version !== requestVersion || state.data !== snapshot) return;
    const files = results.filter(r => r.status === "fulfilled").map(r => r.value).filter(Boolean);
    const failed = results.some(r => r.status === "rejected");
    const rows = D.historyRows(files,g.game_id,anchor);
    content.replaceChildren();
    if (failed) {
      content.append(node("p","","部分歷史檔案暫時無法讀取，以下僅顯示已取得的紀錄。"));
      const retry = node("button","tw-text-button","重新讀取歷史"); retry.type = "button";
      retry.addEventListener("click",() => { historyCache.clear(); renderHistory(); }, { signal }); content.append(retry);
    }
    if (!rows.some(r => r.status === "observed")) {
      content.append(node("p","","這段期間尚無此遊戲可讀取的逐時紀錄。歷史會在新版排程保存資料後出現；缺測不計為 0。")); return;
    }
    const chart = node("div","tw-history-chart"); content.append(chart);
    disposeChart = RadarTwitchChart.mount(chart,{ rows,gameName:g.game_name,anchor });
    chartDisposers.add(disposeChart);
    content.append(node("p","tw-history-note",`台灣時間 · 截至 ${time(anchor)}。總觀眾與開台為全體統計；篩選中位數只計追隨者 > 1,000 且觀眾 ≥ 10 的頻道。缺測及未入列保留空缺，不補成 0。`));
  }
  details.addEventListener("toggle",() => { if (details.open && !loaded) renderHistory(); }, { signal });
  return details;
}
return { historyPanel };
}
