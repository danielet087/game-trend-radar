// The monthly review of the launch and heat rules: the same checks as the
// backtest scripts, rerun on the latest data and set beside what each rule was
// validated on (11-25), so a rule that drifts shows up on the scheduler page.
// The site never changes a threshold by itself: 要注意 means look at it again
// with scripts/backtest_launch_advice.mjs or backtest_heat_signals.mjs.
//
// usage: node scripts/rule_review.mjs DATA_DIR OUT_JSON [GENERATED_AT]
//   DATA_DIR is laid out like the site's ./data/ (twitch_series, catalog.json,
//   store_facts.json, twitch-launch-curves.json). The publisher of the radar
//   insights runs it with the first projection of each Taiwan month.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LAUNCH_RULES, PEER_CURVE } from '../src/features/twitch/launch-model.js';
import { readLaunches } from './launch_sample.mjs';
import { cooldownOutcome, darkHorseLaunches, darkHorseOutcome, ruleOutcome, sameAgeCurve, sameAgeOutcome,
  smallLaunches, trialRule } from './rule_checks.mjs';

// When a rule needs another look, and how many cases it takes to say so.
export const REVIEW_RULES = Object.freeze({
  trial: { min: 10, held: 0.65, restHeld: 0.15 },
  darkHorse: { min: 3, caught: 0.75 },
  cooldown: { min: 20, back: 0.3 },
  sameAge: { min: 50, outlasting: 0.8, fading: 0.15 },
  curve: { min: 30, drift: 0.3, days: [2, 6, 13] },
  forecast: { min: 30, within: 0.55, likely: 5, hit: 0.7 },
});

// What each rule was validated on (11-25, with each launch's start as #122 counts it).
export const BASELINES = Object.freeze({
  trial: '11-25：標出 24 款，19 款（79%）接下來一週還有 100 人；沒標出的 30 款裡 2 款有。',
  darkHorse: '11-25：看滿兩週的 78 款裡 7 款黑馬，首日 300 人以上的 4 款全部標出（共標出 9 款）。',
  peakCooldown: '11-25：涵蓋 102 款、判定 98 次，19 次（19%）一週內又回到高峰的 25% 以上。',
  thresholdCooldown: '11-25：涵蓋 52 款、判定 48 次，7 次（15%）一週內又回到 3,000 人。',
  sameAge: '11-25：標「撐得久」的 214 個遊戲日 96% 仍高於同齡；標「掉得快」的 147 個只有 2%。',
  curve: '網站的同齡曲線是 11-25 用 88 款算的：第 3 天一般剩 34%、第 7 天 16%、第 14 天 8%。',
  forecast: '11-25：回測 47 款，差距中位數 2.7 倍，64% 落在八成範圍內；說「還有 1,000 人」機率過半的 7 款，6 款真的有。',
});

const pct = (part, whole) => whole ? `${Math.round(part / whole * 100)}%` : '—';
const status = (enough, drifted) => !enough ? 'few' : drifted ? 'watch' : 'ok';

/** The checks, each with its status and a one-line Chinese summary, from the computed outcomes. */
export function reviewChecks({ trial, dark, cooldown, sameAge, curve, forecast }) {
  const R = REVIEW_RULES, checks = [];
  checks.push({ id: 'trial', title: '小遊戲試播標準',
    rule: `首 24 小時 ${LAUNCH_RULES.firstDay} 人以上、最近一天還有 ${LAUNCH_RULES.trialDay} 人以上 → 值得試播（回測看上市第 3 天）`,
    status: status(trial.flagged >= R.trial.min, trial.held / trial.flagged < R.trial.held
      || (trial.rest >= R.trial.min && trial.restHeld / trial.rest > R.trial.restHeld)),
    summary: `標出 ${trial.flagged} 款，${trial.held} 款（${pct(trial.held, trial.flagged)}）接下來一週還有 100 人；沒標出的 ${trial.rest} 款裡 ${trial.restHeld} 款有。`,
    baseline: BASELINES.trial,
    advice: '標出的遊戲一週後還有 100 人的比例掉到 65% 以下，或沒標出的有超過 15% 還有 100 人時，試播門檻要重算。' });
  checks.push({ id: 'dark_horse', title: '黑馬候選',
    rule: `首日 ${LAUNCH_RULES.firstDay} 人以上、上市第 3 天不低於首日 → 黑馬候選`,
    status: status(dark.eligible >= R.darkHorse.min, dark.caught / dark.eligible < R.darkHorse.caught),
    summary: `看滿兩週的 ${dark.watched} 款裡 ${dark.dark} 款黑馬（後來衝到首日 2 倍），首日 ${LAUNCH_RULES.firstDay} 人以上的 ${dark.eligible} 款標出 ${dark.caught} 款；共標出 ${dark.flagged} 款。`,
    baseline: BASELINES.darkHorse,
    advice: '首日 300 人以上的黑馬有超過四分之一沒標出時，第 3 天的條件要重看。' });
  for (const [id, key, title, rule, back] of [
    ['peak_cooldown', 'peak', '退燒：跟自己高峰比', '高峰到過 300 人後，連續 3 天低於高峰的 25% → 已退燒', '又回到高峰的 25% 以上'],
    ['threshold_cooldown', 'threshold', '退燒：熱門線 3,000 人', '到過每天 3,000 人後，連續 3 天低於 3,000 人 → 已退燒', '又回到 3,000 人']]) {
    const { covered, calls } = cooldown.rules[key], returned = calls.filter(call => call.back7).length;
    checks.push({ id, title, rule,
      status: status(calls.length >= R.cooldown.min, returned / calls.length > R.cooldown.back),
      summary: `涵蓋 ${covered} 款、判定 ${calls.length} 次，${returned} 次（${pct(returned, calls.length)}）一週內${back}。`,
      baseline: BASELINES[key === 'peak' ? 'peakCooldown' : 'thresholdCooldown'],
      advice: '判定退燒後一週內又回來的超過 30% 時，退燒條件要放寬。' });
  }
  const holding = sameAge.outcome.outlasting ?? { labels: 0, above: 0 }, fading = sameAge.outcome.fading ?? { labels: 0, above: 0 };
  checks.push({ id: 'same_age', title: '跟同齡比', rule: '最近一天剩首日的比例，比四分之三的同齡遊戲多 → 比同齡撐得久；比四分之三少 → 掉得比同齡快',
    status: status(holding.labels >= R.sameAge.min && fading.labels >= R.sameAge.min,
      holding.above / holding.labels < R.sameAge.outlasting || fading.above / fading.labels > R.sameAge.fading),
    summary: `標「撐得久」的 ${holding.labels} 個遊戲日，5 天後 ${pct(holding.above, holding.labels)} 仍高於同齡中位數；標「掉得快」的 ${fading.labels} 個只有 ${pct(fading.above, fading.labels)}。`,
    baseline: BASELINES.sameAge,
    advice: '「撐得久」5 天後還高於同齡的不到八成，或「掉得快」超過 15% 時，同齡比較要重看。' });
  const days = R.curve.days.filter(k => curve.curve[k] && PEER_CURVE[k]);
  const moved = days.filter(k => Math.abs(curve.curve[k][1] - PEER_CURVE[k][1]) / PEER_CURVE[k][1] > R.curve.drift);
  checks.push({ id: 'same_age_curve', title: '同齡曲線', rule: '網站用的「上市第 N 天一般剩首日幾成」',
    status: status(curve.sample >= R.curve.min && days.length > 0, moved.length > 0),
    summary: `用 ${curve.sample} 款重算：` + days.map(k => `第 ${k + 1} 天一般剩 ${pct(curve.curve[k][1], 1)}（網站用 ${pct(PEER_CURVE[k][1], 1)}）`).join('、') + '。',
    baseline: BASELINES.curve,
    advice: '任一天跟網站用的差超過三成時，把 backtest_heat_signals.mjs 印出的新曲線換進 PEER_CURVE。' });
  const test = forecast?.backtest?.['48'], likely = test?.thresholds?.['1000'];
  checks.push({ id: 'forecast', title: '上市後預估（首 48 小時版）', rule: '第 7～9 天預估的八成範圍與「還有 1,000 人」的機率',
    status: status(test?.launches >= R.forecast.min, test?.within_range < R.forecast.within
      || (likely?.likely >= R.forecast.likely && likely.likely_reached / likely.likely < R.forecast.hit)),
    summary: test ? `回測 ${test.launches} 款：差距中位數 ${test.median_miss.toFixed(1)} 倍，${pct(test.within_range, 1)} 落在八成範圍內；`
      + `說「還有 1,000 人」機率過半的 ${likely?.likely ?? 0} 款，${likely?.likely_reached ?? 0} 款真的有。` : '還沒有預估的回測。',
    baseline: BASELINES.forecast,
    advice: '落在八成範圍內的不到 55%，或「還有 1,000 人」說中的不到七成時，預估方法要重看。' });
  return checks;
}

/** The review of the data in `dir`, as published in data/rule_review.json. */
export function ruleReview(dir, generatedAt) {
  const { games, launches: all } = readLaunches(dir);
  const launches = all.filter(l => l.value(0) !== null);
  const index = JSON.parse(readFileSync(join(dir, 'twitch_series/index.json'), 'utf8'));
  const curvesPath = join(dir, 'twitch-launch-curves.json');
  const forecast = existsSync(curvesPath) ? JSON.parse(readFileSync(curvesPath, 'utf8')).forecast ?? null : null;
  const checks = reviewChecks({
    trial: ruleOutcome(smallLaunches(launches), trialRule),
    dark: darkHorseOutcome(darkHorseLaunches(launches)),
    cooldown: cooldownOutcome(games),
    sameAge: sameAgeOutcome(all),
    curve: sameAgeCurve(all),
    forecast,
  });
  return { schema_version: 1, generated_at: generatedAt, data_through: index.generated_at ?? null,
    launches: launches.length, attention: checks.filter(check => check.status === 'watch').length, checks };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [dir, out, at] = process.argv.slice(2);
  if (!dir || !out) {
    console.error('usage: node scripts/rule_review.mjs DATA_DIR OUT_JSON [GENERATED_AT]');
    process.exit(2);
  }
  const generatedAt = at ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  writeFileSync(out, JSON.stringify(ruleReview(dir, generatedAt), null, 1) + '\n');
}
