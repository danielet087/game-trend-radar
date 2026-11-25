import { count, HOUR } from './metrics.js';
import { dateStart } from './series.js';
import { quantile } from './statistics-model.js';

const DAY = 24 * HOUR;

// Thresholds from the 2026-10/11 launch backtest (global viewers, days counted
// every 24 hours from the release instant). Recompute with
// scripts/backtest_launch_advice.mjs before changing them.
export const LAUNCH_RULES = Object.freeze({
  popular: 3000, // a game that ever reached this daily median keeps the cooldown advice
  firstDay: 300, // first 24 hours
  trialDay: 200, // the latest whole day
  holding: 0.5, // third day against the first day: audience still there
  darkHorse: 1, // third day at least the first day
  burning: 2, // a week on, still twice the first day
  burningFrom: 7, // first day index (0-based) of "a week on"
  candidateUntil: 6, // last day index that can still show a fresh candidate
  labelUntil: 13, // labels only cover the first two weeks
  typicalThirdDay: 0.36, // median third day against the first day, all launches
  minHours: 12,
});

// Same-age launches: each later day's median as a share of the first 24 hours,
// as [lower quartile, median, upper quartile] by 0-based day index (2026-10/11,
// 87 launches with at least 50 viewers in the first 24 hours; each column made
// non-increasing with age). Above the upper quartile a game holds up better
// than three in four same-age games, below the lower quartile it falls faster.
// Recompute monthly with scripts/backtest_heat_signals.mjs.
export const PEER_CURVE = Object.freeze({
  2: [0.228, 0.363, 0.706], 3: [0.142, 0.290, 0.623], 4: [0.133, 0.256, 0.623], 5: [0.093, 0.246, 0.433],
  6: [0.091, 0.186, 0.360], 7: [0.063, 0.141, 0.329], 8: [0.052, 0.141, 0.326], 9: [0.050, 0.125, 0.254],
  10: [0.030, 0.096, 0.254], 11: [0.029, 0.096, 0.220], 12: [0.029, 0.086, 0.202], 13: [0.025, 0.082, 0.202],
  14: [0.018, 0.070, 0.166], 15: [0.018, 0.065, 0.155], 16: [0.018, 0.065, 0.155], 17: [0.016, 0.054, 0.124],
  18: [0.016, 0.054, 0.124], 19: [0.014, 0.051, 0.112], 20: [0.013, 0.051, 0.112],
});

/** How the latest whole day compares with same-age launches (third to 21st day). */
export function peerComparison(days, first = days?.[0]?.median) {
  if (!(first >= LAUNCH_RULES.firstDay)) return null;
  const latest = days.findLast(day => day.median !== null);
  const curve = latest && PEER_CURVE[latest.index];
  if (!curve) return null;
  const ratio = latest.median / first;
  const verdict = ratio >= curve[2] ? 'outlasting' : ratio <= curve[0] ? 'fading' : 'typical';
  return { verdict, day: latest.index, ratio, typical: curve[1] };
}

/** The Steam app a tracked Twitch game is matched to, if any. */
export function steamAppOf(record) {
  const reference = record?.release_reference?.steam_appid;
  if (reference) return String(reference);
  const source = (record?.admission_sources || []).find(value => typeof value === 'string' && value.startsWith('steam:'));
  return source ? source.slice(6) : null;
}

/**
 * Release instant: Steam's release time (to the hour) when it falls within 36
 * hours of the release reference's Taiwan date, otherwise 00:00 Taiwan time.
 */
export function launchInstant(reference, releaseTimeUtc) {
  if (reference?.precision !== 'day') return null;
  const midnight = dateStart(reference.date);
  if (!Number.isFinite(midnight)) return null;
  const exact = Date.parse(releaseTimeUtc);
  return Number.isFinite(exact) && Math.abs(exact - midnight) <= 36 * HOUR ? exact - exact % HOUR : midnight;
}

/** Whole 24-hour days since release; a day needs 12 observed hours for a median. */
export function launchDays(rows, releaseAt, now) {
  if (!Number.isFinite(releaseAt) || !Number.isFinite(now) || now < releaseAt + DAY) return [];
  const total = Math.floor((now - releaseAt) / DAY);
  const viewers = Array.from({ length: total }, () => []), channels = Array.from({ length: total }, () => []);
  for (const row of rows) {
    if (row?.status !== 'observed' || Date.parse(row.generated_at) > now) continue;
    const at = Date.parse(row.hour), index = Math.floor((at - releaseAt) / DAY);
    const value = count(row.viewer_count);
    if (!(index >= 0 && index < total) || value === null) continue;
    viewers[index].push(value);
    const streams = count(row.streamer_count);
    if (streams !== null) channels[index].push(streams);
  }
  return viewers.map((values, index) => {
    const whole = values.length >= LAUNCH_RULES.minHours;
    return { index, startAt: releaseAt + index * DAY, validHours: values.length,
      median: whole ? quantile(values, .5) : null,
      channels: whole && channels[index].length ? quantile(channels[index], .5) : null };
  });
}

function darkHorse(days, first) {
  const third = days[2], latest = days.findLast(day => day.median !== null);
  if (!third || third.median === null || !latest || latest.index > LAUNCH_RULES.labelUntil) return null;
  if (latest.index <= LAUNCH_RULES.candidateUntil) {
    if (third.median < first * LAUNCH_RULES.darkHorse || latest.median < first) return null;
    return { kind: 'candidate', ratio: third.median / first, day: 2, channels: [days[0].channels, third.channels] };
  }
  return latest.index >= LAUNCH_RULES.burningFrom && latest.median >= first * LAUNCH_RULES.burning
    ? { kind: 'burning', ratio: latest.median / first, day: latest.index } : null;
}

/**
 * Trial advice for a game that never reached the popular threshold, and the
 * dark-horse label for any launch: first 24 hours, then the latest whole day.
 * Without a release instant, `fallback` (the latest whole Taiwan day) decides.
 */
export function launchAdvice({ days = [], releaseAt = null, now, fallback = null } = {}) {
  const rule = LAUNCH_RULES;
  if (!Number.isFinite(releaseAt)) {
    if (!Number.isFinite(fallback?.median)) return { stage: 'insufficient', darkHorse: null };
    return { stage: fallback.median >= rule.trialDay ? 'trial' : 'skip', basis: 'taiwan_day', latest: fallback, darkHorse: null };
  }
  if (now < releaseAt) return { stage: 'prelaunch', darkHorse: null };
  if (!days.length) return { stage: 'first', darkHorse: null };
  const first = days[0].median, third = days[2]?.median ?? null;
  const latest = days.findLast(day => day.index >= (first === null ? 1 : 2) && day.median !== null) ?? null;
  if (first === null) {
    if (!latest) return { stage: 'insufficient', darkHorse: null };
    return { stage: latest.median >= rule.trialDay ? 'trial' : 'skip', basis: 'no_first_day', latest, darkHorse: null };
  }
  const horse = first >= rule.firstDay ? darkHorse(days, first) : null;
  const base = { first, third, darkHorse: horse, peer: peerComparison(days, first) };
  if (first < rule.firstDay) return { ...base, stage: 'skip', basis: 'first_day' };
  if (days.length < 3) return { ...base, stage: 'wait' };
  if (!latest) return { ...base, stage: 'insufficient' };
  if (latest.median < rule.trialDay) return { ...base, stage: 'skip', basis: 'latest_day', latest };
  const trend = third === null || latest.index > rule.labelUntil ? null : third >= first * rule.holding ? 'holding' : 'fading';
  return { ...base, stage: 'trial', basis: 'latest_day', latest, trend };
}
