import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replayDecision, sustainedHeat } from '../scripts/backtest_stream_planning.mjs';
import { dateStart } from '../src/features/twitch/series.js';
import { HOUR } from '../src/features/twitch/metrics.js';

const input = { date:'2026-11-09', revision:'a'.repeat(40), available_at:'2026-11-09T02:21:00Z' };
const outcome = 'b'.repeat(40);
const finished = '2026-11-13T00:00:00+08:00';

function fixture() {
  const ids = Array.from({ length:12 }, (_, i) => String(i + 1));
  const live = { schema_version:2, generated_at:'2026-11-09T02:15:00Z', min_viewers:7000, candidate_games:ids.map(id => ({
    game_id:id, game_name:`Game ${id}`, viewer_count:8000, streamer_count:30,
    audience_regions:{ zh:{ viewer_count:300 + Number(id), streamer_count:4 } },
    verification:{ status:'new', observed_at:'2026-11-09T02:15:00Z' },
  })) };
  const calls = [];
  return { calls,
    json(revision, path) {
      assert.equal(revision, input.revision);
      return path.endsWith('/twitch_live.json') ? live : null;
    },
    day(revision, date) {
      calls.push([revision, date]);
      return new Map(ids.map(id => [id, Array.from({ length:6 }, (_, i) => {
        const hour = new Date(dateStart(date) + (10 + i) * HOUR).toISOString();
        const growth = Math.min(Number(date.slice(-2)) - 2, 6) * (13 - Number(id));
        return { hour, status:'observed', viewer_count:200, streamer_count:4, largest_stream_viewer_count:100 + Number(id) - growth,
          generated_at:id === '12' && revision === input.revision ? '2026-11-09T03:01:00Z' : hour,
          audience_regions: id === '2' && date >= '2026-11-11'
            ? { zh:{ measurement_source:'helix_language_filter' } } : undefined };
      })]));
    },
  };
}

test('the morning replay pins candidates and ignores observations unavailable at the deployment', () => {
  const reader = fixture();
  const report = replayDecision(input, outcome, reader, finished);
  assert.equal(report.mature, true);
  assert.equal(report.candidates, 12);
  assert.equal(report.otherViewerCandidates, 11);
  assert.equal(report.rankings.current.games[0].id, '12');
  assert.equal(report.rankings.current.games[0].hotDays, null);
  assert.equal(report.rankings.hotDays.games[0].id, '11');
  assert.equal(report.rankings.hotDaysAndOtherViewers.games[0].id, '1');
  assert.equal(report.rankings.hotDaysAndOtherViewers.games[0].otherViewerTrend, 12);
  assert.equal(report.rankings.hotDaysAndOtherViewers.games.find(game => game.id === '2').sustainedHeat, null);
  assert.equal(report.rankings.hotDaysAndOtherViewers.otherViewerSamples, 9);
  assert(reader.calls.filter(([revision]) => revision === input.revision).every(([, date]) => date < input.date));
  assert.deepEqual(reader.calls.filter(([revision]) => revision === outcome).map(([, date]) => date),
    ['2026-11-10', '2026-11-11', '2026-11-12']);
});

test('the last outcome day must close and the input deployment cannot be from after the cutoff', () => {
  const reader = fixture();
  const report = replayDecision(input, outcome, reader, '2026-11-12T23:59:59+08:00');
  assert.equal(report.mature, false);
  assert.equal(report.rankings.current.unknown, 10);
  assert(reader.calls.every(([revision]) => revision === input.revision));
  assert.throws(() => replayDecision({ ...input, available_at:'2026-11-09T03:00:01Z' }, outcome, reader, finished), /11:00/);
});

test('two known hot or cool days are conclusive, with remaining missing combinations unknown', () => {
  const outcomeOf = (...values) => sustainedHeat(values.map(hot => ({ hot })));
  assert.equal(outcomeOf(true, null, true), true);
  assert.equal(outcomeOf(false, null, false), false);
  assert.equal(outcomeOf(true, false, null), null);
});
