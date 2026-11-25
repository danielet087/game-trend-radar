import { test, expect, type Page } from '@playwright/test';

// Two launches released 2026-11-08 01:00 (Taiwan) and watched until 11-11 12:00:
// a small game that keeps 250 viewers on its third day, and a dark horse whose
// third day doubles its first.
const release = Date.parse('2026-11-08T01:00:00+08:00'), HOUR = 3600000;
const stamp = (at: number) => new Date(at).toISOString().replace('.000Z', 'Z');
const games = {
  '1': { name: '小遊戲', appid: 99001, daily: [400, 300, 250, 240], channels: 6 },
  '2': { name: '黑馬遊戲', appid: 99002, daily: [4000, 6000, 9000, 9500], channels: 40 },
};

async function mockLaunches(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-11T12:00:00+08:00'));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const indexHours: Record<string, string> = {}, chunks: Record<string, Record<string, object>> = { '1': {}, '2': {} };
  for (let at = release - 2 * HOUR; at <= Date.parse('2026-11-11T11:00:00+08:00'); at += HOUR) {
    const hour = stamp(at), generated_at = stamp(at + 600000), day = Math.floor((at - release) / (24 * HOUR));
    indexHours[hour] = generated_at;
    for (const [id, game] of Object.entries(games)) {
      if (day < 0) continue;
      chunks[id][hour] = { generated_at, viewer_count: game.daily[day], streamer_count: game.channels + day * 10,
        audience_regions: { zh: { viewer_count: 20, streamer_count: 1 } } };
    }
  }
  const generated = '2026-11-11T03:15:00Z';
  await page.route('**/data/twitch_live.json', route => route.fulfill({ json: {
    schema_version: 2, generated_at: generated, min_viewers: 7000, coverage: { collection_complete: true },
    // The live list only carries games above its 7,000-viewer bar; the hourly series decides the labels.
    candidate_games: Object.entries(games).map(([id, game]) => ({ game_id: id, game_name: game.name,
      viewer_count: 20000 - Number(id), streamer_count: game.channels, verification: { status: 'new', observed_at: generated } })),
  } }));
  for (const name of ['twitch_tracking', 'twitch_steam_mapping'])
    await page.route(`**/data/${name}.json`, route => route.fulfill({ status: 404, body: '{}' }));
  await page.route('**/data/catalog.json', route => route.fulfill({ json: {
    version: 3, generated_at: generated, count: 2, games: Object.values(games).map(game => ({ appid: game.appid, name: game.name,
      followers: 1000, release_start: '2026-11-08', release_time_utc: '2026-11-07T17:00:00Z' })),
  } }));
  for (const game of Object.values(games))
    await page.route(`**/data/games/${game.appid}.json`, route => route.fulfill({ json: {
      appid: game.appid, name: game.name, release_start: '2026-11-08', release_time_utc: '2026-11-07T17:00:00Z' } }));
  await page.route('**/data/twitch_series/index.json', route => route.fulfill({ json: {
    schema_version: 1, timezone: 'Asia/Taipei', generated_at: generated, months: { '2026-11': indexHours },
    games: Object.fromEntries(Object.entries(games).map(([id, game]) => [id, { name: game.name, archive_eligible: true,
      tracking_status: 'active', months: ['2026-11'], first_hour: stamp(release), last_hour: '2026-11-11T03:00:00Z',
      sample_count: Object.keys(chunks[id]).length, peak_viewer_count: Math.max(...game.daily),
      release_reference: { date: '2026-11-08', precision: 'day', source: 'Steam 台灣商店', steam_appid: String(game.appid) } }])),
  } }));
  for (const id of Object.keys(games)) {
    await page.route(`**/data/twitch_series/${id}/2026-11-heat.json`, route => route.fulfill({ status: 404, body: '{}' }));
    await page.route(`**/data/twitch_series/${id}/2026-11.json`, route => route.fulfill({ json: {
      schema_version: 1, timezone: 'Asia/Taipei', game_id: id, month: '2026-11', hours: chunks[id] } }));
  }
}

test('the planning list marks a small game worth a trial and a dark-horse candidate', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mockLaunches(page);
  await page.goto('stream-planning.html?sort=viewers');
  // Only the two Twitch launches; the fixture's Steam games have no hourly records.
  await page.locator('#streamSource').selectOption('twitch_new');
  const small = page.locator('.tw-stream-game[data-game="1"] .tw-stream-launch-line');
  await expect(small).toHaveCount(1);
  await expect(small).toHaveAttribute('data-launch', 'trial-holding');
  await expect(small.locator('strong')).toHaveText('值得試播');
  await expect(small.locator('span')).toHaveText('第 3 天 250 人 · 觀眾還在');
  const horse = page.locator('.tw-stream-game[data-game="2"] .tw-stream-launch-line');
  await expect(horse).toHaveCount(1);
  await expect(horse).toHaveAttribute('data-launch', 'candidate');
  await expect(horse.locator('strong')).toHaveText('黑馬候選');
  await expect(horse.locator('span')).toHaveText('第 3 天是首日 2.3 倍 · 開台 40→60');
  await page.locator('.tw-stream-method summary').click();
  await expect(page.locator('#streamLaunchRule')).toContainText('首 24 小時有 300 人、最近一天有 200 人以上');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('the game page explains the trial advice and the dark-horse label', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mockLaunches(page);
  await page.goto('twitch-game.html?game=1&region=compare');
  const global = page.locator('#heatOverview-global .tw-stream-action');
  await expect(global.locator('h3')).toHaveText('值得試播一場');
  await expect(global.locator('p').first()).toHaveText('上市第 3 天中位數 250 人；第 3 天還有首日的 63%，觀眾還在。');
  await global.locator('.tw-launch-rule summary').click();
  await expect(global.locator('.tw-launch-rule p')).toContainText('兩關都過的 24 款');
  await expect(page.locator('#heatOverview-zh .tw-launch-rule p')).toContainText('這裡依全球觀眾判斷');
  await page.goto('twitch-game.html?game=2');
  const flag = page.locator('#heatOverview-global .tw-launch-flag');
  await expect(flag).toHaveAttribute('data-flag', 'candidate');
  await expect(flag).toHaveText('黑馬候選：上市第 3 天（48～72 小時）是首日的 2.3 倍，一般遊戲這時只剩約 34%。開台數 40→60。');
  await expect(page.locator('#heatOverview-global .tw-stream-action h3')).not.toHaveText('值得試播一場');
  expect(errors).toEqual([]);
});

test('the planning list and the game page forecast days 7-9 from the first 48 hours', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mockLaunches(page);
  // Forty past launches whose days 7-9 were 1% to 40% of their first hours.
  const ratios = Array.from({ length: 40 }, (_, i) => (i + 1) / 100);
  await page.route('**/data/twitch-launch-curves.json', route => route.fulfill({ json: {
    schema_version: 2, generated_at: '2026-11-11T03:00:00Z', genres: { Action: '動作' }, games: {},
    forecast: { trained_through: '2026-11-10T16:00:00Z', launches: 40, checkpoints: { 24: ratios, 48: ratios },
      backtest: { 48: { launches: 30, median_miss: 2.8, within_range: 0.66, thresholds: {
        100: { reached: 15, likely: 16, likely_reached: 12 }, 1000: { reached: 6, likely: 7, likely_reached: 6 },
        3000: { reached: 3, likely: 2, likely_reached: 2 } } } } },
  } }));
  await page.goto('stream-planning.html?sort=viewers');
  await page.locator('#streamSource').selectOption('twitch_new');
  const horse = page.locator('.tw-stream-game[data-game="2"] .tw-stream-launch-line[data-launch="forecast"]');
  await expect(horse.locator('strong')).toHaveText('第 7～9 天預估');
  await expect(horse.locator('span')).toHaveText('約 1,000 人（100 人 超過 95% · 1,000 人 55% · 3,000 人 不到 5%）');
  const small = page.locator('.tw-stream-game[data-game="1"] .tw-stream-launch-line[data-launch="forecast"] span');
  await expect(small).toHaveText('約 72 人（100 人 30% · 1,000 人 不到 5% · 3,000 人 不到 5%）');
  await page.locator('.tw-stream-method summary').click();
  await expect(page.locator('#streamForecastRule')).toContainText('首 48 小時版 30 款');
  await expect(page.locator('#streamForecastRule')).toContainText('說「還有 1,000 人」機率過半的 7 款，6 款真的有');
  await page.goto('twitch-game.html?game=2');
  const forecast = page.locator('#heatOverview-global .tw-launch-forecast');
  await expect(forecast.locator('h3')).toHaveText('上市第 7～9 天約 1,000 人');
  await expect(forecast.locator('p').first()).toHaveText(
    '首 48 小時中位數 5,000 人。照過去 40 款新作，第 7～9 天大約是首 48 小時的 21%；換成這款，中間八成落在 250～1,800 人。');
  await expect(forecast.locator('.tw-forecast-caption')).toHaveText('第 7～9 天還有這麼多人的機率');
  await expect(forecast.locator('dt')).toHaveText(['100 人', '1,000 人', '3,000 人']);
  await expect(forecast.locator('dd')).toHaveText(['超過 95%', '55%', '不到 5%']);
  await forecast.locator('.tw-launch-rule summary').click();
  await expect(forecast.locator('.tw-launch-rule p')).toContainText('落在中間八成範圍內的 66%');
  await expect(page.locator('#heatOverview-global [data-flag="launch-start"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});
