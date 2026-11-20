// Cards appear as soon as they render (2026-11-20: the 0.45s entrance was
// dropped for speed); motion is kept for the favorite feedback.
export function createCatalogMotion() {
  let enabled = window.RadarMotion?.enabled !== false;
  const onChange = () => { enabled = window.RadarMotion?.enabled !== false; };
  document.addEventListener('radar:motionchange', onChange);
  return {
    get enabled() { return enabled; },
    celebrate(id: string | number, saved: boolean) {
      if (!enabled || !saved) return;
      document.querySelectorAll<HTMLElement>(`button[data-save="${id}"]`).forEach(button => {
        button.classList.remove('celebrate'); void button.offsetWidth; button.classList.add('celebrate');
        setTimeout(() => button.classList.remove('celebrate'), 700);
      });
      document.querySelectorAll('[data-saved-count]').forEach(badge => { badge.classList.add('bounce'); setTimeout(() => badge.classList.remove('bounce'), 700); });
    },
    dispose() { document.removeEventListener('radar:motionchange', onChange); },
  };
}
