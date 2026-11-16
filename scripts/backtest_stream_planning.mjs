import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DEFAULT_REGION, forRegion, isIndependentChineseMeasurement } from '../src/features/twitch/audience-region.js';
import { analyzeCooldown } from '../src/features/twitch/cooldown-model.js';
import { validHistoryHours } from '../src/features/twitch/history.js';
import { DEFAULT_FILTER, DEFAULT_SORT, HOUR, canonicalID, count } from '../src/features/twitch/metrics.js';
import { selectObservation } from '../src/features/twitch/selection.js';
import { dateStart, dayOf } from '../src/features/twitch/series.js';
import { normalize } from '../src/features/twitch/snapshot.js';
import { quantile } from '../src/features/twitch/statistics-model.js';
import { MIN_PAIRED_HEAT_HOURS, STREAM_HEAT_DAYS, STREAM_HEAT_WEEK, remainingAudienceTrend } from '../src/features/twitch/stream-heat-model.js';

const DAY = 24 * HOUR;
const PICKS = 10;
const FOLLOW_UP_DAYS = 3;
const validSha = revision => typeof revision === 'string' && /^[0-9a-f]{40}$/.test(revision);
const stamp = value => new Date(value).toISOString();
const median = values => values.length ? quantile(values, .5) : null;

function pastDays(start) {
  return Array.from({ length:STREAM_HEAT_WEEK }, (_, i) => dayOf(start - (STREAM_HEAT_WEEK - i) * DAY));
}

function followingDays(start) {
  return Array.from({ length:FOLLOW_UP_DAYS }, (_, i) => dayOf(start + (i + 1) * DAY));
}

function sourceRows(days, gameId, independent, available) {
  return days.flatMap(day => day.get(gameId) ?? []).filter(row =>
    Date.parse(row.generated_at) <= available && isIndependentChineseMeasurement(row) === independent);
}

function dailyMeasurements(rows, days, releaseDate, cutoff) {
  const result = analyzeCooldown(rows, { region:'zh', releaseDate, now:cutoff });
  const scores = new Map(result.days.map(day => [day.date, day]));
  const remaining = new Map();
  const released = dateStart(releaseDate);
  for (const row of rows) {
    const viewers = count(row.viewer_count), largest = count(row.largest_stream_viewer_count);
    const at = Date.parse(row.hour);
    if (at < released || viewers === null || largest === null || largest > viewers) continue;
    const date = dayOf(at);
    if (!remaining.has(date)) remaining.set(date, []);
    remaining.get(date).push(viewers - largest);
  }
  return days.map(date => {
    const day = scores.get(date), samples = remaining.get(date) ?? [];
    return { hot:day?.complete ? !day.belowThreshold : null,
      otherViewers:samples.length >= MIN_PAIRED_HEAT_HOURS ? median(samples) : null };
  });
}

export function sustainedHeat(days) {
  if (days.filter(day => day.hot === true).length >= 2) return true;
  if (days.filter(day => day.hot === false).length >= 2) return false;
  return null;
}

function scoreLine(games) {
  const audience = games.map(game => game.futureOtherViewers).filter(value => value !== null);
  return {
    picks:games.length,
    hit:games.filter(game => game.sustainedHeat === true).length,
    unknown:games.filter(game => game.sustainedHeat === null).length,
    otherViewerSamples:audience.length,
    medianOtherViewers:median(audience),
    games:games.map(({ id, name, hotDays, comparableDays, otherViewerTrend, sustainedHeat, futureOtherViewers }) =>
      ({ id, name, hotDays, comparableDays, otherViewerTrend, sustainedHeat, futureOtherViewers })),
  };
}

export function replayDecision(deployment, outcomeRevision, reader, outcomeGeneratedAt) {
  const start = dateStart(deployment.date), cutoff = start + 11 * HOUR;
  const available = Date.parse(deployment.available_at);
  if (!Number.isFinite(cutoff) || !Number.isFinite(available) || available > cutoff || !validSha(deployment.revision)) {
    throw new Error('Expected a pinned Pages deployment available by 11:00 Taipei time');
  }
  const revision = deployment.revision;
  const live = reader.json(revision, 'data/twitch_live.json');
  if (!live || !(Date.parse(live.generated_at) <= available)) throw new Error('Deployment has no matching Twitch snapshot');
  const data = normalize(live, reader.json(revision, 'data/twitch_tracking.json'),
    reader.json(revision, 'data/twitch_steam_mapping.json'), reader.json(revision, 'data/catalog.json'));
  const index = reader.json(revision, 'data/twitch_series/index.json');
  const orderByRegion = region => selectObservation({ data, filter:DEFAULT_FILTER, sort:DEFAULT_SORT, region }).visible;
  const baseline = orderByRegion('zh');
  const independent = Boolean(live.coverage?.chinese_collection);
  const prior = pastDays(start), future = followingDays(start);
  const outcomeEnd = start + (FOLLOW_UP_DAYS + 1) * DAY;
  const outcomeClock = Date.parse(outcomeGeneratedAt);
  const mature = outcomeClock >= outcomeEnd;
  const training = prior.map(date => reader.day(revision, date));
  const outcomes = mature ? future.map(date => reader.day(outcomeRevision, date)) : [];

  const games = baseline.map(game => {
    const id = game.game_id;
    const reference = index?.games?.[id]?.release_reference;
    const releaseDate = reference?.precision === 'day' ? reference.date : null;
    const past = sourceRows(training, id, independent, available);
    const history = dailyMeasurements(past, prior, releaseDate, cutoff);
    const followUp = mature ? dailyMeasurements(sourceRows(outcomes, id, independent, outcomeClock), future, releaseDate, outcomeEnd) : [];
    const comparableDays = history.filter(day => day.hot !== null).length;
    const other = remainingAudienceTrend(past, { date:prior.at(-1), now:available, releaseDate })
      .map(day => day.viewers).filter(value => value !== null);
    return { id, name:game.game_name, comparableDays,
      hotDays:comparableDays ? history.filter(day => day.hot).length : null,
      otherViewerTrend:other.length >= STREAM_HEAT_DAYS ? median(other) : null,
      sustainedHeat:sustainedHeat(followUp),
      futureOtherViewers:followUp.length && followUp.every(day => day.otherViewers !== null)
        ? median(followUp.map(day => day.otherViewers)) : null };
  });
  const moreHotDays = (a, b) => (b.hotDays ?? -1) - (a.hotDays ?? -1);
  const moreOtherViewers = (a, b) => Number(b.otherViewerTrend !== null) - Number(a.otherViewerTrend !== null)
    || (b.otherViewerTrend ?? 0) - (a.otherViewerTrend ?? 0);
  const otherViewerCandidates = games.filter(game => game.otherViewerTrend !== null).length;
  const gamesById = new Map(games.map(game => [game.id, game]));
  return {
    date:deployment.date, cutoff:stamp(cutoff), deployment, snapshotAt:live.generated_at,
    measurement:independent ? 'helix_language_filter' : 'global_census',
    outcomeAvailableFrom:stamp(outcomeEnd), mature, candidates:games.length, otherViewerCandidates,
    rankings:{
      current:scoreLine(games.slice(0, PICKS)),
      currentGlobal:scoreLine(orderByRegion(DEFAULT_REGION).slice(0, PICKS).map(game => gamesById.get(game.game_id))),
      hotDays:scoreLine(games.toSorted(moreHotDays).slice(0, PICKS)),
      hotDaysAndOtherViewers:otherViewerCandidates >= PICKS
        ? scoreLine(games.toSorted((a, b) => moreHotDays(a, b) || moreOtherViewers(a, b)).slice(0, PICKS)) : null,
    },
  };
}

const git = args => execFileSync('git', args, { encoding:'utf8', timeout:30_000, maxBuffer:128 * 1024 * 1024 });

function gitReader() {
  const cache = new Map();
  const object = (revision, path) => git(['ls-tree', '--format=%(objectname)', revision, '--', path]).trim();
  const json = sha => sha ? JSON.parse(git(['cat-file', 'blob', sha])) : null;
  return {
    json(revision, path) { return json(object(revision, path)); },
    day(revision, date) {
      const sha = object(revision, `data/twitch_history/${date}.json`);
      if (!sha) return new Map();
      if (cache.has(sha)) return cache.get(sha);
      const file = json(sha);
      if (file?.date !== date || file.schema_version !== 1 || file.timezone !== 'Asia/Taipei' || !file.hours) {
        throw new Error(`Invalid historical snapshot for ${date}`);
      }
      const samples = new Map();
      for (const { time, entry } of validHistoryHours(file, Infinity)) {
        const hour = stamp(time), seen = new Set();
        for (const game of entry.games) {
          const id = canonicalID(game?.game_id);
          if (!id || seen.has(id) || ['retained', 'stale'].includes(game.observation_status) || game.observation_freshness === 'stale') continue;
          seen.add(id);
          const row = forRegion(game, 'zh');
          if (row.viewer_count === null) continue;
          if (!samples.has(id)) samples.set(id, []);
          samples.get(id).push({ hour, generated_at:entry.generated_at, status:'observed', viewer_count:row.viewer_count, streamer_count:row.streamer_count,
            largest_stream_viewer_count:row.largest_stream_viewer_count,
            audience_regions:{ zh:{ measurement_source:row.audience_regions.zh.measurement_source } } });
        }
      }
      cache.set(sha, samples);
      return samples;
    },
  };
}

function summarize(reports, ranking) {
  const scored = reports.flatMap(report => report.mature && report.rankings[ranking] ? [report.rankings[ranking]] : []);
  const audience = scored.flatMap(row => row.games.map(game => game.futureOtherViewers)).filter(value => value !== null);
  return { days:scored.length, picks:scored.reduce((sum, row) => sum + row.picks, 0),
    hit:scored.reduce((sum, row) => sum + row.hit, 0), unknown:scored.reduce((sum, row) => sum + row.unknown, 0),
    otherViewerSamples:audience.length, medianOtherViewers:median(audience) };
}

function main([manifestFile, outcome = 'HEAD']) {
  if (!manifestFile || manifestFile === '--help') {
    console.log('node --import tsx scripts/backtest_stream_planning.mjs DEPLOYMENTS.json [OUTCOME_SHA]');
    console.log('DEPLOYMENTS.json: array of date, revision and available_at from completed GitHub Pages deployments.');
    console.log('Fetch the listed revisions into a local checkout before running. OUTCOME_SHA defaults to the current commit.');
    return;
  }
  if (outcome !== 'HEAD' && !validSha(outcome)) throw new Error('OUTCOME_SHA must be a full commit SHA');
  const outcomeRevision = git(['rev-parse', '--verify', `${outcome}^{commit}`]).trim();
  const entries = JSON.parse(readFileSync(manifestFile, 'utf8'));
  if (!Array.isArray(entries) || !entries.length || new Set(entries.map(entry => entry.date)).size !== entries.length) {
    throw new Error('Expected one deployment per decision date');
  }
  const reader = gitReader();
  const outcomeGeneratedAt = reader.json(outcomeRevision, 'data/twitch_series/index.json')?.generated_at;
  const reports = entries.toSorted((a, b) => a.date.localeCompare(b.date))
    .map(entry => replayDecision(entry, outcomeRevision, reader, outcomeGeneratedAt));
  const methods = ['currentGlobal', 'current', 'hotDays', 'hotDaysAndOtherViewers'];
  const measurements = new Set(reports.map(report => report.measurement));
  const byMeasurement = Object.fromEntries([...measurements].map(measurement => {
    const group = reports.filter(report => report.measurement === measurement);
    const expanded = group.filter(report => report.rankings.hotDaysAndOtherViewers);
    return [measurement, {
      summary:Object.fromEntries(methods.slice(0, -1).map(method => [method, summarize(group, method)])),
      sameDatesWithOtherViewers:Object.fromEntries(methods.map(method => [method, summarize(expanded, method)])),
    }];
  }));
  console.log(JSON.stringify({ outcomeRevision, outcomeGeneratedAt, byMeasurement, reports }, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
