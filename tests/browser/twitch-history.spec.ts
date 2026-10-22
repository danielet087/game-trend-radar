import { test, expect } from '@playwright/test';

function fixtures() {
  const hours: Record<string, string> = {}, rows: Record<string, any> = {};
  const last = Date.parse('2026-10-22T07:00:00Z');
  for (let n = 0; n < 168; n++) {
    const hour = new Date(last - n * 3600000).toISOString().replace('.000Z', 'Z');
    const generated = new Date(last - n * 3600000 + 600000).toISOString().replace('.000Z', 'Z');
    if (n === 3) continue;
    hours[hour] = generated;
    if (n === 2) continue;
    rows[hour] = { generated_at: generated, viewer_count: n === 0 ? 0 : 1000 + n, streamer_count: 10 + n,
      filtered_audience: { rule: 'followers_gt_1000_viewers_gte_10_v1', min_followers_exclusive: 1000,
        min_viewers_inclusive: 10, followers_max_age_hours: 24, status: n === 1 ? 'partial' : 'complete',
        median_viewer_count: n === 1 ? null : 20, eligible_streamer_count: 2, eligible_viewer_count: 40,
        excluded_low_viewer_count: 0, excluded_low_follower_count: 0, unknown_follower_count: n === 1 ? 2 : 0 } };
  }
  return {
    index: { schema_version: 1, timezone: 'Asia/Taipei', generated_at: hours['2026-10-22T07:00:00Z'], months: { '2026-10': hours },
      games: { '42': { name: '測試遊戲', months: ['2026-10'], first_hour: Object.keys(rows).at(-1), last_hour: Object.keys(rows)[0] } } },
    chunk: { schema_version: 1, timezone: 'Asia/Taipei', game_id: '42', month: '2026-10', hours: rows },
  };
}
test.beforeEach(async ({ page }) => {
  const data = fixtures();
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.route('**/data/twitch_series/index.json', route => route.fulfill({ json: data.index }));
  await page.route('**/data/twitch_series/42/2026-10.json', route => route.fulfill({ json: data.chunk }));
});

test('history ranges, metrics, selected hour, export and return filters work together', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('twitch-game.html?game=42&back=q%3DTest%26sort%3Dviewers');
  await expect(page.locator('#pageTitle')).toHaveText('測試遊戲');
  await expect(page.locator('#historyStatus')).toContainText('168 個時段');
  await expect(page.locator('#historyBack')).toHaveAttribute('href', './twitch.html?q=Test&sort=viewers');
  await expect(page.locator('.tw-chart')).toHaveAttribute('data-range', '168');
  await page.getByRole('button', { name: '30 天', exact: true }).click();
  await expect(page.locator('#historyStatus')).toContainText('720 個時段');
  await page.getByRole('button', { name: '24 小時', exact: true }).click();
  await expect(page.locator('.tw-chart')).toHaveAttribute('data-range', '24');
  await page.getByRole('button', { name: '篩選中位數', exact: true }).click();
  await expect(page).toHaveURL(/metric=median/);
  await page.locator('#historyTableBody tr').nth(1).getByRole('button').click();
  await expect(page.locator('.tw-chart-status')).toContainText('追隨者數待補');
  await expect(page.locator('.tw-chart-value')).toHaveText('—');
  await page.locator('#historyStart').fill('2026-10-21');
  await page.locator('#historyEnd').fill('2026-10-21');
  await page.getByRole('button', { name: '套用日期' }).click();
  await expect(page.locator('#historyRangeLabel')).toContainText('2026/10/21');
  await expect(page).toHaveURL(/range=custom/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下載此區間 CSV' }).click();
  await expect((await download).suggestedFilename()).toBe('twitch-42-2026-10-21-2026-10-21.csv');
  await page.reload();
  await expect(page.locator('.tw-chart')).toHaveAttribute('data-metric', 'median');
  await expect(page.locator('#historyStart')).toHaveValue('2026-10-21');
  expect(failures).toEqual([]);
});

test('mobile history fits the viewport and the chart supports keyboard selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('twitch-game.html?game=42');
  await expect(page.locator('#historyContent')).toBeVisible();
  await page.locator('.tw-chart-scrubber').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.tw-chart-time')).toContainText('14:00');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('failed monthly data can be retried without displaying it as zero', async ({ page }) => {
  await page.route('**/data/twitch_series/42/2026-10.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('twitch-game.html?game=42');
  await expect(page.locator('#historyStatus')).toContainText('暫時無法取得');
  await expect(page.locator('#historyContent')).toBeHidden();
  await expect(page.locator('#historyExport')).toBeDisabled();
  await page.unroute('**/data/twitch_series/42/2026-10.json');
  await page.route('**/data/twitch_series/42/2026-10.json', route => route.fulfill({ json: fixtures().chunk }));
  await page.getByRole('button', { name: '重新載入' }).click();
  await expect(page.locator('#historyContent')).toBeVisible();
  await expect(page.locator('#historyTableBody tr').first().locator('td').nth(1)).toHaveText('0');
});
