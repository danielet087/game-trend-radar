import { RadarStorage } from '../../data/storage.ts';
import { canonicalID } from './metrics.js';
import { mount, valueOf, statusOf } from './chart.js';
import { node, fmt, time } from './presentation.js';
import { validIndex, validChunk, windowFor, monthsFor, seriesRows, overviewQuery, dayOf, metrics, csvRows } from './series.js';
import { createStatistics } from './statistics.js';
import { createCooldown } from './cooldown.js';

export function initTwitchDetail() {
  const $ = id => document.getElementById(id);
  let params = new URLSearchParams(location.search), metric = Object.hasOwn(metrics, params.get('metric')) ? params.get('metric') : 'viewers';
  const id = canonicalID(params.get('game')), cache = new Map();
  let index, game, window, rows = [], disposeChart, statistics, cooldown, fullHistoryLoader, page = 0, descending = true, request = 0;
  const back = overviewQuery(params.get('back') || '');
  $('historyBack').href = `./twitch.html${back ? `?${back}` : ''}`;
  if (new URLSearchParams(back).get('view') === 'archive') $('historyBack').textContent = '← 歷史資料庫';
  function message(text, error = false) {
    $('historyStatus').textContent = text;
    $('historyStatus').dataset.error = String(error);
  }
  function syncURL() {
    params.set('game', id); params.set('metric', metric);
    history.replaceState(null, '', `${location.pathname}?${params}`);
  }
  async function read(path, contract) {
    const result = await RadarStorage.readJSONResult(path, contract, { force: true, allowStale: false });
    if (!result.data) throw new Error('暫時無法取得歷史資料，請稍後重新載入。');
    return result.data;
  }
  function summary() {
    const valid = rows.map(row => valueOf(row, metric)).filter(value => value !== null);
    const cards = [
      ['區間最高', valid.length ? Math.max(...valid) : null],
      ['有效時段平均', valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length * 10) / 10 : null],
      ['區間最後有效值', valid.at(-1)],
      ['有效時段', `${valid.length} / ${rows.length}`],
    ];
    $('historySummary').replaceChildren(...cards.map(([label, value]) => {
      const card = node('div', 'tw-history-stat');
      card.append(node('span', '', label), node('strong', '', typeof value === 'string' ? value : fmt(value)),
        node('small', '', label === '有效時段' ? '缺測與未列入不當成 0' : `${metrics[metric]} · ${metric === 'streamers' ? '台' : metric === 'median' ? '人／台' : '人'}`));
      return card;
    }));
  }
  function table() {
    const ordered = rows.map((row, index) => ({ row, index }));
    if (descending) ordered.reverse();
    const pages = Math.max(1, Math.ceil(ordered.length / 24));
    page = Math.min(page, pages - 1);
    $('historyTableBody').replaceChildren(...ordered.slice(page * 24, (page + 1) * 24).map(({ row, index }) => {
      const tr = node('tr');
      const at = node('td'), select = node('button', 'tw-hour-link', time(row.hour));
      select.type = 'button'; select.title = '在圖表查看此時段';
      select.addEventListener('click', () => { disposeChart?.select(index); $('historyChart').scrollIntoView({ block: 'nearest' }); });
      at.append(select); tr.append(at);
      for (const key of ['viewers', 'streamers', 'median']) {
        const td = node('td', key === metric ? 'tw-selected-column' : '', fmt(valueOf(row, key)));
        td.title = statusOf(row, key); tr.append(td);
      }
      const label = row.status === 'missing' ? '無收集紀錄' : row.status === 'absent' ? '未列入觀測' : valueOf(row, metric) === null ? '此指標待補' : '已觀測';
      const status = node('td', '', label); status.title = statusOf(row, metric); tr.append(status);
      return tr;
    }));
    $('historyPagination').textContent = `第 ${page + 1} / ${pages} 頁 · 共 ${rows.length} 個時段`;
    $('historyPrevious').disabled = page === 0; $('historyNext').disabled = page === pages - 1;
  }
  async function load(refresh = false) {
    const token = ++request;
    $('historyCooldownJump').hidden = true;
    if (cooldown) cooldown.hide();
    else $('historyCooldown').hidden = true;
    $('historyStatisticsJump').hidden = true;
    if (statistics) statistics.hide();
    else $('historyStatistics').hidden = true;
    $('historyContent').hidden = true; $('historyPanel').setAttribute('aria-busy', 'true');
    $('historyExport').disabled = true; message('正在讀取逐時歷史…');
    try {
      if (!id) throw new Error('缺少有效的遊戲 ID，請返回 Twitch 新作觀測選擇遊戲。');
      if (!index || refresh) {
        fullHistoryLoader = null;
        cache.clear();
        const nextIndex = await read('./data/twitch_series/index.json', validIndex);
        if (token !== request) return;
        index = nextIndex;
      }
      if (token !== request) return;
      game = index.games[id];
      if (!game || game.archive_eligible !== true) throw new Error('這款遊戲未列入正式收錄的歷史資料庫，請返回清單選擇遊戲。');
      if (!Array.isArray(game.months)) throw new Error('這款遊戲尚無已發布的歷史紀錄，請返回清單或稍後重新載入。');
      if (!fullHistoryLoader) {
        const sourceIndex = index, sourceGame = game;
        let pendingHistory;
        fullHistoryLoader = () => {
          if (pendingHistory) return pendingHistory;
          pendingHistory = (async () => {
            const start = Date.parse(sourceGame.first_hour), end = Date.parse(sourceGame.last_hour);
            if (!Number.isFinite(start) || !Number.isFinite(end) || start > end)
              throw new Error('這款遊戲的完整觀測期間尚無法確認。');
            const historyChunks = {};
            await Promise.all(sourceGame.months.map(async month => {
              if (!cache.has(month)) cache.set(month, read(`./data/twitch_series/${id}/${month}.json`, value => validChunk(value, id, month)));
              const pendingMonth = cache.get(month);
              try { historyChunks[month] = await pendingMonth; }
              catch (error) { if (cache.get(month) === pendingMonth) cache.delete(month); throw error; }
            }));
            return seriesRows(sourceIndex, historyChunks, id, start, end);
          })().catch(error => { pendingHistory = null; throw error; });
          return pendingHistory;
        };
      }
      window = windowFor(params, index, game);
      const chunks = {};
      await Promise.all(monthsFor(window.start, window.end).filter(month => game.months.includes(month)).map(async month => {
        if (!cache.has(month)) cache.set(month, read(`./data/twitch_series/${id}/${month}.json`, value => validChunk(value, id, month)));
        const pendingMonth = cache.get(month);
        try { chunks[month] = await pendingMonth; } catch (error) { if (cache.get(month) === pendingMonth) cache.delete(month); throw error; }
      }));
      if (token !== request) return;
      rows = seriesRows(index, chunks, id, window.start, window.end); page = 0;
      const name = game.display_name || game.name;
      document.title = `${name} · Twitch 歷史趨勢｜Game Trend Radar`;
      $('pageTitle').textContent = name;
      $('historyCategory').textContent = `TWITCH CATEGORY ${id} · 全球觀測`;
      $('historySpan').textContent = `${game.tracking_status === 'ended' ? '已結束追蹤 · ' : ''}已保存 ${time(game.first_hour)} 至 ${time(game.last_hour)} 的觀測紀錄（台灣時間）`;
      $('historyUpdated').textContent = `資料更新 ${time(index.generated_at)}（台灣）`;
      $('historyStart').value = dayOf(window.start); $('historyEnd').value = dayOf(window.end);
      $('historyStart').max = $('historyEnd').max = dayOf(window.latest);
      document.querySelectorAll('[data-history-range]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.historyRange === window.range)));
      $('historyRangeLabel').textContent = `${time(new Date(window.start).toISOString())} — ${time(new Date(window.end).toISOString())} · 台灣時間${window.range !== 'custom' ? ' · 以本遊戲最後觀測時段為基準' : ''}`;
      $('historyContent').hidden = false;
      disposeChart?.();
      disposeChart = mount($('historyChart'), { rows, gameName: name, rangeOptions: [], initialRange: rows.length, initialMetric: metric,
        onMetricChange(value) { metric = value; syncURL(); summary(); table(); } });
      summary(); table(); syncURL();
      $('historyExport').disabled = false;
      const count = rows.filter(row => row.status === 'observed').length;
      message(`已載入 ${rows.length} 個時段，其中 ${count} 個有本遊戲的觀測紀錄。`);
      try {
        statistics ||= createStatistics($('historyStatistics'));
        statistics.update(rows, { gameName: name, rangeLabel: $('historyRangeLabel').textContent });
        $('historyStatisticsJump').hidden = false;
      } catch (error) {
        console.warn('Unable to display supplementary Twitch statistics:', error);
        statistics?.destroy(); statistics = null;
        $('historyStatistics').hidden = false;
        $('historyStatistics').replaceChildren(node('p', 'tw-detail-note', '統計分析暫時無法顯示，請重新載入再試。'));
      }
      try {
        cooldown ||= createCooldown($('historyCooldown'));
        cooldown.update({ gameName: name, trackingStatus: game.tracking_status, lastHour: game.last_hour,
          latestHour: new Date(window.latest).toISOString(), generatedAt: index.generated_at,
          releaseReference: game.release_reference, loadHistory: fullHistoryLoader });
        $('historyCooldownJump').hidden = false;
      } catch (error) {
        console.warn('Unable to display Twitch cooldown analysis:', error);
        cooldown?.destroy(); cooldown = null;
        $('historyCooldown').hidden = false;
        $('historyCooldown').replaceChildren(node('p', 'tw-detail-note', '退潮觀測暫時無法顯示，請重新載入再試。'));
      }
    } catch (error) {
      if (token === request) message(error.message || '歷史資料暫時無法載入。', true);
    } finally {
      if (token === request) $('historyPanel').setAttribute('aria-busy', 'false');
    }
  }
  document.querySelectorAll('[data-history-range]').forEach(button => button.addEventListener('click', () => {
    params.set('range', button.dataset.historyRange); params.delete('start'); params.delete('end'); load();
  }));
  $('historyDates').addEventListener('submit', event => {
    event.preventDefault();
    params.set('range', 'custom'); params.set('start', $('historyStart').value); params.set('end', $('historyEnd').value); load();
  });
  $('historyRefresh').addEventListener('click', () => load(true));
  $('historyPrevious').addEventListener('click', () => { page--; table(); });
  $('historyNext').addEventListener('click', () => { page++; table(); });
  $('historyOrder').addEventListener('change', () => { descending = $('historyOrder').value === 'desc'; page = 0; table(); });
  $('historyExport').addEventListener('click', () => {
    if (!rows.length) return;
    const url = URL.createObjectURL(new Blob([csvRows(rows)], { type: 'text/csv;charset=utf-8' }));
    const link = node('a'); link.href = url; link.download = `twitch-${id}-${dayOf(window.start)}-${dayOf(window.end)}.csv`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  load();
  return () => { request++; disposeChart?.(); statistics?.destroy(); cooldown?.destroy(); };
}
