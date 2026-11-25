// Recompute the backtest behind two heat signals, with the same code the pages run:
//   - the own-peak cooldown (src/features/twitch/cooldown-model.js PEAK_COOLDOWN)
//     beside the fixed 3,000 rule: games covered, calls, comebacks, timing;
//   - the same-age comparison (src/features/twitch/launch-model.js PEER_CURVE):
//     whether a game labelled as holding up or falling faster stays that way.
//
// usage: node scripts/backtest_heat_signals.mjs DATA_DIR
//   DATA_DIR holds twitch_series/index.json, twitch_series/<game>/<month>.json
//   and catalog.json, laid out like the site's ./data/.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOUR } from '../src/features/twitch/metrics.js';
import { dateStart, fullSeriesRows } from '../src/features/twitch/series.js';
import { analyzeCooldown } from '../src/features/twitch/cooldown-model.js';
import { LAUNCH_RULES, PEER_CURVE, launchDays, launchInstant, peerComparison, steamAppOf } from '../src/features/twitch/launch-model.js';
import { quantile } from '../src/features/twitch/statistics-model.js';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/backtest_heat_signals.mjs DATA_DIR');
  process.exit(2);
}
const DAY = 24 * HOUR;
const read = path => JSON.parse(readFileSync(join(dir, path), 'utf8'));
const index = read('twitch_series/index.json');
const catalog = existsSync(join(dir, 'catalog.json')) ? read('catalog.json') : { games: [] };
const releaseTimes = new Map((catalog.games || []).map(game => [String(game.appid), game.release_time_utc]));
const latest = Math.max(...Object.values(index.months).flatMap(hours => Object.keys(hours).map(Date.parse))) + HOUR;
const dataStart = Math.min(...Object.values(index.games).map(game => Date.parse(game.first_hour)).filter(Number.isFinite));
const share = (part, whole) => whole ? `${Math.round(part / whole * 100)}%` : '—';

const games = [];
for (const [id, game] of Object.entries(index.games)) {
  const chunks = {};
  for (const month of game.months || []) {
    const path = `twitch_series/${id}/${month}.json`;
    if (existsSync(join(dir, path))) chunks[month] = read(path);
  }
  let rows;
  try { rows = fullSeriesRows(index, chunks, id); } catch { continue; }
  const now = Math.min(Date.parse(game.last_hour) + HOUR, latest);
  games.push({ id, name: game.display_name || game.name, game, rows, now });
}

// Own-peak cooldown beside the 3,000 rule, on the game page's worldwide days.
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
console.log(`archived games: ${games.length}`);
for (const [name, rule] of Object.entries(rules)) {
  const back = rule.calls.filter(call => call.back7).length, days = rule.calls.map(call => call.day).filter(day => day !== null);
  console.log(`${name === 'peak' ? 'own peak (25% of peak, peak >= 300)' : 'fixed 3,000'}: covers ${rule.covered} games, `
    + `${rule.calls.length} cooldown calls, ${back} (${share(back, rule.calls.length)}) back above within 7 days, `
    + `median call ${days.length ? quantile(days, .5).toFixed(1) : '—'} days after the release date`);
}
if (earlier.length) {
  const first = earlier.filter(days => days > 0), later = earlier.filter(days => days < 0);
  console.log(`games called by both: ${earlier.length}; the own-peak rule called first in ${first.length}`
    + `${first.length ? ` (a median ${quantile(first, .5).toFixed(1)} days earlier)` : ''}, the same day in ${earlier.length - first.length - later.length},`
    + ` later in ${later.length}${later.length ? ` (a median ${quantile(later.map(days => -days), .5).toFixed(1)} days later)` : ''}`);
}

// Same-age comparison: a label on day k (0-based) against day k + 5.
const outcome = {};
let launches = 0;
for (const { game, rows, now } of games) {
  const releaseAt = launchInstant(game.release_reference, releaseTimes.get(steamAppOf(game) ?? ''));
  if (!Number.isFinite(releaseAt) || releaseAt < dataStart) continue;
  const days = launchDays(rows, releaseAt, now);
  const first = days[0]?.median;
  if (!(first >= LAUNCH_RULES.firstDay)) continue;
  launches++;
  for (const day of days) {
    const later = days[day.index + 5];
    if (day.median === null || !PEER_CURVE[day.index] || !PEER_CURVE[later?.index] || later.median === null) continue;
    const { verdict } = peerComparison(days.slice(0, day.index + 1), first);
    const entry = outcome[verdict] ||= { labels: 0, above: 0 };
    entry.labels++;
    entry.above += later.median / first >= PEER_CURVE[later.index][1];
  }
}
console.log(`\nlaunches with a first day of ${LAUNCH_RULES.firstDay}+: ${launches}`);
for (const [verdict, { labels, above }] of Object.entries(outcome)) {
  console.log(`${verdict}: ${labels} game-days, ${above} (${share(above, labels)}) above the same-age median 5 days later`);
}
