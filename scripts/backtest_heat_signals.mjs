// Recompute the backtest behind two heat signals, with the same code the pages run:
//   - the own-peak cooldown (src/features/twitch/cooldown-model.js PEAK_COOLDOWN)
//     beside the fixed 3,000 rule: games covered, calls, comebacks, timing;
//   - the same-age comparison (src/features/twitch/launch-model.js PEER_CURVE):
//     whether a game labelled as holding up or falling faster stays that way.
//
// usage: node scripts/backtest_heat_signals.mjs DATA_DIR
//   DATA_DIR holds twitch_series/index.json, twitch_series/<game>/<month>.json,
//   catalog.json and store_facts.json, laid out like the site's ./data/.
import { LAUNCH_RULES } from '../src/features/twitch/launch-model.js';
import { quantile } from '../src/features/twitch/statistics-model.js';
import { readLaunches } from './launch_sample.mjs';
import { cooldownOutcome, sameAgeCurve, sameAgeOutcome } from './rule_checks.mjs';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/backtest_heat_signals.mjs DATA_DIR');
  process.exit(2);
}
const share = (part, whole) => whole ? `${Math.round(part / whole * 100)}%` : '—';
const { games, launches: allLaunches } = readLaunches(dir);

// Own-peak cooldown beside the 3,000 rule, on the game page's worldwide days.
const { rules, earlier } = cooldownOutcome(games);
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

// Same-age comparison: a label on day k (0-based) against day k + 5. Each
// launch's days start where the pages start them; a full release counts on its own.
const { launches, outcome } = sameAgeOutcome(allLaunches);
console.log(`\nlaunches with a first day of ${LAUNCH_RULES.firstDay}+: ${launches}`);
for (const [verdict, { labels, above }] of Object.entries(outcome)) {
  console.log(`${verdict}: ${labels} game-days, ${above} (${share(above, labels)}) above the same-age median 5 days later`);
}

// The same-age curve itself (PEER_CURVE), recomputed from these launches.
const { sample, curve } = sameAgeCurve(allLaunches);
console.log(`\nsame-age curve from ${sample} launches (paste into PEER_CURVE when it moves):`);
console.log(Object.entries(curve).map(([k, row]) => `${k}: [${row.join(', ')}]`).join(', '));
