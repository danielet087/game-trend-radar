import { analyzeCooldown, CHINESE_DAILY_HEAT_HITS, cooldownThreshold } from './cooldown-model.js';

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
  not_popular: '尚未達熱門門檻',
  insufficient: '資料不足，尚無法判定', watching: '尚未符合退燒條件', suspected: '低於門檻，等待滿 3 天',
  cooled: '已退燒', gap: '最新資料不足，狀態待確認', stale: '最新狀態待確認',
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

export function cooldownPresentation(data, context = {}, now = Date.now()) {
  const last = Date.parse(context.lastHour || data.lastHour), latest = Date.parse(context.latestHour);
  const tolerance = (data.settings.maxMissingHours ?? 12) * HOUR;
  const stale = context.trackingStatus === 'active' &&
    (!Number.isFinite(last) || Number.isFinite(latest) && latest - last > tolerance || now - last > tolerance);
  const latestDay = data.days.at(-1);
  const todayHasHeat = Boolean(!stale && context.trackingStatus !== 'ended' && data.settings.minimumHits &&
    latestDay && !latestDay.isClosed && Date.parse(latestDay.startAt) <= now && Date.parse(latestDay.endAt) > now &&
    latestDay.thresholdHits >= data.settings.minimumHits);
  const status = stale ? 'stale' : todayHasHeat ? 'watching' : data.status;
  const reference = context.releaseReference;
  const recoveryLabel = data.settings.minimumHits ? '已回到每日熱度門檻' : `已回到 ${fmt(data.settings.threshold)} 人門檻`;
  const label = todayHasHeat ? '今日有熱度' : status === 'recovered' ? recoveryLabel : statuses[status] || statuses.insufficient;
  return { data, status, label, todayHasHeat,
    releaseDate: reference?.precision === 'day' && calendarDate(reference.date) !== null ? reference.date : null,
    historical: context.trackingStatus === 'ended', scope: context.scope };
}

export function createCooldown(root, { onSummary = () => {}, idPrefix = '' } = {}) {
  const uid = name => idPrefix + name;
  if (!root) return { update() {}, hide() {}, destroy() {} };
  const listeners = new AbortController(), on = (target, type, handler) => target.addEventListener(type, handler, { signal: listeners.signal });
  let context = {}, rows = null, data = null, loadedKey = '', request = 0, disposed = false, width = 0;
  let selected = 0, geometry = null;
  root.classList.add('tw-cooldown'); root.setAttribute('aria-labelledby', uid('cooldownTitle'));
  const head = el('div', 'tw-workspace-head'), heading = el('div');
  const section = el('span', 'tw-section-no', '02'); section.setAttribute('aria-hidden', 'true');
  const title = el('h2', '', '熱度退潮時間點'); title.id = uid('cooldownTitle');
  heading.append(section, title); head.append(heading, el('span', 'tw-cooldown-scope', '全期判定'));
  const intro = el('p', 'tw-cooldown-intro');
  const range = el('p', 'tw-cooldown-range'); range.id = uid('cooldownRange');
  const releaseSummary = el('div', 'tw-cooldown-release'); releaseSummary.id = uid('cooldownReleaseSummary');
  const controls = el('div', 'tw-cooldown-controls');
  const rule = el('p', 'tw-cooldown-rule'); rule.id = uid('cooldownRule');
  const retry = el('button', 'tw-cooldown-retry', '重新讀取全期資料'); retry.type = 'button';
  controls.append(rule, retry);
  const stateLine = el('div', 'tw-cooldown-state-line');
  const status = el('strong', 'tw-cooldown-status'); status.id = uid('cooldownStatus'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const stateDetail = el('p', 'tw-cooldown-state-detail'); stateDetail.id = uid('cooldownStateDetail'); stateLine.append(status, stateDetail);
  const summary = el('div', 'tw-cooldown-summary'); summary.id = uid('cooldownSummary');
  const evidence = el('div', 'tw-cooldown-daily'); evidence.id = uid('cooldownDailyEvidence');
  const decline = el('div', 'tw-cooldown-events'); decline.id = uid('cooldownRelativeDecline');
  const figure = el('figure', 'tw-cooldown-figure'), chart = el('div', 'tw-cooldown-chart'); chart.id = uid('cooldownChart');
  const legend = el('figcaption', 'tw-cooldown-legend');
  figure.append(chart, legend);
  const reader = el('div', 'tw-cooldown-reader'), readerLabel = el('label', '', '查看全期觀測與事件'); readerLabel.htmlFor = uid('cooldownScrubber');
  const scrubber = el('input'); scrubber.type = 'range'; scrubber.id = uid('cooldownScrubber'); scrubber.min = '0'; scrubber.step = '1';
  const readout = el('output', 'tw-cooldown-readout'); readout.id = uid('cooldownReadout'); readout.setAttribute('for', uid('cooldownScrubber'));
  reader.append(readerLabel, scrubber, readout);
  const events = el('div', 'tw-cooldown-events'); events.id = uid('cooldownEvents');
  const method = el('p', 'tw-cooldown-method'); method.id = uid('cooldownMethod');
  root.replaceChildren(head, intro, range, releaseSummary, controls, stateLine, summary, evidence, decline, figure, reader, events, method);

  const thresholdLabel = () => `${fmt(cooldownThreshold(context.region))} 人`;
  const usesHits = () => context.region === 'zh';
  const hotRule = () => usesHits() ? `每日達 ${thresholdLabel()}至少 ${CHINESE_DAILY_HEAT_HITS} 次` : `每日中位數達 ${thresholdLabel()}`;
  const lowRule = () => usesHits() ? `每日達標少於 ${CHINESE_DAILY_HEAT_HITS} 次` : `每日中位數低於 ${thresholdLabel()}`;
  const recoveryRule = () => usesHits() ? '回到每日熱度門檻' : `回到 ${thresholdLabel()}門檻`;

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
    releaseSummary.append(el('strong', '', point ? `${label}起 ${lowRule()}` : '以上市日 Day 0 對齊觀測'));
    if (episode?.confirmedAt) releaseSummary.append(el('p', '', `${dayHint(episode.confirmedAt)}確認退燒；確認時間 ${at(episode.confirmedAt)}。`));
    else if (point) releaseSummary.append(el('p', '', '尚未累積滿 3 個有效統計日，暫不確認退燒。'));
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
        { at: episode.confirmedAt, label: `第 ${index + 1} 波退燒確認`, type: 'confirmed' });
      if (episode.recoveryAt) result.push({ at: episode.recoveryAt, label: `${recoveryRule()}的統計日`, type: 'recovery' });
      if (episode.recoveryConfirmedAt) result.push({ at: episode.recoveryConfirmedAt, label: `已${recoveryRule()}`, type: 'recovered' });
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
      points.set(time, { ...(points.get(time) || { hour: day.endAt }), day: day.date, median: day.median,
        thresholdHits: day.thresholdHits, validHours: day.validHours });
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
    const dailyValue = usesHits() ? `達標 ${point?.thresholdHits} 次` : `每日中位數 ${fmt(point?.median)}${finite(point?.median) ? ' 人' : '（資料不足）'}`;
    const daily = point?.day ? ` · ${point.day} ${dailyValue} · 有效 ${point.validHours} / 24 筆` : '';
    const text = point ? `${at(point.hour)}${dayHint(point.hour) ? ` · ${dayHint(point.hour)}` : ''}${observed}${daily} · 固定門檻 ${thresholdLabel()}${labels.length ? ` · ${labels.join('、')}` : ''}` : '沒有可查看的觀測。';
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
  on(decline, 'click', event => { const button = event.target?.closest?.('button[data-cooldown-hour]'); if (button) chooseAt(button.getAttribute('data-cooldown-hour')); });
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
    const high = Math.max(data.settings.threshold, context.domainMaximum || 0, ...valid.map(point => point.raw)) * 1.08;
    const x = value => left + (value - start) / Math.max(HOUR, end - start) * (w - left - right);
    const y = value => top + (h - top - bottom) * (1 - value / high);
    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-labelledby': `${uid('cooldownSvgTitle')} ${uid('cooldownSvgDesc')}` });
    svg.append(svgEl('title', { id: uid('cooldownSvgTitle') }, `${context.gameName || '遊戲'}的全期熱度退潮觀測`),
      svgEl('desc', { id: uid('cooldownSvgDesc') }, `淡線為逐時總觀眾，紫線為每日觀眾中位數，橘色虛線標示 ${thresholdLabel()}。使用滑桿或事件按鈕查看退燒起始與確認時間。`));
    const lastClosedEnd = Date.parse((data.days || []).findLast(day => day.isClosed)?.endAt);
    for (const episode of data.episodes) {
      const phases = [{ startedAt: episode.candidateAt, confirmedAt: episode.confirmedAt }, ...(episode.reconfirmations || [])];
      for (const phase of phases) {
        const from = Date.parse(phase.startedAt), confirmed = Date.parse(phase.confirmedAt);
        const gap = (data.days || []).find(day => day.isClosed && !day.complete &&
          day.missingHours > data.settings.maxMissingHours && Date.parse(day.startAt) >= confirmed);
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
      svgEl('text', { x: w - right, y: y(data.settings.threshold) - 6, 'text-anchor': 'end', class: 'tw-cooldown-threshold-label' }, `${thresholdLabel()}門檻`));
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
  function renderEvents() {
    const entries = eventEntries(); events.replaceChildren(el('h3', '', '退潮與回升紀錄'));
    if (!entries.length) { events.append(el('p', '', '目前尚未找到符合此門檻的退潮事件。')); return; }
    const list = el('ol', 'tw-cooldown-event-list');
    for (const entry of entries) {
      const item = el('li'); item.dataset.kind = entry.type;
      const button = el('button', '', entry.label); button.type = 'button'; button.dataset.cooldownHour = entry.at;
      const time = el('time', '', `${at(entry.at)}${dayHint(entry.at) ? ` · ${dayHint(entry.at)}` : ''}`); time.dateTime = entry.at; item.append(button, time); list.append(item);
    }
    events.append(list, el('p', 'tw-cooldown-event-hint', '點選事件可在圖表定位。起始日是連續低熱度的第一個統計日；確認時間是第三天結束後，不代表首日零時就已知道會退燒。'));
  }
  function renderEvidence() {
    evidence.replaceChildren(el('h3', '', '最近 3 個已結束日的判定依據'));
    const days = (data.days || []).filter(day => day.isClosed).slice(-3);
    if (!days.length) { evidence.append(el('p', '', '尚無已結束的台灣日期可判定。')); return; }
    const list = el('div', 'tw-cooldown-daily-list');
    for (const day of days) {
      const item = el('div', 'tw-cooldown-day'); item.dataset.below = String(day.belowThreshold);
      const value = usesHits() ? `達標 ${day.thresholdHits} 次` : finite(day.median) ? `${fmt(day.median)} 人` : '資料不足';
      const gap = day.missingHours > data.settings.maxMissingHours ? '缺測超過 12 小時，中斷計數' : '缺測可能影響判定，暫停計數';
      item.append(el('span', '', day.date.replaceAll('-', '/')), el('strong', '', value),
        el('small', '', `有效 ${day.validHours} / 24 筆 · 缺 ${day.missingHours ?? 24 - day.validHours} 小時`),
        el('small', '', !day.complete ? gap : day.status === 'not_popular' ? '尚未達熱門門檻，不累積退燒天數' : day.belowThreshold ? lowRule() : `${hotRule()}，低熱度計數歸零`));
      list.append(item);
    }
    evidence.append(list);
  }
  function renderDecline() {
    decline.replaceChildren(el('h3', '', '相對高峰衰退紀錄（輔助提示）'));
    const { peak, milestones } = data.relativeDecline;
    decline.append(el('p', 'tw-cooldown-event-hint', `退燒判定依連續 3 個可判定日${lowRule()}。`));
    if (!peak || peak.median <= 0) {
      decline.append(el('p', '', '尚無大於零的有效每日中位數高峰，無法計算比例衰退。')); return;
    }
    const peakSummary = el('p'); peakSummary.id = uid('cooldownPeak');
    peakSummary.append(el('strong', '', dayHint(peak.startAt) ? `${dayHint(peak.startAt)}達到高峰` : '上市日尚未確認，暫無法計算上市至高峰天數'));
    decline.append(peakSummary, el('p', '', `目前高峰日：${peak.date} · 已保存全期最高每日觀眾中位數 ${fmt(peak.median)} 人。高峰日為第 0 天，以下衰退天數從這一天開始往後算。`));
    const list = el('ol', 'tw-cooldown-event-list');
    for (const item of milestones) {
      const row = el('li');
      if (item.date) {
        const button = el('button', '', `高峰後第 ${item.daysFromPeak} 天 · 較高峰下降 ${item.percent}%`);
        button.type = 'button'; button.dataset.cooldownHour = item.observedAt;
        row.append(button, el('small', '', `${item.date}${dayHint(item.startedAt) ? ` · ${dayHint(item.startedAt)}` : ''} · 每日中位數 ${fmt(item.median)} 人 ≤ ${fmt(item.thresholdValue)} 人；於 ${at(item.observedAt)} 日結束後確認。`));
      } else row.append(el('strong', '', `較高峰下降 ${item.percent}%：高峰後尚未觀測到`), el('small', '', `從 ${peak.date} 起算，等待每日中位數降至 ${fmt(item.thresholdValue)} 人以下（含）`));
      list.append(row);
    }
    decline.append(list, el('p', 'tw-cooldown-event-hint', '以台灣日期計算上市至高峰的天數，以及從高峰到首次下降 25%、50%、75% 的天數。缺測日計入經過天數，達標日採有量測的有效日。每日中位數創新高時，三個跌幅改從新高峰起算。點選紀錄可定位圖表。'));
  }
  function render() {
    if (disposed || root.hidden || !rows) return;
    try {
      data = analyzeCooldown(rows, { region:context.region, releaseDate:usesHits() ? releaseDate() : null });
      const presentation = cooldownPresentation(data, context);
      const displayStatus = presentation.status, stale = displayStatus === 'stale';
      root.dataset.cooldownStatus = displayStatus; root.dataset.cooldownModelStatus = data.status;
      status.textContent = presentation.label;
      status.dataset.tone = ['cooled', 'suspected'].includes(displayStatus) ? 'cooling' : displayStatus === 'recovered' ? 'recovery' : 'neutral';
      const historical = context.trackingStatus === 'ended';
      const prefix = historical ? `歷史判定，截至 ${at(context.lastHour || data.lastHour)}。` : `追蹤中，截至 ${at(context.lastHour || data.lastHour)}。`;
      let detail = '';
      const threshold = thresholdLabel();
      const openDay = data.days.at(-1);
      const lowDays = data.pendingRecheck?.days ?? data.latest?.lowDays ?? data.candidate?.days ?? 0;
      if (stale) detail = '最新觀測已落後超過 12 小時，保留既有事件與日級計數；目前熱度狀態需等待新資料。';
      else if (presentation.todayHasHeat) detail = `今日已有 ${openDay.thresholdHits} 次達 ${threshold}。`;
      else if (data.status === 'not_popular') detail = `首次出現${hotRule()}的統計日後，開始檢查退燒。`;
      else if (data.status === 'suspected') detail = data.pendingRecheck
        ? `缺測中斷後重新計數，已有 ${lowDays} / 3 天符合「${lowRule()}」。`
        : `已有 ${lowDays} / 3 天符合「${lowRule()}」。${historical ? '後續可判定日不足。' : '滿 3 個可判定日後確認。'}`;
      else if (data.status === 'cooled') detail = `連續 3 個可判定日符合「${lowRule()}」。`;
      else if (data.status === 'recovered') detail = `最新有效日已${recoveryRule()}。`;
      else if (data.status === 'gap') detail = data.latest.missingHours > data.settings.maxMissingHours
        ? '已結束的統計日缺測超過 12 小時，連續計數中斷。' : '缺測可能影響單日判定，退燒計數暫停。';
      else if (data.status === 'insufficient') detail = usesHits()
        ? '需要已結束的台灣日期，且資料足以判定達標次數。' : '需要已結束的台灣日期，每天至少 12 筆有效逐時總觀眾。';
      else detail = `依「${lowRule()}」檢查退燒。`;
      const pendingDay = openDay && !openDay.isClosed && !presentation.todayHasHeat ? ` ${openDay.date} 統計中。` : '';
      stateDetail.textContent = `${prefix} ${detail}${pendingDay}`;
      const episode = data.candidate || data.episodes.at(-1);
      renderRelease(episode);
      summary.replaceChildren(
        card('連續低熱度起始日', episode?.candidateAt ? at(episode.candidateAt) : '尚未出現', episode?.candidateAt ? `${dayHint(episode.candidateAt) ? `${dayHint(episode.candidateAt)} · ` : ''}第一個低於門檻的統計日` : `依 ${threshold}門檻觀察`),
        card('退燒確認時間', episode?.confirmedAt ? at(episode.confirmedAt) : '尚未確認', episode?.confirmedAt ? `${dayHint(episode.confirmedAt) ? `${dayHint(episode.confirmedAt)} · ` : ''}第三個連續有效統計日結束` : `連續 3 個可判定日${lowRule()}`),
        usesHits() ? card('最近完整日達標次數', data.latest.day ? `${data.latest.thresholdHits} 次` : '—',
          data.latest.day ? `${data.latest.day} · 達 ${threshold} · 有效 ${data.latest.validHours}/24 筆` : '尚無已結束的統計日')
          : card('最新每日觀眾中位數', finite(data.latest?.median) ? `${fmt(data.latest.median)} 人` : '—', data.latest?.day ? `${data.latest.day} · 當日有效逐時總觀眾的中位數` : '尚無已結束的統計日'),
        card('退燒檢查', !data.popularAt ? '尚未啟用' : lowDays >= 3 ? `${lowDays} 天` : `${lowDays} / 3 天`, !data.popularAt ? `${hotRule()}後啟用` : data.pendingRecheck ? '缺測中斷後重新累積' : lowRule()),
      );
      range.textContent = `全期判定：${at(data.firstHour)} — ${at(data.lastHour)} · 有效 ${data.coverage.valid} / ${data.coverage.total} 個時段 · 可判定 ${data.coverage.completeDays} / ${data.coverage.totalDays} 天 · 台灣時間`;
      method.textContent = usesHits()
        ? '缺測可能讓達標次數跨過門檻時，當日暫不計入。缺測超過 12 小時會中斷計數。'
        : `以台灣時間統計。日期結束且至少有 12 小時有效量測，才計算逐時總觀眾的每日中位數。首次達 ${threshold}後開始檢查退燒。連續 3 個有效日低於 ${threshold}即確認退燒，缺測超過 12 小時會中斷計數。後續有效日回到門檻時解除退燒狀態。`;
      renderEvidence(); renderDecline(); renderEvents(); draw();
      onSummary({ data, status: displayStatus, label: status.textContent,
        releaseDate: releaseDate(), historical, scope: context.scope });
    } catch (error) { failure(error); }
  }
  function failure(error) {
    data = null; rows = null; geometry = null; loadedKey = ''; decline.replaceChildren();
    root.dataset.cooldownStatus = 'unavailable'; root.setAttribute('aria-busy', 'false'); retry.disabled = false;
    status.textContent = '全期資料暫時無法讀取'; stateDetail.textContent = '請按「重新讀取全期資料」再試。原本趨勢圖與明細仍可繼續操作。';
    summary.replaceChildren(); evidence.replaceChildren(); releaseSummary.replaceChildren(); chart.replaceChildren(el('p', 'tw-cooldown-empty', '目前沒有可用的退潮判定結果。')); events.replaceChildren(); reader.hidden = true; legend.hidden = true; method.textContent = '';
    onSummary({ status: 'unavailable', label: '全期摘要暫時無法讀取，請到判定依據重新載入。', scope: context.scope });
    console.warn('Unable to display Twitch cooldown analysis:', error);
  }
  async function load(force = false) {
    const token = ++request;
    const key = `${context.gameName || ''}|${context.region || ''}|${context.lastHour || ''}|${context.generatedAt || ''}`;
    root.hidden = false;
    if (!force && rows && loadedKey === key) { render(); return; }
    data = null; rows = null; geometry = null; loadedKey = ''; decline.replaceChildren();
    root.setAttribute('aria-busy', 'true'); root.dataset.cooldownStatus = 'loading'; retry.disabled = true;
    status.textContent = '正在讀取全期觀測…'; status.dataset.tone = 'neutral'; stateDetail.textContent = '整理這款遊戲的全部歷史，找出連續低熱度起始日與退燒確認時間。';
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
    update(nextContext = {}) {
      context = nextContext;
      const threshold = thresholdLabel();
      intro.textContent = `曾有熱度後，連續 3 個可判定日符合「${lowRule()}」，即確認退燒。`;
      rule.textContent = usesHits() ? `單日熱度 · ${hotRule()}` : `每日中位數門檻 ${threshold} · 連續低於門檻 3 天 · 每日至少 12 小時量測`;
      legend.textContent = `淡紫線 逐時總觀眾　｜　紫線 每日中位數　｜　橘色虛線 ${threshold}門檻　｜　橘色區間 已確認的低熱度觀測`;
      load();
    },
    hide() { request++; root.hidden = true; },
    destroy() { disposed = true; request++; listeners.abort(); observer?.disconnect(); root.replaceChildren(); root.hidden = true; },
  };
}




