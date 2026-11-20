import { node } from '../catalog/dom';
import { steamMedia } from '../detail/media.js';
import type { CatalogAPI, CatalogGame } from '../catalog/types';
import { daysBetween, dotDate, longDate } from './dates';

/** The top carousel: upcoming Steam games with Steam hero art, most followed first. */
export const HERO_SIZE = 5;
export const HERO_DAYS = 14;
export const HERO_FALLBACK_DAYS = 45;
export const HERO_INTERVAL = 6000;
const CANDIDATES = 8;
const number = new Intl.NumberFormat('zh-TW');

export interface HeroSlide { game: CatalogGame; hero: string; hero2x: string | null }
export interface HeroContext {
  D: CatalogAPI;
  loadMedia: (appid: number) => Promise<unknown>;
  artwork: { load: (image: HTMLImageElement, game: CatalogGame, options: any) => void };
  favorites: { isSaved: (target: any) => boolean; subscribeSaved: (listener: () => void) => () => void };
}

/** Steam games releasing within two weeks (else 45 days), one per game, by followers. */
export function heroCandidates(games: CatalogGame[], today: string, D: CatalogAPI): CatalogGame[] {
  const pick = (days: number) => {
    const seen = new Set<string>();
    return games.filter(game => game.source !== 'nintendo' && Number.isSafeInteger(Number(game.appid)) && Number(game.appid) > 0 &&
      Number.isFinite(game.followers) && game.date >= today && daysBetween(today, game.date) <= days)
      .sort((a, b) => b.followers - a.followers || a.date.localeCompare(b.date))
      .filter(game => { const key = String(D.gameKey(game)); if (seen.has(key)) return false; seen.add(key); return true; });
  };
  const near = pick(HERO_DAYS);
  return (near.length >= 3 ? near : pick(HERO_FALLBACK_DAYS)).slice(0, CANDIDATES);
}

/** Keeps the first five candidates whose media file has a Steam hero image. */
export async function heroSlides(candidates: CatalogGame[], loadMedia: HeroContext['loadMedia']): Promise<HeroSlide[]> {
  const media = await Promise.all(candidates.map(game => loadMedia(Number(game.appid))
    .then(value => steamMedia(value, Number(game.appid))).catch(() => null)));
  return candidates.flatMap((game, index) => media[index]?.hero ? [{ game, hero: media[index].hero, hero2x: media[index].hero2x }] : [])
    .slice(0, HERO_SIZE);
}

const svg = (paths: string[]) => {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    icon.append(path);
  }
  return icon;
};
const PAUSE = ['M9 6v12', 'M15 6v12'], PLAY = ['M8 5.5v13l11-6.5z'];
const HEART = ['M20.8 4.8a5.6 5.6 0 0 0-7.9 0L12 5.7l-.9-.9a5.6 5.6 0 0 0-7.9 7.9L12 21l8.8-8.3a5.6 5.6 0 0 0 0-7.9Z'];

export function createHomeHero(root: HTMLElement, context: HeroContext, signal?: AbortSignal) {
  const { D, artwork, favorites } = context;
  let slides: HeroSlide[] = [], current = 0, today = D.todayInTaipei(), timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false, hovering = false, focused = false, unsubscribe = () => {};
  const listen = { signal };
  const motionOn = () => window.RadarMotion?.enabled !== false;

  function saveState() {
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-save]')) {
      const slide = slides[Number(button.dataset.index)];
      if (!slide) continue;
      const active = favorites.isSaved({ appid: slide.game.appid, savedAliases: slide.game.savedAliases });
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', `${active ? '取消收藏' : '收藏'} ${button.dataset.name}`);
    }
  }

  function show(index: number, moveFocus = false) {
    current = (index + slides.length) % slides.length;
    root.querySelectorAll<HTMLElement>('.home-hero-slide').forEach((slide, i) => { slide.hidden = i !== current; });
    root.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === current));
      tab.tabIndex = i === current ? 0 : -1;
      if (i === current && moveFocus) tab.focus();
    });
    const count = root.querySelector('.home-hero-count');
    if (count) count.textContent = `${current + 1} / ${slides.length}`;
  }

  function schedule() {
    clearInterval(timer);
    timer = undefined;
    const pause = root.querySelector<HTMLButtonElement>('.home-hero-pause');
    if (pause) {
      const playing = !stopped && motionOn();
      pause.setAttribute('aria-label', playing ? '暫停輪播' : '播放輪播');
      pause.setAttribute('aria-pressed', String(!playing));
      pause.replaceChildren(svg(playing ? PAUSE : PLAY));
      pause.hidden = slides.length < 2 || !motionOn();
    }
    if (stopped || slides.length < 2 || !motionOn()) return;
    timer = setInterval(() => {
      if (!hovering && !focused && document.visibilityState !== 'hidden') show(current + 1);
    }, HERO_INTERVAL);
  }

  function slide(item: HeroSlide, index: number) {
    const { game } = item, days = daysBetween(today, game.date);
    const display = D.releaseCardNames?.(game, game.releasePlatforms) || { name: game.name };
    const panel = node('div', 'home-hero-slide');
    panel.id = `homeHeroSlide${index}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `homeHeroTab${index}`);
    panel.hidden = index !== 0;
    const image = node('img', 'home-hero-art') as HTMLImageElement;
    image.alt = '';
    image.decoding = 'async';
    if (index === 0) image.fetchPriority = 'high'; else image.loading = 'lazy';
    if (item.hero2x) image.srcset = `${item.hero} 1920w, ${item.hero2x} 3840w`;
    image.sizes = '100vw';
    image.addEventListener('error', () => { image.hidden = true; }, { once: true });
    image.src = item.hero;
    const copy = node('div', 'home-hero-copy');
    const when = node('p', 'home-hero-when');
    when.append(node('span', 'home-hero-date', `${dotDate(game.date)}發售`),
      node('span', 'home-hero-countdown', days === 0 ? '今天發售' : `還有 ${days} 天`));
    const title = node('h2', 'home-hero-title', display.name);
    const meta = node('p', 'home-hero-meta', `Steam · ${number.format(game.followers)} 人關注`);
    const actions = node('div', 'home-hero-actions');
    const link = node('a', 'home-hero-link', '看遊戲資訊') as HTMLAnchorElement;
    link.href = D.detailURL(game);
    link.setAttribute('aria-label', `看 ${display.name} 的遊戲資訊`);
    const save = node('button', 'home-hero-save') as HTMLButtonElement;
    save.type = 'button';
    Object.assign(save.dataset, { save: String(game.appid), name: display.name, index: String(index) });
    save.append(svg(HEART));
    actions.append(link, save);
    copy.append(when, title, meta, actions);
    panel.append(image, copy);
    panel.setAttribute('aria-label', `${display.name}，${longDate(game.date)}發售`);
    return panel;
  }

  function tab(item: HeroSlide, index: number) {
    const { game } = item;
    const display = D.releaseCardNames?.(game, game.releasePlatforms) || { name: game.name };
    const button = node('button', 'home-hero-tab') as HTMLButtonElement;
    button.type = 'button';
    button.id = `homeHeroTab${index}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', `homeHeroSlide${index}`);
    const thumb = node('span', 'home-hero-thumb');
    thumb.setAttribute('aria-hidden', 'true');
    if (game.art) {
      const image = node('img') as HTMLImageElement;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      artwork.load(image, game, { onExhausted: () => image.remove() });
      thumb.append(image);
    }
    const text = node('span', 'home-hero-tab-text');
    text.append(node('span', 'home-hero-tab-name', display.name), node('span', 'home-hero-tab-date', dotDate(game.date)));
    button.append(thumb, text);
    button.addEventListener('click', () => { stopped = true; show(index); schedule(); }, listen);
    return button;
  }

  function render(items: HeroSlide[]) {
    slides = items;
    unsubscribe();
    if (!slides.length) { root.hidden = true; root.replaceChildren(); clearInterval(timer); return; }
    const stage = node('div', 'home-hero-stage');
    const controls = node('div', 'home-hero-controls');
    const pause = node('button', 'home-hero-pause') as HTMLButtonElement;
    pause.type = 'button';
    pause.addEventListener('click', () => { stopped = !stopped; schedule(); }, listen);
    controls.append(node('span', 'home-hero-count'), pause);
    stage.append(...slides.map(slide), controls);
    const tabs = node('div', 'home-hero-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '焦點新作');
    tabs.append(...slides.map(tab));
    tabs.addEventListener('keydown', event => {
      const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, Home: -current, End: slides.length - 1 - current };
      if (!(event.key in keys)) return;
      event.preventDefault();
      stopped = true;
      show(current + keys[event.key], true);
      schedule();
    }, listen);
    root.replaceChildren(stage, tabs);
    root.hidden = false;
    show(0);
    saveState();
    unsubscribe = favorites.subscribeSaved(saveState);
    schedule();
  }

  root.addEventListener('pointerenter', () => { hovering = true; }, listen);
  root.addEventListener('pointerleave', () => { hovering = false; }, listen);
  root.addEventListener('focusin', () => { focused = true; }, listen);
  root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget as Node)) focused = false; }, listen);
  document.addEventListener('radar:motionchange', schedule, listen);

  return {
    async load(games: CatalogGame[], day: string) {
      today = day;
      render(await heroSlides(heroCandidates(games, day, D), context.loadMedia));
    },
    render,
    get current() { return current; },
    dispose() { clearInterval(timer); unsubscribe(); },
  };
}
