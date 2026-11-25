import { formatCount } from './number-format.js';
import { dateStart } from './series.js';
import { HOUR } from './metrics.js';
import { gameLaunches, launchPeakText } from './launches.js';
import { CHINESE_DAILY_HEAT_HITS, PEAK_COOLDOWN, cooldownThreshold } from './cooldown-model.js';
import { FORECAST_RULES, LAUNCH_RULES } from './launch-model.js';
import { STREAM_HEAT_DAYS, STREAM_HEAT_FLOORS } from './stream-heat-model.js';
import { chance, launchFlagText, launchPeerText } from './launch-advice.js';

// One verdict per region for the planning list and the game page: which
// group a game falls in, a short label, one plain sentence why, and the
// game page's headline. Worldwide, games that reached 3,000 a day follow the
// cooldown rules and small games the launch rules; the Chinese region follows
// its hourly heat (four hours at 100 viewers).

const DAY = 24 * HOUR;
export const VERDICT_GROUPS = Object.freeze({
  hot: '值得開', trial: '值得試播', horse: '黑馬候選', cooled: '已退燒', skip: '先不用排',
});
export const GROUP_ORDER = Object.freeze(['hot', 'trial', 'horse', 'cooled', 'skip']);
const share = Math.round(PEAK_COOLDOWN.share * 100);
const globalLine = formatCount(cooldownThreshold('global'));
const chineseLine = formatCount(cooldownThreshold('zh'));
const percent = value => `${Math.round(value * 100)}%`;
const times = value => `${formatCount(Math.round(value * 10) / 10)} 倍`;
export const shortDate = date => typeof date === 'string' ? date.slice(5).replace('-', '/') : '';

/** Two significant figures, in 萬 from 10,000: 57 萬, 3.6 萬, 2,200, 170, 28. */
export function compactCount(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 100) return formatCount(Math.round(value));
  const step = 10 ** (Math.floor(Math.log10(value)) - 1);
  const rounded = Math.round(value / step) * step;
  return rounded >= 10000 ? `${formatCount(rounded / 10000)} 萬` : formatCount(rounded);
}
// "2,200 人" but "57 萬人".
const people = value => { const text = compactCount(value); return `${text}${text.endsWith('萬') ? '' : ' '}人`; };

// The region's daily number: worldwide the median hour, in the Chinese region
// the fourth-busiest hour (the hour behind "four hours at 100 viewers").
export const dailyValue = (day, region) => region === 'zh' ? day?.fourthHighestViewers ?? null : day?.median ?? null;

/** Change over the last three days against the three before, as text and a direction. */
export function trendOf(comparison, region) {
  if (!comparison) return { text: '還不能比較', direction: null };
  const long = region !== 'zh';
  const absolute = comparison.change === null || (region === 'zh' && comparison.previous < STREAM_HEAT_FLOORS.zh);
  const delta = absolute ? Math.round(comparison.recent - comparison.previous) : Math.round(comparison.change);
  if (absolute ? delta === 0 : Math.abs(delta) < 5) return { text: '持平', direction: 'flat' };
  const amount = absolute ? `${compactCount(Math.abs(delta))} 人` : `${Math.abs(delta)}%`;
  const word = delta > 0 ? '多' : '少';
  return { text: `${delta > 0 ? '↑' : '↓'} ${long ? `比前 ${STREAM_HEAT_DAYS} 天` : ''}${word} ${amount}`, direction: delta > 0 ? 'up' : 'down' };
}

function changeClause(comparison) {
  if (comparison?.change === null || comparison?.change === undefined) return '';
  const value = Math.round(comparison.change);
  return Math.abs(value) < 5 ? `，跟前 ${STREAM_HEAT_DAYS} 天差不多` : `，比前 ${STREAM_HEAT_DAYS} 天${value > 0 ? '多' : '少'} ${Math.abs(value)}%`;
}

/** Days 1-based from the launch's Taiwan date, counted on Taiwan calendar days. */
export function launchDay(date, launchDate) {
  const at = dateStart(date), from = dateStart(launchDate);
  return Number.isFinite(at) && Number.isFinite(from) ? Math.round((at - from) / DAY) + 1 : null;
}

function dateText(date, today) {
  return date.slice(0, 4) === today.slice(0, 4) ? shortDate(date) : date.replaceAll('-', '/');
}

/** "上市第 7 天・11/19 上市", "搶先體驗中・11/05 開始" or "還沒上市・01/20 上市". */
export function launchMeta(record, date) {
  const launches = gameLaunches(record), at = dateStart(date);
  if (launches) {
    const { earlyAccess, fullRelease } = launches;
    if (fullRelease && at >= dateStart(fullRelease.date))
      return `正式上市第 ${launchDay(date, fullRelease.date)} 天・${dateText(fullRelease.date, date)} 上市`;
    if (at >= dateStart(earlyAccess.date)) return `搶先體驗中・${dateText(earlyAccess.date, date)} 開始`;
    return `還沒上市・${dateText(earlyAccess.date, date)} 開始搶先體驗`;
  }
  const reference = record?.release_reference;
  if (reference?.precision !== 'day' || !Number.isFinite(dateStart(reference.date)) || !Number.isFinite(at)) return '';
  if (at < dateStart(reference.date)) return `還沒上市・${dateText(reference.date, date)} 上市`;
  return `上市第 ${launchDay(date, reference.date)} 天・${dateText(reference.date, date)} 上市`;
}

/** The game page's line under the title: "Steam 11/16 上市・今天第 10 天". */
export function gameMeta(record, date) {
  const store = (record?.release_reference?.source ?? '').split(/\s+/)[0], prefix = store ? `${store} ` : '';
  const launches = gameLaunches(record), at = dateStart(date);
  if (launches) {
    const { earlyAccess, fullRelease } = launches;
    if (fullRelease && at >= dateStart(fullRelease.date))
      return `${prefix}${dateText(fullRelease.date, date)} 正式上市・今天第 ${launchDay(date, fullRelease.date)} 天`;
    if (at >= dateStart(earlyAccess.date)) return `${prefix}${dateText(earlyAccess.date, date)} 開始搶先體驗・今天第 ${launchDay(date, earlyAccess.date)} 天`;
    return `${prefix}${dateText(earlyAccess.date, date)} 開始搶先體驗`;
  }
  const reference = record?.release_reference;
  if (reference?.precision !== 'day' || !Number.isFinite(dateStart(reference.date)) || !Number.isFinite(at)) return '';
  if (at < dateStart(reference.date)) return `${prefix}${dateText(reference.date, date)} 上市`;
  return `${prefix}${dateText(reference.date, date)} 上市・今天第 ${launchDay(date, reference.date)} 天`;
}

const verdict = (group, label, reason, headline = label) => ({ group, label, reason, headline });
const UNKNOWN = Object.freeze(verdict('unknown', '資料不足', '最近幾天缺資料，等下一個完整的一天再判斷。', '先等有效資料'));

function cooledReason(outlook, recent) {
  const on = outlook.confirmedOn ? `${shortDate(outlook.confirmedOn)} 確認退燒` : '已退燒';
  if (outlook.cooledBy === 'peak' && Number.isFinite(outlook.peak))
    return `${on}：每天約 ${people(recent)}，不到自己高峰 ${people(outlook.peak)}的 ${share}%。`;
  return Number.isFinite(recent) ? `${on}，每天約 ${people(recent)}。` : `${on}。`;
}

function popularVerdict(day, outlook, recent) {
  const { comparison, latest } = outlook;
  switch (outlook.signal) {
    case 'cooled': return verdict('cooled', '已退燒', cooledReason(outlook, recent), '建議收尾或換題');
    case 'suspected': {
      const byPeak = latest?.status !== 'suspected' && latest?.peakStatus === 'suspected';
      const days = byPeak ? latest.peakLowDays : latest?.lowDays;
      const below = byPeak ? `不到自己高峰的 ${share}%` : `每天不到 ${globalLine} 人`;
      return verdict('hot', '開始降溫', `最近 ${days ?? 1} 天${below}；連續 ${PEAK_COOLDOWN.confirmDays} 天就算退燒。`, '先暫緩加開場次');
    }
    case 'rising':
      return verdict('hot', '回到高檔', `最近 ${STREAM_HEAT_DAYS} 天每天約 ${people(recent)}${changeClause(comparison)}，熱度回來了。`, '可以繼續播');
    case 'recovered':
      return verdict('hot', '熱度回升', Number.isFinite(recent) ? `退燒後熱度又回來了：最近每天約 ${people(recent)}。` : '退燒後熱度又回來了。', '可以安排回訪');
    case 'hot': {
      const label = day.prelaunch ? '有熱度' : '還很熱';
      if (comparison) return verdict('hot', label, `每天還有約 ${people(recent)}在看${changeClause(comparison)}，仍高於 ${globalLine} 人的熱門線。`, '可以繼續播');
      if (latest) return verdict('hot', label, `${shortDate(latest.date)} 約 ${people(latest.median)}在看，高於 ${globalLine} 人的熱門線。`, '可以繼續播');
      return verdict('hot', label, `高於 ${globalLine} 人的熱門線。`, '可以繼續播');
    }
    case 'low': return verdict('skip', '熱度偏低', `最近一天不到 ${globalLine} 人。`, '先不用排');
    default: return UNKNOWN;
  }
}

function launchWhere(latest) {
  return Number.isInteger(latest?.index) ? `上市第 ${latest.index + 1} 天` : `最近一天（${shortDate(latest?.date)}）`;
}

function smallVerdict(outlook, launch, recent) {
  const horse = launch?.darkHorse;
  if (horse) {
    const reason = horse.kind === 'burning' ? `上市第 ${horse.day + 1} 天還是首日的 ${times(horse.ratio)}。`
      : `第 3 天是首日的 ${times(horse.ratio)}，一般遊戲這時只剩約 ${percent(LAUNCH_RULES.typicalThirdDay)}。`;
    return verdict('horse', horse.kind === 'burning' ? '延燒中' : '黑馬候選', reason, '可以趁早試播');
  }
  const { stage, basis, first, third, latest, trend } = launch ?? {};
  const cooled = outlook.signal === 'cooled';
  switch (stage) {
    case 'trial': {
      let reason = basis === 'taiwan_day' ? `最近一天（${shortDate(latest.date)}）約 ${people(latest.median)}在看。`
        : basis === 'no_first_day' ? `首日沒有完整資料；${launchWhere(latest)}約 ${people(latest.median)}。`
          : `${launchWhere(latest)}約 ${people(latest.median)}${trend === 'holding' ? `，第 3 天還有首日的 ${percent(third / first)}，觀眾還在`
            : trend === 'fading' ? `，第 3 天只剩首日的 ${percent(third / first)}，觀眾在退` : ''}。`;
      if (cooled && outlook.cooledBy === 'peak' && Number.isFinite(outlook.peak)) reason += `已不到自己高峰 ${people(outlook.peak)}的 ${share}%。`;
      return trend === 'fading' ? verdict('trial', '值得試播，趁早', reason, '值得試播一場，要播趁早')
        : verdict('trial', '值得試播', reason, '值得試播一場');
    }
    case 'skip':
      if (cooled) return verdict('cooled', '已退燒', cooledReason(outlook, recent), '建議收尾或換題');
      if (basis === 'first_day') return verdict('skip', '先不用排', `首日約 ${people(first)}，不到 ${formatCount(LAUNCH_RULES.firstDay)} 人。`);
      return verdict('skip', '先不用排', `${launchWhere(latest)}約 ${people(latest.median)}，不到 ${formatCount(LAUNCH_RULES.trialDay)} 人。`);
    case 'wait':
      return verdict('trial', '第 3 天後再確認', `首日約 ${people(first)}，過了第一關；第 3 天還有 ${formatCount(LAUNCH_RULES.trialDay)} 人以上就值得試播。`);
    case 'first':
      return verdict('trial', '等首日數據', `上市未滿 24 小時；首日要有 ${formatCount(LAUNCH_RULES.firstDay)} 人才看下一關。`);
    case 'prelaunch':
      return verdict('skip', '還沒上市', `還沒上市；上市後先看首日有沒有 ${formatCount(LAUNCH_RULES.firstDay)} 人。`, '等上市後再看');
    default:
      return cooled ? verdict('cooled', '已退燒', cooledReason(outlook, recent), '建議收尾或換題') : UNKNOWN;
  }
}

/** Worldwide verdict from the heat analysis and the launch rules. */
const STARTING = Object.freeze(verdict('unknown', '剛開始記錄', '剛開始記錄，滿一天後再判斷。', '先等滿一天'));
const started = day => day.days?.some(item => item.complete);

export function globalVerdict(day, launch) {
  if (!day?.outlook) return UNKNOWN;
  if (!started(day) && !day.popularAt && !launch?.stage?.match?.(/^(first|prelaunch)$/)) return STARTING;
  const outlook = day.outlook, recent = outlook.comparison?.recent ?? outlook.latest?.median ?? null;
  if (day.popularAt) return popularVerdict(day, outlook, recent);
  return smallVerdict(outlook, launch, recent);
}

function weekText(week, hot) {
  if (!week || week.unknown === week.total) return null;
  return hot === week.total ? `最近 ${week.total} 天每天都` : hot ? `最近 ${week.total} 天有 ${hot} 天` : `最近 ${week.total} 天沒有一天`;
}

/** Chinese-region verdict: four hours at 100 viewers in a day is heat. */
export function chineseVerdict(day) {
  if (!day?.outlook) return UNKNOWN;
  if (!started(day) && day.signal !== 'hot') return STARTING;
  const outlook = day.outlook, week = day.week, hours = CHINESE_DAILY_HEAT_HITS;
  const line = `${hours} 個小時過 ${chineseLine} 人`;
  switch (outlook.signal) {
    case 'hot': {
      const span = weekText(week, week?.hot);
      const reason = day.signal === 'hot' && !week?.hot ? `今天已經有 ${day.hits} 個小時過 ${chineseLine} 人。`
        : span ? `${span}有 ${line}。` : `最近一天有 ${line}。`;
      return verdict('hot', '有熱度', reason, '中文台可以繼續播');
    }
    case 'rising': {
      const trend = trendOf(outlook.comparison, 'zh');
      return verdict('hot', '回到高檔', `最近 ${STREAM_HEAT_DAYS} 天比前 ${STREAM_HEAT_DAYS} 天${trend.text.replace(/^[↑↓] /, '')}，中文區熱度回來了。`, '中文台可以繼續播');
    }
    case 'recovered': return verdict('hot', '熱度回升', `退燒後又有 ${line}。`, '中文台可以安排回訪');
    case 'suspected':
      return verdict('hot', '開始降溫', `最近 ${outlook.latest?.lowDays ?? 1} 天不到 ${line}；連續 3 天就算退燒。`, '中文台先暫緩加開');
    case 'cooled': {
      const hits = outlook.latest?.thresholdHits ?? 0;
      const on = outlook.confirmedOn ? `${shortDate(outlook.confirmedOn)} 確認退燒` : '已退燒';
      return verdict('cooled', '已退燒', `${on}；最近一天${hits ? `只有 ${hits} 個小時` : '沒有一個小時'}過 ${chineseLine} 人。`, '中文台建議收尾或換題');
    }
    case 'sporadic': {
      const span = weekText(week, week?.hot);
      return verdict('skip', '零星有熱度', `${span ? `${span.replace('有 ', '只有 ')}達標` : '最近一天沒達標'}，只偶爾有幾個小時過 ${chineseLine} 人。`, '中文台先不用排');
    }
    case 'low': {
      const span = weekText(week, week?.hot);
      return verdict('skip', '熱度偏低', `${span ? `${span.replace('有 ', '只有 ')}有` : '最近一天沒有'} ${line}。`, '中文台先不用排');
    }
    default: return UNKNOWN;
  }
}

const ALSO = { hot: '也有熱度', cooled: '也已退燒', skip: '也還沒有熱度' };

/**
 * How a list shows both regions, grouped by `region`: one verdict when the
 * groups agree (or the other region has no data), otherwise both.
 */
export function combineVerdicts(verdicts, region = 'global') {
  const other = region === 'zh' ? 'global' : 'zh', main = verdicts[region], second = verdicts[other];
  const split = main.group !== 'unknown' && second.group !== 'unknown' && main.group !== second.group;
  const also = !split && main.group === second.group ? ALSO[main.group] : null;
  const name = other === 'zh' ? '中文區' : '全球';
  return { ...verdicts, main, split, reason: also ? `${main.reason.replace(/。$/, '')}；${name}${also}。` : main.reason };
}

/** A region row's chip: the group's name, but a cooling game says so. */
export const regionChipText = verdict => verdict.label === '開始降溫' ? verdict.label : VERDICT_GROUPS[verdict.group] ?? verdict.label;

/** The sparkline's points in a 120×32 box, oldest first; null with fewer than two values. */
export function sparkPoints(values) {
  const known = values.map((value, i) => [i, value]).filter(([, value]) => Number.isFinite(value));
  if (known.length < 2) return null;
  const low = Math.min(...known.map(([, value]) => value)), high = Math.max(...known.map(([, value]) => value));
  const x = i => 4 + (values.length > 1 ? i / (values.length - 1) : 0) * 112;
  const y = value => high > low ? 28 - (value - low) / (high - low) * 24 : 16;
  return known.map(([i, value]) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
}

/** The last seven closed days' values up to `through`, oldest first (null for a gap). */
export function lastDays(day, region, count = 7) {
  const end = dateStart(day?.through);
  if (!Number.isFinite(end)) return [];
  const byStart = new Map((day.days ?? []).filter(item => item.isClosed).map(item => [Date.parse(item.startAt), item]));
  return Array.from({ length: count }, (_, i) => dailyValue(byStart.get(end - (count - 1 - i) * DAY), region));
}

/** The number, trend and sparkline of one region's tile. */
export function regionTile(day, region) {
  const comparison = day?.outlook?.comparison ?? null;
  const latest = day?.outlook?.latest;
  const value = comparison?.recent ?? dailyValue(latest, region);
  const trend = trendOf(comparison, region);
  return { value: compactCount(value), raw: Number.isFinite(value) ? value : null, trend: trend.text, direction: trend.direction,
    change: comparison?.change ?? null, spark: region === 'global' ? sparkPoints(lastDays(day, region)) : null };
}

/** The forecast in one line, naming the largest threshold it reaches. */
export function forecastLine(forecast) {
  if (!forecast) return null;
  const reached = FORECAST_RULES.thresholds.filter(threshold => threshold <= forecast.median);
  const threshold = reached.at(-1) ?? FORECAST_RULES.thresholds[0];
  const odds = chance(forecast.probabilities[threshold]);
  return `第 7～9 天預估約 ${people(forecast.median)}；還有 ${formatCount(threshold)} 人以上的機率${/^\d/.test(odds) ? ' ' : ''}${odds}。`;
}

/** At most two extra lines for a card: the forecast, then the same-age comparison or the full release's peak. */
export function extraLines(launch, global) {
  if (!launch) return [];
  const lines = [forecastLine(launch.forecast), launchPeerText(launch.peer), launchPeakText(launch.peaks)?.text,
    global?.group !== 'horse' ? launchFlagText(launch.darkHorse) : null];
  return lines.filter(Boolean).slice(0, 2);
}

// Within a group: stronger labels first, then the busier games.
const STRENGTH = { 還很熱: 0, 有熱度: 0, 回到高檔: 1, 熱度回升: 2, 延燒中: 0, 黑馬候選: 1,
  值得試播: 0, '值得試播，趁早': 1, '第 3 天後再確認': 2, 等首日數據: 3, 開始降溫: 4 };

/** Sort entries ({ verdict, tile }) inside a group by advice, viewers or the recent change. */
export function sortEntries(entries, sort, region) {
  const value = entry => entry.tiles[region]?.raw ?? -1;
  const change = entry => entry.tiles[region]?.change ?? -Infinity;
  return [...entries].sort((a, b) => {
    if (sort === 'change') return change(b) - change(a) || value(b) - value(a);
    if (sort === 'viewers') return value(b) - value(a);
    const strength = entry => STRENGTH[entry.verdicts[region].label] ?? 5;
    return strength(a) - strength(b) || value(b) - value(a);
  });
}
