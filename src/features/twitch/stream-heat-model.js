import { HOUR } from './metrics.js';
import { dateStart, dayOf } from './series.js';
import { analyzeCooldown } from './cooldown-model.js';
import { cooldownPresentation } from './cooldown.js';
import { quantile } from './statistics-model.js';

const DAY = 24 * HOUR;
export const STREAM_HEAT_DAYS = 3;
export const STREAM_HEAT_FLOORS = { global: 1000, zh: 50 };
export const STREAM_EVENING = { startHour: 19, minHours: 3 };

export function streamHeatWindow(now = Date.now()) {
  const today = dateStart(dayOf(now));
  const days = Array.from({ length: 2 * STREAM_HEAT_DAYS }, (_, i) => dayOf(today - (2 * STREAM_HEAT_DAYS - i) * DAY));
  return { previous: days.slice(0, STREAM_HEAT_DAYS), recent: days.slice(STREAM_HEAT_DAYS), now };
}

function sample(dates, dailyMedians) {
  const values = dates.map(date => dailyMedians.get(date)).filter(Number.isFinite);
  return { values, median: values.length === dates.length ? quantile(values, .5) : null };
}

function eveningMedians({ days, points }, released) {
  const byHour = new Map(points.map(({ hour, raw }) => [Date.parse(hour), raw]));
  const { startHour, minHours } = STREAM_EVENING;
  const medians = new Map();
  for (const day of days) {
    const start = Date.parse(day.startAt);
    if (!day.isClosed || start < released) continue;
    const viewers = Array.from({ length: 24 - startHour }, (_, index) =>
      byHour.get(start + (startHour + index) * HOUR)).filter(Number.isFinite);
    if (viewers.length >= minHours) medians.set(day.date, quantile(viewers, .5));
  }
  return medians;
}

function eveningConcentration(rows, dates, released) {
  const { startHour, minHours } = STREAM_EVENING;
  const byHour = new Map();
  for (const row of rows) {
    const { viewer_count: viewers, largest_stream_viewer_count: largest } = row;
    if (row.status === 'observed' && Number.isSafeInteger(viewers) && viewers > 0 &&
        Number.isSafeInteger(largest) && largest >= 0 && largest <= viewers) {
      byHour.set(Date.parse(row.hour), { share: largest / viewers * 100, remaining: viewers - largest });
    }
  }
  const nights = [];
  for (const date of dates) {
    const start = dateStart(date);
    if (start < released) continue;
    const hours = Array.from({ length: 24 - startHour }, (_, i) => byHour.get(start + (startHour + i) * HOUR)).filter(Boolean);
    if (hours.length >= minHours) nights.push({
      share: quantile(hours.map(hour => hour.share), .5),
      remaining: quantile(hours.map(hour => hour.remaining), .5),
    });
  }
  return nights.length ? {
    share: quantile(nights.map(night => night.share), .5),
    remaining: quantile(nights.map(night => night.remaining), .5),
    nights: nights.length,
  } : null;
}

function wholeDayTrend(data, status) {
  const { threshold, confirmDays } = data.settings;
  const { lowDays } = data.latest;
  if (status === 'cooled') {
    const episode = data.episodes.at(-1);
    const confirmedAt = episode?.reconfirmations.at(-1)?.confirmedAt ?? episode?.confirmedAt;
    return { signal: 'cooled', confirmedOn: confirmedAt ? dayOf(Date.parse(confirmedAt)) : null, threshold, lowDays };
  }
  if (status === 'suspected') return { signal: 'suspected', threshold, lowDays, confirmDays };
  if (status === 'recovered') return { signal: 'recovered', threshold };
  return null;
}

export function analyzeStreamHeat(rows, { game, region, period }) {
  const data = analyzeCooldown(rows, { now: period.now, region });
  const last = data.points.findLast(point => point.raw !== null);
  const snapshot = cooldownPresentation(data, { trackingStatus: game.tracking_status, lastHour: last?.hour }, period.now);
  const release = game.release_reference;
  const released = release?.precision === 'day' ? dateStart(release.date) : NaN;
  const evening = region === 'zh';
  const dailyMedians = evening ? eveningMedians(data, released)
    : new Map(data.days.filter(day => day.complete && !(Date.parse(day.startAt) < released))
      .map(day => [day.date, day.median]));
  const previous = sample(period.previous, dailyMedians), recent = sample(period.recent, dailyMedians);
  const comparable = previous.median !== null && recent.median !== null;
  const change = comparable && previous.median > 0 ? (recent.median - previous.median) / previous.median * 100 : null;
  const comparison = { previous, recent, change };
  if (evening) {
    const concentration = eveningConcentration(rows, period.recent, released);
    if (concentration) comparison.concentration = concentration;
  }

  if (snapshot.historical) return { ...comparison, signal: 'ended', lastDay: [...dailyMedians.keys()].at(-1) };
  const current = snapshot.status !== 'stale';
  const fullDayReady = current && data.latest.complete && data.latest.day === period.recent.at(-1);
  const wholeDay = fullDayReady ? wholeDayTrend(data, snapshot.status) : null;
  if (evening && wholeDay) comparison.wholeDay = wholeDay;
  if (!current || (evening ? recent.median === null : !fullDayReady)) {
    return { ...comparison, signal: 'insufficient' };
  }
  if (!evening && wholeDay) return { ...comparison, ...wholeDay };

  if (comparable) {
    const floor = STREAM_HEAT_FLOORS[region];
    const target = Math.max(floor, previous.median * 1.5, previous.median + floor / 2);
    const growthDays = recent.values.filter(value => value >= target).length;
    if (growthDays >= 2 && recent.values.at(-1) >= target) {
      const reachedBefore = [...dailyMedians].some(([date, median]) => date < period.recent[0] && median >= floor);
      return { ...comparison, signal: reachedBefore ? 'rising' : 'breakout', growthDays };
    }
    if (previous.median >= floor && change <= -25) return { ...comparison, signal: 'falling' };
  }
  const hot = evening ? recent.median >= data.settings.threshold : snapshot.status === 'watching';
  return { ...comparison, signal: hot ? 'hot' : 'not_popular' };
}
