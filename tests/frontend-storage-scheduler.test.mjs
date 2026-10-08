import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateQueue, normalizeRun, runState, buildSlots, dashboardState, eventHistory, queueGameState, groupQueueCounts, igdbReceiptSummary } from '../src/features/scheduler/data.js';

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
function scheduled(workflow, hour, overrides = {}) {
  const minute = workflow === 'steam-public-growth.yml' ? 15 : 0;
  const at = Date.parse('2026-10-03T00:00:00+08:00') + (hour * 60 + minute) * 60000;
  return run(workflow, 'game-trend-radar-backend', { id: String(40000000000 + hour),
    display_title: 'Observed | slot=' + new Date(at).toISOString().replace('.000Z', 'Z') + ' | source=cloudflare',
    created_at: new Date(at + 20000).toISOString(), run_started_at: new Date(at + 60000).toISOString(),
    updated_at: new Date(at + 600000).toISOString(), ...overrides });
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
  const observed = run('collect.yml', 'game-trend-radar-twitch-backend', { run_started_at: '2026-10-03T07:06:00Z' });
  const lanes = buildSlots('2026-10-03', [observed], queue(), null, now);
  assert.equal(lanes.flatMap(l => l.slots).length, 80);
  const twitch = lanes.find(l => l.job.id === 'twitch');
  assert.equal(twitch.slots[15].state, 'success');
  assert.equal(twitch.slots[15].at, Date.parse('2026-10-03T07:05:00Z'));
  assert.equal(twitch.slots[14].state, 'unknown');
  assert.equal(twitch.slots[16].state, 'planned');
  assert.match(eventHistory(queue(), [observed], null, now)[0].detail, /原定 15:05 → 15:06 開始/);
});

test('daily candidate and growth schedules retry at six-hour intervals after failure', () => {
  const daily = scheduled('steam-two-phase.yml', 0, { conclusion: 'failure' });
  const growth = scheduled('steam-public-growth.yml', 1, { conclusion: 'failure' });
  const lanes = buildSlots('2026-10-03', [daily, growth], queue(), null, now);
  for (const [id, hours, minute] of [['steam_daily', [0, 6, 12, 18], 0], ['steam_growth', [1, 7, 13, 19], 15]]) {
    const lane = lanes.find(row => row.job.id === id);
    assert.deepEqual(lane.slots.map(slot => slot.hour), hours);
    assert.ok(lane.slots.every(slot => slot.minute === minute));
    assert.deepEqual(lane.slots.map(slot => slot.state), ['interrupted', 'unknown', 'unknown', 'planned']);
    assert.match(lane.job.note, /今日成功後略過/);
  }
});

test('candidate retry success skips later checks and keeps the original failure and actual later failure', () => {
  const failed = scheduled('steam-two-phase.yml', 0, { conclusion: 'failure' });
  const success = scheduled('steam-two-phase.yml', 6);
  const runs = [failed, success];
  const lane = buildSlots('2026-10-03', runs, queue(), null, now, { 'game-trend-radar-backend': false }).find(row => row.job.id === 'steam_daily');
  assert.deepEqual(lane.slots.map(slot => slot.state), ['interrupted', 'success', 'skipped', 'skipped']);
  assert.match(lane.slots[2].text, /06:10.*成功/);
  const skippedCheck = scheduled('steam-two-phase.yml', 12);
  const observed = buildSlots('2026-10-03', [...runs, skippedCheck], queue(), null, now).find(row => row.job.id === 'steam_daily');
  assert.equal(observed.slots[2].state, 'skipped');
  assert.equal(observed.slots[2].run.id, skippedCheck.id);
  assert.equal(eventHistory(queue(), [...runs, skippedCheck], null, now).find(event => event.id === 'run-' + skippedCheck.id).state, 'skipped');
  const laterFailure = { ...skippedCheck, conclusion: 'failure' };
  assert.equal(buildSlots('2026-10-03', [...runs, laterFailure], queue(), null, now).find(row => row.job.id === 'steam_daily').slots[2].state, 'interrupted');
});

test('candidate manual continuation and another Taiwan day never suppress daily checks', () => {
  const manual = scheduled('steam-two-phase.yml', 0, { display_title: 'Observed | slot=manual | source=manual' });
  assert.equal(manual.slot, 'manual');
  const wrongSlot = scheduled('steam-two-phase.yml', 1);
  const previousDay = { ...scheduled('steam-two-phase.yml', 0), slot: '2026-10-01T16:00:00Z',
    created_at: '2026-10-01T16:00:20Z', updated_at: '2026-10-01T16:10:00Z' };
  const crossedDay = { ...scheduled('steam-two-phase.yml', 0), updated_at: '2026-10-03T16:01:00Z' };
  const createdPreviousDay = { ...scheduled('steam-two-phase.yml', 0), created_at: '2026-10-02T15:59:00Z' };
  for (const observed of [manual, wrongSlot, previousDay, crossedDay, createdPreviousDay]) {
    const lane = buildSlots('2026-10-03', [observed], queue(), null, now).find(row => row.job.id === 'steam_daily');
    assert.ok(lane.slots.slice(1).every(slot => slot.state !== 'skipped'));
  }
});

test('growth skips only after the complete coverage gate succeeds, including complete manual work', () => {
  const success = scheduled('steam-public-growth.yml', 1);
  for (const verified of [undefined, false, true]) {
    const observed = { ...success, complete_growth_verified: verified };
    const lane = buildSlots('2026-10-03', [observed], queue(), null, now).find(row => row.job.id === 'steam_growth');
    assert.deepEqual(lane.slots.slice(1).map(slot => slot.state), verified ? ['skipped', 'skipped', 'skipped'] : ['unknown', 'unknown', 'planned']);
  }
  const manual = scheduled('steam-public-growth.yml', 1, { display_title: 'Observed | slot=manual | source=manual' });
  manual.complete_growth_verified = true;
  const lane = buildSlots('2026-10-03', [manual], queue(), null, now).find(row => row.job.id === 'steam_growth');
  assert.deepEqual(lane.slots.map(slot => slot.state), ['unknown', 'skipped', 'skipped', 'skipped']);
});

test('partial or interrupted growth measurement never suppresses six-hour retries', () => {
  const observed = { ...scheduled('steam-public-growth.yml', 1), complete_growth_verified: true };
  for (const status of ['bounded_run', 'source_unavailable', 'rate_limited']) {
    const growth = { collection: { at: '2026-10-02T17:18:00Z', status } };
    const lane = buildSlots('2026-10-03', [observed], queue(), growth, now).find(row => row.job.id === 'steam_growth');
    assert.ok(lane.slots.slice(1).every(slot => slot.state !== 'skipped'));
  }
});

test('stale active work and success after a scheduled point do not invent skipped checks', () => {
  const active = scheduled('steam-two-phase.yml', 0, { status: 'in_progress', conclusion: null });
  const lane = buildSlots('2026-10-03', [active], queue(), null, now, { 'game-trend-radar-backend': false }).find(row => row.job.id === 'steam_daily');
  assert.deepEqual(lane.slots.map(slot => slot.state), ['unknown', 'unknown', 'unknown', 'planned']);
  const slow = scheduled('steam-two-phase.yml', 0, { updated_at: '2026-10-02T22:05:00Z' });
  const later = buildSlots('2026-10-03', [slow], queue(), null, now).find(row => row.job.id === 'steam_daily');
  assert.equal(later.slots[1].state, 'unknown');
  assert.equal(later.slots[2].state, 'skipped');
});

test('IGDB uses its existing daily 08:30 workflow and keeps Steam queue results separate', () => {
  const q = queue();
  const observed = run('collect-nintendo.yml', 'game-trend-radar-twitch-backend', {
    display_title: 'IGDB catalog | slot=2026-10-03T00:30:00Z | cloudflare',
    created_at: '2026-10-03T00:30:20Z', run_started_at: '2026-10-03T00:31:00Z',
    updated_at: '2026-10-03T00:34:00Z',
  });
  assert.equal(observed.job_id, 'nintendo_daily');
  const lane = buildSlots('2026-10-03', [observed], q, null, now).find(row => row.job.id === 'nintendo_daily');
  assert.match(lane.job.name, /IGDB/);
  assert.match(lane.job.note, /NS／NS2／PS5/);
  assert.equal(lane.slots.length, 1);
  assert.equal(lane.slots[0].at, Date.parse('2026-10-03T08:30:00+08:00'));
  assert.equal(lane.slots[0].state, 'success');
  assert.equal(dashboardState(q, [observed], { 'game-trend-radar-twitch-backend': true }, now).state, 'waiting');
  assert.equal(validateQueue(q).summary.total_pending, 3);
});

test('IGDB publication counts come from valid receipts and missing or partial results stay unconfirmed', () => {
  const receipt = { schema_version: 1, generated_at: '2026-10-03T00:31:00Z', published_at: '2026-10-03T00:34:00Z',
    complete: true, status: 'published', candidate_count: 6000, public_count: 23, pending_count: 0,
    source: { provider: 'IGDB', complete: true, platform_ids_verified: [130, 167, 508] } };
  const result = igdbReceiptSummary(receipt);
  assert.equal(result.platforms, 'NS／NS2／PS5');
  assert.equal(result.published, true);
  assert.equal(result.candidateCount, 6000);
  assert.equal(result.publicCount, 23);
  assert.equal(result.pendingCount, 0);
  assert.equal(igdbReceiptSummary({ ...receipt, source: { ...receipt.source, platform_ids_verified: [167, 130, 508] } }).published, true);
  assert.equal(igdbReceiptSummary({ ...receipt, source: { ...receipt.source, platform_ids_verified: [130, 508] } }).platforms, 'NS／NS2');
  for (const fields of [{ complete: false }, { status: 'prepared' }, { published_at: null },
    { published_at: '2026-10-03T00:30:00Z' }, { source: { ...receipt.source, complete: false } }]) {
    assert.equal(igdbReceiptSummary({ ...receipt, ...fields }).published, false);
  }
  for (const fields of [{ generated_at: null }, { candidate_count: null }, { public_count: '23' },
    { pending_count: -1 }, { source: { ...receipt.source, platform_ids_verified: [130, 508, 169] } }]) {
    assert.equal(igdbReceiptSummary({ ...receipt, ...fields }), null);
  }
  assert.equal(igdbReceiptSummary(null), null);
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

test('unresolved groups expose their own API reason before a Followers cooldown', () => {
  const q = queue(); q.cooldown = { until: '2026-10-03T08:30:00Z' };
  const reasons = [
    ['not_found', /本次未取得 GroupID/], ['missing_api_key', /缺少 API Key/],
    ['api_rate_limited', /API 限流/], ['api_forbidden', /拒絕存取/],
    ['network_error', /網路錯誤/], ['api_error', /API 錯誤/],
    ['invalid_response', /回應無效/], [undefined, /等待群組 ID 解析/],
  ];
  for (const [status, label] of reasons) {
    const row = { appid: 2, state: 'awaiting_group', group_id64: null,
      group_resolution: { status, checked_at: '2026-10-03T07:10:00Z', source: 'steam_api' } };
    const state = queueGameState(row, q, now);
    assert.equal(state.awaitingGroup, true);
    assert.match(state.label, label);
    assert.doesNotMatch(state.detail, /Followers 冷卻結束後/);
  }
});

test('this-attempt no-match keeps a parked game awaiting resolution without claiming no group exists', () => {
  const q = queue(), game = { appid: 3, reason: 'official_xml_fallback_returned_html', group_id64: null,
    group_resolution: { status: 'not_found', checked_at: '2026-10-03T07:10:00Z', retry_at: '2026-10-03T08:00:00Z', http: 200 } };
  const state = queueGameState(game, q, now, true);
  assert.equal(state.stage, 'awaiting_group');
  assert.match(state.detail, /本次 API 回應未取得群組 ID/);
  assert.match(state.detail, /不代表該遊戲沒有群組/);
  assert.match(state.detail, /仍計入暫停項目/);
  assert.equal(q.summary.parked, 1);
  assert.ok(state.metadata.some(text => text.includes('解析 API HTTP 200')));
});

test('legacy snapshots do not turn absent or undefined group fields into unresolved IDs', () => {
  const q = queue(); q.cooldown = { until: '2026-10-03T08:30:00Z' };
  for (const game of [{ appid: 1 }, { appid: 1, group_id64: undefined }]) {
    const state = queueGameState(game, q, now);
    assert.equal(state.awaitingGroup, false);
    assert.equal(state.stage, 'legacy');
    assert.equal(state.label, null);
  }
  assert.equal(queueGameState({ appid: 1, state: 'awaiting_group' }, q, now).awaitingGroup, true);
  for (const status of ['resolved', 'existing_id']) {
    const resolved = queueGameState({ appid: 1, group_id64: '103582791429521412', group_resolution: { status } }, q, now);
    assert.equal(resolved.stage, 'followers');
    assert.equal(resolved.awaitingGroup, false);
    assert.match(resolved.detail, /群組 ID 已備妥；Followers 冷卻/);
    assert.ok(resolved.metadata.includes('GroupID 103582791429521412'));
  }
});

test('overview separates GroupID API retry from Steam Community Followers cooldown', () => {
  const q = queue(); q.queue[0].group_id64 = null; q.queue[0].state = 'awaiting_group';
  q.cooldown = { until: '2026-10-03T08:30:00Z', next_eligible_slot: '2026-10-03T09:00:00Z' };
  q.group_resolution_api_cooldown = { retry_at: '2026-10-03T08:00:00Z', status: 'api_rate_limited', http: 429 };
  const paused = dashboardState(q, [], {}, now);
  assert.match(paused.headline, /群組 ID 解析 API 正在冷卻/);
  assert.match(paused.detail, /1 款尚未取得群組 ID/);
  assert.match(paused.detail, /Followers 查詢另有 Steam Community 冷卻/);
  delete q.group_resolution_api_cooldown;
  assert.match(dashboardState(q, [], {}, now).headline, /仍有群組待解析/);
  delete q.cooldown;
  assert.match(dashboardState(q, [], {}, now).headline, /等待群組 ID 解析/);
  q.summary.ready_pending = 0; q.queue = [];
  assert.match(dashboardState(q, [], {}, now).headline, /可處理佇列已完成/);
});

test('optional group-stage counts keep legacy or null values unknown instead of inventing zero', () => {
  const q = queue();
  assert.equal(groupQueueCounts(q), null);
  q.summary.followers_ready_pending = 1; q.summary.awaiting_group_pending = 1;
  assert.deepEqual(groupQueueCounts(q), { followersReady: 1, awaitingGroup: 1 });
  q.summary.followers_ready_pending = null;
  assert.equal(groupQueueCounts(q), null);
  q.summary.followers_ready_pending = 0; q.summary.awaiting_group_pending = 0;
  assert.equal(groupQueueCounts(q), null);
  q.summary.ready_pending = 0;
  assert.deepEqual(groupQueueCounts(q), { followersReady: 0, awaitingGroup: 0 });
});
