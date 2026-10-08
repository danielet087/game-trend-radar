export function createCatalogMotion() {
  let enabled = window.RadarMotion?.enabled !== false;
  let observer: IntersectionObserver | null = null;
  const onChange = () => {
    enabled = window.RadarMotion?.enabled !== false;
    if (!enabled) document.querySelectorAll<HTMLElement>('.reveal-pending').forEach(card => {
      card.classList.remove('reveal-pending', 'is-visible'); card.style.transitionDelay = '';
    });
  };
  document.addEventListener('radar:motionchange', onChange);
  if ('IntersectionObserver' in window) observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const card = entry.target as HTMLElement;
      card.dataset.revealed = 'true'; card.classList.add('is-visible'); observer?.unobserve(card);
      setTimeout(() => { card.classList.remove('reveal-pending', 'is-visible'); card.style.transitionDelay = ''; }, 650);
    }
  }, { threshold: .04 });
  return {
    get enabled() { return enabled; },
    reveal(area: HTMLElement) {
      if (!observer || !enabled) return;
      area.querySelectorAll<HTMLElement>('.game-card').forEach((card, index) => {
        if (card.dataset.revealed) return;
        card.style.transitionDelay = Math.min(index % 4, 3) * 45 + 'ms'; card.classList.add('reveal-pending'); observer!.observe(card);
      });
    },
    clear(area: HTMLElement) { area.querySelectorAll('.reveal-pending').forEach(card => observer?.unobserve(card)); },
    celebrate(id: string | number, saved: boolean) {
      if (!enabled || !saved) return;
      document.querySelectorAll<HTMLElement>(`button[data-save="${id}"]`).forEach(button => {
        button.classList.remove('celebrate'); void button.offsetWidth; button.classList.add('celebrate');
        setTimeout(() => button.classList.remove('celebrate'), 700);
      });
      document.querySelectorAll('[data-saved-count]').forEach(badge => { badge.classList.add('bounce'); setTimeout(() => badge.classList.remove('bounce'), 700); });
    },
    dispose() { observer?.disconnect(); document.removeEventListener('radar:motionchange', onChange); },
  };
}
