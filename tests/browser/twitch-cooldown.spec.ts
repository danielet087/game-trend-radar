import { test, expect } from '@playwright/test';

function fixtures(length = 120, trackingStatus = 'ended', low = true) {
  const start = Date.parse('2026-09-29T00:00:00Z');
  const months: Record<string, Record<string, string>> = {}, chunks: Record<string, any> = {};
  for (let n = 0; n < length; n++) {
    const at = start + n * 3600000, hour = new Date(at).toISOString().replace('.000Z', 'Z');
    const generated = new Date(at + 600000).toISOString().replace('.000Z', 'Z');
    const month = new Date(at + 8 * 3600000).toISOString().slice(0, 7);
    months[month] ||= {};
    months[month][hour] = generated;
    chunks[month] ||= { schema_version: 1, timezone: 'Asia/Taipei', game_id: '42', month, hours: {} };
    chunks[month].hours[hour] = { generated_at: generated, viewer_count: low && n >= 36 ? 1000 : 10000, streamer_count: 40 };
  }
  const first = new Date(start).toISOString().replace('.000Z', 'Z');
  const last = new Date(start + (length - 1) * 3600000).toISOString().replace('.000Z', 'Z');
  return { chunks, index: { schema_version: 1, timezone: 'Asia/Taipei', generated_at: new Date(start + (length - 1) * 3600000 + 600000).toISOString(), months,
    games: { '42': { name: '退潮測試遊戲', archive_eligible: true, tracking_status: trackingStatus,
      release_reference: { date: '2026-09-23', source: 'Steam 台灣商店', precision: 'day' },
      first_hour: first, last_hour: last, months: Object.keys(months) } } } };
}

async function mock(page, data = fixtures()) {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.route('**/data/twitch_series/index.json', route => route.fulfill({ json: data.index }));
  for (const [month, chunk] of Object.entries(data.chunks))
    await page.route(`**/data/twitch_series/42/${month}.json`, route => route.fulfill({ json: chunk }));
}

test('the full-history cooldown onset and confirmation survive date changes without altering the original chart', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await mock(page);
  await page.goto('twitch-game.html?game=42&range=24h');
  const panel = page.locator('#historyCooldown');
  await expect(panel).toHaveAttribute('data-cooldown-status', 'cooled');
  await expect(page.locator('#cooldownSummary')).toContainText('2026/09/30 23:00');
  await expect(page.locator('#cooldownSummary')).toContainText('2026/10/01 23:00');
  await expect(page.locator('#cooldownRange')).toContainText('2026/09/29');
  await expect(page.locator('#cooldownReleaseSummary')).toContainText('上市後第 7 天');
  await expect(page.locator('#cooldownReleaseSummary')).toContainText('觀測到持續退潮');
  await expect(page.locator('#cooldownReleaseSummary')).toContainText('第 6 天才開始觀測');
  await expect(page.locator('#cooldownChart svg')).toBeVisible();
  await expect(page.locator('#historyChart .tw-chart')).toHaveAttribute('data-range', '24');
  const summary = await page.locator('#cooldownSummary').innerText();
  await page.getByRole('button', { name: '7 天', exact: true }).click();
  await expect(panel).toHaveAttribute('data-cooldown-status', 'cooled');
  await expect(page.locator('#cooldownSummary')).toHaveText(summary);
  await page.locator('[name="cooldownHold"]').selectOption('48');
  await expect(page.locator('#cooldownSummary')).toContainText('2026/10/02 23:00');
  await expect(page.locator('#historyChart .tw-chart')).toHaveAttribute('data-range', '168');
  await expect(page.locator('#historyStatistics')).toBeVisible();
  await expect(page.locator('#historyExport')).toBeEnabled();
  expect(failures).toEqual([]);
});

test('failure in an older month only affects cooldown and can be retried independently', async ({ page }) => {
  const data = fixtures(); await mock(page, data);
  await page.route('**/data/twitch_series/42/2026-09.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('twitch-game.html?game=42&range=24h');
  await expect(page.locator('#historyContent')).toBeVisible();
  await expect(page.locator('#historyStatistics')).toBeVisible();
  await expect(page.locator('#historyCooldown').getByRole('button', { name: '重新讀取全期資料', exact: true })).toBeVisible();
  await expect(page.locator('#historyExport')).toBeEnabled();
  await page.unroute('**/data/twitch_series/42/2026-09.json');
  await page.route('**/data/twitch_series/42/2026-09.json', route => route.fulfill({ json: data.chunks['2026-09'] }));
  await page.locator('#historyCooldown').getByRole('button', { name: '重新讀取全期資料', exact: true }).click();
  await expect(page.locator('#historyCooldown')).toHaveAttribute('data-cooldown-status', 'cooled');
});

test('ending tracking is not interpreted as a decline', async ({ page }) => {
  await mock(page, fixtures(120, 'ended', false));
  await page.goto('twitch-game.html?game=42');
  await expect(page.locator('#historyCooldown')).toHaveAttribute('data-cooldown-status', 'watching');
  await expect(page.locator('#cooldownStatus')).not.toContainText('已持續退潮');
  await expect(page.locator('#cooldownSummary')).not.toContainText('2026/09/30 23:00');
});

test('an unknown release date never turns the observation start into release day zero', async ({ page }) => {
  const data = fixtures(); delete data.index.games['42'].release_reference;
  await mock(page, data); await page.goto('twitch-game.html?game=42');
  await expect(page.locator('#historyCooldown')).toHaveAttribute('data-cooldown-status', 'cooled');
  await expect(page.locator('#cooldownReleaseSummary')).toContainText('上市日尚未確認');
  await expect(page.locator('#cooldownReleaseSummary')).not.toContainText('上市後第');
});

test('a live game with old observations reports uncertainty while retaining historical events', async ({ page }) => {
  await mock(page, fixtures(120, 'active'));
  await page.goto('twitch-game.html?game=42');
  await expect(page.locator('#historyCooldown')).toHaveAttribute('data-cooldown-status', 'stale');
  await expect(page.locator('#cooldownStatus')).toContainText('最新狀態待確認');
  await expect(page.locator('#cooldownEvents')).toContainText('2026/09/30 23:00');
});

test('an unconfirmed decline is labelled as suspected and mobile controls fit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page, fixtures(50, 'ended'));
  await page.goto('twitch-game.html?game=42&range=24h');
  await expect(page.locator('#historyCooldown')).toHaveAttribute('data-cooldown-status', 'suspected');
  await expect(page.locator('#cooldownStatus')).toContainText('疑似');
  await page.locator('#cooldownScrubber').focus(); await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
