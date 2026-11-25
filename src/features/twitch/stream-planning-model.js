import { HOUR } from './metrics.js';
import { dateStart, dayOf } from './series.js';

// The game page compares stream slots over the last seven closed Taiwan days
// and needs at least three of them (stream-slot-model.js).
export const TRIAL_MIN_DAYS = 3;
const DAY = 24 * HOUR;
const WINDOW_DAYS = 7;

/** The seven closed Taiwan days before `now`'s day, each at `hour` (midnight by default). */
export function trialWindow(hour = 0, now = Date.now()) {
  const offset = /^\d{1,2}$/.test(String(hour)) && Number(hour) < 24 ? Number(hour) : 0;
  const today = dateStart(dayOf(now));
  const slots = Array.from({ length: WINDOW_DAYS }, (_, i) => today - (WINDOW_DAYS - i) * DAY + offset * HOUR);
  return { slots, start: slots[0], end: slots.at(-1), today, now };
}
