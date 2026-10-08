import { shallowReactive } from 'vue';
import { RadarData } from '../../domain/index.mjs';
import { RadarStorage } from '../../data/storage.ts';
import { RadarDiscovery } from '../discovery/index.js';
import { RadarArtwork } from '../../shared/artwork.js';
import * as sharedFavorites from '../../shared/state/favorites';
import { createCalendarFeature } from '../calendar/calendar';
import { createDateNavigation } from '../calendar/date-navigation';
import { createTagExplorer } from '../tags/tag-explorer';
import { createCatalogFavorites } from '../favorites/catalog-favorites';
import { createCardFactory } from './GameCard';
import { FilterState, MONTH_PATTERN, PAGE_SIZE } from './filter-state';
import { cardDate, selectCatalog } from './selectors';
import { element as $, node, emptyState, createNotifier } from './dom';
import { createCatalogMotion } from './motion';
import { createCatalogStatus } from './status';
import { normalizeCatalog } from './boundary';
import type { CatalogAPI, CatalogGame, CatalogMode, CatalogState } from './types';

export interface CatalogContext {
  data?: CatalogAPI;
  discovery?: CatalogAPI;
  storage?: Pick<typeof RadarStorage, 'loadSources' | 'loadNintendo'> & Partial<Pick<typeof RadarStorage, 'loadNintendoResult'>>;
  favorites?: typeof sharedFavorites;
  artwork?: { load: (image: HTMLImageElement, game: CatalogGame, options: any) => void };
}

/** Page orchestration only: state, cards, calendar, tags and collection are separate features. */
export function initCatalogPage(context: CatalogContext = {}) {
  const D = context.data || RadarData, R = context.discovery || RadarDiscovery;
  const storage = context.storage || RadarStorage, collection = context.favorites || sharedFavorites;
  const mode = document.body.dataset.page as CatalogMode, today = D.todayInTaipei();
  const query = new URLSearchParams(location.search);
  const filters = new FilterState(mode, today, D, R, query, matchMedia('(max-width: 520px)').matches);
  const fieldIds = { term: 'searchInput', minimum: 'followersFilter', sort: 'sortSelect', period: 'releaseFilter', language: 'languageFilter' };
  const choices: Record<string, string[]> = {};
  for (const key of ['minimum', 'sort', 'period', 'language'] as const) {
    const control = $<HTMLSelectElement>(fieldIds[key]);
    if (control) choices[key] = [...control.options].map(option => option.value);
  }
  filters.configure(choices); filters.restore(query);
  const state = shallowReactive<CatalogState>({ model: null, viewModel: null, loading: true,
    limit: Math.max(PAGE_SIZE, window.RadarJourney?.restore?.limit || PAGE_SIZE) });
  const notify = createNotifier(), motion = createCatalogMotion(), signal = new AbortController();
  let searchTimer: ReturnType<typeof setTimeout> | undefined, running = false, disposed = false;
  const cancelSearch = () => clearTimeout(searchTimer);
  const cards = createCardFactory({ domain: D, discovery: R, mode, today, model: () => state.model, tags: () => filters.state.tags,
    isSaved: (game, entity) => collection.isSaved({ appid: game.appid, savedAliases: entity?.identity.savedAliases || game.savedAliases }),
    subscribeSaved: listener => collection.subscribeSaved(listener),
    artwork: context.artwork || RadarArtwork });
  const calendar = createCalendarFeature(D, filters, state, motion);
  const tags = mode === 'explore' ? createTagExplorer(R, filters, changeFilters, notify) : null;
  const dateNavigation = mode === 'date' ? createDateNavigation(D, filters, state, writeURL, render, cancelSearch) : null;
  const status = createCatalogStatus(D, state, mode, today);
  const empty = (title: string, text: string, action: {label: string; run: () => void} | null = null) => emptyState(mode, title, text, action);

  function syncControls() {
    for (const key of Object.keys(fieldIds) as (keyof typeof fieldIds)[]) {
      const control = $<HTMLInputElement | HTMLSelectElement>(fieldIds[key]);
      if (control) control.value = filters.state[key];
    }
    if (tags) $<HTMLSelectElement>('tagMatch').value = filters.state.tags.match;
  }
  function writeURL() {
    history.replaceState(history.state, '', filters.url(location.href)); dateNavigation?.refreshLinks();
  }
  function replaceCards(area: HTMLElement, games: CatalogGame[], event = false) {
    const retained = new Map([...area.querySelectorAll<HTMLElement>('.game-card[data-appid]')]
      .map(card => [card.dataset.gameKey || card.dataset.appid, card]));
    const next = games.map(game => {
      const old = retained.get(String(D.gameKey(game)));
      return old && cards.gameFor(old) === game ? old : cards.create(game, { event, eager: false, priority: false });
    });
    for (const old of retained.values()) if (!next.includes(old)) cards.dispose(old);
    area.replaceChildren(...next);
  }
  function renderHome() {
    if (mode !== 'home' || !state.viewModel) return;
    const data = state.viewModel;
    const upcoming: CatalogGame[] = D.cardGames(D.selectGames(data, 'upcoming', today));
    upcoming.sort((a, b) => cardDate(a, D).localeCompare(cardDate(b, D)) || D.popularityCompare(a, b));
    const recent: CatalogGame[] = D.cardGames(D.selectGames(data, 'released', today), 'latest');
    recent.sort((a, b) => cardDate(b, D).localeCompare(cardDate(a, D)) || D.popularityCompare(a, b));
    replaceCards($('spotlightGames'), upcoming.slice(0, 4));
    $('spotlightGames').setAttribute('aria-busy', 'false'); motion.reveal($('spotlightGames'));
    if (!upcoming.length) $('spotlightGames').append(empty('下一波新作，正在路上', '目前尚無未來 45 天內已收錄的遊戲。'));
    replaceCards($('recentGames'), recent.slice(0, 3)); motion.reveal($('recentGames'));
    if (!recent.length) $('recentGames').append(empty(data.recentAvailable ? '下一匹黑馬，值得等待' : '近期上市資料暫時無法讀取',
      data.recentAvailable ? '目前沒有符合條件的近期上市遊戲，確認發售與關注人數後就會加入。' : '稍後再試；已收錄的新作仍可正常瀏覽。'));
  }
  function renderEmpty(filtered: boolean) {
    let title = '這裡還有位置，留給下一款好遊戲', text = '目前沒有符合日期與關注人數條件的遊戲，資料會持續更新。';
    let action: {label: string; run: () => void} | null = null;
    if (!state.viewModel) {
      title = '遊戲資料暫時無法讀取'; text = '請稍後再試，你的收藏仍保留在這個瀏覽器。'; action = { label: '重新讀取', run: load };
    } else if (mode === 'date' && !filters.state.date) {
      title = '找不到指定日期'; text = '請使用上方「跳轉日期」選擇有效日期，或返回發售月曆。';
    } else if (filtered) {
      title = '雷達暫時沒有收到訊號'; text = '試試其他關鍵字，或清除篩選看看所有遊戲。'; action = { label: '清除篩選', run: resetFilters };
    } else if (mode === 'saved') {
      title = collection.readSaved().size ? '收藏的遊戲暫不在目前資料中' : '把第一款心動，放進收藏';
      text = collection.readSaved().size ? '收藏記錄仍然保留；遊戲重新出現在公開資料時，就會再次顯示。' : '在遊戲卡片點一下愛心，就能在這裡找到它。';
    } else if (mode === 'released' && !state.viewModel.recentAvailable) {
      title = '近期上市資料暫時無法讀取'; text = '請稍後再試。'; action = { label: '重新讀取', run: load };
    }
    if (mode === 'date' && filters.state.date && state.viewModel && !filtered) {
      title = '這一天，還沒有收錄的新作'; text = '使用上方的前一天／後一天，或跳轉日期，繼續看看其他新作。';
    }
    $('gamesGrid').append(empty(title, text, action));
  }
  function render() {
    const f = filters.state;
    tags?.renderSelection();
    if (mode === 'home') {
      $('calendarArea').hidden = f.view !== 'calendar'; $('gamesGrid').hidden = f.view === 'calendar';
      $('calendarView').setAttribute('aria-pressed', String(f.view === 'calendar')); $('listView').setAttribute('aria-pressed', String(f.view === 'list'));
      $('sortWrap').hidden = f.view === 'calendar'; $<HTMLInputElement>('monthPicker').value = f.month;
      $('monthLabel').textContent = `${f.month.slice(0, 4)} 年 ${Number(f.month.slice(5))} 月`;
    }
    const { source, items, events } = selectCatalog(state.viewModel, filters, D, R, collection.readSaved());
    $('savedFilter').setAttribute('aria-pressed', String(f.savedOnly)); $('resetFilters').hidden = !filters.active;
    if (state.loading) { if (mode === 'home') calendar.render([]); return; }
    const unit = mode === 'home' ? '筆發售' : '款';
    $('resultCount').textContent = state.viewModel ? `${mode === 'home' ? '本月' : '共'} ${items.length} ${unit}${filters.active ? ` / ${source.length} ${unit}` : ''}${mode === 'home' && !items.length ? ' · 尚無符合條件的遊戲' : ''}` : '資料暫時無法讀取';
    if (mode === 'home') calendar.render(events);
    const grid = $('gamesGrid'); grid.setAttribute('aria-busy', 'false'); motion.clear(grid);
    if (mode === 'home' && f.view === 'calendar') {
      replaceCards(grid, []); $('loadMoreWrap').hidden = true;
    } else {
      replaceCards(grid, items.slice(0, state.limit), mode === 'home' || mode === 'date');
      $('loadMoreWrap').hidden = items.length <= state.limit;
      if (!items.length) renderEmpty(filters.active);
      motion.reveal(grid);
    }
    document.dispatchEvent(new CustomEvent('radar:content-ready', { detail: { limit: state.limit } }));
  }
  function changeFilters() { cancelSearch(); state.limit = PAGE_SIZE; writeURL(); render(); }
  function resetFilters() {
    filters.reset(); syncControls(); tags?.reset(); state.limit = PAGE_SIZE; writeURL(); render(); $('searchInput').focus();
  }
  function bindFilters() {
    syncControls();
    const search = $<HTMLInputElement>('searchInput');
    const scheduleSearch = () => { cancelSearch(); searchTimer = setTimeout(changeFilters, 120); };
    search.addEventListener('input', event => { filters.state.term = search.value; cancelSearch(); if (!(event as InputEvent).isComposing) scheduleSearch(); }, { signal: signal.signal });
    search.addEventListener('compositionend', () => { filters.state.term = search.value; scheduleSearch(); }, { signal: signal.signal });
    for (const key of ['minimum', 'sort', 'period', 'language'] as const) {
      const control = $<HTMLSelectElement>(fieldIds[key]);
      if (control) control.addEventListener('change', () => { filters.state[key] = control.value; changeFilters(); }, { signal: signal.signal });
    }
    $('followersFilter').title = '數字門檻只篩選 Steam Followers；查看 IGDB 主機遊戲請選全部關注度';
    $('savedFilter').addEventListener('click', () => { filters.state.savedOnly = !filters.state.savedOnly; changeFilters(); }, { signal: signal.signal });
    $('resetFilters').addEventListener('click', resetFilters, { signal: signal.signal });
    $('loadMore').addEventListener('click', () => {
      const previous = state.limit; state.limit += PAGE_SIZE; render(); $('gamesGrid').querySelectorAll<HTMLElement>('.card-detail-link')[previous]?.focus();
    }, { signal: signal.signal });
    document.addEventListener('keydown', event => {
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !(event.target as Element).matches('input,textarea,select,[contenteditable="true"]')) { event.preventDefault(); search.focus(); }
      if (event.key === 'Escape' && event.target === search) { filters.state.term = ''; search.value = ''; changeFilters(); }
    }, { signal: signal.signal });
    window.addEventListener('popstate', () => {
      cancelSearch(); filters.restore(new URLSearchParams(location.search)); syncControls(); state.limit = PAGE_SIZE;
      tags?.render(); dateNavigation?.renderHeading(); render();
    }, { signal: signal.signal });
  }
  function bindPage() {
    if (mode === 'home') {
      $<HTMLInputElement>('searchInput').placeholder = '搜尋本月遊戲名稱或 ID…';
      const step = (direction: number) => {
        const [year, month] = filters.state.month.split('-').map(Number);
        const next = new Date(Date.UTC(year, month - 1 + direction, 1));
        if (next.getUTCFullYear() < 1900 || next.getUTCFullYear() > 2199) return;
        filters.state.month = next.toISOString().slice(0, 7); changeFilters();
      };
      $('prevMonth').addEventListener('click', () => step(-1), { signal: signal.signal });
      $('nextMonth').addEventListener('click', () => step(1), { signal: signal.signal });
      $('monthPicker').addEventListener('change', event => {
        const input = event.target as HTMLInputElement;
        if (!MONTH_PATTERN.test(input.value)) { input.value = filters.state.month; return; }
        filters.state.month = input.value; changeFilters();
      }, { signal: signal.signal });
      $('todayButton').addEventListener('click', () => { filters.state.month = today.slice(0, 7); changeFilters(); }, { signal: signal.signal });
      for (const view of ['calendar', 'list'] as const) $(view + 'View').addEventListener('click', () => { filters.state.view = view; changeFilters(); }, { signal: signal.signal });
    } else {
      const notes = { upcoming: '未來 45 天 · Steam／NS／NS2／PS5 平台別確切發售日', released: '近 30 天 · Steam／NS／NS2／PS5 已收錄發售紀錄',
        saved: '收藏儲存在此瀏覽器；此處顯示仍在目前公開資料內的遊戲。', date: 'Steam／NS／NS2／PS5 平台別確切發售日 · 平台類別 TAG 可移上查看完整平台',
        explore: '已收錄的 Steam／NS／NS2／PS5 遊戲 · TAG 依各資料來源', all: '本站所有公開收錄 · 包含待上市與既有上市紀錄' };
      $('scopeNote').textContent = notes[mode] || '';
      if (mode === 'saved') { $('savedFilter').hidden = true; filters.state.savedOnly = false; }
      dateNavigation?.bind(); tags?.bind();
    }
  }
  async function load() {
    if (running || disposed) return;
    running = true; state.loading = true; $('notice').hidden = true;
    $('updateText').textContent = $('resultCount').textContent = '正在讀取遊戲資料…'; $('gamesGrid').setAttribute('aria-busy', 'true');
    try {
      const [sources, nativeResult] = await Promise.all([storage.loadSources(), storage.loadNintendoResult
        ? storage.loadNintendoResult() : storage.loadNintendo().then(data => ({ data, status: data ? 'fresh' : 'unavailable' }))]);
      if (disposed) return;
      const { catalog: official, preview } = sources, nintendo = nativeResult.data;
      const normalized = normalizeCatalog({ official, preview, native: nintendo }, mode, R);
      state.model = normalized.model; state.viewModel = normalized.viewModel;
      if (mode === 'explore' && state.viewModel) tags!.setCatalog(R.catalog(D.cardGames(state.viewModel.games.filter(game => game.date >= today))));
      if (!state.viewModel) {
        $('updateText').textContent = '資料暫時無法讀取'; $('notice').replaceChildren(node('span', '', '暫時連不上遊戲資料，請稍後再試。'));
        const retry = node('button', '', '重新讀取'); retry.addEventListener('click', load); $('notice').append(retry); $('notice').hidden = false;
        if (mode === 'home') {
          replaceCards($('spotlightGames'), []); $('spotlightGames').append(empty('新作資料暫時無法讀取', '請使用下方「重新讀取」再試一次。')); $('spotlightGames').setAttribute('aria-busy', 'false');
          replaceCards($('recentGames'), []); $('recentGames').append(empty('近期上市資料暫時無法讀取', '稍後再回來看看。'));
        }
      } else {
        collection.registerSavedGames([...state.viewModel.games, ...state.viewModel.recent]); status.render(); renderHome();
        const stale = [];
        if (sources.catalogResult?.status === 'stale' || sources.previewResult?.status === 'stale') stale.push('Steam');
        if (nativeResult.status === 'stale') stale.push('IGDB 主機');
        if (stale.length) {
          $('notice').textContent = `${stale.join('、')} 最新資料暫時無法讀取，目前顯示上次成功載入的資料；各來源更新時間請見下方說明。`;
          $('notice').hidden = false;
        }
      }
    } catch (error) {
      if (disposed) return;
      console.error('Unable to render game data', error); state.model = null; state.viewModel = null;
      $('updateText').textContent = '資料格式暫時無法讀取'; $('notice').textContent = '遊戲資料格式暫時無法讀取，請稍後再試。'; $('notice').hidden = false;
    } finally { state.loading = false; running = false; if (!disposed) render(); }
  }
  const favorites = createCatalogFavorites(filters, render, cards.gameFor, notify, motion.celebrate, collection);
  bindFilters(); bindPage(); render();
  const ready = load();
  return { filters, state, ready, reload: load, render,
    dispose() { disposed = true; cancelSearch(); signal.abort(); dateNavigation?.dispose(); tags?.dispose(); favorites.dispose(); cards.disposeAll(); motion.dispose(); } };
}
