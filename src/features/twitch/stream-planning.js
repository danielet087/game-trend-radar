import { RadarStorage } from '../../data/storage.ts';
import { archiveGames, selectArchive } from './archive-model.js';
import { regionNames, viewOf } from './audience-region.js';
import { node, time } from './presentation.js';
import { regionsFor } from './region-views.js';
import { dayOf, detailHref, monthsFor, validChunk, validIndex } from './series.js';
import { sortTrialGames, streamHour, trialGames, trialSample, trialWindow, TRIAL_MIN_DAYS } from './stream-planning-model.js';

const number = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });
const hourLabel = hour => String(hour).padStart(2, '0') + ':00';

async function read(path, validate, force) {
  const result = await RadarStorage.readJSONResult(path, validate, { force, allowStale:false });
  if (!result.data) throw new Error('觀測資料暫時無法讀取');
  return result.data;
}

export function createStreamPlanning({ $, signal }) {
  const hour = $('streamHour'), region = $('streamRegion'), order = $('streamOrder'), query = $('streamGameSearch');
  const status = $('streamPlanStatus'), results = $('streamTrialResults'), matches = $('streamGameMatches');
  const refresh = $('streamRefresh');
  let loaded = null, source = null, request = 0;

  for (let value = 0; value < 24; value++) {
    const option = node('option', '', hourLabel(value)); option.value = String(value); hour.append(option);
  }

  function saveURL() {
    const url = new URL(location.href);
    for (const [key, value, fallback] of [
      ['stream_hour', hour.value, '20'], ['stream_region', region.value, 'global'],
      ['stream_order', order.value, 'viewers'], ['stream_q', query.value.trim(), ''],
    ]) {
      if (value === fallback) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    history.replaceState(null, '', url);
  }

  function renderSearch() {
    if (!loaded) return;
    const term = query.value.trim();
    const games = term ? selectArchive(loaded.games, { query:term, filter:'all', sort:'recent' }).slice(0, 6) : [];
    if (!games.length) {
      matches.replaceChildren(node('p', 'tw-stream-muted', term ? '找不到已收錄的觀測紀錄。可以試試英文名稱或遊戲 ID。' : '輸入遊戲名稱，開啟熱度與續播建議。'));
      return;
    }
    matches.replaceChildren(...games.map(game => {
      const link = node('a', 'tw-stream-match');
      link.href = detailHref(game.id, location.search);
      link.append(node('strong', '', game.displayName), node('span', '', game.status === 'ended' ? '回看歷史判定 →' : '查看續播建議 →'));
      return link;
    }));
  }

  function row({ game, samples }, regions) {
    const card = node('article', 'tw-stream-game'); card.dataset.game = game.id;
    const gameInfo = node('div', 'tw-stream-game-info');
    if (game.cover) {
      const image = node('img'); image.src = game.cover; image.alt = ''; image.width = 44; image.height = 59;
      image.loading = 'lazy'; image.decoding = 'async'; gameInfo.append(image);
    }
    const copy = node('div');
    const link = node('a', '', game.displayName); link.href = detailHref(game.id, location.search);
    copy.append(link, node('small', '', `上市參考 ${game.releaseDate.replaceAll('-', '/')}${game.releaseSource ? ` · ${game.releaseSource}` : ''}`)); gameInfo.append(copy);
    const comparisons = node('div', 'tw-stream-comparisons');
    for (const key of regions) {
      const sample = samples[key];
      const panel = node('div', 'tw-stream-sample'); panel.dataset.region = key;
      panel.append(node('span', 'tw-stream-scope', regionNames[key]));
      if (sample.viewers === null) {
        panel.append(node('p', 'tw-stream-muted', '這個時段樣本不足'));
      } else {
        const metrics = node('dl', 'tw-stream-metrics');
        for (const [label, value, unit] of [['常見觀眾', sample.viewers, '人'], ['同時開台', sample.streamers, '台']]) {
          const metric = node('div');
          const display = Number.isInteger(value) ? number.format(value) : `約 ${number.format(Math.round(value))}`;
          metric.append(node('dt', '', label), node('dd', '', `${display} ${unit}`)); metrics.append(metric);
        }
        panel.append(metrics);
      }
      panel.append(node('small', '', `有量測 ${sample.days}／${sample.totalDays} 天`)); comparisons.append(panel);
    }
    card.append(gameInfo, comparisons);
    return card;
  }

  async function load(force = false) {
    const token = ++request;
    const active = () => token === request && !signal.aborted;
    status.textContent = '正在比對這個時段的觀眾與開台數…';
    results.replaceChildren();
    results.setAttribute('aria-busy', 'true'); refresh.disabled = true;
    if (!source || force) {
      const pending = read('./data/twitch_series/index.json', validIndex, force)
        .then(index => ({ index, games:archiveGames(index), chunks:new Map(), force }));
      source = pending;
      pending.catch(() => { if (source === pending) source = null; });
    }
    try {
      const state = await source;
      if (!active()) return;
      loaded = state; renderSearch();
      const period = trialWindow(hour.value), regions = regionsFor(region.value), primary = regions[0];
      const games = trialGames(state.index, state.games, period, primary);
      const months = monthsFor(period.start, period.end);
      const observations = await Promise.allSettled(games.map(async game => {
        const chunks = {};
        await Promise.all(months.filter(month => state.index.games[game.id].months?.includes(month)).map(async month => {
          const key = `${game.id}/${month}`;
          if (!state.chunks.has(key)) {
            const pending = read(`./data/twitch_series/${key}.json`, value => validChunk(value, game.id, month), state.force);
            state.chunks.set(key, pending);
            pending.catch(() => { if (state.chunks.get(key) === pending) state.chunks.delete(key); });
          }
          chunks[month] = await state.chunks.get(key);
        }));
        return { game, samples:Object.fromEntries(regions.map(key => [key, trialSample(state.index, chunks, game, period, key)])) };
      }));
      if (!active()) return;
      const errors = observations.filter(result => result.status === 'rejected').length;
      const ranked = sortTrialGames(observations.flatMap(result => result.status === 'fulfilled' ? [result.value] : []), primary, order.value);
      status.textContent = `${dayOf(period.start)} 至 ${dayOf(period.end)} · 每日 ${hourLabel(hour.value)}（台灣） · 資料更新 ${time(state.index.generated_at)}${errors ? ` · ${errors} 款暫無法讀取` : ''}`;
      results.replaceChildren(...ranked.map(entry => row(entry, regions)));
      if (!ranked.length) {
        results.append(node('p', 'tw-stream-muted', errors && errors === games.length
          ? '這個時段的歷史資料暫時無法讀取。請按重新讀取。'
          : `目前沒有至少 ${TRIAL_MIN_DAYS} 天有效紀錄、且這個時段有觀眾的新作。可以換個時段或範圍。`));
      }
    } catch {
      if (!active()) return;
      status.textContent = '觀測資料暫時無法讀取。請按重新讀取。';
      results.replaceChildren();
    } finally {
      if (active()) { results.setAttribute('aria-busy', 'false'); refresh.disabled = false; }
    }
  }

  for (const control of [hour, region, order]) control.addEventListener('change', () => { saveURL(); load(); }, { signal });
  query.addEventListener('input', () => { saveURL(); renderSearch(); }, { signal });
  refresh.addEventListener('click', () => load(true), { signal });
  return {
    open() {
      const params = new URLSearchParams(location.search);
      hour.value = String(streamHour(params.get('stream_hour')));
      region.value = viewOf(params.get('stream_region'));
      order.value = params.get('stream_order') === 'competition' ? 'competition' : 'viewers';
      query.value = (params.get('stream_q') || '').slice(0, 160);
      return load();
    },
    close() { request++; },
    refresh: () => load(true),
  };
}
