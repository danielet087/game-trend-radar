import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Cards (2026-11-19): on phones every list is one compact row per game; art of
// another shape than Steam's 616×353 capsule (IGDB's portrait covers, Steam
// headers) is shown whole over a blurred copy instead of being cropped.
const DATA = 'tests/fixtures/site-data';
const frozenAt = new Date(JSON.parse(readFileSync(resolve(DATA, 'catalog.json'), 'utf8')).generated_at);
const portrait = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAAECAIAAADETxJQAAAAF0lEQVR42mOMylvAwMDAwMDAxAAD2FgANfIBcIq8wmcAAAAASUVORK5CYII=', 'base64');
const capsule = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAcAAAAECAIAAADNpLIqAAAAFElEQVR42mOMylvAgAGYGLABUkQBemIBcI2g5x0AAAAASUVORK5CYII=', 'base64');
const phone = { width: 390, height: 844 }, desktop = { width: 1280, height: 900 };

/** IGDB covers arrive 3:4 and Steam art 7:4, standing in for the real files. */
async function open(page: Page, path: string, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.clock.install({ time: frozenAt });
  await page.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    if (host === '127.0.0.1') return route.continue();
    if (host === 'images.igdb.com') return route.fulfill({ body: portrait, contentType: 'image/png' });
    if (host.endsWith('steamstatic.com')) return route.fulfill({ body: capsule, contentType: 'image/png' });
    return route.abort();
  });
  await page.goto(path);
}

test('phones list one compact row per game, its platforms under the art', async ({ page }) => {
  await open(page, 'games.html', phone);
  const rows = page.locator('#gamesGrid .game-card');
  const row = rows.first();
  await expect(row).toBeVisible();
  const card = (await row.boundingBox())!, art = (await row.locator('.cover-link').boundingBox())!;
  const chips = (await row.locator('.card-platforms').boundingBox())!, title = (await row.locator('.card-title').boundingBox())!;
  expect(card.height).toBeLessThan(140);
  expect(art.width).toBeLessThan(120);
  expect(title.x).toBeGreaterThan(art.x + art.width);
  expect(chips.y).toBeGreaterThan(art.y + art.height);
  expect(Math.abs(chips.x - art.x)).toBeLessThanOrEqual(1);
  // The countdown moves beside the date; English names, tags and store links stay off the row.
  await expect(row.locator('.card-countdown')).toBeVisible();
  await expect(row.locator('.card-countdown')).toHaveText(/^(今天|\d+ 天後|已上市)$/);
  await expect(row.locator('.countdown')).toBeHidden();
  await expect(row.locator('.card-english')).toBeHidden();
  await expect(row.locator('.explorer-card-tags')).toBeHidden();
  await expect(row.locator('.steam-store-link')).toBeHidden();
  const heights = await rows.evaluateAll(cards => cards.slice(0, 8).map(card => card.getBoundingClientRect().height));
  expect(heights.reduce((sum, height) => sum + height, 0) / heights.length).toBeLessThan(130);
});

test('desktop keeps the card grid with art in the capsule shape', async ({ page }) => {
  await open(page, 'games.html', desktop);
  const card = page.locator('#gamesGrid .game-card').first();
  await expect(card).toBeVisible();
  const art = (await card.locator('.cover-link').boundingBox())!;
  expect(art.width / art.height).toBeCloseTo(616 / 353, 1);
  await expect(card.locator('.countdown')).toBeVisible();
  await expect(card.locator('.card-countdown')).toBeHidden();
  await expect(card.locator('.steam-store-link')).toBeVisible();
  // Steam capsule art fills its box.
  await expect(card.locator('.cover-link img.art-loaded')).toHaveCount(1);
  await expect(card.locator('.cover-link')).not.toHaveClass(/art-whole/);
});

test('portrait console covers are shown whole over a blurred copy, on cards and the 近期新作 strip', async ({ page }) => {
  await open(page, 'upcoming.html', desktop);
  const cover = page.locator('#gamesGrid .game-card').filter({ hasText: 'Grand Theft Auto VI' }).locator('.cover-link');
  await expect(cover).toHaveClass(/art-whole/);
  expect(await cover.evaluate(element => (element as HTMLElement).style.getPropertyValue('--art-backdrop')))
    .toMatch(/^url\("https:\/\/images\.igdb\.com\//);
  await expect(cover.locator('img')).toHaveCSS('object-fit', 'contain');
  await page.goto('index.html');
  const strip = page.locator('#homeReleases .release-card').filter({ hasText: 'Grand Theft Auto VI' }).locator('.release-card-art');
  await expect(strip).toHaveClass(/art-whole/);
  await expect(strip.locator('img')).toHaveCSS('object-fit', 'contain');
});

test('phone badges flow in lines and stay clear of the heart in the home list', async ({ page }) => {
  await open(page, 'index.html?view=list&month=2026-12', phone);
  const row = page.locator('.schedule-list .game-card').filter({ hasText: '雷頓教授與蒸氣新世界' });
  await expect(row).toBeVisible();
  const badges = await row.locator('.card-language').evaluateAll(items => items.map(item => item.getBoundingClientRect().top));
  expect(badges.length).toBeGreaterThan(3);
  expect(new Set(badges.map(Math.round)).size).toBeLessThan(badges.length);
  const heart = (await row.locator('.save-button').boundingBox())!;
  const first = (await row.locator('.card-languages').boundingBox())!;
  expect(first.y).toBeGreaterThanOrEqual(heart.y + heart.height - 1);
});
