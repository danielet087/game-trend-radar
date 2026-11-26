import { test, expect, type Page } from '@playwright/test';

// Two launches on 2026-11-26, seen at 14:40 (Taiwan): a big game known only by
// its IGDB date (hours 10:00～14:00, like Azur Promilia) and a small Steam game
// released at 09:00. Neither has a whole first day yet.
const HOUR = 3600000;
const stamp = (at: number) => new Date(at).toISOString().replace('.000Z', 'Z');
const at = (time: string) => Date.parse(`2026-11-26T${time}:00+08:00`);
type Hour = [viewers: number, channels: number, tiers: number[], zh: [viewers: number, channels: number, tiers: number[]]];
const games: Record<string, { name: string, reference: object, hours: Record<string, Hour> }> = {
  '1': { name: '首發大作', reference: { date: '2026-11-26', precision: 'day', source: 'IGDB' }, hours: {
    '10:00': [7792, 129, [15, 12, 10, 6], [3766, 51, [5, 4, 4, 3]]],
    '11:00': [11871, 186, [20, 15, 14, 10], [7493, 78, [8, 6, 6, 6]]],
    '12:00': [9011, 200, [20, 14, 11, 7], [5813, 94, [10, 6, 6, 5]]],
    '13:00': [9395, 195, [21, 12, 11, 6], [6122, 91, [10, 5, 5, 4]]],
    '14:00': [6734, 204, [18, 10, 8, 5], [5403, 84, [8, 4, 4, 3]]],
  } },
  '2': { name: '首發小品', reference: { date: '2026-11-26', precision: 'day', source: 'Steam 台灣商店', steam_appid: '99101' }, hours: {
    '09:00': [420, 14, [4, 2, 2, 1], [30, 2, [0, 0, 0, 0]]],
    '10:00': [560, 22, [5, 3, 2, 1], [40, 3, [1, 0, 0, 0]]],
    '11:00': [690, 26, [6, 4, 3, 2], [55, 3, [1, 1, 0, 0]]],
    '12:00': [610, 24, [6, 3, 3, 1], [45, 3, [1, 0, 0, 0]]],
    '13:00': [640, 25, [6, 4, 3, 2], [50, 3, [1, 0, 0, 0]]],
    '14:00': [600, 23, [5, 3, 2, 1], [42, 3, [1, 0, 0, 0]]],
  } },
};

async function mockLaunchDay(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-26T14:40:00+08:00'));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const indexHours: Record<string, string> = {}, chunks: Record<string, Record<string, object>> = { '1': {}, '2': {} };
  for (let hour = at('08:00'); hour <= at('14:00'); hour += HOUR) indexHours[stamp(hour)] = stamp(hour + 17 * 60000);
  for (const [id, game] of Object.entries(games)) {
    for (const [time, [viewers, channels, tiers, [zhViewers, zhChannels, zhTiers]]] of Object.entries(game.hours)) {
      const hour = stamp(at(time));
      chunks[id][hour] = { generated_at: indexHours[hour], viewer_count: viewers, streamer_count: channels, streamer_counts_above_viewers: tiers,
        audience_regions: { zh: { viewer_count: zhViewers, streamer_count: zhChannels, streamer_counts_above_viewers: zhTiers,
          measurement_source: 'helix_language_filter', largest_stream_viewer_count: Math.ceil(zhViewers / 3) } } };
    }
  }
  const generated = '2026-11-26T06:17:00Z';
  await page.route('**/data/twitch_live.json', route => route.fulfill({ json: {
    schema_version: 2, generated_at: generated, min_viewers: 7000, coverage: { collection_complete: true },
    candidate_games: Object.entries(games).map(([id, game]) => ({ game_id: id, game_name: game.name,
      viewer_count: 20000 - Number(id), streamer_count: 200, verification: { status: 'new', observed_at: generated } })),
  } }));
  for (const name of ['twitch_tracking', 'twitch_steam_mapping', 'twitch-launch-curves'])
    await page.route(`**/data/${name}.json`, route => route.fulfill({ status: 404, body: '{}' }));
  await page.route('**/data/catalog.json', route => route.fulfill({ json: {
    version: 3, generated_at: generated, count: 1, games: [{ appid: 99101, name: '首發小品', followers: 1000,
      release_start: '2026-11-26', release_time_utc: '2026-11-26T01:00:00Z' }] } }));
  await page.route('**/data/games/99101.json', route => route.fulfill({ json: {
    appid: 99101, name: '首發小品', release_start: '2026-11-26', release_time_utc: '2026-11-26T01:00:00Z' } }));
  await page.route('**/data/twitch_series/index.json', route => route.fulfill({ json: {
    schema_version: 1, timezone: 'Asia/Taipei', generated_at: generated, months: { '2026-11': indexHours },
    games: Object.fromEntries(Object.entries(games).map(([id, game]) => [id, { name: game.name, archive_eligible: true,
      tracking_status: 'active', months: ['2026-11'], first_hour: Object.keys(chunks[id])[0], last_hour: stamp(at('14:00')),
      sample_count: Object.keys(chunks[id]).length, peak_viewer_count: Math.max(...Object.values(game.hours).map(hour => hour[0])),
      release_reference: game.reference }])),
  } }));
  for (const id of Object.keys(games)) {
    await page.route(`**/data/twitch_series/${id}/2026-11-heat.json`, route => route.fulfill({ status: 404, body: '{}' }));
    await page.route(`**/data/twitch_series/${id}/2026-11.json`, route => route.fulfill({ json: {
      schema_version: 1, timezone: 'Asia/Taipei', game_id: id, month: '2026-11', hours: chunks[id] } }));
  }
}

test('the planning list calls both launches from their first hours', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mockLaunchDay(page);
  await page.goto('stream-planning.html?state=twitch_new');
  const big = page.locator('.tw-plan-card[data-game="1"]');
  await expect(big).toHaveAttribute('data-group', 'hot');
  // Both regions agree (five Chinese hours over 100): one advice for the card.
  await expect(big.locator('.tw-chip-advice')).toHaveText('首日熱門');
  // No whole day yet: the tiles show the hours so far instead of a blank.
  const bigTile = big.locator('.tw-plan-tile[data-region="global"]');
  await expect(bigTile.locator('.tw-plan-tile-label')).toHaveText('全球・每小時');
  // The column heads name the day, so the hour label shows on a wide screen too.
  await expect(bigTile.locator('.tw-plan-tile-label')).toBeVisible();
  await expect(bigTile.locator('strong')).toHaveText('9,000');
  await expect(bigTile.locator('.tw-plan-trend')).toHaveText('195 台在播');
  await expect(big.locator('.tw-plan-tile[data-region="zh"] .tw-plan-tile-label')).toHaveText('中文區・每小時');
  const small = page.locator('.tw-plan-card[data-game="2"]');
  await expect(small).toHaveAttribute('data-group', 'trial');
  // The Chinese region has just started recording: the worldwide call stands alone.
  await expect(small.locator('.tw-chip-advice')).toHaveText('首日大概過關');
  await expect(small.locator('.tw-plan-tile[data-region="global"] strong')).toHaveText('610');
  await expect(small.locator('.tw-plan-tile[data-region="global"] .tw-plan-trend')).toHaveText('24 台在播');
  // A card gives the conclusion only: no sentences.
  await expect(page.locator('.tw-plan-card p')).toHaveCount(0);
  await page.locator('#planInfoButton').click();
  await page.locator('#planInfo .tw-info-more summary').click();
  await expect(page.locator('#planInfoHours')).toContainText('標「每小時」');
  await expect(page.locator('#streamLaunchRule')).toContainText('上市頭 24 小時，先用到目前為止每小時的中位數提早判斷');
  expect(errors).toEqual([]);
});

test('the game page answers on the launch day: the call, 現在開的話 and the hours so far', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mockLaunchDay(page);
  await page.goto('twitch-game.html?game=1');
  const global = page.locator('#verdictPanel .tw-verdict-region[data-region="global"]');
  await expect(global.locator('.tw-verdict-chip')).toHaveText('首日熱門');
  await expect(global.locator('strong')).toHaveText('值得開');
  const sofar = page.locator('#verdictPanel .tw-verdict-tile').first();
  await expect(sofar.locator('dt')).toHaveText('全球・每小時');
  await expect(sofar.locator('strong')).toHaveText('約 9,000 人');
  await expect(sofar.locator('dd span')).toHaveText('195 台在播');
  // Over 60 viewers: 8 channels worldwide, 4 in the Chinese region, at 14:00.
  const place = page.locator('#verdictPanel .tw-verdict-tile').nth(1);
  await expect(place.locator('dt')).toHaveText('現在開的話');
  await expect(place.locator('strong')).toHaveText('第 9 名');
  await expect(place.locator('dd span')).toHaveText('14:00 那小時・平常 60 人');
  await expect(page.locator('#slotRank')).toHaveText('最近 7 天這段時間的名次紀錄不到 3 天，還不能算。14:00 那小時開的話：全球第 9 名、中文區第 5 名。');
  // Every hour so far, until two whole days exist.
  await expect(page.locator('#dailyPanel h2')).toHaveText('上市後每小時有多少人在看');
  await expect(page.locator('#dailyPanel .tw-daily-chart')).toHaveAttribute('aria-label', /11\/26 11:00 高峰 11,871 人/);
  await expect(page.locator('#dailyPanel .tw-game-caption')).toHaveText('11/26 14:00 約 6,700 人。');
  await page.getByRole('button', { name: '中文區', exact: true }).first().click();
  await expect(place.locator('strong')).toHaveText('第 5 名');
  await page.goto('twitch-game.html?game=2');
  await expect(page.locator('#verdictPanel .tw-verdict-region[data-region="global"] .tw-verdict-chip')).toHaveText('首日大概過關');
  await expect(page.locator('#verdictPanel .tw-verdict-region[data-region="global"] strong')).toHaveText('可以先試播一場');
  // Steam gives the launch hour: the hourly chart starts there.
  await expect(page.locator('#dailyPanel .tw-daily-chart')).toHaveAttribute('aria-label', /11\/26 11:00 高峰 690 人/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#dailyPanel .tw-daily-chart')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});
