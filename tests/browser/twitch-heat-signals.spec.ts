import { test, expect, type Page } from '@playwright/test';

// Three launches watched until 2026-11-11 12:00 (Taiwan), one day per entry:
// a small game falling far below its own 2,000-viewer peak, a big game holding
// up better than same-age launches, and a big game back up over three days.
const HOUR = 3600000;
const stamp = (at: number) => new Date(at).toISOString().replace('.000Z', 'Z');
const games: Record<string, { name: string, appid: number, release: string, daily: number[], from?: string, full?: string }> = {
  '3': { name: '退燒小遊戲', appid: 99003, release: '2026-11-01', daily: [2000, 1500, 600, 300, 200, 150, 120, 100, 90, 80, 80] },
  '4': { name: '長青大作', appid: 99004, release: '2026-11-01', daily: [5000, 4500, 4200, 4000, 3900, 3800, 3700, 3600, 3500, 3400, 3400] },
  '5': { name: '回溫大作', appid: 99005, release: '2026-10-21',
    daily: [8000, 6000, 5000, 4200, 4000, 3800, 3600, 3400, 3200, 3100, 3000, 3000, 3000, 3000, 2000, 2000, 2000, 3500, 3600, 3700, 3700] },
  // A beta streamed for a week before its January release.
  '6': { name: '測試中大作', appid: 99006, release: '2027-01-20', from: '2026-11-04', daily: [6000, 5000, 4500, 4200, 4000, 4000, 4000, 4000] },
  // Early Access from 10/20 at 3,000 viewers; the full release on 11/05 reaches 9,000.
  '7': { name: '搶先體驗大作', appid: 99007, release: '2026-10-20', full: '2026-11-05',
    daily: [...Array(16).fill(3000), 9000, 8000, 7500, 7000, 6500, 6000, 5500] },
};
const releaseAt = (date: string) => Date.parse(`${date}T01:00:00+08:00`);

async function mockSignals(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-11T12:00:00+08:00'));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const months: Record<string, Record<string, string>> = {}, chunks: Record<string, Record<string, Record<string, object>>> = {};
  const end = Date.parse('2026-11-11T11:00:00+08:00');
  for (const [id, game] of Object.entries(games)) {
    chunks[id] = {};
    const from = releaseAt(game.from ?? game.release);
    for (let at = from; at <= end; at += HOUR) {
      const hour = stamp(at), generated_at = stamp(at + 600000), day = Math.floor((at - from) / (24 * HOUR));
      const month = new Date(at + 8 * HOUR).toISOString().slice(0, 7);
      (months[month] ||= {})[hour] = generated_at;
      (chunks[id][month] ||= {})[hour] = { generated_at, viewer_count: game.daily[day], streamer_count: 20,
        audience_regions: { zh: { viewer_count: 20, streamer_count: 1 } } };
    }
  }
  const generated = '2026-11-11T03:15:00Z';
  await page.route('**/data/twitch_live.json', route => route.fulfill({ json: {
    schema_version: 2, generated_at: generated, min_viewers: 7000, coverage: { collection_complete: true },
    candidate_games: Object.entries(games).map(([id, game]) => ({ game_id: id, game_name: game.name,
      viewer_count: 20000 - Number(id), streamer_count: 20, verification: { status: 'new', observed_at: generated } })),
  } }));
  for (const name of ['twitch_tracking', 'twitch_steam_mapping'])
    await page.route(`**/data/${name}.json`, route => route.fulfill({ status: 404, body: '{}' }));
  const time = (game: typeof games[string]) => stamp(releaseAt(game.release));
  await page.route('**/data/catalog.json', route => route.fulfill({ json: {
    version: 3, generated_at: generated, count: Object.keys(games).length, games: Object.values(games).map(game => ({ appid: game.appid, name: game.name,
      followers: 1000, release_start: game.release, release_time_utc: time(game) })),
  } }));
  for (const game of Object.values(games))
    await page.route(`**/data/games/${game.appid}.json`, route => route.fulfill({ json: {
      appid: game.appid, name: game.name, release_start: game.release, release_time_utc: time(game) } }));
  await page.route('**/data/twitch_series/index.json', route => route.fulfill({ json: {
    schema_version: 1, timezone: 'Asia/Taipei', generated_at: generated, months,
    games: Object.fromEntries(Object.entries(games).map(([id, game]) => [id, { name: game.name, archive_eligible: true,
      tracking_status: 'active', months: Object.keys(chunks[id]), first_hour: stamp(releaseAt(game.from ?? game.release)), last_hour: '2026-11-11T03:00:00Z',
      sample_count: Object.values(chunks[id]).reduce((sum, hours) => sum + Object.keys(hours).length, 0),
      peak_viewer_count: Math.max(...game.daily),
      release_reference: { date: game.release, precision: 'day', source: 'Steam 台灣商店', steam_appid: String(game.appid) },
      ...(game.full ? { launches: { early_access: { date: game.release, source: 'Steam 台灣商店', source_type: 'steam_early_access' },
        full_release: { date: game.full, source: 'Steam 台灣商店', source_type: 'steam_full_release' } } } : {}) }])),
  } }));
  for (const id of Object.keys(games)) for (const month of Object.keys(chunks[id])) {
    await page.route(`**/data/twitch_series/${id}/${month}-heat.json`, route => route.fulfill({ status: 404, body: '{}' }));
    await page.route(`**/data/twitch_series/${id}/${month}.json`, route => route.fulfill({ json: {
      schema_version: 1, timezone: 'Asia/Taipei', game_id: id, month, hours: chunks[id][month] } }));
  }
}

test('the planning list marks an own-peak cooldown, a same-age comparison and a rise back to a high level', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mockSignals(page);
  await page.goto('stream-planning.html?sort=viewers');
  await page.locator('#streamSource').selectOption('twitch_new');
  const cooled = page.locator('.tw-stream-game[data-game="3"]');
  await expect(cooled.locator('[data-region="global"] .tw-stream-signal')).toHaveText('已退燒');
  await expect(cooled.locator('[data-region="global"] .tw-stream-reason')).toContainText('確認退燒（低於高峰 2,000 人的 25%）');
  const fading = cooled.locator('.tw-stream-launch-line[data-launch="peer-fading"]');
  await expect(fading.locator('strong')).toHaveText('掉得比同齡快');
  await expect(fading.locator('span')).toHaveText('第 10 天是首日的 4% · 同齡一般 12%');
  const lasting = page.locator('.tw-stream-game[data-game="4"] .tw-stream-launch-line[data-launch="peer-outlasting"]');
  await expect(lasting.locator('strong')).toHaveText('比同齡撐得久');
  await expect(lasting.locator('span')).toHaveText('第 10 天是首日的 68% · 同齡一般 12%');
  await expect(page.locator('.tw-stream-game[data-game="5"] [data-region="global"] .tw-stream-signal')).toHaveText('回到高檔');
  // Streamed before its release date: heat from the viewers observed, marked as not yet released.
  const beta = page.locator('.tw-stream-game[data-game="6"]');
  await expect(beta.locator('[data-region="global"] .tw-stream-signal')).toHaveText('有熱度');
  await expect(beta.locator('[data-region="global"] .tw-stream-reason')).toContainText('11/10 日中位數 4,000 人');
  await expect(beta.locator('.tw-stream-release')).toHaveText('上市參考 2027/01/20 · 還沒上市');
  await expect(beta.locator('.tw-stream-launch-line')).toHaveCount(0);
  await page.locator('.tw-stream-method summary').click();
  await expect(page.locator('#streamTrendRule')).toContainText('標示「回到高檔」：熱度回來了，但不代表還會繼續漲');
  await expect(page.locator('#streamGlobalRule')).toContainText('連續 3 個可判定日低於自己高峰的 25%，也算已退燒');
  await expect(page.locator('#streamPeerRule')).toContainText('標「比同齡撐得久」');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('the game page keeps the small-game advice and shows the own-peak cooldown and same-age lines', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mockSignals(page);
  await page.goto('twitch-game.html?game=3&region=global');
  const action = page.locator('#heatOverview-global .tw-stream-action');
  await expect(page.locator('#heatOverview-global .tw-heat-status')).toHaveText('已退燒（低於自己高峰的 25%）');
  await expect(action.locator('h3')).toHaveText('先不用排');
  await expect(action.locator('.tw-launch-flag[data-flag="peer-fading"]')).toHaveText(
    '掉得比同齡快：上市第 10 天剩首日的 4%，同齡遊戲一般還有 12%。');
  await expect(action.locator('.tw-launch-flag[data-flag="peak-cooled"]')).toContainText('已退燒：連續');
  await expect(action.locator('.tw-launch-flag[data-flag="peak-cooled"]')).toContainText('低於自己高峰（2,000 人）的 25%（500 人）');
  await expect(page.locator('#heatOverview-global [data-heat="cooled"] small')).toContainText('連續第三天低於自己高峰（2,000 人）的 25%');
  await expect(page.locator('#cooldownStatus')).toHaveText('已退燒（低於自己高峰的 25%）');
  await expect(page.locator('#historyCooldown')).toHaveAttribute('data-cooldown-status', 'cooled');
  await expect(page.locator('#cooldownPeakRule')).toContainText('跟自己高峰比');
  await page.goto('twitch-game.html?game=4&region=global');
  await expect(page.locator('#heatOverview-global .tw-launch-flag[data-flag="peer-outlasting"]')).toHaveText(
    '比同齡撐得久：上市第 10 天還有首日的 68%，同齡遊戲一般剩 12%。');
  await expect(page.locator('#heatOverview-global .tw-stream-action h3')).toHaveText('可先續播一場');
  expect(errors).toEqual([]);
});

test('an Early Access game counts from its full release and compares the two peaks', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mockSignals(page);
  await page.goto('stream-planning.html?sort=viewers');
  await page.locator('#streamSource').selectOption('twitch_new');
  const card = page.locator('.tw-stream-game[data-game="7"]');
  await expect(card.locator('.tw-stream-release')).toHaveText('搶先體驗 2026/10/20 · 正式上市 2026/11/05');
  const peak = card.locator('.tw-stream-launch-line[data-launch="full-release-peak"]');
  await expect(peak.locator('strong')).toHaveText('正式上市新高峰');
  await expect(peak.locator('span')).toHaveText('正式上市後最高 9,000 人，是搶先體驗時最高 3,000 人的 3.0 倍。');
  // Same-age comparison from the full release: its sixth day against its first.
  await expect(card.locator('.tw-stream-launch-line[data-launch="peer-outlasting"] span')).toHaveText('第 6 天是首日的 67% · 同齡一般 23%');
  await page.goto('twitch-game.html?game=7&region=global');
  await expect(page.locator('#heatOverview-global .tw-launch-flag[data-flag="full-release-peak"]')).toHaveText(
    '正式上市後最高 9,000 人，是搶先體驗時最高 3,000 人的 3.0 倍。');
  await expect(page.locator('#cooldownReleaseSummary')).toContainText('搶先體驗 2026/10/20 · 正式上市 2026/11/05（第幾天從正式上市起算）');
  expect(errors).toEqual([]);
});
