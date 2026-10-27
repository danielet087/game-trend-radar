import { analyzeCooldown } from './cooldown-model.js';

const NS = 'http://www.w3.org/2000/svg', HOUR = 3600000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const number = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });
const clock = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const shortClock = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
const fmt = value => finite(value) ? number.format(value) : '—';
const at = value => value && Number.isFinite(Date.parse(value)) ? clock.format(new Date(value)) : '—';
const shortAt = value => value && Number.isFinite(Date.parse(value)) ? shortClock.format(new Date(value)) : '—';
const compact = value => value >= 10000 ? `${fmt(value / 10000)}萬` : fmt(value);
const statuses = {
  insufficient: '資料不足，尚無法判定', watching: '尚未符合過氣條件', suspected: '低於門檻，等待滿 3 天',
  cooled: '已過氣（依雷達規則）', recovered: '已回到 3,000 人門檻', gap: '最新資料不足，狀態待確認',
};
function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}
export function releaseDayIndex(hour, releaseDate) {
  const base = calendarDate(releaseDate);
  if (base === null || typeof hour !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(hour)) return null;
  const time = Date.parse(hour);
  if (!Number.isFinite(time)) return null;
  const local = new Date(time + 8 * HOUR);
  if (!Number.isFinite(local.getTime())) return null;
  const day = calendarDate(local.toISOString().slice(0, 10));
  return day === null ? null : Math.round((day - base) / (24 * HOUR));
}
export function releaseDayLabel(hour, releaseDate) {
  const day = releaseDayIndex(hour, releaseDate);
  return day === null ? null : day === 0 ? '上市當天（Day 0）' : day > 0 ? `上市後第 ${day} 天` : `上市前第 ${-day} 天`;
}
function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}
function svgEl(tag, attributes = {}, text) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text != null) element.textContent = text;
  return element;
}

export function createCooldown(root) {
  if (!root) return { update() {}, hide() {}, destroy() {} };
  const listeners = new AbortController(), on = (target, type, handler) => target.addEventListener(type, handler, { signal: listeners.signal });
  let context = {}, rows = null, data = null, loadedKey = '', request = 0, disposed = false, width = 0;
  let selected = 0, geometry = null;
  root.classList.add('tw-cooldown'); root.setAttribute('aria-labelledby', 'cooldownTitle');
  const head = el('div', 'tw-workspace-head'), heading = el('div');
  const section = el('span', 'tw-section-no', '02'); section.setAttribute('aria-hidden', 'true');
  const title = el('h2', '', '熱度退潮時間點'); title.id = 'cooldownTitle';
  heading.append(section, title); head.append(heading, el('span', 'tw-cooldown-scope', '全期判定'));
  const intro = el('p', 'tw-cooldown-intro', '每日觀眾中位數連續 3 天低於 3,000 人，即確認過氣。使用該遊戲的 Twitch 逐時總觀眾，依台灣時間統計已結束的日期；每天最多容許缺 12 小時，不補零。此圖使用全部已保存紀錄，不受上方日期範圍裁切。');
  const range = el('p', 'tw-cooldown-range'); range.id = 'cooldownRange';
  const releaseSummary = el('div', 'tw-cooldown-release'); releaseSummary.id = 'cooldownReleaseSummary';
  const controls = el('div', 'tw-cooldown-controls');
  const rule = el('p', 'tw-cooldown-rule', '固定規則：每日中位數 < 3,000 人 × 連續 3 天；每天至少 12 / 24 筆有效資料'); rule.id = 'cooldownRule';
  const retry = el('button', 'tw-cooldown-retry', '重新讀取全期資料'); retry.type = 'button';
  controls.append(rule, retry);
  const stateLine = el('div', 'tw-cooldown-state-line');
  const status = el('strong', 'tw-cooldown-status'); status.id = 'cooldownStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const stateDetail = el('p', 'tw-cooldown-state-detail'); stateDetail.id = 'cooldownStateDetail'; stateLine.append(status, stateDetail);
  const summary = el('div', 'tw-cooldown-summary'); summary.id = 'cooldownSummary';
  const evidence = el('div', 'tw-cooldown-daily'); evidence.id = 'cooldownDailyEvidence';
  const figure = el('figure', 'tw-cooldown-figure'), chart = el('div', 'tw-cooldown-chart'); chart.id = 'cooldownChart';
  const legend = el('figcaption', 'tw-cooldown-legend', '淡紫線：逐時總觀眾　｜　紫線：每日中位數（日結束時標示）　｜　橘色虛線：3,000 人門檻　｜　橘色區間：已確認的低熱度觀測');
  figure.append(chart, legend);
  const reader = el('div', 'tw-cooldown-reader'), readerLabel = el('label', '', '查看全期觀測與事件'); readerLabel.htmlFor = 'cooldownScrubber';
  const scrubber = el('input'); scrubber.type = 'range'; scrubber.id = 'cooldownScrubber'; scrubber.min = '0'; scrubber.step = '1';
  const readout = el('output', 'tw-cooldown-readout'); readout.id = 'cooldownReadout'; readout.setAttribute('for', 'cooldownScrubber');
  reader.append(readerLabel, scrubber, readout);
  const events = el('div', 'tw-cooldown-events'); events.id = 'cooldownEvents';
  const method = el('p', 'tw-cooldown-method'); method.id = 'cooldownMethod';
  root.replaceChildren(head, intro, range, releaseSummary, controls, stateLine, summary, evidence, figure, reader, events, method);

  function releaseDate() {
    const reference = context.releaseReference;
    return reference?.precision === 'day' && calendarDate(reference.date) !== null ? reference.date : null;
  }
  function dayHint(hour) { return releaseDayLabel(hour, releaseDate()); }
  function renderRelease(episode) {
    releaseSummary.replaceChildren();
    const date = releaseDate();
    if (!date) {
      releaseSummary.append(el('p', '', '上市日尚未確認，暫以觀測日期定位。'));
      return;
    }
    const point = episode?.candidateAt, label = dayHint(point);
    const firstDay = releaseDayIndex(data.firstHour, date);
    releaseSummary.append(el('strong', '', point ? `${label}起連續低於 3,000 人` : '以上市日 Day 0 對齊觀測'));
    if (episode?.confirmedAt) releaseSummary.append(el('p', '', `${dayHint(episode.confirmedAt)}確認過氣（依雷達規則）；確認時間 ${at(episode.confirmedAt)}。`));
    else if (point) releaseSummary.append(el('p', '', '尚未累積滿 3 個有效統計日，暫不確認過氣。'));
    releaseSummary.append(el('p', '', `上市日 ${date.replaceAll('-', '/')}（${context.releaseReference.source || '已保存的上市日期'}）`));
    if (firstDay > 0) releaseSummary.append(el('p', 'tw-cooldown-coverage-warning', `上市後第 ${firstDay} 天才開始觀測，無法確認上市至收集前的熱度持續時間。`));
  }

  function card(label, value, hint) {
    const result = el('div', 'tw-cooldown-stat'); result.append(el('span', '', label), el('strong', '', value), el('small', '', hint || '')); return result;
  }
  function eventEntries() {
    const result = [];
    for (const [index, episode] of (data?.episodes || []).entries()) {
      result.push({ at: episode.candidateAt, label: `第 ${index + 1} 波連續低熱度起始日`, type: 'candidate' },
        { at: episode.confirmedAt, label: `第 ${index + 1} 波過氣確認`, type: 'confirmed' });
      if (episode.recoveryAt) result.push({ at: episode.recoveryAt, label: '回到 3,000 人門檻的統計日', type: 'recovery' });
      if (episode.recoveryConfirmedAt) result.push({ at: episode.recoveryConfirmedAt, label: '已回到 3,000 人門檻', type: 'recovered' });
      if (episode.interruptedAt) result.push({ at: episode.interruptedAt, label: '觀測中斷，需重新確認', type: 'gap' });
      for (const confirmation of episode.reconfirmations || [])
        result.push({ at: confirmation.confirmedAt, label: `第 ${index + 1} 波中斷後再次確認`, type: 'confirmed' });
    }
    if (data?.candidate) result.push({ at: data.candidate.candidateAt, label: '連續低熱度起始日（尚未滿 3 天）', type: 'candidate' });
    return result.filter(item => item.at).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }
  function readerPoints() {
    const points = new Map((data?.points || []).map(point => [Date.parse(point.hour), { ...point }]));
    for (const day of data?.days || []) {
      if (!day.isClosed) continue;
      const time = Date.parse(day.endAt);
      points.set(time, { ...(points.get(time) || { hour: day.endAt }), day: day.date, median: day.median, validHours: day.validHours });
    }
    for (const event of eventEntries()) {
      const time = Date.parse(event.at);
      if (!points.has(time)) points.set(time, { hour: event.at });
    }
    return [...points.values()].sort((a, b) => Date.parse(a.hour) - Date.parse(b.hour));
  }
  function select(index) {
    const points = readerPoints();
    selected = Math.max(0, Math.min(points.length - 1, index)); scrubber.value = String(selected);
    const point = points[selected];
    const labels = point ? eventEntries().filter(item => Date.parse(item.at) === Date.parse(point.hour)).map(item => item.label) : [];
    const observed = point && Object.hasOwn(point, 'raw') ? ` · 總觀眾 ${fmt(point.raw)} 人` : '';
    const daily = point?.day ? ` · ${point.day} 每日中位數 ${fmt(point.median)}${finite(point.median) ? ' 人' : '（資料不足）'} · 有效 ${point.validHours} / 24 筆` : '';
    const text = point ? `${at(point.hour)}${dayHint(point.hour) ? ` · ${dayHint(point.hour)}` : ''}${observed}${daily} · 固定門檻 3,000 人${labels.length ? ` · ${labels.join('、')}` : ''}` : '沒有可查看的觀測。';
    readout.textContent = text; scrubber.setAttribute('aria-valuetext', text);
    if (geometry && point) {
      geometry.cursor.setAttribute('x1', geometry.x(Date.parse(point.hour))); geometry.cursor.setAttribute('x2', geometry.x(Date.parse(point.hour)));
      geometry.cursor.setAttribute('visibility', 'visible');
      for (const dot of geometry.marks) dot.node.setAttribute('data-selected', String(Date.parse(dot.hour) === Date.parse(point.hour)));
    }
  }
  function chooseAt(hour) {
    const target = Date.parse(hour), points = readerPoints();
    if (!Number.isFinite(target) || !points.length) return;
    let closest = 0;
    points.forEach((point, index) => { if (Math.abs(Date.parse(point.hour) - target) < Math.abs(Date.parse(points[closest].hour) - target)) closest = index; });
    select(closest);
  }
  on(scrubber, 'input', () => select(Number(scrubber.value)));
  on(chart, 'click', event => { const marker = event.target?.closest?.('[data-cooldown-hour]'); if (marker) chooseAt(marker.getAttribute('data-cooldown-hour')); });
  on(chart, 'mouseover', event => { const marker = event.target?.closest?.('[data-cooldown-hour]'); if (marker) chooseAt(marker.getAttribute('data-cooldown-hour')); });
  on(events, 'click', event => { const button = event.target?.closest?.('button[data-cooldown-hour]'); if (button) chooseAt(button.getAttribute('data-cooldown-hour')); });
  on(retry, 'click', () => load(true));

  function path(points, key, x, y, interval = HOUR) {
    let output = '', previous = null;
    for (const point of points) {
      const value = point[key], time = Date.parse(point.hour);
      if (!finite(value)) { previous = null; continue; }
      output += `${previous !== null && time - previous === interval ? ' L' : ' M'}${x(time)} ${y(value)}`; previous = time;
    }
    return output;
  }
  function draw() {
    const points = data?.points || [], valid = points.filter(point => finite(point.raw)); geometry = null;
    if (!valid.length) { chart.replaceChildren(el('p', 'tw-cooldown-empty', '目前沒有有效觀眾資料可顯示。')); reader.hidden = true; legend.hidden = true; return; }
    reader.hidden = false; legend.hidden = false;
    const w = Math.max(300, Math.min(1100, (root.clientWidth || 920) - 50)), h = 350;
    const left = w < 500 ? 52 : 68, right = 22, top = 40, bottom = 55;
    const dailyPoints = (data.days || []).filter(day => day.isClosed).map(day => ({ hour: day.endAt, median: day.median, date: day.date, validHours: day.validHours }));
    const times = readerPoints(), start = Date.parse(times[0].hour), end = Date.parse(times.at(-1).hour);
    const high = Math.max(data.settings.threshold, ...valid.map(point => point.raw)) * 1.08;
    const x = value => left + (value - start) / Math.max(HOUR, end - start) * (w - left - right);
    const y = value => top + (h - top - bottom) * (1 - value / high);
    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-labelledby': 'cooldownSvgTitle cooldownSvgDesc' });
    svg.append(svgEl('title', { id: 'cooldownSvgTitle' }, `${context.gameName || '遊戲'}的全期熱度退潮觀測`),
      svgEl('desc', { id: 'cooldownSvgDesc' }, '淡線為逐時總觀眾，紫線為每日觀眾中位數（日結束時標示），橘色虛線固定在三千人。連續低熱度起始日與過氣確認時間分開標示；可使用下方滑桿或事件按鈕查看。'));
    const lastClosedEnd = Date.parse((data.days || []).findLast(day => day.isClosed)?.endAt);
    for (const episode of data.episodes) {
      const phases = [{ startedAt: episode.candidateAt, confirmedAt: episode.confirmedAt }, ...(episode.reconfirmations || [])];
      for (const phase of phases) {
        const from = Date.parse(phase.startedAt), confirmed = Date.parse(phase.confirmedAt);
        const gap = (data.days || []).find(day => day.isClosed && !day.complete && Date.parse(day.startAt) >= confirmed);
        const to = Math.min(end, lastClosedEnd, ...[episode.recoveryAt, gap?.startAt].filter(Boolean).map(value => Date.parse(value)));
        if (Number.isFinite(from) && Number.isFinite(to) && to > from)
          svg.append(svgEl('rect', { x: x(from), y: top, width: Math.max(1, x(to) - x(from)), height: h - top - bottom, class: 'tw-cooldown-band' }));
      }
    }
    for (let tick = 0; tick <= 4; tick++) {
      const value = high * tick / 4;
      svg.append(svgEl('line', { x1: left, x2: w - right, y1: y(value), y2: y(value), class: 'tw-cooldown-grid' }),
        svgEl('text', { x: left - 8, y: y(value) + 4, 'text-anchor': 'end', class: 'tw-cooldown-axis' }, compact(value)));
    }
    const ticks = [start, start + (end - start) / 2, end];
    ticks.forEach((time, index) => {
      const hour = new Date(time).toISOString(), day = releaseDayIndex(hour, releaseDate());
      const text = svgEl('text', { x: x(time), y: h - bottom + 18, 'text-anchor': index === 0 ? 'start' : index === 2 ? 'end' : 'middle', class: 'tw-cooldown-axis' });
      if (day !== null) {
        text.append(svgEl('tspan', { x: x(time), dy: 0 }, `D${day >= 0 ? '+' : ''}${day}`), svgEl('tspan', { x: x(time), dy: 13 }, shortAt(hour)));
      } else text.textContent = shortAt(hour);
      svg.append(text);
    });
    svg.append(svgEl('text', { x: left, y: 14, class: 'tw-cooldown-axis-label' }, '總觀眾（人）'),
      svgEl('text', { x: (left + w - right) / 2, y: h - 4, 'text-anchor': 'middle', class: 'tw-cooldown-axis-label' }, releaseDate() ? '上市日 Day 0 對齊 · 台灣觀測日期' : '全期觀測時間（台灣）'));
    const rawPath = path(points, 'raw', x, y), dailyPath = path(dailyPoints, 'median', x, y, 24 * HOUR);
    if (rawPath) svg.append(svgEl('path', { d: rawPath, class: 'tw-cooldown-raw', fill: 'none' }));
    if (dailyPath) svg.append(svgEl('path', { d: dailyPath, class: 'tw-cooldown-smooth', fill: 'none' }));
    svg.append(svgEl('line', { x1: left, x2: w - right, y1: y(data.settings.threshold), y2: y(data.settings.threshold), class: 'tw-cooldown-threshold' }),
      svgEl('text', { x: w - right, y: y(data.settings.threshold) - 6, 'text-anchor': 'end', class: 'tw-cooldown-threshold-label' }, '3,000 人門檻'));
    const marks = [];
    dailyPoints.forEach(point => {
      if (!finite(point.median)) return;
      const dot = svgEl('circle', { cx: x(Date.parse(point.hour)), cy: y(point.median), r: 3, class: 'tw-cooldown-dot', 'data-cooldown-hour': point.hour });
      dot.append(svgEl('title', {}, `${point.date} 每日中位數 ${fmt(point.median)} 人 · 有效 ${point.validHours} / 24 筆 · 於 ${at(point.hour)} 完成統計`)); svg.append(dot); marks.push({ node: dot, hour: point.hour });
    });
    for (const event of eventEntries()) {
      const time = Date.parse(event.at), color = event.type === 'recovered' || event.type === 'recovery' ? 'recovery' : event.type === 'gap' ? 'gap' : event.type;
      const line = svgEl('line', { x1: x(time), x2: x(time), y1: top, y2: h - bottom, class: `tw-cooldown-marker tw-cooldown-marker-${color}`, 'data-cooldown-hour': event.at });
      line.append(svgEl('title', {}, `${event.label} · ${at(event.at)}${dayHint(event.at) ? ` · ${dayHint(event.at)}` : ''}`)); svg.append(line);
      const glyph = event.type === 'candidate' ? '起' : event.type === 'confirmed' ? '確' : event.type === 'gap' ? '斷' : '升';
      const badge = svgEl('g', { class: `tw-cooldown-event-mark tw-cooldown-event-mark-${color}`, 'data-cooldown-hour': event.at });
      const markerY = event.type === 'confirmed' || event.type === 'recovered' ? 30 : 14;
      badge.append(svgEl('circle', { cx: x(time), cy: markerY, r: 10 }), svgEl('text', { x: x(time), y: markerY + 3.5, 'text-anchor': 'middle' }, glyph), svgEl('title', {}, `${event.label} · ${at(event.at)}${dayHint(event.at) ? ` · ${dayHint(event.at)}` : ''}`)); svg.append(badge);
    }
    const cursor = svgEl('line', { x1: 0, x2: 0, y1: top, y2: h - bottom, class: 'tw-cooldown-cursor', visibility: 'hidden' }); svg.append(cursor);
    chart.replaceChildren(svg); geometry = { x, y, cursor, marks };
    scrubber.max = String(times.length - 1); select(Math.min(selected, times.length - 1));
  }
  function isStale() {
    if (context.trackingStatus !== 'active') return false;
    const last = Date.parse(context.lastHour || data?.lastHour), latest = Date.parse(context.latestHour);
    const tolerance = (data?.settings.maxMissingHours ?? 12) * HOUR;
    return !Number.isFinite(last) || Number.isFinite(latest) && latest - last > tolerance || Date.now() - last > tolerance;
  }
  function renderEvents() {
    const entries = eventEntries(); events.replaceChildren(el('h3', '', '退潮與回升紀錄'));
    if (!entries.length) { events.append(el('p', '', '目前尚未找到符合此門檻的退潮事件。')); return; }
    const list = el('ol', 'tw-cooldown-event-list');
    for (const entry of entries) {
      const item = el('li'); item.dataset.kind = entry.type;
      const button = el('button', '', entry.label); button.type = 'button'; button.dataset.cooldownHour = entry.at;
      const time = el('time', '', `${at(entry.at)}${dayHint(entry.at) ? ` · ${dayHint(entry.at)}` : ''}`); time.dateTime = entry.at; item.append(button, time); list.append(item);
    }
    events.append(list, el('p', 'tw-cooldown-event-hint', '點選事件可在圖表定位。起始日是連續低熱度的第一個統計日；確認時間是第三天結束後，不代表首日零時就已知道會過氣。'));
  }
  function renderEvidence() {
    evidence.replaceChildren(el('h3', '', '最近 3 個已結束日的判定依據'));
    const days = (data.days || []).filter(day => day.isClosed).slice(-3);
    if (!days.length) { evidence.append(el('p', '', '尚無已結束的台灣日期可判定。')); return; }
    const list = el('div', 'tw-cooldown-daily-list');
    for (const day of days) {
      const item = el('div', 'tw-cooldown-day'); item.dataset.below = String(day.belowThreshold);
      item.append(el('span', '', day.date.replaceAll('-', '/')), el('strong', '', finite(day.median) ? `${fmt(day.median)} 人` : '資料不足'),
        el('small', '', `有效 ${day.validHours} / 24 筆 · 缺 ${day.missingHours ?? 24 - day.validHours} 小時`),
        el('small', '', !day.complete ? '缺測超過 12 小時，中斷計數' : day.belowThreshold ? '低於 3,000 人' : '達到 3,000 人，低熱度計數歸零'));
      list.append(item);
    }
    evidence.append(list);
  }
  function render() {
    if (disposed || root.hidden || !rows) return;
    try {
      data = analyzeCooldown(rows);
      const stale = isStale(), displayStatus = stale ? 'stale' : data.status;
      root.dataset.cooldownStatus = displayStatus; root.dataset.cooldownModelStatus = data.status;
      status.textContent = stale ? '最新狀態待確認' : statuses[data.status] || statuses.insufficient;
      status.dataset.tone = ['cooled', 'suspected'].includes(displayStatus) ? 'cooling' : displayStatus === 'recovered' ? 'recovery' : 'neutral';
      const historical = context.trackingStatus === 'ended';
      const prefix = historical ? `歷史判定，截至 ${at(context.lastHour || data.lastHour)}。` : `追蹤中，截至 ${at(context.lastHour || data.lastHour)}。`;
      let detail = '';
      const lowDays = data.pendingRecheck?.days ?? data.latest?.lowDays ?? data.candidate?.days ?? 0;
      if (stale) detail = '最新觀測已落後超過 12 小時，保留既有事件與日級計數；目前熱度狀態需等待新資料。';
      else if (data.status === 'suspected') detail = data.pendingRecheck
        ? `歷史過氣事件保留；缺測超過 12 小時後重新累積，已有 ${lowDays} / 3 天低於 3,000 人，最新狀態尚待確認。`
        : `每日觀眾中位數已有 ${lowDays} / 3 天低於 3,000 人。${historical ? '已保存的後續有效統計日不足，暫不確認。' : '滿 3 個連續有效統計日後確認。'}`;
      else if (data.status === 'cooled') detail = '每日觀眾中位數已連續 3 天低於 3,000 人，符合雷達的過氣規則；後續若回到門檻，仍會更新狀態。';
      else if (data.status === 'recovered') detail = '最新有效統計日的觀眾中位數已達 3,000 人，解除連續低於門檻的狀態；這不等同再次熱門。';
      else if (data.status === 'gap') detail = '已結束的統計日缺測超過 12 小時，連續計數中斷；缺測不視為零，也不刪除已確認的歷史事件。';
      else if (data.status === 'insufficient') detail = '需要已結束的台灣日期，每天至少 12 筆有效逐時總觀眾；有效統計日不足時暫不判定。';
      else detail = '每日觀眾中位數尚未連續 3 天低於 3,000 人；不因相對高峰下降而判定過氣。';
      const openDay = (data.days || []).at(-1);
      const pendingDay = openDay && !openDay.isClosed ? ` ${openDay.date} 尚未結束，不列入計數。` : '';
      stateDetail.textContent = `${prefix} ${detail}${pendingDay}`;
      const episode = data.candidate || data.episodes.at(-1);
      renderRelease(episode);
      summary.replaceChildren(
        card('連續低熱度起始日', episode?.candidateAt ? at(episode.candidateAt) : '尚未出現', episode?.candidateAt ? `${dayHint(episode.candidateAt) ? `${dayHint(episode.candidateAt)} · ` : ''}第一個低於門檻的統計日` : '依 3,000 人門檻觀察'),
        card('過氣確認時間', episode?.confirmedAt ? at(episode.confirmedAt) : '尚未確認', episode?.confirmedAt ? `${dayHint(episode.confirmedAt) ? `${dayHint(episode.confirmedAt)} · ` : ''}第三個連續有效統計日結束` : '連續 3 天每日中位數低於 3,000 人'),
        card('最新每日觀眾中位數', finite(data.latest?.median) ? `${fmt(data.latest.median)} 人` : '—', data.latest?.day ? `${data.latest.day} · 當日有效逐時總觀眾的中位數` : '尚無已結束的統計日'),
        card('連續低於 3,000 人', lowDays >= 3 ? `${lowDays} 天` : `${lowDays} / 3 天`, data.pendingRecheck ? '缺測中斷後重新累積' : '每天最多容許缺 12 小時；未結束日不計'),
      );
      range.textContent = `全期判定：${at(data.firstHour)} — ${at(data.lastHour)} · 有效 ${data.coverage.valid} / ${data.coverage.total} 個時段 · 可判定 ${data.coverage.completeDays} / ${data.coverage.totalDays} 天 · 台灣時間`;
      method.textContent = '規則：以台灣時間 00:00 至次日 00:00 為一天。日期結束後，當天至少有 12 / 24 筆有效逐時總觀眾，就用有效數值計算每日中位數；缺測最多 12 小時仍可延續計數，超過 12 小時才中斷，缺值不補零。每日中位數連續 3 天嚴格低於 3,000 人即確認過氣；等於 3,000 人不符合。確認後，首個有效統計日中位數達 3,000 人就解除低熱度狀態。中位數是這款遊戲一天內的逐時總觀眾，不是各直播台觀眾的中位數。這是雷達自訂的 Twitch 觀看熱度規則，不代表永久過氣或銷量變化。';
      renderEvidence(); renderEvents(); draw();
    } catch (error) { failure(error); }
  }
  function failure(error) {
    data = null; rows = null; geometry = null; loadedKey = '';
    root.dataset.cooldownStatus = 'unavailable'; root.setAttribute('aria-busy', 'false'); retry.disabled = false;
    status.textContent = '全期資料暫時無法讀取'; stateDetail.textContent = '請按「重新讀取全期資料」再試。原本趨勢圖與明細仍可繼續操作。';
    summary.replaceChildren(); evidence.replaceChildren(); releaseSummary.replaceChildren(); chart.replaceChildren(el('p', 'tw-cooldown-empty', '目前沒有可用的退潮判定結果。')); events.replaceChildren(); reader.hidden = true; legend.hidden = true; method.textContent = '';
    console.warn('Unable to display Twitch cooldown analysis:', error);
  }
  async function load(force = false) {
    const token = ++request;
    const key = `${context.gameName || ''}|${context.lastHour || ''}|${context.generatedAt || ''}`;
    root.hidden = false;
    if (!force && rows && loadedKey === key) { render(); return; }
    data = null; rows = null; geometry = null; loadedKey = '';
    root.setAttribute('aria-busy', 'true'); root.dataset.cooldownStatus = 'loading'; retry.disabled = true;
    status.textContent = '正在讀取全期觀測…'; status.dataset.tone = 'neutral'; stateDetail.textContent = '整理這款遊戲的全部歷史，找出連續低熱度起始日與過氣確認時間。';
    range.textContent = '全期判定，不受上方日期範圍裁切。'; summary.replaceChildren(); evidence.replaceChildren(); releaseSummary.replaceChildren(); chart.replaceChildren(); events.replaceChildren(); reader.hidden = true; legend.hidden = true; method.textContent = '';
    try {
      const next = await context.loadHistory();
      if (disposed || token !== request) return;
      rows = Array.isArray(next) ? next : []; loadedKey = key; selected = Number.MAX_SAFE_INTEGER;
      root.setAttribute('aria-busy', 'false'); retry.disabled = false; render();
    } catch (error) { if (!disposed && token === request) failure(error); }
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
    const next = Math.round(entries[0]?.contentRect.width || 0);
    if (next && width !== next) { width = next; if (data && !root.hidden) draw(); }
  }) : null;
  observer?.observe(root);
  return {
    update(nextContext = {}) { context = nextContext; load(); },
    hide() { request++; root.hidden = true; },
    destroy() { disposed = true; request++; listeners.abort(); observer?.disconnect(); root.replaceChildren(); root.hidden = true; },
  };
}

