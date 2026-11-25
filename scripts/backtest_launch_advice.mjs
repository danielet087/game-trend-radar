// Recompute the backtest behind the launch rules (src/features/twitch/launch-model.js)
// from a copy of the site's data folder, with the same code the pages run.
//
// usage: node scripts/backtest_launch_advice.mjs DATA_DIR
//   DATA_DIR holds twitch_series/index.json, twitch_series/<game>/<month>.json
//   and catalog.json, laid out like the site's ./data/.
//
// Prints, for launches whose first 24 hours are known:
//   - small games (first day 50-2,999): the trial rule against the next week
//     (days 4-10, 1-based) still having a median of 100 viewers;
//   - all launches (first day 50+) watched for two weeks: the dark-horse rule
//     against a later day reaching twice the first day.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOUR } from '../src/features/twitch/metrics.js';
import { fullSeriesRows } from '../src/features/twitch/series.js';
import { LAUNCH_RULES, launchDays, launchInstant, steamAppOf } from '../src/features/twitch/launch-model.js';
import { quantile } from '../src/features/twitch/statistics-model.js';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/backtest_launch_advice.mjs DATA_DIR');
  process.exit(2);
}
const read = path => JSON.parse(readFileSync(join(dir, path), 'utf8'));
const index = read('twitch_series/index.json');
const catalog = existsSync(join(dir, 'catalog.json')) ? read('catalog.json') : { games: [] };
const releaseTimes = new Map((catalog.games || []).map(game => [String(game.appid), game.release_time_utc]));
const latest = Math.max(...Object.values(index.months).flatMap(hours => Object.keys(hours).map(Date.parse))) + HOUR;
const dataStart = Math.min(...Object.values(index.games).map(game => Date.parse(game.first_hour)).filter(Number.isFinite));
const median = values => quantile(values, .5);
const share = (part, whole) => whole ? `${Math.round(part / whole * 100)}%` : '—';

const launches = [];
for (const [id, game] of Object.entries(index.games)) {
  const releaseAt = launchInstant(game.release_reference, releaseTimes.get(steamAppOf(game) ?? ''));
  if (!Number.isFinite(releaseAt) || releaseAt < dataStart) continue;
  const chunks = {};
  for (const month of game.months || []) {
    const path = `twitch_series/${id}/${month}.json`;
    if (existsSync(join(dir, path))) chunks[month] = read(path);
  }
  let rows;
  try { rows = fullSeriesRows(index, chunks, id); } catch { continue; }
  const now = Math.min(Date.parse(game.last_hour) + HOUR, latest);
  const days = launchDays(rows, releaseAt, now);
  if (days[0]?.median == null) continue;
  launches.push({ id, name: game.display_name || game.name, days, value: k => days[k]?.median ?? null });
}

// Small games: the trial rule against the following week.
const small = launches.filter(l => l.value(0) >= 50 && l.value(0) < LAUNCH_RULES.popular && l.days.length >= 10)
  .map(l => {
    const week = [3, 4, 5, 6, 7, 8, 9].map(l.value).filter(value => value !== null);
    return week.length >= 4 ? { ...l, week: median(week) } : null;
  }).filter(Boolean);
const alive = l => l.week >= 100;
function rule(name, test) {
  const flagged = small.filter(test), rest = small.filter(l => !test(l));
  const hits = flagged.filter(alive).length;
  console.log(`${name}: flagged ${flagged.length}/${small.length}, ${hits} (${share(hits, flagged.length)}) still had 100 next week;`
    + ` not flagged ${rest.filter(alive).length}/${rest.length}`);
}
console.log(`small games with a known next week: ${small.length}, ${small.filter(alive).length} still had 100`);
rule('24 h  first day >= 300', l => l.value(0) >= LAUNCH_RULES.firstDay);
rule('48 h  day 2 >= 200', l => (l.value(1) ?? 0) >= LAUNCH_RULES.trialDay);
rule('72 h  day 3 >= 200', l => (l.value(2) ?? 0) >= LAUNCH_RULES.trialDay);
const trial = l => l.value(0) >= LAUNCH_RULES.firstDay && (l.value(2) ?? 0) >= LAUNCH_RULES.trialDay;
rule('72 h  both (the site rule)', trial);
for (const [name, test] of [['holding', l => l.value(2) >= l.value(0) * LAUNCH_RULES.holding], ['fading', l => l.value(2) < l.value(0) * LAUNCH_RULES.holding]]) {
  const group = small.filter(l => trial(l) && test(l));
  const kept = group.filter(l => alive(l) && l.week >= .2 * l.value(0)).length;
  console.log(`  ${name}: ${group.length}, ${kept} kept 100 viewers and a fifth of the first day`);
}

// Dark horses: a later day (4th-14th) at twice the first day; the rule fires at 72 hours.
const watched = launches.filter(l => l.value(0) >= 50 && l.value(2) !== null).map(l => {
  const later = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].filter(k => l.value(k) !== null);
  return { ...l, dark: later.some(k => l.value(k) >= 2 * l.value(0)), lasting: later.some(k => k >= 7 && l.value(k) >= 2 * l.value(0)) };
}).filter(l => l.days.length >= 14 || l.dark);
const dark = watched.filter(l => l.dark);
console.log(`\nlaunches watched two weeks: ${watched.length}; dark horses ${dark.length} (${dark.filter(l => l.lasting).length} still twice a week on)`);
for (const floor of [50, LAUNCH_RULES.firstDay]) {
  const flagged = watched.filter(l => l.value(0) >= floor && l.value(2) >= l.value(0) * LAUNCH_RULES.darkHorse);
  const caught = flagged.filter(l => l.dark);
  console.log(`day 3 >= first day, first day >= ${floor}: flagged ${flagged.length}, caught ${caught.length}/${dark.filter(l => l.value(0) >= floor).length}`
    + ` (${caught.filter(l => l.lasting).length} lasting)`);
}
for (const l of dark) console.log(`  ${l.name}: first ${Math.round(l.value(0))}, day 3 ×${(l.value(2) / l.value(0)).toFixed(1)}${l.lasting ? ', lasting' : ''}`);
