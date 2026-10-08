const NS = "http://www.w3.org/2000/svg";
const METRICS = {
  viewers: { label: "總觀眾", key: "viewer_count", unit: "人" },
  streamers: { label: "開台數", key: "streamer_count", unit: "台" },
  median: { label: "篩選中位數", unit: "人／台" },
};
const numeric = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const numberFormat = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 10 });
const timeOptions = { timeZone:"Asia/Taipei", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hourCycle:"h23" };
const bucketTime = new Intl.DateTimeFormat("zh-TW", timeOptions);
const snapshotTime = new Intl.DateTimeFormat("zh-TW", { ...timeOptions,second:"2-digit" });
const tickFormat = new Intl.DateTimeFormat("zh-TW", { timeZone:"Asia/Taipei", month:"numeric", day:"numeric", hour:"2-digit", hourCycle:"h23" });
const number = value => numberFormat.format(value);
const validTime = value => typeof value === "string" && Number.isFinite(Date.parse(value));
function time(value, seconds) {
  if (!validTime(value)) return "時間未提供";
  return (seconds ? snapshotTime : bucketTime).format(new Date(value));
}
function tickTime(value) {
  if (!validTime(value)) return "—";
  const parts = tickFormat.formatToParts(new Date(value));
  const get = name => parts.find(part => part.type === name)?.value || "";
  return get("hour") === "00" ? `${get("month")}/${get("day")} 00時` : `${get("hour")}時`;
}
function valueOf(row, metric) {
  if (!row || row.status !== "observed") return null;
  if (metric !== "median") return numeric(row[METRICS[metric].key]) ? row[METRICS[metric].key] : null;
  const filtered = row.filtered_audience;
  return filtered?.status === "complete" && filtered.eligible_streamer_count > 0 && filtered.unknown_follower_count === 0 && numeric(filtered.median_viewer_count)
    ? filtered.median_viewer_count : null;
}
function statusOf(row, metric) {
  if (!row || row.status === "missing") return "此時段沒有收集紀錄。";
  if (row.status === "absent") return "此時段有收集紀錄，但本遊戲未列入；不代表觀眾為 0。";
  if (metric !== "median") return valueOf(row, metric) === null ? "此時段未提供這項數據。" : "統計全部直播頻道，未套用追隨者篩選。";
  const filtered = row.filtered_audience;
  if (filtered?.status === "partial") return `追隨者數待補 ${number(filtered.unknown_follower_count || 0)} 個頻道，中位數尚未完成。`;
  if (filtered?.status === "invalid") return "此時段的篩選資料無法驗證，暫不顯示中位數。";
  if (filtered?.status !== "complete") return "此筆歷史紀錄未提供新版篩選中位數。";
  if (!filtered.eligible_streamer_count) return "此時段沒有符合篩選條件的頻道，中位數不適用。";
  return `符合條件 ${number(filtered.eligible_streamer_count)} 台 · Followers > 1,000 且觀眾 ≥ 10。`;
}
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}
function svgElement(tag, attributes, text) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes || {})) el.setAttribute(key, String(value));
  if (text != null) el.textContent = text;
  return el;
}
function mount(container, options) {
  if (!container || typeof container.replaceChildren !== "function") return function () {};
  const settings = options || {};
  const rows = Array.isArray(settings.rows) ? settings.rows.slice() : [];
  const gameName = String(settings.gameName || "遊戲");
  let metric = "viewers", range = 24, disposed = false, geometry = null;
  let selected = rows.length - 1;
  for (let index = rows.length - 1; index >= 0; index--) {
    if (rows[index]?.status === "observed") { selected = index; break; }
  }
  const listeners = [];
  function on(target, event, handler) { target.addEventListener(event, handler); listeners.push(() => target.removeEventListener(event, handler)); }
  const chart = element("section", "tw-chart");
  chart.dataset.metric = metric;
  chart.setAttribute("aria-label", `${gameName}逐時趨勢`);
  const toolbar = element("div", "tw-chart-toolbar");
  const metrics = element("div", "tw-chart-metrics");
  metrics.setAttribute("role", "group"); metrics.setAttribute("aria-label", "選擇統計指標");
  const metricButtons = Object.entries(METRICS).map(([key, config]) => {
    const button = element("button", "tw-chart-metric", config.label);
    button.type = "button"; button.dataset.metric = key;
    on(button, "click", () => { metric = key; draw(); announce(); });
    metrics.append(button); return button;
  });
  const ranges = element("div", "tw-chart-ranges");
  ranges.setAttribute("role", "group"); ranges.setAttribute("aria-label", "選擇顯示時間範圍");
  const rangeButtons = [24, 6].map(hours => {
    const button = element("button", "tw-chart-range", `${hours} 小時`);
    button.type = "button"; button.dataset.range = String(hours);
    on(button, "click", () => { range = hours; selected = Math.max(startIndex(), selected); draw(); announce(); });
    ranges.append(button); return button;
  });
  toolbar.append(metrics, ranges);
  const inspector = element("div", "tw-chart-inspector");
  const reading = element("div", "tw-chart-reading");
  const selectedTime = element("span", "tw-chart-time");
  const selectedValue = element("strong", "tw-chart-value");
  const unit = element("span", "tw-chart-unit");
  const status = element("p", "tw-chart-status");
  const observed = element("p", "tw-chart-observed");
  reading.append(selectedTime, selectedValue, unit);
  inspector.append(reading, status, observed);
  const plot = element("div", "tw-chart-plot");
  const svg = svgElement("svg", { class: "tw-chart-svg", width: "100%", height: "100%", role: "img", focusable: "false" });
  svg.style.touchAction = "pan-y";
  const empty = element("div", "tw-chart-empty");
  empty.style.pointerEvents = "none";
  plot.append(svg, empty);
  const footer = element("div", "tw-chart-footer");
  const scrubber = element("input", "tw-chart-scrubber");
  scrubber.type = "range"; scrubber.min = "0"; scrubber.step = "1";
  scrubber.setAttribute("aria-label", `${gameName}逐時紀錄，使用左右方向鍵切換時段`);
  const hint = element("p", "tw-chart-hint", "滑過或點選圖表查看數值，也可拖動下方時間軸。台灣時間；實線連接連續紀錄，虛線跨越缺測，僅供觀察趨勢。");
  footer.append(scrubber, hint);
  const announcement = element("p", "tw-chart-announcement");
  announcement.setAttribute("role", "status"); announcement.setAttribute("aria-live", "polite"); announcement.setAttribute("aria-atomic", "true");
  chart.append(toolbar, inspector, plot, footer, announcement);
  container.replaceChildren(chart);
  function startIndex() { return Math.max(0, rows.length - range); }
  function visibleRows() { return rows.slice(startIndex()); }
  function summary() {
    const row = rows[selected], value = valueOf(row, metric);
    return `${row ? `${time(row.hour)} 時段` : "尚無逐時紀錄"}，${METRICS[metric].label} ${value === null ? "無數據" : `${number(value)} ${METRICS[metric].unit}`}。${statusOf(row, metric)}${row?.generated_at ? `快照產生於 ${time(row.generated_at, true)}，台灣時間。` : ""}`;
  }
  function announce() { announcement.textContent = summary(); }
  function inspect() {
    const row = rows[selected], value = valueOf(row, metric);
    selectedTime.textContent = row ? `${time(row.hour)} 時段` : "尚無逐時紀錄";
    selectedValue.textContent = value === null ? "—" : number(value);
    unit.textContent = METRICS[metric].unit;
    status.textContent = statusOf(row, metric);
    observed.textContent = row?.generated_at ? `快照產生時間 ${time(row.generated_at, true)}（台灣）` : "此時段尚無快照";
    scrubber.value = String(Math.max(0, selected - startIndex()));
    scrubber.setAttribute("aria-valuetext", summary());
    if (!geometry) return;
    const { cursor, point, ring, x, y } = geometry;
    const hasSelection = selected >= startIndex() && selected < rows.length;
    cursor.setAttribute("visibility", hasSelection ? "visible" : "hidden");
    if (hasSelection) { cursor.setAttribute("x1", x(selected - startIndex())); cursor.setAttribute("x2", x(selected - startIndex())); }
    for (const dot of [point, ring]) {
      dot.setAttribute("visibility", hasSelection && value !== null ? "visible" : "hidden");
      if (hasSelection && value !== null) { dot.setAttribute("cx", x(selected - startIndex())); dot.setAttribute("cy", y(value)); }
    }
    svg.dataset.selectedIndex = String(Math.max(0, selected - startIndex()));
  }
  function choose(index, speak) {
    if (!rows.length) return;
    const next = Math.max(startIndex(), Math.min(rows.length - 1, index));
    if (next !== selected) { selected = next; inspect(); }
    if (speak) announce();
  }
  function pointer(event) {
    if (!geometry || !rows.length || (event.type === "pointermove" && event.pointerType === "touch")) return;
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width) return;
    const localX = (event.clientX - bounds.left) * geometry.width / bounds.width;
    const length = visibleRows().length;
    const index = length < 2 ? 0 : Math.round((localX - geometry.left) / geometry.innerWidth * (length - 1));
    choose(startIndex() + index, event.type === "pointerdown");
  }
  on(svg, "pointermove", pointer); on(svg, "pointerdown", pointer);
  on(scrubber, "input", () => { choose(startIndex() + Number(scrubber.value), true); });
  on(scrubber, "change", announce);
  function draw() {
    if (disposed) return;
    chart.dataset.metric = metric; chart.dataset.range = String(range);
    metricButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.metric === metric)));
    rangeButtons.forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.range) === range)));
    const visible = visibleRows(), values = visible.map(row => valueOf(row, metric));
    const bounds = plot.getBoundingClientRect();
    const width = Math.max(240, Math.round(bounds.width || 640));
    const height = Math.max(200, Math.min(320, Math.round(bounds.height || 250)));
    const maximum = Math.max(0, ...values.filter(numeric));
    const rawStep = Math.max(1, maximum / 5);
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const step = ([1, 2, 2.5, 5, 10].find(candidate => candidate * magnitude >= rawStep) || 10) * magnitude;
    const gridStep = Math.max(1, Math.ceil(step));
    const top = Math.max(gridStep, Math.ceil(maximum / gridStep) * gridStep);
    const left = Math.max(42, number(top).length * 7 + 15), right = 23, above = 18, below = 37;
    const innerWidth = Math.max(1, width - left - right), innerHeight = height - above - below;
    const x = index => left + (visible.length > 1 ? index / (visible.length - 1) : 0.5) * innerWidth;
    const y = value => above + innerHeight * (1 - value / top);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("aria-label", `${gameName}近 ${range} 小時${METRICS[metric].label}折線圖，${values.filter(numeric).length} 個有效時段。使用下方時間軸查看各時段數值；虛線連接缺測前後的紀錄，缺測時段仍無數據。`);
    svg.replaceChildren();
    svg.append(svgElement("title", {}, `${gameName} · ${METRICS[metric].label}`));
    svg.append(svgElement("desc", {}, "X 軸為台灣時間，Y 軸從零起算。資料點為有效紀錄，實線連接連續紀錄，虛線跨越缺測區間，並非實測或補值。下方時間軸可用鍵盤切換時段。"));
    for (let tick = 0; tick <= top; tick += gridStep) {
      svg.append(svgElement("line", { class: "tw-chart-grid", x1: left, x2: width - right, y1: y(tick), y2: y(tick), stroke: "var(--tw-chart-grid, #dbe3eb)", "stroke-width": 1 }));
      svg.append(svgElement("text", { class: "tw-chart-axis", x: left - 9, y: y(tick) + 4, "text-anchor": "end", "font-size": 11, fill: "var(--tw-chart-ink, #59677d)" }, number(tick)));
    }
    const labelCount = width < 420 ? 3 : width < 640 ? 5 : 7;
    const tickCount = Math.min(labelCount, visible.length);
    const ticks = new Set(Array.from({ length: tickCount }, (_, index) => Math.round(index * (visible.length - 1) / Math.max(1, tickCount - 1))));
    for (const index of ticks) {
      svg.append(svgElement("text", { class: "tw-chart-axis", x: x(index), y: height - 12, "text-anchor": index === 0 ? "start" : index === visible.length - 1 ? "end" : "middle", "font-size": 11, fill: "var(--tw-chart-ink, #59677d)" }, tickTime(visible[index]?.hour)));
    }
    let segment = [], previous = null;
    function line(points, bridge = false) {
      svg.append(svgElement("path", { class: bridge ? "tw-chart-line tw-chart-bridge" : "tw-chart-line", d: points.map(([px, py], index) => `${index ? "L" : "M"}${px.toFixed(2)},${py.toFixed(2)}`).join(" "), fill: "none", stroke: "var(--tw-chart-accent, #6453d9)", "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": bridge ? "6 5" : "none", "vector-effect": "non-scaling-stroke" }));
    }
    function flush() {
      if (segment.length > 1) line(segment);
      segment = [];
    }
    values.forEach((value, index) => {
      if (value === null) { flush(); return; }
      const point = [x(index), y(value)];
      if (previous && index > previous.index + 1) line([previous.point, point], true);
      segment.push(point);
      previous = { index, point };
    });
    flush();
    values.forEach((value, index) => {
      if (value !== null) svg.append(svgElement("circle", { class: "tw-chart-point", "data-index": index, "data-value": value, cx: x(index), cy: y(value), r: 3.5, fill: "var(--tw-chart-accent, #6453d9)", stroke: "#fffdf7", "stroke-width": 1.5 }));
    });
    const cursor = svgElement("line", { class: "tw-chart-cursor", y1: above, y2: height - below, stroke: "var(--tw-chart-accent, #6453d9)", "stroke-width": 1, "stroke-dasharray": "4 5", opacity: 0.5 });
    const ring = svgElement("circle", { class: "tw-chart-selection-ring", r: 9, fill: "var(--tw-chart-accent, #6453d9)", opacity: 0.15 });
    const point = svgElement("circle", { class: "tw-chart-selected-point", r: 5, fill: "var(--tw-chart-accent, #6453d9)", stroke: "#fffdf7", "stroke-width": 2 });
    svg.append(cursor, ring, point);
    geometry = { cursor, point, ring, x, y, width, left, innerWidth };
    empty.hidden = values.some(numeric);
    empty.textContent = metric === "median"
      ? "這段時間尚無完整的篩選中位數。可切換總觀眾或開台數查看已有紀錄。"
      : "這段時間尚無可繪製的數據。點選時間軸可查看各時段狀態。";
    scrubber.max = String(Math.max(0, visible.length - 1)); scrubber.disabled = visible.length < 2;
    inspect();
  }
  draw();
  let observer = null;
  if (typeof globalThis.ResizeObserver === "function") {
    let lastSize = "";
    observer = new globalThis.ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      const size = rect ? `${Math.round(rect.width)}:${Math.round(rect.height)}` : "";
      if (size && size !== lastSize) { lastSize = size; draw(); }
    });
    observer.observe(plot);
  } else on(window, "resize", draw);
  return function cleanup() {
    if (disposed) return;
    disposed = true; observer?.disconnect(); listeners.forEach(remove => remove());
  };
}
export const RadarTwitchChart = { mount };
export { mount, valueOf, statusOf };
