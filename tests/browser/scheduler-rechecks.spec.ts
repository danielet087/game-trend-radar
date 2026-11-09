import { test, expect } from '@playwright/test';

for (const width of [1280, 390]) {
  test(`daily follower planning row reports pending, positive and zero workload at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.install({ time: new Date('2026-11-09T04:10:00Z') });
    let plan: Record<string, unknown> | undefined;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/scheduler_queue_status.json')) return route.fulfill({ json: {
        schema_version: 1, generated_at: '2026-11-09T04:05:00Z', today_taipei: '2026-11-09',
        summary: { normal_pending: 0, twitch_priority_pending: 0, ready_pending: 0, parked: 0, total_pending: 0 },
        queue: [], parked: [], events: [], cooldown: {}, follower_recheck_plan: plan,
      } });
      if (url.hostname === 'api.github.com') return route.fulfill({ json: { workflow_runs: [] } });
      if (url.hostname !== '127.0.0.1') return route.abort();
      return route.continue();
    });
    await page.goto('scheduler.html');
    const lane = page.locator('.schedule-lane.is-recheck');
    await expect(lane).toContainText('Follower 回查盤點');
    await expect(lane.locator('.schedule-result')).toHaveText('等待今日盤點');
    await expect(lane.locator('.schedule-slot')).not.toHaveClass(/is-success/);
    plan = { schema_version: 1, date_taipei: '2026-11-09', status: 'completed',
      checked_at: '2026-11-09T04:05:00Z', needed: true, planned_count: 763,
      completed_count: 12, remaining_count: 751, due_now_count: 745 };
    await expect(page.locator('#refreshButton')).toBeEnabled();
    await page.locator('#refreshButton').click();
    await expect(lane.locator('.schedule-result')).toHaveText('今天需回查 763 款');
    await expect(lane).toContainText('已完成 12 · 尚待 751');
    await expect(lane.locator('.schedule-slot')).toHaveClass(/is-success/);
    await lane.locator('.schedule-slot').click();
    await expect(page.locator('#scheduleCaption')).toContainText('盤點完成');
    await expect(page.locator('#scheduleCaption')).toContainText('官方 Followers');
    plan = { ...plan, needed: false, planned_count: 0, completed_count: 0, remaining_count: 0, due_now_count: 0 };
    await expect(page.locator('#refreshButton')).toBeEnabled();
    await page.locator('#refreshButton').click();
    await expect(lane.locator('.schedule-result')).toHaveText('今天無需回查');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}
