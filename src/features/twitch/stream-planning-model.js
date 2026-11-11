import { HOUR } from './metrics.js';
import { dateStart, dayOf, seriesRows } from './series.js';
import { quantile } from './statistics-model.js';

export const TRIAL_MIN_DAYS = 3;
const DAY = 24 * HOUR;
const WINDOW_DAYS = 7;

export function streamHour(value) {
  return /^\d{1,2}$/.test(value ?? '') && Number(value) < 24 ? Number(value) : 20;
}

export function trialWindow(hour, now = Date.now()) {
  const today = dateStart(dayOf(now));
  const slots = Array.from({ length: WINDOW_DAYS }, (_, i) => today - (WINDOW_DAYS - i) * DAY + streamHour(hour) * HOUR);
  return { slots, start: slots[0], end: slots.at(-1), today, now };
}

function trialCounts(row) {
  const { viewer_count: viewers, streamer_count: streamers } = row;
  if (row.status !== 'observed' || !Number.isSafeInteger(viewers) || !Number.isSafeInteger(streamers) ||
      viewers < 0 || streamers < 0 || (streamers === 0 && viewers > 0)) return null;
  return { viewers, streamers };
}

function trialMedians(samples) {
  if (samples.length < TRIAL_MIN_DAYS) return { viewers: null, streamers: null };
  return {
    viewers: quantile(samples.map(sample => sample.viewers), .5),
    streamers: quantile(samples.map(sample => sample.streamers), .5),
  };
}

function hasTimeAdvantage(a, b) {
  return a.viewers > 0 && a.streamers > 0 && a.viewers >= b.viewers && a.streamers <= b.streamers &&
    (a.viewers > b.viewers || a.streamers < b.streamers);
}

export function compareTrialTimes(index, chunks, gameId, period, hours, region) {
  const reference = index.games[gameId].release_reference;
  const released = reference?.precision === 'day' ? dateStart(reference.date) : NaN;
  const pairs = [], dates = [], coverage = [0, 0];
  for (const day of period.slots) {
    if (day < released) continue;
    const pair = hours.map((hour, i) => {
      const at = day + hour * HOUR;
      const sample = trialCounts(seriesRows(index, chunks, gameId, at, at, region)[0]);
      if (sample) coverage[i]++;
      return sample;
    });
    if (pair.every(Boolean)) { pairs.push(pair); dates.push(dayOf(day)); }
  }
  const slots = hours.map((hour, i) => ({
    hour, observed: coverage[i], ...trialMedians(pairs.map(pair => pair[i])),
    strongerDays: pairs.filter(pair => hasTimeAdvantage(pair[i], pair[1 - i])).length,
  }));
  const typicalLead = slots.find((slot, i) => hasTimeAdvantage(slot, slots[1 - i])) ?? null;
  const preferred = typicalLead && typicalLead.strongerDays * 2 > pairs.length ? typicalLead : null;
  return { slots, dates, typicalLead, preferred, releaseDate: Number.isFinite(released) ? reference.date : null };
}
