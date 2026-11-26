import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_RULES, reviewChecks } from '../scripts/rule_review.mjs';
import { PEER_CURVE } from '../src/features/twitch/launch-model.js';

const calls = (count, back) => Array.from({ length: count }, (_, i) => ({ back7: i < back, day: 10 }));
const curve = factor => Object.fromEntries(Object.entries(PEER_CURVE).map(([k, row]) => [k, row.map(value => value * factor)]));
const healthy = {
  trial: { small: 54, flagged: 24, held: 19, rest: 30, restHeld: 2 },
  dark: { watched: 78, dark: 7, lasting: 2, eligible: 4, flagged: 9, caught: 4, caughtLasting: 2 },
  cooldown: { games: 267, rules: { peak: { covered: 102, calls: calls(98, 19) }, threshold: { covered: 52, calls: calls(48, 7) } }, earlier: [] },
  sameAge: { launches: 60, outcome: { outlasting: { labels: 214, above: 205 }, fading: { labels: 147, above: 3 } } },
  curve: { sample: 88, curve: curve(1) },
  forecast: { backtest: { 48: { launches: 47, median_miss: 2.74, within_range: 0.64,
    thresholds: { 1000: { reached: 9, likely: 7, likely_reached: 6 } } } } },
  early: { launches: 102, open: 7, hot: { said: 15, right: 15 }, pass: { said: 46, right: 43 }, fail: { said: 34, right: 34 } },
};
const byId = checks => Object.fromEntries(checks.map(check => [check.id, check]));

test('the rules as validated on 11-25 all pass, each with a plain summary and what it was validated on', () => {
  const checks = byId(reviewChecks(healthy));
  assert.deepEqual(Object.keys(checks), ['trial', 'dark_horse', 'peak_cooldown', 'threshold_cooldown', 'same_age', 'same_age_curve', 'forecast', 'early_call']);
  for (const check of Object.values(checks)) {
    assert.equal(check.status, 'ok', check.id);
    assert.ok(check.title && check.rule && check.summary && check.baseline && check.advice, check.id);
  }
  assert.equal(checks.trial.summary, '標出 24 款，19 款（79%）接下來一週還有 100 人；沒標出的 30 款裡 2 款有。');
  assert.equal(checks.same_age_curve.summary, '用 88 款重算：第 3 天一般剩 34%（網站用 34%）、第 7 天一般剩 16%（網站用 16%）、第 14 天一般剩 8%（網站用 8%）。');
  assert.equal(checks.forecast.summary, '回測 47 款：差距中位數 2.7 倍，64% 落在八成範圍內；說「還有 1,000 人」機率過半的 7 款，6 款真的有。');
  assert.equal(checks.early_call.summary, '重播 102 次上市：說首日會過 300 人 46 次、對 43 次；說熱門 15 次、對 15 次；說不到 300 人 34 次、對 34 次；7 次到 24 小時還看不出來。');
});

test('the launch-day calls need another look when a pass or a sure call goes wrong too often', () => {
  const early = (pass, hot, fail) => byId(reviewChecks({ ...healthy, early: { launches: 102, open: 7, pass, hot, fail } })).early_call.status;
  assert.equal(early({ said: 46, right: 41 }, { said: 15, right: 15 }, { said: 34, right: 34 }), 'watch', 'passes under 90% right');
  assert.equal(early({ said: 46, right: 43 }, { said: 15, right: 14 }, { said: 34, right: 34 }), 'watch', 'a hot call wrong');
  assert.equal(early({ said: 46, right: 43 }, { said: 4, right: 3 }, { said: 34, right: 34 }), 'ok', 'four hot calls are too few to judge');
  assert.equal(early({ said: 6, right: 6 }, { said: 2, right: 2 }, { said: 3, right: 3 }), 'few');
  assert.equal(byId(reviewChecks({ ...healthy, early: undefined })).early_call.summary, '還沒有提早判斷的重播。');
});

test('a rule that drifted past its line needs another look', () => {
  const checks = byId(reviewChecks({ ...healthy,
    trial: { small: 60, flagged: 30, held: 15, rest: 30, restHeld: 2 },
    cooldown: { ...healthy.cooldown, rules: { ...healthy.cooldown.rules, peak: { covered: 110, calls: calls(100, 35) } } },
    curve: { sample: 120, curve: curve(1.5) },
  }));
  assert.deepEqual(Object.entries(checks).filter(([, check]) => check.status === 'watch').map(([id]) => id),
    ['trial', 'peak_cooldown', 'same_age_curve']);
  // Untested sides stay quiet: few cases is not a failure.
  const sparse = byId(reviewChecks({ ...healthy, trial: { small: 8, flagged: 4, held: 0, rest: 4, restHeld: 4 }, forecast: null }));
  assert.equal(sparse.trial.status, 'few');
  assert.equal(sparse.forecast.status, 'few');
  assert.equal(sparse.forecast.summary, '還沒有預估的回測。');
  assert.equal(REVIEW_RULES.trial.held, 0.65);
});
