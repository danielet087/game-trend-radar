/** One motion preference for the shell, DOM controllers and Vue features. */
export interface MotionSnapshot {
  enabled: boolean;
  reduced: boolean;
  preference: 'on' | 'off';
}

declare global {
  interface Window {
    RadarMotion?: MotionSnapshot;
  }
}

export const MOTION_STORAGE_KEY = 'game-trend-radar:motion:v2';
export const MOTION_CHANGE_EVENT = 'radar:motionchange';

let initialized = false;
let media: MediaQueryList | undefined;
let preference: 'on' | 'off' = 'on';
const motion: MotionSnapshot = { enabled: true, reduced: false, preference: 'on' };
const listeners = new Set<(value: MotionSnapshot) => void>();

function sync(): void {
  motion.reduced = media?.matches || false;
  motion.preference = preference;
  motion.enabled = preference !== 'off' && !motion.reduced;
  if (typeof document !== 'undefined') {
    document.body.classList.toggle('motion-on', motion.enabled);
    document.body.classList.toggle('motion-off', !motion.enabled);
    document.documentElement.style.scrollBehavior = motion.enabled ? 'smooth' : 'auto';
    if (!motion.enabled) document.getAnimations?.().forEach(animation => animation.cancel());
    document.dispatchEvent(new Event(MOTION_CHANGE_EVENT));
  }
  for (const listener of listeners) listener({ ...motion });
}

export function initializeMotion(): void {
  if (initialized) return;
  initialized = true;
  if (typeof window === 'undefined') return;
  media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  try {
    preference = window.localStorage.getItem(MOTION_STORAGE_KEY) === 'off' ? 'off' : 'on';
  } catch { /* The preference remains available in memory. */ }
  // The mutable object intentionally preserves RadarMotion.enabled readers.
  (window as unknown as { RadarMotion: MotionSnapshot }).RadarMotion = motion;
  media?.addEventListener?.('change', sync);
  window.addEventListener('storage', event => {
    if (event.key !== MOTION_STORAGE_KEY && event.key !== null) return;
    preference = event.newValue === 'off' ? 'off' : 'on';
    sync();
  });
  sync();
}

export function readMotion(): MotionSnapshot {
  initializeMotion();
  return { ...motion };
}

export function setMotionPreference(value: 'on' | 'off'): MotionSnapshot {
  initializeMotion();
  preference = value;
  try { window.localStorage.setItem(MOTION_STORAGE_KEY, value); } catch { /* Session fallback. */ }
  sync();
  return { ...motion };
}

export function toggleMotion(): MotionSnapshot {
  initializeMotion();
  if (motion.reduced) return { ...motion };
  return setMotionPreference(motion.enabled ? 'off' : 'on');
}

export function subscribeMotion(listener: (value: MotionSnapshot) => void): () => void {
  initializeMotion();
  listeners.add(listener);
  listener({ ...motion });
  return () => { listeners.delete(listener); };
}
