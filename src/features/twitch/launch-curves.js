import { RadarStorage } from '../../data/storage.ts';
import { CHINESE_DAILY_HEAT_HITS, cooldownThreshold } from './cooldown-model.js';
import { regionNames, regionOf } from './audience-region.js';
import { fmt, node } from './presentation.js';
import { dateStart, dayOf } from './series.js';
import { quantile } from './statistics-model.js';
import { HOUR, timestamp } from './metrics.js';

const DAYS = 7;
const DAY = 24 * HOUR;
const MIN_PEERS = 5;
const NS = 'http://www.w3.org/2000/svg';
const measured = value => Number.isFinite(value) && value >= 0;
const threshold = cooldownThreshold('global');
const validDaily = values => Array.isArray(values) && values.length === DAYS && values.every(value => value === null || measured(value));
const validChinese = value => value === undefined || value && validDaily(value.daily) &&
  Array.isArray(value.heat) && value.heat.length === DAYS && value.heat.every(on => on === null || typeof on === 'boolean') &&
  Array.isArray(value.measurement_sources) && value.measurement_sources.length === DAYS &&
  value.measurement_sources.every(source => [null, 'global_census', 'helix_language_filter', 'mixed'].includes(source));

function validCurves(data) {
  return data?.schema_version === 1 && Boolean(timestamp(data.generated_at)) && data.genres && typeof data.genres === 'object' &&
    data.games && typeof data.games === 'object' && !Array.isArray(data.games) &&
    Object.values(data.games).every(game => Number.isFinite(dateStart(game.date)) &&
      ['early_access', 'standard_store_date'].includes(game.edition) && Array.isArray(game.genres) &&
      game.genres.every(genre => typeof data.genres[genre] === 'string') &&
      validDaily(game.daily) && validChinese(game.audience_regions?.zh));
}

function launchHeat(days) {
  let hot = 0, observed = 0, longest = 0, run = 0, firstHot = null, firstDrop = null, returnDay = null;
  let sawHot = false;
  days.forEach((on, i) => {
    if (on === null) {
      run = 0; sawHot = false;
      return;
    }
    observed++;
    const day = i + 1;
    if (on) {
      if (sawHot && run === 0) returnDay ??= day;
      hot++; run++;
      longest = Math.max(longest, run);
      firstHot ??= day;
      sawHot = true;
    } else {
      if (run > 0) firstDrop ??= day;
      run = 0;
    }
  });
  return { hot, observed, longest, firstHot, firstDrop, returnDay };
}

function scopedCurve(game, region) {
  if (region === 'zh') return game.audience_regions?.zh;
  return { daily: game.daily, heat: game.daily.map(value => measured(value) ? value >= threshold : null) };
}

export function launchComparison(data, id, genre, until = Infinity, region = 'global') {
  const game = data.games[id];
  const release = dateStart(game.date);
  const published = Date.parse(data.generated_at);
  const cutoff = Number.isFinite(published) ? Math.min(until, published) : until;
  const closedDays = Math.min(DAYS, Math.max(0, Math.floor((cutoff - release) / DAY) - 1));
  const curve = scopedCurve(game, region);
  const methods = new Set(curve?.measurement_sources?.slice(0, closedDays).filter(Boolean));
  const measurementSource = methods.size > 1 ? 'mixed' : methods.values().next().value;
  const daily = Array.from({ length: DAYS }, (_, i) => i < closedDays ? curve?.daily[i] ?? null : null);
  const peers = Object.entries(data.games).flatMap(([otherId, other]) => {
    if (otherId === id || other.edition !== game.edition || !other.genres.includes(genre) ||
        dateStart(other.date) + (DAYS + 1) * DAY > Math.min(cutoff, release)) return [];
    const peer = scopedCurve(other, region);
    if (!peer || !peer.daily.every(measured)) return [];
    if (region === 'zh' && (!measurementSource || measurementSource === 'mixed' ||
        !peer.measurement_sources.every(source => source === measurementSource) || peer.heat.includes(null))) return [];
    return [peer];
  });
  const enoughPeers = peers.length >= MIN_PEERS;
  const typicalDay = enoughPeers ? daily.map((_, i) => quantile(peers.map(peer => peer.daily[i]), .5)) : null;
  const retained = (value, start) => measured(value) && start > 0 ? value / start * 100 : null;
  const remainingOnDay7 = enoughPeers
    ? quantile(peers.map(peer => retained(peer.daily.at(-1), peer.daily[0])), .5) : null;
  const peerRuns = enoughPeers && closedDays ? peers.map(peer => launchHeat(peer.heat.slice(0, closedDays)).longest)
    .filter(run => run > 0) : [];
  const peerHeat = enoughPeers && closedDays ? {
    hot:peerRuns.length, longest:peerRuns.length >= MIN_PEERS ? quantile(peerRuns, .5) : null,
  } : null;
  const gameRemaining = measurementSource === 'mixed' ? null : retained(daily.at(-1), daily[0]);
  return { game: { ...game, daily }, peers: peers.length, typicalDay, gameRemaining,
    remainingOnDay7, closedDays, heat:launchHeat(curve?.heat.slice(0, closedDays) ?? []), peerHeat,
    region, measurementSource };
}

function svgNode(tag, attrs, value) {
  const element = document.createElementNS(NS, tag);
  for (const [name, setting] of Object.entries(attrs)) element.setAttribute(name, String(setting));
  if (value !== undefined) element.textContent = value;
  return element;
}

function viewerChart(game, typical, region) {
  const svg = svgNode('svg', { viewBox:'0 0 420 174', role:'img', 'aria-label':`上市後首週每日${regionNames[region]}觀眾中位數` });
  const maximum = Math.max(2, ...game.filter(measured), ...(typical || []));
  const x = i => 58 + i * 55;
  const y = value => 142 - value / maximum * 120;
  for (const tick of [0, maximum / 2, maximum]) {
    svg.append(svgNode('line', { x1:x(0), x2:x(DAYS - 1), y1:y(tick), y2:y(tick), class:'tw-launch-grid' }),
      svgNode('text', { x:51, y:y(tick) + 4, 'text-anchor':'end' }, fmt(tick)));
  }
  if (region === 'global' && maximum >= threshold) {
    svg.append(svgNode('line', { x1:x(0), x2:x(DAYS - 1), y1:y(threshold), y2:y(threshold), class:'tw-chart-threshold' }));
  }
  for (let i = 0; i < DAYS; i++) svg.append(svgNode('text', { x:x(i), y:165, 'text-anchor':'middle' }, `第 ${i + 1} 天`));
  for (const [values, kind] of [[typical, 'peer'], [game, 'game']]) {
    if (!values) continue;
    let path = '';
    const dots = [];
    values.forEach((value, i) => {
      if (!measured(value)) return;
      path += `${measured(values[i - 1]) ? 'L' : 'M'}${x(i)} ${y(value)} `;
      const dot = svgNode('circle', { cx:x(i), cy:y(value), r:3.4, class:`tw-launch-${kind}` });
      dot.append(svgNode('title', {}, `第 ${i + 1} 天 ${fmt(value)} 人`));
      dots.push(dot);
    });
    if (path) svg.append(svgNode('path', { d:path, class:`tw-launch-${kind}`, fill:'none' }), ...dots);
  }
  return svg;
}

function heatSummary({ closedDays, heat, peerHeat, peers, region }) {
  const summary = node('div', 'tw-launch-heat');
  const heading = node('h3', 'tw-region-caption', '首週熱度');
  summary.append(heading);
  if (!closedDays) {
    summary.append(node('p', 'tw-trial-coverage', '首個完整觀測日尚未發布。'));
    return summary;
  }
  const metrics = node('dl', 'tw-launch-heat-metrics');
  for (const [label, value] of [['達標天數', heat.hot], ['最長連續達標', heat.longest]]) {
    const item = node('div');
    item.append(node('dt', '', label), node('dd', '', heat.observed ? `${value} 天` : '—'));
    metrics.append(item);
  }
  const rule = region === 'zh' ? `${cooldownThreshold(region)} 人至少 ${CHINESE_DAILY_HEAT_HITS} 個時段` : `${fmt(threshold)} 人門檻`;
  const coverage = node('p', 'tw-trial-coverage', `前 ${closedDays} 天有 ${heat.observed} 天可判定 · ${rule}`);
  const events = [
    heat.firstHot > 1 && `第 ${heat.firstHot} 天觀測到達標`,
    heat.firstDrop && `第 ${heat.firstDrop} 天跌破門檻`,
    heat.returnDay && `第 ${heat.returnDay} 天再次達標`,
  ].filter(Boolean);
  summary.append(metrics, coverage);
  if (events.length) summary.append(node('p', 'tw-launch-heat-signal', events.join(' · ')));
  if (peerHeat) {
    const duration = peerHeat.longest === null ? '' : ` · 達標作品的最長連續中位數 ${fmt(peerHeat.longest)} 天`;
    summary.append(node('p', 'tw-trial-coverage', `同類 ${peerHeat.hot}／${peers} 款在前 ${closedDays} 天曾達標${duration}`));
  }
  return summary;
}

function compactTable({ game, typicalDay }) {
  const table = node('table', 'tw-compare-table');
  const head = table.createTHead().insertRow();
  const labels = ['每日觀眾', '第 1 天', '第 3 天', '第 7 天'];
  for (const label of labels) {
    const cell = node('th', '', label); cell.scope = 'col'; head.append(cell);
  }
  const body = table.createTBody();
  for (const [label, values] of [['這款遊戲', game.daily], ['同類中位數', typicalDay]]) {
    if (!values) continue;
    const row = body.insertRow(), cell = node('th', '', label); cell.scope = 'row'; row.append(cell);
    for (const day of [1, 3, 7]) {
      const value = values[day - 1];
      row.append(node('td', '', value === null ? '—' : `${fmt(value)} 人`));
    }
  }
  return table;
}

export function createLaunchCurves({ $, params, onChange }) {
  const section = $('launchCurves'), genre = $('launchCurveGenre'), status = $('launchCurveStatus');
  const results = $('launchCurveResults'), scope = $('launchCurveRegion');
  scope.value = regionOf(params.get('launch_region'));
  let pending, game, gameId, cutoff, token = 0;

  function render(data, id) {
    const region = scope.value;
    const comparison = launchComparison(data, id, genre.value, cutoff, region);
    const { game, peers, typicalDay, gameRemaining, remainingOnDay7 } = comparison;
    const releaseType = game.edition === 'early_access' ? 'Steam 搶先體驗' : 'Steam 商店上市';
    const source = comparison.measurementSource === 'mixed' ? ' · 首週量測方式曾切換' : '';
    status.textContent = `${game.date} · ${releaseType} · ${regionNames[region]} Twitch${source}`;
    results.replaceChildren();
    const legend = node('p', 'tw-launch-legend');
    legend.append(node('span', 'tw-launch-key tw-launch-key-game', '這款遊戲'));
    if (typicalDay) legend.append(node('span', 'tw-launch-key tw-launch-key-peer', `同類中位數 · ${fmt(peers)} 款`));
    results.append(heatSummary(comparison), legend, viewerChart(game.daily, typicalDay, region), compactTable(comparison));
    if (!typicalDay) results.append(node('p', 'tw-trial-coverage', `同類有 ${fmt(peers)} 款首週資料齊全。至少需要 ${MIN_PEERS} 款才顯示比較線。`));
    if (gameRemaining !== null || remainingOnDay7 !== null) {
      const format = value => value === null ? '—' : `${fmt(value)}%`;
      results.append(node('p', 'tw-trial-coverage', `第 7 天相對第 1 天的觀眾比例 · 這款 ${format(gameRemaining)}${typicalDay ? ` · 同類中位數 ${format(remainingOnDay7)}` : ''}`));
    }
  }

  genre.addEventListener('change', () => {
    params.set('launch_genre', genre.value); onChange();
    if (pending) pending.then(data => { if (data && !section.hidden && data.games[gameId]) render(data, gameId); });
  });
  scope.addEventListener('change', () => {
    params.set('launch_region', scope.value); onChange();
    if (pending) pending.then(data => { if (data && !section.hidden && data.games[gameId]) render(data, gameId); });
  });
  return {
    async update(id, selectedGame, selectedEnd, refresh) {
      const until = Math.min(dateStart(dayOf(Date.now())), dateStart(dayOf(selectedEnd)) + DAY);
      if (!refresh && game === selectedGame && cutoff === until) return;
      const request = ++token;
      game = selectedGame; gameId = id; cutoff = until;
      section.hidden = true;
      const reference = selectedGame.release_reference;
      if (!reference?.steam_appid || reference.precision !== 'day') return;
      if (refresh) pending = null;
      pending ||= RadarStorage.readJSON('./data/twitch-launch-curves.json', validCurves, { force:refresh, allowStale:false });
      const data = await pending;
      if (request !== token) return;
      if (!data) { pending = null; game = null; return; }
      const entry = data.games[id];
      if (!entry || entry.date !== reference.date || !entry.genres.length) return;
      const choice = params.get('launch_genre');
      genre.replaceChildren(...entry.genres.map(key => {
        const option = node('option', '', data.genres[key]); option.value = key; return option;
      }));
      genre.value = entry.genres.includes(choice) ? choice : entry.genres[0];
      render(data, id);
      section.hidden = false;
    },
    reset() { token++; game = null; gameId = null; section.hidden = true; },
  };
}
