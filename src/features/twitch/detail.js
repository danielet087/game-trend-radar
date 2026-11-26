import { RadarStorage } from '../../data/storage.ts';
import { canonicalID, HOUR } from './metrics.js';
import { mount, valueOf, statusOf } from './chart.js';
import { node, fmt, time } from './presentation.js';
import { validIndex, validChunk, windowFor, monthsFor, seriesRows, fullSeriesRows, overviewQuery, streamPlanningHref, dayOf, metrics, csvRows } from './series.js';
import { cooldownThreshold } from './cooldown-model.js';
import { CHINESE_MEASUREMENT_CHANGE_AT, regionNames, regionOf } from './audience-region.js';
import { projectRows } from './region-views.js';
import { dailyRows } from './daily-series.js';
import { analyzeStreamHeat, remainingAudienceTrend } from './stream-heat-model.js';
import { createLaunchCurves, validCurves } from './launch-curves.js';
import { forecastModel, launchAdvice, launchAnchor, launchDays, launchForecast, steamAppOf } from './launch-model.js';
import { currentLaunch, launchPeaks, waitingText } from './launches.js';
import { bindInfoNotes } from './info-notes.js';
import { createGameVerdict } from './game-verdict.js';
import { createStreamSlots } from './stream-slots.js';
import { renderRemainingTrend } from './remaining-trend.js';
import { gameMeta } from './trend-verdict.js';

// Older links named a region per block (summary_region, history_region…) or
// "compare"; the page now has one region for everything.
const LEGACY_SCOPES = ['summary_region', 'history_region', 'cooldown_region', 'statistics_region', 'trial_region', 'rank_region', 'launch_region'];
// The folded sections load their code when first opened.
let statisticsModule, cooldownModule;
const loadStatistics = () => statisticsModule ||= import('./statistics.js');
const loadCooldown = () => cooldownModule ||= import('./cooldown.js');

export function initTwitchDetail() {
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search), events = new AbortController();
  let metric = Object.hasOwn(metrics, params.get('metric')) ? params.get('metric') : 'viewers';
  let resolution = ['daily', 'hourly'].includes(params.get('resolution')) ? params.get('resolution') : '';
  const id = canonicalID(params.get('game')), cache = new Map(), back = overviewQuery(params.get('back') || '');
  let region = regionOf(params.get('region') ?? LEGACY_SCOPES.map(key => params.get(key)).find(value => value === 'zh'));
  const verdict = createGameVerdict({ $, signal: events.signal,
    onOpenRecord() { const more = $('moreCooldown'); more.open = true; more.scrollIntoView({ block: 'start' }); } });
  const slots = createStreamSlots({ $, params, onChange: syncURL, onRank: value => verdict.setRank(value) });
  let metaLine = '';
  const launchCurves = createLaunchCurves({ $, params, onChange: syncURL, region: () => region,
    onShow(shown, genre) {
      $('moreCurves').hidden = !shown;
      $('launchCurveTitle').textContent = shown && genre ? `同類${genre}新作的上市曲線` : '同類新作的上市曲線';
      $('gameMeta').textContent = [metaLine, shown ? genre : null].filter(Boolean).join('・');
    } });
  let index, game, window, rows = [], fullHistoryLoader, page = 0, descending = true, request = 0, summaryRequest = 0;
  let charts = [], statsRegion = '', cooldownRegion = '', stats = null, cooldown = null, disposed = false;
  let releaseTime = null, heat = null;
  bindInfoNotes($('mainContent'), events.signal);
  const backView = new URLSearchParams(back).get('view');
  $('historyBack').href = backView === 'streamer' ? streamPlanningHref(back) : './twitch.html' + (back ? '?' + back : '');
  if (backView === 'archive') $('historyBack').textContent = '← 歷史資料庫';
  if (backView === 'streamer') $('historyBack').textContent = '← 開台選題';
  function syncURL() {
    params.set('game', id); params.set('metric', metric);
    for (const key of LEGACY_SCOPES) params.delete(key);
    if (region === 'global') params.delete('region'); else params.set('region', region);
    if (resolution) params.set('resolution', resolution); else params.delete('resolution');
    const next = new URLSearchParams(back).toString();
    if (next) params.set('back', next); else params.delete('back');
    history.replaceState(null, '', location.pathname + '?' + params + location.hash);
  }
  function message(text, error = false) { $('historyStatus').textContent = text; $('historyStatus').dataset.error = String(error); }
  function pageStatus(text, error = false) { $('gameStatus').textContent = text; $('gameStatus').dataset.error = String(error); $('gameStatus').hidden = !text; }
  async function read(path, contract) {
    const result = await RadarStorage.readJSONResult(path, contract, { force: true, allowStale: false });
    if (!result.data) throw new Error('暫時無法取得歷史資料，請稍後重新載入。');
    return result.data;
  }
  function context() {
    return { gameName: (game.display_name || game.name) + ' · ' + regionNames[region], region, scope: regionNames[region],
      trackingStatus: game.tracking_status, lastHour: game.last_hour, latestHour: new Date(window.latest).toISOString(),
      generatedAt: index.generated_at, releaseReference: currentLaunch(game, Date.now()), launchRecord: game };
  }
  // Steam's release time to the hour lives in the game's own file; without it
  // the launch rules count from 00:00 Taiwan time of the release date.
  async function steamReleaseTime() {
    const appid = steamAppOf(game);
    if (!appid) return null;
    if (releaseTime?.appid !== appid) {
      const file = await RadarStorage.loadGame(appid, { allowStale: false }).catch(() => null);
      releaseTime = { appid, value: file?.release_time_utc ?? null };
    }
    return releaseTime.value;
  }
  // The forecast's ratios ride along with the launch curves.
  async function forecastRatios() {
    const data = await RadarStorage.readJSON('./data/twitch-launch-curves.json', validCurves, { allowStale: false });
    return forecastModel(data?.forecast);
  }
  function panel(container, kind) {
    container.replaceChildren();
    const box = node('section', 'tw-region-panel'); box.dataset.region = region;
    const body = node('div'); body.id = kind + '-' + region;
    box.append(node('h3', 'tw-region-caption', regionNames[region]), body); container.append(box);
    return body;
  }
  function summaryValues(data) {
    const valid = data.map(row => valueOf(row, metric)).filter(value => value !== null);
    return [valid.length ? Math.max(...valid) : null,
      valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length * 10) / 10 : null,
      valid.at(-1), valid.length + ' / ' + data.length];
  }
  function renderSummary() {
    const labels = ['區間最高', '有紀錄時的平均', '區間最後一筆', '有紀錄的小時'];
    const values = summaryValues(projectRows(rows, region));
    $('historySummary').replaceChildren(...labels.map((label, i) => {
      const card = node('div', 'tw-history-stat');
      card.append(node('span', '', label), node('strong', '', typeof values[i] === 'string' ? values[i] : fmt(values[i])),
        node('small', '', i === 3 ? '缺資料不當成 0' : metrics[metric] + ' · ' + (metric === 'streamers' ? '台' : metric === 'median' ? '人／台' : '人')));
      return card;
    }));
  }
  function renderChart() {
    charts.forEach(dispose => dispose()); charts = [];
    const daily = metric === 'viewers' && rows.length > 24 && resolution !== 'hourly';
    $('historyResolution').hidden = metric !== 'viewers' || rows.length <= 24;
    document.querySelectorAll('[data-history-resolution]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.historyResolution === (daily ? 'daily' : 'hourly'))));
    const data = projectRows(rows, region);
    const root = panel($('historyChart'), 'historyChart');
    charts.push(mount(root, { rows: daily ? dailyRows(data, { region }) : data, gameName: (game.display_name || game.name) + ' · ' + regionNames[region],
      rangeOptions: [], initialRange: daily ? Number.MAX_SAFE_INTEGER : rows.length, rangeHours: rows.length,
      initialMetric: metric, granularity: daily ? 'daily' : 'hourly', domainMaximum: 0,
      ...(region === 'zh' ? { measurementChangeAt: CHINESE_MEASUREMENT_CHANGE_AT } : {}),
      ...(daily && region === 'global' ? { referenceValue: cooldownThreshold(region) } : {}),
      onMetricChange(value) {
        metric = value; syncURL(); renderHistory();
        $('historyChart').querySelector('.tw-chart-metric[data-metric="' + value + '"]')?.focus({ preventScroll: true });
      } }));
    $('historyChartNote').textContent = daily ? '每天的總觀眾取一天裡每小時的中間值，只算已結束的日子。' + (region === 'zh' ? '' : '虛線是全球熱門線。')
      : '每小時的數字是原始紀錄。單台觀眾中位數和每天的總觀眾是不同的數字。';
  }
  function table() {
    const data = projectRows(rows, region);
    const headers = ['時段（台灣）', ...['viewers', 'streamers', 'median'].map(key => metrics[key]), '目前指標狀態'];
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
      for (const key of ['viewers', 'streamers', 'median']) {
        const td = node('td', key === metric ? 'tw-selected-column' : '', fmt(valueOf(data[i], key)));
        td.title = statusOf(data[i], key); tr.append(td);
      }
      const scoped = data[i];
      const label = scoped.audience_region_status === 'unavailable' ? '未收集中文區' : scoped.status === 'missing' ? '無收集紀錄'
        : scoped.status === 'absent' ? '未列入觀測' : valueOf(scoped, metric) === null ? '此指標待補' : '已觀測';
      const status = node('td', '', label);
      status.title = statusOf(scoped, metric); tr.append(status); return tr;
    }));
    $('historyPagination').textContent = '第 ' + (page + 1) + ' / ' + pages + ' 頁 · 共 ' + rows.length + ' 個時段';
    $('historyPrevious').disabled = page === 0; $('historyNext').disabled = page === pages - 1;
  }
  function renderRemaining() {
    const box = $('remainingTrend');
    if (region !== 'zh' || !heat?.full) { box.replaceChildren(); return; }
    const through = dayOf(window.end);
    box.replaceChildren(renderRemainingTrend({ through, rows: remainingAudienceTrend(projectRows(heat.full, 'zh'), { date: through }) }));
  }
  function renderHistory() {
    renderChart(); renderSummary(); table(); renderRemaining();
    const count = projectRows(rows, region).filter(row => row.status === 'observed' && row.audience_region_status !== 'unavailable').length;
    message(regionNames[region] + ' · ' + rows.length + ' 個小時，' + count + ' 個小時有紀錄。');
  }
  async function renderVerdict() {
    const token = ++summaryRequest, version = request;
    try {
      const [full, releaseTimeUtc, model] = await Promise.all([fullHistoryLoader(), steamReleaseTime().catch(() => null),
        forecastRatios().catch(() => null)]);
      if (disposed || token !== summaryRequest || version !== request) return;
      // Launch advice, dark-horse labels and the forecast always read worldwide
      // viewers. A game no longer tracked replays its last tracked day.
      const last = Date.parse(game.last_hour);
      const now = game.tracking_status === 'ended' && Number.isFinite(last) ? Math.min(Date.now(), last + HOUR) : Date.now();
      const date = dayOf(now), globalRows = projectRows(full, 'global');
      const days = { global: analyzeStreamHeat(globalRows, { game, region: 'global', date, now }),
        zh: analyzeStreamHeat(projectRows(full, 'zh'), { game, region: 'zh', date, now }) };
      const latest = days.global.outlook.latest;
      const anchor = launchAnchor(game, globalRows, now, releaseTimeUtc), startAt = anchor?.startAt ?? null;
      const launch = { ...launchAdvice({ days: launchDays(globalRows, startAt, now), releaseAt: startAt, now, rows: globalRows,
        fallback: latest ? { date: latest.date, median: latest.median } : null }), small: !days.global.popularAt,
        peaks: launchPeaks(globalRows, game, now), anchor, forecast: launchForecast(globalRows, startAt, now, model) };
      heat = { full, days, launch };
      verdict.update({ days, launch, record: game, now, rows: full });
      renderRemaining();
      pageStatus('');
    } catch {
      if (disposed || token !== summaryRequest || version !== request) return;
      pageStatus('全期資料暫時無法讀取，請按重新載入。', true);
    }
  }
  async function renderStatistics() {
    if (!$('moreStatistics').open || !game || $('historyContent').hidden) return;
    const version = request, { createStatistics } = await loadStatistics();
    if (disposed || version !== request) return;
    $('historyStatistics').hidden = false;
    if (statsRegion !== region) {
      const view = stats?.view(); stats?.destroy();
      const root = panel($('statisticsPanels'), 'statisticsPanel'); statsRegion = region;
      root.className = 'tw-workspace tw-statistics';
      stats = createStatistics(root, { onViewChange(next) { $('historyStatistics').dataset.statisticsMode = next.mode; } });
      if (view) stats.setView(view);
    }
    stats.update(projectRows(rows, region), { gameName: (game.display_name || game.name) + ' · ' + regionNames[region], rangeLabel: $('historyRangeLabel').textContent });
    $('historyStatistics').dataset.statisticsMode = stats.view().mode;
  }
  async function renderCooldown() {
    if (!$('moreCooldown').open || !game || $('historyContent').hidden) return;
    const version = request, { createCooldown } = await loadCooldown();
    if (disposed || version !== request) return;
    $('historyCooldown').hidden = false;
    if (cooldownRegion !== region) {
      cooldown?.destroy();
      const root = panel($('cooldownPanels'), 'cooldownPanel'); cooldownRegion = region;
      root.className = 'tw-workspace tw-cooldown';
      cooldown = createCooldown(root, { onSummary(result) {
        $('historyCooldown').dataset.cooldownStatus = result.status;
        $('historyCooldown').dataset.cooldownModelStatus = result.data?.status || 'unavailable';
      } });
    }
    const next = context();
    next.loadHistory = async () => projectRows(await fullHistoryLoader(), region);
    cooldown.update(next);
  }
  function setRegion(value) {
    region = regionOf(value); syncURL();
    document.querySelectorAll('#pageRegion [data-region]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.region === region)));
    verdict.setRegion(region); slots.setRegion(region); launchCurves.render();
    if (!game || !window || $('historyContent').hidden) return;
    renderHistory(); renderStatistics(); renderCooldown();
  }
  async function load(refresh = false) {
    const token = ++request; summaryRequest++;
    if (refresh) { slots.reset(); launchCurves.reset(); }
    for (const key of ['historyCooldown', 'historyStatistics', 'historyContent']) $(key).hidden = true;
    stats?.hide(); cooldown?.hide();
    $('historyPanel').setAttribute('aria-busy', 'true'); $('historyExport').disabled = true; message('正在讀取逐時歷史…');
    pageStatus('正在讀取…');
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
      const name = game.display_name || game.name;
      document.title = name + '｜Twitch 遊戲頁｜Game Trend Radar'; $('pageTitle').textContent = name;
      const waiting = game.tracking_status === 'ended' ? waitingText(game) : null;
      metaLine = [gameMeta(game, dayOf(Date.now())), game.tracking_status === 'ended' ? (waiting || '已結束追蹤') : null].filter(Boolean).join('・');
      $('gameMeta').textContent = metaLine;
      $('historyUpdated').textContent = time(index.generated_at).slice(5) + ' 更新';
      const verdictLoad = renderVerdict();
      slots.update(index, id, chunksFor);
      launchCurves.update(id, game, window.end, refresh);
      const chunks = await chunksFor(monthsFor(window.start, window.end).filter(month => game.months.includes(month)));
      if (token !== request || disposed) return;
      rows = seriesRows(index, chunks, id, window.start, window.end, 'global'); page = 0;
      $('historyStart').value = dayOf(window.start); $('historyEnd').value = dayOf(window.end);
      $('historyStart').max = $('historyEnd').max = dayOf(window.latest);
      document.querySelectorAll('[data-history-range]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.historyRange === window.range)));
      $('historyRangeLabel').textContent = time(new Date(window.start).toISOString()) + ' — ' + time(new Date(window.end).toISOString()) + ' · 台灣時間' + (window.range !== 'custom' ? ' · 以這款最後一筆紀錄為準' : '');
      $('historyContent').hidden = false;
      renderHistory(); renderStatistics(); renderCooldown();
      await verdictLoad;
      syncURL();
      $('historyExport').disabled = false;
    } catch (error) {
      if (token === request && !disposed) { message(error.message || '歷史資料暫時無法載入。', true); pageStatus(error.message || '歷史資料暫時無法載入。', true); }
    } finally { if (token === request) $('historyPanel').setAttribute('aria-busy', 'false'); }
  }
  document.querySelectorAll('#pageRegion [data-region]').forEach(button => button.addEventListener('click', () => setRegion(button.dataset.region)));
  document.querySelectorAll('[data-history-resolution]').forEach(button => button.addEventListener('click', () => { resolution = button.dataset.historyResolution; syncURL(); renderHistory(); }));
  document.querySelectorAll('[data-history-range]').forEach(button => button.addEventListener('click', () => { params.set('range', button.dataset.historyRange); params.delete('start'); params.delete('end'); load(); }));
  $('historyDates').addEventListener('submit', event => { event.preventDefault(); params.set('range', 'custom'); params.set('start', $('historyStart').value); params.set('end', $('historyEnd').value); load(); });
  $('historyRefresh').addEventListener('click', () => load(true));
  $('historyPrevious').addEventListener('click', () => { page--; table(); }); $('historyNext').addEventListener('click', () => { page++; table(); });
  $('historyOrder').addEventListener('change', () => { descending = $('historyOrder').value === 'desc'; page = 0; table(); });
  $('historyExport').addEventListener('click', () => {
    if (!rows.length) return;
    const url = URL.createObjectURL(new Blob([csvRows(projectRows(rows, region))], { type: 'text/csv;charset=utf-8' }));
    const link = node('a'); link.href = url;
    link.download = 'twitch-' + id + (region === 'global' ? '' : '-' + region) + '-' + dayOf(window.start) + '-' + dayOf(window.end) + '.csv';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('moreCooldown').addEventListener('toggle', renderCooldown);
  $('moreStatistics').addEventListener('toggle', renderStatistics);
  if (location.hash === '#historyCooldown') $('moreCooldown').open = true;
  if (location.hash === '#historyStatistics') $('moreStatistics').open = true;
  setRegion(region);
  load();
  return () => { disposed = true; request++; summaryRequest++; events.abort(); slots.reset(); launchCurves.reset(); charts.forEach(dispose => dispose()); stats?.destroy(); cooldown?.destroy(); };
}
