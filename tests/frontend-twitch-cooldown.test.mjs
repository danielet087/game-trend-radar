import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCooldown } from '../src/features/twitch/cooldown-model.js';
import { releaseDayIndex } from '../src/features/twitch/cooldown.js';

const HOUR = 3600000, start = Date.parse('2026-10-01T00:00:00Z');
const hour = n => new Date(start + n * HOUR).toISOString().replace('.000Z', 'Z');
const rows = values => values.map((viewer_count, n) => ({ hour: hour(n), status: 'observed', viewer_count }));
const sequence = (...segments) => segments.flatMap(([length, value]) => Array(length).fill(value));

test('the marked crossing is distinct from confirmation after a full 24 elapsed hours', () => {
  const data = rows(sequence([48, 10000], [60, 1000])), result = analyzeCooldown(data);
  assert.equal(result.status, 'cooled'); assert.equal(result.episodes.length, 1);
  const event = result.episodes[0];
  assert.equal(event.baselineAt, hour(5)); assert.equal(event.baselineValue, 10000); assert.equal(event.thresholdValue, 5000);
  assert.equal(event.candidateAt, hour(51)); assert.equal(event.confirmedAt, hour(75));
  assert.equal(result.latest.declineFraction, .9); assert.equal(result.candidate, null);
  assert.equal(result.points[4].smooth, null); assert.equal(result.points[5].smooth, 10000);
});

test('a short tail is suspected and never turns a historical recording end into confirmation', () => {
  const result = analyzeCooldown(rows(sequence([48, 10000], [27, 1000])));
  assert.equal(result.status, 'suspected'); assert.equal(result.episodes.length, 0);
  assert.equal(result.candidate.candidateAt, hour(51));
  assert.equal(result.latest.candidateElapsedHours, 23);
});

test('a repeating day/night cycle and a single-hour spike do not produce a confirmed retreat', () => {
  const daily = rows(Array.from({ length: 7 * 24 }, (_, n) => n % 24 < 6 ? 10000 : 1000));
  assert.equal(analyzeCooldown(daily).episodes.length, 0);
  const spike = rows(Array.from({ length: 120 }, (_, n) => n === 30 ? 1000000 : 1000));
  const result = analyzeCooldown(spike);
  assert.equal(result.episodes.length, 0); assert.equal(result.status, 'watching');
  assert.equal(result.latest.baseline, 1000);
});

test('a rebound before confirmation cancels a candidate instead of leaving a false marker', () => {
  const result = analyzeCooldown(rows(sequence([48, 10000], [10, 1000], [36, 10000])));
  assert.equal(result.episodes.length, 0); assert.equal(result.candidate, null); assert.equal(result.status, 'watching');
});

test('missing, absent and physically omitted hours break continuity without becoming zero', () => {
  for (const status of ['missing', 'absent']) {
    const data = rows(sequence([48, 10000], [42, 1000])); data[70].status = status;
    const result = analyzeCooldown(data);
    assert.equal(result.episodes.length, 0); assert.equal(result.status, 'suspected');
    assert.equal(result.points[70].raw, null); assert.equal(result.points[75].smooth, null);
    assert.equal(result.candidate.candidateAt, hour(76));
    assert.equal(result.coverage.valid, data.length - 1);
  }
  const data = rows(sequence([48, 10000], [42, 1000])).filter(row => row.hour !== hour(70));
  assert.equal(analyzeCooldown(data).episodes.length, 0);
});

test('gaps preserve an earlier confirmed event but invalidate a claim of uninterrupted decline', () => {
  const data = rows(sequence([48, 10000], [55, 1000])); data[100].status = 'missing';
  const result = analyzeCooldown(data);
  assert.equal(result.episodes.length, 1); assert.equal(result.episodes[0].confirmedAt, hour(75));
  assert.equal(result.episodes[0].interruptedAt, hour(100));
  assert.equal(result.status, 'gap'); assert.equal(result.latest.smooth, null);
  assert.equal(result.candidate, null);
});

test('low observations after a gap reconfirm the same historical cycle without moving its onset', () => {
  const data = rows(sequence([48, 10000], [120, 1000])); data[100].status = 'missing';
  const prefix = analyzeCooldown(data.slice(0, 120));
  assert.equal(prefix.status, 'suspected'); assert.equal(prefix.candidate, null);
  assert.equal(prefix.episodes.length, 1); assert.equal(prefix.pendingRecheck.startedAt, hour(106));
  const result = analyzeCooldown(data);
  assert.equal(result.episodes.length, 1); assert.equal(result.status, 'cooled');
  assert.equal(result.episodes[0].candidateAt, hour(51)); assert.equal(result.episodes[0].confirmedAt, hour(75));
  assert.deepEqual(result.episodes[0].reconfirmations, [{ startedAt: hour(106), confirmedAt: hour(130) }]);
  assert.equal(result.pendingRecheck, null);
});

test('a real recovery across a gap stays attached to the original cycle before a second decline', () => {
  const data = rows(sequence([48, 10000], [48, 1000], [36, 8000], [50, 500])); data[90].status = 'missing';
  const recovered = analyzeCooldown(data.slice(0, 125));
  assert.equal(recovered.status, 'recovered'); assert.equal(recovered.episodes.length, 1);
  assert.equal(recovered.episodes[0].candidateAt, hour(51)); assert.equal(recovered.episodes[0].confirmedAt, hour(75));
  assert.equal(recovered.episodes[0].recoveryAt, hour(99)); assert.equal(recovered.episodes[0].recoveryConfirmedAt, hour(111));
  const result = analyzeCooldown(data);
  assert.equal(result.episodes.length, 2); assert.equal(result.status, 'cooled');
  assert.equal(result.episodes[1].candidateAt, hour(135)); assert.equal(result.episodes[1].confirmedAt, hour(159));
});

test('recovery requires elapsed evidence, then a new wave uses its own causal baseline', () => {
  const data = rows(sequence([48, 10000], [48, 1000], [36, 8000], [50, 500]));
  const result = analyzeCooldown(data);
  assert.equal(result.episodes.length, 2);
  const [first, second] = result.episodes;
  assert.equal(first.recoveryAt, hour(99)); assert.equal(first.recoveryConfirmedAt, hour(111));
  assert.equal(second.baselineValue, 8000); assert.equal(second.candidateAt, hour(135));
  assert.equal(second.confirmedAt, hour(159)); assert.equal(result.status, 'cooled');
  const recovering = analyzeCooldown(data.slice(0, 106));
  assert.equal(recovering.status, 'recovering'); assert.equal(recovering.episodes[0].recoveryConfirmedAt, null);
});

test('future peaks do not rewrite candidate or confirmed times from an earlier prefix', () => {
  const prefix = rows(sequence([48, 10000], [48, 1000]));
  const before = analyzeCooldown(prefix).episodes[0];
  const after = analyzeCooldown(rows(sequence([48, 10000], [48, 1000], [48, 100000]))).episodes[0];
  for (const key of ['candidateAt', 'confirmedAt', 'baselineAt', 'baselineValue', 'thresholdValue']) assert.equal(after[key], before[key]);
});

test('zero counts are real observations, with no invented peak or infinite percentage', () => {
  const zeros = analyzeCooldown(rows(Array(72).fill(0)));
  assert.equal(zeros.status, 'insufficient'); assert.equal(zeros.coverage.valid, 72);
  assert.equal(zeros.latest.smooth, 0); assert.equal(zeros.latest.declineFraction, null); assert.equal(zeros.episodes.length, 0);
  const fall = analyzeCooldown(rows(sequence([48, 10000], [48, 0])));
  assert.equal(fall.status, 'cooled'); assert.equal(fall.latest.declineFraction, 1);
});

test('normalization sorts timestamps without mutating input and rejects invalid measurements', () => {
  const data = [rows([10, 20])[1], rows([10])[0], { hour: '2026-10-01T08:00:00+08:00', status: 'observed', viewer_count: 30 },
    { hour: hour(2), status: 'observed', viewer_count: -1 }, { hour: hour(3), status: 'observed', viewer_count: '100' },
    { hour: '2026-10-01T03:30:00Z', status: 'observed', viewer_count: 999 }, { hour: 'invalid', status: 'observed', viewer_count: 999 }];
  const snapshot = JSON.stringify(data), result = analyzeCooldown(data);
  assert.equal(JSON.stringify(data), snapshot); assert.equal(result.points[0].raw, 30);
  assert.equal(result.coverage.valid, 2); assert.equal(result.coverage.total, 4);
  assert.equal(analyzeCooldown([]).status, 'insufficient'); assert.equal(analyzeCooldown(null).latest.hour, null);
  const settings = analyzeCooldown([], { dropFraction: NaN, confirmHours: 0 }).settings;
  assert.equal(settings.dropFraction, .5); assert.equal(settings.confirmHours, 24);
});

test('release day zero uses Taiwan calendar dates, including pre-release and uncertain dates', () => {
  assert.equal(releaseDayIndex('2026-09-30T16:00:00Z', '2026-10-01'), 0);
  assert.equal(releaseDayIndex('2026-10-01T15:59:00Z', '2026-10-01'), 0);
  assert.equal(releaseDayIndex('2026-10-01T16:00:00Z', '2026-10-01'), 1);
  assert.equal(releaseDayIndex('2026-10-08T04:00:00Z', '2026-10-01'), 7);
  assert.equal(releaseDayIndex('2026-09-30T04:00:00Z', '2026-10-01'), -1);
  assert.equal(releaseDayIndex('2026-10-01T00:00:00Z', '2026-02-30'), null);
  assert.equal(releaseDayIndex('invalid', '2026-10-01'), null);
  assert.equal(releaseDayIndex('2026-10-01T00:00:00Z', undefined), null);
});
