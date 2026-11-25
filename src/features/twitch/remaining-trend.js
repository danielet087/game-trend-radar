import { node } from './presentation.js';
import { formatCount as fmt } from './number-format.js';
import { MIN_CONCENTRATION_HOURS, MIN_PAIRED_HEAT_HOURS, STREAM_HEAT_WEEK } from './stream-heat-model.js';

/** The Chinese region's week without its biggest channel: its share and the day-to-day change of the rest. */
export function renderRemainingTrend({ through, rows }) {
  const section = node('section', 'tw-remaining-trend');
  section.append(node('h3', '', '最大台以外的觀看變化'));
  const period = `截至 ${through.replaceAll('-', '/')} 的近 ${STREAM_HEAT_WEEK} 天`;
  if (!rows.length) {
    section.append(node('p', 'tw-heat-note', `${period}資料不足。`));
    return section;
  }
  const table = node('table', 'tw-compare-table');
  const head = node('thead'), header = node('tr'), body = node('tbody');
  for (const label of ['日期', '最大台占比', '其餘台觀眾變化', '總開台數變化', '配對時段']) {
    const th = node('th', '', label); th.scope = 'col'; header.append(th);
  }
  head.append(header);
  const signed = (value, unit) => value === null ? '—' : `${value > 0 ? '+' : ''}${fmt(value)} ${unit}`;
  for (const entry of rows.toReversed()) {
    const row = node('tr');
    const date = entry.date.slice(5).replace('-', '/') + (entry.partial ? '（截至目前）' : '');
    const share = entry.share === null ? '—' : `${fmt(entry.share)}%`;
    row.append(node('td', '', date), node('td', '', share), node('td', '', signed(entry.viewers, '人')),
      node('td', '', signed(entry.streams, '台')), node('td', '', fmt(entry.hours)));
    body.append(row);
  }
  table.append(head, body);
  section.append(node('p', 'tw-heat-note', `${period}。最大台占比取有觀眾時的中位數（至少 ${MIN_CONCENTRATION_HOURS} 個小時）。增減取前一天同時段差值的中位數（至少配對 ${MIN_PAIRED_HEAT_HOURS} 個小時）。`), table);
  return section;
}
