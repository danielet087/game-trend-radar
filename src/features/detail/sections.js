// In-page navigation (only for sections that have content) and the dock that
// follows the reader once the title card has scrolled away.
export function createDetailSections(ctx) {
  const { $, document, window } = ctx;
  let spy = null, dockWatcher = null;
  const links = () => [...(document.querySelectorAll?.('#gameSectionNav a[data-section]') || [])];

  function watchSections(visible) {
    spy?.disconnect();
    spy = null;
    if (typeof window?.IntersectionObserver !== 'function' || !visible.length) return;
    const seen = new Map();
    spy = new window.IntersectionObserver(entries => {
      for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting);
      const active = visible.find(link => seen.get(link.dataset.section));
      for (const link of visible) {
        if (link === active) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      }
    }, { rootMargin: '-35% 0px -55% 0px' });
    for (const link of visible) {
      const section = $(link.dataset.section);
      if (section) spy.observe(section);
    }
  }

  function watchDock() {
    if (dockWatcher || typeof window?.IntersectionObserver !== 'function') {
      if (!dockWatcher) $('gameDock')?.classList.add('is-visible');
      return;
    }
    const card = $('gameTitleCard');
    if (!card) return;
    dockWatcher = new window.IntersectionObserver(entries => {
      const away = entries.every(entry => !entry.isIntersecting);
      $('gameDock').classList.toggle('is-visible', away);
    });
    dockWatcher.observe(card);
  }

  return {
    update() {
      const visible = links().filter(link => {
        const section = $(link.dataset.section);
        link.hidden = !section || section.hidden;
        return !link.hidden;
      });
      watchSections(visible);
      watchDock();
    },
    destroy() { spy?.disconnect(); dockWatcher?.disconnect(); spy = dockWatcher = null; },
  };
}
