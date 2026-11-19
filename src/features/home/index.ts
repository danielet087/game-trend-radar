import { createHomeHero } from './hero';
import { createReleaseStrip } from './releases';
import type { CatalogAPI, CatalogDataset, CatalogGame } from '../catalog/types';

export { heroCandidates, heroSlides, HERO_SIZE, HERO_DAYS } from './hero';
export { releaseDays, openingDay, STRIP_BEFORE, STRIP_AFTER, STRIP_PER_DAY } from './releases';
export { dotDate, longDate, addDays, weekStart } from './dates';

/** The home page's top half: the focus carousel and the 近期新作 strip. Both
    read the catalog the calendar already loaded; the carousel also reads the
    Steam media files of its five games. */
export function createHomeFeatures({ D, storage, artwork, favorites, signal }: {
  D: CatalogAPI;
  storage: { loadMedia?: (appid: number) => Promise<unknown> };
  artwork: { load: (image: HTMLImageElement, game: CatalogGame, options: any) => void };
  favorites: { isSaved: (target: any) => boolean; subscribeSaved: (listener: () => void) => () => void };
  signal?: AbortSignal;
}) {
  const heroRoot = document.getElementById('homeHero'), stripRoot = document.getElementById('homeReleases');
  const hero = heroRoot && storage.loadMedia
    ? createHomeHero(heroRoot, { D, loadMedia: appid => storage.loadMedia!(appid), artwork, favorites }, signal) : null;
  // A page without the strip's markup (an older cached page, a test page) just skips it.
  const strip = stripRoot?.querySelector('.releases-scroller') ? createReleaseStrip(stripRoot, { D, artwork }, signal) : null;
  return {
    hero, strip,
    render(data: CatalogDataset, today: string) {
      strip?.render(data.games, today);
      hero?.load(data.games, today).catch(() => hero.render([]));
    },
    unavailable() {
      hero?.render([]);
      if (stripRoot) stripRoot.hidden = true;
    },
    dispose() { hero?.dispose(); },
  };
}
