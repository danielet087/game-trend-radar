import { node } from './presentation.js';
import { formatCount as fmt } from './number-format.js';
import { setInfoLines } from './info-notes.js';
import { dayOf, monthsFor } from './series.js';
import { HOUR } from './metrics.js';
import { compactCount, shortDate } from './trend-verdict.js';
import { SLOT_DEFAULTS, VIEWER_CHOICES, busiestSlot, latestRanks, slotHours, slotLabel, slotOf, slotPeriod, slotStats } from './stream-slot-model.js';
import { TRIAL_MIN_DAYS } from './stream-planning-model.js';

// 什麼時候開: the viewer's usual audience and stream slot (60 viewers and
// 11:00～15:00 by default), its typical numbers and rank, and one other slot
// of the same length to compare (by default the busiest one that does not
// overlap).

const hh = hour => `${String(hour).padStart(2, '0')}:00`;
const people = value => { const text = compactCount(value); return `${text}${text.endsWith('萬') ? '' : ' '}人`; };

function rankText(rank) {
  if (!rank) return null;
  return rank.ahead !== undefined ? `第 ${fmt(rank.ahead + 1)} 名` : `第 ${fmt(rank.low + 1)}～${fmt(rank.high + 1)} 名`;
}

/** One hour's place from channelsAboveRange: "第 9 名", or "第 6～9 名" between two tiers. */
export function placeText(range) {
  if (!range) return null;
  return range.low === range.high ? `第 ${fmt(range.low + 1)} 名` : `第 ${fmt(range.low + 1)}～${fmt(range.high + 1)} 名`;
}

/** "14:00" in Taiwan time. */
export const hourText = at => new Date(at + 8 * HOUR).toISOString().slice(11, 16);

function options(select, values, label) {
  select.replaceChildren(...values.map(value => {
    const option = node('option', '', label(value));
    option.value = String(value);
    return option;
  }));
}

export function createStreamSlots({ $, params, onChange, onRank }) {
  const panel = $('slotPanel'), tiles = $('slotTiles'), rankLine = $('slotRank'), status = $('slotStatus'), info = $('slotInfo');
  const viewersSelect = $('slotViewers'), startSelect = $('slotStart'), endSelect = $('slotEnd'), compareSelect = $('slotCompare');
  options(viewersSelect, VIEWER_CHOICES, value => `${value} 人`);
  options(startSelect, Array.from({ length: 24 }, (_, i) => i), hh);
  options(endSelect, Array.from({ length: 24 }, (_, i) => i + 1), hh);
  const chosen = Number(params.get('slot_viewers'));
  viewersSelect.value = String(VIEWER_CHOICES.includes(chosen) ? chosen : SLOT_DEFAULTS.viewers);
  const initial = slotOf(params.get('slot_start'), params.get('slot_end'));
  startSelect.value = String(initial.start); endSelect.value = String(initial.end);
  let current = null, region = 'global', request = 0;

  function compareOptions() {
    const length = slotHours(slot()).length, previous = compareSelect.value || params.get('slot_compare') || 'auto';
    const automatic = node('option', '', '看的人最多的時段');
    automatic.value = 'auto';
    compareSelect.replaceChildren(automatic, ...Array.from({ length: 24 }, (_, start) => {
      const option = node('option', '', slotLabel({ start, end: (start + length) % 24 || 24 }));
      option.value = String(start);
      return option;
    }));
    compareSelect.value = /^(auto|\d{1,2})$/.test(previous) && (previous === 'auto' || Number(previous) < 24) ? previous : 'auto';
  }

  const slot = () => slotOf(startSelect.value, endSelect.value);

  function tile(stats, label, more) {
    const box = node('div', 'tw-slot-tile');
    if (more) box.dataset.more = 'true';
    box.append(node('span', 'tw-slot-label', label));
    if (stats.viewers === null) {
      box.append(node('strong', '', '—'), node('span', 'tw-slot-sub', `紀錄不到 ${TRIAL_MIN_DAYS} 天`));
      return box;
    }
    box.append(node('strong', '', `約 ${people(stats.viewers)}`),
      node('span', 'tw-slot-sub', `${fmt(Math.round(stats.streamers))} 台在開・每台約 ${stats.perStream === null ? '—' : people(stats.perStream)}`));
    const place = rankText(stats.rank);
    if (place) box.append(node('span', 'tw-slot-sub', `你約排${place}`));
    return box;
  }

  function writeInfo(period) {
    const from = shortDate(dayOf(period.start)), to = shortDate(dayOf(period.end));
    setInfoLines(info, [
      `數字是 ${from}～${to} 每天這段時間的常見值：先算每天這幾個小時的平均，再取這 7 天的中間值；至少要有 ${TRIAL_MIN_DAYS} 天。`,
      '你的位置：平常觀眾跟你差不多的台，在這段時間開時常見排第幾；觀眾一樣多的算並列。',
      '比較：預設找不跟你重疊、看的人最多的同長度時段。',
      '60 人這一級從 11/26 起才有；之前的日子先用 50 人和 100 人推估範圍。',
      `紀錄還不到 ${TRIAL_MIN_DAYS} 天時（例如上市頭幾天），先看最近一個小時：那小時觀眾比你平常人數多的台數＋1。`,
    ]);
  }

  function render() {
    if (!current) return;
    const { index, gameId, period, chunks, error } = current;
    if (error) { status.textContent = '暫時無法取得逐時紀錄。請按頁首的重新載入。'; tiles.replaceChildren(); rankLine.textContent = ''; onRank(null); return; }
    if (!chunks) { status.textContent = '正在讀取最近的逐時紀錄…'; return; }
    const viewers = Number(viewersSelect.value), mine = slot(), label = slotLabel(mine);
    const own = slotStats(index, chunks, gameId, period, mine, region, viewers);
    const choice = compareSelect.value;
    const length = slotHours(mine).length;
    const other = choice === 'auto' ? busiestSlot(index, chunks, gameId, period, mine, region, viewers)
      : slotStats(index, chunks, gameId, period, { start: Number(choice), end: (Number(choice) + length) % 24 || 24 }, region, viewers);
    const ownMore = other && own.viewers !== null && other.viewers !== null && own.viewers > other.viewers;
    const otherMore = other && own.viewers !== null && other.viewers !== null && other.viewers > own.viewers;
    const parts = [tile(own, `${label}・你的時段${ownMore ? '・看的人較多' : ''}`, ownMore)];
    if (other && !(other.slot.start === mine.start && other.slot.end === mine.end)) {
      parts.push(tile(other, `${slotLabel(other.slot)}${otherMore ? '・看的人較多' : ''}`, otherMore));
    }
    tiles.replaceChildren(...parts);
    const place = rankText(own.rank);
    const latest = own.rank ? null : latestRanks(index, chunks, gameId, period.now, viewers);
    const now = latest ? `${hourText(latest.at)} 那小時開的話：全球${placeText(latest.global)}${latest.zh ? `、中文區${placeText(latest.zh)}` : ''}。` : '';
    rankLine.textContent = own.rank ? own.rank.ahead !== undefined
      ? `平常 ${fmt(viewers)} 人的台，${label} 開常見排${place}，通常有 ${fmt(own.rank.ahead)} 台比你多。`
      : `平常 ${fmt(viewers)} 人的台，${label} 開大約排${place}（這一級的名次還在累積，先用前後兩級推估）。`
      : `最近 7 天這段時間的名次紀錄不到 ${TRIAL_MIN_DAYS} 天，還不能算。${now}`;
    status.textContent = `${shortDate(dayOf(period.start))}～${shortDate(dayOf(period.end))} 有 ${own.days}／${own.totalDays} 天紀錄・${region === 'zh' ? '中文區' : '全球'}`;
    onRank({ rank: own.rank, viewers, label, latest });
  }

  function change(key, value, fallback) {
    if (value === String(fallback)) params.delete(key); else params.set(key, value);
    onChange();
  }
  viewersSelect.addEventListener('change', () => { change('slot_viewers', viewersSelect.value, SLOT_DEFAULTS.viewers); render(); });
  for (const [select, key, fallback] of [[startSelect, 'slot_start', SLOT_DEFAULTS.start], [endSelect, 'slot_end', SLOT_DEFAULTS.end]]) {
    select.addEventListener('change', () => {
      const value = slot();
      startSelect.value = String(value.start); endSelect.value = String(value.end);
      change(key, select.value, fallback);
      compareOptions(); render();
    });
  }
  compareSelect.addEventListener('change', () => { change('slot_compare', compareSelect.value, 'auto'); render(); });
  compareOptions();

  return {
    async update(index, gameId, chunksFor) {
      const period = slotPeriod(index.games[gameId]);
      if (current?.index === index && current.gameId === gameId && current.period.today === period.today && !current.error) { render(); return; }
      const token = ++request;
      current = { index, gameId, period, chunks: null, error: false };
      panel.hidden = false;
      writeInfo(period);
      render();
      const months = monthsFor(period.start, period.end + 2 * 24 * HOUR).filter(month => index.games[gameId].months.includes(month));
      try { const chunks = await chunksFor(months); if (token === request) current.chunks = chunks; }
      catch { if (token === request) current.error = true; }
      if (token === request) render();
    },
    setRegion(value) { region = value; render(); },
    reset() { request++; current = null; panel.hidden = true; onRank(null); },
  };
}
