import { RadarStorage } from '../../data/storage.ts';
import { archiveGames, selectArchive } from './archive-model.js';
import { regionNames } from './audience-region.js';
import { filterNames, fmt, node } from './presentation.js';
import { projectRows, regionsFor } from './region-views.js';
import { dateStart, detailHref, fullSeriesRows, validChunk, validIndex } from './series.js';
import { analyzeStreamHeat, streamHeatWindow, STREAM_HEAT_DAYS, STREAM_HEAT_FLOORS } from './stream-heat-model.js';
import { cooldownThreshold } from './cooldown-model.js';
import { selectObservation } from './selection.js';
import { OBSERVATION_PAGE_SIZE } from './state.js';

const comparisonRegions = regionsFor('compare');
const shortDate = date => date.slice(5).replace('-', '/');
const signalLabels = {
  cooled:'已退燒', suspected:'降溫觀察', recovered:'熱度回升', falling:'觀眾下滑',
  breakout:'黑馬竄起', rising:'熱度上升', hot:'仍有熱度', not_popular:'尚未熱門',
  insufficient:'資料不足', ended:'已結束追蹤',
};

function heatHref(id) {
  const url = new URL(detailHref(id, location.search), location.href);
  url.searchParams.set('region', 'compare');
  return url.href;
}

function evidence(trend) {
  switch (trend.signal) {
    case 'cooled': {
      const confirmed = trend.confirmedOn ? `${shortDate(trend.confirmedOn)} 確認 · ` : '';
      const rising = trend.previous.median !== null && trend.recent.median !== null && trend.recent.median > trend.previous.median;
      return `${confirmed}${trend.lowDays} 天低於 ${fmt(trend.threshold)} 人${rising ? '，近期回升' : '，可考慮收尾'}`;
    }
    case 'suspected': return `${trend.lowDays}/${trend.confirmDays} 天低於 ${fmt(trend.threshold)} 人，先觀察`;
    case 'breakout': return `${trend.growthDays}/${STREAM_HEAT_DAYS} 天達標，可先試播`;
    case 'rising': return `${trend.growthDays}/${STREAM_HEAT_DAYS} 天達成成長門檻`;
    case 'recovered': return `最新有效日回到 ${fmt(trend.threshold)} 人門檻`;
    case 'ended': return trend.lastDay ? `最後有效日 ${shortDate(trend.lastDay)}` : '';
    case 'insufficient': return '等待近期有效資料';
    default: return '';
  }
}

function renderMetrics(trend) {
  const metrics = node('dl', 'tw-stream-metrics');
  for (const [label, sample] of [['前 3 日', trend.previous], ['近 3 日', trend.recent]]) {
    const metric = node('div');
    const missing = sample.median === null;
    const value = missing ? `${sample.values.length}/${STREAM_HEAT_DAYS} 天有資料` : `${fmt(sample.median)} 人`;
    metric.append(node('dt', '', label), node('dd', missing ? 'tw-stream-metric-missing' : '', value));
    metrics.append(metric);
  }
  if (trend.change !== null) {
    const change = Math.round(trend.change * 10) / 10 || 0;
    const metric = node('div', 'tw-stream-delta');
    metric.dataset.direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
    metric.append(node('dt', '', '變化'), node('dd', '', `${change > 0 ? '+' : ''}${fmt(change)}%`));
    metrics.append(metric);
  }
  return metrics;
}

async function read(path, validate, force) {
  const result = await RadarStorage.readJSONResult(path, validate, { force, allowStale:false });
  if (!result.data) throw new Error('觀測資料暫時無法讀取');
  return result.data;
}

export function createStreamPlanning({ $, signal, state, ensureSnapshot }) {
  const query = $('streamGameSearch');
  const status = $('streamPlanStatus'), results = $('streamTrendResults'), matches = $('streamGameMatches');
  const refresh = $('streamRefresh'), more = $('streamLoadMore');
  let loaded = null, source = null, request = 0;

  const globalFloor = STREAM_HEAT_FLOORS.global, chineseFloor = STREAM_HEAT_FLOORS.zh;
  $('streamCooldownRule').textContent = `全球 ${fmt(cooldownThreshold('global'))} 人，中文區 ${fmt(cooldownThreshold('zh'))} 人。曾達各區門檻後，連續 3 個有效日低於該門檻。`;
  $('streamBreakoutRule').textContent = `較前 3 日成長至少 50%（基準為 0 時以增加人數判斷）。全球達 ${fmt(globalFloor)} 人且至少增加 ${fmt(globalFloor / 2)} 人，中文區達 ${fmt(chineseFloor)} 人且至少增加 ${fmt(chineseFloor / 2)} 人。近 3 日至少 2 天達標，包含最新一日，且此前未達區域門檻。`;

  function saveURL() {
    const url = new URL(location.href);
    const term = query.value.trim();
    if (term) url.searchParams.set('stream_q', term);
    else url.searchParams.delete('stream_q');
    history.replaceState(null, '', url);
  }

  function renderSearch() {
    const term = query.value.trim();
    if (!term) {
      matches.replaceChildren();
      return;
    }
    if (!loaded) {
      matches.replaceChildren(node('p', 'tw-stream-muted', '歷史搜尋暫無資料，可重新讀取。'));
      return;
    }
    const games = selectArchive(loaded.games, { query:term, filter:'all', sort:'recent' }).slice(0, 6);
    if (!games.length) {
      matches.replaceChildren(node('p', 'tw-stream-muted', '找不到遊戲，試試英文名稱或遊戲 ID。'));
      return;
    }
    matches.replaceChildren(...games.map(game => {
      const link = node('a', 'tw-stream-match');
      link.href = heatHref(game.id);
      link.append(node('strong', '', game.displayName), node('span', '', game.status === 'ended' ? '回看歷史判定 →' : '查看續播建議 →'));
      return link;
    }));
  }

  function row({ game, reference, canView, trends, message }) {
    const card = node('article', 'tw-stream-game'); card.dataset.game = game.game_id;
    const gameInfo = node('div', 'tw-stream-game-info');
    if (game.box_art_url) {
      const image = node('img'); image.src = game.box_art_url; image.alt = ''; image.width = 44; image.height = 59;
      image.loading = 'lazy'; image.decoding = 'async'; gameInfo.append(image);
    }
    const copy = node('div', 'tw-stream-game-copy');
    const title = node('h3', 'tw-stream-game-title');
    const name = node(canView ? 'a' : 'span', '', game.game_name);
    if (canView) {
      name.href = heatHref(game.game_id);
      const arrow = node('span', 'tw-stream-detail-arrow', ' →');
      arrow.setAttribute('aria-hidden', 'true');
      name.append(arrow);
    }
    title.append(name);
    copy.append(title);
    if (reference?.precision === 'day' && Number.isFinite(dateStart(reference.date))) {
      const release = node('time', 'tw-stream-release', `上市參考 ${reference.date.replaceAll('-', '/')}`);
      release.dateTime = reference.date;
      if (reference.source) release.title = reference.source;
      copy.append(release);
    }
    gameInfo.append(copy);
    const comparisons = node('div', 'tw-stream-comparisons');
    for (const key of comparisonRegions) {
      const trend = trends?.[key];
      const signal = trend?.signal ?? (message ? 'insufficient' : 'loading');
      const panel = node('div', 'tw-stream-sample');
      panel.dataset.region = key;
      panel.dataset.signal = signal;
      const head = node('div', 'tw-stream-sample-head');
      head.append(node('span', 'tw-stream-scope', regionNames[key]));
      if (signalLabels[signal]) head.append(node('strong', 'tw-stream-signal', signalLabels[signal]));
      panel.append(head);
      if (trend) panel.append(renderMetrics(trend));
      const reason = trend ? evidence(trend) : message;
      if (reason) panel.append(node('p', 'tw-stream-reason', reason));
      comparisons.append(panel);
    }
    card.append(gameInfo, comparisons);
    return card;
  }

  async function observeGame(game, archive, period) {
    const id = game.game_id, record = archive?.index.games[id];
    const entry = { game, reference:record?.release_reference,
      canView:record?.archive_eligible === true && Array.isArray(record.months) && record.months.length > 0 };
    if (!archive) return { ...entry, message:'逐時資料暫時無法讀取' };
    if (!Array.isArray(record?.months) || !record.months.length) return { ...entry, message:'尚無逐時紀錄' };
    try {
      const chunks = Object.fromEntries(await Promise.all(record.months.map(async month => {
        if (!Object.hasOwn(archive.index.months, month)) throw new Error('觀測月份無法確認');
        const key = `${id}/${month}`;
        if (!archive.chunks.has(key)) {
          const pending = read(`./data/twitch_series/${key}.json`, value => validChunk(value, id, month), archive.force);
          archive.chunks.set(key, pending);
          pending.catch(() => { if (archive.chunks.get(key) === pending) archive.chunks.delete(key); });
        }
        return [month, await archive.chunks.get(key)];
      })));
      const rows = fullSeriesRows(archive.index, chunks, id);
      const trends = comparisonRegions.map(region => [region,
        analyzeStreamHeat(region === 'global' ? rows : projectRows(rows, region), { game:record, region, period })]);
      return { ...entry, trends:Object.fromEntries(trends) };
    } catch { return { ...entry, message:'逐時資料暫時無法讀取' }; }
  }

  async function load(force = false) {
    const token = ++request;
    const active = () => token === request && !signal.aborted;
    status.textContent = '正在讀取目前觀測清單…';
    results.replaceChildren();
    results.setAttribute('aria-busy', 'true'); refresh.disabled = more.disabled = true;
    if (!source || force) {
      const pending = read('./data/twitch_series/index.json', validIndex, force)
        .then(index => ({ index, games:archiveGames(index), chunks:new Map(), force }))
        .catch(() => { if (source === pending) source = null; return null; });
      source = pending;
    }
    try {
      const history = source;
      await ensureSnapshot(force);
      if (!active()) return;
      if (!state.data) {
        status.textContent = '目前觀測清單暫時無法讀取。請按重新讀取。';
        more.hidden = true;
        return;
      }
      const { visible } = selectObservation(state);
      const games = visible.slice(0, state.limit);
      const period = streamHeatWindow();
      const scope = `${visible.length} 款 · ${filterNames[state.filter]}${state.query ? ` · 搜尋「${state.query}」` : ''}`;
      status.textContent = `${scope} · 讀取熱度資料…`;
      more.hidden = games.length === visible.length;
      more.textContent = `再看 ${Math.min(OBSERVATION_PAGE_SIZE, visible.length - games.length)} 款 ↓`;
      const placeholders = games.map(game => row({ game }));
      results.replaceChildren(...placeholders);
      const archive = await history;
      if (!active()) return;
      loaded = archive;
      renderSearch();
      await Promise.all(games.map(async (game, index) => {
        const entry = await observeGame(game, archive, period);
        if (active()) placeholders[index].replaceWith(row(entry));
      }));
      if (!active()) return;
      const range = [period.recent[0], period.recent.at(-1)].map(shortDate).join('–');
      status.textContent = `${scope} · 觀眾中位數 · 近 3 日 ${range}（台灣）`;
      if (!games.length) results.append(node('p', 'tw-stream-muted', '目前觀測在這個條件下沒有遊戲。'));
    } catch {
      if (!active()) return;
      status.textContent = '觀測資料暫時無法讀取。請按重新讀取。';
      results.replaceChildren();
    } finally {
      if (active()) { results.setAttribute('aria-busy', 'false'); refresh.disabled = more.disabled = false; }
    }
  }

  query.addEventListener('input', () => { saveURL(); renderSearch(); }, { signal });
  refresh.addEventListener('click', () => load(true), { signal });
  more.addEventListener('click', () => { state.limit += OBSERVATION_PAGE_SIZE; load(); }, { signal });
  return {
    open() {
      const params = new URLSearchParams(location.search);
      query.value = (params.get('stream_q') || '').slice(0, 160);
      return load();
    },
    close() { request++; },
    refresh: () => load(true),
  };
}
