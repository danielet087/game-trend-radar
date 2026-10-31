import { test, expect } from '@playwright/test';

const hour = '2026-10-31T00:00:00Z', generated = '2026-10-31T00:10:00Z';
function audience(viewers: number, channels = 2) {
  return { rule: 'followers_gt_1000_viewers_gte_10_v1', min_followers_exclusive: 1000,
    min_viewers_inclusive: 10, followers_max_age_hours: 24, status: 'complete',
    median_viewer_count: channels ? viewers / channels : null, eligible_streamer_count: channels,
    eligible_viewer_count: viewers, excluded_low_viewer_count: 0, excluded_low_follower_count: 0,
    unknown_follower_count: 0 };
}
const row = (id: string, global: number, chinese: number) => ({ game_id: id, game_name: `遊戲 ${id}`,
  viewer_count: global, streamer_count: 4, filtered_audience: audience(global, 4),
  verification: { status: 'new', observed_at: generated },
  audience_regions: { zh: { viewer_count: chinese, streamer_count: 2,
    median_viewer_count: chinese / 2, filtered_audience: audience(chinese) } } });

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.route('**/data/twitch_live.json', route => route.fulfill({ json: {
    schema_version: 2, generated_at: generated, min_viewers: 7000, coverage: { collection_complete: true },
    candidate_games: [row('1', 20000, 300), row('2', 10000, 800), { ...row('3', 9000, 0), audience_regions: undefined }],
  } }));
  for (const name of ['twitch_tracking', 'twitch_steam_mapping', 'catalog'])
    await page.route(`**/data/${name}.json`, route => route.fulfill({ status: 404, body: '{}' }));
  await page.route('**/data/twitch_series/index.json', route => route.fulfill({ json: {
    schema_version: 1, timezone: 'Asia/Taipei', generated_at: generated,
    months: { '2026-10': { [hour]: generated, '2026-10-30T23:00:00Z': '2026-10-30T23:10:00Z' } },
    games: { '1': { name: '遊戲 1', archive_eligible: true, tracking_status: 'active', months: ['2026-10'],
      first_hour: '2026-10-30T23:00:00Z', last_hour: hour, sample_count: 2, peak_viewer_count: 20000,
      audience_regions: { zh: { sample_count: 1, peak_viewer_count: 300 } } } },
  } }));
  await page.route('**/data/twitch_series/1/2026-10.json', route => route.fulfill({ json: {
    schema_version: 1, timezone: 'Asia/Taipei', game_id: '1', month: '2026-10', hours: {
      [hour]: { ...row('1', 20000, 300), generated_at: generated },
      '2026-10-30T23:00:00Z': { generated_at: '2026-10-30T23:10:00Z', viewer_count: 12000, streamer_count: 4 },
    },
  } }));
});

test('overview defaults to Chinese, switches sorting and metrics, and carries scope to history', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('twitch.html?sort=viewers');
  await expect(page.locator('#audienceRegion')).toHaveValue('zh');
  await expect(page.locator('.tw-game').first()).toHaveAttribute('data-game-id', '2');
  await expect(page.locator('.tw-game[data-game-id="1"] [data-kind="viewers"] strong')).toHaveText('300');
  await expect(page.locator('.tw-game[data-game-id="3"]')).toContainText('未收集中文區');
  await page.locator('#audienceRegion').selectOption('global');
  await expect(page).toHaveURL(/region=global/);
  await expect(page.locator('.tw-game').first()).toHaveAttribute('data-game-id', '1');
  await expect(page.locator('.tw-game').first().locator('[data-kind="viewers"] strong')).toHaveText('20,000');
  await page.locator('.tw-game').first().locator('.tw-detail-link').click();
  await expect(page.locator('#historyCategory')).toContainText('全球');
  await expect(page.locator('#historyTableBody tr').first().locator('td').nth(1)).toHaveText('20,000');
  await page.locator('#audienceRegion').selectOption('zh');
  await expect(page.locator('#historyCategory')).toContainText('中文區');
  await expect(page.locator('#historyTableBody tr').first().locator('td').nth(1)).toHaveText('300');
  await expect(page.locator('#historyTableBody tr').nth(1).locator('td').nth(1)).toHaveText('—');
  await expect(page.locator('#historyTableBody tr').nth(1).locator('td').nth(1)).toHaveAttribute('title', /未收集中文區/);
  await expect(page.locator('#historyBack')).not.toHaveAttribute('href', /region=global/);
  const download = page.waitForEvent('download');
  await page.locator('#historyExport').click();
  expect((await download).suggestedFilename()).toContain('-zh-');
  await page.reload(); await expect(page.locator('#audienceRegion')).toHaveValue('zh');
  expect(errors).toEqual([]);
});

test('archive preserves its query when changing region and uses regional peaks on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('twitch.html?view=archive&q=遊戲');
  await expect(page.locator('.tw-archive-card')).toContainText('300');
  await page.locator('#audienceRegion').selectOption('global');
  await expect(page.locator('#archiveSearch')).toHaveValue('遊戲');
  await expect(page).toHaveURL(/q=/);
  await expect(page.locator('.tw-archive-card')).toContainText('20,000');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
