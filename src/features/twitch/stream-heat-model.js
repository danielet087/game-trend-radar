import { HOUR } from './metrics.js';
import { dateStart, dayOf } from './series.js';
import { analyzeCooldown } from './cooldown-model.js';
import { quantile } from './statistics-model.js';

const DAY = 24 * HOUR;

export function streamHeatDate(date, now = Date.now()) {
  const start = dateStart(date);
  return Number.isFinite(start) && start <= now ? date : dayOf(now);
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
  const start = dateStart(streamHeatDate(date, now)), end = start + DAY;
  const reference = game.release_reference;
  const releaseDate = reference?.precision === 'day' ? reference.date : null;
  const data = analyzeCooldown(rows, { region, now: Math.min(now, end), releaseDate });
  const day = data.days.find(item => Date.parse(item.startAt) === start);
  const { threshold, minimumHits } = data.settings;
  const hits = day?.thresholdHits ?? 0, validHours = day?.validHours ?? 0;
  let signal;
  if (minimumHits && hits >= minimumHits) signal = 'hot';
  else if (now < end) signal = 'pending';
  else if (!day?.complete) signal = 'insufficient';
  else if (!day.belowThreshold) signal = 'hot';
  else if (day.status === 'cooled') signal = 'cooled';
  else signal = minimumHits && hits > 0 ? 'sporadic' : 'low';
  const episode = signal === 'cooled' ? data.episodes.at(-1) : null;
  const confirmation = episode?.reconfirmations.at(-1)?.confirmedAt ?? episode?.confirmedAt;
  return {
    signal, threshold, hits, validHours, median: day?.median ?? null,
    confirmedOn: confirmation ? dayOf(Date.parse(confirmation)) : null,
    concentration: minimumHits && validHours >= 3 ? concentration(rows, start, end, now) : null,
  };
}
