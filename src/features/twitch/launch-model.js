import { count, HOUR } from './metrics.js';
import { dateStart } from './series.js';
import { quantile } from './statistics-model.js';
import { currentLaunch } from './launches.js';

const DAY = 24 * HOUR;

// Thresholds from the 2026-10/11 launch backtest (global viewers, days counted
// every 24 hours from each launch's start, see launchStart). Recompute with
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
  typicalThirdDay: 0.34, // median third day against the first day, all launches (PEER_CURVE[2])
  minHours: 12,
});

// Same-age launches: each later day's median as a share of the first 24 hours,
// as [lower quartile, median, upper quartile] by 0-based day index (2026-10/11,
// 88 launches with at least 50 viewers in the first 24 hours, days counted from
// each launch's start and an Early Access game's full release on its own; each
// column made non-increasing with age). Above the upper quartile a game holds
// up better than three in four same-age games, below the lower quartile it
// falls faster. Recompute monthly with scripts/backtest_heat_signals.mjs.
export const PEER_CURVE = Object.freeze({
  2: [0.218, 0.344, 0.692], 3: [0.132, 0.258, 0.592], 4: [0.132, 0.232, 0.592], 5: [0.094, 0.232, 0.420],
  6: [0.091, 0.160, 0.344], 7: [0.064, 0.129, 0.300], 8: [0.051, 0.129, 0.300], 9: [0.050, 0.117, 0.241],
  10: [0.030, 0.089, 0.232], 11: [0.029, 0.089, 0.203], 12: [0.025, 0.078, 0.200], 13: [0.022, 0.077, 0.196],
  14: [0.019, 0.068, 0.165], 15: [0.018, 0.062, 0.165], 16: [0.017, 0.062, 0.153], 17: [0.012, 0.049, 0.116],
  18: [0.012, 0.049, 0.116], 19: [0.012, 0.049, 0.111], 20: [0.012, 0.049, 0.111],
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

// Where a launch's days start (scripts/build_twitch_launch_curves.py keeps the
// same rule; both are checked against tests/fixtures/launch-start-cases.json).
// Usually the launch instant itself. When the game was already streamed at
// launch level right before it (deluxe early access, a beta that runs into
// the launch, a staggered unlock), the days start when that run began, so
// "the first 24 hours" mean the same thing for every game. Launch level is a
// quarter of the median of the first 24 hours after the launch and at least
// 300 viewers; 12 hours in a row below it end the run, and at least half of
// the hours from the start to the launch must reach it. A few isolated
// preview streams therefore never move the start. Decided once the first 24
// hours are known; a full release after Early Access never moves.
export const START_RULES = Object.freeze({ share: 0.25, floor: 300, gap: 12, density: 0.5, days: 14 });

/** "10/01 23:00" in Taiwan time. */
export function taipeiHour(at) {
  const text = new Date(at + 8 * HOUR).toISOString();
  return `${text.slice(5, 7)}/${text.slice(8, 10)} ${text.slice(11, 16)}`;
}

function observedViewers(row, now) {
  if (row?.status !== 'observed' || Date.parse(row.generated_at) > now) return null;
  return count(row.viewer_count);
}

/** The hour the launch's days start, and whether streams before the launch moved it there. */
export function launchStart(rows, launchAt, now, { walkBack = true } = {}) {
  const base = { startAt: launchAt, basis: 'launch' };
  if (!Number.isFinite(launchAt) || !walkBack || !(now >= launchAt + DAY)) return base;
  const byHour = new Map();
  for (const row of rows || []) {
    const at = Date.parse(row?.hour);
    if (Number.isFinite(at) && !(at % HOUR)) byHour.set(at, row);
  }
  const first = [];
  for (let at = launchAt; at < launchAt + DAY; at += HOUR) {
    const value = observedViewers(byHour.get(at), now);
    if (value !== null) first.push(value);
  }
  if (first.length < LAUNCH_RULES.minHours) return base;
  const level = Math.max(START_RULES.floor, START_RULES.share * quantile(first, .5));
  let startAt = null, hours = 0, reached = 0, below = 0;
  for (let at = launchAt - HOUR; at >= launchAt - START_RULES.days * DAY; at -= HOUR) {
    const row = byHour.get(at);
    if (!row) break; // before the first tracked hour
    if (row.status === 'missing' || Date.parse(row.generated_at) > now) continue;
    // A collection without this game means nobody streamed it.
    const value = row.status === 'absent' ? 0 : count(row.viewer_count);
    if (value === null) continue;
    hours++;
    if (value >= level) {
      reached++; below = 0;
      if (reached / hours >= START_RULES.density) startAt = at;
    } else if (++below >= START_RULES.gap) break;
  }
  return startAt === null ? base : { startAt, basis: 'pre_launch' };
}

/**
 * The launch the launch rules count from at `now` (an Early Access game's
 * full release is a launch of its own), its instant, and where its days start.
 */
export function launchAnchor(record, rows, now, releaseTimeUtc) {
  const launch = currentLaunch(record, now);
  const launchAt = launch ? launchInstant(launch, releaseTimeUtc) : null;
  if (!Number.isFinite(launchAt)) return null;
  return { kind: launch.kind, launchAt, ...launchStart(rows, launchAt, now, { walkBack: launch.kind !== 'full_release' }) };
}

// The week-later forecast. A launch's level over its first 24 (later 48)
// hours times each past launch's ratio of days 7-9 (hours 144-216 after the
// start) to the same hours: the median ratio gives the estimate, the 10th and
// 90th percentiles the 80% range, and the share of past ratios that would take
// this launch to 100 / 1,000 / 3,000 viewers the chance of still having them.
// The ratios come from twitch-launch-curves.json, refitted every day from the
// launches whose days 7-9 had ended (scripts/build_twitch_launch_curves.py).
export const FORECAST_RULES = Object.freeze({ floor: 50, minLaunches: 20, from: 144, to: 216, thresholds: [100, 1000, 3000] });

/** A published forecast model, or null when it is missing or malformed. */
export function forecastModel(value) {
  const ratios = list => Array.isArray(list) && list.every(ratio => Number.isFinite(ratio) && ratio >= 0) ? list : null;
  if (!value || typeof value !== 'object' || !Number.isFinite(Date.parse(value.trained_through))) return null;
  const checkpoints = { 24: ratios(value.checkpoints?.['24']), 48: ratios(value.checkpoints?.['48']) };
  return checkpoints[24] && checkpoints[48] ? { ...value, checkpoints } : null;
}

function windowMedian(rows, startAt, hours, now) {
  const values = [];
  for (const row of rows || []) {
    const at = Date.parse(row?.hour), value = observedViewers(row, now);
    if (value !== null && at >= startAt && at < startAt + hours * HOUR) values.push(value);
  }
  return values.length >= hours / 2 ? quantile(values, .5) : null;
}

/** The forecast for days 7-9 from the hours since the start, or null when it does not apply. */
export function launchForecast(rows, startAt, now, model) {
  const rule = FORECAST_RULES;
  if (!model || !Number.isFinite(startAt) || !(now >= startAt + DAY) || now >= startAt + rule.to * HOUR) return null;
  const first = windowMedian(rows, startAt, 24, now);
  if (first === null || first < rule.floor) return null;
  const second = now >= startAt + 2 * DAY ? windowMedian(rows, startAt, 48, now) : null;
  const checkpoint = second === null ? 24 : 48, base = second ?? first;
  const ratios = model.checkpoints[checkpoint];
  if (ratios.length < rule.minLaunches) return null;
  const share = q => quantile(ratios, q);
  return {
    checkpoint, base, first, launches: ratios.length, trainedThrough: model.trained_through,
    ratio: share(.5), range: [share(.1), share(.9)],
    median: base * share(.5), low: base * share(.1), high: base * share(.9),
    probabilities: Object.fromEntries(rule.thresholds.map(threshold =>
      [threshold, ratios.filter(ratio => base * ratio >= threshold).length / ratios.length])),
    backtest: model.backtest?.[checkpoint] ?? null,
  };
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
