import { HOUR } from './metrics.js';
import { dateStart, dayOf, seriesRows } from './series.js';
import { quantile } from './statistics-model.js';

export const TRIAL_GAME_LIMIT = 8;
export const TRIAL_MIN_DAYS = 3;
const DAY = 24 * HOUR;
const WINDOW_DAYS = 7;

export function streamHour(value) {
  return /^\d{1,2}$/.test(value ?? '') && Number(value) < 24 ? Number(value) : 20;
}

export function trialWindow(hour, now = Date.now()) {
  const today = dateStart(dayOf(now));
  const slots = Array.from({ length: WINDOW_DAYS }, (_, i) => today - (WINDOW_DAYS - i) * DAY + streamHour(hour) * HOUR);
  return { slots, start: slots[0], end: slots.at(-1), today, now };
}

export function trialGames(index, games, window, region) {
  const peak = game => region === 'zh' ? game.chinesePeak : game.peak;
  return games.flatMap(game => {
    const release = index.games[game.id]?.release_reference;
    const released = release?.precision === 'day' ? dateStart(release.date) : NaN;
    const last = Date.parse(game.last);
    if (game.status !== 'active' || !(peak(game) > 0) || !Number.isFinite(released) ||
        released < window.today - 30 * DAY || released > window.end || last < window.start || last > window.now) return [];
    return [{ ...game, released, releaseDate: release.date, releaseSource: release.source }];
  }).sort((a, b) => peak(b) - peak(a) || a.id.localeCompare(b.id)).slice(0, TRIAL_GAME_LIMIT);
}

export function trialSample(index, chunks, game, window, region) {
  const paired = window.slots.filter(at => at >= game.released)
    .map(at => seriesRows(index, chunks, game.id, at, at, region)[0])
    .filter(row => row.status === 'observed' && Number.isSafeInteger(row.viewer_count) &&
      Number.isSafeInteger(row.streamer_count) && (row.streamer_count > 0 || row.viewer_count === 0));
  const days = paired.length;
  return {
    days, totalDays: window.slots.length,
    viewers: days >= TRIAL_MIN_DAYS ? quantile(paired.map(row => row.viewer_count), .5) : null,
    streamers: days >= TRIAL_MIN_DAYS ? quantile(paired.map(row => row.streamer_count), .5) : null,
  };
}

export function sortTrialGames(rows, region, sort) {
  const audience = row => row.samples[region];
  return rows.filter(row => audience(row).viewers > 0 && audience(row).streamers > 0).sort((a, b) =>
    (sort === 'competition' ? audience(a).streamers - audience(b).streamers : 0) ||
    audience(b).viewers - audience(a).viewers || audience(a).streamers - audience(b).streamers || a.game.id.localeCompare(b.game.id));
}
