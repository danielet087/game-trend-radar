import { HOUR, count, filteredAudience, timestamp } from './metrics.js';

export const metrics = { viewers: '總觀眾', streamers: '開台數', median: '篩選中位數' };
export const dayOf = value => new Date(Number(value) + 8 * HOUR).toISOString().slice(0, 10);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function validIndex(value) {
  return object(value) && value.schema_version === 1 && value.timezone === 'Asia/Taipei' &&
    Boolean(timestamp(value.generated_at)) && object(value.months) && object(value.games) &&
    Object.entries(value.months).every(([month, hours]) => /^\d{4}-\d{2}$/.test(month) && object(hours) &&
      Object.entries(hours).every(([hour, generated]) => timestamp(hour) && Date.parse(hour) % HOUR === 0 &&
        dayOf(Date.parse(hour)).startsWith(month) && timestamp(generated)));
}
export function validChunk(value, id, month) {
  return object(value) && value.schema_version === 1 && value.timezone === 'Asia/Taipei' &&
    value.game_id === id && value.month === month && object(value.hours);
}
export function dateStart(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return NaN;
  const at = Date.parse(`${value}T00:00:00+08:00`);
  return Number.isFinite(at) && dayOf(at) === value ? at : NaN;
}
export function windowFor(params, index) {
  const times = Object.values(index.months).flatMap(hours => Object.keys(hours).map(Date.parse));
  if (!times.length) throw new Error('目前尚無歷史紀錄。');
  const latest = Math.max(...times);
  const range = ['24h', '7d', '30d', 'custom'].includes(params.get('range')) ? params.get('range') : '7d';
  if (range === 'custom') {
    const start = dateStart(params.get('start')), end = dateStart(params.get('end')) + 23 * HOUR;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start > latest || end - start >= 31 * 24 * HOUR)
      throw new Error('請選擇有效日期：結束不早於開始，範圍最多 31 天，且開始不得晚於最新紀錄。');
    return { range, start, end: Math.min(end, latest), latest };
  }
  return { range, start: latest - ({ '24h': 24, '7d': 168, '30d': 720 }[range] - 1) * HOUR, end: latest, latest };
}
export function monthsFor(start, end) {
  const months = new Set();
  for (let at = start; at <= end; at += HOUR) months.add(dayOf(at).slice(0, 7));
  return [...months];
}
export function seriesRows(index, chunks, game, start, end) {
  const rows = [];
  for (let at = start; at <= end; at += HOUR) {
    const hour = new Date(at).toISOString().replace('.000Z', 'Z');
    const month = dayOf(at).slice(0, 7), generated = index.months[month]?.[hour];
    const raw = chunks[month]?.hours[hour];
    if (raw && raw.generated_at !== generated) throw new Error('歷史資料正在更新，請按「重新載入」取得同一版紀錄。');
    rows.push({ hour, generated_at: generated || null, status: !generated ? 'missing' : raw ? 'observed' : 'absent',
      viewer_count: raw ? count(raw.viewer_count) : null, streamer_count: raw ? count(raw.streamer_count) : null,
      filtered_audience: filteredAudience(raw?.filtered_audience) });
  }
  return rows;
}
export function overviewQuery(search) {
  const input = new URLSearchParams(search), output = new URLSearchParams();
  const q = input.get('q')?.slice(0, 160);
  if (q) output.set('q', q);
  if (['signals', 'twitch_new', 'steam_recent', 'igdb', 'all'].includes(input.get('state'))) output.set('state', input.get('state'));
  if (['median', 'viewers', 'streamers'].includes(input.get('sort'))) output.set('sort', input.get('sort'));
  return output.toString();
}
export function detailHref(id, search = '') {
  const params = new URLSearchParams({ game: id }), back = overviewQuery(search);
  if (back) params.set('back', back);
  return `./twitch-game.html?${params}`;
}
export function csvRows(rows) {
  const labels = { observed: '已觀測', missing: '無收集紀錄', absent: '未列入本次觀測' };
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const header = ['時段（台灣）', '快照產生時間（UTC）', '狀態', '總觀眾', '開台數', '篩選中位數', '中位數狀態'];
  return '\uFEFF' + [header, ...rows.map(row => [
    new Date(Date.parse(row.hour) + 8 * HOUR).toISOString().slice(0, 16).replace('T', ' '), row.generated_at,
    labels[row.status], row.viewer_count, row.streamer_count, row.filtered_audience.median_viewer_count,
    row.filtered_audience.status,
  ])].map(row => row.map(quote).join(',')).join('\r\n');
}
