import { test, expect } from '@playwright/test';
import { gzipSync } from 'node:zlib';

// Speed budget (2026-11-20): the code a first visit downloads — the page,
// its stylesheets and every script it runs on load, gzip-compressed as GitHub
// Pages serves them — stays under 160 KB. The heaviest page, the Twitch
// history, was about 143 KB when the budget was set. Data files and images
// are not counted; chunks loaded only on demand (such as the site search's
// data loader) are not loaded here either.
const BUDGET_KB = 160;
const pages = ['index.html', 'games.html', 'upcoming.html', 'released.html', 'explore.html', 'growth.html', 'analysis.html',
  'saved.html', 'date.html?date=2026-11-20', 'game.html?appid=2638890', 'twitch.html', 'stream-planning.html',
  'twitch-game.html?id=1867279146', 'scheduler.html'];

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

for (const path of pages) {
  test(`${path}: page code stays under ${BUDGET_KB} KB compressed`, async ({ page }) => {
    const pending: Promise<[string, number]>[] = [];
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.hostname === '127.0.0.1' && /\.(html|js|css)$/.test(url.pathname)) {
        pending.push(response.body().then(body => [url.pathname, gzipSync(body).length] as [string, number], () => [url.pathname, 0] as [string, number]));
      }
    });
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const sizes = new Map(await Promise.all(pending));
    const total = [...sizes.values()].reduce((sum, size) => sum + size, 0) / 1024;
    expect(sizes.size).toBeGreaterThan(2);
    expect(total, [...sizes].map(([file, size]) => `${file.split('/').pop()} ${(size / 1024).toFixed(1)} KB`).join(', '))
      .toBeLessThanOrEqual(BUDGET_KB);
  });
}

test('cards show at once, without an entrance animation', async ({ page }) => {
  await page.goto('games.html');
  const card = page.locator('#gamesGrid .game-card').first();
  await expect(card).toBeVisible();
  expect(await card.evaluate(element => [getComputedStyle(element).opacity, element.className.includes('reveal')])).toEqual(['1', false]);
});
