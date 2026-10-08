import type { CatalogAPI, CatalogDataset, CatalogGame, CatalogMode } from './types';
import type { FilterState } from './filter-state';

export const NATIVE_PLATFORMS = ['NS', 'NS2', 'PS5'];
export function cardDate(game: CatalogGame, domain: CatalogAPI, event = false): string {
  if (event) return game.date;
  const dates = (Array.isArray(game.releases) ? game.releases : [])
    .filter((release: any) => release?.precision === 'day' && domain.validDate(release.date) &&
      ['Steam', ...NATIVE_PLATFORMS].includes(release.platform)).map((release: any) => release.date);
  return dates.sort()[0] || game.date;
}

export function releaseEventGames(games: CatalogGame[]): CatalogGame[] {
  const events = new Map<string, CatalogGame>();
  for (const game of games) {
    const key = `${game.identityKey || game.appid}@${game.date}`;
    if (!events.has(key)) events.set(key, game);
  }
  return [...events.values()];
}

export function selectCatalog(data: CatalogDataset | null, filters: FilterState, domain: CatalogAPI,
  discovery: CatalogAPI, saved: Set<number | string>) {
  if (!data) return { source: [], items: [], events: [] };
  const f = filters.state, mode: CatalogMode = filters.mode, today = filters.today;
  let source: CatalogGame[] = domain.selectGames(data, mode, today, f.date);
  if (mode === 'explore') source = source.filter(game => game.date >= today);
  if (mode === 'home') source = source.filter(game => game.date.startsWith(f.month));
  if (mode === 'saved') source = source.filter(game => domain.isSaved(game, saved));
  const term = f.term.trim().toLocaleLowerCase(), minimum = Number(f.minimum);
  const period = mode === 'all' ? f.period : '';
  const language = ['all', 'explore'].includes(mode) ? f.language : '';
  const events = releaseEventGames(source.filter(game =>
    (!term || `${game.name} ${game.nameEn} ${game.nameOriginalTw || ''} ${game.nameOriginalCn || ''} ${(game.nameSearchAliases || []).join(' ')} ${game.appid} ${mode === 'all' ? (game.tags || []).map((tag: string) => tag + ' ' + discovery.label(tag)).join(' ') : ''}`.toLocaleLowerCase().includes(term)) &&
    (minimum === 0 || (game.source !== 'nintendo' && game.followers >= minimum)) &&
    (mode !== 'explore' || discovery.matchesTags(game, f.tags)) &&
    (!period || (period === 'future' ? game.date >= today : game.date < today)) &&
    (!language || game.languages?.[language] === true) && (!f.savedOnly || domain.isSaved(game, saved))));
  const eventScoped = mode === 'home' || mode === 'date';
  const items: CatalogGame[] = eventScoped ? [...events] : domain.cardGames(events,
    f.sort === 'newest' || mode === 'released' ? 'latest' : 'earliest');
  items.sort((a, b) => f.sort === 'followers' ? domain.popularityCompare(a, b) : f.sort === 'name'
    ? a.name.localeCompare(b.name, 'zh-TW') : f.sort === 'newest'
      ? cardDate(b, domain, eventScoped).localeCompare(cardDate(a, domain, eventScoped)) || domain.popularityCompare(a, b)
      : cardDate(a, domain, eventScoped).localeCompare(cardDate(b, domain, eventScoped)) || domain.popularityCompare(a, b));
  return { source: eventScoped ? releaseEventGames(source) : domain.cardGames(source), items, events };
}
