/* Daily schedule history only. No catalog counters, filled days or interpolated gaps. */
(() => {
  'use strict';
  const I = window.RadarInsights, E = window.RadarEnhancements;
  const $ = id => document.getElementById(id), node = E.make;
  const today = window.RadarData.todayInTaipei();
  const number = new Intl.NumberFormat('zh-TW');
  const colors = ['#467557', '#ad6541', '#7855a0'];
  const dashes = ['', '8 4', '3 4'];
  const dateLabel = value => value.replaceAll('-', '/');
  const signed = value => (value > 0 ? '+' : '') + number.format(value);
  const ratio = value => (value > 0 ? '+' : '') + value.toFixed(1) + '%';
  let games = [], source = null, context = null, cursor = null, hidden = new Set();
  let period = 30, requestedEnd = '', metric = 'total';
  function readURL() {
    const params = new URLSearchParams(location.search);
    period = [7, 30, 90].includes(Number(params.get('days'))) ? Number(params.get('days')) : 30;
    requestedEnd = I.day(params.get('end')) && params.get('end') <= today ? params.get('end') : '';
    metric = ['total', 'daily', 'percent'].includes(params.get('metric')) ? params.get('metric') : 'total';
    cursor = null;
  }
  readURL();
  function saveURL() {
    if (!context) return;
    const url = new URL(location.href);
    if (period === 30) url.searchParams.delete('days'); else url.searchParams.set('days', period);
    // Sharing freezes the displayed historical window, even when it was chosen automatically.
    url.searchParams.set('end', context.end);
    if (metric === 'total') url.searchParams.delete('metric'); else url.searchParams.set('metric', metric);
    window.history.replaceState(window.history.state, '', url);
  }
  function plotValues(series) {
    if (metric === 'total') return series.values;
    if (metric === 'daily') return series.daily;
    const baseline = series.baseline?.followers;
    return series.values.map(value => value !== null && baseline > 0 ? (value - baseline) / baseline * 100 : null);
  }
  function format(value) {
    if (value === null || value === undefined) return '—';
    return metric === 'percent' ? ratio(value) : (metric === 'daily' ? signed(value) : number.format(value)) + ' 人';
  }
  function status(series) {
    if (series.status === 'invalid') return '尚無有效追蹤日期';
    if (!series.observedDays) return context.start > series.trackUntil ? '此期間已結束追蹤' : '此期間尚無紀錄';
    if (!series.baseline && !series.endPoint) return '缺少起點與截止日紀錄';
    if (!series.baseline) return '缺少起點紀錄';
    if (!series.endPoint) return '缺少截止日紀錄';
    return series.observedDays === context.days.length ? '每日紀錄齊全' : '兩端可比較 · 中間有缺日';
  }
  function summary() {
    $('historyMetrics').replaceChildren(...context.series.map((series, index) => {
      const game = games.find(game => game.appid === series.appid);
      const card = node('article', 'history-summary');
      card.style.setProperty('--series-color', colors[index]);
      const name = node('a', 'history-game-name', game.name); name.href = `./game.html?appid=${game.appid}`;
      const change = node('strong', 'history-net', series.delta === null ? '—' : signed(series.delta));
      const percent = node('span', 'history-percent', series.percent === null ? '成長率 —' : ratio(series.percent));
      card.append(name, node('span', 'history-label', '期間淨增加人數'), change, percent);
      const ends = node('div', 'history-endpoints');
      for (const [label, point] of [['起點', series.baseline], ['截止', series.endPoint]]) {
        const value = node('span'); value.append(node('small', '', label), node('b', '', point ? number.format(point.followers) : '—')); ends.append(value);
      }
      card.append(ends, node('span', 'history-completeness', status(series)), node('small', 'history-coverage', `${series.observedDays} / ${context.days.length} 天有實測 · ${series.tracking ? '追蹤中' : '已結束追蹤'}`));
      if (series.baseline?.followers === 0) card.append(node('small', 'history-coverage', '起點為 0，百分比不計算。'));
      return card;
    }));
  }
  function legend() {
    $('historyLegend').replaceChildren(...context.series.map((series, index) => {
      const game = games.find(game => game.appid === series.appid);
      const button = node('button', 'history-legend-button'); button.type = 'button';
      button.style.setProperty('--series-color', colors[index]);
      button.setAttribute('aria-pressed', String(!hidden.has(series.appid)));
      button.setAttribute('aria-label', `圖表顯示：${game.name}`);
      const symbol = node('span', 'history-legend-symbol', String(index + 1)); symbol.setAttribute('aria-hidden', 'true');
      button.append(symbol, node('span', '', game.name));
      button.addEventListener('click', () => {
        if (hidden.has(series.appid)) hidden.delete(series.appid); else hidden.add(series.appid);
        button.setAttribute('aria-pressed', String(!hidden.has(series.appid))); draw();
      });
      return button;
    }));
  }
  function readout() {
    const day = context.days[cursor];
    $('historyCursorDate').textContent = dateLabel(day);
    $('historyCursor').setAttribute('aria-valuetext', dateLabel(day));
    $('historyReadout').replaceChildren(...context.series.map((series, index) => {
      const game = games.find(game => game.appid === series.appid), value = plotValues(series)[cursor];
      const point = series.points.find(point => point.day === day);
      const item = node('div', 'history-day-value'); item.style.setProperty('--series-color', colors[index]);
      let note = point ? '當日實測' : day > series.trackUntil ? '已結束追蹤' : '這天沒有量測';
      if (point && value === null) note = metric === 'daily' ? (cursor === 0 ? '區間起點，不計每日淨增' : '缺少前一日量測') : series.baseline?.followers === 0 ? '起點為 0，不計百分比' : '缺少起點量測';
      item.append(node('span', '', game.name), node('strong', '', format(value)), node('small', '', note));
      return item;
    }));
  }
  const svgNode = (tag, attrs = {}, text) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    if (text !== undefined) el.textContent = text;
    return el;
  };
  function draw() {
    if (!context || $('comparisonResults').hidden) return;
    const plot = $('historyPlot');
    const visible = context.series.map((series, index) => ({ series, index, values: plotValues(series) })).filter(row => !hidden.has(row.series.appid));
    const samples = visible.flatMap(row => row.values.filter(value => value !== null));
    $('historyPlotEmpty').hidden = samples.length > 0;
    plot.hidden = !samples.length;
    if (!samples.length) {
      plot.replaceChildren();
      $('historyPlotEmpty').textContent = !visible.length ? '選取上方至少一款遊戲，查看它的歷史紀錄。' : metric === 'total' ? '所選期間還沒有可繪製的日紀錄，試試其他截止日期。' : metric === 'daily' ? '尚無連續兩天的實測紀錄，暫時無法計算每日淨增。' : '尚無有效起點紀錄，暫時無法計算累積成長率。';
      readout(); return;
    }
    const width = Math.max(240, Math.round(plot.getBoundingClientRect().width) || 800), height = 275;
    const left = width < 500 ? 49 : 68, right = 15, top = 18, bottom = 41;
    const innerWidth = width - left - right, innerHeight = height - top - bottom;
    let low = Math.min(0, ...samples), high = Math.max(0, ...samples);
    if (low === high) high = low + 1;
    const x = index => left + index / (context.days.length - 1) * innerWidth;
    const y = value => top + (high - value) / (high - low) * innerHeight;
    const svg = svgNode('svg', { viewBox:`0 0 ${width} ${height}`, width:'100%', height, role:'img', 'aria-label':`${$('historyChartTitle').textContent}，${dateLabel(context.start)} 至 ${dateLabel(context.end)}。僅呈現實測，缺日斷線。可使用下方日期滑桿讀取數值。` });
    for (let index = 0; index <= 4; index++) {
      const value = low + (high - low) * index / 4, pos = y(value);
      svg.append(svgNode('line', { x1:left, x2:width-right, y1:pos, y2:pos, stroke:value === 0 ? '#bfb7cb' : '#ebe7ee', 'stroke-width':1 }));
      const label = metric === 'percent' ? value.toFixed(1) + '%' : Math.abs(value) >= 10000 ? (value / 10000).toFixed(1) + '萬' : number.format(Math.round(value));
      svg.append(svgNode('text', { x:left-9, y:pos+4, 'text-anchor':'end', class:'history-axis-label' }, label));
    }
    const ticks = width < 500 ? [0, Math.floor(period / 2), period] : [0, Math.round(period / 4), Math.round(period / 2), Math.round(period * .75), period];
    for (const index of ticks) svg.append(svgNode('text', { x:x(index), y:height-12, 'text-anchor':index === 0 ? 'start' : index === period ? 'end' : 'middle', class:'history-axis-label' }, context.days[index].slice(5).replace('-', '/')));
    svg.append(svgNode('line', { x1:x(cursor), x2:x(cursor), y1:top, y2:height-bottom, stroke:'#a9a0b5', 'stroke-dasharray':'3 4' }));
    for (const row of visible) {
      let path = '', connected = false;
      row.values.forEach((value, index) => {
        if (value === null) { connected = false; return; }
        path += `${connected ? ' L' : ' M'}${x(index).toFixed(2)},${y(value).toFixed(2)}`; connected = true;
      });
      svg.append(svgNode('path', { d:path.trim(), fill:'none', stroke:colors[row.index], 'stroke-width':2.3, 'stroke-dasharray':dashes[row.index], 'stroke-linecap':'round', 'stroke-linejoin':'round', 'data-series':row.series.appid }));
      row.values.forEach((value, index) => {
        if (value === null) return;
        const dot = svgNode('circle', { cx:x(index), cy:y(value), r:index === cursor ? 4.6 : 3, fill:colors[row.index], stroke:'#fffdf8', 'stroke-width':1.5 });
        dot.append(svgNode('title', {}, `${games.find(g => g.appid === row.series.appid).name} · ${dateLabel(context.days[index])} · ${format(value)}`)); svg.append(dot);
      });
    }
    plot.replaceChildren(svg); readout();
  }
  function render() {
    if (games.length < 2) return;
    context = I.comparisonWindow(games, period, requestedEnd, today);
    cursor = cursor === null ? period : Math.min(period, Math.max(0, cursor));
    $('historyWindowLabel').textContent = `${dateLabel(context.start)} → ${dateLabel(context.end)} · 台灣日期`;
    $('historyEnd').value = context.end; $('historyEnd').max = today;
    $('historyCursor').max = period; $('historyCursor').value = cursor;
    $('historyChartTitle').textContent = { total:'每日關注人數', daily:'每日淨增加人數', percent:'從共同起點開始的成長率' }[metric];
    $('historyChartNote').textContent = metric === 'total' ? '所有遊戲使用同一刻度。單日紀錄以圓點表示；缺日不補值、不連線。' : metric === 'daily' ? '當日減前一日，兩天都要有實測；負值代表關注人數減少。' : '每款都以同一個起點日期為 0%，只顯示有實測的日期。';
    const latest = context.series.flatMap(series => series.points).map(point => point.day).sort().at(-1);
    const run = source?.collection;
    const failure = run && ['rate_limited','source_unavailable','interrupted'].includes(run.status);
    $('historySourceNotice').textContent = !source ? '每日歷史暫時無法讀取，請稍後重新讀取。' : `${latest ? '所選期間最後實測：' + dateLabel(latest) : '所選期間尚無實測'}${failure ? ' · 最近更新未完成，已保留既有歷史。' : ' · 依每日排程保存的量測紀錄。'}`;
    document.querySelectorAll('[data-history-days]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.historyDays) === period)));
    document.querySelectorAll('[data-history-metric]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.historyMetric === metric)));
    summary(); legend(); draw(); saveURL();
  }
  document.querySelectorAll('[data-history-days]').forEach(button => button.addEventListener('click', () => { period = Number(button.dataset.historyDays); cursor = null; render(); }));
  document.querySelectorAll('[data-history-metric]').forEach(button => button.addEventListener('click', () => { metric = button.dataset.historyMetric; render(); }));
  $('historyEnd').addEventListener('change', () => {
    const value = $('historyEnd').value;
    if (!I.day(value) || value > today) { $('historyEnd').value = context.end; E.feedback('請選擇今天或之前的有效日期。'); return; }
    requestedEnd = value; cursor = null; render();
  });
  $('historyLatest').addEventListener('click', () => { requestedEnd = ''; cursor = null; render(); });
  $('historyCursor').addEventListener('input', () => { cursor = Number($('historyCursor').value); draw(); });
  window.addEventListener('popstate', () => { readURL(); if (context) render(); });
  if (window.ResizeObserver) {
    let measured = 0;
    new ResizeObserver(entries => {
      const width = entries[0].contentRect.width;
      if (width > 0 && Math.abs(width - measured) > 1) { measured = width; requestAnimationFrame(draw); }
    }).observe($('historyPlot'));
  }
  window.RadarComparisonHistory = {
    render(selected, data) { games = selected; source = data; hidden = new Set([...hidden].filter(id => games.some(game => game.appid === id))); cursor = null; render(); },
  };
})();
