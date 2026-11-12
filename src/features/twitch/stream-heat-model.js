import { HOUR } from './metrics.js';
import { dateStart, dayOf } from './series.js';
import { analyzeCooldown } from './cooldown-model.js';
import { quantile } from './statistics-model.js';

const DAY = 24 * HOUR;
export const STREAM_HEAT_DAYS = 3;
export const STREAM_HEAT_FLOORS = { global:1000, zh:50 };

export function streamHeatDate(date, now = Date.now()) {
  const start = dateStart(date);
  return Number.isFinite(start) && start <= now ? date : dayOf(now);
}

export function streamHeatThrough(date, now = Date.now()) {
  const selected = dateStart(streamHeatDate(date, now));
  return dayOf(Math.min(selected, dateStart(dayOf(now)) - DAY));
}

function dailySignal(day, open, minimumHits) {
  if (minimumHits && day?.thresholdHits >= minimumHits) return 'hot';
  if (open) return 'pending';
  if (!day?.complete) return 'insufficient';
  if (!day.belowThreshold) return 'hot';
  if (day.status === 'cooled') return 'cooled';
  return minimumHits && day.thresholdHits > 0 ? 'sporadic' : 'low';
}

function compareHeat(days, recentStart, region) {
  const previousStart = recentStart - STREAM_HEAT_DAYS * DAY;
  const observed = days.flatMap(day => {
    const value = region === 'zh' ? day.fourthHighestViewers : day.median;
    return Number.isFinite(value) ? [{ start:Date.parse(day.startAt), value }] : [];
  });
  const previousValues = observed.filter(day => day.start >= previousStart && day.start < recentStart).map(day => day.value);
  const recentValues = observed.filter(day => day.start >= recentStart).map(day => day.value);
  if (previousValues.length !== STREAM_HEAT_DAYS || recentValues.length !== STREAM_HEAT_DAYS) return null;

  const previous = quantile(previousValues, .5), recent = quantile(recentValues, .5);
  const change = previous > 0 ? (recent - previous) / previous * 100 : null;
  const floor = STREAM_HEAT_FLOORS[region], target = Math.max(floor, previous * 1.5, previous + floor / 2);
  let signal = null;
  if (previous >= floor && change <= -25) signal = 'falling';
  else if (recentValues.at(-1) >= target && recentValues.filter(value => value >= target).length >= 2) {
    signal = observed.some(day => day.start < recentStart && day.value >= floor) ? 'rising' : 'breakout';
  }
  return { previous, recent, change, signal };
}

function confirmationDate(data) {
  const episode = data.episodes.at(-1);
  const confirmation = episode?.reconfirmations.at(-1)?.confirmedAt ?? episode?.confirmedAt;
  return confirmation ? dayOf(Date.parse(confirmation)) : null;
}

function concentration(rows, start, end, now) {
  const samples = [];
  for (const row of rows) {
    const { viewer_count: viewers, largest_stream_viewer_count: largest } = row;
    if (row.status !== 'observed' || !Number.isSafeInteger(viewers) || viewers <= 0 ||
        !Number.isSafeInteger(largest) || largest < 0 || largest > viewers) continue;
    const at = Date.parse(row.hour);
    if (at >= start && at < end && at <= now) samples.push({ share: largest / viewers * 100, remaining: viewers - largest });
  }
  return samples.length >= 3 ? {
    share: quantile(samples.map(sample => sample.share), .5),
    remaining: quantile(samples.map(sample => sample.remaining), .5),
  } : null;
}

export function analyzeStreamHeat(rows, { game, region, date, now = Date.now() }) {
  date = streamHeatDate(date, now);
  const start = dateStart(date), end = start + DAY, open = now < end;
  const reference = game.release_reference;
  const releaseDate = reference?.precision === 'day' ? reference.date : null;
  const data = analyzeCooldown(rows, { region, now: Math.min(now, end), releaseDate });
  const day = data.days.find(item => Date.parse(item.startAt) === start);
  const { threshold, minimumHits } = data.settings;
  const hits = day?.thresholdHits ?? 0, validHours = day?.validHours ?? 0;
  const signal = dailySignal(day, open, minimumHits);
  const recentStart = dateStart(streamHeatThrough(date, now)) - (STREAM_HEAT_DAYS - 1) * DAY;
  const comparison = compareHeat(data.days, recentStart, region);
  const latest = data.days.findLast(item => item.complete && Date.parse(item.startAt) >= recentStart);
  const recentSignal = dailySignal(latest, false, minimumHits);
  let outlookSignal = comparison?.signal ?? recentSignal;
  if (recentSignal === 'cooled') outlookSignal = open && signal === 'hot' ? 'recovered' : 'cooled';
  else if (!comparison?.signal) {
    if (latest?.status === 'recovered') outlookSignal = 'recovered';
    else if (signal === 'hot') outlookSignal = 'hot';
    else if (latest?.status === 'suspected') outlookSignal = 'suspected';
  }
  return {
    date, signal, threshold, hits, validHours, median: day?.median ?? null,
    confirmedOn: signal === 'cooled' ? confirmationDate(data) : null,
    concentration: minimumHits && validHours >= 3 ? concentration(rows, start, end, now) : null,
    outlook: { signal:outlookSignal, comparison, latest,
      confirmedOn: outlookSignal === 'cooled' ? confirmationDate(data) : null },
  };
}
