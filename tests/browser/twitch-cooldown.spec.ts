import { test, expect } from '@playwright/test';

function fixtures(length = 120, trackingStatus = 'ended', low = true) {
  const start = Date.parse('2026-09-28T16:00:00Z'); // Taiwan 09/29 00:00; whole calendar days.
  const months: Record<string, Record<string, string>> = {}, chunks: Record<string, any> = {};
  for (let n = 0; n < length; n++) {
    const at = start + n * 3600000, hour = new Date(at).toISOString().replace('.000Z', 'Z');
    const generated = new Date(at + 600000).toISOString().replace('.000Z', 'Z');
    const month = new Date(at + 8 * 3600000).toISOString().slice(0, 7);
    months[month] ||= {};
    months[month][hour] = generated;
    chunks[month] ||= { schema_version: 1, timezone: 'Asia/Taipei', game_id: '42', month, hours: {} };
    chunks[month].hours[hour] = { generated_at: generated, viewer_count: low && n >= 48 ? 1000 : 10000, streamer_count: 40 };
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

test('relative decline shows release-to-peak days and measures each drop from the peak day', async ({ page }) => {
  const data = fixtures(216);
  const values = [40000, 100000, 80000, 75000, 60000, 50000, 40000, 25000, 24000];
  const hours = Object.values(data.chunks).flatMap(chunk => Object.entries(chunk.hours) as [string, any][]).sort(([a], [b]) => a.localeCompare(b));
  hours.forEach(([, row], index) => { row.viewer_count = values[Math.floor(index / 24)]; });
  await mock(page, data); await page.goto('twitch-game.html?region=global&game=42&range=24h');
  const decline = page.locator('#cooldownRelativeDecline');
  await expect(page.locator('#cooldownPeak')).toHaveText('上市後第 7 天達到高峰');
  await expect(decline).toContainText('目前高峰日：2026-09-30');
  await expect(decline.getByRole('button', { name: '高峰後第 2 天 · 較高峰下降 25%', exact: true })).toBeVisible();
  await expect(decline.getByRole('button', { name: '高峰後第 4 天 · 較高峰下降 50%', exact: true })).toBeVisible();
  await expect(decline.getByRole('button', { name: '高峰後第 6 天 · 較高峰下降 75%', exact: true })).toBeVisible();
  await decline.getByRole('button', { name: '高峰後第 2 天 · 較高峰下降 25%', exact: true }).click();
  await expect(page.locator('#cooldownReadout')).toContainText('2026-10-02 每日中位數');
  await page.getByRole('button', { name: '7 天', exact: true }).click();
  await expect(page.locator('#cooldownPeak')).toHaveText('上市後第 7 天達到高峰');
  await expect(decline).toContainText('高峰後第 6 天');
  await expect(page.locator('#historyCooldown')).toHaveAttribute('data-cooldown-status', 'watching');
});

test('a new peak replaces both the release-to-peak day and all relative decline day counts', async ({ page }) => {
  const data = fixtures(240);
  const hours = Object.values(data.chunks).flatMap(chunk => Object.entries(chunk.hours) as [string, any][]).sort(([a], [b]) => a.localeCompare(b));
  const oldValues = [40000, 100000, 75000, 50000, 25000, 25000, 25000, 25000, 25000, 25000];
  hours.forEach(([, row], index) => { row.viewer_count = oldValues[Math.floor(index / 24)]; });
  await mock(page, data); await page.goto('twitch-game.html?region=global&game=42');
  const decline = page.locator('#cooldownRelativeDecline');
  await expect(page.locator('#cooldownPeak')).toHaveText('上市後第 7 天達到高峰');
  await expect(decline.getByRole('button', { name: '高峰後第 1 天 · 較高峰下降 25%', exact: true })).toBeVisible();
  const newValues = [40000, 100000, 75000, 50000, 25000, 200000, 180000, 150000, 100000, 50000];
  hours.forEach(([, row], index) => { row.viewer_count = newValues[Math.floor(index / 24)]; });
  await page.reload();
  await expect(page.locator('#cooldownPeak')).toHaveText('上市後第 11 天達到高峰');
  await expect(decline).toContainText('目前高峰日：2026-10-04');
  await expect(decline.getByRole('button', { name: '高峰後第 2 天 · 較高峰下降 25%', exact: true })).toBeVisible();
  await expect(decline.getByRole('button', { name: '高峰後第 3 天 · 較高峰下降 50%', exact: true })).toBeVisible();
  await expect(decline.getByRole('button', { name: '高峰後第 4 天 · 較高峰下降 75%', exact: true })).toBeVisible();
});

test('a never-popular game shows a neutral label and no cooldown countdown', async ({ page }) => {
  const data = fixtures();
  for (const chunk of Object.values(data.chunks))
    for (const row of Object.values(chunk.hours) as any[]) row.viewer_count = 1000;
  await mock(page, data); await page.goto('twitch-game.html?region=global&game=42');
  await expect(page.locator('#historyCooldown')).toHaveAttribute('data-cooldown-status', 'not_popular');
  await expect(page.locator('#cooldownStatus')).toHaveText('尚未達熱門門檻');
  await expect(page.locator('#cooldownSummary')).toContainText('尚未啟用');
  await expect(page.locator('#cooldownSummary')).not.toContainText('0 / 3 天');
  await expect(page.locator('#cooldownDailyEvidence')).toContainText('不累積退燒天數');
  await expect(page.locator('#cooldownEvents button')).toHaveCount(0);
});

test('a later breakout starts a fresh countdown rather than reusing the initial low days', async ({ page }) => {
  const data = fixtures(144);
  const hours = Object.values(data.chunks).flatMap(chunk => Object.entries(chunk.hours) as [string, any][]).sort(([a], [b]) => a.localeCompare(b));
  hours.forEach(([, row], index) => { row.viewer_count = index >= 72 && index < 96 ? 5000 : 1000; });
  await mock(page, data); await page.goto('twitch-game.html?region=global&game=42');
  await expect(page.locator('#historyCooldown')).toHaveAttribute('data-cooldown-status', 'suspected');
  await expect(page.locator('#cooldownStatus')).toContainText('等待滿 3 天');
  await expect(page.locator('#cooldownSummary')).toContainText('2 / 3 天');
  await expect(page.locator('#cooldownEvents')).not.toContainText('退燒確認');
});

test('the full-history cooldown onset and confirmation survive date changes without altering the original chart', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await mock(page);
  await page.goto('twitch-game.html?region=global&game=42&range=24h');
  const panel = page.locator('#historyCooldown');
  await expect(panel).toHaveAttribute('data-cooldown-status', 'cooled');
  await expect(page.locator('#cooldownStatus')).toHaveText('已退燒');
  await expect(page.locator('#cooldownSummary')).toContainText('2026/10/01 00:00');
  await expect(page.locator('#cooldownSummary')).toContainText('2026/10/04 00:00');
  await expect(page.locator('#cooldownRange')).toContainText('2026/09/29');
  await expect(page.locator('#cooldownReleaseSummary')).toContainText('上市後第 8 天');
  await expect(page.locator('#cooldownReleaseSummary')).toContainText('上市後第 11 天');
  await expect(page.locator('#cooldownReleaseSummary')).toContainText('第 6 天才開始觀測');
  await expect(page.locator('#cooldownChart svg')).toBeVisible();
  await expect(page.locator('#historyChart .tw-chart')).toHaveAttribute('data-range', '24');
  const summary = await page.locator('#cooldownSummary').innerText();
  await page.getByRole('button', { name: '7 天', exact: true }).click();
  await expect(panel).toHaveAttribute('data-cooldown-status', 'cooled');
  await expect(page.locator('#cooldownSummary')).toHaveText(summary, { useInnerText: true });
  await expect(panel.locator('select')).toHaveCount(0);
  await expect(page.locator('#cooldownRule')).toContainText('3,000');
  await expect(page.locator('#cooldownDailyEvidence')).toContainText('24 / 24');
  await expect(page.locator('#historyChart .tw-chart')).toHaveAttribute('data-range', '168');
  await expect(page.locator('#historyStatistics')).toBeVisible();
  await expect(page.locator('#historyExport')).toBeEnabled();
  expect(failures).toEqual([]);
});

test('failure in an older month only affects cooldown and can be retried independently', async ({ page }) => {
  const data = fixtures(); await mock(page, data);
  await page.route('**/data/twitch_series/42/2026-09.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('twitch-game.html?region=global&game=42&range=24h');
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
  await page.goto('twitch-game.html?region=global&game=42');
  await expect(page.locator('#historyCooldown')).toHaveAttribute('data-cooldown-status', 'watching');
  await expect(page.locator('#cooldownStatus')).not.toContainText('已退燒');
  await expect(page.locator('#cooldownSummary')).not.toContainText('2026/10/01 00:00');
});

test('an unknown release date never turns the observation start into release day zero', async ({ page }) => {
  const data = fixtures(); delete data.index.games['42'].release_reference;
  await mock(page, data); await page.goto('twitch-game.html?region=global&game=42');
  await expect(page.locator('#historyCooldown')).toHaveAttribute('data-cooldown-status', 'cooled');
  await expect(page.locator('#cooldownReleaseSummary')).toContainText('上市日尚未確認');
  await expect(page.locator('#cooldownReleaseSummary')).not.toContainText('上市後第');
  await expect(page.locator('#cooldownPeak')).toContainText('上市日尚未確認');
  await expect(page.locator('#cooldownRelativeDecline')).toContainText('高峰後第 2 天');
});

test('a live game with old observations reports uncertainty while retaining historical events', async ({ page }) => {
  await mock(page, fixtures(120, 'active'));
  await page.goto('twitch-game.html?region=global&game=42');
  await expect(page.locator('#historyCooldown')).toHaveAttribute('data-cooldown-status', 'stale');
  await expect(page.locator('#cooldownStatus')).toContainText('最新狀態待確認');
  await expect(page.locator('#cooldownEvents')).toContainText('2026/10/01 00:00');
});

test('an unconfirmed decline is labelled as suspected and mobile controls fit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page, fixtures(72, 'ended'));
  await page.goto('twitch-game.html?region=global&game=42&range=24h');
  await expect(page.locator('#historyCooldown')).toHaveAttribute('data-cooldown-status', 'suspected');
  await expect(page.locator('#cooldownStatus')).toContainText('等待滿 3 天');
  await page.locator('#cooldownScrubber').focus(); await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

for (const missingHours of [12, 13]) {
  test(`a daily gap of ${missingHours} hours ${missingHours === 12 ? 'preserves' : 'breaks'} the three-day count`, async ({ page }) => {
    const data = fixtures();
    const hours = Object.keys(data.chunks['2026-10'].hours).sort();
    // Remove measurements from the second low day, retaining the hourly index.
    for (const hour of hours.slice(24, 24 + missingHours)) delete data.chunks['2026-10'].hours[hour];
    await mock(page, data);
    await page.goto('twitch-game.html?region=global&game=42');
    await expect(page.locator('#historyCooldown')).toHaveAttribute('data-cooldown-status', missingHours === 12 ? 'cooled' : 'suspected');
    await expect(page.locator('#cooldownDailyEvidence')).toContainText(`${24 - missingHours} / 24`);
    if (missingHours === 13) await expect(page.locator('#cooldownStatus')).not.toContainText('已退燒');
  });
}

test('a 50 percent fall to 50,000 viewers stays above the fixed threshold', async ({ page }) => {
  const data = fixtures();
  for (const chunk of Object.values(data.chunks)) {
    for (const row of Object.values(chunk.hours) as any[]) row.viewer_count = row.viewer_count === 10000 ? 100000 : 50000;
  }
  await mock(page, data);
  await page.goto('twitch-game.html?region=global&game=42');
  await expect(page.locator('#historyCooldown')).toHaveAttribute('data-cooldown-status', 'watching');
  await expect(page.locator('#cooldownSummary')).toContainText('50,000');
  await expect(page.locator('#cooldownStatus')).not.toContainText('已退燒');
});

for (const elapsedHours of [5, 12, 13]) {
  test(`a live record ${elapsedHours} hours old preserves its day count and uses the twelve-hour freshness limit`, async ({ page }) => {
    const data = fixtures(120, 'active');
    await page.clock.setFixedTime(new Date(Date.parse(data.index.games['42'].last_hour) + elapsedHours * 3600000));
    await mock(page, data);
    await page.goto('twitch-game.html?region=global&game=42');
    await expect(page.locator('#historyCooldown')).toHaveAttribute('data-cooldown-status', elapsedHours > 12 ? 'stale' : 'cooled');
    await expect(page.locator('#historyCooldown')).toHaveAttribute('data-cooldown-model-status', 'cooled');
    await expect(page.locator('#cooldownEvents')).toContainText('2026/10/04 00:00');
  });
}




