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

// Launch-day calls, before the first 24 hours are over (2026-10/11 backtest:
// 102 launches with a known first day, every hour of each first day replayed
// with the hours known by then). With three hours of data, a median hour of
// 6,000 viewers on 150 channels called a first day over 3,000 (15 of 15) and
// 450 viewers on 15 channels one over 300 (43 of 46); with six hours, a
// median under 150 viewers called one under 300 (34 of 34). Channels count
// because right after a launch one big streamer can carry the total: ALYSSA
// had 11,593 viewers on four channels and a first day of 41. Recompute with
// scripts/backtest_launch_advice.mjs before changing them.
export const EARLY_RULES = Object.freeze({
  minHours: 3, failHours: 6,
  hot: { viewers: 6000, channels: 150 },
  pass: { viewers: 450, channels: 15 },
  fail: { viewers: 150 },
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

// A start moved by less than this (streams that go live just before the
// unlock) keeps its computed days but is not called out on the pages.
export const START_NOTE_HOURS = 3;

/** Hours between the start and the launch when that is worth saying, else null. */
export function startLead(launchAt, startAt) {
  const hours = Math.round((launchAt - startAt) / HOUR);
  return hours >= START_NOTE_HOURS ? hours : null;
}

/** "5 天" from two days on, otherwise "5 小時". */
export function leadText(hours) {
  return hours >= 48 ? `${Math.round(hours / 24)} 天` : `${hours} 小時`;
}

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
// hours times past launches' ratios of days 7-9 (hours 144-216 after the
// start) to the same hours: the median ratio gives the estimate, the 10th and
// 90th percentiles the 80% range, and the share of ratios that would take this
// launch to 100 / 1,000 / 3,000 viewers the chance of still having them. Only
// the past launches closest in size (the median of those same first hours) are
// used: the closer half, at least 40. Small launches can lose every viewer by
// days 7-9 while big ones never did, so a big launch must not inherit a small
// one's drop to zero. The ratios and sizes come from twitch-launch-curves.json,
// refitted every day from the launches whose days 7-9 had ended; the builder
// (scripts/build_twitch_launch_curves.py) picks them the same way, both checked
// against tests/fixtures/launch-forecast-cases.json.
export const FORECAST_RULES = Object.freeze({
  floor: 50, minLaunches: 20, from: 144, to: 216, thresholds: [100, 1000, 3000], share: 0.5, neighbours: 40,
});

/** A published forecast model, or null when it is missing or malformed. Sizes
 * beside the ratios are optional: without them every past launch is used. */
export function forecastModel(value) {
  const ratios = list => Array.isArray(list) && list.every(ratio => Number.isFinite(ratio) && ratio >= 0) ? list : null;
  const sized = list => Array.isArray(list) && list.length > 0 && list.every(pair => Array.isArray(pair) && pair.length === 2
    && Number.isFinite(pair[0]) && pair[0] > 0 && Number.isFinite(pair[1]) && pair[1] >= 0) ? list : null;
  if (!value || typeof value !== 'object' || !Number.isFinite(Date.parse(value.trained_through))) return null;
  const checkpoints = { 24: ratios(value.checkpoints?.['24']), 48: ratios(value.checkpoints?.['48']) };
  if (!checkpoints[24] || !checkpoints[48]) return null;
  const samples = { 24: sized(value.samples?.['24']), 48: sized(value.samples?.['48']) };
  return { ...value, checkpoints, samples: samples[24] && samples[48] ? samples : null };
}

/** The past launches ([size, ratio]) closest in size to `base`: the closer half,
 * at least 40. Size is compared as a multiple (100 is as close to 50 as to 200);
 * ties go to the smaller launch, then the lower ratio. */
export function closestLaunches(samples, base) {
  const count = Math.max(FORECAST_RULES.neighbours, Math.ceil(samples.length * FORECAST_RULES.share));
  if (count >= samples.length) return [...samples];
  const distance = size => Math.max(size, base) / Math.min(size, base);
  return [...samples].sort((a, b) => distance(a[0]) - distance(b[0]) || a[0] - b[0] || a[1] - b[1]).slice(0, count);
}

/** Days 7-9 for a launch whose first hours had median `base`, from the past
 * launches closest in size (or all of them when their sizes are unknown). */
export function forecastFrom(samples, base, { bySize = true } = {}) {
  const ratios = (bySize ? closestLaunches(samples, base) : samples).map(([, ratio]) => ratio);
  const share = q => quantile(ratios, q);
  return {
    launches: ratios.length, pool: samples.length, ratio: share(.5), range: [share(.1), share(.9)],
    median: base * share(.5), low: base * share(.1), high: base * share(.9),
    probabilities: Object.fromEntries(FORECAST_RULES.thresholds.map(threshold =>
      [threshold, ratios.filter(ratio => base * ratio >= threshold).length / ratios.length])),
  };
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
  if (!(base > 0)) return null;
  // Older files have only the ratios: every past launch is then used.
  const sized = model.samples?.[checkpoint] ?? null;
  const samples = sized ?? model.checkpoints[checkpoint].map(ratio => [null, ratio]);
  if (samples.length < rule.minLaunches) return null;
  return {
    checkpoint, base, first, trainedThrough: model.trained_through,
    ...forecastFrom(samples, base, { bySize: sized !== null }),
    backtest: model.backtest?.[checkpoint] ?? null,
  };
}

/**
 * The first 24 hours so far, at `now`: the hours with data, their median
 * viewers and channels, and the launch-day call (EARLY_RULES): 'hot' (over
 * 3,000), 'pass' (over 300), 'fail' (under 300) or null while it is unclear.
 * Null outside the first 24 hours.
 */
export function earlyCall(rows, startAt, now) {
  if (!Number.isFinite(startAt) || !(now >= startAt) || now >= startAt + DAY) return null;
  const viewers = [], channels = [];
  for (const row of rows || []) {
    const at = Date.parse(row?.hour), value = observedViewers(row, now);
    if (value === null || !(at >= startAt && at < startAt + DAY)) continue;
    viewers.push(value);
    channels.push(count(row.streamer_count) ?? 0);
  }
  if (!viewers.length) return { hours: 0, viewers: null, channels: null, call: null };
  const rule = EARLY_RULES, hours = viewers.length, median = quantile(viewers, .5), streams = quantile(channels, .5);
  const call = hours < rule.minHours ? null
    : median >= rule.hot.viewers && streams >= rule.hot.channels ? 'hot'
      : median >= rule.pass.viewers && streams >= rule.pass.channels ? 'pass'
        : hours >= rule.failHours && median < rule.fail.viewers ? 'fail' : null;
  return { hours, viewers: median, channels: streams, call };
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
 * Inside the first 24 hours, `rows` (hourly, worldwide) give the launch-day
 * call as `early` (earlyCall).
 */
export function launchAdvice({ days = [], releaseAt = null, now, fallback = null, rows = null } = {}) {
  const rule = LAUNCH_RULES;
  if (!Number.isFinite(releaseAt)) {
    if (!Number.isFinite(fallback?.median)) return { stage: 'insufficient', darkHorse: null };
    return { stage: fallback.median >= rule.trialDay ? 'trial' : 'skip', basis: 'taiwan_day', latest: fallback, darkHorse: null };
  }
  if (now < releaseAt) return { stage: 'prelaunch', darkHorse: null };
  // Before the first 24 hours are over, the hours so far may already call it.
  if (!days.length) return { stage: 'first', early: earlyCall(rows, releaseAt, now), darkHorse: null };
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
