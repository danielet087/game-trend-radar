const test = require('node:test');
const assert = require('node:assert/strict');
const { validateQueue, normalizeRun, runState, buildSlots, dashboardState, eventHistory } = require('../assets/radar-scheduler-v1.js');

const now = Date.parse('2026-10-03T07:30:00Z');
function queue() {
  return { schema_version: 1, generated_at: '2026-10-03T07:20:00Z', today_taipei: '2026-10-03',
    summary: { normal_pending: 1, twitch_priority_pending: 1, ready_pending: 2, parked: 1, total_pending: 3 },
    queue: [{ appid: 1, priority: true }, { appid: 2, priority: false }], parked: [{ appid: 3 }], events: [] };
}
function run(workflow = 'steam-official-daily-catchup-250.yml', repo = 'game-trend-radar-backend', overrides = {}) {
  return normalizeRun({ id: '37105223144', path: '.github/workflows/' + workflow,
    display_title: 'Observed | slot=2026-10-03T07:00:00Z | source=cloudflare',
    created_at: '2026-10-03T07:00:20Z', run_started_at: '2026-10-03T07:01:00Z', updated_at: '2026-10-03T07:10:00Z',
    status: 'completed', conclusion: 'success', ...overrides }, repo);
}

test('queue validation rejects unknown counts, missing items and duplicate AppIDs', () => {
  assert.equal(validateQueue(queue()).summary.total_pending, 3);
  const unknown = queue(); unknown.summary.normal_pending = null;
  assert.throws(() => validateQueue(unknown), /queue_counts/);
  const missing = queue(); missing.queue.pop();
  assert.throws(() => validateQueue(missing), /queue_mismatch/);
  const duplicate = queue(); duplicate.parked[0].appid = 1;
  assert.throws(() => validateQueue(duplicate), /queue_ids/);
});

test('queued workflow has no actual start and large run IDs retain canonical links', () => {
  const pending = run(undefined, undefined, { status: 'queued', conclusion: null });
  assert.equal(pending.started_at, null);
  assert.match(pending.url, /37105223144$/);
  assert.equal(runState(pending, queue(), null).text, '排隊／等待中');
});

test('Twitch whole-hour batch maps to the :05 scheduled point, without inventing other successes', () => {
  const observed = run('collect.yml', 'game-trend-radar-twitch-backend');
  const lanes = buildSlots('2026-10-03', [observed], queue(), null, now);
  assert.equal(lanes.flatMap(l => l.slots).length, 73);
  const twitch = lanes.find(l => l.job.id === 'twitch');
  assert.equal(twitch.slots[15].state, 'success');
  assert.equal(twitch.slots[15].at, Date.parse('2026-10-03T07:05:00Z'));
  assert.equal(twitch.slots[14].state, 'unknown');
  assert.equal(twitch.slots[16].state, 'planned');
});

test('successful Actions workflow is interrupted when its actual Steam attempt gets 429', () => {
  const q = queue(); q.events.push({ at: '2026-10-03T07:02:00Z', http: 429, status: 'rate_limited', appid: 1, name: 'Game' });
  assert.equal(runState(run(), q, null).state, 'interrupted');
  const unrelated = run(undefined, undefined, { run_started_at: '2026-10-03T07:03:00Z' });
  assert.equal(runState(unrelated, q, null).state, 'success');
});

test('persisted batch run ID identifies a no-request cooldown even without start metadata', () => {
  const q = queue(); q.batch = { run_id: '37105223144', stop_reason: 'cooldown_no_request' };
  assert.equal(runState(run(undefined, undefined, { run_started_at: null }), q, null).state, 'waiting');
});

test('growth completion, bounded work and source failure use actual measurement results', () => {
  const r = run('steam-public-growth.yml');
  for (const [status, expected] of [['completed', 'success'], ['bounded_run', 'waiting'], ['source_unavailable', 'interrupted'], ['rate_limited', 'interrupted']]) {
    const growth = { generated_at: '2026-10-03T07:25:00Z', collection: { at: '2026-10-03T07:03:00Z', status, measurements: 1 } };
    assert.equal(runState(r, queue(), growth).state, expected);
    const measurement = eventHistory(queue(), [r], growth, now).find(e => e.id === 'growth-measurement');
    assert.equal(measurement.state, expected);
    assert.equal(measurement.at, Date.parse(growth.collection.at));
  }
  assert.equal(runState(r, queue(), null).state, 'success');
  assert.equal(eventHistory(queue(), [], { generated_at: '2026-10-03T07:25:00Z', collection: { at: '2026-10-01T07:03:00Z', status: 'completed' } }, now).length, 0);
});

test('stale zero-count snapshot cannot claim current completion', () => {
  const q = queue(); q.generated_at = '2026-10-02T07:20:00Z'; q.today_taipei = '2026-10-02';
  q.summary.ready_pending = 0;
  assert.equal(dashboardState(q, [], {}, now).state, 'unknown');
});

test('stale API active state does not claim a live workflow', () => {
  const active = run(undefined, undefined, { status: 'in_progress', conclusion: null });
  assert.equal(runState(active, queue(), null, false).state, 'unknown');
  assert.equal(dashboardState(queue(), [active], { 'game-trend-radar-backend': false }, now).state, 'waiting');
  assert.equal(dashboardState(queue(), [active], { 'game-trend-radar-backend': true }, now).state, 'running');
});
