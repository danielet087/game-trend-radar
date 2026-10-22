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
const percent = value => finite(value) ? `${fmt(value * 100)}%` : '—';
const statuses = {
  insufficient: '資料不足，尚無法判定', watching: '尚未符合退潮條件', suspected: '疑似退潮，等待確認',
  cooled: '已持續退潮', recovering: '出現回升，持續觀察', recovered: '退潮後已回升', gap: '最新資料不足，狀態待確認',
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
  let dropFraction = .5, confirmHours = 24, selected = 0, geometry = null;
  root.classList.add('tw-cooldown'); root.setAttribute('aria-labelledby', 'cooldownTitle');
  const head = el('div', 'tw-workspace-head'), heading = el('div');
  const section = el('span', 'tw-section-no', '02'); section.setAttribute('aria-hidden', 'true');
  const title = el('h2', '', '熱度退潮時間點'); title.id = 'cooldownTitle';
  heading.append(section, title); head.append(heading, el('span', 'tw-cooldown-scope', '全期判定'));
  const intro = el('p', 'tw-cooldown-intro', '找出高峰後持續降溫的起點，並確認後續是否回升。此圖使用全部已保存紀錄，不受上方日期範圍裁切。');
  const range = el('p', 'tw-cooldown-range'); range.id = 'cooldownRange';
  const releaseSummary = el('div', 'tw-cooldown-release'); releaseSummary.id = 'cooldownReleaseSummary';
  const controls = el('div', 'tw-cooldown-controls');
  const dropLabel = el('label', '', '相對高峰降幅'), drop = el('select'); drop.name = 'cooldownDrop'; drop.id = 'cooldownDrop';
  for (const [value, label] of [['0.3', '下降 30%'], ['0.5', '下降 50%（預設）'], ['0.7', '下降 70%']]) {
    const option = el('option', '', label); option.value = value; drop.append(option);
  }
  drop.value = '0.5'; dropLabel.append(drop);
  const holdLabel = el('label', '', '低熱度持續時間'), hold = el('select'); hold.name = 'cooldownHold'; hold.id = 'cooldownHold';
  for (const hours of [24, 48]) { const option = el('option', '', `滿 ${hours} 小時`); option.value = String(hours); hold.append(option); }
  holdLabel.append(hold);
  const retry = el('button', 'tw-cooldown-retry', '重新讀取全期資料'); retry.type = 'button';
  controls.append(dropLabel, holdLabel, retry);
  const stateLine = el('div', 'tw-cooldown-state-line');
  const status = el('strong', 'tw-cooldown-status'); status.id = 'cooldownStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const stateDetail = el('p', 'tw-cooldown-state-detail'); stateDetail.id = 'cooldownStateDetail'; stateLine.append(status, stateDetail);
  const summary = el('div', 'tw-cooldown-summary'); summary.id = 'cooldownSummary';
  const figure = el('figure', 'tw-cooldown-figure'), chart = el('div', 'tw-cooldown-chart'); chart.id = 'cooldownChart';
  const legend = el('figcaption', 'tw-cooldown-legend', '淡紫線：逐時總觀眾　｜　紫線：6 小時中位數　｜　橘色虛線：退潮門檻　｜　橘色區間：已確認的退潮觀測');
  figure.append(chart, legend);
  const reader = el('div', 'tw-cooldown-reader'), readerLabel = el('label', '', '查看全期觀測與事件'); readerLabel.htmlFor = 'cooldownScrubber';
  const scrubber = el('input'); scrubber.type = 'range'; scrubber.id = 'cooldownScrubber'; scrubber.min = '0'; scrubber.step = '1';
  const readout = el('output', 'tw-cooldown-readout'); readout.id = 'cooldownReadout'; readout.setAttribute('for', 'cooldownScrubber');
  reader.append(readerLabel, scrubber, readout);
  const events = el('div', 'tw-cooldown-events'); events.id = 'cooldownEvents';
  const method = el('p', 'tw-cooldown-method'); method.id = 'cooldownMethod';
  root.replaceChildren(head, intro, range, releaseSummary, controls, stateLine, summary, figure, reader, events, method);

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
    const finding = firstDay > 0 ? episode?.confirmedAt ? '觀測到持續退潮' : '觀測到疑似退潮' : episode?.confirmedAt ? '開始退潮' : '出現疑似退潮';
    releaseSummary.append(el('strong', '', point ? `${label}${finding}` : '以上市日 Day 0 對齊觀測'));
    releaseSummary.append(el('p', '', `上市日 ${date.replaceAll('-', '/')}（${context.releaseReference.source || '已保存的上市日期'}）`));
    if (firstDay > 0) releaseSummary.append(el('p', 'tw-cooldown-coverage-warning', `上市後第 ${firstDay} 天才開始觀測，無法確認上市至收集前的熱度持續時間。`));
  }

  function card(label, value, hint) {
    const result = el('div', 'tw-cooldown-stat'); result.append(el('span', '', label), el('strong', '', value), el('small', '', hint || '')); return result;
  }
  function eventEntries() {
    const result = [];
    for (const [index, episode] of (data?.episodes || []).entries()) {
      result.push({ at: episode.candidateAt, label: `第 ${index + 1} 波退潮起點`, type: 'candidate' },
        { at: episode.confirmedAt, label: `第 ${index + 1} 波持續確認`, type: 'confirmed' });
      if (episode.recoveryAt) result.push({ at: episode.recoveryAt, label: episode.recoveryConfirmedAt ? '回升起點' : '疑似回升起點', type: 'recovery' });
      if (episode.recoveryConfirmedAt) result.push({ at: episode.recoveryConfirmedAt, label: '回升確認', type: 'recovered' });
      if (episode.interruptedAt) result.push({ at: episode.interruptedAt, label: '觀測中斷，需重新確認', type: 'gap' });
    }
    if (data?.candidate) result.push({ at: data.candidate.candidateAt, label: '疑似退潮起點（尚未確認）', type: 'candidate' });
    return result.filter(item => item.at).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }
  function select(index) {
    const points = data?.points || [];
    selected = Math.max(0, Math.min(points.length - 1, index)); scrubber.value = String(selected);
    const point = points[selected];
    const labels = point ? eventEntries().filter(item => item.at === point.hour).map(item => item.label) : [];
    const text = point ? `${at(point.hour)}${dayHint(point.hour) ? ` · ${dayHint(point.hour)}` : ''} · 總觀眾 ${fmt(point.raw)} 人 · 6 小時中位數 ${fmt(point.smooth)} 人 · 退潮門檻 ${fmt(point.threshold)} 人${labels.length ? ` · ${labels.join('、')}` : ''}` : '沒有可查看的觀測。';
    readout.textContent = text; scrubber.setAttribute('aria-valuetext', text);
    if (geometry && point) {
      geometry.cursor.setAttribute('x1', geometry.x(Date.parse(point.hour))); geometry.cursor.setAttribute('x2', geometry.x(Date.parse(point.hour)));
      geometry.cursor.setAttribute('visibility', 'visible');
      for (const dot of geometry.marks) dot.node.setAttribute('data-selected', String(dot.index === selected));
    }
  }
  function chooseAt(hour) {
    const target = Date.parse(hour), points = data?.points || [];
    if (!Number.isFinite(target) || !points.length) return;
    let closest = 0;
    points.forEach((point, index) => { if (Math.abs(Date.parse(point.hour) - target) < Math.abs(Date.parse(points[closest].hour) - target)) closest = index; });
    select(closest);
  }
  on(scrubber, 'input', () => select(Number(scrubber.value)));
  on(chart, 'click', event => { const marker = event.target?.closest?.('[data-cooldown-hour]'); if (marker) chooseAt(marker.getAttribute('data-cooldown-hour')); });
  on(chart, 'mouseover', event => { const marker = event.target?.closest?.('[data-cooldown-hour]'); if (marker) chooseAt(marker.getAttribute('data-cooldown-hour')); });
  on(events, 'click', event => { const button = event.target?.closest?.('button[data-cooldown-hour]'); if (button) chooseAt(button.getAttribute('data-cooldown-hour')); });
  on(drop, 'change', () => { dropFraction = Number(drop.value); render(); });
  on(hold, 'change', () => { confirmHours = Number(hold.value); render(); });
  on(retry, 'click', () => load(true));

  function path(points, key, x, y) {
    let output = '', previous = null;
    for (const point of points) {
      const value = point[key], time = Date.parse(point.hour);
      if (!finite(value)) { previous = null; continue; }
      output += `${previous !== null && time - previous === HOUR ? ' L' : ' M'}${x(time)} ${y(value)}`; previous = time;
    }
    return output;
  }
  function draw() {
    const points = data?.points || [], valid = points.filter(point => finite(point.raw)); geometry = null;
    if (!valid.length) { chart.replaceChildren(el('p', 'tw-cooldown-empty', '目前沒有有效觀眾資料可顯示。')); reader.hidden = true; legend.hidden = true; return; }
    reader.hidden = false; legend.hidden = false;
    const w = Math.max(300, Math.min(1100, (root.clientWidth || 920) - 50)), h = 350;
    const left = w < 500 ? 52 : 68, right = 22, top = 40, bottom = 55;
    const start = Date.parse(points[0].hour), end = Date.parse(points.at(-1).hour), high = Math.max(1, ...valid.map(point => point.raw)) * 1.08;
    const x = value => left + (value - start) / Math.max(HOUR, end - start) * (w - left - right);
    const y = value => top + (h - top - bottom) * (1 - value / high);
    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-labelledby': 'cooldownSvgTitle cooldownSvgDesc' });
    svg.append(svgEl('title', { id: 'cooldownSvgTitle' }, `${context.gameName || '遊戲'}的全期熱度退潮觀測`),
      svgEl('desc', { id: 'cooldownSvgDesc' }, '淡線為逐時總觀眾，紫線為六小時中位數，橘色虛線為相對高峰的退潮門檻。退潮起點和持續確認時間分開標示；可使用下方滑桿或事件按鈕查看。'));
    for (const episode of data.episodes) {
      const from = Date.parse(episode.candidateAt), to = Date.parse(episode.recoveryConfirmedAt || episode.interruptedAt || points.at(-1).hour);
      if (Number.isFinite(from) && Number.isFinite(to)) svg.append(svgEl('rect', { x: x(from), y: top, width: Math.max(1, x(to) - x(from)), height: h - top - bottom, class: 'tw-cooldown-band' }));
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
    for (const [key, className] of [['raw', 'tw-cooldown-raw'], ['smooth', 'tw-cooldown-smooth'], ['threshold', 'tw-cooldown-threshold']]) {
      const d = path(points, key, x, y); if (d) svg.append(svgEl('path', { d, class: className, fill: 'none' }));
    }
    const marks = [];
    points.forEach((point, index) => {
      if (!finite(point.smooth)) return;
      const dot = svgEl('circle', { cx: x(Date.parse(point.hour)), cy: y(point.smooth), r: 2.5, class: 'tw-cooldown-dot', 'data-cooldown-hour': point.hour });
      dot.append(svgEl('title', {}, `${at(point.hour)}${dayHint(point.hour) ? ` · ${dayHint(point.hour)}` : ''} · 6 小時中位數 ${fmt(point.smooth)} 人`)); svg.append(dot); marks.push({ node: dot, index });
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
    scrubber.max = String(points.length - 1); select(Math.min(selected, points.length - 1));
  }
  function isStale() {
    if (context.trackingStatus !== 'active') return false;
    const last = Date.parse(context.lastHour || data?.lastHour), latest = Date.parse(context.latestHour);
    return !Number.isFinite(last) || Number.isFinite(latest) && latest - last > 3 * HOUR || Date.now() - last > 3 * HOUR;
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
    events.append(list, el('p', 'tw-cooldown-event-hint', '點選事件可在圖表定位。起點是平滑熱度首次跨線的時間；確認時間是後續資料滿足持續條件的時間。'));
  }
  function render() {
    if (disposed || root.hidden || !rows) return;
    try {
      data = analyzeCooldown(rows, { dropFraction, confirmHours });
      const stale = isStale(), displayStatus = stale ? 'stale' : data.status;
      root.dataset.cooldownStatus = displayStatus; root.dataset.cooldownModelStatus = data.status;
      status.textContent = stale ? '最新狀態待確認' : statuses[data.status] || statuses.insufficient;
      status.dataset.tone = ['cooled', 'suspected'].includes(displayStatus) ? 'cooling' : ['recovered', 'recovering'].includes(displayStatus) ? 'recovery' : 'neutral';
      const historical = context.trackingStatus === 'ended';
      const prefix = historical ? `歷史判定，截至 ${at(context.lastHour || data.lastHour)}。` : `追蹤中，截至 ${at(context.lastHour || data.lastHour)}。`;
      let detail = '';
      if (stale) detail = '近期觀測尚未更新，保留既有事件；目前是否仍在退潮需等待新資料。';
      else if (data.status === 'suspected') detail = `已跨過退潮門檻，尚未持續滿 ${confirmHours} 小時。${historical ? '已保存的後續資料不足，暫不確認。' : '持續收集後再確認。'}`;
      else if (data.status === 'cooled') detail = `平滑熱度下降至少 ${percent(dropFraction)}，並持續滿 ${confirmHours} 小時；後續仍可能回升。`;
      else if (data.status === 'recovering') detail = '平滑熱度已回到回升門檻，等待持續滿 12 小時確認。';
      else if (data.status === 'recovered') detail = '先前退潮後，平滑熱度已持續回升，請查看圖上的回升標記。';
      else if (data.status === 'gap') detail = '尾段資料不連續，需重新累積有效觀測；中斷不視為熱度歸零。';
      else if (data.status === 'insufficient') detail = '需要完整連續 6 小時觀眾資料，並建立正值的平滑高峰。';
      else detail = '尚未觀察到符合目前降幅與持續時間的退潮。';
      stateDetail.textContent = `${prefix} ${detail}`;
      const episode = data.candidate || data.episodes.at(-1);
      renderRelease(episode);
      summary.replaceChildren(
        card(episode?.confirmedAt ? '最近退潮起點' : '疑似退潮起點', episode?.candidateAt ? at(episode.candidateAt) : '尚未出現', episode?.candidateAt ? `${dayHint(episode.candidateAt) ? `${dayHint(episode.candidateAt)} · ` : ''}6 小時平滑熱度首次跨線` : '依目前門檻觀察'),
        card('持續確認時間', episode?.confirmedAt ? at(episode.confirmedAt) : '尚未確認', episode?.confirmedAt ? `${dayHint(episode.confirmedAt) ? `${dayHint(episode.confirmedAt)} · ` : ''}起點後持續滿 ${confirmHours} 小時` : `需要起點後的 ${confirmHours} 小時資料`),
        card('最新 6 小時平滑熱度', fmt(data.latest?.smooth), '人 · 完整連續 6 小時中位數'),
        card('相對參考高峰降幅', percent(data.latest?.declineFraction), `參考平滑高峰 ${fmt(data.latest?.baseline)} 人`),
      );
      range.textContent = `全期判定：${at(data.firstHour)} — ${at(data.lastHour)} · 有效 ${data.coverage.valid} / ${data.coverage.total} 個時段 · 台灣時間`;
      method.textContent = `規則：完整 6 小時總觀眾中位數，自當時已知高峰下降 ${percent(dropFraction)} 並連續維持滿 ${confirmHours} 小時才確認；回到參考高峰的 ${percent(data.settings.recoveryFraction)} 並持續滿 12 小時則確認回升。這是依目前規則推估的平滑熱度起點，會有平滑延遲，不代表永久過氣或銷量變化。`;
      renderEvents(); draw();
    } catch (error) { failure(error); }
  }
  function failure(error) {
    data = null; rows = null; geometry = null; loadedKey = '';
    root.dataset.cooldownStatus = 'unavailable'; root.setAttribute('aria-busy', 'false'); retry.disabled = false;
    status.textContent = '全期資料暫時無法讀取'; stateDetail.textContent = '請按「重新讀取全期資料」再試。原本趨勢圖與明細仍可繼續操作。';
    summary.replaceChildren(); releaseSummary.replaceChildren(); chart.replaceChildren(el('p', 'tw-cooldown-empty', '目前沒有可用的退潮判定結果。')); events.replaceChildren(); reader.hidden = true; legend.hidden = true; method.textContent = '';
    console.warn('Unable to display Twitch cooldown analysis:', error);
  }
  async function load(force = false) {
    const token = ++request;
    const key = `${context.gameName || ''}|${context.lastHour || ''}|${context.generatedAt || ''}`;
    root.hidden = false;
    if (!force && rows && loadedKey === key) { render(); return; }
    data = null; rows = null; geometry = null; loadedKey = '';
    root.setAttribute('aria-busy', 'true'); root.dataset.cooldownStatus = 'loading'; retry.disabled = true;
    status.textContent = '正在讀取全期觀測…'; status.dataset.tone = 'neutral'; stateDetail.textContent = '整理這款遊戲的全部歷史，找出退潮起點與持續確認時間。';
    range.textContent = '全期判定，不受上方日期範圍裁切。'; summary.replaceChildren(); releaseSummary.replaceChildren(); chart.replaceChildren(); events.replaceChildren(); reader.hidden = true; legend.hidden = true; method.textContent = '';
    try {
      const next = await context.loadHistory();
      if (disposed || token !== request) return;
      rows = Array.isArray(next) ? next : []; loadedKey = key; selected = Math.max(0, rows.length - 1);
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
