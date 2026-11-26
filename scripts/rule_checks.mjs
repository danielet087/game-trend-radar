// The checks behind the launch and heat rules, run with the same code the
// pages run. Shared by the backtest scripts (backtest_launch_advice.mjs,
// backtest_heat_signals.mjs) and the monthly review (rule_review.mjs); each
// takes what readLaunches(dir) returns (scripts/launch_sample.mjs).
import { HOUR } from '../src/features/twitch/metrics.js';
import { dateStart } from '../src/features/twitch/series.js';
import { analyzeCooldown } from '../src/features/twitch/cooldown-model.js';
import { LAUNCH_RULES, PEER_CURVE, earlyCall, peerComparison } from '../src/features/twitch/launch-model.js';
import { quantile } from '../src/features/twitch/statistics-model.js';

const DAY = 24 * HOUR;
const median = values => quantile(values, .5);

/** Small launches (first day 50-2,999, ten days known) with the median of the next week (days 4-10, 1-based). */
export function smallLaunches(launches) {
  return launches.filter(l => l.value(0) >= 50 && l.value(0) < LAUNCH_RULES.popular && l.days.length >= 10)
    .map(l => {
      const week = [3, 4, 5, 6, 7, 8, 9].map(l.value).filter(value => value !== null);
      return week.length >= 4 ? { ...l, week: median(week) } : null;
    }).filter(Boolean);
}

/** A small launch that still had 100 viewers a day the next week. */
export const stillWatched = l => l.week >= 100;

/** The site's trial rule: 300+ in the first 24 hours and 200+ on day 3. */
export const trialRule = l => l.value(0) >= LAUNCH_RULES.firstDay && (l.value(2) ?? 0) >= LAUNCH_RULES.trialDay;

/** How a rule split the small launches, and how many on each side were still watched. */
export function ruleOutcome(small, test) {
  const flagged = small.filter(test), rest = small.filter(l => !test(l));
  return { small: small.length, flagged: flagged.length, held: flagged.filter(stillWatched).length,
    rest: rest.length, restHeld: rest.filter(stillWatched).length };
}

/**
 * The launch-day calls (EARLY_RULES) replayed hour by hour over each launch's
 * first 24 hours, as the pages would have shown them: the first call stands
 * and is checked against the first day (hot: 3,000 or more, pass: 300 or
 * more, fail: under 300). `open` launches had no call within 24 hours.
 */
export function earlyOutcome(launches) {
  const known = launches.filter(l => l.value(0) !== null && Number.isFinite(l.launchAt));
  const calls = { hot: { said: 0, right: 0 }, pass: { said: 0, right: 0 }, fail: { said: 0, right: 0 } };
  const right = { hot: first => first >= LAUNCH_RULES.popular, pass: first => first >= LAUNCH_RULES.firstDay, fail: first => first < LAUNCH_RULES.firstDay };
  let open = 0;
  for (const l of known) {
    let call = null;
    for (let now = l.launchAt + HOUR; now < l.launchAt + DAY && !call; now += HOUR) call = earlyCall(l.rows, l.launchAt, now)?.call ?? null;
    if (!call) { open++; continue; }
    calls[call].said++;
    if (right[call](l.value(0))) calls[call].right++;
  }
  return { launches: known.length, open, ...calls };
}

/** Launches watched two weeks (or that already doubled), each marked a dark horse when a later day doubled the first. */
export function darkHorseLaunches(launches) {
  return launches.filter(l => l.value(0) >= 50 && l.value(2) !== null).map(l => {
    const later = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].filter(k => l.value(k) !== null);
    return { ...l, dark: later.some(k => l.value(k) >= 2 * l.value(0)), lasting: later.some(k => k >= 7 && l.value(k) >= 2 * l.value(0)) };
  }).filter(l => l.days.length >= 14 || l.dark);
}

/** The dark-horse rule (day 3 at least the first day) for launches whose first day reached `floor`. */
export function darkHorseOutcome(watched, floor = LAUNCH_RULES.firstDay) {
  const dark = watched.filter(l => l.dark);
  const flagged = watched.filter(l => l.value(0) >= floor && l.value(2) >= l.value(0) * LAUNCH_RULES.darkHorse);
  const caught = flagged.filter(l => l.dark);
  return { watched: watched.length, dark: dark.length, lasting: dark.filter(l => l.lasting).length,
    eligible: dark.filter(l => l.value(0) >= floor).length, flagged: flagged.length, caught: caught.length,
    caughtLasting: caught.filter(l => l.lasting).length };
}

/** Cooldown calls by the fixed 3,000 rule and the own-peak rule on the game page's worldwide days. */
export function cooldownOutcome(games) {
  const rules = { threshold: { covered: 0, calls: [] }, peak: { covered: 0, calls: [] } };
  const earlier = [];
  for (const { game, rows, now } of games) {
    const data = analyzeCooldown(rows, { region: 'global', now });
    const reference = game.release_reference?.precision === 'day' ? dateStart(game.release_reference.date) : null;
    const record = (rule, covered, episodes) => {
      if (!covered) return;
      rules[rule].covered++;
      for (const episode of episodes) {
        const confirmed = Date.parse(episode.confirmedAt);
        const back = episode.recoveryAt ? Date.parse(episode.recoveryAt) : null;
        rules[rule].calls.push({ back7: back !== null && back - confirmed < 7 * DAY,
          day: Number.isFinite(reference) && confirmed >= reference ? (confirmed - reference) / DAY : null });
      }
    };
    record('threshold', data.popularAt !== null, data.episodes);
    record('peak', data.peakCooldown.peak?.median >= data.peakCooldown.minPeak, data.peakCooldown.episodes);
    const [fixed, own] = [data.episodes[0]?.confirmedAt, data.peakCooldown.episodes[0]?.confirmedAt].map(Date.parse);
    if (Number.isFinite(fixed) && Number.isFinite(own)) earlier.push((fixed - own) / DAY);
  }
  return { games: games.length, rules, earlier };
}

/** Same-age labels on day k (0-based) against day k + 5, for launches with 300+ on their first day. */
export function sameAgeOutcome(launches) {
  const outcome = {};
  let counted = 0;
  for (const { days } of launches) {
    const first = days[0]?.median;
    if (!(first >= LAUNCH_RULES.firstDay)) continue;
    counted++;
    for (const day of days) {
      const later = days[day.index + 5];
      if (day.median === null || !PEER_CURVE[day.index] || !PEER_CURVE[later?.index] || later.median === null) continue;
      const { verdict } = peerComparison(days.slice(0, day.index + 1), first);
      const entry = outcome[verdict] ||= { labels: 0, above: 0 };
      entry.labels++;
      entry.above += later.median / first >= PEER_CURVE[later.index][1];
    }
  }
  return { launches: counted, outcome };
}

/**
 * The same-age curve (PEER_CURVE) recomputed: each day's median against the
 * first 24 hours, as [lower quartile, median, upper quartile] over launches
 * with at least 50 viewers in their first 24 hours, each column made
 * non-increasing with age.
 */
export function sameAgeCurve(launches) {
  const sample = launches.filter(({ days }) => days[0]?.median >= 50);
  const curve = {}, previous = [Infinity, Infinity, Infinity];
  for (let k = 2; k <= 20; k++) {
    const ratios = sample.map(({ days }) => days[k]?.median == null ? null : days[k].median / days[0].median).filter(value => value !== null);
    if (ratios.length < 8) break;
    const row = [.25, .5, .75].map((q, i) => Math.min(previous[i], quantile(ratios, q)));
    row.forEach((value, i) => { previous[i] = value; });
    curve[k] = row.map(value => Number(value.toFixed(3)));
  }
  return { sample: sample.length, curve };
}
