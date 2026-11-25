// Every launch in a copy of the site's data folder, counted the way the pages
// count it: an Early Access start and its full release are two launches, and
// each launch's days start where src/features/twitch/launch-model.js puts
// them (scripts/build_twitch_launch_curves.py does the same for the curves).
//
// DATA_DIR holds twitch_series/index.json, twitch_series/<game>/<month>.json,
// catalog.json and (for Early Access starts to the hour) store_facts.json.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOUR } from '../src/features/twitch/metrics.js';
import { dateStart, fullSeriesRows } from '../src/features/twitch/series.js';
import { launchDays, launchInstant, launchStart, steamAppOf } from '../src/features/twitch/launch-model.js';
import { gameLaunches } from '../src/features/twitch/launches.js';

export function readLaunches(dir) {
  const read = path => JSON.parse(readFileSync(join(dir, path), 'utf8'));
  const index = read('twitch_series/index.json');
  const catalog = existsSync(join(dir, 'catalog.json')) ? read('catalog.json') : { games: [] };
  const facts = existsSync(join(dir, 'store_facts.json')) ? read('store_facts.json').games ?? {} : {};
  const releaseTimes = new Map((catalog.games || []).map(game => [String(game.appid), game.release_time_utc]));
  const latest = Math.max(...Object.values(index.months).flatMap(hours => Object.keys(hours).map(Date.parse))) + HOUR;
  const dataStart = Math.min(...Object.values(index.games).map(game => Date.parse(game.first_hour)).filter(Number.isFinite));
  const games = [], launches = [];
  for (const [id, game] of Object.entries(index.games)) {
    const chunks = {};
    for (const month of game.months || []) {
      const path = `twitch_series/${id}/${month}.json`;
      if (existsSync(join(dir, path))) chunks[month] = read(path);
    }
    let rows;
    try { rows = fullSeriesRows(index, chunks, id); } catch { continue; }
    const now = Math.min(Date.parse(game.last_hour) + HOUR, latest);
    const name = game.display_name || game.name;
    games.push({ id, name, game, rows, now });
    const appid = steamAppOf(game), exact = releaseTimes.get(appid ?? '');
    const both = gameLaunches(game), found = [];
    if (both) {
      const day = both.earlyAccess.date, started = Date.parse(facts[appid]?.early_access?.started_at);
      found.push(['early_access', Number.isFinite(started) && Math.abs(started - dateStart(day)) <= 36 * HOUR
        ? started - started % HOUR : launchInstant({ date: day, precision: 'day' }, exact)]);
      if (both.fullRelease) found.push(['full_release', launchInstant({ date: both.fullRelease.date, precision: 'day' }, exact)]);
    } else {
      found.push(['release', launchInstant(game.release_reference, exact)]);
    }
    for (const [kind, launchAt] of found) {
      if (!Number.isFinite(launchAt) || launchAt < dataStart) continue;
      const start = launchStart(rows, launchAt, now, { walkBack: kind !== 'full_release' });
      const days = launchDays(rows, start.startAt, now);
      launches.push({ id, name, game, kind, launchAt, ...start, rows, now, days, value: k => days[k]?.median ?? null });
    }
  }
  return { index, games, launches, latest, dataStart };
}
