import { HOUR } from './metrics.js';
import { dateStart, dayOf } from './series.js';
import { analyzeCooldown } from './cooldown-model.js';
import { cooldownPresentation } from './cooldown.js';
import { quantile } from './statistics-model.js';

const DAY = 24 * HOUR;
export const STREAM_HEAT_DAYS = 3;
export const STREAM_HEAT_FLOORS = { global: 1000, zh: 50 };

export function streamHeatWindow(now = Date.now()) {
  const today = dateStart(dayOf(now));
  const days = Array.from({ length: 2 * STREAM_HEAT_DAYS }, (_, i) => dayOf(today - (2 * STREAM_HEAT_DAYS - i) * DAY));
  return { previous: days.slice(0, STREAM_HEAT_DAYS), recent: days.slice(STREAM_HEAT_DAYS), now };
}

function sample(dates, dailyMedians) {
  const values = dates.map(date => dailyMedians.get(date)).filter(Number.isFinite);
  return { values, median: values.length === dates.length ? quantile(values, .5) : null };
}

export function analyzeStreamHeat(rows, { game, region, period }) {
  const data = analyzeCooldown(rows, { now: period.now });
  const last = data.points.findLast(point => point.raw !== null);
  const snapshot = cooldownPresentation(data, { trackingStatus: game.tracking_status, lastHour: last?.hour }, period.now);
  const release = game.release_reference;
  const released = release?.precision === 'day' ? dateStart(release.date) : NaN;
  const validDays = data.days.filter(day => day.complete && !(Date.parse(day.startAt) < released));
  const dailyMedians = new Map(validDays.map(day => [day.date, day.median]));
  const previous = sample(period.previous, dailyMedians), recent = sample(period.recent, dailyMedians);
  const comparable = previous.median !== null && recent.median !== null;
  const change = comparable && previous.median > 0 ? (recent.median - previous.median) / previous.median * 100 : null;
  const comparison = { previous, recent, change };

  if (snapshot.historical) return { ...comparison, signal: 'ended', lastDay: validDays.at(-1)?.date };
  if (snapshot.status === 'stale' || !data.latest.complete || data.latest.day !== period.recent.at(-1)) {
    return { ...comparison, signal: 'insufficient' };
  }
  const { threshold, confirmDays } = data.settings;
  const { lowDays } = data.latest;
  if (snapshot.status === 'cooled') {
    const episode = data.episodes.at(-1);
    const confirmedAt = episode?.reconfirmations.at(-1)?.confirmedAt ?? episode?.confirmedAt;
    return { ...comparison, signal: 'cooled', confirmedOn: confirmedAt ? dayOf(Date.parse(confirmedAt)) : null, threshold, lowDays };
  }
  if (snapshot.status === 'suspected') return { ...comparison, signal: 'suspected', threshold, lowDays, confirmDays };
  if (snapshot.status === 'recovered') return { ...comparison, signal: 'recovered', threshold };

  if (comparable) {
    const floor = STREAM_HEAT_FLOORS[region];
    const target = Math.max(floor, previous.median * 1.5, previous.median + floor / 2);
    const growthDays = recent.values.filter(value => value >= target).length;
    if (growthDays >= 2 && recent.values.at(-1) >= target) {
      const reachedBefore = validDays.some(day => day.date < period.recent[0] && day.median >= floor);
      return { ...comparison, signal: reachedBefore ? 'rising' : 'breakout', growthDays };
    }
    if (previous.median >= floor && change <= -25) return { ...comparison, signal: 'falling' };
  }
  return { ...comparison, signal: snapshot.status === 'watching' ? 'hot' : 'not_popular' };
}
