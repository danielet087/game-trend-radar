import { node } from './presentation.js';
import { formatCount as fmt } from './number-format.js';
import { infoHeading } from './info-notes.js';
import { CHINESE_DAILY_HEAT_HITS, PEAK_COOLDOWN, cooldownThreshold } from './cooldown-model.js';
import { FORECAST_RULES, LAUNCH_RULES } from './launch-model.js';
import { LAUNCH_RULE_TEXT, PEER_RULE_TEXT, chance, forecastRuleText, launchFlagText } from './launch-advice.js';
import { currentLaunch, launchPeakText } from './launches.js';
import { dateStart, dayOf } from './series.js';
import { count, HOUR } from './metrics.js';
import { projectRows } from './region-views.js';
import { hourText, placeText } from './stream-slots.js';
import { chineseVerdict, compactCount, dailyValue, globalVerdict, recentHours, shortDate } from './trend-verdict.js';

// The Twitch game page's top: 現在還值得播嗎 (both regions' verdicts, the
// latest day and the viewer's rank), 上市後每天有多少人在看 (a daily chart
// with the hot line and the cooldown) and 接下來會怎樣 (same-age comparison
// and the days 7-9 forecast, both on worldwide viewers).

const NS = 'http://www.w3.org/2000/svg';
const DAY = 24 * HOUR;
const REGION_NAMES = { global: '全球', zh: '中文區' };
const hours = CHINESE_DAILY_HEAT_HITS, zhLine = fmt(cooldownThreshold('zh')), globalLine = fmt(cooldownThreshold('global'));
const share = Math.round(PEAK_COOLDOWN.share * 100);
const people = value => { const text = compactCount(value); return `${text}${text.endsWith('萬') ? '' : ' '}人`; };
const percent = value => `${Math.round(value * 100)}%`;
const shareOf = ratio => ratio >= 1 ? `的 ${fmt(Math.round(ratio * 10) / 10)} 倍` : ratio > 0 && ratio < 0.005 ? '的不到 1%' : `的 ${percent(ratio)}`;
const clock = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function svg(tag, attributes = {}, text) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text != null) element.textContent = text;
  return element;
}

const closedDays = (day, region) => (day?.days ?? []).filter(item => item.isClosed && Date.parse(item.startAt) <= dateStart(day.through))
  .map(item => ({ date: item.date, value: dailyValue(item, region) }));

function latestDay(day, region) {
  return closedDays(day, region).findLast(item => item.value !== null) ?? null;
}

// "2026-11-26 14:00": an hour named like a day, so shortDate gives "11/26 14:00".
const hourName = at => `${dayOf(at)} ${hourText(at)}`;

/**
 * The last 48 hours, one point per hour from the first hour anyone streamed:
 * a collection without the game is 0, a missing or later one a gap. For the
 * launch days and a game just picked up, before two whole days exist.
 */
export function hourlyPoints(rows, region, now) {
  if (!Number.isFinite(now)) return [];
  const end = now - now % HOUR, start = end - 47 * HOUR, byHour = new Map();
  for (const row of region === 'global' ? rows ?? [] : projectRows(rows ?? [], region)) {
    const at = Date.parse(row?.hour);
    if (at >= start && at <= end) byHour.set(at, row);
  }
  const points = [];
  for (let at = start; at <= end; at += HOUR) {
    const row = byHour.get(at), known = row && Date.parse(row.generated_at) <= now;
    points.push({ date: hourName(at), value: !known ? null : row.status === 'absent' ? 0 : row.status === 'observed' ? count(row.viewer_count) : null });
  }
  const first = points.findIndex(item => item.value > 0), last = points.findLastIndex(item => item.value !== null);
  return first < 0 ? [] : points.slice(first, last + 1);
}

function peakOf(points) {
  return points.reduce((best, item) => item.value !== null && (!best || item.value > best.value) ? item : best, null);
}

/** A round top for the axis: 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(value) {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map(step => step * power).find(step => step >= value);
}

const axisLabel = value => value >= 10000 ? `${fmt(value / 10000)} 萬` : fmt(value);

const hotLineShown = (values, threshold) => Math.max(0, ...values) >= threshold / 3;

/** The daily chart: values per closed day, the hot line and the cooldown date. */
export function dailyChart(points, { threshold, cooledOn, launchOn = null, region, title, compact = false }) {
  // A phone gets a narrower drawing so its text keeps the page's size.
  const [width, height, left, right, top, bottom] = compact ? [330, 170, 40, 322, 16, 144] : [560, 210, 48, 548, 16, 184];
  const values = points.map(item => item.value).filter(value => value !== null);
  // A game far under the hot line is drawn on its own scale, without the line.
  const showLine = hotLineShown(values, threshold);
  const top10 = niceMax(Math.max(showLine ? threshold : 0, ...values));
  const x = i => points.length > 1 ? left + i / (points.length - 1) * (right - left) : (left + right) / 2;
  const y = value => bottom - value / top10 * (bottom - top);
  const peak = peakOf(points), last = points.findLast(item => item.value !== null);
  const description = [peak && `${shortDate(peak.date)} 高峰 ${fmt(Math.round(peak.value))} 人`,
    last && last !== peak && `${shortDate(last.date)} 約 ${people(last.value)}`].filter(Boolean).join('，');
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', class: 'tw-daily-chart', 'aria-label': `${title}：${description || '還沒有完整的一天'}` });
  for (const value of [0, top10 / 2, top10]) {
    chart.append(svg('line', { x1: left, y1: y(value), x2: right, y2: y(value), class: value ? 'tw-daily-grid' : 'tw-daily-axis' }),
      svg('text', { x: left - 8, y: y(value) + 4, 'text-anchor': 'end', class: 'tw-daily-tick' }, axisLabel(value)));
  }
  if (showLine) chart.append(svg('line', { x1: left, y1: y(threshold), x2: right, y2: y(threshold), class: 'tw-daily-hot' }),
    svg('text', { x: right, y: y(threshold) - 6, 'text-anchor': 'end', class: 'tw-daily-hot-label' },
      region === 'zh' ? `熱門線：${hours} 小時 ${zhLine} 人` : `熱門線 ${globalLine} 人`));
  // Streams before the launch (betas, previews) stay on the chart; a line marks the launch.
  const launchAt = launchOn && points[0].date < launchOn ? points.findIndex(item => item.date >= launchOn) : -1;
  if (launchAt > 0) {
    const at = x(launchAt);
    chart.append(svg('line', { x1: at, y1: top, x2: at, y2: bottom, class: 'tw-daily-launch' }),
      svg('text', { x: at + 6, y: bottom - 8, 'text-anchor': 'start', class: 'tw-daily-launch-label' }, `${shortDate(launchOn)} 上市`));
  }
  const cooledAt = cooledOn ? points.findIndex(item => item.date >= cooledOn) : -1;
  if (cooledAt >= 0) {
    const at = x(cooledAt);
    chart.append(svg('line', { x1: at, y1: top, x2: at, y2: bottom, class: 'tw-daily-cooled' }),
      svg('text', { x: at > (left + right) / 2 ? at - 6 : at + 6, y: top + 14, 'text-anchor': at > (left + right) / 2 ? 'end' : 'start', class: 'tw-daily-cooled-label' },
        `${shortDate(cooledOn)} 確認退燒`));
  }
  let run = [];
  const flush = () => { if (run.length > 1) chart.append(svg('polyline', { points: run.join(' '), class: 'tw-daily-line' })); run = []; };
  points.forEach((item, i) => {
    if (item.value === null) { flush(); return; }
    run.push(`${x(i).toFixed(1)},${y(item.value).toFixed(1)}`);
  });
  flush();
  for (const item of new Set([peak, last].filter(Boolean))) {
    const i = points.indexOf(item);
    chart.append(svg('circle', { cx: x(i).toFixed(1), cy: y(item.value).toFixed(1), r: 5, class: 'tw-daily-dot' }));
  }
  if (peak) {
    const i = points.indexOf(peak), at = x(i), onRight = at < right - (compact ? 80 : 110);
    chart.append(svg('text', { x: onRight ? at + 10 : at - 10, y: Math.max(top + 12, y(peak.value) - 2), 'text-anchor': onRight ? 'start' : 'end', class: 'tw-daily-peak' },
      `高峰 ${fmt(Math.round(peak.value))}`));
  }
  const ticks = points.length > 2 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : points.map((_, i) => i);
  for (const [n, i] of ticks.entries()) {
    chart.append(svg('text', { x: x(i), y: height - 6, 'text-anchor': n === 0 && ticks.length > 1 ? 'start' : n === ticks.length - 1 && ticks.length > 1 ? 'end' : 'middle',
      class: 'tw-daily-tick' }, shortDate(points[i].date)));
  }
  return chart;
}

function regionBox(region, verdict) {
  const box = node('div', 'tw-verdict-region');
  box.dataset.region = region; box.dataset.group = verdict.group;
  const chip = node('span', 'tw-verdict-chip', verdict.label);
  chip.dataset.group = verdict.group;
  box.append(node('span', 'tw-verdict-region-name', REGION_NAMES[region]), chip, node('strong', '', verdict.headline),
    node('p', '', verdict.reason));
  return box;
}

function tileItem(label, value, sub, href) {
  const item = node('div', 'tw-verdict-tile');
  const dd = node('dd');
  const strong = node('strong', '', value);
  if (href) { const link = node('a'); link.href = href; link.append(strong); dd.append(link); } else dd.append(strong);
  dd.append(node('span', '', sub));
  item.append(node('dt', '', label), dd);
  return item;
}

function gameLine(days, verdicts, launch) {
  const outlook = days.global?.outlook;
  if (verdicts.global.group === 'cooled' && outlook?.confirmedOn) {
    return outlook.cooledBy === 'peak' ? `這款 ${shortDate(outlook.confirmedOn)} 確認退燒：連續 3 天不到自己高峰 ${people(outlook.peak)}的 ${share}%。`
      : `這款 ${shortDate(outlook.confirmedOn)} 確認退燒：連續 3 天每天不到 ${globalLine} 人。`;
  }
  if (days.global?.popularAt) return `這款每天到過 ${globalLine} 人，看退燒的規則。`;
  if (launch?.stage === 'first') return `上市頭 24 小時，全球先用到目前為止每小時的人數和台數提早判斷首日；滿 24 小時後看首日 ${fmt(LAUNCH_RULES.firstDay)} 人、最近一天 ${fmt(LAUNCH_RULES.trialDay)} 人。`;
  return `這款每天沒到過 ${globalLine} 人，全球看小遊戲的規則：首日 ${fmt(LAUNCH_RULES.firstDay)} 人、最近一天 ${fmt(LAUNCH_RULES.trialDay)} 人。`;
}

function peerSentence(peer) {
  if (!peer) return null;
  const day = `上市第 ${peer.day + 1} 天`;
  if (peer.verdict === 'outlasting') return ['比同齡撐得久', `${day}還有首日${shareOf(peer.ratio)}，同齡遊戲一般剩 ${percent(peer.typical)}。`];
  if (peer.verdict === 'fading') return ['掉得比同齡快', `${day}只剩首日${shareOf(peer.ratio)}，同齡遊戲一般還有 ${percent(peer.typical)}。`];
  return ['跟同齡差不多', `${day}是首日${shareOf(peer.ratio)}，同齡遊戲一般 ${percent(peer.typical)}。`];
}

export function createGameVerdict({ $, onOpenRecord, signal }) {
  const verdictPanel = $('verdictPanel'), dailyPanel = $('dailyPanel'), nextPanel = $('nextPanel');
  const narrow = matchMedia('(max-width:560px)');
  let state = null, region = 'global', rank = null;
  narrow.addEventListener('change', () => { if (state) renderDaily(); }, { signal });

  function renderVerdict() {
    const { days, verdicts } = state;
    const split = verdicts.global.group !== 'unknown' && verdicts.zh.group !== 'unknown' && verdicts.global.group !== verdicts.zh.group;
    const record = node('button', 'tw-text-link', '看每天的紀錄 →');
    record.type = 'button';
    record.addEventListener('click', onOpenRecord);
    const line = node('p', '', gameLine(days, verdicts, state.launch));
    line.append(' ', record);
    const rules = node('details', 'tw-info-more');
    rules.append(node('summary', '', '小遊戲的完整規則'), node('div', '', LAUNCH_RULE_TEXT));
    const { wrap } = infoHeading('h2', '現在還值得播嗎', { id: 'verdictInfo', label: '怎麼判斷值不值得播', className: 'tw-game-card-head', lines: [
      `全球：到過每天 ${globalLine} 人後，連續 3 天低於 ${globalLine} 人就算退燒；高峰到過 ${fmt(PEAK_COOLDOWN.minPeak)} 人的遊戲，連續 3 天低於自己高峰的 ${share}% 也算。`,
      `中文區：一天裡至少 ${hours} 個小時有 ${zhLine} 人以上算有熱度，1～${hours - 1} 個小時算零星有熱度。`, line,
      '還沒有完整的一天時（例如上市當天），格子先放上市以來每小時的中間值和在播台數。',
      days.global?.popularAt ? null : rules] });
    if (split) wrap.append(node('span', 'tw-split-chip', '兩區建議不同'));
    const regions = node('div', 'tw-verdict-regions');
    regions.append(regionBox('global', verdicts.global), regionBox('zh', verdicts.zh));
    const tiles = node('dl', 'tw-verdict-tiles');
    const latest = latestDay(days[region], region), peak = peakOf(closedDays(days[region], region));
    const yesterday = dayOf(state.now - DAY);
    const when = latest ? (latest.date === yesterday ? `昨天（${shortDate(latest.date)}）` : shortDate(latest.date)) : '最近一天';
    const ratio = latest && peak?.value > 0 ? latest.value / peak.value : null;
    // Before the first whole day, the hours since the launch (or of the last day): their middle hour and channels.
    const start = state.launch?.stage === 'first' && Number.isFinite(state.launch.anchor?.startAt) ? state.launch.anchor.startAt : state.now - DAY;
    const sofar = latest ? null : recentHours(region === 'global' ? state.rows : projectRows(state.rows ?? [], region), state.now, start);
    tiles.append(sofar ? tileItem(`${REGION_NAMES[region]}・每小時`, `約 ${people(sofar.viewers)}`, `${fmt(Math.round(sofar.channels))} 台在播`)
      : tileItem(`${when}${REGION_NAMES[region]}`, latest ? `約 ${people(latest.value)}` : '—',
        ratio === null ? '還沒有完整的一天' : latest.date === peak.date ? '就是目前的高峰' : `高峰的 ${percent(ratio)}`));
    // Without three days of slot records, the latest hour: 現在開的話.
    const hourly = rank && !rank.rank && rank.latest?.[region] ? rank.latest : null;
    const place = !rank ? '還在算' : rank.rank?.ahead !== undefined ? `常見第 ${fmt(rank.rank.ahead + 1)} 名`
      : rank.rank ? `常見第 ${fmt(rank.rank.low + 1)}～${fmt(rank.rank.high + 1)} 名`
        : hourly ? placeText(hourly[region]) : '還不能算';
    const sub = !rank ? '' : hourly ? `${hourText(hourly.at)} 那小時・平常 ${fmt(rank.viewers)} 人` : `平常 ${fmt(rank.viewers)} 人・${rank.label} 開`;
    tiles.append(tileItem(hourly ? '現在開的話' : '你的位置', place, sub, '#slotPanel'));
    verdictPanel.dataset.group = verdicts[region].group;
    verdictPanel.replaceChildren(wrap, regions, tiles);
    verdictPanel.hidden = false;
  }

  function renderDaily() {
    const { days, record } = state, day = days[region];
    const points = closedDays(day, region);
    const first = points.findIndex(item => item.value !== null);
    const closed = first < 0 ? [] : points.slice(first);
    const current = currentLaunch(record, state.now), launch = current?.date ?? null;
    // Until two whole days exist (the launch days, a game just picked up), every hour of the last two days.
    const hourly = closed.length < 2 ? hourlyPoints(state.rows, region, state.now) : null;
    const shown = hourly ?? closed;
    const title = `${launch && shown[0]?.date >= launch ? '上市後' : ''}每${hourly ? '小時' : '天'}有多少人在看`;
    const { wrap } = infoHeading('h2', title, { id: 'dailyInfo', label: '人數怎麼算', className: 'tw-game-card-head', lines: hourly ? [
      '還沒有兩個完整的一天，先畫最近 48 小時每小時的同時觀看人數；有兩個完整的一天後改畫每天。',
      `虛線是熱門線：全球每天 ${globalLine} 人；中文區一天要有 ${hours} 個小時過 ${zhLine} 人。`] : [
      '每天約多少人在看：一天裡每小時同時觀看人數的中間值。', `虛線是熱門線：全球每天 ${globalLine} 人。`,
      `切到中文區時只算中文直播，取一天裡第 ${hours} 多人的那一小時；虛線是 ${zhLine} 人。`] });
    dailyPanel.replaceChildren(wrap);
    dailyPanel.hidden = false;
    if (shown.length < 2) { dailyPanel.append(node('p', 'tw-game-empty', '還沒有兩個完整的一天，畫不出走勢。')); return; }
    const threshold = cooldownThreshold(region), cooledOn = !hourly && day.outlook?.signal === 'cooled' ? day.outlook.confirmedOn : null;
    // On the hourly chart the launch is marked at its hour when Steam gives one.
    const launchAt = state.launch?.anchor?.launchAt;
    const launchOn = hourly && Number.isFinite(launchAt) && launchAt !== dateStart(dayOf(launchAt)) ? hourName(launchAt) : launch;
    dailyPanel.append(dailyChart(shown, { threshold, cooledOn, launchOn, region, title, compact: narrow.matches }));
    const last = shown.findLast(item => item.value !== null);
    if (hourly) { dailyPanel.append(node('p', 'tw-game-caption', `${shortDate(last.date)} 約 ${people(last.value)}。`)); return; }
    const where = last.value >= threshold ? '在熱門線上'
      : hotLineShown(shown.map(item => item.value).filter(value => value !== null), threshold) ? '還在熱門線下'
        : `離熱門線 ${region === 'zh' ? `${hours} 小時 ${zhLine} 人` : `${globalLine} 人`}還很遠`;
    dailyPanel.append(node('p', 'tw-game-caption', `${shortDate(last.date)} 約 ${people(last.value)}，${where}。`));
  }

  function renderNext() {
    const { launch, days } = state;
    const lines = [
      `跟同齡比：上市後同一天，同齡遊戲一般還剩首日的幾成。`,
      `預估：拿首 48 小時人數跟這款最接近的一半新作（至少 ${fmt(FORECAST_RULES.neighbours)} 款）來比，看它們第 7～9 天有多少人；八成範圍是十款裡有八款落在這個區間。`,
      region === 'zh' ? '這一段都用全球觀眾算。' : null,
    ];
    const rules = node('details', 'tw-info-more');
    rules.append(node('summary', '', '完整判斷方式'), node('div', '', `${PEER_RULE_TEXT}${forecastRuleText(launch?.forecast)}`));
    const { wrap } = infoHeading('h2', '接下來會怎樣', { id: 'nextInfo', label: '比較與預估怎麼算', className: 'tw-game-card-head', lines: [...lines, rules] });
    nextPanel.replaceChildren(wrap);
    nextPanel.hidden = false;
    const peer = peerSentence(launch?.peer);
    if (peer) {
      const sentence = node('p', 'tw-next-peer');
      sentence.append(node('strong', '', peer[0]), `：${peer[1]}`);
      nextPanel.append(sentence);
    }
    for (const text of [launchFlagText(launch?.darkHorse), launchPeakText(launch?.peaks)?.text]) if (text) nextPanel.append(node('p', 'tw-next-line', text));
    const forecast = launch?.forecast;
    if (forecast && Number.isFinite(launch.anchor?.startAt)) {
      const box = node('div', 'tw-forecast');
      const end = clock.format(new Date(launch.anchor.startAt + FORECAST_RULES.to * HOUR)).replace(/\s+/, ' ');
      const current = days.global?.outlook?.comparison?.recent ?? days.global?.outlook?.latest?.median;
      box.append(node('p', '', `第 7～9 天（${end} 結束）預估約 ${people(forecast.median)}，八成落在 ${compactCount(forecast.low)}～${people(forecast.high)}`
        + `${Number.isFinite(current) ? `；目前實際每天約 ${people(current)}` : ''}。`));
      for (const threshold of FORECAST_RULES.thresholds) {
        const probability = forecast.probabilities[threshold], row = node('div', 'tw-forecast-bar');
        row.dataset.threshold = String(threshold);
        const bar = node('span', 'tw-forecast-track'), fill = node('span', 'tw-forecast-fill');
        fill.style.width = `${Math.round(Math.max(0, Math.min(1, probability)) * 100)}%`;
        bar.append(fill);
        row.append(node('span', 'tw-forecast-label', `${fmt(threshold)} 人`), bar, node('span', 'tw-forecast-chance', chance(probability)));
        box.append(row);
      }
      nextPanel.append(box);
    }
    if (nextPanel.children.length === 1) {
      const age = launch?.latest?.index ?? null;
      nextPanel.append(node('p', 'tw-game-empty', age !== null && age > 20 ? '上市超過 3 週，不再跟同齡遊戲比，也不再預估。'
        : launch?.basis === 'no_first_day' ? '首日沒有完整資料，沒辦法跟同齡遊戲比，也不做預估。'
          : ['first', 'prelaunch'].includes(launch?.stage) ? '上市滿 24 小時後才預估第 7～9 天，第 3 天起跟同齡遊戲比。'
            : launch?.first !== undefined && launch.first < LAUNCH_RULES.firstDay ? `首日不到 ${fmt(LAUNCH_RULES.firstDay)} 人，不跟同齡遊戲比。`
              : '上市第 3～21 天才跟同齡遊戲比，上市滿 24 小時才預估第 7～9 天；這款現在還不適用。'));
    }
  }

  function render() {
    if (!state) return;
    renderVerdict(); renderDaily(); renderNext();
  }

  return {
    update(next) {
      const verdicts = { global: globalVerdict(next.days.global, next.launch), zh: chineseVerdict(next.days.zh) };
      state = { ...next, verdicts };
      render();
      return verdicts;
    },
    setRegion(value) { region = value; render(); },
    setRank(value) { rank = value; if (state) renderVerdict(); },
    loading(text) {
      for (const panel of [verdictPanel, dailyPanel, nextPanel]) { panel.hidden = true; panel.replaceChildren(); }
      state = null; rank = null;
      return text;
    },
  };
}
