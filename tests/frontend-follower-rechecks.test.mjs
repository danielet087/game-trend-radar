import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSlots } from '../src/features/scheduler/data.js';
import { recheckPlanSummary } from '../src/features/scheduler/rechecks.js';
import { createSchedulerRenderer } from '../src/features/scheduler/render.js';
import { createSchedulerState } from '../src/features/scheduler/state.js';

const now = Date.parse('2026-11-09T04:10:00Z');
function snapshot(overrides = {}) {
  return { follower_recheck_plan: { schema_version: 1, date_taipei: '2026-11-09', status: 'completed',
    checked_at: '2026-11-09T04:05:00Z', needed: true, planned_count: 763, completed_count: 12,
    remaining_count: 751, due_now_count: 745, ...overrides } };
}

test('an independent planning row shows today workload after its receipt completes', () => {
  const lane = buildSlots('2026-11-09', [], snapshot(), null, now).find(row => row.job.id === 'steam_rechecks');
  assert.equal(lane.job.name, 'Follower 回查盤點');
  assert.equal(lane.summary.text, '今天需回查 763 款');
  assert.equal(lane.slots[0].state, 'success');
  assert.equal(lane.slots[0].at, Date.parse('2026-11-09T04:05:00Z'));
  assert.match(lane.slots[0].text, /已完成 12 款，尚待 751 款/);
});

test('a finished planning node does not claim all follower requests completed', () => {
  const result = recheckPlanSummary(snapshot(), now);
  assert.equal(result.remaining, 751);
  assert.match(result.detail, /官方 Followers.*分批執行/);
});

test('missing, partial, yesterday and malformed receipts never turn unknown into zero', () => {
  for (const s of [null, {}, snapshot({ status: 'pending', planned_count: null }),
    snapshot({ date_taipei: '2026-11-08' }), snapshot({ planned_count: 1 }),
    snapshot({ due_now_count: 999 }), snapshot({ needed: false }),
    snapshot({ checked_at: '2026-11-09T05:00:00Z' })]) {
    const result = recheckPlanSummary(s, now);
    assert.equal(result.confirmed, false);
    assert.equal(result.text, '等待今日盤點');
    assert.equal(result.total, undefined);
  }
});

test('only a confirmed zero receipt displays today has no due rechecks', () => {
  const result = recheckPlanSummary(snapshot({ needed: false, planned_count: 0, completed_count: 0,
    remaining_count: 0, due_now_count: 0 }), now);
  assert.equal(result.confirmed, true);
  assert.equal(result.text, '今天無需回查');
});

test('daily total stays visible when the entire planned workload is completed', () => {
  const result = recheckPlanSummary(snapshot({ completed_count: 763, remaining_count: 0, due_now_count: 0 }), now);
  assert.equal(result.text, '今天需回查 763 款');
  assert.equal(result.completed, 763);
  assert.equal(result.remaining, 0);
});

test('the row renders its count and completion progress directly without a tooltip', () => {
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const elements = new Map();
    const $ = id => {
      if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', closest: () => null });
      return elements.get(id);
    };
    const state = createSchedulerState();
    state.queue = { ...snapshot(), schema_version: 1, today_taipei: '2026-11-09', generated_at: '2026-11-09T04:05:00Z',
      summary: { total_pending: 0, normal_pending: 0, twitch_priority_pending: 0, parked: 0, ready_pending: 0 },
      queue: [], parked: [], events: [], cooldown: {} };
    createSchedulerRenderer(state, $).render();
    assert.match($('scheduleTimeline').innerHTML, /schedule-result is-confirmed.*今天需回查 763 款/);
    assert.match($('scheduleTimeline').innerHTML, /已完成 12 · 尚待 751/);
    assert.match($('scheduleTimeline').innerHTML, /盤點完成/);
  } finally { Date.now = realNow; }
});
