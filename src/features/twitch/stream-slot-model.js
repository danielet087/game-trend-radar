import { HOUR } from './metrics.js';
import { dateStart, dayOf, seriesRows } from './series.js';
import { quantile } from './statistics-model.js';
import { CHINESE_MEASUREMENT_CHANGE_AT, VIEWER_TIERS, isIndependentChineseMeasurement, tierLayout } from './audience-region.js';
import { TRIAL_MIN_DAYS, trialWindow } from './stream-planning-model.js';

// "什麼時候開" on the game page: a stream slot (11:00～15:00 by default) over
// the last seven closed Taiwan days. Each day averages the slot's observed
// hours (at least half of them), and the slot's numbers are the median of
// those days (at least three). The rank counts channels above the viewers a
// channel usually has (60 by default) the same way.

const DAY = 24 * HOUR;
export const SLOT_DEFAULTS = Object.freeze({ start: 11, end: 15, viewers: 60 });
export const VIEWER_CHOICES = VIEWER_TIERS;
const hh = hour => `${String(hour).padStart(2, '0')}:00`;

/** A start hour 0-23 and an end hour 1-24, from URL values. */
export function slotOf(start, end) {
  const from = /^\d{1,2}$/.test(start ?? '') && Number(start) < 24 ? Number(start) : SLOT_DEFAULTS.start;
  const to = /^\d{1,2}$/.test(end ?? '') && Number(end) >= 1 && Number(end) <= 24 ? Number(end) : SLOT_DEFAULTS.end;
  return { start: from, end: to === from ? (from + 1) % 24 || 24 : to };
}

/** Hours after midnight a slot covers; an end at or before the start passes midnight. */
export function slotHours({ start, end }) {
  const length = end > start ? end - start : end + 24 - start;
  return Array.from({ length }, (_, i) => start + i);
}

export const slotLabel = ({ start, end }) => `${hh(start)}～${hh(end)}`;

/** The seven closed days before today, or before the last tracked day of an ended game. */
export function slotPeriod(record, now = Date.now()) {
  const last = Date.parse(record?.last_hour);
  if (record?.tracking_status === 'ended' && Number.isFinite(last)) return trialWindow(0, Math.min(now, dateStart(dayOf(last)) + DAY));
  return trialWindow(0, now);
}

function counts(row) {
  const { viewer_count: viewers, streamer_count: streamers } = row ?? {};
  return row?.status === 'observed' && Number.isSafeInteger(viewers) && Number.isSafeInteger(streamers) &&
    viewers >= 0 && streamers >= 0 && !(streamers === 0 && viewers > 0);
}

/** Channels above `viewers` in one hour: exact when that tier was counted, otherwise between the nearest tiers. */
export function channelsAboveRange(tiers, viewers) {
  const layout = tierLayout(tiers);
  if (!layout) return null;
  const at = layout.indexOf(viewers);
  if (at >= 0) return { low: tiers[at], high: tiers[at], exact: true };
  // Tiers rise and counts fall: the nearest tier below bounds the count from
  // above, the nearest tier above from below (none above: at least 0).
  let low = 0, high = null;
  for (const [i, threshold] of layout.entries()) {
    if (threshold < viewers) high = tiers[i];
    else { low = tiers[i]; break; }
  }
  return high === null ? null : { low, high, exact: false };
}

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const median = values => quantile(values, .5);

/** One slot's typical viewers, channels, viewers per channel and rank over the period. */
export function slotStats(index, chunks, gameId, period, slot, region, viewers) {
  const reference = index.games[gameId]?.release_reference;
  const released = reference?.precision === 'day' ? dateStart(reference.date) : NaN;
  const hours = slotHours(slot), need = Math.ceil(hours.length / 2);
  const independent = period.end + hours.at(-1) * HOUR >= Date.parse(CHINESE_MEASUREMENT_CHANGE_AT);
  const days = [];
  for (const day of period.slots) {
    if (day + hours[0] * HOUR < released) continue;
    const rows = [];
    for (const hour of hours) {
      const at = day + hour * HOUR;
      if (at > period.now) continue;
      const row = seriesRows(index, chunks, gameId, at, at, region)[0];
      if (!counts(row) || !(Date.parse(row.generated_at) <= period.now)) continue;
      if (region === 'zh' && isIndependentChineseMeasurement(row) !== independent) continue;
      rows.push(row);
    }
    if (rows.length < need) continue;
    const entry = { date: dayOf(day), viewers: mean(rows.map(row => row.viewer_count)), streamers: mean(rows.map(row => row.streamer_count)) };
    const ranks = rows.map(row => channelsAboveRange(row.streamer_counts_above_viewers, viewers)).filter(Boolean);
    const exact = ranks.filter(rank => rank.exact);
    if (exact.length >= need) entry.ahead = mean(exact.map(rank => rank.low));
    else if (ranks.length >= need) entry.range = [mean(ranks.map(rank => rank.low)), mean(ranks.map(rank => rank.high))];
    days.push(entry);
  }
  const enough = days.length >= TRIAL_MIN_DAYS;
  const typicalViewers = enough ? median(days.map(day => day.viewers)) : null;
  const typicalStreamers = enough ? median(days.map(day => day.streamers)) : null;
  const exactDays = days.filter(day => Number.isFinite(day.ahead));
  const rangeDays = days.filter(day => Number.isFinite(day.ahead) || day.range);
  let rank = null;
  if (exactDays.length >= TRIAL_MIN_DAYS) rank = { ahead: Math.round(median(exactDays.map(day => day.ahead))), days: exactDays.length };
  else if (rangeDays.length >= TRIAL_MIN_DAYS) {
    const low = Math.round(median(rangeDays.map(day => day.range?.[0] ?? day.ahead)));
    const high = Math.round(median(rangeDays.map(day => day.range?.[1] ?? day.ahead)));
    rank = low === high ? { ahead: low, days: rangeDays.length } : { low, high, days: rangeDays.length };
  }
  return { slot, hours: hours.length, days: days.length, totalDays: period.slots.length, dates: days.map(day => day.date),
    viewers: typicalViewers, streamers: typicalStreamers,
    perStream: typicalStreamers > 0 ? typicalViewers / typicalStreamers : null, rank };
}

/** The busiest slot of the same length that does not overlap `slot`, for the comparison. */
export function busiestSlot(index, chunks, gameId, period, slot, region, viewers) {
  const length = slotHours(slot).length, own = new Set(slotHours(slot).map(hour => hour % 24));
  let best = null;
  for (let start = 0; start < 24; start++) {
    const candidate = { start, end: (start + length) % 24 || 24 };
    if (slotHours(candidate).some(hour => own.has(hour % 24))) continue;
    const stats = slotStats(index, chunks, gameId, period, candidate, region, viewers);
    if (stats.viewers !== null && (!best || stats.viewers > best.viewers)) best = stats;
  }
  return best;
}
