import { analyzeStatistics } from './statistics-model.js';

const NS = 'http://www.w3.org/2000/svg';
const modes = {
  distribution: '常態熱度', trend: '熱度動能', persistence: '熱度延續',
  supply: '觀看與開台', hourly: '熱門時段',
};
const metrics = { viewers: '總觀眾', streamers: '開台數', median: '合格頻道中位數' };
const units = { viewers: '人', streamers: '台', median: '人／台' };
const number = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });
const date = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const fmt = value => typeof value === 'number' && Number.isFinite(value) ? number.format(value) : '—';
const pct = value => typeof value === 'number' && Number.isFinite(value) ? `${fmt(value * 100)}%` : '—';
const at = hour => hour && Number.isFinite(Date.parse(hour)) ? date.format(new Date(hour)) : '—';
const compact = value => value >= 10000 ? `${fmt(value / 10000)}萬` : fmt(value);
const el = (tag, className, text) => {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text != null) result.textContent = text;
  return result;
};
function svgEl(tag, attrs = {}, text) {
  const result = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) result.setAttribute(key, String(value));
  if (text != null) result.textContent = text;
  return result;
}

export function createStatistics(root) {
  if (!root) return { update() {}, hide() {}, destroy() {} };
  const events = new AbortController();
  const on = (target, type, listener) => target.addEventListener(type, listener, { signal: events.signal });
  let rows = [], gameName = '', mode = 'distribution', metric = 'viewers', threshold = 5000;
  let selected = 0, points = [], marks = [], width = 0, disposed = false;
  root.classList.add('tw-statistics');
  root.setAttribute('aria-labelledby', 'statisticsTitle');
  const head = el('div', 'tw-workspace-head');
  const heading = el('div');
  const sectionNumber = el('span', 'tw-section-no', '03'); sectionNumber.setAttribute('aria-hidden', 'true');
  const title = el('h2', '', '統計分析'); title.id = 'statisticsTitle';
  heading.append(sectionNumber, title); head.append(heading, el('span', 'tw-statistics-independent', '獨立圖表'));
  const intro = el('p', 'tw-statistics-intro', '從常態、趨勢與時段分布，讀懂這款遊戲的歷史熱度。上方日期範圍會同步套用。');
  const range = el('p', 'tw-statistics-range'); range.id = 'statisticsRange';
  const tabs = el('div', 'tw-statistics-modes'); tabs.id = 'statisticsModes'; tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', '統計分析方式');
  const buttons = Object.entries(modes).map(([key, label]) => {
    const button = el('button', '', label); button.type = 'button'; button.dataset.statisticsMode = key;
    button.setAttribute('aria-pressed', String(key === mode));
    on(button, 'click', () => { mode = key; render(); }); tabs.append(button); return button;
  });
  const controls = el('div', 'tw-statistics-controls');
  const metricLabel = el('label', '', '統計指標');
  const metricSelect = el('select'); metricSelect.id = 'statisticsMetric'; metricSelect.name = 'statisticsMetric';
  for (const [value, label] of Object.entries(metrics)) { const option = el('option', '', label); option.value = value; metricSelect.append(option); }
  metricLabel.append(metricSelect);
  on(metricSelect, 'change', () => { metric = metricSelect.value; render(); });
  const thresholdForm = el('form', 'tw-statistics-threshold'); thresholdForm.id = 'statisticsThresholdForm'; thresholdForm.hidden = true;
  const thresholdLabel = el('label', '', '觀眾門檻（人）');
  const thresholdInput = el('input'); thresholdInput.id = 'statisticsThreshold'; thresholdInput.name = 'statisticsThreshold'; thresholdInput.type = 'number';
  thresholdInput.min = '0'; thresholdInput.max = '1000000000'; thresholdInput.step = '1'; thresholdInput.required = true; thresholdInput.value = '5000';
  const apply = el('button', '', '套用門檻'); apply.type = 'submit'; thresholdLabel.append(thresholdInput); thresholdForm.append(thresholdLabel, apply);
  on(thresholdForm, 'submit', event => {
    event.preventDefault(); if (!thresholdForm.reportValidity()) return;
    const next = Number(thresholdInput.value);
    if (Number.isFinite(next) && next >= 0) { threshold = next; render(); }
  });
  const fixedMetric = el('p', 'tw-statistics-fixed'); fixedMetric.hidden = true;
  controls.append(metricLabel, thresholdForm, fixedMetric);
  const summary = el('div', 'tw-statistics-summary'); summary.id = 'statisticsSummary';
  const status = el('p', 'tw-statistics-status'); status.id = 'statisticsStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const figure = el('figure', 'tw-statistics-figure');
  const chart = el('div', 'tw-statistics-chart'); chart.id = 'statisticsChart';
  for (const type of ['mouseover', 'click']) on(chart, type, event => {
    const mark = event.target?.closest?.('[data-statistics-point]');
    if (mark && chart.contains(mark)) select(Number(mark.getAttribute('data-statistics-point')));
  });
  const legend = el('figcaption', 'tw-statistics-legend');
  figure.append(chart, legend);
  const reader = el('div', 'tw-statistics-reader');
  const readerLabel = el('label', '', '查看統計資料點'); readerLabel.htmlFor = 'statisticsScrubber';
  const scrubber = el('input'); scrubber.id = 'statisticsScrubber'; scrubber.type = 'range'; scrubber.min = '0'; scrubber.step = '1';
  const readout = el('output', 'tw-statistics-readout'); readout.id = 'statisticsReadout'; readout.setAttribute('for', 'statisticsScrubber');
  reader.append(readerLabel, scrubber, readout); on(scrubber, 'input', () => select(Number(scrubber.value)));
  const method = el('p', 'tw-statistics-method'); method.id = 'statisticsMethod';
  const footnote = el('p', 'tw-statistics-footnote', '統計僅描述已保存的逐時觀測。缺測、未列入與指標待補不當成 0；樣本少時不推論最佳開台時間。現有歷史未保存逐台分布，因此不推算大台占比或個人預期觀眾。');
  root.replaceChildren(head, intro, range, tabs, controls, summary, status, figure, reader, method, footnote);

  function card(label, value, detail = '') {
    const card = el('div', 'tw-statistics-stat'); card.append(el('span', '', label), el('strong', '', value), el('small', '', detail)); return card;
  }
  function cards(values) { summary.replaceChildren(...values.map(value => card(...value))); }
  function select(index) {
    selected = Math.max(0, Math.min(points.length - 1, index));
    scrubber.value = String(selected); readout.textContent = points[selected]?.text || '沒有可查看的有效資料點。';
    scrubber.setAttribute('aria-valuetext', points[selected]?.text || '沒有資料');
    for (const mark of marks) mark.node.setAttribute('data-selected', String(mark.index === selected));
  }
  function point(node, text, index) {
    node.append(svgEl('title', {}, text)); node.setAttribute('data-statistics-point', String(index));
    marks.push({ node, index });
  }
  function base({ maxX = 1, minX = 0, maxY = 1, xLabel, yLabel, ticks, tickFormat = compact, title: chartTitle, description }) {
    const w = Math.max(300, Math.min(1100, (root.clientWidth || 920) - 50)), h = 320;
    const left = w < 500 ? 56 : 70, right = 24, top = 26, bottom = 60;
    const plotWidth = w - left - right, plotHeight = h - top - bottom;
    const x = value => left + (value - minX) / (maxX > minX ? maxX - minX : 1) * plotWidth;
    const upper = Math.max(1, maxY) * 1.08;
    const y = value => top + plotHeight - value / upper * plotHeight;
    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-labelledby': 'statisticsSvgTitle statisticsSvgDesc', preserveAspectRatio: 'xMidYMid meet' });
    const name = svgEl('title', { id: 'statisticsSvgTitle' }, `${gameName} · ${chartTitle}`);
    const descriptionNode = svgEl('desc', { id: 'statisticsSvgDesc' }, description);
    svg.append(name, descriptionNode);
    for (let i = 0; i <= 4; i++) {
      const value = upper * i / 4;
      svg.append(svgEl('line', { x1: left, x2: w - right, y1: y(value), y2: y(value), class: 'tw-statistics-grid' }),
        svgEl('text', { x: left - 9, y: y(value) + 4, 'text-anchor': 'end', class: 'tw-statistics-axis' }, compact(value)));
    }
    const xTicks = ticks || [minX, minX + (maxX - minX) / 2, maxX];
    xTicks.forEach((tick, index) => {
      svg.append(svgEl('text', { x: x(tick), y: h - bottom + 23, 'text-anchor': index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle', class: 'tw-statistics-axis' }, tickFormat(tick)));
    });
    svg.append(svgEl('text', { x: left, y: 13, class: 'tw-statistics-axis-label' }, yLabel),
      svgEl('text', { x: left + plotWidth / 2, y: h - 9, 'text-anchor': 'middle', class: 'tw-statistics-axis-label' }, xLabel));
    chart.replaceChildren(svg);
    return { svg, x, y, bottom: y(0), plotWidth, upper, minX, maxX };
  }
  function empty(text) { chart.replaceChildren(el('p', 'tw-statistics-empty', text)); legend.textContent = ''; }
  function line(svg, list, x, y, key, className) {
    let d = '', previous = false;
    list.forEach((p, index) => {
      const value = p[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) { previous = false; return; }
      d += `${previous ? ' L' : ' M'}${x(index)} ${y(value)}`; previous = true;
    });
    if (d) svg.append(svgEl('path', { d, class: className, fill: 'none' }));
  }
  function distribution(data) {
    const d = data.distribution, unit = units[metric];
    cards([['時段中位數', fmt(d.median), unit], ['中間 50% 範圍', `${fmt(d.q1)}～${fmt(d.q3)}`, unit], ['時段平均', fmt(d.mean), unit], ['區間最高', fmt(d.max), unit]]);
    status.textContent = `有效 ${fmt(d.count)} / ${fmt(d.total)} 個時段 · 涵蓋率 ${pct(d.coverage)}`;
    method.textContent = '將各時段的數值由小到大整理，呈現常見水準與分布。紫色虛線為時段中位數，淡紫區域是第 25～75 百分位；此中位數與每小時的合格頻道中位數不同。';
    if (!d.count) return empty('所選區間沒有這項指標的有效紀錄。');
    const min = d.min, max = d.max === min ? min + Math.max(1, Math.abs(min) * .1) : d.max;
    const bins = Math.min(12, Math.max(1, Math.ceil(Math.sqrt(d.count))));
    const size = (max - min) / bins, values = Array.from({ length: bins }, (_, index) => ({ start: min + size * index, end: min + size * (index + 1), count: 0 }));
    for (const value of d.values) values[Math.min(bins - 1, Math.floor((value - min) / size))].count++;
    const b = base({ minX: min, maxX: max, maxY: Math.max(...values.map(v => v.count)), xLabel: `${metrics[metric]}（${unit}）`, yLabel: '時段數', title: '常態熱度分布', description: `有效${d.count}個時段，時段中位數${fmt(d.median)}，中間50%範圍${fmt(d.q1)}至${fmt(d.q3)}。可用下方資料點滑桿查看各組。` });
    b.svg.append(svgEl('rect', { x: b.x(d.q1), y: 26, width: Math.max(2, b.x(d.q3) - b.x(d.q1)), height: b.bottom - 26, class: 'tw-statistics-band' }));
    points = values.map(v => ({ text: `${fmt(v.start)}～${fmt(v.end)} ${unit}：${v.count} 個時段` }));
    values.forEach((v, index) => {
      const bar = svgEl('rect', { x: b.x(v.start) + 1, y: b.y(v.count), width: Math.max(1, b.x(v.end) - b.x(v.start) - 2), height: b.bottom - b.y(v.count), rx: 3, class: 'tw-statistics-bar' });
      point(bar, points[index].text, index); b.svg.append(bar);
    });
    b.svg.append(svgEl('line', { x1: b.x(d.median), x2: b.x(d.median), y1: 26, y2: b.bottom, class: 'tw-statistics-reference' }));
    legend.textContent = '長條：各數值區間的時段數　｜　虛線：時段中位數　｜　淡紫底：中間 50% 範圍';
  }
  function trend(data) {
    const t = data.trend, unit = units[metric], raw = t.rawPoints;
    const change = t.comparable && t.change != null ? `${t.change > 0 ? '+' : ''}${fmt(t.change)}%` : '—';
    cards([['最近 24 小時中位數', fmt(t.current.median), `${t.current.count} / 24 有效時段 · ${unit}`], ['前 24 小時中位數', fmt(t.previous.median), `${t.previous.count} / 24 有效時段 · ${unit}`], ['前後期變化', change, t.comparable ? '同長度的兩個 24 小時' : '資料不足時不比較'], ['有效時段', `${data.distribution.count} / ${data.distribution.total}`, metrics[metric]]]);
    const rollingCount = t.points.filter(p => p.value != null).length;
    status.textContent = t.comparable && t.change != null ? '兩個 24 小時區段皆完整，可比較熱度變化。' : t.reason;
    if (!rollingCount) status.textContent += ' 目前沒有完整連續 24 小時可畫出平滑趨勢。';
    method.textContent = '淡線為逐時原值，實線為每個時點向前 24 小時的移動中位數。只有完整連續 24 小時才計算，不跨越缺測；前後期百分比以所選範圍末端兩個完整 24 小時比較。';
    if (!data.distribution.count) return empty('所選區間沒有這項指標的有效紀錄。');
    const list = raw.map((p, index) => ({ hour: p.hour, raw: p.value, rolling: t.points[index]?.value ?? null }));
    const b = base({ maxX: Math.max(1, list.length - 1), maxY: data.distribution.max, xLabel: '觀測時間（台灣）', yLabel: `${metrics[metric]}（${unit}）`, tickFormat: value => at(list[Math.round(value)]?.hour), title: '熱度動能', description: `逐時原值與24小時移動中位數。${status.textContent} 可用下方資料點滑桿查看時間與數值。` });
    line(b.svg, list, b.x, b.y, 'raw', 'tw-statistics-raw-line'); line(b.svg, list, b.x, b.y, 'rolling', 'tw-statistics-main-line');
    points = list.map(p => ({ text: `${at(p.hour)} · 原值 ${fmt(p.raw)} ${unit} · 24 小時中位數 ${fmt(p.rolling)} ${unit}` }));
    list.forEach((p, index) => {
      const value = p.rolling ?? p.raw; if (value == null) return;
      const dot = svgEl('circle', { cx: b.x(index), cy: b.y(value), r: p.rolling == null ? 2 : 3, class: p.rolling == null ? 'tw-statistics-raw-dot' : 'tw-statistics-dot' });
      point(dot, points[index].text, index); b.svg.append(dot);
    });
    legend.textContent = '淡線：逐時原值　｜　紫線：完整 24 小時移動中位數　｜　空白：沒有可用資料';
  }
  function persistence(data) {
    const p = data.persistence;
    cards([['達標時段', fmt(p.count), `總觀眾 ≥ ${fmt(p.threshold)} 人`], ['有效時段達標比例', pct(p.ratio), `${p.total} 個有效時段為分母`], ['最長連續達標', `${fmt(p.longestHours)} 小時`, p.longestHours ? `${at(p.longestStart)} 起` : '尚無連續達標時段'], ['觀眾資料涵蓋', `${p.total} / ${p.totalSlots}`, '所選區間的有效時段']]);
    status.textContent = p.total ? `已比較 ${p.total} 個有效觀眾時段；缺測會中斷連續達標計數。` : '沒有有效觀眾資料，無法計算達標比例。';
    method.textContent = '依自訂門檻計算達標時段比例與最長連續時段。每筆代表一次逐時觀測，連續 3 個達標時段顯示為 3 小時；不推算兩次觀測之間的實際觀看變化。';
    if (!p.total) return empty('所選區間沒有有效觀眾紀錄。');
    const b = base({ maxX: Math.max(1, p.points.length - 1), maxY: Math.max(p.threshold, ...p.points.map(v => v.value ?? 0)), xLabel: '觀測時間（台灣）', yLabel: '總觀眾（人）', tickFormat: value => at(p.points[Math.round(value)]?.hour), title: '熱度延續', description: `門檻${fmt(p.threshold)}人，${p.count}個時段達標，最長連續${p.longestHours}小時。可用下方滑桿查看各時段。` });
    line(b.svg, p.points, b.x, b.y, 'value', 'tw-statistics-main-line');
    b.svg.append(svgEl('line', { x1: b.x(0), x2: b.x(Math.max(1, p.points.length - 1)), y1: b.y(p.threshold), y2: b.y(p.threshold), class: 'tw-statistics-threshold-line' }));
    points = p.points.map(v => ({ text: `${at(v.hour)} · ${fmt(v.value)} 人 · ${v.value == null ? '無有效紀錄' : v.above ? '達標' : '未達標'}` }));
    p.points.forEach((v, index) => {
      if (v.value == null) return;
      const dot = svgEl('circle', { cx: b.x(index), cy: b.y(v.value), r: v.above ? 3.5 : 2, class: v.above ? 'tw-statistics-warm-dot' : 'tw-statistics-dot' });
      point(dot, points[index].text, index); b.svg.append(dot);
    });
    legend.textContent = `紫線：總觀眾　｜　橘色虛線：${fmt(p.threshold)} 人門檻　｜　橘點：達標時段`;
  }
  function supply(data) {
    const s = data.supply, valid = s.points.filter(p => p.viewers != null && p.streamers != null);
    cards([['時段總觀眾中位數', fmt(s.viewersMedian), '人 · 同時有兩項資料的時段'], ['時段開台數中位數', fmt(s.streamersMedian), '台 · 同時有兩項資料的時段'], ['每台平均的時段中位數', fmt(s.averageMedian), '人／台 · 排除開台為 0 的比值'], ['配對有效時段', `${s.pairedCount} / ${data.distribution.total}`, '同一時段的觀眾與開台數']]);
    status.textContent = s.pairedCount ? `每個圓點代表一個觀測時段，共 ${s.pairedCount} 個配對。` : '所選區間沒有同時具備觀眾與開台數的紀錄。';
    method.textContent = '橫軸是開台數，縱軸是總觀眾；右上方代表兩者都較高。每台平均以同時段總觀眾 ÷ 開台數計算，不能視為新主播可獲得的預期觀眾，也不能據此判斷大台集中度。';
    if (!s.pairedCount) return empty('需要同一時段同時有觀眾與開台數，才能呈現關係。');
    const b = base({ maxX: Math.max(1, ...valid.map(v => v.streamers)), maxY: Math.max(...valid.map(v => v.viewers)), xLabel: '開台數（台）', yLabel: '總觀眾（人）', title: '觀看與開台散點圖', description: `${s.pairedCount}個觀測時段的總觀眾與開台數。可用下方資料點滑桿查看各時段。` });
    points = valid.map(v => ({ text: `${at(v.hour)} · ${fmt(v.streamers)} 台 · ${fmt(v.viewers)} 人 · 每台平均 ${fmt(v.average)} 人` }));
    valid.forEach((v, index) => {
      const dot = svgEl('circle', { cx: b.x(v.streamers), cy: b.y(v.viewers), r: 4, class: 'tw-statistics-scatter-dot' });
      point(dot, points[index].text, index); b.svg.append(dot);
    });
    legend.textContent = '圓點：同一時段的觀眾與開台數　｜　可拖曳下方滑桿依時間查看';
  }
  function hourly(data) {
    const h = data.hourly, valid = h.hours.filter(p => p.count > 0), max = valid.length ? Math.max(...valid.map(p => p.median)) : null;
    const high = valid.filter(p => p.median === max).map(p => String(p.hour).padStart(2, '0'));
    const highLabel = max == null ? '—' : high.length === 24 ? '各時段相同' : high.length > 3 ? `${high.slice(0, 3).join('、')} 等 ${high.length} 個時段` : `${high.join('、')} 時`;
    cards([['觀測日期數', fmt(h.observedDays), '台灣日期 · 至少有一筆有效資料'], ['有效時段', `${data.distribution.count} / ${data.distribution.total}`, metrics[metric]], ['時段中位數最高', highLabel, '僅描述目前保存區間'], ['最高時段中位數', fmt(max), units[metric]]]);
    status.textContent = !valid.length ? '沒有有效資料可整理時段分布。' : h.observedDays < 7 ? `目前僅涵蓋 ${h.observedDays} 個日期，時段樣本有限，請搭配各柱的筆數閱讀。` : `依台灣時間整理 ${h.observedDays} 個日期，各時段分別計算中位數。`;
    method.textContent = '將不同日期相同小時的有效觀測分組，計算各時段中位數。各組資料量可能不同；空白柱表示沒有有效資料，不代表觀眾為 0。此圖描述觀測期間，不能保證未來開台表現。';
    if (!valid.length) return empty('所選區間沒有這項指標的有效時段。');
    const b = base({ minX: -.5, maxX: 23.5, maxY: max, xLabel: '每日小時（台灣時間）', yLabel: `${metrics[metric]}中位數（${units[metric]}）`, ticks: [0, 6, 12, 18, 23], tickFormat: value => `${String(value).padStart(2, '0')}時`, title: '熱門時段分布', description: `依台灣時間0至23時分組，共${h.observedDays}個日期。各組有效筆數可用下方滑桿查看。` });
    points = h.hours.map(p => ({ text: `${String(p.hour).padStart(2, '0')}:00 · 中位數 ${fmt(p.median)} ${units[metric]} · ${p.count} 筆／${p.days} 個日期 · 中間 50% ${fmt(p.q1)}～${fmt(p.q3)}` }));
    for (const p of h.hours) {
      if (!p.count) continue;
      const bar = svgEl('rect', { x: b.x(p.hour - .35), y: b.y(p.median), width: Math.max(1, b.x(p.hour + .35) - b.x(p.hour - .35)), height: Math.max(1, b.bottom - b.y(p.median)), rx: 2, class: 'tw-statistics-bar' });
      point(bar, points[p.hour].text, p.hour); b.svg.append(bar);
    }
    legend.textContent = '長條：該小時有效觀測的中位數　｜　查看資料點可確認各組筆數與日期數';
  }
  function render() {
    if (disposed || root.hidden) return;
    try {
      root.dataset.mode = mode; root.dataset.statisticsMode = mode; root.dataset.metric = metric;
      for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.statisticsMode === mode));
      metricLabel.hidden = !['distribution', 'trend', 'hourly'].includes(mode);
      thresholdForm.hidden = mode !== 'persistence'; fixedMetric.hidden = !['persistence', 'supply'].includes(mode);
      fixedMetric.textContent = mode === 'persistence' ? '以全部頻道的總觀眾計算' : '以全部頻道的總觀眾與開台數配對';
      points = []; marks = [];
      const data = analyzeStatistics(rows, { metric, threshold });
      ({ distribution, trend, persistence, supply, hourly })[mode](data);
      reader.hidden = !points.length; scrubber.max = String(Math.max(0, points.length - 1));
      select(points.length - 1);
    } catch (error) {
      summary.replaceChildren(); empty('統計暫時無法計算，請重新載入或選擇其他日期。'); reader.hidden = true;
      status.textContent = '原始趨勢圖與明細仍可繼續操作。'; method.textContent = '';
      console.error('Unable to render Twitch statistics:', error);
    }
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
    const next = Math.round(entries[0]?.contentRect.width || 0);
    if (next && next !== width) { width = next; render(); }
  }) : null;
  observer?.observe(root);
  return {
    update(nextRows, context = {}) {
      rows = Array.isArray(nextRows) ? nextRows : []; gameName = context.gameName || '遊戲';
      range.textContent = context.rangeLabel || ''; root.hidden = false; render();
    },
    hide() { root.hidden = true; },
    destroy() { disposed = true; events.abort(); observer?.disconnect(); root.replaceChildren(); root.hidden = true; },
  };
}
