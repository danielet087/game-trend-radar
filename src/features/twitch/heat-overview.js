import { node, fmt, time } from './presentation.js';
import { releaseDayLabel } from './cooldown.js';

export function renderHeatOverview(root, snapshot) {
  if (!root) return;
  root.hidden = false;
  const head = node('div', 'tw-heat-heading');
  const title = node('h2', '', '熱度摘要'); title.id = 'heatOverviewTitle';
  head.append(title, node('span', '', `${snapshot.scope || ''} · 全期觀測`));
  const state = node('p', 'tw-heat-status', snapshot.label);
  state.setAttribute('role', 'status'); state.setAttribute('aria-live', 'polite');
  root.dataset.status = snapshot.status;
  root.replaceChildren(head, state);
  if (!snapshot.data) return;
  const { data, releaseDate } = snapshot;
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
    first ? `${time(first.confirmedAt)} · 第三個連續低熱度日結束後確認` : '曾達 3,000 人後，連續 3 天低於門檻才確認');
  card('coverage', '有效觀測', `${fmt(data.coverage.valid)} / ${fmt(data.coverage.total)} 小時`,
    `${data.coverage.completeDays} 個有效統計日 · 缺測保留空白`);
  const note = node('p', 'tw-heat-note', `${snapshot.historical ? '已結束追蹤，以最後保存紀錄判定。' : '追蹤中，以已保存紀錄判定。'} 高峰與退燒使用全部歷史，不隨下方日期範圍改變。`);
  const firstDay = data.firstHour && releaseDate ? releaseDayLabel(data.firstHour, releaseDate) : null;
  if (firstDay) note.append(node('span', '', ` 自${firstDay}開始觀測。`));
  else note.append(node('span', '', ' 上市日尚未確認時顯示觀測日期。'));
  const link = node('a', '', '查看判定依據與高峰衰退紀錄 ↓'); link.href = '#historyCooldown';
  root.append(cards, note, link);
}
