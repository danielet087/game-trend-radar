import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { RadarData } from '../../src/domain/index.mjs';

// The game page sections on the frozen data the preview serves (tests/fixtures/site-data).
const DATA = 'tests/fixtures/site-data';
const readData = (file: string) => JSON.parse(readFileSync(resolve(DATA, file), 'utf8'));
const dataset = RadarData.datasets(readData('catalog.json'), readData('steam_preview.json'), readData('nintendo_upcoming.json'));
const frozenAt = new Date(readData('catalog.json').generated_at);
const mediaFile = (appid: number) => resolve(DATA, 'media', `${appid}.json`);
const game = dataset.games.find((row: any) => row.source !== 'nintendo' && existsSync(mediaFile(row.appid)) &&
  JSON.parse(readFileSync(mediaFile(row.appid), 'utf8')).trailers.length &&
  JSON.parse(readFileSync(mediaFile(row.appid), 'utf8')).screenshots.length > 6);
const media = JSON.parse(readFileSync(mediaFile(game.appid), 'utf8'));

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: frozenAt });
  // Steam's CDN is not needed to verify the layout: images fall back without it.
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

test('game page opens on the key art, title card and the sections that have content', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto(`game.html?appid=${game.appid}`);
  await expect(page.locator('#detailPage')).toBeVisible();
  await expect(page.locator('#gameHeroImage')).toHaveAttribute('src', media.hero_image);
  await expect(page.locator('#gameHeroDate')).toHaveText(game.date.replaceAll('-', '.'));
  await expect(page.locator('#gameMedia')).toBeVisible();
  await expect(page.locator('#gameMediaStage .game-trailer')).toHaveCount(1);
  await expect(page.locator('#gameMediaStage .game-media-side .game-shot')).toHaveCount(2);
  await expect(page.locator('#gameShots .game-shot')).toHaveCount(4);
  await page.locator('#gameShotsMore').click();
  await expect(page.locator('#gameShots .game-shot')).toHaveCount(media.screenshots.length - 2);
  await page.locator('#gameShots .game-shot').first().click();
  await expect(page.locator('#artDialog')).toBeVisible();
  await expect(page.locator('#artDialogCount')).toHaveText(`截圖 3／${media.screenshots.length}`);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#artDialogCount')).toHaveText(`截圖 4／${media.screenshots.length}`);
  await page.keyboard.press('Escape');
  await expect(page.locator('#artDialog')).toBeHidden();
  // Section links skip hidden sections and every visible one lands on its section.
  for (const link of await page.locator('#gameSectionNav a:visible').all()) {
    const target = await link.getAttribute('data-section');
    await expect(page.locator(`#${target}`)).toBeVisible();
  }
  await expect(page.locator('#gameNews')).toBeVisible();
  await expect(page.locator('#gameNewsList li').first()).toBeVisible();
  await expect(page.locator('#gameHeat')).toBeVisible();
  await expect(page.locator('#gameFacts')).toContainText(media.developers[0]);
  expect(failures).toEqual([]);
});

test('the Steam version shows its Taiwan price and check time; the info card keeps the CSRR rating and Steam Deck status', async ({ page }) => {
  const facts = readData('store_facts.json').games['2638890'];
  expect(facts.rating.code).toBe('R');
  await page.goto('game.html?appid=2638890');
  await expect(page.locator('#detailPage')).toBeVisible();
  const steam = page.locator('#gameVersionRows tr[data-platform="Steam"]');
  await expect(steam.locator('.game-version-price')).toContainText('NT$ 1,990');
  await expect(steam.locator('.game-version-store > .game-version-meta')).toHaveText('Steam 台灣商店 11/18 19:30 確認');
  await expect(steam.locator('.game-version-shop')).toHaveAttribute('href', 'https://store.steampowered.com/app/2638890/');
  const row = (label: string) => page.locator('#gameFacts .game-fact').filter({ has: page.locator('dt', { hasText: label }) });
  await expect(row('售價')).toHaveCount(0);
  await expect(row('分級').locator('dd')).toHaveText('限制級（暴力）');
  await expect(row('Steam Deck').locator('dd')).toHaveText('可遊玩');
});

test('平台版本 is a table on wide screens and labelled cards on phones, with every source in one collapsed list', async ({ page }) => {
  await page.goto(`game.html?appid=${game.appid}`);
  await expect(page.locator('#gameVersions')).toBeVisible();
  const head = page.locator('#gameVersionTable thead');
  await expect(head).toBeVisible();
  await expect(page.locator('#gameVersionSources')).not.toHaveAttribute('open', '');
  await expect(page.locator('#gameVersionSourceList')).toBeHidden();
  await page.locator('#gameVersionSources summary').click();
  await expect(page.locator('#gameVersionSourceList li').first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(head).toBeHidden();
  const row = page.locator('#gameVersionRows tr').first();
  expect(await row.evaluate(element => getComputedStyle(element).display)).toBe('block');
  await expect(row.locator('td.game-version-dates')).toHaveAttribute('data-label', '發售日（台灣）');
});

test('the desktop dock appears once the title card scrolls away; phones always show it', async ({ page }) => {
  await page.goto(`game.html?appid=${game.appid}`);
  await expect(page.locator('#detailPage')).toBeVisible();
  await expect(page.locator('#gameDock')).toBeHidden();
  await page.locator('#gameInfo').scrollIntoViewIfNeeded();
  await expect(page.locator('#gameDock')).toBeVisible();
  await expect(page.locator('#gameDock .button.primary')).toHaveAttribute('href', `https://store.steampowered.com/app/${game.appid}/`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('#gameDock')).toBeVisible();
  await expect(page.locator('.game-hero-actions')).toBeHidden();
});

test('text on the game page is at least 12px at desktop and phone widths', async ({ page }) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`game.html?appid=${game.appid}`);
    await expect(page.locator('#detailPage')).toBeVisible();
    const small = await page.evaluate(() => [...document.querySelectorAll('#detailPage *')].filter(element => {
      const text = [...element.childNodes].some(node => node.nodeType === 3 && node.textContent!.trim());
      return text && element.checkVisibility({ visibilityProperty: true }) && parseFloat(getComputedStyle(element).fontSize) < 12;
    }).map(element => `${element.tagName}.${element.className} ${getComputedStyle(element).fontSize}`));
    expect(small).toEqual([]);
  }
});
