import { fmt } from './presentation.js';
import { LAUNCH_RULES as R } from './launch-model.js';

// Days are counted every 24 hours from release, 1-based like the launch curves:
// 上市第 1 天 is the first 24 hours, 上市第 3 天 is hours 48-72.
const dayName = latest => Number.isInteger(latest?.index) ? `上市第 ${latest.index + 1} 天` : '';
const dateName = date => typeof date === 'string' ? date.slice(5).replace('-', '/') : '';
const percent = value => `${Math.round(value * 100)}%`;
const times = value => `${fmt(Math.round(value * 10) / 10)} 倍`;

export const LAUNCH_RULE_TEXT = `小遊戲（全球每日觀眾中位數沒到過 ${fmt(R.popular)} 人）用全球觀眾判斷，從上市時間起每 24 小時算一天：`
  + `首 24 小時有 ${fmt(R.firstDay)} 人、最近一天有 ${fmt(R.trialDay)} 人以上才標「值得試播」，否則「先不用排」。`
  + `上市第 3 天（48～72 小時）不低於首日、最近一天也不低於首日，標「黑馬候選」；一週後仍是首日 ${R.burning} 倍以上，標「延燒中」。`
  + '2026 年 10～11 月 53 款小遊戲回測：兩關都過的 24 款，19 款接下來一週還有 100 人在看；其他 29 款只有 1 款。';

export const PEER_RULE_TEXT = `上市第 3～21 天、首 24 小時有 ${fmt(R.firstDay)} 人以上的遊戲，最近一天跟同齡遊戲比（全球觀眾，從上市時間起每 24 小時算一天）：`
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
