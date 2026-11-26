import { formatCount } from './number-format.js';
import { dateStart } from './series.js';
import { count, HOUR } from './metrics.js';
import { quantile } from './statistics-model.js';
import { gameLaunches, launchPeakText } from './launches.js';
import { EARLY_RULES } from './launch-model.js';
import { STREAM_HEAT_DAYS, STREAM_HEAT_FLOORS } from './stream-heat-model.js';
import { launchFlagShort, launchPeerShort } from './launch-advice.js';

// One verdict per region for the planning list and the game page: which
// group a game falls in, a short label, one plain sentence why, and the
// game page's headline. A planning card shows only the label; the game page
// adds the reason, in plain words. The numbers are in the tiles (regionTile),
// not repeated in the sentence. Worldwide, games that
// reached 3,000 a day follow the
// cooldown rules and small games the launch rules (on the launch day, the
// hours so far); the Chinese region follows its hourly heat (four hours at 100
// viewers).

const DAY = 24 * HOUR;
export const VERDICT_GROUPS = Object.freeze({
  hot: '值得開', trial: '值得試播', horse: '黑馬候選', cooled: '已退燒', skip: '先不用排',
});
export const GROUP_ORDER = Object.freeze(['hot', 'trial', 'horse', 'cooled', 'skip']);
export const shortDate = date => typeof date === 'string' ? date.slice(5).replace('-', '/') : '';

/** Two significant figures, in 萬 from 10,000: 57 萬, 3.6 萬, 2,200, 170, 28. */
export function compactCount(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 100) return formatCount(Math.round(value));
  const step = 10 ** (Math.floor(Math.log10(value)) - 1);
  const rounded = Math.round(value / step) * step;
  return rounded >= 10000 ? `${formatCount(rounded / 10000)} 萬` : formatCount(rounded);
}
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

// Against the three days before, in words: more, about the same, or fewer.
function changeWords(comparison) {
  if (comparison?.change === null || comparison?.change === undefined) return '';
  const value = Math.round(comparison.change);
  return Math.abs(value) < 5 ? '，跟前幾天差不多' : value > 0 ? '，而且比前幾天更多' : '，雖然比前幾天少一些';
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

function cooledReason(outlook) {
  return outlook.cooledBy === 'peak' ? '跟最熱的時候比，現在看的人少很多，已經退燒。' : '連續幾天都掉到熱門線以下，已經退燒。';
}

function popularVerdict(day, outlook) {
  const { comparison } = outlook;
  switch (outlook.signal) {
    case 'cooled': return verdict('cooled', '已退燒', cooledReason(outlook), '建議收尾或換題');
    case 'suspected': {
      const latest = outlook.latest, byPeak = latest?.status !== 'suspected' && latest?.peakStatus === 'suspected';
      const below = byPeak ? '這幾天看的人比最熱的時候少很多' : '這幾天掉到熱門線以下';
      return verdict('hot', '開始降溫', `${below}，再這樣幾天就算退燒。`, '先暫緩加開場次');
    }
    case 'rising': return verdict('hot', '回到高檔', '最近幾天又變多，熱度回來了。', '可以繼續播');
    case 'recovered': return verdict('hot', '熱度回升', '退燒後熱度又回來了。', '可以安排回訪');
    case 'hot':
      if (day.prelaunch) return verdict('hot', '有熱度', '還沒正式上市就很多人在看。', '可以繼續播');
      return verdict('hot', '還很熱', `還是很多人在看${changeWords(comparison) || '，在熱門線以上'}。`, '可以繼續播');
    case 'low': return verdict('skip', '熱度偏低', '最近一天掉到熱門線以下。', '先不用排');
    default: return UNKNOWN;
  }
}

// The launch day, from the hours so far (EARLY_RULES); the first 24 hours
// decide once they are over. The hours' numbers are in the tiles.
function earlyVerdict(early) {
  if (!early?.hours) return verdict('trial', '等首日數據', '剛上市，還沒有每小時的紀錄。');
  if (early.hours < EARLY_RULES.minHours) return verdict('trial', '等首日數據', '剛上市，紀錄還不夠，再等一兩個小時。');
  switch (early.call) {
    case 'hot': return verdict('hot', '首日熱門', '剛上市就很熱，而且很多台一起在播，不是靠一兩台撐的。', '值得開');
    case 'pass': return verdict('trial', '首日大概過關', '剛上市就有一定人氣，也有不少台在播，第 3 天再決定要不要長播。', '可以先試播一場');
    case 'fail': return verdict('skip', '先不用排', '上市好幾個小時都沒什麼人看，首日大概過不了關。');
    default:
      // A big total on a few channels is one or two big streamers, not heat yet.
      if (early.viewers >= EARLY_RULES.pass.viewers && early.channels < EARLY_RULES.pass.channels)
        return verdict('trial', '等首日數據', '人數大多是一兩台大實況主帶起來的，其他台很少，還不能算熱度。');
      return verdict('trial', '等首日數據', '剛上市，人氣不上不下，還看不出首日會不會過關。');
  }
}

function smallVerdict(outlook, launch) {
  const horse = launch?.darkHorse;
  if (horse) {
    const reason = horse.kind === 'burning' ? '上市一週後看的人還比首日多，越燒越旺。'
      : '第 3 天看的人沒有比首日少，一般新作這時已經掉很多。';
    return verdict('horse', horse.kind === 'burning' ? '延燒中' : '黑馬候選', reason, '可以趁早試播');
  }
  const { stage, basis, trend } = launch ?? {};
  const cooled = outlook.signal === 'cooled';
  switch (stage) {
    case 'trial': {
      let reason = basis === 'taiwan_day' ? '最近一天還有不少人在看。'
        : basis === 'no_first_day' ? '首日沒有完整紀錄，但最近一天還有不少人在看。'
          : trend === 'holding' ? '首日過關，到第 3 天觀眾還留著。'
            : trend === 'fading' ? '首日過關，但到第 3 天觀眾在退，要播趁早。' : '首日過關，最近一天也還有不少人看。';
      if (cooled && outlook.cooledBy === 'peak') reason += '不過已經比最熱的時候少很多。';
      return trend === 'fading' ? verdict('trial', '值得試播，趁早', reason, '值得試播一場，要播趁早')
        : verdict('trial', '值得試播', reason, '值得試播一場');
    }
    case 'skip':
      if (cooled) return verdict('cooled', '已退燒', cooledReason(outlook), '建議收尾或換題');
      if (basis === 'first_day') return verdict('skip', '先不用排', '首日看的人不多，沒過第一關。');
      return verdict('skip', '先不用排', '最近一天看的人不多。');
    case 'wait':
      return verdict('trial', '第 3 天後再確認', '首日過了第一關，第 3 天還有人看就值得試播。');
    case 'first':
      return earlyVerdict(launch.early);
    case 'prelaunch':
      return verdict('skip', '還沒上市', '還沒上市，上市後先看首日人氣。', '等上市後再看');
    default:
      return cooled ? verdict('cooled', '已退燒', cooledReason(outlook), '建議收尾或換題') : UNKNOWN;
  }
}

/** Worldwide verdict from the heat analysis and the launch rules. */
const STARTING = Object.freeze(verdict('unknown', '剛開始記錄', '剛開始記錄，滿一天後再判斷。', '先等滿一天'));
const started = day => day.days?.some(item => item.complete);

export function globalVerdict(day, launch) {
  if (!day?.outlook) return UNKNOWN;
  if (!started(day) && !day.popularAt && !launch?.stage?.match?.(/^(first|prelaunch)$/)) return STARTING;
  if (day.popularAt) return popularVerdict(day, day.outlook);
  return smallVerdict(day.outlook, launch);
}


/** Chinese-region verdict: four hours at 100 viewers in a day is heat. */
export function chineseVerdict(day) {
  if (!day?.outlook) return UNKNOWN;
  if (!started(day) && day.signal !== 'hot') return STARTING;
  const outlook = day.outlook, week = day.week;
  switch (outlook.signal) {
    case 'hot': {
      // Heat is a day with four busy hours (100 viewers or more).
      const known = week && week.unknown !== week.total;
      const reason = day.signal === 'hot' && !week?.hot ? '中文台今天已經熱起來了。'
        : known && week.hot === week.total ? '最近每天中文台都有熱度。' : known && week.hot * 2 > week.total ? '最近大部分的日子中文台都有熱度。'
          : known && week.hot ? '最近有幾天中文台有熱度。' : '最近一天中文台有熱度。';
      return verdict('hot', '有熱度', reason, '中文台可以繼續播');
    }
    case 'rising': return verdict('hot', '回到高檔', '中文區最近幾天又變熱，熱度回來了。', '中文台可以繼續播');
    case 'recovered': return verdict('hot', '熱度回升', '中文區退燒後又熱起來了。', '中文台可以安排回訪');
    case 'suspected': return verdict('hot', '開始降溫', '中文區這幾天變冷，再這樣幾天就算退燒。', '中文台先暫緩加開');
    case 'cooled':
      return verdict('cooled', '已退燒', outlook.latest?.thresholdHits ? '中文區已經退燒，最近只剩零星時段有人看。' : '中文區已經退燒，最近都沒什麼人看。', '中文台建議收尾或換題');
    case 'sporadic': return verdict('skip', '零星有熱度', '中文台只偶爾有幾個小時比較多人看，還不算有熱度。', '中文台先不用排');
    case 'low': return verdict('skip', '熱度偏低', '中文台最近看的人不多。', '中文台先不用排');
    default: return UNKNOWN;
  }
}

/**
 * How a list shows both regions, grouped by `region`: one verdict when the
 * groups agree (or the other region has no data), otherwise both.
 */
export function combineVerdicts(verdicts, region = 'global') {
  const other = region === 'zh' ? 'global' : 'zh', main = verdicts[region], second = verdicts[other];
  const split = main.group !== 'unknown' && second.group !== 'unknown' && main.group !== second.group;
  return { ...verdicts, main, split };
}

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
export function regionTile(day, region, hours = null) {
  const comparison = day?.outlook?.comparison ?? null;
  const latest = day?.outlook?.latest;
  const value = comparison?.recent ?? dailyValue(latest, region);
  // Before the first whole day (the launch day, a game just picked up), the hours so far.
  if (!Number.isFinite(value) && hours) return { per: '每小時', value: compactCount(hours.viewers), raw: hours.viewers,
    trend: `${formatCount(Math.round(hours.channels))} 台在播`, direction: null, change: null, spark: null };
  const trend = trendOf(comparison, region);
  return { per: '每天', value: compactCount(value), raw: Number.isFinite(value) ? value : null, trend: trend.text, direction: trend.direction,
    change: comparison?.change ?? null, spark: region === 'global' ? sparkPoints(lastDays(day, region)) : null };
}

/**
 * The hours with data from `from` (at most 24 hours back) to `now`: their
 * median viewers and channels, for the tiles before the first whole day.
 * Null without such hours.
 */
export function recentHours(rows, now, from = now - DAY) {
  const viewers = [], channels = [], start = Math.max(from, now - DAY);
  for (const row of rows ?? []) {
    const at = Date.parse(row?.hour), value = row?.status === 'observed' ? count(row.viewer_count) : null;
    if (value === null || !(at >= start && at <= now) || !(Date.parse(row.generated_at) <= now)) continue;
    viewers.push(value);
    channels.push(count(row.streamer_count) ?? 0);
  }
  return viewers.length ? { hours: viewers.length, viewers: quantile(viewers, .5), channels: quantile(channels, .5) } : null;
}

/**
 * The labels a card adds after its verdict: the same-age comparison, the full
 * release's peak and the dark horse. Their numbers are on the game page.
 */
export function extraTags(launch, global) {
  if (!launch) return [];
  return [launchPeerShort(launch.peer)?.label, launchPeakText(launch.peaks)?.label,
    global?.group !== 'horse' ? launchFlagShort(launch.darkHorse)?.label : null].filter(Boolean);
}

// Within a group: stronger labels first, then the busier games.
const STRENGTH = { 還很熱: 0, 有熱度: 0, 首日熱門: 0, 回到高檔: 1, 熱度回升: 2, 延燒中: 0, 黑馬候選: 1,
  值得試播: 0, '值得試播，趁早': 1, '第 3 天後再確認': 2, 首日大概過關: 3, 等首日數據: 4, 開始降溫: 4 };

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
