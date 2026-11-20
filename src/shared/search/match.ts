// Site search over every published game and TAG: pure index building and
// matching, so the header and the tests share one set of rules.

export interface SearchChip { label: string; family: string }
export interface SearchGame {
  key: string;
  name: string;
  sub: string;
  appid: string;
  url: string;
  art: string;
  date: string;
  chips: SearchChip[];
  interest: string;
  popularity: number;
  fields: string[];
}
export interface SearchTag { key: string; label: string; count: number; url: string; fields: string[] }
export interface SearchIndex {
  today: string;
  games: SearchGame[];
  tags: SearchTag[];
  // What the 全部遊戲 page matches, per game, so 「看全部 N 筆」 states its count.
  page: { identity: string; text: string }[];
}
export interface Part { text: string; hit: boolean }
export interface GameHit extends SearchGame { titleParts: Part[]; subParts: Part[]; status: string; statusKind: string; exact: boolean }
export interface TagHit extends SearchTag { labelParts: Part[]; keyParts: Part[] }
export interface SearchResult {
  query: string;
  games: GameHit[];
  gameCount: number;
  tags: TagHit[];
  tagCount: number;
  pageCount: number;
  allURL: string;
}

export const LIMITS = { games: 6, tags: 3 };

/** Width, case and spacing never decide a match: 「ＫＩＮＧＤＯＭ」 finds Kingdom. */
export const normalize = (value: unknown): string =>
  String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();

export function daysBetween(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}

export function releaseStatus(today: string, date: string): { status: string; kind: string } {
  const days = daysBetween(today, date);
  if (!Number.isFinite(days)) return { status: '', kind: 'unknown' };
  if (days === 0) return { status: '今天', kind: 'today' };
  return days > 0 ? { status: `${days} 天後`, kind: 'upcoming' } : { status: '已上市', kind: 'released' };
}

/** The first place the query appears, marked; an unmatched text stays whole. */
export function highlight(text: string, query: string): Part[] {
  const value = String(text || ''), needle = String(query || '').trim().toLocaleLowerCase('en-US');
  if (!value) return [];
  const at = needle ? value.toLocaleLowerCase('en-US').indexOf(needle) : -1;
  if (at < 0) return [{ text: value, hit: false }];
  return [
    { text: value.slice(0, at), hit: false },
    { text: value.slice(at, at + needle.length), hit: true },
    { text: value.slice(at + needle.length), hit: false },
  ].filter(part => part.text);
}

function tier(fields: string[], query: string): number {
  let best = Infinity;
  for (const field of fields) {
    if (field.startsWith(query) || field.includes(` ${query}`)) return 1;
    if (field.includes(query)) best = 2;
  }
  return best;
}

export function searchIndex(index: SearchIndex | null, input: string, limits = LIMITS): SearchResult {
  const query = normalize(input), term = String(input || '').trim();
  const allURL = `./games.html?${new URLSearchParams({ q: term }).toString()}`;
  if (!index || !query) return { query: term, games: [], gameCount: 0, tags: [], tagCount: 0, pageCount: 0, allURL };
  const digits = /^\d+$/.test(query);
  const exact = digits ? index.games.filter(game => game.appid === query) : [];
  const ranked = index.games
    .filter(game => !exact.includes(game))
    .map(game => ({ game, rank: tier(game.fields, query) }))
    .filter(row => row.rank < Infinity)
    .sort((a, b) => a.rank - b.rank
      || Math.abs(daysBetween(index.today, a.game.date)) - Math.abs(daysBetween(index.today, b.game.date))
      || b.game.popularity - a.game.popularity
      || a.game.name.localeCompare(b.game.name, 'zh-TW'));
  const games = [...exact.map(game => ({ game, exact: true })), ...ranked.map(row => ({ game: row.game, exact: false }))];
  const tags = index.tags
    .map(tag => ({ tag, rank: tier(tag.fields, query) }))
    .filter(row => row.rank < Infinity)
    .sort((a, b) => a.rank - b.rank || b.tag.count - a.tag.count || a.tag.label.localeCompare(b.tag.label, 'zh-TW'));
  const pageTerm = term.toLocaleLowerCase();
  const pageCount = new Set(index.page.filter(row => row.text.includes(pageTerm)).map(row => row.identity)).size;
  return {
    query: term,
    games: games.slice(0, limits.games).map(({ game, exact: isExact }) => {
      const { status, kind } = releaseStatus(index.today, game.date);
      return { ...game, exact: isExact, status, statusKind: kind,
        titleParts: highlight(game.name, isExact ? '' : term), subParts: highlight(game.sub, isExact ? '' : term) };
    }),
    gameCount: games.length,
    tags: tags.slice(0, limits.tags).map(({ tag }) => ({ ...tag, labelParts: highlight(tag.label, term), keyParts: highlight(tag.key, term) })),
    tagCount: tags.length,
    pageCount,
    allURL,
  };
}

/** The most common TAGs, for the search's first screen. */
export function popularTags(index: SearchIndex | null, count = 6): SearchTag[] {
  return index ? [...index.tags].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-TW')).slice(0, count) : [];
}

interface Domain {
  selectGames(data: unknown, mode: string, today: string): any[];
  cardGames(games: any[]): any[];
  detailURL(game: any): string;
  releaseCardNames?(game: any, platforms?: string[]): { name: string; nameEn: string; edition: string };
  cardPlatformChips(game: any, platforms: string[] | null): { chips: { label: string; family: string }[] };
  consoleInterest(game: any): { text: string } | null;
}
interface Discovery { label(tag: string): string; url(tag?: string): string }

/** One entry per game, as the 全部遊戲 page shows them, and every TAG with its count. */
export function buildIndex(data: unknown, D: Domain, R: Discovery, today: string,
  cardDate: (game: any) => string = game => game.date): SearchIndex {
  const events = D.selectGames(data, 'all', today);
  const cards = D.cardGames(events);
  const number = new Intl.NumberFormat('zh-TW');
  const games: SearchGame[] = cards.map(game => {
    const names = D.releaseCardNames?.(game, game.releasePlatforms) || { name: game.name, nameEn: game.nameEn, edition: '' };
    const sub = names.nameEn && names.nameEn !== names.name ? names.nameEn : names.edition || '';
    const followers = Number.isFinite(game.followers) ? game.followers : null;
    return {
      key: String(game.identityKey || game.appid || game.igdbId || names.name),
      name: names.name,
      sub,
      appid: game.appid ? String(game.appid) : '',
      url: D.detailURL(game),
      art: String(game.art || ''),
      date: cardDate(game),
      chips: (D.cardPlatformChips(game, null)?.chips || []).map(chip => ({ label: chip.label, family: chip.family })),
      interest: followers !== null ? `${number.format(followers)} 人關注` : D.consoleInterest(game)?.text || '',
      popularity: followers ?? 0,
      fields: [game.name, game.nameEn, game.nameOriginalTw, game.nameOriginalCn, ...(game.nameSearchAliases || [])]
        .map(normalize).filter(Boolean),
    };
  });
  const counts = new Map<string, number>();
  for (const game of cards) for (const tag of new Set<string>(game.tags || [])) counts.set(tag, (counts.get(tag) || 0) + 1);
  const tags: SearchTag[] = [...counts].map(([key, count]) => {
    const label = R.label(key);
    return { key, label, count, url: R.url(key), fields: [normalize(label), normalize(key)] };
  });
  const page = events.map(game => ({
    identity: String(game.identityKey || game.appid),
    text: `${game.name} ${game.nameEn} ${game.nameOriginalTw || ''} ${game.nameOriginalCn || ''} ${(game.nameSearchAliases || []).join(' ')} ${game.appid} ${(game.tags || []).map((tag: string) => `${tag} ${R.label(tag)}`).join(' ')}`.toLocaleLowerCase(),
  }));
  return { today, games, tags, page };
}
