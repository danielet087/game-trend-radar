import { RadarStorage } from '../../data/storage.ts';
import { fmt, node } from './presentation.js';
import { dateStart, dayOf } from './series.js';
import { quantile } from './statistics-model.js';
import { timestamp } from './metrics.js';

const DAYS = 7;
const DAY = 86_400_000;
const MIN_PEERS = 5;
const NS = 'http://www.w3.org/2000/svg';
const measured = value => Number.isFinite(value) && value >= 0;

function validCurves(data) {
  return data?.schema_version === 1 && Boolean(timestamp(data.generated_at)) && data.genres && typeof data.genres === 'object' &&
    data.games && typeof data.games === 'object' && !Array.isArray(data.games) &&
    Object.values(data.games).every(game => Number.isFinite(dateStart(game.date)) &&
      ['early_access', 'standard_store_date'].includes(game.edition) && Array.isArray(game.genres) &&
      game.genres.every(genre => typeof data.genres[genre] === 'string') &&
      Array.isArray(game.daily) && game.daily.length === DAYS && game.daily.every(value => value === null || measured(value)));
}

export function launchComparison(data, id, genre, until = Infinity) {
  const game = data.games[id];
  const release = dateStart(game.date);
  const daily = game.daily.map((value, i) => release + (i + 2) * DAY <= until ? value : null);
  const peers = Object.entries(data.games).filter(([otherId, other]) => otherId !== id &&
    other.edition === game.edition && other.genres.includes(genre) && other.daily.every(measured) &&
    dateStart(other.date) + (DAYS + 1) * DAY <= Math.min(until, release)).map(([, other]) => other);
  const typicalDay = peers.length >= MIN_PEERS ? daily.map((_, i) => quantile(peers.map(peer => peer.daily[i]), .5)) : null;
  const retained = (value, start) => measured(value) && start > 0 ? value / start * 100 : null;
  const remainingOnDay7 = peers.length >= MIN_PEERS
    ? quantile(peers.map(peer => retained(peer.daily.at(-1), peer.daily[0])), .5) : null;
  return { game: { ...game, daily }, peers: peers.length, typicalDay, gameRemaining: retained(daily.at(-1), daily[0]), remainingOnDay7 };
}

function svgNode(tag, attrs, value) {
  const element = document.createElementNS(NS, tag);
  for (const [name, setting] of Object.entries(attrs)) element.setAttribute(name, String(setting));
  if (value !== undefined) element.textContent = value;
  return element;
}

function viewerChart(game, typical) {
  const svg = svgNode('svg', { viewBox:'0 0 420 174', role:'img', 'aria-label':'上市後首週每日全球觀眾中位數' });
  const maximum = Math.max(2, ...game.filter(measured), ...(typical || []));
  const x = i => 58 + i * 55;
  const y = value => 142 - value / maximum * 120;
  for (const tick of [0, maximum / 2, maximum]) {
    svg.append(svgNode('line', { x1:x(0), x2:x(DAYS - 1), y1:y(tick), y2:y(tick), class:'tw-launch-grid' }),
      svgNode('text', { x:51, y:y(tick) + 4, 'text-anchor':'end' }, fmt(tick)));
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
  const results = $('launchCurveResults');
  let pending, game, gameId, cutoff, token = 0;

  function render(data, id) {
    const comparison = launchComparison(data, id, genre.value, cutoff);
    const { game, peers, typicalDay, gameRemaining, remainingOnDay7 } = comparison;
    const releaseType = game.edition === 'early_access' ? 'Steam 搶先體驗' : 'Steam 商店上市';
    status.textContent = `${game.date} · ${releaseType} · 全球 Twitch`;
    results.replaceChildren();
    const legend = node('p', 'tw-launch-legend');
    legend.append(node('span', 'tw-launch-key tw-launch-key-game', '這款遊戲'));
    if (typicalDay) legend.append(node('span', 'tw-launch-key tw-launch-key-peer', `同類中位數 · ${fmt(peers)} 款`));
    results.append(legend, viewerChart(game.daily, typicalDay), compactTable(comparison));
    if (!game.daily.some(measured)) results.append(node('p', 'tw-trial-coverage', '這款遊戲的首週逐時紀錄仍不足。'));
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
