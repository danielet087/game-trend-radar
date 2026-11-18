import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateQueue, normalizeRun, runState, buildSlots, dashboardState, eventHistory, queueGameState, groupQueueCounts, igdbReceiptSummary } from '../src/features/scheduler/data.js';
import { createSchedulerRenderer } from '../src/features/scheduler/render.js';
import { createSchedulerState } from '../src/features/scheduler/state.js';
import { createSchedulerLoader } from '../src/features/scheduler/load.js';

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

let nextMaintenanceId = 50000000000;
function maintenance(workflow, repo, slot, overrides = {}) {
  const created = overrides.created_at ? Date.parse(overrides.created_at) : Date.parse(slot) + 16000;
  return normalizeRun({ id: String(nextMaintenanceId++), path: '.github/workflows/' + workflow,
    display_title: `Observed | slot=${slot ?? 'manual'} | source=${overrides.event === 'schedule' ? 'schedule' : 'cloudflare'}`,
    event: 'workflow_dispatch', created_at: new Date(created).toISOString(), run_started_at: new Date(created + 15000).toISOString(),
    updated_at: new Date(created + 120000).toISOString(), status: 'completed', conclusion: 'success', ...overrides }, repo);
}
const CREDENTIAL_REPOS = [['game-trend-radar', 'credentials_frontend'], ['game-trend-radar-backend', 'credentials_backend'],
  ['game-trend-radar-twitch-backend', 'credentials_twitch'], ['game-trend-radar-content-backend', 'credentials_content']];

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
  // Nine data lanes (85 slots), the hourly watchdog and site deploy (24 each), three daily lanes.
  assert.equal(lanes.flatMap(l => l.slots).length, 136);
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

test('description refresh has independent six-hour slots and never skips after earlier daily success', () => {
  const observed = run('steam-description-refresh.yml', 'game-trend-radar-content-backend', {
    display_title: 'Refresh game descriptions | slot=2026-10-02T17:30:00Z | source=cloudflare',
    created_at: '2026-10-02T17:30:20Z', run_started_at: '2026-10-02T17:31:00Z', updated_at: '2026-10-02T17:40:00Z',
  });
  assert.equal(observed.job_id, 'steam_descriptions');
  const lane = buildSlots('2026-10-03', [observed], queue(), null, now).find(row => row.job.id === 'steam_descriptions');
  assert.deepEqual(lane.slots.map(slot => [slot.hour, slot.minute]), [[1, 30], [7, 30], [13, 30], [19, 30]]);
  assert.deepEqual(lane.slots.map(slot => slot.state), ['success', 'unknown', 'unknown', 'planned']);
  assert.equal(lane.job.oncePerDay, undefined);
  assert.match(eventHistory(queue(), [observed], null, now)[0].title, /遊戲簡介更新/);
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

function persistedIgdbReceipt() {
  return { schema_version: 1, generated_at: '2026-10-03T00:31:00Z', committed_at: '2026-10-03T00:34:00Z',
    target_slot: '2026-10-03T00:30:00Z', run_id: '37105223144', storage_backend: 'turso', state_persisted: true,
    complete: true, status: 'persisted', candidate_count: 6000, public_count: 23, pending_count: 0,
    source: { provider: 'IGDB', complete: true, platform_ids_verified: [130, 167, 508] } };
}

test('IGDB durable collection receipts do not claim a Git publication', () => {
  const receipt = persistedIgdbReceipt();
  const summary = igdbReceiptSummary(receipt, now);
  assert.equal(summary.persisted, true);
  assert.equal(summary.committedAt, Date.parse(receipt.committed_at));
  assert.equal(summary.published, false);
  assert.equal(summary.publishedAt, null);
  for (const fields of [{ storage_backend: 'git' }, { state_persisted: 'true' }, { state_persisted: false },
    { status: 'prepared' }, { complete: false }, { run_id: 37105223144 }, { run_id: 'manual' }, { run_id: '' },
    { source: { ...receipt.source, complete: false } }, { target_slot: null },
    { target_slot: '2026-10-03T00:32:00Z' }, { committed_at: '2026-10-03T00:30:59Z' },
    { committed_at: '2026-10-03T07:30:01Z' }, { committed_at: '2026-10-03T00:34:00' },
    { committed_at: '2026-10-03T08:34:00+08:00' }, { target_slot: '2026-09-31T00:30:00Z' }]) {
    const invalid = igdbReceiptSummary({ ...receipt, ...fields }, now);
    assert.equal(invalid.persisted, false, JSON.stringify(fields));
    assert.equal(invalid.committedAt, null);
    assert.equal(invalid.published, false);
  }
});

test('IGDB saved data is rendered as saved without a Git publication claim', context => {
  context.mock.method(Date, 'now', () => now);
  const state = createSchedulerState();
  state.igdb = persistedIgdbReceipt();
  const nodes = new Map();
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', value: '', closest: () => null });
    return nodes.get(id);
  };
  const renderer = createSchedulerRenderer(state, $);
  renderer.render();
  assert.match($('sourcesDetails').innerHTML, /資料已保存於/);
  assert.doesNotMatch($('sourcesDetails').innerHTML, /完整發布於/);
  state.igdb.state_persisted = false;
  renderer.render();
  assert.match($('sourcesDetails').innerHTML, /最近回報尚未確認完成/);
  assert.doesNotMatch($('sourcesDetails').innerHTML, /資料已保存於/);
});

function partialIgdbReceipt() {
  const receipt = persistedIgdbReceipt();
  const flags = { ledger_complete: true, lookup_complete: false, public_complete: true };
  return { ...receipt, ...flags, complete: false, status: 'persisted_partial', collection_status: 'partial',
    pending_count: 1, unavailable_count: 1, backend_mirror: 'not_required',
    authoritative_source: 'danielet087/game-trend-radar@main',
    source: { ...receipt.source, ...flags, complete: false, hypes_threshold: 30,
      game_lookup: { initial_missing_count: 1, recovered_count: 0, recovery_requests: 2, max_recovery_requests: 20,
        unavailable_ids: [415392], unavailable: [{ igdb_id: 415392, reason: 'missing_after_bounded_recovery',
          last_checked_at: '2026-10-02T00:32:16Z', request_attempts: 3 }] } } };
}

test('IGDB partial receipts confirm saved public data without claiming full lookup completion', () => {
  const receipt = partialIgdbReceipt();
  const result = igdbReceiptSummary(receipt, now);
  assert.equal(result.partial, true);
  assert.equal(result.persisted, true);
  assert.equal(result.published, false);
  assert.equal(result.pendingCount, 1);
  for (const mutate of [
    r => { r.source.public_complete = false; }, r => { r.lookup_complete = true; },
    r => { r.pending_count = 0; }, r => { r.source.game_lookup.unavailable_ids = [415392, 415392]; },
    r => { r.source.game_lookup.recovery_requests = 21; },
    r => { r.source.game_lookup.initial_missing_count = 2; },
    r => { r.source.game_lookup.unavailable[0].request_attempts = 1; },
    r => { r.source.game_lookup.unavailable[0].last_checked_at = '2026-10-04T00:32:16Z'; },
    r => { r.authoritative_source = 'unknown'; }, r => { r.state_persisted = false; },
  ]) {
    const invalid = structuredClone(receipt); mutate(invalid);
    assert.equal(igdbReceiptSummary(invalid, now).partial, false);
    assert.equal(igdbReceiptSummary(invalid, now).persisted, false);
  }
});

test('IGDB partial retention is visible as a retryable historical lookup', context => {
  context.mock.method(Date, 'now', () => now);
  const state = createSchedulerState(); state.igdb = partialIgdbReceipt();
  const nodes = new Map();
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', value: '', closest: () => null });
    return nodes.get(id);
  };
  createSchedulerRenderer(state, $).render();
  assert.match($('sourcesDetails').innerHTML, /公開資料已保存於/);
  assert.match($('sourcesDetails').innerHTML, /歷史候選待查/);
  assert.match($('sourcesDetails').innerHTML, /保留原查詢時間，下次排程再試/);
  assert.doesNotMatch($('sourcesDetails').innerHTML, /完整發布於/);
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

test('growth run that only waited out the Community cooldown waits instead of reporting a 429', () => {
  const r = run('steam-public-growth.yml');
  const growth = { generated_at: '2026-10-03T07:25:00Z', collection: { at: '2026-10-03T07:03:00Z', status: 'rate_limited', requests: 0, measurements: 0, next_request_after_taipei: '2026-10-03T19:03:03.010752+08:00' } };
  assert.deepEqual(runState(r, queue(), growth), { state: 'waiting', text: '冷卻中，未量測' });
  const measurement = eventHistory(queue(), [r], growth, now).find(e => e.id === 'growth-measurement');
  assert.equal(measurement.state, 'waiting');
  assert.equal(measurement.title, 'Steam 成長 · 冷卻中，未量測');
  assert.match(measurement.detail, /沒有送出請求；19:03 後才會再查/);
  const noDeadline = { ...growth, collection: { ...growth.collection, next_request_after_taipei: null } };
  assert.doesNotMatch(eventHistory(queue(), [r], noDeadline, now).find(e => e.id === 'growth-measurement').detail, /後才會再查/);
  const sent = { ...growth, collection: { ...growth.collection, requests: 3, measurements: 2 } };
  assert.deepEqual(runState(r, queue(), sent), { state: 'interrupted', text: '429 中斷量測' });
  const sentEvent = eventHistory(queue(), [r], sent, now).find(e => e.id === 'growth-measurement');
  assert.equal(sentEvent.state, 'interrupted');
  assert.equal(sentEvent.title, 'Steam 成長 · 部分量測後遇到 429');
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

test('maintenance jobs get their own lanes and the four credential checks share one', () => {
  const lanes = buildSlots('2026-10-03', [], queue(), null, now);
  assert.deepEqual(lanes.slice(-5).map(lane => lane.job.id), ['frontend_watchdog', 'frontend_pages', 'twitch_archive', 'storage_retention', 'credentials']);
  assert.ok(lanes.slice(-5).every(lane => lane.job.maintenance) && !lanes.slice(0, -5).some(lane => lane.job.maintenance));
  const times = id => lanes.find(lane => lane.job.id === id).slots.map(slot => new Date(slot.at).toISOString());
  assert.equal(times('frontend_watchdog').length, 24);
  assert.equal(times('frontend_watchdog')[10], '2026-10-03T02:17:00.000Z');
  assert.equal(times('frontend_pages').length, 24);
  assert.equal(times('frontend_pages')[10], '2026-10-03T02:30:00.000Z');
  assert.deepEqual(times('twitch_archive'), ['2026-10-02T19:30:00.000Z']);
  assert.deepEqual(times('storage_retention'), ['2026-10-02T20:30:00.000Z']);
  assert.deepEqual(times('credentials'), ['2026-10-02T21:30:00.000Z']);
  assert.deepEqual(lanes.find(lane => lane.job.id === 'credentials').members.map(job => job.id), CREDENTIAL_REPOS.map(([, id]) => id));
  for (const [repo, id] of CREDENTIAL_REPOS) assert.equal(maintenance('credential-expiry.yml', repo, '2026-10-02T21:30:00Z').job_id, id);
  assert.equal(maintenance('radar-watchdog.yml', 'game-trend-radar', '2026-10-03T02:17:00Z').job_id, 'frontend_watchdog');
  assert.equal(maintenance('pages-deploy.yml', 'game-trend-radar', '2026-10-03T02:30:00Z').job_id, 'frontend_pages');
  assert.equal(maintenance('archive-twitch-history.yml', 'game-trend-radar-twitch-backend', '2026-10-02T19:30:00Z').job_id, 'twitch_archive');
  assert.equal(maintenance('storage-evidence-retention.yml', 'game-trend-radar-backend', '2026-10-02T20:30:00Z').job_id, 'storage_retention');
  assert.equal(maintenance('radar-watchdog.yml', 'game-trend-radar-backend', '2026-10-03T02:17:00Z'), null);
});

test('credential lane shows the most urgent of its four checks and every result in the note', () => {
  const slot = '2026-10-02T21:30:00Z';
  const runs = CREDENTIAL_REPOS.map(([repo]) => maintenance('credential-expiry.yml', repo, slot));
  const credentials = (observed, at = now) => buildSlots('2026-10-03', observed, queue(), null, at).find(lane => lane.job.id === 'credentials').slots[0];
  let point = credentials(runs);
  assert.equal(point.state, 'success');
  assert.equal(point.text, '4 個儲存庫皆為「流程完成」');
  assert.equal(point.run, undefined);
  const failed = maintenance('credential-expiry.yml', 'game-trend-radar-twitch-backend', slot, { conclusion: 'failure' });
  point = credentials([runs[0], runs[1], failed, runs[3]]);
  assert.equal(point.state, 'interrupted');
  assert.equal(point.run.id, failed.id);
  assert.equal(point.text, '前端：流程完成；Steam 後端：流程完成；Twitch／IGDB：執行失敗；內容：流程完成');
  const active = maintenance('credential-expiry.yml', 'game-trend-radar', slot, { status: 'in_progress', conclusion: null });
  point = credentials([active, runs[1], failed, runs[3]]);
  assert.equal(point.state, 'running');
  assert.equal(point.run, undefined);
  point = credentials(runs.slice(0, 3));
  assert.equal(point.state, 'unknown');
  assert.match(point.text, /；內容：此時段尚未觀測到執行紀錄$/);
  point = credentials([], Date.parse('2026-10-02T21:00:00Z'));
  assert.equal(point.state, 'planned');
  assert.equal(point.text, '4 個儲存庫皆為「原定時段，尚未到期」');
});

test('a code push deploy running when :30 comes due covers the hourly deploy slot', () => {
  const lane = observed => buildSlots('2026-10-03', observed, queue(), null, now).find(row => row.job.id === 'frontend_pages');
  const dispatched = maintenance('pages-deploy.yml', 'game-trend-radar', '2026-10-03T01:30:00Z');
  assert.equal(lane([dispatched]).slots[9].text, '流程完成');
  const push = maintenance('pages-deploy.yml', 'game-trend-radar', null, { event: 'push', created_at: '2026-10-03T02:29:00Z', updated_at: '2026-10-03T02:32:00Z' });
  assert.equal(lane([push]).slots[10].state, 'success');
  assert.equal(lane([push]).slots[10].text, '流程完成（程式更新觸發的執行涵蓋此時段）');
  assert.equal(lane([push]).slots[11].state, 'unknown');
  const event = eventHistory(queue(), [push], null, now).find(item => item.id === 'run-' + push.id);
  assert.equal(event.routine, true);
  assert.match(event.detail, /^程式更新觸發 → /);
  const insights = maintenance('radar-insights.yml', 'game-trend-radar', null, { event: 'push', created_at: '2026-10-03T02:16:00Z', updated_at: '2026-10-03T02:19:00Z' });
  assert.match(eventHistory(queue(), [insights], null, now).find(item => item.id === 'run-' + insights.id).detail, /^資料更新觸發 → /);
});

test('a GitHub fallback cron run stands in for a missing Worker slot, and only for maintenance jobs', () => {
  const lane = (observed, id) => buildSlots('2026-10-03', observed, queue(), null, now).find(row => row.job.id === id);
  const fallback = maintenance('radar-watchdog.yml', 'game-trend-radar', null, { event: 'schedule', created_at: '2026-10-03T03:13:44Z' });
  assert.equal(fallback.slot, 'manual');
  let watchdog = lane([fallback], 'frontend_watchdog');
  assert.equal(watchdog.slots[10].state, 'success');
  assert.equal(watchdog.slots[10].text, '流程完成（GitHub 備援排程）');
  assert.equal(watchdog.slots[10].run.id, fallback.id);
  assert.equal(watchdog.slots[11].state, 'unknown');
  const dispatched = maintenance('radar-watchdog.yml', 'game-trend-radar', '2026-10-03T02:17:00Z');
  watchdog = lane([fallback, dispatched], 'frontend_watchdog');
  assert.equal(watchdog.slots[10].run.id, dispatched.id);
  assert.equal(watchdog.slots[10].text, '流程完成');
  const retention = maintenance('storage-evidence-retention.yml', 'game-trend-radar-backend', null, { event: 'schedule', created_at: '2026-10-03T03:06:11Z' });
  assert.equal(lane([retention], 'storage_retention').slots[0].text, '流程完成（GitHub 備援排程）');
  const yesterday = maintenance('storage-evidence-retention.yml', 'game-trend-radar-backend', null, { event: 'schedule', created_at: '2026-10-02T15:59:00Z' });
  assert.equal(lane([yesterday], 'storage_retention').slots[0].state, 'unknown');
  const insights = maintenance('radar-insights.yml', 'game-trend-radar', null, { event: 'schedule', created_at: '2026-10-03T02:20:00Z' });
  assert.equal(lane([insights], 'frontend_insights').slots[10].state, 'unknown');
  assert.match(eventHistory(queue(), [fallback], null, now).find(event => event.id === 'run-' + fallback.id).detail, /^GitHub 備援排程 → 11:13 開始 → 11:15 結束/);
});

test('timeline marks the maintenance group once and draws the credential lane as one note button', context => {
  context.mock.method(Date, 'now', () => now);
  const state = createSchedulerState();
  state.runs = CREDENTIAL_REPOS.map(([repo]) => maintenance('credential-expiry.yml', repo, '2026-10-02T21:30:00Z'));
  const nodes = new Map();
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', value: '', closest: () => null });
    return nodes.get(id);
  };
  createSchedulerRenderer(state, $).render();
  const html = $('scheduleTimeline').innerHTML;
  assert.equal(html.match(/class="schedule-group"/g).length, 1);
  assert.ok(html.indexOf('IGDB 主機新作') < html.indexOf('schedule-group'));
  assert.ok(html.indexOf('schedule-group') < html.indexOf('整體健康檢查'));
  assert.equal(html.match(/<strong>憑證到期檢查<\/strong>/g).length, 1);
  assert.match(html, /<button class="schedule-slot is-success"[^>]*data-slot-note="05:30 · 憑證到期檢查 · 4 個儲存庫皆為「流程完成」"/);
});

test('Actions runs are read from an hour before Taiwan midnight, up to 100 per repository', async context => {
  context.mock.method(Date, 'now', () => now);
  const requested = [];
  context.mock.method(globalThis, 'fetch', async url => {
    requested.push(String(url));
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ workflow_runs: [] }) };
  });
  const state = createSchedulerState();
  await createSchedulerLoader(state).readRuns('game-trend-radar');
  assert.deepEqual(requested, ['https://api.github.com/repos/danielet087/game-trend-radar/actions/runs?per_page=100&created=%3E%3D2026-10-02T15%3A00%3A00Z']);
  assert.deepEqual(state.repoErrors, {});
  assert.equal(state.repoChecks['game-trend-radar'], now);
});

function rawRun(id, workflow, created, overrides = {}) {
  return { id: String(id), path: '.github/workflows/' + workflow, display_title: 'Observed | slot=manual | source=push', event: 'push',
    created_at: created, run_started_at: created, updated_at: created, status: 'completed', conclusion: 'success', ...overrides };
}
// The newest page: one insights run and filler deploys, oldest first at `from`.
function fullPage(from, base) {
  const start = Date.parse(from);
  return Array.from({ length: 100 }, (_, index) => {
    const created = new Date(start + (99 - index) * 120000).toISOString().replace('.000Z', 'Z');
    return index === 0
      ? rawRun(base, 'radar-insights.yml', created, { display_title: 'Radar insights | slot=2026-10-03T07:17:00Z | source=cloudflare', event: 'workflow_dispatch' })
      : rawRun(base + index, 'pages-deploy.yml', created);
  });
}

test('a full page is completed by one earlier-range request that the cache reuses for 30 minutes', async context => {
  let clock = now;
  context.mock.method(Date, 'now', () => clock);
  const store = new Map();
  globalThis.sessionStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  context.after(() => { delete globalThis.sessionStorage; });
  const early = rawRun(61000000001, 'radar-insights.yml', '2026-10-02T16:17:16Z',
    { display_title: 'Radar insights | slot=2026-10-02T16:17:00Z | source=cloudflare', event: 'workflow_dispatch' });
  let requested = [], older = [early];
  context.mock.method(globalThis, 'fetch', async url => {
    requested.push(String(url));
    const created = decodeURIComponent(new URL(String(url)).searchParams.get('created'));
    const body = created.startsWith('>=') ? fullPage(new Date(clock - 4.5 * 3600000).toISOString().replace('.000Z', 'Z'), 62000000000 + clock / 60000) : older;
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ workflow_runs: body }) };
  });
  const state = createSchedulerState();
  const loader = createSchedulerLoader(state);
  const insights = () => state.runs.filter(run => run.job_id === 'frontend_insights').map(run => run.slot).sort();

  await loader.readRuns('game-trend-radar');
  assert.deepEqual(requested.map(url => decodeURIComponent(new URL(url).searchParams.get('created'))),
    ['>=2026-10-02T15:00:00Z', '2026-10-02T15:00:00Z..2026-10-03T03:00:00Z']);
  assert.deepEqual(insights(), ['2026-10-02T16:17:00Z', '2026-10-03T07:17:00Z']);

  requested = []; clock = now + 6 * 60000;
  await loader.readRuns('game-trend-radar');
  assert.equal(requested.length, 1, 'the cached earlier runs cover the gap');
  assert.deepEqual(insights(), ['2026-10-02T16:17:00Z', '2026-10-03T07:17:00Z']);

  requested = []; clock = now + 31 * 60000;
  await loader.readRuns('game-trend-radar');
  assert.equal(requested.length, 2, 'the earlier range is read again after 30 minutes');

  requested = []; clock = now + 37 * 60000;
  older = [{ ...early, status: 'in_progress', conclusion: null }];
  const key = 'radarSchedulerRunsV2:game-trend-radar', cached = JSON.parse(store.get(key));
  store.set(key, JSON.stringify({ ...cached, runs: cached.runs.map(run => run.id === early.id ? { ...run, status: 'in_progress' } : run) }));
  await loader.readRuns('game-trend-radar');
  assert.equal(requested.length, 2, 'an earlier run that is still active is read again');
  assert.equal(state.runs.find(run => run.id === early.id).status, 'in_progress');

  requested = []; clock = now + 43 * 60000;
  await loader.readRuns('game-trend-radar');
  assert.equal(requested.length, 2, 'it stays active, so it is read again');
});

test('the event list folds routine successes per job and keeps failures and manual runs one by one', context => {
  context.mock.method(Date, 'now', () => now);
  const state = createSchedulerState();
  const twitch = hour => maintenance('collect.yml', 'game-trend-radar-twitch-backend', `2026-10-03T0${hour}:00:00Z`);
  const failed = twitch(6); failed.conclusion = 'failure';
  const manual = maintenance('collect.yml', 'game-trend-radar-twitch-backend', null, { created_at: '2026-10-03T06:30:00Z' });
  state.runs = [twitch(3), twitch(4), twitch(5), failed, manual];
  const nodes = new Map();
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', value: '', closest: () => null });
    return nodes.get(id);
  };
  createSchedulerRenderer(state, $).render();
  const html = $('eventTimeline').innerHTML;
  assert.equal(html.match(/class="timeline-event /g).length, 3, 'failure, manual run and one folded group');
  assert.match(html, /id="run-[0-9]+"[^>]*>[^]*執行失敗/);
  assert.match(html, /手動／其他入口/);
  assert.match(html, /<summary>Twitch 新作觀測 · 今天 3 次例行執行完成<\/summary>/);
  assert.equal(html.match(/href="https:\/\/github\.com\/danielet087\/game-trend-radar-twitch-backend\/actions\/runs\/[0-9]+"/g).length, 5, 'every run stays linked');
  assert.ok(html.indexOf('id="routine-twitch"') > html.indexOf('timeline-group-label') && html.indexOf('timeline-group-label') > html.indexOf('手動／其他入口'), 'folded groups come after the listed events, under one label');
});
