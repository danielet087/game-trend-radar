import { node } from '../catalog/dom';
import { artShape } from '../../shared/artwork.js';
import { releaseEventGames } from '../catalog/selectors';
import type { CatalogAPI, CatalogGame } from '../catalog/types';
import { addDays, dotDate, longDate, weekStart } from './dates';

/** 近期新作: a sideways strip of release days from a week ago to three weeks
    ahead that opens on today, like the dated software row on Nintendo's site. */
export const STRIP_BEFORE = 7;
export const STRIP_AFTER = 21;
export const STRIP_PER_DAY = 3;
const number = new Intl.NumberFormat('zh-TW');

export interface ReleaseDay { date: string; games: CatalogGame[]; total: number }

export function releaseDays(games: CatalogGame[], today: string, D: CatalogAPI): ReleaseDay[] {
  const from = addDays(today, -STRIP_BEFORE), to = addDays(today, STRIP_AFTER);
  const byDate = new Map<string, CatalogGame[]>();
  for (const game of releaseEventGames(games.filter(game => game.date >= from && game.date <= to))) {
    if (!byDate.has(game.date)) byDate.set(game.date, []);
    byDate.get(game.date)!.push(game);
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => {
    const ranked = [...list].sort(D.popularityCompare);
    return { date, games: ranked.slice(0, STRIP_PER_DAY), total: ranked.length };
  });
}

/** The day the strip opens on: today, else the next release day, else the last one. */
export function openingDay(days: ReleaseDay[], today: string) {
  return days.find(day => day.date >= today)?.date || days.at(-1)?.date || null;
}

function languageBadge(game: CatalogGame) {
  if (game.source === 'nintendo' || !game.releasePlatforms?.includes('Steam') && game.releasePlatforms?.length)
    return { label: '語言待確認', tone: 'unknown' };
  const languages = game.languages || {};
  if (languages.tchinese === true) return { label: '支援繁中', tone: 'tchinese' };
  if (languages.schinese === true) return { label: '支援簡中', tone: 'schinese' };
  if (languages.english === true) return { label: '支援英文', tone: 'english' };
  if (game.languageStatus === 'other') return { label: '其他語言', tone: 'other' };
  return null;
}

export function createReleaseStrip(root: HTMLElement, context: {
  D: CatalogAPI; artwork: { load: (image: HTMLImageElement, game: CatalogGame, options: any) => void };
}, signal?: AbortSignal) {
  const { D, artwork } = context;
  const scroller = root.querySelector<HTMLElement>('.releases-scroller')!;
  const weeks = [...root.querySelectorAll<HTMLButtonElement>('[data-week]')];
  const listen = { signal };
  let days: ReleaseDay[] = [], today = D.todayInTaipei(), frame = 0;
  const behavior = (): ScrollBehavior => window.RadarMotion?.enabled === false ? 'auto' : 'smooth';
  // The snap offset from home.css, so a jump lands where snapping would put it.
  const peek = () => parseFloat(getComputedStyle(scroller).scrollPaddingLeft) || 0;

  function card(game: CatalogGame) {
    const display = D.releaseCardNames?.(game, game.releasePlatforms) || { name: game.name, edition: '' };
    const item = node('li', 'release-card');
    const link = node('a', 'release-card-link') as HTMLAnchorElement;
    link.href = D.detailURL(game);
    const art = node('span', 'release-card-art');
    art.setAttribute('aria-hidden', 'true');
    if (game.art) {
      const image = node('img') as HTMLImageElement;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.width = 616;
      image.height = 353;
      artwork.load(image, game, {
        // Art of another shape than Steam's capsule is shown whole over a blurred copy.
        onLoad: () => {
          const shape = artShape(image);
          art.classList.toggle('art-whole', shape.whole);
          if (shape.backdrop) art.style.setProperty('--art-backdrop', shape.backdrop);
          else art.style.removeProperty('--art-backdrop');
        },
        onExhausted: () => image.remove(),
      });
      art.append(image);
    }
    // A band under the art in each platform's color, as on Nintendo's schedule: one
    // platform gets its full name, a same-day multi-platform release one segment each.
    const releasing = game.releasePlatforms?.length ? game.releasePlatforms : [game.source === 'nintendo' ? game.platformShort : 'Steam'];
    const chips = D.cardPlatformChips(game, releasing).chips.filter((chip: any) => chip.released);
    const platform = node('span', 'release-card-platform');
    platform.setAttribute('aria-label', `發售平台：${chips.map((chip: any) => chip.label).join('、')}`);
    for (const chip of chips) {
      const name = chips.length === 1 ? D.platformFullNames?.[chip.code] || chip.label : chip.label;
      platform.append(node('span', `is-${chip.family}`, chip.exclusive ? `${name} 獨佔` : name));
    }
    link.append(art, platform, node('span', 'release-card-title', display.name),
      ...(display.edition ? [node('span', 'release-card-edition', display.edition)] : []));
    const meta = node('p', 'release-card-meta');
    const interest = Number.isFinite(game.followers) ? `${number.format(game.followers)} 人關注`
      : D.consoleInterest(game)?.text || '關注數待確認';
    meta.append(node('span', 'release-card-interest', interest));
    const badge = languageBadge(game);
    if (badge) meta.append(node('span', `release-card-badge badge-${badge.tone}`, badge.label));
    item.append(link, meta);
    return item;
  }

  function day(entry: ReleaseDay) {
    const isToday = entry.date === today;
    const group = node('section', 'release-day' + (isToday ? ' is-today' : entry.date < today ? ' is-past' : ''));
    group.dataset.date = entry.date;
    group.setAttribute('aria-label', `${longDate(entry.date)}${isToday ? '，今天' : ''}，${entry.total} 款`);
    const label = node('h3', 'release-day-label', dotDate(entry.date));
    if (isToday) label.append(node('span', 'release-today', '今天'));
    const list = node('ul', 'release-cards');
    list.append(...entry.games.map(card));
    if (entry.total > entry.games.length) {
      const more = node('li', 'release-more');
      const link = node('a', '', `看全部 ${entry.total} 款`) as HTMLAnchorElement;
      link.href = `./date.html?date=${entry.date}`;
      link.setAttribute('aria-label', `看 ${longDate(entry.date)} 發售的全部 ${entry.total} 款`);
      more.append(link);
      list.append(more);
    }
    group.append(label, list);
    return group;
  }

  const groups = () => [...scroller.querySelectorAll<HTMLElement>('.release-day')];
  function scrollToDate(date: string | null, smooth = true) {
    const target = date && groups().find(group => group.dataset.date === date);
    if (!target) return;
    const left = Math.max(0, target.offsetLeft - scroller.offsetLeft - peek());
    scroller.scrollTo({ left, behavior: smooth ? behavior() : 'auto' });
  }
  /** First release day inside a week; weeks start on Sunday like the calendar. */
  function weekTarget(offset: number) {
    const start = addDays(weekStart(today), offset * 7), end = addDays(start, 6);
    return days.find(entry => entry.date >= start && entry.date <= end)?.date || null;
  }
  function syncWeeks() {
    frame = 0;
    // Fade an edge only while there is more to scroll to on that side.
    scroller.classList.toggle('has-before', scroller.scrollLeft > 1);
    scroller.classList.toggle('has-after', scroller.scrollLeft < scroller.scrollWidth - scroller.clientWidth - 1);
    const left = scroller.scrollLeft + peek() + 1;
    const visible = groups().find(group => group.offsetLeft - scroller.offsetLeft + group.offsetWidth > left);
    const date = visible?.dataset.date;
    for (const button of weeks) {
      const start = addDays(weekStart(today), Number(button.dataset.week) * 7), end = addDays(start, 6);
      if (date && date >= start && date <= end) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
  }

  root.querySelector('[data-step="-1"]')?.addEventListener('click', () => scroller.scrollBy({ left: -scroller.clientWidth * 0.8, behavior: behavior() }), listen);
  root.querySelector('[data-step="1"]')?.addEventListener('click', () => scroller.scrollBy({ left: scroller.clientWidth * 0.8, behavior: behavior() }), listen);
  for (const button of weeks) button.addEventListener('click', () => scrollToDate(weekTarget(Number(button.dataset.week))), listen);
  scroller.addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(syncWeeks); }, listen);

  return {
    render(games: CatalogGame[], day0: string) {
      today = day0;
      days = releaseDays(games, today, D);
      root.hidden = !days.length;
      scroller.replaceChildren(...days.map(day));
      for (const button of weeks) button.disabled = !weekTarget(Number(button.dataset.week));
      scrollToDate(openingDay(days, today), false);
      syncWeeks();
    },
    scrollToDate,
    get days() { return days; },
  };
}
