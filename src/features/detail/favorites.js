import { toggleSaved, isSaved, registerSavedGames, savedCount, subscribeSaved } from '../../shared/state/favorites.ts';

export function createDetailFavorites(ctx) {
    const { $, document, state, enhancements, motion, on } = ctx;
    let feedbackTimer;
    function updateSaveControls() {
      registerSavedGames(state.knownGames);
      document.querySelectorAll('[data-saved-count]').forEach(count => { count.textContent = String(savedCount()); });
      if (!state.currentGame) return;
      const active = isSaved(state.currentGame);
      document.querySelectorAll('[data-game-save]').forEach(button => {
        button.setAttribute('aria-pressed', String(active));
        button.setAttribute('aria-label', `${active ? '取消收藏' : '收藏'} ${state.currentGame.name}`);
        button.querySelector('[data-save-label]').textContent = active ? '已收藏' : '加入收藏';
      });
    }
    function toggleSave(event) {
      if (!state.currentGame) return;
      const result = toggleSaved(state.currentGame);
      $('gameSaveHint').textContent = !result.durable
        ? '本次收藏已變更；瀏覽器目前不允許永久儲存。'
        : result.saved ? `已把「${state.currentGame.name}」加入收藏。` : `已取消收藏「${state.currentGame.name}」。`;
      $('gameSaveHint').classList.add('visible');
      clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => $('gameSaveHint').classList.remove('visible'), 3500);
      updateSaveControls();
      enhancements?.pulseSaved();
      if (motion?.enabled && event.currentTarget.animate)
        event.currentTarget.animate([{ transform:'scale(1)' }, { transform:'scale(1.06)' }, { transform:'scale(1)' }], { duration:300 });
    }
    document.querySelectorAll('[data-game-save]').forEach(button => on(button, 'click', toggleSave));
    const unsubscribe = subscribeSaved(updateSaveControls);
    return { updateSaveControls, destroy() { clearTimeout(feedbackTimer); unsubscribe(); } };
}
