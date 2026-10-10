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

test('built catalog and detail show qualified missing GroupID Followers as unavailable with Twitch evidence', async ({ page }) => {
  const raw = JSON.parse(readFileSync(resolve('tests/fixtures/twitch-unavailable-group.json'), 'utf8'));
  const catalog = {version:3,generated_at:'2026-10-10T03:00:00Z',count:1,games:[raw]};
  await page.route('**/data/**', route => {
    const url = new URL(route.request().url());
    const file = url.pathname.split('/data/')[1];
    if (['catalog.json','steam_upcoming.json','steam_preview.json'].includes(file))
      return route.fulfill({json:catalog});
    if (file === `games/${raw.appid}.json`) return route.fulfill({json:raw});
    if (file === 'nintendo_upcoming.json') return route.fulfill({json:{schema_version:1,games:[]}});
    return route.fallback();
  });
  await page.goto('games.html');
  const card = page.locator('#gamesGrid .game-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.card-followers')).toHaveText('未取得Steam Followers');
  await expect(card.locator('.card-admission')).toHaveText('收錄依據 Twitch');
  await expect(card.locator('.card-admission')).toHaveAttribute('title', /7,200 人觀看.*2026-10-09T23:00:00Z/);
  await page.locator('#followersFilter').selectOption('5000');
  await expect(card).toHaveCount(0);
  await page.locator('#followersFilter').selectOption('0');
  await expect(card).toHaveCount(1);
  await card.locator('.card-names').click();
  await expect(page.locator('#detailPage')).toBeVisible();
  await expect(page.locator('#gameFollowers')).toHaveText('未取得');
  await expect(page.locator('#gameInterestUnit')).toBeEmpty();
  await expect(page.locator('#gameInterestCaption')).toHaveText('本次未取得 GroupID · 收錄依據 Twitch');
  await expect(page.locator('#gameInterestCaption')).toHaveAttribute('title', /7,200 人觀看.*2026-10-09T23:00:00Z/);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
