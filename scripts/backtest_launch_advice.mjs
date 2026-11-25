// Recompute the backtest behind the launch rules (src/features/twitch/launch-model.js)
// from a copy of the site's data folder, with the same code the pages run.
//
// usage: node scripts/backtest_launch_advice.mjs DATA_DIR
//   DATA_DIR holds twitch_series/index.json, twitch_series/<game>/<month>.json,
//   catalog.json and store_facts.json, laid out like the site's ./data/.
//
// Prints, for launches whose first 24 hours are known:
//   - small games (first day 50-2,999): the trial rule against the next week
//     (days 4-10, 1-based) still having a median of 100 viewers;
//   - all launches (first day 50+) watched for two weeks: the dark-horse rule
//     against a later day reaching twice the first day.
import { LAUNCH_RULES } from '../src/features/twitch/launch-model.js';
import { readLaunches } from './launch_sample.mjs';
import { darkHorseLaunches, darkHorseOutcome, ruleOutcome, smallLaunches, stillWatched as alive, trialRule as trial } from './rule_checks.mjs';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/backtest_launch_advice.mjs DATA_DIR');
  process.exit(2);
}
const share = (part, whole) => whole ? `${Math.round(part / whole * 100)}%` : '—';
// Each launch's days start where the pages start them; a full release counts on its own.
const all = readLaunches(dir).launches;
const launches = all.filter(l => l.value(0) !== null);
console.log(`launches with a known first day: ${launches.length} (${launches.filter(l => l.kind === 'full_release').length} full releases,`
  + ` ${launches.filter(l => l.basis === 'pre_launch').length} starting before the launch)`);

// Small games: the trial rule against the following week.
const small = smallLaunches(launches);
function rule(name, test) {
  const { flagged, held, rest, restHeld } = ruleOutcome(small, test);
  console.log(`${name}: flagged ${flagged}/${small.length}, ${held} (${share(held, flagged)}) still had 100 next week;`
    + ` not flagged ${restHeld}/${rest}`);
}
console.log(`small games with a known next week: ${small.length}, ${small.filter(alive).length} still had 100`);
rule('24 h  first day >= 300', l => l.value(0) >= LAUNCH_RULES.firstDay);
rule('48 h  day 2 >= 200', l => (l.value(1) ?? 0) >= LAUNCH_RULES.trialDay);
rule('72 h  day 3 >= 200', l => (l.value(2) ?? 0) >= LAUNCH_RULES.trialDay);
rule('72 h  both (the site rule)', trial);
for (const [name, test] of [['holding', l => l.value(2) >= l.value(0) * LAUNCH_RULES.holding], ['fading', l => l.value(2) < l.value(0) * LAUNCH_RULES.holding]]) {
  const group = small.filter(l => trial(l) && test(l));
  const kept = group.filter(l => alive(l) && l.week >= .2 * l.value(0)).length;
  console.log(`  ${name}: ${group.length}, ${kept} kept 100 viewers and a fifth of the first day`);
}

// Dark horses: a later day (4th-14th) at twice the first day; the rule fires at 72 hours.
const watched = darkHorseLaunches(launches);
const dark = watched.filter(l => l.dark);
console.log(`\nlaunches watched two weeks: ${watched.length}; dark horses ${dark.length} (${dark.filter(l => l.lasting).length} still twice a week on)`);
for (const floor of [50, LAUNCH_RULES.firstDay]) {
  const { flagged, caught, eligible, caughtLasting } = darkHorseOutcome(watched, floor);
  console.log(`day 3 >= first day, first day >= ${floor}: flagged ${flagged}, caught ${caught}/${eligible} (${caughtLasting} lasting)`);
}
for (const l of dark) console.log(`  ${l.name}: first ${Math.round(l.value(0))}, day 3 ×${(l.value(2) / l.value(0)).toFixed(1)}${l.lasting ? ', lasting' : ''}`);
