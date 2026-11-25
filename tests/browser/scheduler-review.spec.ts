import { test, expect } from '@playwright/test';

const check = (id: string, title: string, status: string) => ({ id, title, status, rule: `${title}的規則`,
  summary: `${title}這次的結果`, baseline: `11-25：${title}驗證時的結果`, advice: `${title}何時重看` });
const review = (generated_at: string, statuses: string[]) => ({ schema_version: 1, generated_at, data_through: '2026-11-30T15:00:00Z',
  launches: 120, attention: statuses.filter(status => status === 'watch').length,
  checks: [check('trial', '小遊戲試播標準', statuses[0]), check('forecast', '上市後預估（首 48 小時版）', statuses[1])] });

for (const width of [1280, 390]) {
  test(`the monthly rule review shows a notice until it is dismissed and lists the checks at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.install({ time: new Date('2026-12-01T02:00:00Z') });
    let current: Record<string, unknown> | null = review('2026-12-01T00:17:00Z', ['ok', 'watch']);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/scheduler_queue_status.json')) return route.fulfill({ json: {
        schema_version: 1, generated_at: '2026-12-01T01:55:00Z', today_taipei: '2026-12-01',
        summary: { normal_pending: 0, twitch_priority_pending: 0, ready_pending: 0, parked: 0, total_pending: 0 },
        queue: [], parked: [], events: [], cooldown: {},
      } });
      if (url.pathname.endsWith('/rule_review.json')) return current ? route.fulfill({ json: current }) : route.fulfill({ status: 404, body: '' });
      if (url.hostname === 'api.github.com') return route.fulfill({ json: { workflow_runs: [] } });
      if (url.hostname !== '127.0.0.1') return route.abort();
      return route.continue();
    });
    await page.goto('scheduler.html');
    const notice = page.locator('#reviewNotice');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveClass(/is-watch/);
    await expect(page.locator('#reviewNoticeText')).toContainText('1 項要注意（上市後預估（首 48 小時版））');
    const cards = page.locator('#reviewChecks .review-check');
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toHaveClass(/is-watch/);
    await expect(cards.first()).toContainText('要注意');
    await expect(cards.nth(1)).toContainText('正常');
    await expect(cards.first().locator('dd').first()).toHaveText('上市後預估（首 48 小時版）這次的結果');
    await expect(page.locator('#reviewDate')).toHaveText('12/01 重算');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

    await page.locator('#reviewNoticeDismiss').click();
    await expect(notice).toBeHidden();
    await page.reload();
    await expect(page.locator('#reviewChecks .review-check')).toHaveCount(2);
    await expect(notice).toBeHidden();

    // Next month's review brings the notice back.
    current = review('2027-01-01T00:17:00Z', ['ok', 'ok']);
    await expect(page.locator('#refreshButton')).toBeEnabled();
    await page.locator('#refreshButton').click();
    await expect(notice).toBeVisible();
    await expect(notice).not.toHaveClass(/is-watch/);
    await expect(page.locator('#reviewNoticeText')).toContainText('2 項都還在標準內，不用改');

    // Before the first review the panel says so and no notice shows.
    await page.evaluate(() => localStorage.clear());
    current = null;
    await page.reload();
    await expect(page.locator('#reviewDate')).toHaveText('尚未重算');
    await expect(notice).toBeHidden();
    expect(errors).toEqual([]);
  });
}
