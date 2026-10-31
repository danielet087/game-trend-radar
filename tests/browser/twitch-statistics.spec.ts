import { test, expect } from '@playwright/test';

function fixtures() {
  const hours: Record<string, string> = {}, rows: Record<string, any> = {};
  const last = Date.parse('2026-10-22T07:00:00Z');
  for (let n = 0; n < 168; n++) {
    const hour = new Date(last - n * 3600000).toISOString().replace('.000Z', 'Z');
    const generated = new Date(last - n * 3600000 + 600000).toISOString().replace('.000Z', 'Z');
    if (n === 70) continue;
    hours[hour] = generated;
    if (n === 71) continue;
    rows[hour] = { generated_at: generated, viewer_count: n < 24 ? 2000 : 1000, streamer_count: n < 24 ? 20 : 10,
      filtered_audience: { rule: 'followers_gt_1000_viewers_gte_10_v1', min_followers_exclusive: 1000,
        min_viewers_inclusive: 10, followers_max_age_hours: 24, status: n === 1 ? 'partial' : 'complete',
        median_viewer_count: n === 1 ? null : 20, eligible_streamer_count: 2, eligible_viewer_count: 40,
        excluded_low_viewer_count: 0, excluded_low_follower_count: 0, unknown_follower_count: n === 1 ? 2 : 0 } };
  }
  return {
    index: { schema_version: 1, timezone: 'Asia/Taipei', generated_at: hours['2026-10-22T07:00:00Z'], months: { '2026-10': hours },
      games: { '42': { name: '統計測試遊戲', archive_eligible: true, months: ['2026-10'], first_hour: Object.keys(rows).at(-1), last_hour: Object.keys(rows)[0] } } },
    chunk: { schema_version: 1, timezone: 'Asia/Taipei', game_id: '42', month: '2026-10', hours: rows },
  };
}

test.beforeEach(async ({ page }) => {
  const data = fixtures();
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.route('**/data/twitch_series/index.json', route => route.fulfill({ json: data.index }));
  await page.route('**/data/twitch_series/42/2026-10.json', route => route.fulfill({ json: data.chunk }));
});

test('all supplementary modes work without changing the original chart, URL, data reads or CSV', async ({ page }) => {
  const failures: string[] = [], dataReads: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('request', request => { if (request.url().includes('/data/twitch_series/')) dataReads.push(request.url()); });
  await page.goto('twitch-game.html?region=global&game=42&metric=streamers&back=view%3Darchive%26q%3DTest');
  const stats = page.locator('#historyStatistics');
  await expect(stats).toBeVisible();
  await expect(stats).toHaveAttribute('data-statistics-mode', 'distribution');
  await expect(page.locator('#historyChart .tw-chart')).toHaveAttribute('data-metric', 'streamers');
  const originalURL = page.url(), reads = dataReads.length;
  await stats.getByRole('button', { name: '熱度動能', exact: true }).click();
  await expect(stats).toHaveAttribute('data-statistics-mode', 'trend');
  await expect(stats.locator('.tw-statistics-summary')).toContainText('100');
  await stats.getByRole('button', { name: '熱度延續', exact: true }).click();
  await stats.locator('[name="statisticsThreshold"]').fill('1500');
  await stats.getByRole('button', { name: '套用門檻', exact: true }).click();
  await expect(stats.locator('.tw-statistics-summary')).toContainText('24');
  await stats.getByRole('button', { name: '觀看與開台', exact: true }).click();
  await expect(stats).toHaveAttribute('data-statistics-mode', 'supply');
  await expect(stats.locator('.tw-statistics-chart svg')).toBeVisible();
  await stats.getByRole('button', { name: '熱門時段', exact: true }).click();
  await expect(stats).toHaveAttribute('data-statistics-mode', 'hourly');
  await stats.locator('[name="statisticsMetric"]').selectOption('median');
  await expect(page.locator('#historyChart .tw-chart')).toHaveAttribute('data-metric', 'streamers');
  expect(page.url()).toBe(originalURL);
  expect(dataReads).toHaveLength(reads);
  await expect(page.locator('#historyBack')).toHaveAttribute('href', './twitch.html?q=Test&view=archive&region=global');
  const download = page.waitForEvent('download');
  await page.locator('#historyExport').click();
  expect((await download).suggestedFilename()).toBe('twitch-42-2026-10-15-2026-10-22.csv');
  expect(failures).toEqual([]);
});

test('date changes recalculate statistics and retain their independent controls', async ({ page }) => {
  await page.goto('twitch-game.html?region=global&game=42');
  const stats = page.locator('#historyStatistics');
  await expect(stats).toBeVisible();
  await stats.getByRole('button', { name: '熱度動能', exact: true }).click();
  await page.getByRole('button', { name: '24 小時', exact: true }).click();
  await expect(page.locator('#historyChart .tw-chart')).toHaveAttribute('data-range', '24');
  await expect(stats).toHaveAttribute('data-statistics-mode', 'trend');
  await expect(stats.locator('#statisticsStatus')).toContainText('需要連續兩個完整');
  await stats.getByRole('button', { name: '常態熱度', exact: true }).click();
  await expect(stats.locator('.tw-statistics-summary')).toContainText('2,000');
  await page.locator('#historyStart').fill('2026-10-21');
  await page.locator('#historyEnd').fill('2026-10-21');
  await page.getByRole('button', { name: '套用日期', exact: true }).click();
  await expect(stats).toContainText('2026/10/21');
  await expect(stats.locator('.tw-statistics-summary')).toContainText('1,000');
  await expect(page.locator('#historyTableBody tr')).toHaveCount(24);
});

test('a failed refresh hides supplementary results along with the original stale data', async ({ page }) => {
  await page.goto('twitch-game.html?region=global&game=42');
  await expect(page.locator('#historyStatistics')).toBeVisible();
  await page.route('**/data/twitch_series/42/2026-10.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.locator('#historyRefresh').click();
  await expect(page.locator('#historyStatus')).toContainText('暫時無法取得');
  await expect(page.locator('#historyStatistics')).toBeHidden();
  await expect(page.locator('#historyContent')).toBeHidden();
  await expect(page.locator('#historyExport')).toBeDisabled();
});

test('a zero comparison baseline explains why there is no growth percentage', async ({ page }) => {
  const data = fixtures();
  const cutoff = Date.parse('2026-10-22T07:00:00Z') - 24 * 3600000;
  for (const [hour, row] of Object.entries(data.chunk.hours)) {
    const at = Date.parse(hour);
    if (at <= cutoff && at > cutoff - 24 * 3600000) row.viewer_count = 0;
  }
  await page.route('**/data/twitch_series/42/2026-10.json', route => route.fulfill({ json: data.chunk }));
  await page.goto('twitch-game.html?region=global&game=42');
  const stats = page.locator('#historyStatistics');
  await stats.getByRole('button', { name: '熱度動能', exact: true }).click();
  await expect(stats.locator('#statisticsStatus')).toContainText('為 0');
  await expect(stats.locator('.tw-statistics-summary')).not.toContainText('Infinity');
});

test('supplementary controls and charts fit mobile and support keyboard use', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('twitch-game.html?region=global&game=42');
  const stats = page.locator('#historyStatistics');
  await expect(stats).toBeVisible();
  const hourly = stats.getByRole('button', { name: '熱門時段', exact: true });
  await hourly.focus(); await page.keyboard.press('Enter');
  await expect(stats).toHaveAttribute('data-statistics-mode', 'hourly');
  await expect(stats.locator('.tw-statistics-chart svg')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

