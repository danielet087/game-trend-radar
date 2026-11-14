import { RadarStorage } from '../../data/storage.ts';
import { canonicalID } from './metrics.js';
import { mount, valueOf, statusOf } from './chart.js';
import { node, fmt, time } from './presentation.js';
import { validIndex, validChunk, windowFor, monthsFor, seriesRows, fullSeriesRows, overviewQuery, dayOf, metrics, csvRows } from './series.js';
import { createStatistics } from './statistics.js';
import { createCooldown, cooldownPresentation } from './cooldown.js';
import { analyzeCooldown, cooldownThreshold } from './cooldown-model.js';
import { regionNames, viewOf } from './audience-region.js';
import { blockScopes, scopeKeys, regionsFor, projectRows, writeBlockScopes } from './region-views.js';
import { dailyRows } from './daily-series.js';
import { renderHeatOverview } from './heat-overview.js';
import { remainingAudienceTrend } from './stream-heat-model.js';
import { createTrialTimeComparison } from './trial-time-comparison.js';

export function initTwitchDetail() {
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search), scopes = blockScopes(params);
  let metric = Object.hasOwn(metrics, params.get('metric')) ? params.get('metric') : 'viewers';
  let resolution = ['daily', 'hourly'].includes(params.get('resolution')) ? params.get('resolution') : '';
  const id = canonicalID(params.get('game')), cache = new Map(), back = overviewQuery(params.get('back') || '');
  const trialTimes = createTrialTimeComparison({ $, params, back, onChange: syncURL });
  let index, game, window, rows = [], fullHistoryLoader, page = 0, descending = true, request = 0, summaryRequest = 0;
  let charts = [], statsMode = '', cooldownMode = '', stats = new Map(), cooldowns = new Map(), disposed = false;
  const controls = { summary: 'summaryRegion', history: 'audienceRegion', cooldown: 'cooldownRegion', statistics: 'statisticsRegion' };
  for (const block of Object.keys(scopeKeys)) $(controls[block]).value = scopes[block];
  $('historyBack').href = './twitch.html' + (back ? '?' + back : '');
  const backView = new URLSearchParams(back).get('view');
  if (backView === 'archive') $('historyBack').textContent = '← 歷史資料庫';
  if (backView === 'streamer') $('historyBack').textContent = '← 開台選題';
  function syncURL() {
    params.set('game', id); params.set('metric', metric); writeBlockScopes(params, scopes);
    if (resolution) params.set('resolution', resolution); else params.delete('resolution');
    const p = new URLSearchParams(back);
    const next = p.toString();
    if (next) params.set('back', next); else params.delete('back');
    $('historyBack').href = './twitch.html' + (next ? '?' + next : '');
    history.replaceState(null, '', location.pathname + '?' + params + location.hash);
  }
  function message(text, error = false) { $('historyStatus').textContent = text; $('historyStatus').dataset.error = String(error); }
  async function read(path, contract) {
    const result = await RadarStorage.readJSONResult(path, contract, { force: true, allowStale: false });
    if (!result.data) throw new Error('暫時無法取得歷史資料，請稍後重新載入。');
    return result.data;
  }
  function context(region) {
    return { gameName: (game.display_name || game.name) + ' · ' + regionNames[region], region, scope: regionNames[region],
      trackingStatus: game.tracking_status, lastHour: game.last_hour, latestHour: new Date(window.latest).toISOString(),
      generatedAt: index.generated_at, releaseReference: game.release_reference };
  }
  function panels(container, mode, kind) {
    container.replaceChildren(); container.classList.toggle('tw-region-compare', mode === 'compare');
    return new Map(regionsFor(mode).map(region => {
      const panel = node('section', 'tw-region-panel'); panel.dataset.region = region;
      const title = node('h3', 'tw-region-caption', regionNames[region]);
      const body = node('div'); body.id = kind + '-' + region;
      panel.append(title, body); container.append(panel);
      return [region, body];
    }));
  }
  function summaryValues(data) {
    const valid = data.map(row => valueOf(row, metric)).filter(value => value !== null);
    return [valid.length ? Math.max(...valid) : null,
      valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length * 10) / 10 : null,
      valid.at(-1), valid.length + ' / ' + data.length];
  }
  function renderSummary() {
    const container = $('historySummary'), labels = ['逐時區間最高', '有效時段平均', '區間最後有效值', '有效時段'];
    if (scopes.history === 'compare') {
      container.replaceChildren(); const table = node('table', 'tw-compare-table');
      const head = node('thead'), tr = node('tr');
      ['逐時區間統計', '全球', '中文區'].forEach(label => tr.append(node('th', '', label))); head.append(tr);
      const body = node('tbody'), global = summaryValues(projectRows(rows, 'global')), zh = summaryValues(projectRows(rows, 'zh'));
      labels.forEach((label, i) => { const row = node('tr'); row.append(node('th', '', label),
        node('td', '', typeof global[i] === 'string' ? global[i] : fmt(global[i])),
        node('td', '', typeof zh[i] === 'string' ? zh[i] : fmt(zh[i]))); body.append(row); });
      table.append(head, body); container.append(table);
    } else {
      const values = summaryValues(projectRows(rows, scopes.history));
      container.replaceChildren(...labels.map((label, i) => {
        const card = node('div', 'tw-history-stat');
        card.append(node('span', '', label), node('strong', '', typeof values[i] === 'string' ? values[i] : fmt(values[i])),
          node('small', '', i === 3 ? '缺測與未列入不當成 0' : metrics[metric] + ' · ' + (metric === 'streamers' ? '台' : metric === 'median' ? '人／台' : '人')));
        return card;
      }));
    }
  }
  function renderChart() {
    charts.forEach(dispose => dispose()); charts = [];
    const daily = metric === 'viewers' && rows.length > 24 && resolution !== 'hourly';
    $('historyResolution').hidden = metric !== 'viewers' || rows.length <= 24;
    document.querySelectorAll('[data-history-resolution]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.historyResolution === (daily ? 'daily' : 'hourly'))));
    const scoped = regionsFor(scopes.history).map(region => {
      const data = projectRows(rows, region); return { region, data: daily ? dailyRows(data, { region }) : data };
    });
    const max = scopes.history === 'compare'
      ? Math.max(daily ? cooldownThreshold('global') : 0, ...scoped.flatMap(group => group.data.map(row => valueOf(row, metric) || 0))) : 0;
    const roots = panels($('historyChart'), scopes.history, 'historyChart');
    for (const group of scoped) {
      const chart = mount(roots.get(group.region), { rows: group.data, gameName: (game.display_name || game.name) + ' · ' + regionNames[group.region],
        rangeOptions: [], initialRange: daily ? Number.MAX_SAFE_INTEGER : rows.length, rangeHours: rows.length,
        initialMetric: metric, granularity: daily ? 'daily' : 'hourly', connectGaps: false, domainMaximum: max,
        ...(daily && group.region === 'global' ? { referenceValue: cooldownThreshold(group.region) } : {}),
        onSelect(i) { charts.forEach(other => { if (other !== chart) other.select(i, false); }); },
        onMetricChange(value) {
          metric = value; syncURL(); renderHistory();
          $('historyChart').querySelector('[data-region="' + group.region + '"] .tw-chart-metric[data-metric="' + value + '"]')?.focus({ preventScroll: true });
        } });
      charts.push(chart);
    }
    if (scopes.history === 'compare') {
      let selected = scoped[0].data.findLastIndex(row => valueOf(row, metric) !== null);
      if (selected < 0) selected = scoped[0].data.length - 1;
      charts.forEach(chart => chart.select(selected, false));
    }
    $('historyChartNote').textContent = (scopes.history === 'compare' ? '全球包含中文區；兩圖使用相同時間與縱軸刻度，資料點與時間軸同步定位。' : '') +
      (daily ? '每日總觀眾中位數以已結束的台灣日期統計。' + (scopes.history === 'zh' ? '' : '虛線標示全球每日門檻。')
        : '逐時數值保留原始紀錄。單台觀眾中位數與每日總觀眾中位數為不同指標。');
  }
  function table() {
    const regions = regionsFor(scopes.history), data = regions.map(region => projectRows(rows, region));
    const headers = ['時段（台灣）'];
    for (const key of ['viewers', 'streamers', 'median']) for (const region of regions)
      headers.push(metrics[key] + (regions.length > 1 ? '・' + regionNames[region] : ''));
    headers.push('目前指標狀態');
    const head = $('historyTableBody').closest('table').querySelector('thead tr');
    head.replaceChildren(...headers.map(label => { const th = node('th', '', label); th.scope = 'col'; return th; }));
    const ordered = rows.map((row, i) => ({ row, i })); if (descending) ordered.reverse();
    const pages = Math.max(1, Math.ceil(ordered.length / 24)); page = Math.min(page, pages - 1);
    $('historyTableBody').replaceChildren(...ordered.slice(page * 24, (page + 1) * 24).map(({ row, i }) => {
      const tr = node('tr'), at = node('td'), select = node('button', 'tw-hour-link', time(row.hour));
      select.type = 'button'; select.title = '在圖表查看此時段';
      select.addEventListener('click', () => {
        resolution = 'hourly'; syncURL(); renderChart(); charts.forEach(chart => chart.select(i, false));
        $('historyChart').scrollIntoView({ block: 'nearest' });
      });
      at.append(select); tr.append(at);
      for (const key of ['viewers', 'streamers', 'median']) data.forEach(group => {
        const td = node('td', key === metric ? 'tw-selected-column' : '', fmt(valueOf(group[i], key)));
        td.title = statusOf(group[i], key); tr.append(td);
      });
      const label = r => r.audience_region_status === 'unavailable' ? '未收集中文區' : r.status === 'missing' ? '無收集紀錄'
        : r.status === 'absent' ? '未列入觀測' : valueOf(r, metric) === null ? '此指標待補' : '已觀測';
      const status = node('td', '', data.map((group, n) => (regions.length > 1 ? regionNames[regions[n]] + '：' : '') + label(group[i])).join('／'));
      status.title = data.map(group => statusOf(group[i], metric)).join('／'); tr.append(status); return tr;
    }));
    $('historyPagination').textContent = '第 ' + (page + 1) + ' / ' + pages + ' 頁 · 共 ' + rows.length + ' 個時段';
    $('historyPrevious').disabled = page === 0; $('historyNext').disabled = page === pages - 1;
  }
  function renderHistory() {
    renderChart(); renderSummary(); table();
    const counts = regionsFor(scopes.history).map(region => {
      const count = projectRows(rows, region).filter(row => row.status === 'observed' && row.audience_region_status !== 'unavailable').length;
      return regionNames[region] + '有效 ' + count + ' / ' + rows.length + ' 個時段';
    });
    message(regionNames[scopes.history] + ' · 已載入 ' + rows.length + ' 個時段 · ' + counts.join('；') + '。');
    $('historyExport').textContent = scopes.history === 'compare' ? '下載兩區 CSV ↓' : '下載此區間 CSV ↓';
  }
  async function renderOverview() {
    const token = ++summaryRequest, version = request, mode = scopes.summary;
    $('historyOverview').hidden = false;
    const roots = panels($('heatOverviewPanels'), mode, 'heatOverview');
    roots.forEach((root, region) => { root.className = 'tw-heat-overview'; renderHeatOverview(root, { status: 'loading', label: '正在整理全期熱度…', scope: regionNames[region] }); });
    try {
      const full = await fullHistoryLoader();
      if (disposed || token !== summaryRequest || version !== request) return;
      roots.forEach((root, region) => {
        const reference = game.release_reference;
        const releaseDate = region === 'zh' && reference?.precision === 'day' ? reference.date : null;
        const scoped = projectRows(full, region);
        const data = analyzeCooldown(scoped, { region, releaseDate });
        const snapshot = cooldownPresentation(data, context(region));
        if (region === 'zh') {
          const through = dayOf(window.end);
          snapshot.remainingTrend = { through, rows:remainingAudienceTrend(scoped, { releaseDate, date:through }) };
        }
        renderHeatOverview(root, snapshot);
      });
    } catch {
      if (disposed || token !== summaryRequest || version !== request) return;
      roots.forEach((root, region) => renderHeatOverview(root, { status: 'unavailable', label: '全期摘要暫時無法讀取，請重新載入。', scope: regionNames[region] }));
    }
  }
  function renderStatistics() {
    $('historyStatistics').hidden = false; $('historyStatisticsJump').hidden = false;
    if (statsMode !== scopes.statistics) {
      const view = stats.values().next().value?.view(); stats.forEach(controller => controller.destroy()); stats = new Map();
      const roots = panels($('statisticsPanels'), scopes.statistics, 'statisticsPanel'); statsMode = scopes.statistics;
      roots.forEach((root, region) => {
        root.className = 'tw-workspace tw-statistics';
        const controller = createStatistics(root, { idPrefix: statsMode === 'compare' ? region + '-' : '',
          onViewChange(next) {
            $('historyStatistics').dataset.statisticsMode = next.mode;
            stats.forEach(other => { if (other !== controller) other.setView(next); });
          } });
        stats.set(region, controller); if (view) controller.setView(view);
      });
    }
    stats.forEach((controller, region) => controller.update(projectRows(rows, region), {
      gameName: (game.display_name || game.name) + ' · ' + regionNames[region], rangeLabel: $('historyRangeLabel').textContent }));
    $('historyStatistics').dataset.statisticsMode = stats.values().next().value.view().mode;
    $('statisticsCompareNote').hidden = scopes.statistics !== 'compare';
  }
  function renderCooldown() {
    $('historyCooldown').hidden = false; $('historyCooldownJump').hidden = false;
    if (cooldownMode !== scopes.cooldown) {
      cooldowns.forEach(controller => controller.destroy()); cooldowns = new Map();
      const roots = panels($('cooldownPanels'), scopes.cooldown, 'cooldownPanel'); cooldownMode = scopes.cooldown;
      roots.forEach((root, region) => {
        root.className = 'tw-workspace tw-cooldown';
        cooldowns.set(region, createCooldown(root, { idPrefix: cooldownMode === 'compare' ? region + '-' : '',
          onSummary(result) {
            if (cooldownMode !== 'compare') {
              $('historyCooldown').dataset.cooldownStatus = result.status;
              $('historyCooldown').dataset.cooldownModelStatus = result.data?.status || 'unavailable';
            }
          } }));
      });
    }
    if (cooldownMode === 'compare') $('historyCooldown').dataset.cooldownStatus = 'compare';
    cooldowns.forEach((controller, region) => {
      const next = context(region);
      next.loadHistory = async () => {
        const full = await fullHistoryLoader();
        if (scopes.cooldown === 'compare') next.domainMaximum = Math.max(cooldownThreshold('global'), ...full.map(row => row.viewer_count || 0));
        return projectRows(full, region);
      };
      controller.update(next);
    });
  }
  async function load(refresh = false) {
    const token = ++request; summaryRequest++;
    if (refresh) trialTimes.reset();
    for (const key of ['historyOverview', 'historyCooldown', 'historyStatistics', 'historyContent', 'historyCooldownJump', 'historyStatisticsJump']) $(key).hidden = true;
    stats.forEach(controller => controller.hide()); cooldowns.forEach(controller => controller.hide());
    $('historyPanel').setAttribute('aria-busy', 'true'); $('historyExport').disabled = true; message('正在讀取逐時歷史…');
    try {
      if (!id) throw new Error('缺少有效的遊戲 ID，請返回 Twitch 新作觀測選擇遊戲。');
      if (!index || refresh) { fullHistoryLoader = null; cache.clear(); const next = await read('./data/twitch_series/index.json', validIndex); if (token !== request || disposed) return; index = next; }
      game = index.games[id];
      if (!game || game.archive_eligible !== true) throw new Error('這款遊戲未列入正式收錄的歷史資料庫，請返回清單選擇遊戲。');
      if (!Array.isArray(game.months)) throw new Error('這款遊戲尚無已發布的歷史紀錄，請返回清單或稍後重新載入。');
      async function chunksFor(months) {
        const chunks = {};
        await Promise.all(months.map(async month => {
          if (!cache.has(month)) cache.set(month, read('./data/twitch_series/' + id + '/' + month + '.json', value => validChunk(value, id, month)));
          const pending = cache.get(month);
          try { chunks[month] = await pending; } catch (error) { if (cache.get(month) === pending) cache.delete(month); throw error; }
        }));
        return chunks;
      }
      if (!fullHistoryLoader) {
        const sourceIndex = index, sourceGame = game; let pending;
        fullHistoryLoader = () => pending ||= (async () => {
          const chunks = await chunksFor(sourceGame.months);
          return fullSeriesRows(sourceIndex, chunks, id);
        })().catch(error => { pending = null; throw error; });
      }
      window = windowFor(params, index, game);
      const chunks = await chunksFor(monthsFor(window.start, window.end).filter(month => game.months.includes(month)));
      if (token !== request || disposed) return;
      rows = seriesRows(index, chunks, id, window.start, window.end, 'global'); page = 0;
      const name = game.display_name || game.name;
      document.title = name + ' · Twitch 歷史趨勢｜Game Trend Radar'; $('pageTitle').textContent = name;
      $('historyCategory').textContent = 'TWITCH CATEGORY ' + id + ' · 各區塊可獨立比較全球與中文區';
      $('historySpan').textContent = (game.tracking_status === 'ended' ? '已結束追蹤 · ' : '') + '已保存 ' + time(game.first_hour) + ' 至 ' + time(game.last_hour) + ' 的觀測紀錄（台灣時間）';
      $('historyUpdated').textContent = '資料更新 ' + time(index.generated_at) + '（台灣）';
      $('historyStart').value = dayOf(window.start); $('historyEnd').value = dayOf(window.end);
      $('historyStart').max = $('historyEnd').max = dayOf(window.latest);
      document.querySelectorAll('[data-history-range]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.historyRange === window.range)));
      $('historyRangeLabel').textContent = time(new Date(window.start).toISOString()) + ' — ' + time(new Date(window.end).toISOString()) + ' · 台灣時間' + (window.range !== 'custom' ? ' · 以本遊戲最後觀測時段為基準' : '');
      $('historyContent').hidden = false;
      renderHistory(); renderStatistics(); renderCooldown();
      const alignTrialTimes = $('trialTimes').hidden && location.hash === '#trialTimes';
      const overview = renderOverview();
      const comparison = trialTimes.update(index, id, chunksFor);
      if (alignTrialTimes) Promise.all([overview, comparison]).then(() => {
        if (token === request && !disposed && location.hash === '#trialTimes') $('trialTimes').scrollIntoView();
      });
      syncURL();
      $('historyExport').disabled = false;
    } catch (error) { if (token === request && !disposed) message(error.message || '歷史資料暫時無法載入。', true); }
    finally { if (token === request) $('historyPanel').setAttribute('aria-busy', 'false'); }
  }
  for (const [block, control] of Object.entries(controls)) $(control).addEventListener('change', () => {
    scopes[block] = viewOf($(control).value); syncURL();
    if (!game || !window || $('historyContent').hidden) return;
    ({ summary: renderOverview, history: renderHistory, cooldown: renderCooldown, statistics: renderStatistics })[block]();
  });
  document.querySelectorAll('[data-history-resolution]').forEach(button => button.addEventListener('click', () => { resolution = button.dataset.historyResolution; syncURL(); renderHistory(); }));
  document.querySelectorAll('[data-history-range]').forEach(button => button.addEventListener('click', () => { params.set('range', button.dataset.historyRange); params.delete('start'); params.delete('end'); load(); }));
  $('historyDates').addEventListener('submit', event => { event.preventDefault(); params.set('range', 'custom'); params.set('start', $('historyStart').value); params.set('end', $('historyEnd').value); load(); });
  $('historyRefresh').addEventListener('click', () => load(true));
  $('historyPrevious').addEventListener('click', () => { page--; table(); }); $('historyNext').addEventListener('click', () => { page++; table(); });
  $('historyOrder').addEventListener('change', () => { descending = $('historyOrder').value === 'desc'; page = 0; table(); });
  $('historyExport').addEventListener('click', () => {
    if (!rows.length) return;
    const regions = regionsFor(scopes.history), groups = regions.map(region => projectRows(rows, region));
    const exported = rows.flatMap((row, i) => groups.map(group => group[i]));
    const url = URL.createObjectURL(new Blob([csvRows(exported)], { type: 'text/csv;charset=utf-8' }));
    const link = node('a'); link.href = url;
    link.download = 'twitch-' + id + (scopes.history === 'global' ? '' : '-' + scopes.history) + '-' + dayOf(window.start) + '-' + dayOf(window.end) + '.csv';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  load();
  return () => { disposed = true; request++; summaryRequest++; trialTimes.reset(); charts.forEach(dispose => dispose()); stats.forEach(c => c.destroy()); cooldowns.forEach(c => c.destroy()); };
}
