import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Phones and small tablets (≤800px): a one-line header and the four main
// destinations in a bottom bar; 探索 and 趨勢 open as sheets above it and the
// motion switch moves to the footer. Desktop keeps the header navigation.
const DATA = 'tests/fixtures/site-data';
const frozenAt = new Date(JSON.parse(readFileSync(resolve(DATA, 'catalog.json'), 'utf8')).generated_at);

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: frozenAt });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

test('phones get a 56px header and a bottom bar with four tappable destinations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('index.html');
  const header = await page.locator('.site-header').boundingBox();
  expect(header!.height).toBeLessThanOrEqual(60);
  const bar = page.locator('.main-nav');
  const box = await bar.boundingBox();
  expect(Math.round(box!.y + box!.height)).toBe(844);
  const items = bar.locator(':scope > a, :scope > details > summary');
  await expect(items).toHaveText([/月曆/, /探索/, /趨勢/, /收藏\s*0/]);
  for (const item of await items.all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(bar.locator('a[href="./index.html"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.nav-label').first()).toBeHidden();
  await expect(page.locator('#motionToggle')).toBeHidden();
});

test('探索 and 趨勢 open as sheets that close by scrim, button and Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('index.html');
  const explore = page.locator('.explore-nav:not(.analysis-nav)');
  await explore.locator('summary').click();
  const sheet = page.locator('#exploreMenu');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.explore-route')).toHaveCount(4);
  // Measure after the slide-up animation settles.
  await sheet.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  const sheetBox = await sheet.boundingBox();
  const barBox = await page.locator('.main-nav').boundingBox();
  expect(sheetBox!.x).toBe(0);
  expect(Math.abs(sheetBox!.y + sheetBox!.height - barBox!.y)).toBeLessThanOrEqual(1);
  await page.locator('.nav-scrim').click({ position: { x: 200, y: 80 } });
  await expect(sheet).toBeHidden();

  await page.locator('.analysis-nav summary').click();
  await expect(page.locator('#analysisMenu .explore-route')).toHaveCount(4);
  await page.locator('#analysisMenu .explore-menu-close').click();
  await expect(page.locator('#analysisMenu')).toBeHidden();

  await explore.locator('summary').click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.locator('.nav-scrim')).toHaveCount(0);

  await explore.locator('summary').click();
  await sheet.locator('a[href="./games.html"]').click();
  await expect(page).toHaveURL(/games\.html$/);
});

test('the footer motion switch replaces the header one on phones', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('index.html');
  const footerSwitch = page.locator('.footer-motion');
  await expect(footerSwitch).toBeVisible();
  const before = await footerSwitch.getAttribute('aria-pressed');
  await footerSwitch.click();
  await expect(footerSwitch).not.toHaveAttribute('aria-pressed', before!);
  await expect(page.locator('#motionToggle')).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
});

test('the game page dock sits on top of the bottom bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('game.html?appid=2638890');
  await expect(page.locator('#detailPage')).toBeVisible();
  const dock = await page.locator('#gameDock').boundingBox();
  const bar = await page.locator('.main-nav').boundingBox();
  expect(Math.round(dock!.y + dock!.height)).toBeLessThanOrEqual(Math.round(bar!.y));
});

test('desktop keeps the header navigation and its dropdowns', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('index.html');
  await expect(page.locator('.main-nav')).toHaveCSS('position', 'static');
  await expect(page.locator('.nav-label').first()).toBeVisible();
  await expect(page.locator('.nav-short').first()).toBeHidden();
  await expect(page.locator('#motionToggle')).toBeVisible();
  await expect(page.locator('.footer-motion')).toBeHidden();
  await page.locator('.explore-nav:not(.analysis-nav) summary').click();
  await expect(page.locator('#exploreMenu')).toBeVisible();
  await expect(page.locator('#exploreMenu .explore-menu-head')).toBeHidden();
  await expect(page.locator('.nav-scrim')).toBeHidden();
});
