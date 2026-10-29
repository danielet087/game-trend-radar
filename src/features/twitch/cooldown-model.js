import { HOUR, count, timestamp } from './metrics.js';

const DAY = 24 * HOUR, TAIPEI_OFFSET = 8 * HOUR;
const THRESHOLD = 3000, CONFIRM_DAYS = 3, MIN_VALID_HOURS = 12;
const iso = at => new Date(at).toISOString().replace('.000Z', 'Z');
const dayStart = at => Math.floor((at + TAIPEI_OFFSET) / DAY) * DAY - TAIPEI_OFFSET;
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function normalize(rows, now) {
  const unique = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!timestamp(row?.hour)) continue;
    const at = Date.parse(row.hour);
    if (at % HOUR || at > now) continue;
    unique.set(at, { at, hour: iso(at), raw: row.status === 'observed' ? count(row.viewer_count) : null });
  }
  return [...unique.values()].sort((a, b) => a.at - b.at);
}

// Retrospective milestones relative to the highest valid closed-day median.
// A new peak rebases this auxiliary history; it never changes cooldown status.
function relativeDecline(days) {
  const valid = days.filter(day => day.complete);
  const peak = valid.reduce((best, day) => !best || day.median > best.median ? day : best, null);
  const milestones = [25, 50, 75].map(percent => {
    const thresholdValue = peak?.median > 0 ? peak.median * (1 - percent / 100) : null;
    const day = thresholdValue === null ? null : valid.find(day =>
      day.startAt > peak.startAt && day.median <= thresholdValue);
    return { percent, thresholdValue, date: day?.date ?? null,
      startedAt: day?.startAt ?? null, observedAt: day?.endAt ?? null, median: day?.median ?? null };
  });
  return { peak: peak ? { date: peak.date, startAt: peak.startAt, median: peak.median } : null, milestones };
}

/** Fixed Twitch audience rule. Only closed Taipei days can confirm an event.
 * Up to 12 missing hourly observations per day are tolerated; missing values
 * never become zero and future observations cannot complete an open day. */
export function analyzeCooldown(rows, { now = Date.now() } = {}) {
  now = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const settings = { threshold: THRESHOLD, confirmDays: CONFIRM_DAYS, timeZone: 'Asia/Taipei',
    maxMissingHours: 24 - MIN_VALID_HOURS, minValidHours: MIN_VALID_HOURS };
  const slots = normalize(rows, now), points = slots.map(({ hour, raw }) => ({ hour, raw }));
  const byHour = new Map(slots.map(slot => [slot.at, slot.raw]));
  const days = [], episodes = [];
  let status = 'insufficient', candidate = null, active = null, suspended = false;
  let recheckStart = null, lowDays = 0, sawCompleteDay = false, recovered = false;

  if (slots.length) for (let at = dayStart(slots[0].at); at <= dayStart(slots.at(-1).at); at += DAY) {
    const values = Array.from({ length: 24 }, (_, index) => byHour.get(at + index * HOUR))
      .filter(value => typeof value === 'number');
    const isClosed = at + DAY <= now, complete = isClosed && values.length >= MIN_VALID_HOURS;
    const value = complete ? median(values) : null;
    const day = { date: iso(at + TAIPEI_OFFSET).slice(0, 10), startAt: iso(at), endAt: iso(at + DAY),
      median: value, validHours: values.length, missingHours: 24 - values.length, totalHours: 24,
      complete, isClosed, belowThreshold: complete ? value < THRESHOLD : null, status, lowDays };

    // Today's unfinished observations neither confirm nor reset yesterday's run.
    if (!isClosed) {
      day.status = 'open'; days.push(day); continue;
    }
    if (!complete) {
      candidate = null; recheckStart = null; lowDays = 0; recovered = false;
      if (active) { active.interruptedAt ||= day.startAt; suspended = true; }
      status = sawCompleteDay ? 'gap' : 'insufficient';
    } else {
      sawCompleteDay = true;
      if (value >= THRESHOLD) {
        lowDays = 0; candidate = null; recheckStart = null;
        if (active) {
          // Returning above the fixed boundary ends this episode. It does not
          // claim that the game has regained its previous popularity.
          active.recoveryAt = day.startAt; active.recoveryConfirmedAt = day.endAt;
          active = null; suspended = false; recovered = true;
        }
        status = recovered ? 'recovered' : 'watching';
      } else {
        lowDays++;
        if (active) {
          if (suspended) {
            recheckStart ||= day.startAt;
            status = 'suspected';
            if (lowDays >= CONFIRM_DAYS) {
              active.reconfirmations.push({ startedAt: recheckStart, confirmedAt: day.endAt });
              recheckStart = null; suspended = false; status = 'cooled';
            }
          } else status = 'cooled';
        } else {
          candidate ||= { candidateAt: day.startAt, confirmedAt: null, thresholdValue: THRESHOLD,
            days: 0, recoveryAt: null, recoveryConfirmedAt: null, interruptedAt: null, reconfirmations: [] };
          candidate.days = lowDays; status = 'suspected';
          if (lowDays >= CONFIRM_DAYS) {
            candidate.confirmedAt = day.endAt; episodes.push(candidate); active = candidate;
            candidate = null; recovered = false; status = 'cooled';
          }
        }
      }
    }
    day.status = status; day.lowDays = lowDays; days.push(day);
  }

  const last = points.at(-1), lastClosed = days.findLast(day => day.isClosed);
  const latest = { hour: last?.hour ?? null, raw: last?.raw ?? null,
    day: lastClosed?.date ?? null, median: lastClosed?.median ?? null,
    lowDays: lastClosed?.lowDays ?? 0, validHours: lastClosed?.validHours ?? 0,
    missingHours: lastClosed?.missingHours ?? null, complete: lastClosed?.complete ?? false };
  const pendingRecheck = suspended && active ? { startedAt: recheckStart, days: lowDays,
    requiredDays: CONFIRM_DAYS, thresholdValue: THRESHOLD } : null;
  return { settings, status, points, days, episodes, candidate, latest, relativeDecline: relativeDecline(days),
    coverage: { valid: slots.filter(slot => slot.raw !== null).length, total: slots.length,
      completeDays: days.filter(day => day.complete).length, totalDays: days.length },
    firstHour: points[0]?.hour ?? null, lastHour: last?.hour ?? null, pendingRecheck };
}

