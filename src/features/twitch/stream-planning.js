import { RadarStorage } from '../../data/storage.ts';
import { RadarData } from '../../domain/index.mjs';
import { archiveGames, selectArchive } from './archive-model.js';
import { regionNames } from './audience-region.js';
import { steamStoreLinks } from './identity.js';
import { canonicalID } from './metrics.js';
import { filterNames, fmt, hourLabel, node } from './presentation.js';
import { projectRows, regionsFor } from './region-views.js';
import { dateStart, detailHref, fullSeriesRows, validChunk, validIndex } from './series.js';
import { analyzeStreamHeat, streamHeatWindow, STREAM_EVENING, STREAM_HEAT_DAYS, STREAM_HEAT_FLOORS } from './stream-heat-model.js';
import { cooldownThreshold } from './cooldown-model.js';
import { selectObservation } from './selection.js';
import { OBSERVATION_PAGE_SIZE } from './state.js';

const comparisonRegions = regionsFor('compare');
const eveningRange = `${hourLabel(STREAM_EVENING.startHour)}–23:59`;
const shortDate = date => date.slice(5).replace('-', '/');
const signalLabels = {
  cooled:'已退燒', suspected:'降溫觀察', recovered:'熱度回升', falling:'觀眾下滑',
  breakout:'黑馬竄起', rising:'熱度上升', hot:'仍有熱度', not_popular:'尚未熱門',
  insufficient:'資料不足', ended:'已結束追蹤',
};
const eveningSignalLabels = { hot:'晚間有熱度', not_popular:'晚間觀眾少' };

function heatHref(id) {
  const url = new URL(detailHref(id, location.search), location.href);
  url.searchParams.set('region', 'compare');
  return url.href;
}

function evidence(trend, wholeDay = false) {
  switch (trend.signal) {
    case 'cooled': {
      const confirmed = trend.confirmedOn ? `${shortDate(trend.confirmedOn)} 確認 · ` : '';
      const detail = `${confirmed}${trend.lowDays} 天低於 ${fmt(trend.threshold)} 人`;
      if (wholeDay) return detail;
      const rising = trend.previous.median !== null && trend.recent.median !== null && trend.recent.median > trend.previous.median;
      return detail + (rising ? '，近期回升' : '，可考慮收尾');
    }
    case 'suspected': {
      const detail = `${trend.lowDays}/${trend.confirmDays} 天低於 ${fmt(trend.threshold)} 人`;
      return wholeDay ? detail : `${detail}，先觀察`;
    }
    case 'breakout': return `${trend.growthDays}/${STREAM_HEAT_DAYS} 天達標，可先試播`;
    case 'rising': return `${trend.growthDays}/${STREAM_HEAT_DAYS} 天達成成長門檻`;
    case 'recovered': return `最新有效日回到 ${fmt(trend.threshold)} 人門檻`;
    case 'ended': return trend.lastDay ? `最後有效日 ${shortDate(trend.lastDay)}` : '';
    case 'insufficient': return '等待近期有效資料';
    default: return '';
  }
}

function renderMetrics(trend, region) {
  const metrics = node('dl', 'tw-stream-metrics');
  for (const [label, sample] of [['前 3 日', trend.previous], ['近 3 日', trend.recent]]) {
    const metric = node('div');
    const missing = sample.median === null;
    const value = missing ? `${sample.values.length}/${STREAM_HEAT_DAYS} 天有資料` : `${fmt(sample.median)} 人`;
    metric.append(node('dt', '', label), node('dd', missing ? 'tw-stream-metric-missing' : '', value));
    metrics.append(metric);
  }
  const smallChineseBase = region === 'zh' && trend.previous.median !== null && trend.recent.median !== null &&
    trend.previous.median < STREAM_HEAT_FLOORS.zh;
  const delta = smallChineseBase ? trend.recent.median - trend.previous.median : trend.change;
  if (delta !== null) {
    const change = Math.round(delta * 10) / 10 || 0;
    const metric = node('div', 'tw-stream-delta');
    metric.dataset.direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
    metric.append(node('dt', '', '變化'), node('dd', '', `${change > 0 ? '+' : ''}${fmt(change)}${smallChineseBase ? ' 人' : '%'}`));
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
  const chineseThreshold = fmt(cooldownThreshold('zh'));
  $('streamEveningRule').textContent = `中文區採台灣 ${eveningRange}，每晚至少 ${STREAM_EVENING.minHours} 筆。晚間近 3 日中位數至少 ${chineseThreshold} 人為有熱度。前 3 日中位數低於 ${fmt(chineseFloor)} 人時顯示增減人數。`;
  $('streamCooldownRule').textContent = `依全天每日中位數判定。全球 ${fmt(cooldownThreshold('global'))} 人，中文區 ${chineseThreshold} 人。曾達各區門檻後，連續 3 個有效日低於該門檻。`;
  $('streamBreakoutRule').textContent = `較前 3 日成長至少 50%（基準為 0 時以增加人數判斷）。全球達 ${fmt(globalFloor)} 人且至少增加 ${fmt(globalFloor / 2)} 人，中文區晚間達 ${fmt(chineseFloor)} 人且至少增加 ${fmt(chineseFloor / 2)} 人。近 3 日至少 2 天達標，包含最新一日，且此前未達區域門檻。`;

  function saveURL() {
    const url = new URL(location.href);
    const term = query.value.trim();
    if (term) url.searchParams.set('stream_q', term);
    else url.searchParams.delete('stream_q');
    if (state.limit > OBSERVATION_PAGE_SIZE) url.searchParams.set('stream_limit', String(state.limit));
    else url.searchParams.delete('stream_limit');
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

  function row(game, steamPages) {
    const card = node('article', 'tw-stream-game'); card.dataset.game = game.game_id;
    const gameInfo = node('div', 'tw-stream-game-info');
    if (game.box_art_url) {
      const image = node('img'); image.src = game.box_art_url; image.alt = ''; image.width = 44; image.height = 59;
      image.loading = 'lazy'; image.decoding = 'async'; gameInfo.append(image);
    }
    const copy = node('div', 'tw-stream-game-copy');
    const title = node('h3', 'tw-stream-game-title', game.game_name);
    const actions = node('div', 'tw-stream-game-actions');
    const steamPage = steamStoreLinks(game).map(link => steamPages.get(link.steam_appid)).find(Boolean);
    function linkProfile(href) {
      const profile = node('a', 'tw-stream-game-action', '遊戲頁');
      profile.href = href;
      profile.setAttribute('aria-label', `遊戲頁（${game.game_name}）`);
      actions.prepend(profile);
    }
    if (steamPage) linkProfile(steamPage);
    copy.append(title, actions);
    gameInfo.append(copy);
    const comparisons = node('div', 'tw-stream-comparisons');
    function renderHeat(trends, message) {
      comparisons.replaceChildren(...comparisonRegions.map(key => {
        const trend = trends?.[key];
        const signal = trend?.signal ?? (message ? 'insufficient' : 'loading');
        const panel = node('div', 'tw-stream-sample');
        panel.dataset.region = key;
        panel.dataset.signal = signal;
        const head = node('div', 'tw-stream-sample-head');
        const scope = node('span', 'tw-stream-scope', regionNames[key]);
        scope.append(node('span', 'tw-stream-hours', key === 'zh' ? eveningRange : '全天'));
        head.append(scope);
        const label = (key === 'zh' ? eveningSignalLabels[signal] : null) ?? signalLabels[signal];
        if (label) head.append(node('strong', 'tw-stream-signal', label));
        panel.append(head);
        if (trend) panel.append(renderMetrics(trend, key));
        const concentration = trend?.concentration;
        if (concentration) {
          const metrics = node('p', 'tw-stream-concentration');
          metrics.append(
            node('span', '', `最大台占比 ${fmt(concentration.share)}%`),
            node('span', '', `其餘台 ${fmt(concentration.remaining)} 人`),
            node('span', 'tw-stream-concentration-coverage', `${concentration.nights}/${STREAM_HEAT_DAYS} 晚`),
          );
          metrics.title = '晚間逐時中位數，再取各晚中位數。';
          panel.append(metrics);
        }
        const reason = trend ? evidence(trend) : message;
        if (reason || trend?.wholeDay) {
          const notes = node('div', 'tw-stream-notes');
          if (reason) notes.append(node('p', 'tw-stream-reason', reason));
          if (trend?.wholeDay) {
            const daily = node('p', 'tw-stream-reason');
            daily.append(node('strong', '', `全天${signalLabels[trend.wholeDay.signal]}`),
              ` · ${evidence(trend.wholeDay, true)}`);
            notes.append(daily);
          }
          panel.append(notes);
        }
        return panel;
      }));
    }
    function renderHistory(record) {
      const reference = record?.release_reference;
      if (reference?.precision === 'day' && Number.isFinite(dateStart(reference.date))) {
        const release = node('time', 'tw-stream-release', `上市參考 ${reference.date.replaceAll('-', '/')}`);
        release.dateTime = reference.date;
        if (reference.source) release.title = reference.source;
        copy.insertBefore(release, actions);
      }
      if (record?.archive_eligible === true && Array.isArray(record.months) && record.months.length) {
        const analysis = node('a', 'tw-stream-game-action', '詳細分析');
        analysis.href = heatHref(game.game_id);
        actions.append(analysis);
      }
    }
    card.append(gameInfo, comparisons);
    renderHeat();
    return { card, consoleId: steamPage ? null : canonicalID(game.igdb_id), linkProfile, renderHistory, renderHeat };
  }

  async function observeGame(id, record, archive, period) {
    if (!archive) return { message:'逐時資料暫時無法讀取' };
    if (!Array.isArray(record?.months) || !record.months.length) return { message:'尚無逐時紀錄' };
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
      return { trends:Object.fromEntries(trends) };
    } catch { return { message:'逐時資料暫時無法讀取' }; }
  }

  async function load(force = false) {
    saveURL();
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
      const steamPages = new Map((state.data.public_catalog?.games || []).flatMap(raw => {
        const profile = RadarData.normalize(raw, true);
        return profile ? [[String(profile.appid), RadarData.detailURL(profile)]] : [];
      }));
      const rows = games.map(game => row(game, steamPages));
      results.replaceChildren(...rows.map(entry => entry.card));
      const consoleRows = rows.filter(entry => entry.consoleId);
      if (consoleRows.length) {
        RadarStorage.loadNintendo({ force, allowStale:false }).then(catalog => {
          if (!active()) return;
          const pages = new Map();
          for (const profile of RadarData.nintendoGames(catalog)) {
            const id = String(profile.igdbId);
            if (!pages.has(id)) pages.set(id, RadarData.detailURL(profile));
          }
          for (const entry of consoleRows) {
            const href = pages.get(entry.consoleId);
            if (href) entry.linkProfile(href);
          }
        }).catch(() => { /* Console profiles are independent of the observation list. */ });
      }
      const archive = await history;
      if (!active()) return;
      loaded = archive;
      renderSearch();
      await Promise.all(games.map(async (game, index) => {
        const id = game.game_id, record = archive?.index.games[id];
        rows[index].renderHistory(record);
        const { trends, message } = await observeGame(id, record, archive, period);
        if (active()) rows[index].renderHeat(trends, message);
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
      const limit = Number(params.get('stream_limit'));
      if (Number.isSafeInteger(limit) && limit > state.limit) state.limit = limit;
      return load();
    },
    close() { request++; },
    refresh: () => load(true),
  };
}
