import { HOUR, count, timestamp, filteredAudience } from './metrics.js';

const METRICS = ['viewers', 'streamers', 'median'];
const finite = value => typeof value === 'number' && Number.isFinite(value);

// Linear interpolation between ordered observations (the R-7 quantile).
export function quantile(values, probability) {
  const ordered = values.filter(finite).sort((a, b) => a - b);
  if (!ordered.length || !finite(probability) || probability < 0 || probability > 1) return null;
  const position = (ordered.length - 1) * probability, lower = Math.floor(position);
  return ordered[lower] + (ordered[Math.ceil(position)] - ordered[lower]) * (position - lower);
}

export function metricValue(row, metric = 'viewers') {
  if (row?.status !== 'observed') return null;
  if (metric === 'median') return filteredAudience(row.filtered_audience).median_viewer_count;
  return metric === 'streamers' ? count(row.streamer_count) : metric === 'viewers' ? count(row.viewer_count) : null;
}

function normalize(rows) {
  const unique = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!timestamp(row?.hour)) continue;
    const at = Date.parse(row.hour);
    // Series slots represent whole hours, rather than the collection's finish time.
    if (at % HOUR) continue;
    unique.set(at, { ...row, hour: new Date(at).toISOString().replace('.000Z', 'Z'), at });
  }
  return [...unique.values()].sort((a, b) => a.at - b.at);
}

function median(values) { return quantile(values, .5); }
function distribution(points) {
  const values = points.map(point => point.value).filter(finite);
  return {
    count: values.length, total: points.length, coverage: points.length ? values.length / points.length : 0,
    min: values.length ? Math.min(...values) : null, q1: quantile(values, .25), median: median(values),
    q3: quantile(values, .75), max: values.length ? Math.max(...values) : null,
    mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    values,
  };
}

function trend(points) {
  const rawPoints = points.map(({ hour, value }) => ({ hour, value }));
  const smoothed = points.map((point, index) => {
    const window = points.slice(Math.max(0, index - 23), index + 1);
    const valid = window.length === 24 && window.every((item, offset) => finite(item.value) && item.at === point.at - (23 - offset) * HOUR);
    return { hour: point.hour, raw: point.value, value: valid ? median(window.map(item => item.value)) : null };
  });
  const end = points.at(-1)?.at;
  function period(offset) {
    const last = end - offset * HOUR;
    const window = points.filter(point => point.at >= last - 23 * HOUR && point.at <= last);
    const values = window.map(point => point.value).filter(finite);
    return { median: median(values), count: values.length,
      complete: window.length === 24 && window.every((point, index) => finite(point.value) && point.at === last - (23 - index) * HOUR) };
  }
  const current = period(0), previous = period(24);
  const comparable = current.complete && previous.complete;
  let reason = '';
  if (!comparable) reason = '需要連續兩個完整的 24 小時有效紀錄，才能比較前後變化。';
  else if (previous.median === 0) reason = '前一個 24 小時中位數為 0，無法計算百分比。';
  const change = comparable && previous.median > 0 ? (current.median - previous.median) / previous.median * 100 : null;
  return { points: smoothed, rawPoints, current, previous, change, comparable, reason };
}

function persistence(points, threshold) {
  let countAbove = 0, total = 0, run = 0, runStart = null, previousAt = null;
  let longestHours = 0, longestStart = null, longestEnd = null;
  const result = points.map(({ hour, at, viewers: value }) => {
    const valid = finite(value), above = valid && value >= threshold;
    if (valid) total++;
    if (above) {
      countAbove++;
      if (!run || at !== previousAt + HOUR) { run = 0; runStart = hour; }
      run++;
      if (run > longestHours) { longestHours = run; longestStart = runStart; longestEnd = hour; }
    } else run = 0;
    previousAt = at;
    return { hour, value, above: valid ? above : null };
  });
  return { threshold, count: countAbove, total, totalSlots: points.length, ratio: total ? countAbove / total : null,
    longestHours, longestStart, longestEnd, points: result };
}

function supply(points) {
  const result = points.map(({ hour, viewers, streamers }) => ({ hour, viewers, streamers,
    average: finite(viewers) && finite(streamers) && streamers > 0 ? viewers / streamers : null }));
  const paired = result.filter(point => finite(point.viewers) && finite(point.streamers));
  return { points: result, pairedCount: paired.length, viewersMedian: median(paired.map(point => point.viewers)),
    streamersMedian: median(paired.map(point => point.streamers)), averageMedian: median(paired.map(point => point.average)) };
}

function hourly(points) {
  const groups = Array.from({ length: 24 }, () => ({ values: [], dates: new Set() })), dates = new Set();
  for (const point of points) {
    if (!finite(point.value)) continue;
    const local = new Date(point.at + 8 * HOUR).toISOString(), hour = Number(local.slice(11, 13)), date = local.slice(0, 10);
    groups[hour].values.push(point.value); groups[hour].dates.add(date); dates.add(date);
  }
  return { observedDays: dates.size, hours: groups.map((group, hour) => ({ hour, median: median(group.values),
    q1: quantile(group.values, .25), q3: quantile(group.values, .75), count: group.values.length, days: group.dates.size })) };
}

export function analyzeStatistics(rows, { metric = 'viewers', threshold = 5000 } = {}) {
  metric = METRICS.includes(metric) ? metric : 'viewers';
  threshold = finite(threshold) && threshold >= 0 ? threshold : 5000;
  const points = normalize(rows).map(row => ({ hour: row.hour, at: row.at, value: metricValue(row, metric),
    viewers: metricValue(row, 'viewers'), streamers: metricValue(row, 'streamers') }));
  return { metric, distribution: distribution(points), trend: trend(points), persistence: persistence(points, threshold),
    supply: supply(points), hourly: hourly(points) };
}
