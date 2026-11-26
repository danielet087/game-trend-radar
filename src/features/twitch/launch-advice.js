import { fmt } from './presentation.js';
import { EARLY_RULES as E, FORECAST_RULES as F, LAUNCH_RULES as R, START_RULES as S, leadText, startLead, taipeiHour } from './launch-model.js';

// Days are counted every 24 hours from release, 1-based like the launch curves:
// 上市第 1 天 is the first 24 hours, 上市第 3 天 is hours 48-72.
const dayName = latest => Number.isInteger(latest?.index) ? `上市第 ${latest.index + 1} 天` : '';
const dateName = date => typeof date === 'string' ? date.slice(5).replace('-', '/') : '';
const percent = value => `${Math.round(value * 100)}%`;
const times = value => `${fmt(Math.round(value * 10) / 10)} 倍`;

// Where the days start, in one sentence shared by every launch rule.
export const START_RULE_TEXT = `從上市時間起每 24 小時算一天；上市前就已經有上市後首 24 小時中位數四分之一以上（至少 ${fmt(S.floor)} 人）的觀眾、`
  + '而且一路播到上市的（例如豪華版提前玩），從那時候起算；零星的搶先直播不算。';

// The launch-day call, in one paragraph shared by both pages.
export const EARLY_RULE_TEXT = `上市頭 24 小時，先用到目前為止每小時的中位數提早判斷：有紀錄滿 ${E.minHours} 小時、`
  + `${fmt(E.pass.viewers)} 人以上而且 ${fmt(E.pass.channels)} 台以上在播，標「首日大概過關」；${fmt(E.hot.viewers)} 人以上而且 `
  + `${fmt(E.hot.channels)} 台以上，標「首日熱門」（算值得開）；滿 ${E.failHours} 小時還不到 ${fmt(E.fail.viewers)} 人，標「先不用排」。`
  + '剛上市的人數常常是一兩個大實況主帶起來的，所以也看台數。2026 年 10～11 月 102 次上市逐小時重播：'
  + `說首日會過 ${fmt(R.firstDay)} 人的 46 次對 43 次，說熱門的 15 次全對，說不到 ${fmt(R.firstDay)} 人的 34 次全對。`;

export const LAUNCH_RULE_TEXT = `小遊戲（全球每日觀眾中位數沒到過 ${fmt(R.popular)} 人）用全球觀眾判斷，${START_RULE_TEXT}`
  + `首 24 小時有 ${fmt(R.firstDay)} 人、最近一天有 ${fmt(R.trialDay)} 人以上才標「值得試播」，否則「先不用排」。`
  + `上市第 3 天（48～72 小時）不低於首日、最近一天也不低於首日，標「黑馬候選」；一週後仍是首日 ${R.burning} 倍以上，標「延燒中」。`
  + '2026 年 10～11 月 54 款小遊戲回測：兩關都過的 24 款，19 款接下來一週還有 100 人在看；其他 30 款只有 2 款。'
  + EARLY_RULE_TEXT;

export const PEER_RULE_TEXT = `上市第 3～21 天、首 24 小時有 ${fmt(R.firstDay)} 人以上的遊戲，最近一天跟同齡遊戲比（全球觀眾，每 24 小時算一天，起算方式同上）：`
  + '剩下的觀眾比例比四分之三的同齡遊戲多，標「比同齡撐得久」；比四分之三的同齡遊戲少，標「掉得比同齡快」。'
  + '2026 年 10～11 月 60 款回測：標「撐得久」的，5 天後 96% 仍高於同齡遊戲的中位數；標「掉得快」的只有 2%。';

/** Title and sentence for the game page's streaming advice; null when the launch rules do not apply. */
export function launchAdviceText(advice) {
  const { stage, basis, first, third, latest, trend } = advice ?? {};
  const median = fmt(latest?.median);
  switch (stage) {
    case 'prelaunch': return ['等上市後的數據', `還沒上市。上市滿 24 小時後，先看首日觀眾有沒有 ${fmt(R.firstDay)} 人。`];
    case 'first': return ['等首日數據', `上市未滿 24 小時。首 24 小時中位數有 ${fmt(R.firstDay)} 人以上，才看下一關。`];
    case 'wait': return ['第 3 天後再確認', `首 24 小時中位數 ${fmt(first)} 人，過了第一關。上市滿 72 小時後，第 3 天（48～72 小時）還有 ${fmt(R.trialDay)} 人以上就值得試播。`];
    case 'insufficient': return ['先等有效資料', '最近幾天缺資料，等下一個完整的一天再判斷。'];
    case 'skip':
      if (basis === 'first_day') return ['先不用排', `首 24 小時中位數 ${fmt(first)} 人，不到 ${fmt(R.firstDay)} 人。這類遊戲過了第一週，大多不到 100 人在看。`];
      if (basis === 'taiwan_day') return ['先不用排', `沒有上市時間，只看最近一天（${dateName(latest.date)}）：中位數 ${median} 人，不到 ${fmt(R.trialDay)} 人。`];
      if (basis === 'no_first_day') return ['先不用排', `首 24 小時沒有完整資料；${dayName(latest)}中位數 ${median} 人，不到 ${fmt(R.trialDay)} 人。`];
      return ['先不用排', `${dayName(latest)}中位數 ${median} 人，不到 ${fmt(R.trialDay)} 人。這類遊戲接下來一週，大多不到 100 人在看。`];
    case 'trial':
      if (basis === 'taiwan_day') return ['值得試播一場', `沒有上市時間，只看最近一天（${dateName(latest.date)}）：中位數 ${median} 人。`];
      if (basis === 'no_first_day') return ['值得試播一場', `首 24 小時沒有完整資料，只看${dayName(latest)}：中位數 ${median} 人。`];
      if (trend === 'holding') return ['值得試播一場', `${dayName(latest)}中位數 ${median} 人；第 3 天還有首日的 ${percent(third / first)}，觀眾還在。`];
      if (trend === 'fading') return ['值得試播一場，要播趁早', `${dayName(latest)}中位數 ${median} 人；第 3 天只剩首日的 ${percent(third / first)}，觀眾在退。`];
      return ['值得試播一場', `${dayName(latest)}中位數 ${median} 人。`];
    default: return null;
  }
}

/** Label and short reason for the planning list; null when nothing should show. */
export function launchAdviceShort(advice) {
  const { stage, basis, first, latest, trend } = advice ?? {};
  const where = Number.isInteger(latest?.index) ? `第 ${latest.index + 1} 天` : dateName(latest?.date);
  switch (stage) {
    case 'first': return { label: '等首日數據', text: '上市未滿 24 小時' };
    case 'wait': return { label: '第 3 天後再確認', text: `首日 ${fmt(first)} 人` };
    case 'skip': return { label: '先不用排', text: basis === 'first_day' ? `首日 ${fmt(first)} 人` : `${where} ${fmt(latest.median)} 人` };
    case 'trial': return {
      label: trend === 'fading' ? '值得試播，趁早' : '值得試播',
      text: `${where} ${fmt(latest.median)} 人${trend === 'holding' ? ' · 觀眾還在' : trend === 'fading' ? ' · 觀眾在退' : ''}`,
    };
    default: return null;
  }
}

/** Dark-horse line for the game page; `region` other than global marks the numbers as global. */
export function launchFlagText(flag, region = 'global') {
  if (!flag) return null;
  const scope = region === 'global' ? '' : '（全球觀眾）';
  if (flag.kind === 'burning') return `延燒中${scope}：上市第 ${flag.day + 1} 天仍是首日的 ${times(flag.ratio)}。`;
  const [before, after] = flag.channels ?? [];
  const channels = Number.isFinite(before) && Number.isFinite(after) ? `開台數 ${fmt(before)}→${fmt(after)}。` : '';
  return `黑馬候選${scope}：上市第 3 天（48～72 小時）是首日的 ${times(flag.ratio)}，一般遊戲這時只剩約 ${percent(R.typicalThirdDay)}。${channels}`;
}

// The share of the first day as a percentage, or as times when it grew.
const shareOf = ratio => ratio >= 1 ? `的 ${times(ratio)}` : ratio > 0 && ratio < 0.005 ? '的不到 1%' : `的 ${percent(ratio)}`;

/** Same-age line for the game page; none in the middle half or while a dark-horse label shows. */
export function launchPeerText(peer, region = 'global') {
  if (!peer || peer.verdict === 'typical') return null;
  const scope = region === 'global' ? '' : '（全球觀眾）';
  const day = `上市第 ${peer.day + 1} 天`;
  return peer.verdict === 'outlasting'
    ? `比同齡撐得久${scope}：${day}還有首日${shareOf(peer.ratio)}，同齡遊戲一般剩 ${percent(peer.typical)}。`
    : `掉得比同齡快${scope}：${day}剩首日${shareOf(peer.ratio)}，同齡遊戲一般還有 ${percent(peer.typical)}。`;
}

/** Same-age label and reason for the planning list. */
export function launchPeerShort(peer) {
  if (!peer || peer.verdict === 'typical') return null;
  return { label: peer.verdict === 'outlasting' ? '比同齡撐得久' : '掉得比同齡快',
    text: `第 ${peer.day + 1} 天是首日${shareOf(peer.ratio)} · 同齡一般 ${percent(peer.typical)}` };
}

/** Dark-horse label and reason for the planning list. */
export function launchFlagShort(flag) {
  if (!flag) return null;
  if (flag.kind === 'burning') return { label: '延燒中', text: `第 ${flag.day + 1} 天是首日 ${times(flag.ratio)}` };
  const [before, after] = flag.channels ?? [];
  const channels = Number.isFinite(before) && Number.isFinite(after) ? ` · 開台 ${fmt(before)}→${fmt(after)}` : '';
  return { label: '黑馬候選', text: `第 3 天是首日 ${times(flag.ratio)}${channels}` };
}

// "約 1,200 人": two significant figures, whole viewers below 100.
export function about(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 100) return fmt(Math.round(value));
  const step = 10 ** (Math.floor(Math.log10(value)) - 1);
  return fmt(Math.round(value / step) * step);
}

/** A chance in steps of 5%, with the ends written out. */
export function chance(probability) {
  if (!Number.isFinite(probability) || probability < 0) return '—';
  if (probability < 0.05) return '不到 5%';
  if (probability > 0.95) return '超過 95%';
  return `${Math.round(probability * 20) * 5}%`;
}

/** Why the days start before the launch, or null when they start at the launch
 * or only a couple of hours before it. */
export function launchStartText(anchor) {
  const hours = anchor?.basis === 'pre_launch' ? startLead(anchor.launchAt, anchor.startAt) : null;
  if (hours === null) return null;
  return `上市前 ${leadText(hours)}就已經有上市水準的實況，天數從 ${taipeiHour(anchor.startAt)} 起算。`;
}

/** Title, explanation and the three chances for the game page's forecast. */
export function launchForecastText(forecast, region = 'global') {
  if (!forecast) return null;
  const scope = region === 'global' ? '' : '（全球觀眾）';
  const hours = forecast.checkpoint;
  const later = hours === 24 ? `；滿 48 小時後改用前 48 小時再算一次` : '';
  const peers = forecast.launches < forecast.pool ? `首 ${hours} 小時人數最接近的 ${fmt(forecast.launches)} 款新作`
    : `過去 ${fmt(forecast.launches)} 款新作`;
  return {
    title: `上市第 7～9 天約 ${about(forecast.median)} 人`,
    text: `首 ${hours} 小時中位數 ${fmt(Math.round(forecast.base))} 人${scope}。照${peers}，`
      + `第 7～9 天大約是首 ${hours} 小時的 ${Math.round(forecast.ratio * 100)}%；換成這款，中間八成落在 ${about(forecast.low)}～${about(forecast.high)} 人${later}。`,
    chances: F.thresholds.map(threshold => [threshold, chance(forecast.probabilities[threshold])]),
  };
}

/** The method behind the forecast, with how the published backtest did. */
export function forecastRuleText(forecast) {
  const parts = [`上市後預估：${START_RULE_TEXT}首 24 小時中位數不到 ${fmt(F.floor)} 人的不預估。`
    + `上市滿 24 小時用首 24 小時、滿 48 小時改用首 48 小時，乘上過去新作「第 7～9 天」跟同一段時間的比例。`
    + `只拿同一段時間人數跟這款最接近的一半新作（至少 ${fmt(F.neighbours)} 款）來比，小遊戲跟小遊戲比、大遊戲跟大遊戲比`
    + `（小遊戲到第 7～9 天可能一個人都沒有，大遊戲不會）。`
    + `「還有 N 人的機率」是這些新作裡，照它的比例這款會到 N 人的比例。比例每天用已經看得到第 7～9 天的新作重算。`];
  const test = forecast?.backtest;
  if (test?.launches) {
    const likely = test.thresholds?.['1000'];
    const hit = likely?.likely ? `；說「還有 1,000 人」機率過半的 ${fmt(likely.likely)} 款，${fmt(likely.likely_reached)} 款真的有` : '';
    parts.push(`回測（每款只用比它早、已經知道結果的新作）：首 ${forecast.checkpoint} 小時版 ${fmt(test.launches)} 款，`
      + `實際跟預估差距的中位數 ${test.median_miss.toFixed(1)} 倍，落在中間八成範圍內的 ${Math.round(test.within_range * 100)}%${hit}。`);
  }
  return parts.join('');
}

/** Label and short reason for the planning list. */
export function launchForecastShort(forecast) {
  if (!forecast) return null;
  const chances = F.thresholds.map(threshold => `${fmt(threshold)} 人 ${chance(forecast.probabilities[threshold])}`).join(' · ');
  return { label: '第 7～9 天預估', text: `約 ${about(forecast.median)} 人（${chances}）` };
}
