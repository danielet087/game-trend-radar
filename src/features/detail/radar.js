// The radar's own records for one game: dated news, Followers history and Twitch.
// Nothing here invents a measurement: missing history stays missing.
import { RadarInsights as I } from '../insights/metrics.js';
import { dailyFollowerPoints, followerDay } from '../../domain/followers.mjs';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const CHART_DAYS = 120;
const CHART_GAP_DAYS = 8;
const DAY = 86400000;
const dayTime = day => Date.parse(`${day}T12:00:00Z`);
export const weekday = day => WEEKDAYS[new Date(dayTime(day)).getUTCDay()];
const signed = (number, value) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${number.format(Math.abs(value))}`;

export function followerChanges(history, today) {
  return [7, 30].map(span => ({ span, metric: I.metric(history, span, today) }))
    .filter(entry => entry.metric.status === 'ready');
}

export function newsItems({ game, record, history, activity, media, today, number }) {
  const items = [];
  const nintendo = game.source === 'nintendo';
  const reasons = { added: '收錄', release_date: '發售日', platform_added: '平台' };
  // A game with Steam and console versions keeps the console versions' news too.
  const igdbIds = game.igdbIds || (game.igdbId ? [game.igdbId] : []);
  const events = I.activityEvents(Array.isArray(activity?.events) ? activity.events : []).filter(event =>
    event.source === 'nintendo' ? igdbIds.includes(event.igdb_id)
      : !nintendo && event.source === 'steam' && event.appid === game.appid);
  for (const event of events) {
    const date = followerDay(event.at);
    if (!date || date > today) continue;
    const text = event.type === 'added' ? `收錄進雷達（${I.activityReason(event) || '來源未記錄'}）`
      : event.type === 'release_date' ? `發售日從 ${event.previous_date.replaceAll('-', '/')} 改成 ${event.date.replaceAll('-', '/')}`
      : `新增平台：${(event.platforms || []).join('／')}`;
    items.push({ date, kind: event.type === 'added' ? 'added' : 'release', label: reasons[event.type], text, target: event.type === 'added' ? null : 'gameInfo' });
  }
  // A console game's first sighting is its arrival on the radar when no event recorded it.
  if (nintendo && !events.some(event => event.type === 'added')) {
    const first = followerDay(game.firstObservedAt);
    if (first && first <= today)
      items.push({ date: first, kind: 'added', label: '收錄', text: '收錄進雷達（IGDB 主機新作）', target: null });
  }
  if (!nintendo) {
    const points = dailyFollowerPoints(history, today);
    const latest = points.at(-1);
    if (latest) {
      const changes = followerChanges(history, today)
        .map(({ metric }) => `${metric.days} 天 ${signed(number, metric.delta)}`);
      items.push({ date: latest.day, kind: 'followers', label: '關注',
        text: `關注數來到 ${number.format(latest.followers)} 人${changes.length ? `，${changes.join('、')}` : ''}`, target: 'gameHeat' });
    }
    if (points.length > 1 && !events.some(event => event.type === 'added'))
      items.push({ date: points[0].day, kind: 'added', label: '收錄', text: `第一次量測關注數：${number.format(points[0].followers)} 人`, target: null });
    // A confirmed date is news before launch; afterwards it is only a re-check.
    const verified = followerDay(record?.release_date_verified_at);
    if (verified && verified <= today && record?.release_start === game.date && /^\d{4}-\d{2}-\d{2}$/.test(game.date || '') &&
        verified < game.date) {
      const [year, month, date] = game.date.split('-').map(Number);
      items.push({ date: verified, kind: 'release', label: '發售日', text: `Steam 確認完整發售日：${year} 年 ${month} 月 ${date} 日`, target: 'gameInfo' });
    }
    const updated = followerDay(media?.updatedAt);
    if (updated && updated <= today) {
      const parts = [media.hero ? '主視覺' : '', media.screenshots.length ? `${media.screenshots.length} 張截圖` : '',
        media.trailers.length ? `${media.trailers.length} 支預告` : ''].filter(Boolean);
      if (parts.length) items.push({ date: updated, kind: 'media', label: '影音', text: `Steam 影音更新：${parts.join('、')}`, target: 'gameMedia' });
    }
  }
  const order = { followers: 0, media: 1, release: 2, added: 3 };
  return items.sort((a, b) => b.date.localeCompare(a.date) || order[a.kind] - order[b.kind]).slice(0, 4);
}

// Daily measurements become a line; a gap longer than the weekly schedule breaks it.
export function chartModel(history, today) {
  const all = dailyFollowerPoints(history, today);
  const latest = all.at(-1);
  if (!latest) return null;
  const start = new Date(dayTime(latest.day) - (CHART_DAYS - 1) * DAY).toISOString().slice(0, 10);
  const points = all.filter(point => point.day >= start);
  if (points.length < 2) return null;
  const first = dayTime(points[0].day), span = Math.max(1, (dayTime(latest.day) - first) / DAY);
  const values = points.map(point => point.followers);
  let low = Math.min(...values), high = Math.max(...values);
  const pad = Math.max(1, Math.round((high - low) * 0.08));
  low = Math.max(0, low - pad); high += pad;
  const x = point => (dayTime(point.day) - first) / DAY / span * 100;
  const y = point => high === low ? 50 : (1 - (point.followers - low) / (high - low)) * 100;
  const segments = [];
  points.forEach((point, index) => {
    const gap = index ? (dayTime(point.day) - dayTime(points[index - 1].day)) / DAY : 0;
    if (!index || gap > CHART_GAP_DAYS) segments.push([]);
    segments.at(-1).push({ ...point, x: x(point), y: y(point) });
  });
  return { points, segments, low, high, latest: segments.at(-1).at(-1), first: points[0], gaps: segments.length - 1 };
}

const SVG = 'http://www.w3.org/2000/svg';
function svgNode(document, tag, attributes) {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
}

export function createDetailRadar(ctx) {
  const { $, node, document, window, storage, number, isNativeConsole } = ctx;
  let twitchIndex, twitchRequest = null, twitchWatcher = null, currentGame = null;

  function renderNews(game, extras) {
    const items = newsItems({ game, record: extras.record, history: extras.history, activity: extras.activity,
      media: extras.media, today: ctx.today, number });
    $('gameNews').hidden = !items.length;
    $('gameNewsList').replaceChildren(...items.map(item => {
      const row = node('li', `game-news-item news-${item.kind}`);
      const top = node('div', 'game-news-top');
      const when = node('p', 'game-news-date');
      const time = node('time', '', `${item.date.slice(5, 7)}.${item.date.slice(8)}`);
      time.dateTime = item.date;
      when.append(time, node('span', '', `週${weekday(item.date)}`));
      top.append(when, node('span', `game-news-label label-${item.kind}`, item.label));
      row.append(top, node('p', 'game-news-text', item.text));
      if (item.target) {
        const link = node('a', 'game-news-link', item.target === 'gameHeat' ? '看熱度 ↓' : item.target === 'gameMedia' ? '看影音 ↓' : '看遊戲資訊 ↓');
        link.href = `#${item.target}`;
        row.append(link);
      }
      return row;
    }));
  }

  function renderChart(game, history) {
    const model = !isNativeConsole(game) ? chartModel(history, ctx.today) : null;
    $('gameHeatChart').hidden = !model;
    if (!model) { $('gameHeatPlot').replaceChildren(); return; }
    const plot = $('gameHeatPlot');
    const svg = svgNode(document, 'svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none', class: 'game-heat-svg', 'aria-hidden': 'true' });
    for (const level of [0, 50, 100]) svg.append(svgNode(document, 'line', { x1: 0, x2: 100, y1: level, y2: level, class: 'game-heat-grid' }));
    // A long gap in measurement is bridged by a dashed line; the missing days keep no value.
    model.segments.slice(1).forEach((segment, index) => {
      const from = model.segments[index].at(-1), to = segment[0];
      svg.append(svgNode(document, 'polyline', { class: 'game-heat-bridge', points: `${from.x.toFixed(2)},${from.y.toFixed(2)} ${to.x.toFixed(2)},${to.y.toFixed(2)}` }));
    });
    for (const segment of model.segments) {
      if (segment.length > 1) {
        const line = segment.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
        svg.append(svgNode(document, 'polygon', { class: 'game-heat-area', points: `${line} ${segment.at(-1).x.toFixed(2)},100 ${segment[0].x.toFixed(2)},100` }));
        svg.append(svgNode(document, 'polyline', { class: 'game-heat-line', points: line }));
      }
    }
    const dots = model.segments.filter(segment => segment.length === 1).map(([point]) => {
      const dot = node('span', 'game-heat-dot');
      dot.style.left = `${point.x}%`;
      dot.style.top = `${point.y}%`;
      dot.setAttribute('aria-hidden', 'true');
      return dot;
    });
    const end = node('span', 'game-heat-end');
    end.style.left = `${model.latest.x}%`;
    end.style.top = `${model.latest.y}%`;
    end.setAttribute('aria-hidden', 'true');
    const value = (className, point) => {
      const label = node('span', className, number.format(point.followers));
      label.style.top = `${point.y}%`;
      label.setAttribute('aria-hidden', 'true');
      return label;
    };
    const axis = node('div', 'game-heat-axis');
    axis.setAttribute('aria-hidden', 'true');
    axis.append(node('span', '', model.first.day.slice(5).replace('-', '/')), node('span', '', model.latest.day.slice(5).replace('-', '/')));
    const frame = node('div', 'game-heat-frame');
    frame.append(svg, ...dots, end, value('game-heat-label is-start', model.segments[0][0]), value('game-heat-label is-end', model.latest));
    plot.replaceChildren(frame, axis);
    plot.setAttribute('role', 'img');
    plot.setAttribute('aria-label', `關注數折線圖：${model.first.day.replaceAll('-', '/')} ${number.format(model.first.followers)} 人，` +
      `到 ${model.latest.day.replaceAll('-', '/')} ${number.format(model.latest.followers)} 人；共 ${model.points.length} 次量測` +
      (model.gaps ? `，其中 ${model.gaps} 段超過 ${CHART_GAP_DAYS} 天沒有量測` : ''));
    $('gameHeatCaption').textContent = `每個點都是一次實際量測（台灣日期）。超過 ${CHART_GAP_DAYS} 天沒有量測的地方用虛線連起來，不補數字。`;
  }

  function renderChanges(game, history) {
    const changes = !isNativeConsole(game) ? followerChanges(history, ctx.today) : [];
    $('gameHeatChanges').hidden = !changes.length;
    $('gameHeatChanges').replaceChildren(...changes.map(({ metric }) => {
      const item = node('li', `game-heat-change${metric.delta < 0 ? ' is-down' : ''}`);
      item.append(node('span', '', `${metric.days} 天`), node('strong', '', signed(number, metric.delta)));
      return item;
    }));
  }

  const validIndex = value => value && typeof value === 'object' && value.games && typeof value.games === 'object' && !Array.isArray(value.games);
  // Steam games match through the archive's own Steam AppIDs. Console games have
  // no shared ID, so only an unambiguous exact name match counts (Twitch
  // categories take their names from IGDB).
  function twitchEntry(game) {
    if (!twitchIndex) return null;
    const rows = Object.entries(twitchIndex.games).map(([id, entry]) => ({ id, entry }))
      .filter(({ id, entry }) => /^[1-9][0-9]{0,15}$/.test(id) && entry && typeof entry === 'object');
    if (!isNativeConsole(game)) {
      if (!Number.isSafeInteger(game.appid)) return null;
      const appid = String(game.appid);
      return rows.filter(({ entry }) => Array.isArray(entry.steam_appids) && entry.steam_appids.map(String).includes(appid))
        .sort((a, b) => (b.entry.peak_viewer_count || 0) - (a.entry.peak_viewer_count || 0))[0] || null;
    }
    const fold = value => typeof value === 'string' ? value.trim().toLocaleLowerCase('en') : '';
    const names = new Set([game.nameEn, game.name].map(fold).filter(Boolean));
    const found = rows.filter(({ entry }) => [entry.name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]
      .some(name => names.has(fold(name))));
    return found.length === 1 ? found[0] : null;
  }
  function renderTwitch(game) {
    const match = twitchEntry(game);
    const status = $('gameTwitchStatus'), link = $('gameTwitchLink');
    link.hidden = !match;
    if (match) {
      const { id, entry } = match;
      const peak = Number.isSafeInteger(entry.peak_viewer_count) ? number.format(entry.peak_viewer_count) : null;
      const last = followerDay(entry.last_hour), first = followerDay(entry.first_hour);
      $('gameTwitchText').textContent = peak
        ? `雷達記錄到的最高觀看是 ${peak} 人${first && last ? `（${first.replaceAll('-', '/')}～${last.replaceAll('-', '/')}，${number.format(entry.sample_count || 0)} 個小時）` : ''}。`
        : '雷達有這款遊戲的 Twitch 每小時紀錄。';
      status.textContent = entry.tracking_status === 'active' ? '目前：每小時記錄中' : '目前：已停止記錄';
      status.dataset.state = entry.tracking_status === 'active' ? 'active' : 'ended';
      link.href = `./twitch-game.html?game=${id}`;
      link.textContent = '看 Twitch 每小時紀錄 ↗';
      return;
    }
    $('gameTwitchText').textContent = isNativeConsole(game)
      ? 'Twitch 觀看人數達到 7,000 人、而且確認是新作的遊戲，會開始每小時記錄觀看人數與實況主數。'
      : 'Steam 上市後 30 天內，或 Twitch 觀看人數達到 7,000 人的新作，會開始每小時記錄觀看人數與實況主數。';
    status.textContent = twitchIndex === null ? '目前：Twitch 資料暫時讀不到' : twitchIndex ? '目前：還沒有紀錄' : '正在讀取 Twitch 紀錄…';
    status.dataset.state = 'waiting';
  }
  function loadTwitch() {
    if (twitchRequest) return twitchRequest;
    twitchRequest = Promise.resolve(storage.readJSON?.('./data/twitch_series/index.json', validIndex))
      .then(value => { twitchIndex = validIndex(value) ? value : null; })
      .catch(() => { twitchIndex = null; })
      .finally(() => { if (!ctx.disposed && currentGame) renderTwitch(currentGame); });
    return twitchRequest;
  }
  function watchTwitch() {
    if (twitchRequest || twitchWatcher) return;
    if (typeof window?.IntersectionObserver !== 'function') { loadTwitch(); return; }
    twitchWatcher = new window.IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      twitchWatcher.disconnect();
      twitchWatcher = null;
      loadTwitch();
    }, { rootMargin: '600px 0px' });
    twitchWatcher.observe($('gameHeat'));
  }

  return {
    render(game, extras = {}) {
      currentGame = game;
      renderNews(game, extras);
      renderChanges(game, extras.history);
      renderChart(game, extras.history);
      $('gameGrowthLink').hidden = isNativeConsole(game);
      renderTwitch(game);
      watchTwitch();
    },
    destroy() { twitchWatcher?.disconnect(); twitchWatcher = null; },
  };
}
