import { RadarTwitch as D } from './data.js';
import { RadarTwitchChart, valueOf } from './chart.js';
import { node, time } from './presentation.js';
import { readPublishedJSON } from './load.js';
import { regionNames, viewOf } from './audience-region.js';
import { regionsFor, projectRows } from './region-views.js';

export function createTwitchHistory({ state, historyCache, chartDisposers, signal }) {
  function historyPanel(g) {
    const details = node('details', 'tw-history'), summary = node('summary', 'tw-history-toggle');
    summary.append(node('span', 'tw-history-title', '查看逐時紀錄'), node('span', 'tw-history-kind', '互動折線圖 · 24 小時')); details.append(summary);
    const wrapper = node('div', 'tw-history-content'), label = node('label', 'tw-local-region', '此圖表範圍 ');
    const picker = node('select'); picker.setAttribute('aria-label', g.game_name + '逐時圖表範圍');
    for (const key of ['global', 'zh', 'compare']) { const option = node('option', '', regionNames[key]); option.value = key; picker.append(option); }
    const initialMain = state.region; let mode = viewOf(state.region), metric = 'viewers', range = 24, rows, charts = [], request = 0;
    picker.value = mode; label.append(picker); const content = node('div'); wrapper.append(label, content); details.append(wrapper);
    function dispose() { charts.forEach(chart => { chart(); chartDisposers.delete(chart); }); charts = []; }
    function draw() {
      if (!rows || state.disposed || details.isConnected === false) return;
      dispose(); content.replaceChildren();
      const grid = node('div', mode === 'compare' ? 'tw-inline-region-compare' : '');
      const groups = regionsFor(mode).map(region => ({ region, rows: projectRows(rows, region) }));
      const maximum = mode === 'compare' ? Math.max(0, ...groups.flatMap(group => group.rows.map(row => valueOf(row, metric) || 0))) : 0;
      for (const group of groups) {
        const panel = node('section', 'tw-inline-region-panel'); panel.dataset.region = group.region;
        const chartRoot = node('div', 'tw-history-chart'); panel.append(node('h4', '', regionNames[group.region]), chartRoot); grid.append(panel);
        const chart = RadarTwitchChart.mount(chartRoot, { rows: group.rows, gameName: g.game_name + ' · ' + regionNames[group.region],
          initialRange: range, initialMetric: metric, domainMaximum: maximum, connectGaps: false,
          onMetricChange(value) { metric = value; draw(); },
          onRangeChange(value) { range = value; draw(); },
          onSelect(index) { charts.forEach(other => { if (other !== chart) other.select(index, false); }); } });
        charts.push(chart); chartDisposers.add(chart);
      }
      content.append(grid, node('p', 'tw-history-note', regionNames[mode] + ' · 台灣時間 · 截至 ' + time(state.data.generated_at) + '。缺測保留空白。' + (mode === 'compare' ? '兩圖時間、刻度與資料點同步。' : '')));
    }
    async function load() {
      const token = ++request, snapshot = state.data;
      content.replaceChildren(node('p', '', '正在讀取已保存的逐時紀錄…'));
      const results = await Promise.allSettled(D.historyDays(snapshot.generated_at).map(day => {
        if (!historyCache.has(day)) historyCache.set(day, readPublishedJSON('./data/twitch_history/' + day + '.json', true).then(file => {
          if (file && (file.schema_version !== 1 || file.date !== day || file.timezone !== 'Asia/Taipei' || !file.hours || typeof file.hours !== 'object')) throw new Error('INVALID_HISTORY');
          return file;
        }));
        return historyCache.get(day);
      }));
      if (token !== request || state.disposed || snapshot !== state.data || initialMain !== state.region || details.isConnected === false) return;
      rows = D.historyRows(results.filter(r => r.status === 'fulfilled').map(r => r.value).filter(Boolean), g.game_id, snapshot.generated_at, 'global');
      draw();
      if (results.some(r => r.status === 'rejected')) {
        const retry = node('button', 'tw-text-button', '部分歷史暫時無法讀取，重新讀取'); retry.type = 'button';
        retry.addEventListener('click', () => { historyCache.clear(); load(); }, { signal }); content.prepend(retry);
      }
    }
    picker.addEventListener('change', () => { mode = viewOf(picker.value); draw(); }, { signal });
    details.addEventListener('toggle', () => { if (details.open && !rows) load(); }, { signal });
    return details;
  }
  return { historyPanel };
}
