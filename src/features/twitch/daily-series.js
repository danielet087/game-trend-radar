import { analyzeCooldown } from './cooldown-model.js';

// Use the same Taipei day boundaries and median samples as cooldown analysis.
// A rolling range's partial first date is omitted, rather than being compared
// with complete days or borrowing observations outside the chosen range.
export function dailyRows(rows, { now = Date.now(), region } = {}) {
  const start = Date.parse(rows?.[0]?.hour);
  if (!Number.isFinite(start)) return [];
  return analyzeCooldown(rows, { now, region }).days.filter(day => Date.parse(day.startAt) >= start).map(day => ({
    ...day, hour: day.startAt, aggregation: 'daily',
    status: day.median !== null ? 'observed' : 'missing', viewer_count: day.median,
  }));
}
