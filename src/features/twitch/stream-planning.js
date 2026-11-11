import { RadarStorage } from '../../data/storage.ts';
import { archiveGames, selectArchive } from './archive-model.js';
import { regionNames } from './audience-region.js';
import { filterNames, fmt, hourLabel, node } from './presentation.js';
import { regionsFor } from './region-views.js';
import { dateStart, dayOf, detailHref, monthsFor, validChunk, validIndex } from './series.js';
import { streamHour, trialBenchmarks, trialReason, trialSample, trialWindow } from './stream-planning-model.js';
import { selectObservation } from './selection.js';
import { OBSERVATION_PAGE_SIZE } from './state.js';

const comparisonRegions = regionsFor('compare');

async function read(path, validate, force) {
  const result = await RadarStorage.readJSONResult(path, validate, { force, allowStale:false });
  if (!result.data) throw new Error('觀測資料暫時無法讀取');
  return result.data;
}

export function createStreamPlanning({ $, signal, state, ensureSnapshot }) {
  const hour = $('streamHour'), query = $('streamGameSearch');
  const status = $('streamPlanStatus'), results = $('streamTrialResults'), matches = $('streamGameMatches');
  const refresh = $('streamRefresh'), more = $('streamLoadMore');
  let loaded = null, source = null, request = 0;

  for (let value = 0; value < 24; value++) {
    const option = node('option', '', hourLabel(value)); option.value = String(value); hour.append(option);
  }

  function saveURL() {
    const url = new URL(location.href);
    for (const [key, value, fallback] of [
      ['stream_hour', hour.value, '20'], ['stream_q', query.value.trim(), ''],
    ]) {
      if (value === fallback) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
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
      link.href = detailHref(game.id, location.search);
      link.append(node('strong', '', game.displayName), node('span', '', game.status === 'ended' ? '回看歷史判定 →' : '查看續播建議 →'));
      return link;
    }));
  }

  function row({ game, reference, canCompare, samples, message }, benchmarks) {
    const card = node('article', 'tw-stream-game'); card.dataset.game = game.game_id;
    const gameInfo = node('div', 'tw-stream-game-info');
    if (game.box_art_url) {
      const image = node('img'); image.src = game.box_art_url; image.alt = ''; image.width = 44; image.height = 59;
      image.loading = 'lazy'; image.decoding = 'async'; gameInfo.append(image);
    }
    const copy = node('div', 'tw-stream-game-copy');
    const title = node('h3', 'tw-stream-game-title');
    const name = node(canCompare ? 'a' : 'span', '', game.game_name);
    title.append(name);
    copy.append(title);
    if (reference?.precision === 'day' && Number.isFinite(dateStart(reference.date))) {
      const release = node('time', 'tw-stream-release', `上市參考 ${reference.date.replaceAll('-', '/')}`);
      release.dateTime = reference.date;
      if (reference.source) release.title = reference.source;
      copy.append(release);
    }
    if (canCompare) {
      name.href = detailHref(game.game_id, location.search);
      const compare = node('a', 'tw-stream-time-link', '比較時段 →');
      compare.href = `${name.getAttribute('href')}#trialTimes`;
      compare.setAttribute('aria-label', `比較 ${game.game_name} 的試播時段`);
      copy.append(compare);
    }
    gameInfo.append(copy);
    const comparisons = node('div', 'tw-stream-comparisons');
    for (const key of comparisonRegions) {
      const sample = samples?.[key];
      const available = sample?.viewers != null;
      const panel = node('div', 'tw-stream-sample');
      panel.dataset.region = key;
      panel.classList.toggle('tw-stream-sample-muted', !available);
      const head = node('div', 'tw-stream-sample-head');
      head.append(node('span', 'tw-stream-scope', regionNames[key]));
      if (sample) {
        const coverage = node('span', 'tw-stream-coverage');
        coverage.append(node('span', 'sr-only', '有量測 '), `${sample.days}/${sample.totalDays} 天`);
        head.append(coverage);
      }
      panel.append(head);
      const reason = sample ? trialReason(sample, benchmarks[key]) : message;
      if (reason) panel.append(node('p', 'tw-stream-reason', reason));
      if (available) {
        const metrics = node('dl', 'tw-stream-metrics');
        for (const [label, value, unit] of [['觀眾', sample.viewers, '人'], ['同時開台', sample.streamers, '台']]) {
          const metric = node('div');
          const number = node('dd', '', `${fmt(value)} `);
          number.append(node('span', '', unit));
          metric.append(node('dt', '', label), number);
          metrics.append(metric);
        }
        panel.append(metrics);
      }
      comparisons.append(panel);
    }
    card.append(gameInfo, comparisons);
    return card;
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
      const period = trialWindow(hour.value);
      const scope = `${visible.length} 款 · ${filterNames[state.filter]}${state.query ? ` · 搜尋「${state.query}」` : ''}`;
      status.textContent = `${scope} · 讀取試播資料…`;
      more.hidden = games.length === visible.length;
      more.textContent = `再看 ${Math.min(OBSERVATION_PAGE_SIZE, visible.length - games.length)} 款 ↓`;
      results.replaceChildren(...games.map(game => row({ game })));
      const archive = await history;
      if (!active()) return;
      loaded = archive;
      renderSearch();
      const months = monthsFor(period.start, period.end);
      const observations = await Promise.all(games.map(async game => {
        const id = game.game_id, record = archive?.index.games[id];
        const reference = record?.release_reference;
        const entry = { game, reference, canCompare:record?.archive_eligible === true && Array.isArray(record.months) && record.months.length > 0 };
        if (!archive) return { ...entry, message:'逐時資料暫時無法讀取' };
        if (!Array.isArray(record?.months) || !record.months.length) return { ...entry, message:'尚無逐時紀錄' };
        try {
          const chunks = Object.fromEntries(await Promise.all(months.filter(month => record.months.includes(month)).map(async month => {
            const key = `${id}/${month}`;
            if (!archive.chunks.has(key)) {
              const pending = read(`./data/twitch_series/${key}.json`, value => validChunk(value, id, month), archive.force);
              archive.chunks.set(key, pending);
              pending.catch(() => { if (archive.chunks.get(key) === pending) archive.chunks.delete(key); });
            }
            return [month, await archive.chunks.get(key)];
          })));
          const released = reference?.precision === 'day' ? dateStart(reference.date) : NaN;
          return { ...entry, samples:Object.fromEntries(comparisonRegions.map(key => [key, trialSample(archive.index, chunks, { id, released }, period, key)])) };
        } catch { return { ...entry, message:'逐時資料暫時無法讀取' }; }
      }));
      if (!active()) return;
      const benchmarks = Object.fromEntries(comparisonRegions.map(key => [key, trialBenchmarks(observations, key)]));
      const range = [period.start, period.end].map(date => dayOf(date).slice(5).replace('-', '/')).join('–');
      status.textContent = `${scope} · 量測 ${range}`;
      results.replaceChildren(...observations.map(entry => row(entry, benchmarks)));
      if (!games.length) results.append(node('p', 'tw-stream-muted', '目前觀測在這個條件下沒有遊戲。'));
    } catch {
      if (!active()) return;
      status.textContent = '觀測資料暫時無法讀取。請按重新讀取。';
      results.replaceChildren();
    } finally {
      if (active()) { results.setAttribute('aria-busy', 'false'); refresh.disabled = more.disabled = false; }
    }
  }

  hour.addEventListener('change', () => { saveURL(); load(); }, { signal });
  query.addEventListener('input', () => { saveURL(); renderSearch(); }, { signal });
  refresh.addEventListener('click', () => load(true), { signal });
  more.addEventListener('click', () => { state.limit += OBSERVATION_PAGE_SIZE; load(); }, { signal });
  return {
    open() {
      const params = new URLSearchParams(location.search);
      hour.value = String(streamHour(params.get('stream_hour')));
      query.value = (params.get('stream_q') || '').slice(0, 160);
      return load();
    },
    close() { request++; },
    refresh: () => load(true),
  };
}
