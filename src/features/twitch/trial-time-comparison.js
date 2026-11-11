import { regionNames, viewOf } from './audience-region.js';
import { fmt, hourLabel, node } from './presentation.js';
import { regionsFor } from './region-views.js';
import { dayOf, monthsFor } from './series.js';
import { compareTrialTimes, streamHour, trialWindow, TRIAL_MIN_DAYS } from './stream-planning-model.js';

function timeAdvice({ slots: [first, second], dates, releaseDate, typicalLead, preferred }, tracking) {
  if (dates.length < TRIAL_MIN_DAYS) return ['先等更多紀錄',
    `${hourLabel(first.hour)} 有 ${first.observed} 天紀錄，${hourLabel(second.hour)} 有 ${second.observed} 天。至少需要 ${TRIAL_MIN_DAYS} 天兩邊都有紀錄。`];
  if (!releaseDate) return ['先確認上市日期', '目前的觀測可能包含試玩或預覽。'];
  if (tracking === 'ended') return ['先核對目前熱度', '這款遊戲已結束追蹤，可用下方數字回看觀測期間。'];
  if (!first.viewers && !second.viewers) return ['可換個時段再比較', '兩個時段的觀眾中位數都是 0。'];
  if (preferred) {
    const other = preferred === first ? second : first;
    const demand = preferred.viewers > other.viewers ? '常見觀眾較多' : '常見觀眾相同';
    const supply = preferred.streamers < other.streamers ? '同時開台較少' : '同時開台相同';
    return [`可優先試播 ${hourLabel(preferred.hour)}`, `${demand}、${supply}，有 ${preferred.strongerDays}／${dates.length} 天同時占優。`];
  }
  if (typicalLead) return ['先用平常的時段試一場', `${hourLabel(typicalLead.hour)} 有 ${typicalLead.strongerDays}／${dates.length} 天同時占優，近期優勢仍有變動。`];
  if (first.viewers === second.viewers && first.streamers === second.streamers)
    return ['先用平常的時段試一場', '兩個時段的常見觀眾與開台數相同。'];
  const more = first.viewers > second.viewers ? first : second;
  const fewer = more === first ? second : first;
  const tradeoff = fewer.viewers === 0
    ? `${hourLabel(more.hour)} 的常見觀眾較多。${hourLabel(fewer.hour)} 的常見觀眾是 0。`
    : `${hourLabel(more.hour)} 的常見觀眾較多，${hourLabel(fewer.hour)} 的同時開台較少。`;
  return ['依開台目標選時段', tradeoff];
}

function renderRegion(region, comparison, totalDays, tracking) {
  const card = node('section', 'tw-trial-region');
  card.dataset.region = region;
  const [action, reason] = timeAdvice(comparison, tracking);
  card.append(node('h3', 'tw-region-caption', regionNames[region]), node('p', 'tw-trial-action', action),
    node('p', 'tw-trial-reason', reason));
  if (comparison.dates.length >= TRIAL_MIN_DAYS) {
    const table = node('table', 'tw-compare-table');
    table.setAttribute('aria-label', `${regionNames[region]}試播時段`);
    const head = table.createTHead().insertRow();
    for (const name of ['時段', '常見觀眾', '同時開台']) {
      const th = node('th', '', name); th.scope = 'col'; head.append(th);
    }
    const body = table.createTBody();
    for (const slot of comparison.slots) {
      const row = body.insertRow();
      const th = node('th', '', hourLabel(slot.hour)); th.scope = 'row'; row.append(th);
      row.append(node('td', '', `${fmt(slot.viewers)} 人`), node('td', '', `${fmt(slot.streamers)} 台`));
    }
    card.append(table);
  }
  const coverage = node('p', 'tw-trial-coverage', `同日可比較 ${comparison.dates.length}／${totalDays} 天`);
  if (comparison.dates.length) {
    const days = comparison.dates.map(day => day.slice(5).replace('-', '/'));
    coverage.append(node('span', '', days.join('、')));
  }
  card.append(coverage);
  return card;
}

export function createTrialTimeComparison({ $, params, back, onChange }) {
  const section = $('trialTimes'), jump = $('trialTimesJump'), results = $('trialTimeResults'), status = $('trialTimeStatus');
  const first = $('trialHourA'), second = $('trialHourB'), region = $('trialRegion');
  const source = new URLSearchParams(back);
  const firstDefault = streamHour(source.get('stream_hour'));
  const secondDefault = firstDefault === 22 ? 20 : 22;
  const regionDefault = viewOf(source.get('stream_region'));
  for (const select of [first, second]) {
    for (let hour = 0; hour < 24; hour++) {
      const option = node('option', '', hourLabel(hour)); option.value = String(hour); select.append(option);
    }
  }
  first.value = String(streamHour(params.get('trial_hour_a') ?? firstDefault));
  second.value = String(streamHour(params.get('trial_hour_b') ?? secondDefault));
  region.value = viewOf(params.get('trial_region') ?? regionDefault);
  let current = null;

  function render() {
    const { index, gameId, period, chunks, error } = current;
    const mode = region.value, hours = [Number(first.value), Number(second.value)];
    results.replaceChildren();
    results.classList.toggle('tw-region-compare', mode === 'compare');
    if (error) { status.textContent = '暫時無法取得同一版本的逐時紀錄。請按頁首的重新載入。'; return; }
    if (!chunks) { status.textContent = '正在讀取最近的逐時紀錄…'; return; }
    if (hours[0] === hours[1]) { status.textContent = '請選兩個不同的時段。'; return; }
    try {
      const comparisons = regionsFor(mode).map(scope => [scope, compareTrialTimes(index, chunks, gameId, period, hours, scope)]);
      const release = comparisons[0][1].releaseDate;
      status.textContent = `${dayOf(period.start)} 至 ${dayOf(period.end)} · 台灣時間${release ? ` · 上市參考 ${release}` : ''}`;
      results.append(...comparisons.map(([scope, comparison]) => renderRegion(scope, comparison, period.slots.length,
        index.games[gameId].tracking_status)));
    } catch {
      status.textContent = '暫時無法取得同一版本的逐時紀錄。請按頁首的重新載入。';
    }
  }

  for (const [control, key, fallback] of [
    [first, 'trial_hour_a', firstDefault], [second, 'trial_hour_b', secondDefault], [region, 'trial_region', regionDefault],
  ]) control.addEventListener('change', () => {
    if (control.value === String(fallback)) params.delete(key);
    else params.set(key, control.value);
    onChange();
    if (current) render();
  });

  return {
    async update(index, gameId, chunksFor) {
      const period = trialWindow(0);
      if (current?.index === index && current.period.today === period.today && !current.error) return;
      const entry = { index, gameId, period, chunks: null, error: false };
      current = entry;
      const firstOpen = section.hidden;
      section.hidden = false; jump.hidden = false;
      render();
      if (firstOpen && location.hash === '#trialTimes') section.scrollIntoView();
      const gameMonths = index.games[gameId].months;
      try {
        entry.chunks = await chunksFor(monthsFor(period.start, period.end).filter(month => gameMonths.includes(month)));
      } catch { entry.error = true; }
      if (current === entry) render();
    },
    reset() { current = null; section.hidden = true; jump.hidden = true; },
  };
}
