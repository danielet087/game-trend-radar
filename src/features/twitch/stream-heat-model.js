import { count, HOUR } from './metrics.js';
import { dateStart, dayOf } from './series.js';
import { analyzeCooldown, cooldownVerdict } from './cooldown-model.js';
import { quantile } from './statistics-model.js';
import { isIndependentChineseMeasurement } from './audience-region.js';

const DAY = 24 * HOUR;
export const STREAM_HEAT_DAYS = 3;
export const STREAM_HEAT_FLOORS = { global:1000, zh:50 };
export const STREAM_HEAT_WEEK = 7;
export const MIN_PAIRED_HEAT_HOURS = 6;
export const MIN_CONCENTRATION_HOURS = 3;
const median = values => quantile(values, .5);

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
  // Either cooldown rule: the fixed threshold, or a quarter of the game's own peak.
  if (day.status === 'cooled' || day.peakStatus === 'cooled') return 'cooled';
  if (!day.belowThreshold) return 'hot';
  return minimumHits && day.thresholdHits > 0 ? 'sporadic' : 'low';
}

function compareHeat(days, recentStart, region, rows) {
  const previousStart = recentStart - STREAM_HEAT_DAYS * DAY;
  const observed = days.flatMap(day => {
    const value = region === 'zh' ? day.fourthHighestViewers : day.median;
    return Number.isFinite(value) ? [{ start:Date.parse(day.startAt), value }] : [];
  });
  const previousValues = observed.filter(day => day.start >= previousStart && day.start < recentStart).map(day => day.value);
  const recentValues = observed.filter(day => day.start >= recentStart).map(day => day.value);
  if (previousValues.length !== STREAM_HEAT_DAYS || recentValues.length !== STREAM_HEAT_DAYS) return null;
  if (region === 'zh') {
    const end = recentStart + STREAM_HEAT_DAYS * DAY;
    const samples = observedHours(rows, previousStart, end, end);
    const methods = new Set([...samples.values()].filter(row => count(row.viewer_count) !== null)
      .map(isIndependentChineseMeasurement));
    if (methods.size > 1) return null;
  }

  const previous = quantile(previousValues, .5), recent = quantile(recentValues, .5);
  const change = previous > 0 ? (recent - previous) / previous * 100 : null;
  const floor = STREAM_HEAT_FLOORS[region], target = Math.max(floor, previous * 1.5, previous + floor / 2);
  // A fall over three days is not labelled: new games fall anyway, so it said
  // nothing about the days after (77% kept falling, 87% without the label).
  // Launch-age comparisons (launch-model.js) say how a game holds up instead.
  // A rise is "back at a high level": 44% kept rising, 75% stayed 1.5x above.
  const signal = recentValues.at(-1) >= target && recentValues.filter(value => value >= target).length >= 2 ? 'rising' : null;
  return { previous, recent, change, signal };
}

function confirmationDate(data) {
  const episode = cooldownVerdict(data).basis === 'peak' ? data.peakCooldown.episodes.at(-1) : data.episodes.at(-1);
  const confirmation = episode?.reconfirmations.at(-1)?.confirmedAt ?? episode?.confirmedAt;
  return confirmation ? dayOf(Date.parse(confirmation)) : null;
}

function heatWeek(days, through) {
  const first = Date.parse(days.find(day => day.validHours > 0)?.startAt);
  if (!Number.isFinite(first) || first > through) return null;
  const start = Math.max(first, through - (STREAM_HEAT_WEEK - 1) * DAY);
  const total = (through - start) / DAY + 1;
  const known = days.filter(day => {
    const at = Date.parse(day.startAt);
    return day.complete && at >= start && at <= through;
  });
  return { total, hot:known.filter(day => !day.belowThreshold).length, unknown:total - known.length };
}

function observedHours(rows, start, end, now) {
  const samples = new Map();
  for (const row of rows) {
    const at = Date.parse(row.hour);
    if (row.status === 'observed' && Number.isFinite(at) && at % HOUR === 0 &&
        at >= start && at < end && at <= now) {
      samples.set(at, row);
    }
  }
  return samples;
}

function todayChange(rows, start, now, region) {
  const samples = observedHours(rows, start - STREAM_HEAT_WEEK * DAY, start + DAY, now);
  const differences = [], baselines = [];
  for (let at = start; at < start + DAY; at += HOUR) {
    const row = samples.get(at);
    const current = count(row?.viewer_count);
    if (current === null) continue;
    const earlier = [];
    for (let day = 1; day <= STREAM_HEAT_WEEK; day++) {
      const prior = samples.get(at - day * DAY);
      if (region === 'zh' && isIndependentChineseMeasurement(row) !== isIndependentChineseMeasurement(prior)) continue;
      const value = count(prior?.viewer_count);
      if (value !== null) earlier.push(value);
    }
    if (earlier.length < STREAM_HEAT_DAYS) continue;
    const baseline = median(earlier);
    baselines.push(baseline);
    differences.push(current - baseline);
  }
  if (differences.length < MIN_PAIRED_HEAT_HOURS) return null;
  const change = median(differences);
  if (Math.abs(change) < Math.max(STREAM_HEAT_FLOORS[region] / 2, median(baselines) * .25)) return null;
  return { change, hours:differences.length };
}

function remainingViewers(row) {
  const viewers = count(row?.viewer_count), largest = count(row?.largest_stream_viewer_count);
  return viewers !== null && largest !== null && largest <= viewers ? viewers - largest : null;
}

export function remainingAudienceTrend(rows, { date, now = Date.now(), releaseDate } = {}) {
  const selected = dateStart(streamHeatDate(date, now));
  const currentDay = dateStart(dayOf(now));
  const isToday = selected === currentDay;
  const start = selected - (STREAM_HEAT_WEEK - 1) * DAY;
  const released = dateStart(releaseDate);
  const samples = observedHours(rows.filter(row => !(Date.parse(row.generated_at) > now)),
    Number.isFinite(released) ? Math.max(start - DAY, released) : start - DAY, selected + DAY, now);
  const trend = [];
  for (let day = start; day <= selected; day += DAY) {
    const shares = [], viewers = [], streams = [];
    for (let at = day; at < day + DAY; at += HOUR) {
      const current = samples.get(at), previous = samples.get(at - DAY);
      const currentViewers = remainingViewers(current), previousViewers = remainingViewers(previous);
      if (currentViewers !== null && current.viewer_count > 0) {
        shares.push(current.largest_stream_viewer_count / current.viewer_count * 100);
      }
      const currentStreams = count(current?.streamer_count), previousStreams = count(previous?.streamer_count);
      if ([currentViewers, previousViewers, currentStreams, previousStreams].includes(null)) continue;
      if (isIndependentChineseMeasurement(current) !== isIndependentChineseMeasurement(previous)) continue;
      viewers.push(currentViewers - previousViewers);
      streams.push(currentStreams - previousStreams);
    }
    const share = shares.length >= MIN_CONCENTRATION_HOURS ? median(shares) : null;
    const paired = viewers.length >= MIN_PAIRED_HEAT_HOURS;
    if (share === null && !paired) continue;
    trend.push({ date:dayOf(day), share, viewers:paired ? median(viewers) : null,
      streams:paired ? median(streams) : null, hours:viewers.length, partial:isToday && day === selected });
  }
  return trend;
}

function concentration(rows, start, end, now) {
  const samples = [];
  for (const row of observedHours(rows, start, end, now).values()) {
    const remaining = remainingViewers(row);
    if (remaining !== null && row.viewer_count > 0) {
      samples.push({ share: row.largest_stream_viewer_count / row.viewer_count * 100, remaining });
    }
  }
  return samples.length >= MIN_CONCENTRATION_HOURS ? {
    share: quantile(samples.map(sample => sample.share), .5),
    remaining: quantile(samples.map(sample => sample.remaining), .5),
  } : null;
}

export function analyzeStreamHeat(rows, { game, region = 'global', date, now = Date.now() }) {
  date = streamHeatDate(date, now);
  const start = dateStart(date), end = start + DAY, open = now < end;
  const reference = game.release_reference;
  const releaseDate = reference?.precision === 'day' ? reference.date : null;
  const released = dateStart(releaseDate);
  const available = rows.filter(row => !(Date.parse(row.generated_at) > now) && !(Date.parse(row.hour) < released));
  const data = analyzeCooldown(available, { region, now: Math.min(now, end) });
  const day = data.days.find(item => Date.parse(item.startAt) === start);
  const { threshold, minimumHits } = data.settings;
  const hits = day?.thresholdHits ?? 0, validHours = day?.validHours ?? 0;
  const signal = dailySignal(day, open, minimumHits);
  const through = dateStart(streamHeatThrough(date, now));
  const recentStart = through - (STREAM_HEAT_DAYS - 1) * DAY;
  const comparison = compareHeat(data.days, recentStart, region, available);
  const latest = data.days.findLast(item => item.complete && Date.parse(item.startAt) >= recentStart);
  const recentSignal = dailySignal(latest, false, minimumHits);
  let outlookSignal = comparison?.signal ?? recentSignal;
  if (recentSignal === 'cooled') outlookSignal = open && signal === 'hot' ? 'recovered' : 'cooled';
  else if (!comparison?.signal) {
    if (latest?.status === 'recovered' || latest?.peakStatus === 'recovered') outlookSignal = 'recovered';
    else if (signal === 'hot') outlookSignal = 'hot';
    else if (latest?.status === 'suspected' || latest?.peakStatus === 'suspected') outlookSignal = 'suspected';
  }
  // Which rule cooled it, and the peak behind the own-peak rule.
  const cooledBy = outlookSignal === 'cooled' ? (latest?.status === 'cooled' ? 'threshold' : 'peak') : null;
  return {
    date, signal, threshold, hits, validHours, median: day?.median ?? null, popularAt: data.popularAt,
    week:heatWeek(data.days, through), todayChange:open ? todayChange(available, start, now, region) : null,
    confirmedOn: signal === 'cooled' ? confirmationDate(data) : null,
    concentration: minimumHits && validHours >= MIN_CONCENTRATION_HOURS ? concentration(available, start, end, now) : null,
    outlook: { signal:outlookSignal, comparison, latest, cooledBy,
      peak: cooledBy === 'peak' ? data.peakCooldown.peak.median : null,
      confirmedOn: outlookSignal === 'cooled' ? confirmationDate(data) : null },
  };
}
