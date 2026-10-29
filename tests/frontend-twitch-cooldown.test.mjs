import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCooldown } from '../src/features/twitch/cooldown-model.js';
import { releaseDayIndex } from '../src/features/twitch/cooldown.js';

// Taipei 2026-10-01 00:00. Tests freeze the clock instead of depending on today.
const HOUR = 3600000, start = Date.parse('2026-09-30T16:00:00Z');
const hour = n => new Date(start + n * HOUR).toISOString().replace('.000Z', 'Z');
const rows = values => values.map((viewer_count, n) => ({ hour: hour(n), status: 'observed', viewer_count }));
const sequence = (...segments) => segments.flatMap(([length, value]) => Array(length).fill(value));
const analyze = (data, now = start + 1000 * HOUR) => analyzeCooldown(data, { now });
// A full earlier popular day establishes eligibility for cooldown-specific tests.
const analyzeEstablished = (data, now) => analyze([
  ...Array.from({ length: 24 }, (_, n) => ({ hour: hour(n - 24), status: 'observed', viewer_count: 10000 })), ...data,
], now);
const daily = (...values) => rows(values.flatMap(value => Array(24).fill(value)));
const omitDayHours = (data, day, missing) => data.filter(row => {
  const n = (Date.parse(row.hour) - start) / HOUR;
  return n < day * 24 || n >= day * 24 + missing;
});

test('relative decline records first inclusive 25/50/75 percent milestones without declaring cooldown', () => {
  const result = analyze(daily(100000, 80000, 75000, 50000, 25000, 90000, 20000));
  assert.equal(result.status, 'watching'); assert.equal(result.episodes.length, 0);
  assert.equal(result.relativeDecline.peak.median, 100000);
  assert.deepEqual(result.relativeDecline.milestones.map(item => [item.percent, item.thresholdValue, item.date, item.observedAt]), [
    [25, 75000, '2026-10-03', hour(72)], [50, 50000, '2026-10-04', hour(96)], [75, 25000, '2026-10-05', hour(120)],
  ]);
});

test('relative milestones exclude incomplete and open days and do not infer missing crossings', () => {
  const data = omitDayHours(daily(100000, 10000, 50000, 1000), 1, 13);
  const result = analyze(data, start + 95 * HOUR);
  assert.deepEqual(result.relativeDecline.milestones.map(item => item.date), ['2026-10-03', '2026-10-03', null]);
  assert.equal(result.relativeDecline.milestones[0].observedAt, hour(72));
  const tolerated = analyze(omitDayHours(daily(100000, 75000), 1, 12));
  assert.equal(tolerated.relativeDecline.milestones[0].date, '2026-10-02');
});

test('relative history rebases after a new high while fixed cooldown events remain unchanged', () => {
  const result = analyze(daily(10000, 1000, 1000, 1000, 20000, 15000, 10000, 5000));
  assert.equal(result.episodes[0].candidateAt, hour(24));
  assert.equal(result.episodes[0].confirmedAt, hour(96));
  assert.equal(result.relativeDecline.peak.date, '2026-10-05');
  assert.deepEqual(result.relativeDecline.milestones.map(item => item.date), ['2026-10-06', '2026-10-07', '2026-10-08']);
  assert.equal(analyze(daily(10000, 10000, 75000)).relativeDecline.milestones[0].date, null);
});

test('zero or missing peak has no relative milestones; a real zero after a positive peak reaches all levels', () => {
  for (const data of [[], daily(0, 0, 0)]) {
    assert.ok(analyze(data).relativeDecline.milestones.every(item => item.date === null && item.thresholdValue === null));
  }
  assert.deepEqual(analyze(daily(10000, 0)).relativeDecline.milestones.map(item => item.date), Array(3).fill('2026-10-02'));
});

test('three low Taipei days confirm at the third day end, distinct from the start date', () => {
  const result = analyze(daily(10000, 2999, 2999, 2999));
  assert.equal(result.status, 'cooled'); assert.equal(result.episodes.length, 1);
  const event = result.episodes[0];
  assert.equal(event.candidateAt, hour(24)); assert.equal(event.confirmedAt, hour(96));
  assert.equal(event.thresholdValue, 3000); assert.equal(event.days, 3);
  assert.equal(result.latest.median, 2999); assert.equal(result.latest.lowDays, 3);
  assert.equal(result.latest.day, '2026-10-04'); assert.equal(result.candidate, null);
  assert.equal(result.days[0].date, '2026-10-01'); assert.equal(result.days[0].startAt, hour(0));
  assert.equal(result.days[0].endAt, hour(24));
  assert.deepEqual(result.settings, { threshold: 3000, confirmDays: 3, timeZone: 'Asia/Taipei', maxMissingHours: 12, minValidHours: 12 });
});

test('never-popular games remain not popular and never accumulate cooldown days', () => {
  for (const length of [1, 2, 3, 10]) {
    const result = analyze(daily(...Array(length).fill(1000)));
    assert.equal(result.status, 'not_popular'); assert.equal(result.episodes.length, 0);
    assert.equal(result.candidate, null); assert.equal(result.latest.lowDays, 0);
    assert.equal(result.popularAt, null);
    assert.ok(result.days.every(day => day.lowDays === 0));
  }
});

test('a later breakout enables cooldown prospectively and does not count earlier low days', () => {
  const data = daily(1000, 1000, 1000, 5000, 2000, 2000, 2000);
  const before = analyze(data, start + 72 * HOUR);
  assert.equal(before.status, 'not_popular'); assert.equal(before.latest.lowDays, 0);
  const breakout = analyze(data, start + 96 * HOUR);
  assert.equal(breakout.status, 'watching'); assert.equal(breakout.popularAt, hour(72));
  const pending = analyze(data, start + 144 * HOUR);
  assert.equal(pending.status, 'suspected'); assert.equal(pending.latest.lowDays, 2);
  assert.equal(pending.episodes.length, 0); assert.equal(pending.candidate.candidateAt, hour(96));
  const cooled = analyze(data);
  assert.equal(cooled.status, 'cooled'); assert.equal(cooled.episodes.length, 1);
  assert.equal(cooled.episodes[0].candidateAt, hour(96)); assert.equal(cooled.episodes[0].confirmedAt, hour(168));
});

test('an hourly spike, incomplete high day or open high day cannot establish popularity', () => {
  const spike = daily(1000, 1000, 1000, 1000); spike[24].viewer_count = 100000;
  const result = analyze(spike);
  assert.equal(result.status, 'not_popular'); assert.equal(result.popularAt, null);
  assert.equal(result.latest.lowDays, 0);
  const incomplete = analyze(omitDayHours(daily(1000, 5000, 1000, 1000, 1000), 1, 13));
  assert.equal(incomplete.status, 'not_popular'); assert.equal(incomplete.popularAt, null);
  const open = analyze(daily(1000, 5000), start + 47 * HOUR);
  assert.equal(open.status, 'not_popular'); assert.equal(open.popularAt, null);
});

test('exactly 3000 establishes the threshold and missing days do not erase earlier eligibility', () => {
  const data = omitDayHours(daily(3000, 1000, 1000, 1000, 1000), 1, 13);
  const result = analyze(data);
  assert.equal(result.popularAt, hour(0)); assert.equal(result.status, 'cooled');
  assert.equal(result.episodes[0].candidateAt, hour(48));
  assert.equal(result.episodes[0].confirmedAt, hour(120));
});

test('exactly 3000 breaks a low run and begins no decline of its own', () => {
  const result = analyze(daily(2999, 2999, 3000, 2999, 2999));
  assert.equal(result.status, 'suspected'); assert.equal(result.episodes.length, 0);
  assert.equal(result.candidate.candidateAt, hour(72)); assert.equal(result.latest.lowDays, 2);
  assert.equal(result.days[2].belowThreshold, false); assert.equal(result.days[2].lowDays, 0);
  assert.equal(analyze(daily(3000, 3000, 3000)).status, 'watching');
});

test('falling from 100000 to 50000 never satisfies the fixed audience rule', () => {
  const result = analyze(daily(100000, 100000, 50000, 50000, 50000, 50000));
  assert.equal(result.status, 'watching'); assert.equal(result.episodes.length, 0);
  assert.equal(result.latest.median, 50000); assert.equal(result.candidate, null);
});

test('up to twelve missing hourly observations per closed day do not reset the run', () => {
  for (const missing of [0, 1, 11, 12]) {
    const result = analyzeEstablished(omitDayHours(daily(2000, 2000, 2000), 1, missing));
    assert.equal(result.status, 'cooled', `missing ${missing}`);
    assert.equal(result.episodes[0].candidateAt, hour(0));
    assert.equal(result.episodes[0].confirmedAt, hour(72));
    assert.equal(result.days[2].validHours, 24 - missing);
    assert.equal(result.days[2].missingHours, missing);
    assert.equal(result.days[2].median, 2000); assert.equal(result.days[2].complete, true);
  }
});

test('thirteen missing hours reset the run instead of joining nonconsecutive valid days', () => {
  const result = analyzeEstablished(omitDayHours(daily(2000, 2000, 2000, 2000, 2000), 2, 13));
  assert.equal(result.status, 'suspected'); assert.equal(result.episodes.length, 0);
  assert.equal(result.days[3].validHours, 11); assert.equal(result.days[3].median, null);
  assert.equal(result.days[3].complete, false); assert.equal(result.days[3].status, 'gap');
  assert.equal(result.candidate.candidateAt, hour(72)); assert.equal(result.latest.lowDays, 2);
});

test('a wholly omitted day is an explicit gap and is not replaced with zero', () => {
  const result = analyzeEstablished(omitDayHours(daily(1000, 1000, 1000, 1000, 1000), 2, 24));
  assert.equal(result.days.length, 6); assert.equal(result.days[3].median, null);
  assert.equal(result.days[3].missingHours, 24); assert.equal(result.episodes.length, 0);
  assert.equal(result.candidate.candidateAt, hour(72));
});

test('invalid and missing statuses share the same twelve-hour tolerance', () => {
  for (const status of ['missing', 'absent']) {
    const data = daily(1000, 1000, 1000);
    for (let n = 24; n < 36; n++) data[n].status = status;
    const allowed = analyzeEstablished(data);
    assert.equal(allowed.status, 'cooled'); assert.equal(allowed.points[48].raw, null);
    data[36].status = status;
    const interrupted = analyzeEstablished(data);
    assert.equal(interrupted.status, 'suspected'); assert.equal(interrupted.episodes.length, 0);
    assert.equal(interrupted.latest.lowDays, 1);
  }
});

test('medians use observed values only, with correct odd and even sample sizes', () => {
  // Twelve true observations at 4000 must not become a median of 2000 by padding.
  const padded = analyze(omitDayHours(daily(4000, 4000, 4000), 1, 12));
  assert.equal(padded.days[1].median, 4000); assert.equal(padded.days[1].belowThreshold, false);
  const even = analyze(rows(sequence([12, 0], [12, 6000])));
  assert.equal(even.latest.median, 3000); assert.equal(even.status, 'watching');
  const odd = analyze(rows(sequence([6, 0], [1, 2000], [6, 9000])));
  assert.equal(odd.latest.median, 2000); assert.equal(odd.days[0].validHours, 13);
  assert.equal(odd.status, 'not_popular');
});

test('an unfinished day cannot confirm even when all 24 hourly slots exist', () => {
  const data = daily(1000, 1000, 1000);
  const before = analyzeEstablished(data, start + 71.5 * HOUR);
  assert.equal(before.status, 'suspected'); assert.equal(before.episodes.length, 0);
  assert.equal(before.latest.lowDays, 2); assert.equal(before.latest.day, '2026-10-02');
  assert.equal(before.days[3].isClosed, false); assert.equal(before.days[3].complete, false);
  assert.equal(before.days[3].validHours, 24); assert.equal(before.days[3].median, null);
  const after = analyzeEstablished(data, start + 72 * HOUR);
  assert.equal(after.status, 'cooled'); assert.equal(after.episodes[0].confirmedAt, hour(72));
});

test('an open day does not reset the established run or provide early evidence of recovery', () => {
  const data = daily(1000, 1000, 1000, 3000);
  const before = analyzeEstablished(data, start + 73 * HOUR);
  assert.equal(before.status, 'cooled'); assert.equal(before.latest.lowDays, 3);
  assert.equal(before.episodes[0].recoveryAt, null); assert.equal(before.days.at(-1).status, 'open');
  const after = analyzeEstablished(data, start + 96 * HOUR);
  assert.equal(after.status, 'recovered'); assert.equal(after.episodes[0].recoveryAt, hour(72));
  assert.equal(after.episodes[0].recoveryConfirmedAt, hour(96));
});

test('a gap preserves the earlier confirmed event but requires three fresh low days', () => {
  const data = omitDayHours(daily(1000, 1000, 1000, 1000, 1000, 1000, 1000), 3, 13);
  const atGap = analyzeEstablished(data.filter(row => Date.parse(row.hour) < start + 96 * HOUR));
  assert.equal(atGap.status, 'gap'); assert.equal(atGap.episodes.length, 1);
  assert.equal(atGap.episodes[0].interruptedAt, hour(72)); assert.equal(atGap.episodes[0].recoveryAt, null);
  assert.equal(atGap.pendingRecheck.days, 0); assert.equal(atGap.pendingRecheck.startedAt, null);
  const pending = analyzeEstablished(data.filter(row => Date.parse(row.hour) < start + 144 * HOUR));
  assert.equal(pending.status, 'suspected'); assert.equal(pending.candidate, null);
  assert.equal(pending.pendingRecheck.startedAt, hour(96)); assert.equal(pending.pendingRecheck.days, 2);
  const result = analyzeEstablished(data);
  assert.equal(result.status, 'cooled'); assert.equal(result.episodes.length, 1);
  assert.equal(result.episodes[0].candidateAt, hour(0)); assert.equal(result.episodes[0].confirmedAt, hour(72));
  assert.deepEqual(result.episodes[0].reconfirmations, [{ startedAt: hour(96), confirmedAt: hour(168) }]);
  assert.equal(result.pendingRecheck, null);
});

test('a tolerated gap after confirmation keeps the original episode active', () => {
  const result = analyzeEstablished(omitDayHours(daily(1000, 1000, 1000, 1000), 3, 12));
  assert.equal(result.status, 'cooled'); assert.equal(result.episodes.length, 1);
  assert.equal(result.episodes[0].interruptedAt, null); assert.equal(result.latest.lowDays, 4);
});

test('a completed day at 3000 resolves an episode, including after a gap, then a new wave starts afresh', () => {
  const data = omitDayHours(daily(1000, 1000, 1000, 1000, 3000, 1000, 1000, 1000), 3, 13);
  const recovered = analyzeEstablished(data.filter(row => Date.parse(row.hour) < start + 120 * HOUR));
  assert.equal(recovered.status, 'recovered'); assert.equal(recovered.pendingRecheck, null);
  assert.equal(recovered.episodes[0].recoveryAt, hour(96));
  assert.equal(recovered.episodes[0].recoveryConfirmedAt, hour(120));
  const result = analyzeEstablished(data);
  assert.equal(result.episodes.length, 2); assert.equal(result.status, 'cooled');
  assert.equal(result.episodes[1].candidateAt, hour(120)); assert.equal(result.episodes[1].confirmedAt, hour(192));
});

test('future peaks do not rewrite the beginning or confirmation of an earlier event', () => {
  const before = analyzeEstablished(daily(1000, 1000, 1000)).episodes[0];
  const after = analyzeEstablished(daily(1000, 1000, 1000, 100000, 100000)).episodes[0];
  for (const key of ['candidateAt', 'confirmedAt', 'thresholdValue']) assert.equal(after[key], before[key]);
});

test('zero is a real observation and can confirm three days below the fixed threshold', () => {
  const result = analyzeEstablished(daily(0, 0, 0));
  assert.equal(result.status, 'cooled'); assert.equal(result.coverage.valid, 96);
  assert.equal(result.latest.median, 0); assert.equal(result.episodes.length, 1);
});

test('end of tracking does not invent days beyond the saved record or turn a large game cold', () => {
  const result = analyze(daily(50000, 50000, 50000));
  assert.equal(result.days.length, 3); assert.equal(result.status, 'watching');
  assert.equal(result.firstHour, hour(0)); assert.equal(result.lastHour, hour(71));
  const short = analyze(rows(Array(11).fill(1000)));
  assert.equal(short.days.length, 1); assert.equal(short.status, 'insufficient');
  assert.equal(short.latest.median, null);
});

test('future timestamps are ignored rather than completing a three-day window', () => {
  const result = analyzeEstablished(daily(1000, 1000, 1000), start + 48 * HOUR);
  assert.equal(result.points.length, 73); assert.equal(result.days[3].validHours, 1);
  assert.equal(result.episodes.length, 0); assert.equal(result.latest.lowDays, 2);
});

test('duplicate hourly timestamps do not add coverage, timezone aliases share one slot, and input stays unchanged', () => {
  const data = rows(Array(11).fill(1000));
  data.push({ hour: '2026-10-01T00:00:00+08:00', status: 'observed', viewer_count: 500 });
  const snapshot = JSON.stringify(data), result = analyze([...data].reverse().reverse());
  assert.equal(JSON.stringify(data), snapshot); assert.equal(result.points.length, 11);
  assert.equal(result.points[0].raw, 500); assert.equal(result.days[0].validHours, 11);
  assert.equal(result.status, 'insufficient');
});

test('invalid values are missing evidence and invalid or fractional-hour timestamps are ignored', () => {
  const data = rows(Array(24).fill(1000));
  for (const [n, value] of [-1, '100', NaN, Infinity, null, undefined].entries()) data[n].viewer_count = value;
  data.push({ hour: 'invalid', status: 'observed', viewer_count: 1000 },
    { hour: '2026-10-01T00:30:00Z', status: 'observed', viewer_count: 1000 });
  const result = analyze(data);
  assert.equal(result.coverage.valid, 18); assert.equal(result.coverage.total, 24);
  assert.equal(result.days[0].missingHours, 6); assert.equal(result.latest.median, 1000);
  assert.equal(analyze([]).status, 'insufficient'); assert.equal(analyze(null).latest.hour, null);
  assert.equal(analyze([]).days.length, 0);
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


