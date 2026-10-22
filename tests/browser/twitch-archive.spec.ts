import { test, expect } from '@playwright/test';

const first = '2026-09-30T00:00:00Z', last = '2026-10-03T23:00:00Z', latest = '2026-10-22T07:00:00Z';
function fixtures() {
  const game = { name: 'Onimusha: Way of the Sword', display_name: '鬼武者 Way of the Sword', aliases: ['鬼武者', 'Onimusha'],
    steam_appids: ['2638890'], tracking_status: 'ended', archive_eligible: true, sample_count: 95, peak_viewer_count: 14066,
    first_hour: first, last_hour: last, months: ['2026-09', '2026-10'], box_art_url: 'https://static-cdn.jtvnw.net/ttv-boxart/42_IGDB-{width}x{height}.jpg' };
  const hours: Record<string, Record<string, string>> = { '2026-09': {}, '2026-10': { [latest]: latest } };
  const rows: Record<string, Record<string, any>> = { '2026-09': {}, '2026-10': {} };
  for (let n = 0; n < 95; n++) {
    const hour = new Date(Date.parse(last) - n * 3600000).toISOString().replace('.000Z', 'Z');
    const month = new Date(Date.parse(hour) + 8 * 3600000).toISOString().slice(0, 7);
    hours[month][hour] = hour; rows[month][hour] = { generated_at: hour, viewer_count: n ? 100 : 14066, streamer_count: 20 };
  }
  const games: Record<string, any> = { '42': game };
  games['32982'] = { ...game, name: 'Grand Theft Auto V', display_name: 'Grand Theft Auto V', aliases: [], steam_appids: [], archive_eligible: false };
  for (let i = 100; i < 127; i++) games[String(i)] = { ...game, name: `Archive ${i}`, display_name: `Archive ${i}`, aliases: [], steam_appids: [], tracking_status: 'active' };
  return { index: { schema_version: 1, timezone: 'Asia/Taipei', archive_version: 1, generated_at: latest, months: hours, games }, rows };
}
test.beforeEach(async ({ page }) => {
  const data = fixtures();
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.route('**/data/twitch_series/index.json', route => route.fulfill({ json: data.index }));
  await page.route('https://static-cdn.jtvnw.net/ttv-boxart/42_IGDB-144x192.jpg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="192"><rect width="144" height="192" fill="purple"/></svg>' }));
  for (const month of ['2026-09', '2026-10']) await page.route(`**/data/twitch_series/42/${month}.json`, route => route.fulfill({ json: {
    schema_version: 1, timezone: 'Asia/Taipei', game_id: '42', month, hours: data.rows[month],
  } }));
});

test('Chinese archive search opens retained history and returns with filters intact', async ({ page }) => {
  const errors: string[] = [], liveRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/twitch_(live|tracking|steam_mapping)\.json/.test(request.url())) liveRequests.push(request.url()); });
  await page.goto('twitch.html?view=archive');
  await expect(page.getByRole('tab', { name: '歷史資料庫' })).toHaveAttribute('aria-selected', 'true');
  await page.locator('#archiveSearch').fill('鬼武者');
  await page.locator('#archiveState').selectOption('ended');
  await page.locator('#archiveSort').selectOption('peak');
  const card = page.locator('.tw-archive-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('已結束追蹤');
  await expect(card).toContainText('95');
  await expect(card).toContainText('14,066');
  await expect(card.locator('img')).toHaveAttribute('src', 'https://static-cdn.jtvnw.net/ttv-boxart/42_IGDB-144x192.jpg');
  await expect.poll(() => card.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(144);
  await card.click();
  await expect(page.locator('#pageTitle')).toHaveText('鬼武者 Way of the Sword');
  await expect(page.locator('#historyEnd')).toHaveValue('2026-10-04');
  await expect(page.locator('#historyStatus')).toContainText('95 個有本遊戲');
  await page.getByRole('link', { name: '← 歷史資料庫', exact: true }).click();
  await expect(page.locator('#archiveSearch')).toHaveValue('鬼武者');
  await expect(page.locator('#archiveState')).toHaveValue('ended');
  await expect(page.locator('#archiveSort')).toHaveValue('peak');
  await expect(page.locator('.tw-archive-card')).toHaveCount(1);
  expect(liveRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('archive pagination, keyboard tabs, browser back and current search referral work', async ({ page }) => {
  await page.goto('twitch.html?view=archive');
  await expect(page.locator('.tw-archive-card')).toHaveCount(24);
  await page.locator('#archiveNext').click();
  await expect(page).toHaveURL(/archive_page=2/);
  await expect(page.locator('.tw-archive-card')).toHaveCount(4);
  await expect(page.locator('.tw-archive-card').first()).toHaveAttribute('href', /archive_page%3D2/);
  await page.reload();
  await expect(page.locator('#archivePage')).toHaveText('第 2 / 2 頁');
  await page.getByRole('tab', { name: '歷史資料庫' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: '目前觀測' })).toBeFocused();
  await expect(page.locator('#currentObservation')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#historyArchive')).toBeVisible();
  await expect(page.locator('#archivePage')).toHaveText('第 2 / 2 頁');
  await page.getByRole('tab', { name: '目前觀測' }).click();
  await page.locator('#gameSearch').fill('鬼武者');
  await expect(page.locator('#archiveSearchHint')).toContainText('找到 1 款');
  await page.locator('#archiveSearchHint').click();
  await expect(page.locator('#archiveSearch')).toHaveValue('鬼武者');
  await expect(page.locator('.tw-archive-card')).toHaveCount(1);
});

test('archive failure is retryable and mobile search has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = true;
  await page.route('**/data/twitch_series/index.json', route => fail ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.fulfill({ json: fixtures().index }));
  await page.goto('twitch.html?view=archive&q=鬼武者');
  await expect(page.locator('#archiveStatus')).toContainText('暫時無法讀取');
  fail = false;
  await page.locator('#archiveRefresh').click();
  await expect(page.locator('.tw-archive-card')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator('#archiveSearch').fill('No such game');
  await expect(page.locator('#archiveResults')).toContainText('沒有符合的歷史紀錄');
  await page.locator('#archiveReset').click();
  await expect(page.locator('.tw-archive-card')).toHaveCount(24);
});

test('unqualified raw games cannot appear in archive search or open through a direct history URL', async ({ page }) => {
  let monthlyRequest = false;
  page.on('request', request => { if (request.url().includes('/twitch_series/32982/')) monthlyRequest = true; });
  await page.goto('twitch.html?view=archive&q=Grand+Theft+Auto+V');
  await expect(page.locator('#archiveResults')).toContainText('沒有符合的歷史紀錄');
  await expect(page.locator('.tw-archive-card')).toHaveCount(0);
  await page.goto('twitch-game.html?game=32982');
  await expect(page.locator('#historyStatus')).toContainText('未列入正式收錄');
  await expect(page.locator('#historyContent')).toBeHidden();
  await expect(page.locator('#historyExport')).toBeDisabled();
  expect(monthlyRequest).toBe(false);
});
