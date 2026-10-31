import { RadarStorage } from '../../data/storage.ts';
import { node, fmt, time } from './presentation.js';
import { validIndex, detailHref } from './series.js';
import { archiveStates, archiveGames, archiveURLState, selectArchive, PAGE_SIZE } from './archive-model.js';
import { regionNames, regionOf } from './audience-region.js';

export function createTwitchArchive({ $, signal }) {
  let state = archiveURLState(location.search), index, games = [], pending, timer, composing = false, hintQuery = '', failed = false;
  const active = () => !$('historyArchive').hidden;
  const on = (target, event, handler) => target.addEventListener(event, handler, { signal });
  function syncURL() {
    const url = new URL(location.href);
    for (const [key, value, defaultValue] of [['q', state.query, ''], ['archive_state', state.filter, 'all'],
      ['archive_sort', state.sort, 'recent'], ['archive_page', String(state.page), '1']]) {
      if (value === defaultValue) url.searchParams.delete(key); else url.searchParams.set(key, value);
    }
    history.replaceState(null, '', url);
  }
  function readURL() {
    clearTimeout(timer); state = archiveURLState(location.search);
    $('archiveSearch').value = state.query; $('archiveState').value = state.filter; $('archiveSort').value = state.sort;
  }
  function card(game) {
    const link = node('a', 'tw-archive-card'); link.href = detailHref(game.id, location.search);
    const identity = node('div', 'tw-archive-identity');
    const cover = node('span', 'tw-cover tw-archive-cover', game.displayName.charAt(0).toUpperCase());
    cover.setAttribute('aria-hidden', 'true');
    if (game.cover) {
      const image = node('img'); image.alt = ''; image.width = 144; image.height = 192;
      image.loading = 'lazy'; image.decoding = 'async';
      image.addEventListener('error', () => image.remove(), { once: true, signal });
      image.src = game.cover; cover.append(image);
    }
    const info = node('div', 'tw-archive-info');
    const badge = node('span', 'tw-state', archiveStates[game.status]);
    badge.dataset.tone = game.status === 'active' ? 'yes' : 'official';
    const title = node('h3', '', game.displayName); title.title = game.displayName;
    info.append(badge, title, node('p', '', game.name === game.displayName ? `TWITCH CATEGORY ${game.id}` : game.name));
    identity.append(cover, info);
    const period = node('div', 'tw-archive-period');
    period.append(node('span', '', '已保存觀測期間'), node('time', '', time(game.first)), node('time', '', `至 ${time(game.last)}`));
    const stats = node('dl', 'tw-archive-stats');
    for (const [label, value, unit] of [['紀錄筆數', game.samples, '筆'], ['最高觀眾', game.peak, '人']]) {
      const stat = node('div'); stat.append(node('dt', '', label), node('dd', '', fmt(value)), node('small', '', unit)); stats.append(stat);
    }
    link.append(identity, period, stats, node('span', 'tw-archive-open', '查看歷史 →'));
    if (!game.regionAvailable) link.append(node('p', '', '未收集中文區'));
    return link;
  }
  function render() {
    if (!active() || signal.aborted || !index) return;
    const region = regionOf(new URLSearchParams(location.search).get('region'));
    games = archiveGames(index, region);
    const selected = selectArchive(games, state), pages = Math.max(1, Math.ceil(selected.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages); syncURL();
    $('archiveUpdated').textContent = `更新 ${time(index.generated_at)}（台灣）`;
    $('archiveStatus').textContent = `${regionNames[region]} · ${failed ? '更新失敗，保留上次讀取的資料 · ' : ''}共保存 ${fmt(games.length)} 款遊戲${selected.length !== games.length ? ` · 符合 ${fmt(selected.length)} 款` : ''}`;
    $('archiveReset').hidden = !state.query && state.filter === 'all' && state.sort === 'recent';
    const cards = selected.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE).map(card);
    if (!cards.length) {
      const empty = node('div', 'tw-archive-empty');
      empty.append(node('h3', '', games.length ? '沒有符合的歷史紀錄' : '尚無已發布的歷史紀錄'),
        node('p', '', games.length ? '試試中文、英文名稱或遊戲 ID，或清除狀態篩選。' : '收集完成並發布後，遊戲會出現在這裡。'));
      cards.push(empty);
    }
    $('archiveResults').replaceChildren(...cards);
    $('archivePagination').hidden = selected.length <= PAGE_SIZE;
    $('archivePage').textContent = `第 ${state.page} / ${pages} 頁`;
    $('archivePrevious').disabled = state.page === 1; $('archiveNext').disabled = state.page === pages;
  }
  function paintHint() {
    if (signal.aborted) return;
    const found = hintQuery.trim() && index ? selectArchive(games, { query: hintQuery, filter: 'all', sort: 'recent' }).length : 0;
    $('archiveSearchHint').hidden = !found;
    if (found) {
      const params = new URLSearchParams(location.search);
      params.set('view', 'archive'); params.set('q', hintQuery);
      for (const key of ['archive_page', 'archive_state']) params.delete(key);
      $('archiveSearchHint').textContent = `歷史資料庫找到 ${fmt(found)} 款相關遊戲（含已結束追蹤）· 前往查看 →`;
      $('archiveSearchHint').href = `./twitch.html?${params}`;
    }
  }
  async function load(refresh = false) {
    if (pending) return pending;
    if (index && !refresh) { render(); paintHint(); return; }
    $('archiveResults').setAttribute('aria-busy', 'true'); $('archiveRefresh').disabled = true;
    if (active()) $('archiveStatus').textContent = '正在讀取歷史資料庫…';
    pending = (async () => {
      try {
        const result = await RadarStorage.readJSONResult('./data/twitch_series/index.json', validIndex, { force: true, allowStale: false });
        if (signal.aborted) return;
        if (!result.data) throw new Error('Unavailable');
        index = result.data; games = archiveGames(index); failed = false; render(); paintHint();
      } catch {
        if (signal.aborted) return;
        failed = true;
        if (index) render();
        else {
          $('archiveStatus').textContent = '歷史資料暫時無法讀取，請按「重新載入」再試。';
          $('archiveResults').replaceChildren(node('p', 'tw-archive-empty', '目前無法取得已保存紀錄，請稍後重試。'));
        }
      } finally {
        pending = null;
        if (!signal.aborted) { $('archiveResults').setAttribute('aria-busy', 'false'); $('archiveRefresh').disabled = false; }
      }
    })();
    return pending;
  }
  function flushSearch(resetPage = true) {
    clearTimeout(timer);
    const query = $('archiveSearch').value.slice(0, 160);
    if (resetPage || state.query !== query) state.page = 1;
    state.query = query; syncURL(); render();
  }
  function search() { clearTimeout(timer); if (!composing) timer = setTimeout(flushSearch, 140); }
  on($('archiveSearch'), 'compositionstart', () => { composing = true; clearTimeout(timer); });
  on($('archiveSearch'), 'compositionend', () => { composing = false; search(); });
  on($('archiveSearch'), 'input', search);
  on($('archiveSearch'), 'keydown', event => { if (!event.isComposing && event.key === 'Escape') { $('archiveSearch').value = ''; flushSearch(); } });
  for (const [id, key] of [['archiveState', 'filter'], ['archiveSort', 'sort']]) on($(id), 'change', () => {
    state[key] = $(id).value; flushSearch();
  });
  on($('archiveReset'), 'click', () => {
    state = { query: '', filter: 'all', sort: 'recent', page: 1 }; syncURL(); readURL(); render(); $('archiveSearch').focus();
  });
  on($('archiveRefresh'), 'click', () => load(true));
  for (const [id, change] of [['archivePrevious', -1], ['archiveNext', 1]]) on($(id), 'click', () => {
    state.page += change; syncURL(); render(); $('archiveTitle').focus({ preventScroll: true });
    $('historyArchive').scrollIntoView({ block: 'start' });
  });
  return { readURL, render, load, flushSearch,
    updateHint(query) { hintQuery = query; paintHint(); if (query.trim() && !index) load(); },
    destroy() { clearTimeout(timer); } };
}

