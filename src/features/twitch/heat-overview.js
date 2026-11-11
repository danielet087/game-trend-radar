import { node, fmt, time } from './presentation.js';
import { releaseDayLabel } from './cooldown.js';
import { HOUR } from './metrics.js';

export function streamerAdvice({ data, status, historical }, now = Date.now()) {
  if (historical) return ['先核對近期表現', '這款已結束追蹤。要再排這個主題，可以先看自己近期同時段播這類遊戲的表現。'];
  const last = data.points.findLast(point => Number.isFinite(point.raw));
  if (!last || now - Date.parse(last.hour) > data.settings.maxMissingHours * HOUR ||
      ['gap', 'insufficient', 'stale'].includes(status)) {
    return ['先等有效資料', '等觀測更新，再決定是否縮減場次。也可以先回看自己最近的同時段表現。'];
  }
  const threshold = fmt(data.settings.threshold);
  const lowDays = data.latest.lowDays;
  switch (status) {
    case 'cooled':
      return ['考慮收尾或換題', `遊戲已連續 ${lowDays} 個有效日低於 ${threshold} 人。如果你的同時段平均觀眾也低於平常，可以安排一場收尾或換題。`];
    case 'suspected':
      return ['先暫緩加開場次', `目前有 ${lowDays}／${data.settings.confirmDays} 個連續有效日低於 ${threshold} 人。等下一個有效日，再一起看你最近的開台表現。`];
    case 'recovered':
      return ['可安排一場回訪', `最新有效日已回到 ${threshold} 人門檻。先試一場，和你以往同時段的平均觀眾比較。`];
    case 'not_popular':
      return ['先試播一場', '目前尚未達熱門門檻。若題材適合你的頻道，可先用一場測試觀眾反應。'];
    case 'watching':
      return ['可先續播一場', '目前仍有觀看需求。開完後比較你的同時段平均觀眾，再決定是否加場。'];
    default:
      return ['先看近期表現', '對照遊戲的最新觀測與自己同時段的開台數字，再排下一場。'];
  }
}

export function renderHeatOverview(root, snapshot) {
  if (!root) return;
  root.hidden = false;
  const head = node('div', 'tw-heat-heading');
  const title = node('h2', '', `${snapshot.scope || ''}熱度摘要`); title.id = `${root.id}Title`;
  root.setAttribute('aria-labelledby', title.id);
  head.append(title, node('span', '', `${snapshot.scope || ''} · 全期觀測`));
  const state = node('p', 'tw-heat-status', snapshot.label);
  state.setAttribute('role', 'status'); state.setAttribute('aria-live', 'polite');
  root.dataset.status = snapshot.status;
  root.replaceChildren(head, state);
  if (!snapshot.data) return;
  const { data, releaseDate } = snapshot;
  const [actionTitle, actionText] = streamerAdvice(snapshot);
  const action = node('section', 'tw-stream-action');
  action.append(node('span', '', '開台建議'), node('h3', '', actionTitle), node('p', '', actionText));
  if (data.latest.complete) action.append(node('small', '', `${data.latest.day} · 每日總觀眾中位數 ${fmt(data.latest.median)} 人 · ${data.latest.validHours}／24 個有效小時`));
  const peak = data.relativeDecline.peak, first = data.episodes[0];
  const cards = node('div', 'tw-heat-stats');
  function card(key, label, value, hint) {
    const item = node('div', 'tw-heat-stat'); item.dataset.heat = key;
    item.append(node('span', '', label), node('strong', '', value), node('small', '', hint));
    cards.append(item);
  }
  card('peak', '觀測高峰', peak ? releaseDayLabel(peak.startAt, releaseDate) || peak.date : '尚無有效統計日',
    peak ? `${peak.date} · 每日總觀眾中位數 ${fmt(peak.median)} 人` : '日期結束且至少有 12 筆有效紀錄後統計');
  card('cooled', '首次確認退燒', first ? releaseDayLabel(first.confirmedAt, releaseDate) || time(first.confirmedAt) : '尚未確認',
    first ? `${time(first.confirmedAt)} · 第三個連續低熱度日結束後確認` : `曾達 ${fmt(data.settings.threshold)} 人後，連續 3 天低於門檻才確認`);
  card('coverage', '有效觀測', `${fmt(data.coverage.valid)} / ${fmt(data.coverage.total)} 小時`,
    `${data.coverage.completeDays} 個有效統計日 · 缺測保留空白`);
  const note = node('p', 'tw-heat-note', `${snapshot.historical ? '已結束追蹤，以最後保存紀錄判定。' : '追蹤中，以已保存紀錄判定。'} 高峰與退燒使用全部歷史，不隨下方日期範圍改變。`);
  const firstDay = data.firstHour && releaseDate ? releaseDayLabel(data.firstHour, releaseDate) : null;
  if (firstDay) note.append(node('span', '', ` 自${firstDay}開始觀測。`));
  else note.append(node('span', '', ' 上市日尚未確認時顯示觀測日期。'));
  const link = node('a', '', '查看判定依據與高峰衰退紀錄 ↓'); link.href = '#historyCooldown';
  root.append(action, cards, note, link);
}
