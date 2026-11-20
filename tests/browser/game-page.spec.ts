import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { RadarData } from '../../src/domain/index.mjs';
import { chooseDescription } from '../../src/domain/descriptions.mjs';

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

test('a console game with a Steam version opens on the Steam version from either link, every platform in 平台版本', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  // Monster Hunter Wilds: on Steam since 2025 (a Steam reference), on NS2 from 2026-12-04.
  const steamMedia = JSON.parse(readFileSync(mediaFile(2246340), 'utf8'));
  for (const route of ['game.html?appid=2246340&date=2026-12-04', 'game.html?igdb=279661&date=2026-12-04']) {
    await page.goto(route);
    await expect(page.locator('#detailPage')).toBeVisible();
    await expect(page.locator('#gameTitle')).toHaveText('魔物獵人 荒野');
    await expect(page.locator('#gameHeroImage')).toHaveAttribute('src', steamMedia.hero_image);
    await expect(page.locator('#gameHeroDate')).toHaveText('2026.12.04');
    const steam = page.locator('#gameVersionRows tr[data-platform="Steam"]');
    await expect(steam.locator('a[href="https://store.steampowered.com/app/2246340/"]')).toBeVisible();
    await expect(steam).toContainText('2025/02/27');
    await expect(steam).toContainText('已發售');
    await expect(page.locator('#gameVersionRows tr[data-platform="NS2"]')).toContainText('2026/12/04');
    await expect(page.locator('#descriptionSource')).toContainText('Steam 官方繁中');
    await expect(page.locator('#gameShots .game-shot').first()).toBeVisible();
  }
  // A same-day Steam version joins the console release in the title card.
  await page.goto('game.html?appid=4507990&date=2027-03-04');
  await expect(page.locator('#gameVersionRows tr[data-platform="Steam"]')).toContainText('2027/03/04');
  await expect(page.locator('#gameHeroNote')).toContainText('同一天');
  expect(failures).toEqual([]);
});

test('lists date a console game shown on its Steam version by the console release and link to the Steam page', async ({ page }) => {
  await page.goto('games.html?q=Monster');
  const link = page.locator('a[href*="game.html?appid=2246340"]').first();
  await expect(link).toHaveAttribute('href', './game.html?appid=2246340&date=2026-12-04');
  const card = page.locator('.game-card, article').filter({ has: link }).first();
  // The card's date is the console release; the earlier Steam launch is named apart, never as this day.
  await expect(card.locator('.card-release-date time')).toHaveText('2026/12/04');
  await expect(card.locator('.countdown')).toContainText('NS2 版');
  await expect(card.locator('.card-release-platform')).toHaveText('Steam 2025/02/27 已上市');
  // The console link and the Steam link are one page, on the same day.
  await page.goto('game.html?igdb=279661&date=2026-12-04');
  await expect(page).toHaveURL(/game\.html\?appid=2246340&date=2026-12-04$/);
  await expect(page.locator('#gameHeroLabel')).toHaveText('Nintendo Switch 2 版發售・全球日期（IGDB）');
  await expect(page.locator('#gameHeroOthers li')).toHaveText(['Steam 版2025.02.27（四）已發售', 'PS5 版日期未收錄']);
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
  // Each card line is label | content (the store button spans the card): nothing drops into the label column.
  const misplaced = await page.evaluate(() => [...document.querySelectorAll('#gameVersionRows td[data-label]:not(.game-version-store) > *')]
    .map(child => [child.getBoundingClientRect(), child.parentElement!.getBoundingClientRect()])
    .filter(([box, cell]) => box.width && box.left < cell.left + 80).length);
  expect(misplaced).toBe(0);
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

test('an English description is translated in the page only when asked', async ({ page }) => {
  // A stand-in for the on-device Translator of desktop Chrome and Edge.
  await page.addInitScript(() => {
    (window as any).Translator = { create: async () => ({ translate: async (text: string) => `譯：${text}` }) };
  });
  await page.goto('game.html?appid=4182430');
  await expect(page.locator('#detailPage')).toBeVisible();
  const button = page.locator('#descriptionSource button.description-translate');
  // The description comes with the game's own file, which may land after the hero.
  await expect(button).toHaveText('翻譯成中文');
  const original = await page.locator('#gameDescription').textContent();
  await expect(page.locator('#gameDescriptionNote')).toBeHidden();
  await button.click();
  await expect(page.locator('#gameDescription')).toHaveAttribute('lang', 'zh-Hant');
  await expect(page.locator('#gameDescription')).toContainText('譯：');
  await expect(page.locator('#gameDescriptionNote')).toHaveText('瀏覽器機器翻譯，僅供參考；原文是英文。');
  await button.click();
  await expect(page.locator('#gameDescription')).toHaveText(original!);
  await expect(page.locator('#gameDescriptionNote')).toBeHidden();
});

test('without a built-in translator an English description opens Google Translate in a new tab', async ({ page }) => {
  await page.addInitScript(() => { delete (window as any).Translator; });
  await page.goto('game.html?appid=4182430');
  await expect(page.locator('#detailPage')).toBeVisible();
  const link = page.locator('#descriptionSource a.description-translate');
  await expect(link).toHaveText('Google 翻譯 ↗');
  await expect(link).toHaveAttribute('href', /^https:\/\/translate\.google\.com\/\?sl=en&tl=zh-TW&text=/);
  await expect(link).toHaveAttribute('target', '_blank');
});

// catalog.json leaves out descriptions: a game page reads its own games/<appid>.json.
async function holdGameFile(page: any, appid: number) {
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/data/games/${appid}.json`, async (route: any) => { await held; await route.continue(); });
  return () => release();
}

test('the description holds its place until the game file arrives, never saying there is none', async ({ page }) => {
  const expected = chooseDescription(readData(`games/${game.appid}.json`)).description;
  expect(expected).toBeTruthy();
  expect(readData('catalog.json').games.find((row: any) => row.appid === game.appid)).not.toHaveProperty('short_description');
  const release = await holdGameFile(page, game.appid);
  await page.goto(`game.html?appid=${game.appid}`);
  await expect(page.locator('#detailPage')).toBeVisible();
  const description = page.locator('#gameDescription');
  await expect(description).toHaveClass(/is-pending/);
  await expect(description).toHaveAttribute('aria-busy', 'true');
  await expect(description).toHaveText('');
  await expect(page.locator('#descriptionSource')).toBeHidden();
  release();
  await expect(description).toHaveText(expected);
  await expect(description).not.toHaveClass(/is-pending/);
  await expect(description).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#descriptionSource')).toBeVisible();
});

test('a console link to a game also on Steam shows the Steam copy, not the IGDB text first', async ({ page }) => {
  const steamRow = readData('catalog.json').games.find((row: any) =>
    readData(`games/${row.appid}.json`).short_description_source === 'steam_tchinese');
  const record = readData(`games/${steamRow.appid}.json`);
  const nintendo = readData('nintendo_upcoming.json');
  const base = nintendo.games.find((row: any) => !row.steam_appid && row.short_description_en);
  const consoleRow = { ...base, steam_appid: steamRow.appid,
    websites: [{ url: `https://store.steampowered.com/app/${steamRow.appid}/` }] };
  await page.route('**/data/nintendo_upcoming.json', route => route.fulfill({ json: { ...nintendo, games: [consoleRow] } }));
  const release = await holdGameFile(page, steamRow.appid);
  await page.goto(`game.html?igdb=${consoleRow.igdb_id}`);
  await expect(page.locator('#detailPage')).toBeVisible();
  await expect(page.locator('#gameVersionRows tr[data-platform="Steam"]')).toHaveCount(1);
  await expect(page.locator('#gameDescription')).toHaveClass(/is-pending/);
  await expect(page.locator('#gameDescription')).toHaveText('');
  release();
  await expect(page.locator('#gameDescription')).toHaveText(record.short_description);
  await expect(page.locator('#descriptionSource')).toContainText('Steam 官方繁中');
});

test('the game page never scrolls sideways, with Steam key art or a console cover', async ({ page }) => {
  const consoleGame = dataset.games.find((row: any) => row.source === 'nintendo');
  for (const route of [`game.html?appid=${game.appid}`, `game.html?igdb=${consoleGame.igdbId}&date=${consoleGame.date}`]) {
    for (const width of [390, 800, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route);
      await expect(page.locator('#detailPage')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${route} at ${width}px`).toBe(width);
    }
  }
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

test('a Steam game without media yet shows its Store capsule, blurred as the hero and whole in the title card', async ({ page }) => {
  // 11-20: games admitted at 09:03 had no image of their own until the 13:30 media run.
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await page.route(/steamstatic\.com/, route => route.fulfill({ contentType: 'image/png', body: png }));
  await page.route(`**/data/media/${game.appid}.json*`, route => route.fulfill({ status: 404, body: '' }));
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`game.html?appid=${game.appid}`);
    await expect(page.locator('#detailPage')).toBeVisible();
    await expect(page.locator('#gameHeroArt')).toHaveAttribute('data-kind', 'cover');
    await expect(page.locator('#gameHeroArt')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('#gameHeroImage')).toHaveAttribute('src', game.art);
    await expect(page.locator('#gameCover')).toBeVisible();
    await expect(page.locator('#gameCover')).toHaveAttribute('data-shape', 'wide');
    await expect(page.locator('#gameCover img')).toBeVisible();
    await expect(page.locator('#gameMedia')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  expect(failures).toEqual([]);
});
