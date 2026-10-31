import { canonicalID, count, timestamp, safeURL } from './metrics.js';

export const archiveStates = { all: '全部狀態', active: '追蹤中', ended: '已結束追蹤' };
export const archiveSorts = ['recent', 'peak', 'records', 'name'];
export const PAGE_SIZE = 24;
const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase('zh-TW');
const collator = new Intl.Collator('zh-TW', { numeric: true });

export function archiveURLState(search) {
  const params = new URLSearchParams(search), page = Number(params.get('archive_page'));
  return { query: (params.get('q') || '').slice(0, 160),
    filter: Object.hasOwn(archiveStates, params.get('archive_state')) ? params.get('archive_state') : 'all',
    sort: archiveSorts.includes(params.get('archive_sort')) ? params.get('archive_sort') : 'recent',
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1 };
}
export function archiveGames(index, region = 'global') {
  return Object.entries(index.games).flatMap(([id, game]) => {
    if (!canonicalID(id) || !game || game.archive_eligible !== true || !['active', 'ended'].includes(game.tracking_status) || !timestamp(game.first_hour) || !timestamp(game.last_hour) || game.sample_count === 0) return [];
    const name = typeof game.name === 'string' ? game.name : id;
    const displayName = typeof game.display_name === 'string' && game.display_name.trim() ? game.display_name : name;
    const cover = typeof game.box_art_url === 'string' ? game.box_art_url.replaceAll('{width}', '144').replaceAll('{height}', '192') : '';
    const scope = region === 'zh' ? game.audience_regions?.zh : game;
    return [{ id, name, displayName, first: game.first_hour, last: game.last_hour,
      cover: safeURL(cover, 'static-cdn.jtvnw.net'),
      status: game.tracking_status,
      samples: count(scope?.sample_count), peak: count(scope?.peak_viewer_count),
      region, regionAvailable: region !== 'zh' || scope?.sample_count > 0,
      search: normalize([id, name, displayName, ...(Array.isArray(game.aliases) ? game.aliases : []),
        ...(Array.isArray(game.steam_appids) ? game.steam_appids : [])].join(' ')) }];
  });
}
export function selectArchive(games, state) {
  const words = normalize(state.query).trim().split(/\s+/).filter(Boolean);
  return games.filter(game => (state.filter === 'all' || game.status === state.filter) && words.every(word => game.search.includes(word)))
    .sort((a, b) => {
      if (state.sort === 'name') return collator.compare(a.displayName, b.displayName) || a.id.localeCompare(b.id);
      const key = { peak: 'peak', records: 'samples' }[state.sort];
      return (key ? (b[key] ?? -1) - (a[key] ?? -1) : 0) || Date.parse(b.last) - Date.parse(a.last) || a.id.localeCompare(b.id);
    });
}

