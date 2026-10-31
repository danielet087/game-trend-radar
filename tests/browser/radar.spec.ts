import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { RadarData } from '../../src/domain/index.mjs';

const readData = (file: string) => JSON.parse(readFileSync(resolve('data', file), 'utf8'));
const dataset = RadarData.datasets(readData('catalog.json'), readData('steam_preview.json'), readData('nintendo_upcoming.json'));
const steam = dataset.games.find((game: any) => game.source !== 'nintendo' && existsSync(resolve('data/games', `${game.appid}.json`)));
const native = dataset.games.find((game: any) => game.source === 'nintendo');
const steamRoute = `game.html?appid=${steam.appid}`;
const nativeRoute = `game.html?igdb=${native.igdbId}&date=${native.date}`;
const month = dataset.games[0].date.slice(0, 7);
const [year, monthNumber] = month.split('-').map(Number);
const calendarCells = Math.ceil((new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()) / 7) * 7;

test.beforeEach(async ({ page }) => {
  // External covers and diagnostic APIs are not needed to verify our built app.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
});

for (const [accepted, unknownFollowers] of [[true, false], [false, false], [true, true]]) {
  test(`database-backed Twitch admission${unknownFollowers ? " with unknown Followers" : ""} ${accepted ? 'opens' : 'rejects an unrelated source on'} Haunted Heist detail`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-16T13:00:00Z') });
    const row = {
      appid: 4024440, name: 'Haunted Heist', name_en: 'Haunted Heist', display_name: '鬧鬼大劫掠',
      followers: unknownFollowers ? null : 2043, follower_checked_at: unknownFollowers ? null : '2026-10-16T07:02:39Z',
      release_start: '2026-10-13', release_end: '2026-10-13', release_precision: 'day',
      release_display_precision: 'date_full', release_date_timezone: 'Asia/Taipei',
      release_time_utc: '2026-10-12T17:00:30Z', release_timestamp_taipei_date: '2026-10-13',
      release_date_conflict: false, steam_type: 'game', sexual_content_screened: true,
      twitch_admission: {
        schema_version: 1, method: 'twitch_igdb_external_steam_v1', appid: 4024440,
        twitch_game_id: '2056280692', igdb_id: '391023', checked_at: '2026-10-15T20:15:14Z',
        source_database_revision: 'b9680e2df2a94188330b6d5745ee0a900f33d88f71bed858aeccf150b1002393',
        source_database_generation: 22,
        source_database_namespace: accepted ? 'danielet087/game-trend-radar@main' : 'unrelated/source@main',
        source_enrollment: { source: 'igdb_first_release_date', observed_at: '2026-10-15T20:15:14Z',
          viewer_count: 10729, min_viewers: 7000 },
      },
    };
    const catalog = { version: 3, revision: 'database-admission-regression',
      generated_at: '2026-10-16T11:31:25Z', count: 1, games: [row] };
    await page.route('**/data/catalog.json', route => route.fulfill({ json: catalog }));
    await page.route('**/data/games/4024440.json', route => route.fulfill({ json: row }));
    await page.route('**/data/nintendo_upcoming.json', route => route.fulfill({
      json: { schema_version: 1, generated_at: catalog.generated_at, games: [] },
    }));
    await page.goto('game.html?appid=4024440');
    if (accepted) {
      await expect(page.locator('#detailPage')).toBeVisible();
      await expect(page.locator('#gameTitle')).toHaveText('鬧鬼大劫掠');
      await expect(page.locator('#gameFollowers')).toHaveText(unknownFollowers ? '未取得' : '2,043');
      if (unknownFollowers) {
        await expect(page.locator('#gameInterestUnit')).toHaveText('');
        await expect(page.locator('#gameInterestCaption')).toContainText('收錄依據 Twitch');
      }
      await expect(page.locator('#gameSteam')).toHaveAttribute('href', 'https://store.steampowered.com/app/4024440/');
      await expect(page.locator('#detailStatus')).toBeHidden();
    } else {
      await expect(page.locator('#detailStatusTitle')).toHaveText('這款遊戲目前不在公開清單中');
      await expect(page.locator('#detailPage')).toBeHidden();
    }
  });
}

for (const scenario of [
  { source: 'steam_tchinese', language: 'zh-TW', copy: '這是官方繁體中文介紹。', english: '', label: 'Steam 官方繁中', lang: 'zh-Hant' },
  { source: 'steam_machine_zh_tw', language: 'zh-TW', copy: '不再顯示的舊自動翻譯。', english: 'Original English summary.', expected: 'Original English summary.', label: 'Steam 英文原文', lang: 'en' },
  { source: 'steam_english', language: 'en', copy: 'English summary from Steam.', english: '', label: 'Steam 英文原文', lang: 'en' },
]) {
  test(`detail displays description provenance and a safe original link: ${scenario.source || 'English fallback'}`, async ({ page }) => {
    const catalog = readData('catalog.json');
    const fields = { short_description: scenario.copy, short_description_en: scenario.english,
      short_description_source: scenario.source, short_description_language: scenario.language,
      language_support: { english: true, tchinese: false, schinese: false },
      description_source_url: `https://store.steampowered.com/app/${steam.appid}/` };
    catalog.games = catalog.games.map((row: any) => row.appid === steam.appid ? { ...row, ...fields } : row);
    await page.route('**/data/catalog.json', route => route.fulfill({ json: catalog }));
    await page.route(`**/data/games/${steam.appid}.json`, route => route.fulfill({ json: { ...readData(`games/${steam.appid}.json`), ...fields } }));
    await page.route('**/data/nintendo_upcoming.json', route => route.fulfill({ json: { schema_version: 1, generated_at: catalog.generated_at, games: [] } }));
    await page.goto(steamRoute);
    await expect(page.locator('#detailPage')).toBeVisible();
    await expect(page.locator('#gameDescription')).toHaveText(scenario.expected || scenario.copy || scenario.english);
    await expect(page.locator('#gameDescription')).toHaveAttribute('lang', scenario.lang);
    await expect(page.locator('#descriptionSource')).toContainText(scenario.label);
    await expect(page.locator('#descriptionSource')).not.toContainText('機器翻譯');
    const original = page.locator('#descriptionSource a');
    await expect(original).toHaveAttribute('href', `https://store.steampowered.com/app/${steam.appid}/`);
    await expect(original).toHaveAttribute('target', '_blank');
    await expect(original).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(page.locator('#gameLanguageBadge')).toHaveText('支援英文');
  });
}

const routes = [
  `index.html?month=${month}`, 'games.html', 'upcoming.html', 'released.html',
  'saved.html', `date.html?date=${dataset.games[0].date}`, 'explore.html',
  steamRoute, nativeRoute,
  'growth.html', 'analysis.html', 'twitch.html', 'scheduler.html', 'discover.html',
];

for (const route of routes) {
  test(`built entry initializes: ${route}`, async ({ page }) => {
    const failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && /Unable to initialize game radar|TypeError|ReferenceError/.test(message.text())) failures.push(message.text());
    });
    page.on('response', response => {
      if (response.url().includes('/assets/app/') && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(route);
    const scheduler = route.startsWith('scheduler');
    if (scheduler) {
      await expect(page.locator('#scheduleTimeline')).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    } else {
      await expect(page.locator('.site-header')).toBeVisible();
      await expect(page.locator('.site-footer')).toHaveCount(1);
      await expect(page.locator('.main-nav a[href="./scheduler.html"]')).toHaveCount(0);
    }
    if (route.startsWith('games') || route.startsWith('discover')) await expect(page.locator('#gamesGrid .game-card')).toHaveCount(36);
    if (route.startsWith('index')) {
      if (readData('activity.json').events.length) {
        const reasonPattern = /^(每日 Steam 搜尋|Twitch 排行榜|IGDB 更新|Steam 官方驗證|Steam 資料更新|Steam 清單同步|Steam 新上市補入|更新來源未記錄)$/;
        await expect(page.locator('#activityTrack .activity-origin').first()).toHaveText(reasonPattern);
        await page.locator('#activityMore').click();
        await expect(page.locator('#activityDialog')).toBeVisible();
        const activityRows = page.locator('#activityList .activity-item');
        const reasonLabels = page.locator('#activityList .activity-origin');
        await expect(reasonLabels).toHaveCount(await activityRows.count());
        for (const label of await reasonLabels.allTextContents()) expect(label).toMatch(reasonPattern);
        await page.locator('#activityClose').click();
      }
      await expect(page.locator('#calendarGrid .calendar-day')).toHaveCount(calendarCells);
      const maximum = await page.locator('#calendarGrid .calendar-day').evaluateAll(days => Math.max(...days.map(day => day.querySelectorAll('.day-game').length)));
      expect(maximum).toBeGreaterThan(0);
      expect(maximum).toBeLessThanOrEqual(2);
    }
    if (route.startsWith('game.html')) await expect(page.locator('#detailPage')).toBeVisible();
    if (route.startsWith('twitch')) await expect(page.locator('#gameResults')).toHaveAttribute('aria-busy', 'false');
    expect(failures).toEqual([]);
  });
}

test('ticker shows collector reasons for Twitch-discovered Steam, daily Steam changes and IGDB native updates', async ({ page }) => {
  const payload = { version: 1, events: [
    { source: 'steam', appid: steam.appid, name: 'Twitch-discovered Steam game', type: 'added',
      date: '2026-11-05', at: '2026-10-13T07:30:00Z', update_reason: 'twitch_rankings' },
    { source: 'steam', appid: steam.appid, name: 'Daily Steam date change', type: 'release_date',
      date: '2026-11-06', previous_date: '2026-11-05', at: '2026-10-13T07:20:00Z', update_reason: 'steam_daily_search' },
    { source: 'nintendo', igdb_id: native.igdbId, game_id: `igdb:${native.igdbId}`, platforms: ['PS5'],
      name: 'IGDB platform addition', type: 'platform_added', date: '2026-11-05',
      at: '2026-10-13T07:10:00Z', update_reason: 'igdb_update' },
    { source: 'steam', appid: steam.appid, name: 'Legacy Steam event', type: 'added',
      date: '2026-11-05', at: '2026-10-12T07:00:00Z' },
  ] };
  await page.route('**/data/activity.json', route => route.fulfill({ json: payload }));
  await page.goto(`index.html?month=${month}`);
  await expect(page.locator('#activityTrack .activity-origin').first()).toHaveText('Twitch 排行榜');
  await expect(page.locator('#activityTrack .activity-item')).toHaveAttribute('href', `./game.html?appid=${steam.appid}`);
  await expect(page.locator('#activityTrack .activity-origin').first()).toHaveAttribute('title', '更新原因：Twitch 排行榜；平台：Steam');
  await page.locator('#activityMore').click();
  await expect(page.locator('#activityList .activity-origin')).toHaveText(['Twitch 排行榜', '每日 Steam 搜尋', 'IGDB 更新', '更新來源未記錄']);
  const changed = page.locator('#activityList .activity-item').nth(1);
  await expect(changed).toContainText('2026/11/05 → 2026/11/06');
  await expect(changed).toHaveAttribute('aria-label', /更新原因：每日 Steam 搜尋；平台：Steam/);
  const igdb = page.locator('#activityList .activity-item').nth(2);
  await expect(igdb).toHaveAttribute('href', `./game.html?igdb=${native.igdbId}&date=2026-11-05`);
  await expect(igdb.locator('.activity-origin')).toHaveAttribute('title', '更新原因：IGDB 更新；平台：PS5');
  await expect(page.locator('#activityList .activity-platform')).toHaveText(['Steam', 'Steam', 'PS5', 'Steam']);
});

test('search, card reuse, collection and filtered return remain usable', async ({ page }) => {
  await page.goto('games.html');
  await expect(page.locator('#gamesGrid .game-card')).toHaveCount(36);
  const first = page.locator('#gamesGrid .game-card').first();
  const id = await first.getAttribute('data-appid');
  await page.locator('#searchInput').fill(id!);
  await page.waitForURL(url => url.searchParams.get('q') === id);
  await expect(page.locator('#gamesGrid .game-card')).toHaveCount(1);
  await page.locator('#gamesGrid .game-card').evaluate(element => { (window as any).__radarOriginalCard = element; });
  await page.locator('#sortSelect').selectOption('name');
  expect(await page.locator('#gamesGrid .game-card').evaluate(element => element === (window as any).__radarOriginalCard)).toBe(true);
  const save = page.locator('#gamesGrid button[data-save]').first();
  await save.click();
  await expect(save).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-saved-count]')).toHaveText('1');
  await page.locator('#gamesGrid .card-names').click();
  await expect(page.locator('#detailPage')).toBeVisible();
  await expect(page.locator('[data-saved-count]')).toHaveText('1');
  await page.goBack();
  await expect(page.locator('#searchInput')).toHaveValue(id!);
  await expect(page.locator('#gamesGrid .game-card')).toHaveCount(1);
  await page.locator('#searchInput').press('Escape');
  await expect(page.locator('#gamesGrid .game-card')).toHaveCount(36);
  await page.locator('#loadMore').click();
  await expect(page.locator('#gamesGrid .game-card')).toHaveCount(72);
});

for (const route of [`index.html?month=${month}`, 'games.html', steamRoute, 'twitch.html', 'scheduler.html']) {
  test(`mobile layout stays within the viewport: ${route}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route);
    if (route.startsWith('game.html')) await expect(page.locator('#detailPage')).toBeVisible();
    else if (route.startsWith('games')) await expect(page.locator('#gamesGrid .game-card')).toHaveCount(36);
    else if (route.startsWith('twitch')) await expect(page.locator('#gameResults')).toHaveAttribute('aria-busy', 'false');
    else if (route.startsWith('index')) await expect(page.locator('#resultCount')).not.toContainText('正在');
    else await expect(page.locator('#scheduleTimeline')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}
