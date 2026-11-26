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

test('the planning list groups an own-peak cooldown, a game holding up and a rise back to a high level', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mockSignals(page);
  await page.goto('stream-planning.html?state=twitch_new');
  // Twenty Chinese viewers everywhere: no Chinese heat, so every card shows both regions.
  const cooled = page.locator('.tw-plan-card[data-game="3"]');
  await expect(cooled).toHaveAttribute('data-group', 'cooled');
  const global = cooled.locator('.tw-plan-region[data-region="global"]');
  await expect(global.locator('.tw-verdict-chip')).toHaveText('已退燒');
  // A card gives the conclusion only: no sentences.
  await expect(page.locator('.tw-plan-card p')).toHaveCount(0);
  await expect(cooled.locator('.tw-plan-tag')).toHaveText(['掉得比同齡快']);
  const lasting = page.locator('.tw-plan-card[data-game="4"]');
  await expect(lasting).toHaveAttribute('data-group', 'hot');
  await expect(lasting.locator('.tw-plan-region[data-region="global"] .tw-verdict-chip')).toHaveText('還很熱');
  await expect(lasting.locator('.tw-plan-tag')).toHaveText(['比同齡撐得久']);
  await expect(page.locator('.tw-plan-card[data-game="5"] .tw-plan-region[data-region="global"] .tw-verdict-chip')).toHaveText('回到高檔');
  // Streamed before its release date: heat from the viewers observed, marked as not yet released.
  const beta = page.locator('.tw-plan-card[data-game="6"]');
  await expect(beta).toHaveAttribute('data-group', 'hot');
  await expect(beta.locator('.tw-plan-meta')).toHaveText('還沒上市・2027/01/20 上市');
  await expect(beta.locator('.tw-plan-tags')).toHaveCount(0);
  // The worldwide tile: the last three days and their trend, with seven days of line.
  await expect(lasting.locator('.tw-plan-tile[data-region="global"] strong')).toHaveText('3,500');
  await expect(lasting.locator('.tw-plan-tile[data-region="global"] .tw-plan-trend')).toHaveText('↓ 比前 3 天少 8%');
  await expect(lasting.locator('.tw-spark polyline')).toHaveAttribute('points', /^(\S+ ){6}\S+$/);
  // Grouping by the Chinese region puts every game in 先不用排.
  await page.locator('#audienceRegion').selectOption('zh');
  await expect(page).toHaveURL(/region=zh/);
  await expect(page.locator('.tw-plan-more[data-group="skip"] .tw-plan-card')).toHaveCount(5);
  await page.locator('#planInfoButton').click();
  await expect(page.locator('#planInfoGrouping')).toContainText('分組照中文區的建議');
  await page.locator('#planInfo .tw-info-more summary').click();
  await expect(page.locator('#streamTrendRule')).toContainText('標示「回到高檔」：熱度回來了，但不代表還會繼續漲');
  await expect(page.locator('#streamGlobalRule')).toContainText('連續 3 個完整日低於自己高峰的 25%，也算已退燒');
  await expect(page.locator('#streamPeerRule')).toContainText('標「比同齡撐得久」');
  await page.keyboard.press('Escape');
  await expect(page.locator('#planInfo')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('the game page shows the own-peak cooldown and the same-age comparison', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mockSignals(page);
  await page.goto('twitch-game.html?game=3');
  const global = page.locator('#verdictPanel .tw-verdict-region[data-region="global"]');
  await expect(global.locator('.tw-verdict-chip')).toHaveText('已退燒');
  await expect(global.locator('strong')).toHaveText('建議收尾或換題');
  await expect(global.locator('p')).toHaveText('跟最熱的時候比，現在看的人少很多，已經退燒。');
  // How far below the peak is in the first tile.
  await expect(page.locator('#verdictPanel .tw-verdict-tile').first().locator('dd span')).toHaveText(/^高峰的 \d+%$/);
  await expect(page.locator('#verdictPanel .tw-split-chip')).toHaveText('兩區建議不同');
  await expect(page.locator('#nextPanel .tw-next-peer')).toHaveText('掉得比同齡快：上市第 10 天只剩首日的 4%，同齡遊戲一般還有 12%。');
  await expect(page.locator('#dailyPanel .tw-daily-cooled-label')).toHaveText('11/07 確認退燒');
  // 看每天的紀錄 opens the cooldown section.
  await page.locator('#verdictPanel .tw-info').click();
  await page.locator('#verdictInfo .tw-text-link').click();
  await expect(page.locator('#moreCooldown')).toHaveAttribute('open', '');
  await expect(page.locator('#cooldownStatus')).toHaveText('已退燒（低於自己高峰的 25%）');
  await expect(page.locator('#historyCooldown')).toHaveAttribute('data-cooldown-status', 'cooled');
  await expect(page.locator('#cooldownPeakRule')).toContainText('跟自己高峰比');
  await page.goto('twitch-game.html?game=4');
  await expect(page.locator('#nextPanel .tw-next-peer')).toHaveText('比同齡撐得久：上市第 10 天還有首日的 68%，同齡遊戲一般剩 12%。');
  await expect(page.locator('#verdictPanel .tw-verdict-region[data-region="global"] strong')).toHaveText('可以繼續播');
  expect(errors).toEqual([]);
});

test('an Early Access game counts from its full release and compares the two peaks', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mockSignals(page);
  await page.goto('stream-planning.html?state=twitch_new');
  const card = page.locator('.tw-plan-card[data-game="7"]');
  await expect(card.locator('.tw-plan-meta')).toHaveText('正式上市第 7 天・11/05 上市');
  // Same-age comparison from the full release: its sixth day against its first.
  await expect(card.locator('.tw-plan-tag')).toHaveText(['比同齡撐得久', '正式上市新高峰']);
  await page.goto('twitch-game.html?game=7');
  await expect(page.locator('#gameMeta')).toHaveText('Steam 11/05 正式上市・今天第 7 天');
  await expect(page.locator('#nextPanel .tw-next-line')).toHaveText(['正式上市後最高 9,000 人，是搶先體驗時最高 3,000 人的 3.0 倍。']);
  await page.locator('#moreCooldown > summary').click();
  await expect(page.locator('#cooldownReleaseSummary')).toContainText('搶先體驗 2026/10/20 · 正式上市 2026/11/05（第幾天從正式上市起算）');
  expect(errors).toEqual([]);
});

test('the verdict chips and the search narrow the planning list, and the choice stays in the address', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mockSignals(page);
  await page.goto('stream-planning.html?state=twitch_new');
  await expect(page.locator('.tw-plan-group[data-group="hot"] .tw-plan-card')).toHaveCount(4);
  await page.locator('#verdictFilters [data-group="cooled"]').click();
  await expect(page).toHaveURL(/group=cooled/);
  await expect(page.locator('#verdictFilters [data-group="cooled"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tw-plan-group')).toHaveCount(1);
  await expect(page.locator('.tw-plan-card')).toHaveCount(1);
  await expect(page.locator('.tw-plan-card')).toHaveAttribute('data-game', '3');
  await page.locator('#verdictFilters [data-group="horse"]').click();
  await expect(page.locator('.tw-plan-empty')).toHaveText('目前沒有「黑馬候選」的遊戲。');
  await page.reload();
  await expect(page.locator('#verdictFilters [data-group="horse"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#verdictFilters [data-group="all"]').click();
  await expect(page).not.toHaveURL(/group=/);
  await page.locator('#gameSearch').fill('長青');
  await expect(page).toHaveURL(/q=/);
  await expect(page.locator('.tw-plan-card')).toHaveCount(1);
  await expect(page.locator('.tw-plan-card')).toHaveAttribute('data-game', '4');
  await page.locator('#gameSearch').fill('不存在的遊戲');
  await expect(page.locator('.tw-plan-empty')).toHaveText('找不到遊戲，試試英文名稱或遊戲 ID。');
  expect(errors).toEqual([]);
});
