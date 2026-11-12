import { RadarStorage } from '../../data/storage.ts';
import { RadarData } from '../../domain/index.mjs';
import { archiveGames, selectArchive } from './archive-model.js';
import { regionNames } from './audience-region.js';
import { steamStoreLinks } from './identity.js';
import { canonicalID, HOUR } from './metrics.js';
import { filterNames, fmt, node } from './presentation.js';
import { projectRows, regionsFor } from './region-views.js';
import { dateStart, dayOf, detailHref, fullSeriesRows, validChunk, validIndex } from './series.js';
import { analyzeStreamHeat, streamHeatDate, streamHeatThrough, STREAM_HEAT_DAYS, STREAM_HEAT_FLOORS } from './stream-heat-model.js';
import { CHINESE_DAILY_HEAT_HITS, cooldownThreshold } from './cooldown-model.js';
import { selectObservation } from './selection.js';
import { OBSERVATION_PAGE_SIZE } from './state.js';

const comparisonRegions = regionsFor('compare');
const shortDate = date => date.slice(5).replace('-', '/');
const signalLabels = {
  hot:'有熱度', sporadic:'零星有熱度', low:'熱度偏低',
  cooled:'已退燒', suspected:'降溫觀察', recovered:'熱度回升', insufficient:'資料不足',
  rising:'熱度上升', falling:'熱度下滑', breakout:'黑馬竄起',
};

function heatHref(id, date, record) {
  const url = new URL(detailHref(id, location.search), location.href);
  url.searchParams.set('region', 'compare');
  const start = dateStart(date);
  if (Date.parse(record?.first_hour) < start + 24 * HOUR && Date.parse(record?.last_hour) >= start) {
    url.searchParams.set('range', 'custom');
    url.searchParams.set('start', date);
    url.searchParams.set('end', date);
  }
  return url.href;
}

function renderMetrics({ previous, recent, change }, region) {
  const metrics = node('dl', 'tw-stream-metrics');
  const absolute = change === null || (region === 'zh' && previous < STREAM_HEAT_FLOORS.zh);
  const delta = Math.round((absolute ? recent - previous : change) * 10) / 10 || 0;
  const rows = [
    [`前 ${STREAM_HEAT_DAYS} 日`, `${fmt(previous)} 人`],
    [`近 ${STREAM_HEAT_DAYS} 日`, `${fmt(recent)} 人`],
    ['變化', `${delta > 0 ? '+' : ''}${fmt(delta)}${absolute ? ' 人' : '%'}`],
  ];
  for (const [label, value] of rows) {
    const metric = node('div');
    if (label === '變化') metric.dataset.direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    metric.append(node('dt', '', label), node('dd', '', value));
    metrics.append(metric);
  }
  return metrics;
}

function dailyEvidence(day, region) {
  const latest = day.outlook.latest;
  if (region === 'global') {
    if (latest) return `${shortDate(latest.date)} 日中位數 ${fmt(latest.median)} 人 · 有效 ${latest.validHours}/24`;
    return day.validHours ? `${shortDate(day.date)} · 有效 ${day.validHours}/24` : '';
  }
  const sample = day.validHours || !latest ? day : {
    date:latest.date, hits:latest.thresholdHits, validHours:latest.validHours,
  };
  const gap = sample.signal === 'insufficient' ? ' · 資料不足' : '';
  return `${shortDate(sample.date)} · ${sample.hits} 次達 ${fmt(day.threshold)} 人 · 有效 ${sample.validHours}/24${gap}`;
}

async function read(path, validate, force) {
  const result = await RadarStorage.readJSONResult(path, validate, { force, allowStale:false });
  if (!result.data) throw new Error('觀測資料暫時無法讀取');
  return result.data;
}

export function createStreamPlanning({ $, signal, state, ensureSnapshot }) {
  const query = $('streamGameSearch'), dateInput = $('streamDate');
  const status = $('streamPlanStatus'), results = $('streamTrendResults'), matches = $('streamGameMatches');
  const refresh = $('streamRefresh'), more = $('streamLoadMore');
  let loaded = null, source = null, request = 0, selectedDate = null;

  const chineseThreshold = fmt(cooldownThreshold('zh')), hits = CHINESE_DAILY_HEAT_HITS;
  $('streamTrendRule').textContent = `比較前後各 ${STREAM_HEAT_DAYS} 個已結束日。前期達全球 ${fmt(STREAM_HEAT_FLOORS.global)} 人或中文區 ${fmt(STREAM_HEAT_FLOORS.zh)} 人，且下降至少 25%，標示熱度下滑。`;
  $('streamDailyRule').textContent = `中文區達 ${chineseThreshold} 人至少 ${hits} 次為「有熱度」，1–${hits - 1} 次為「零星有熱度」，0 次為「熱度偏低」。缺測可能改變是否達到 ${hits} 次時顯示「資料不足」。`;
  $('streamGlobalRule').textContent = `全球用每日觀眾中位數，熱度門檻為 ${fmt(cooldownThreshold('global'))} 人。中文區趨勢用每日第 ${hits} 高觀眾數。趨勢比較每日至少需 12 筆有效觀測。`;

  function saveURL() {
    const url = new URL(location.href);
    const term = query.value.trim();
    if (term) url.searchParams.set('stream_q', term);
    else url.searchParams.delete('stream_q');
    if (selectedDate) url.searchParams.set('stream_date', selectedDate);
    else url.searchParams.delete('stream_date');
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
    function renderHeat(days, message) {
      comparisons.replaceChildren(...comparisonRegions.map(key => {
        const day = days?.[key];
        const signal = day?.outlook.signal ?? (message ? 'insufficient' : 'loading');
        const panel = node('div', 'tw-stream-sample');
        panel.dataset.region = key;
        panel.dataset.signal = signal;
        const head = node('div', 'tw-stream-sample-head');
        head.append(node('span', 'tw-stream-scope', regionNames[key]));
        const label = signalLabels[signal];
        if (label) head.append(node('strong', 'tw-stream-signal', label));
        panel.append(head);
        const comparison = day?.outlook.comparison;
        if (comparison) panel.append(renderMetrics(comparison, key));
        const evidence = day ? dailyEvidence(day, key) : message;
        const confirmed = day?.outlook.confirmedOn;
        if (evidence || confirmed) panel.append(node('p', 'tw-stream-reason',
          [evidence, confirmed ? `${shortDate(confirmed)} 確認退燒` : ''].filter(Boolean).join(' · ')));
        const concentration = day?.concentration;
        if (concentration) {
          const metrics = node('p', 'tw-stream-concentration');
          metrics.append(
            node('span', '', `最大台占比 ${fmt(concentration.share)}%`),
            node('span', '', `其餘台 ${fmt(concentration.remaining)} 人`),
          );
          metrics.title = '當日有效逐時觀測的中位數';
          panel.append(metrics);
        }
        return panel;
      }));
    }
    function renderHistory(record, date) {
      const reference = record?.release_reference;
      if (reference?.precision === 'day' && Number.isFinite(dateStart(reference.date))) {
        const release = node('time', 'tw-stream-release', `上市參考 ${reference.date.replaceAll('-', '/')}`);
        release.dateTime = reference.date;
        if (reference.source) release.title = reference.source;
        copy.insertBefore(release, actions);
      }
      if (record?.archive_eligible === true && Array.isArray(record.months) && record.months.length) {
        const analysis = node('a', 'tw-stream-game-action', '詳細分析');
        analysis.href = heatHref(game.game_id, date, record);
        actions.append(analysis);
      }
    }
    card.append(gameInfo, comparisons);
    renderHeat();
    return { card, consoleId: steamPage ? null : canonicalID(game.igdb_id), linkProfile, renderHistory, renderHeat };
  }

  async function observeGame(id, record, archive, date, now) {
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
      const days = comparisonRegions.map(region => [region,
        analyzeStreamHeat(region === 'global' ? rows : projectRows(rows, region), { game:record, region, date, now })]);
      return { days:Object.fromEntries(days) };
    } catch { return { message:'逐時資料暫時無法讀取' }; }
  }

  async function load(force = false) {
    const now = Date.now(), date = streamHeatDate(selectedDate, now);
    dateInput.max = dayOf(now);
    dateInput.value = date;
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
        rows[index].renderHistory(record, date);
        const { days, message } = await observeGame(id, record, archive, date, now);
        if (active()) rows[index].renderHeat(days, message);
      }));
      if (!active()) return;
      status.textContent = `${scope} · 趨勢截至 ${shortDate(streamHeatThrough(date, now))}`;
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
  dateInput.addEventListener('change', () => {
    const now = Date.now(), date = streamHeatDate(dateInput.value, now);
    selectedDate = date === dayOf(now) ? null : date;
    load();
  }, { signal });
  refresh.addEventListener('click', () => load(true), { signal });
  more.addEventListener('click', () => { state.limit += OBSERVATION_PAGE_SIZE; load(); }, { signal });
  return {
    open() {
      const params = new URLSearchParams(location.search);
      query.value = (params.get('stream_q') || '').slice(0, 160);
      const now = Date.now(), date = streamHeatDate(params.get('stream_date'), now);
      selectedDate = date === dayOf(now) ? null : date;
      const limit = Number(params.get('stream_limit'));
      if (Number.isSafeInteger(limit) && limit > state.limit) state.limit = limit;
      return load();
    },
    close() { request++; },
    refresh: () => load(true),
  };
}
