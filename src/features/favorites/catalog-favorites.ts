import * as sharedFavorites from '../../shared/state/favorites';
import { element as $ } from '../catalog/dom';
import type { CatalogGame, CatalogMode } from '../catalog/types';
import type { FilterState } from '../catalog/filter-state';

export function createCatalogFavorites(filters: FilterState, render: () => void,
  gameFor: (element: Element | null | undefined) => CatalogGame | undefined,
  notify: (message: string) => void, celebrate: (id: string | number, active: boolean) => void,
  favorites = sharedFavorites) {
  const onClick = (event: MouseEvent) => {
    const button = (event.target as Element)?.closest<HTMLButtonElement>('button[data-save]');
    if (!button) return;
    const previous = [...$('gamesGrid').querySelectorAll('.game-card')];
    const activeIndex = previous.indexOf(document.activeElement?.closest('.game-card')!);
    const game = gameFor(button.closest('.game-card'));
    const id = button.dataset.save?.startsWith('igdb:') ? button.dataset.save : Number(button.dataset.save);
    const result = favorites.toggleSaved(game || id);
    window.RadarEnhancements?.pulseSaved();
    if (filters.mode === 'saved' || filters.state.savedOnly) {
      render();
      if (activeIndex >= 0) {
        const cards = $('gamesGrid').querySelectorAll('.game-card');
        const target = cards[Math.min(activeIndex, cards.length - 1)]?.querySelector<HTMLElement>('[data-save]') || $('resultCount');
        if (target === $('resultCount')) target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
    }
    celebrate(id, result.saved);
    notify(result.durable ? `已${result.saved ? '' : '取消'}收藏「${button.dataset.name}」` : '已更新本次收藏；瀏覽器限制儲存，關閉頁面後可能不會保留。');
  };
  document.addEventListener('click', onClick);
  const unsubscribe = favorites.subscribeSaved(() => {
    if (filters.mode === 'saved' || filters.state.savedOnly) render();
  });
  return { ...favorites, dispose() { unsubscribe(); document.removeEventListener('click', onClick); } };
}
