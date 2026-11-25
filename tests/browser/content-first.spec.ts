import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Phones (≤800px) put the list on the first screen: 雷達動態 only on the home
// page, one title and one line under it, and the filters other than search in
// a bottom sheet behind 篩選. Desktop keeps every control where it was. On the
// home page the first games are the carousel or the 近期新作 strip.
const DATA = 'tests/fixtures/site-data';
const frozenAt = new Date(JSON.parse(readFileSync(resolve(DATA, 'catalog.json'), 'utf8')).generated_at);
const phone = { width: 390, height: 844 };

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: frozenAt });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

const top = (page: Page, selector: string) => page.locator(selector).filter({ visible: true }).first()
  .evaluate(element => Math.round(element.getBoundingClientRect().top + scrollY));

test('phones reach the first game within the first screen; only home keeps 雷達動態', async ({ page }) => {
  await page.setViewportSize(phone);
  const pages = [['index.html', 460], ['games.html', 340], ['upcoming.html', 420], ['released.html', 420]] as const;
  for (const [path, limit] of pages) {
    const first = path === 'index.html' ? '.home-hero-title, .release-card' : '.game-card';
    await page.goto(path);
    await expect(page.locator(first).filter({ visible: true }).first()).toBeVisible();
    expect(await top(page, first), path).toBeLessThanOrEqual(limit);
    await expect(page.locator('.activity-ticker')).toHaveCount(path === 'index.html' ? 1 : 0);
    await expect(page.locator('.page-heading > .eyebrow').first()).toBeHidden();
  }
});

test('篩選 opens a sheet with the other filters, and chips show what is applied', async ({ page }) => {
  await page.setViewportSize(phone);
  await page.goto('games.html');
  const toggle = page.locator('.filter-toggle');
  await expect(toggle).toBeVisible();
  await expect(page.locator('#languageFilter')).toBeHidden();
  await toggle.click();
  const sheet = page.getByRole('dialog', { name: '篩選' });
  await expect(sheet).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(sheet.locator('#followersFilter, #savedFilter, #releaseFilter, #languageFilter')).toHaveCount(4);
  expect(await page.locator('main').evaluate(element => (element as HTMLElement).inert)).toBe(true);
  // The sheet is above the bottom bar and its labels are visible.
  await sheet.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  const box = await sheet.boundingBox();
  expect(Math.round(box!.y + box!.height)).toBe(844);
  await expect(sheet.getByText('Steam 最低關注人數')).toBeVisible();

  await sheet.locator('#languageFilter').selectOption('tchinese');
  await expect(sheet.locator('.filter-sheet-count')).toHaveText(/款 \/ /);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(toggle).toBeFocused();
  expect(await page.locator('main').evaluate(element => (element as HTMLElement).inert)).toBe(false);
  await expect(page).toHaveURL(/language=tchinese/);
  await expect(page.getByRole('button', { name: '移除篩選：支援繁體中文' })).toBeVisible();
  await expect(toggle).toHaveAccessibleName(/篩選.*已套用 1 項/);

  await page.getByRole('button', { name: '移除篩選：支援繁體中文' }).click();
  await expect(page.locator('.applied-filters')).toBeHidden();
  await expect(page).not.toHaveURL(/language=/);
  await expect(toggle).toBeFocused();
  await expect(toggle.locator('.filter-toggle-count')).toBeHidden();
});

test('the sheet closes by its button, 完成 and the scrim, keeps Tab inside, and 清除 resets its filters', async ({ page }) => {
  await page.setViewportSize(phone);
  await page.goto('games.html');
  const toggle = page.locator('.filter-toggle');
  const sheet = page.getByRole('dialog', { name: '篩選' });
  await toggle.click();
  await sheet.getByRole('button', { name: '關閉篩選' }).click();
  await expect(sheet).toBeHidden();
  await toggle.click();
  await page.locator('.filter-scrim').click({ position: { x: 200, y: 40 } });
  await expect(sheet).toBeHidden();

  await toggle.click();
  for (let step = 0; step < 10; step += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.filter-sheet'))).toBe(true);
  }
  await expect(sheet.getByRole('button', { name: '清除' })).toBeDisabled();
  await sheet.locator('#followersFilter').selectOption('10000');
  await sheet.locator('#savedFilter').click();
  await expect(sheet.locator('#savedFilter')).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: '清除' }).click();
  await expect(sheet.locator('#followersFilter')).toHaveValue('0');
  await expect(sheet.locator('#savedFilter')).toHaveAttribute('aria-pressed', 'false');
  await sheet.getByRole('button', { name: '完成' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('.applied-filters')).toBeHidden();
});

test('the calendar puts month jump and sort in the sheet and phones get the list only; desktop gets them back', async ({ page }) => {
  await page.setViewportSize(phone);
  await page.goto('index.html');
  await expect(page.locator('#prevMonth')).toBeVisible();
  await expect(page.locator('#gamesGrid.schedule-list')).toBeVisible();
  await expect(page.locator('.view-switch').filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('.calendar-toolbar .view-switch')).toHaveCount(0);
  await page.locator('.filter-toggle').click();
  const sheet = page.getByRole('dialog', { name: '篩選' });
  await expect(sheet.getByText('跳至月份')).toBeVisible();
  await expect(sheet.getByLabel('選擇發售月份')).toBeVisible();
  await expect(sheet.locator('#sortSelect')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.calendar-toolbar #monthPicker')).toBeVisible();
  await expect(page.locator('.calendar-toolbar .view-switch')).toBeVisible();
  await expect(page.locator('.filter-bar #followersFilter')).toBeVisible();
  await expect(page.locator('.results-bar #sortWrap')).toBeVisible();
  await expect(page.locator('.filter-toggle')).toBeHidden();
  await expect(sheet).toBeHidden();
});

test('desktop keeps the filters in the page and never shows the sheet parts', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('games.html');
  await expect(page.locator('.filter-bar #followersFilter')).toBeVisible();
  await expect(page.locator('.catalog-filters #languageFilter')).toBeVisible();
  await expect(page.locator('.filter-toggle')).toBeHidden();
  await page.locator('#languageFilter').selectOption('english');
  await expect(page.locator('.applied-filters')).toBeHidden();
  await expect(page.locator('.filter-sheet')).toBeHidden();
});

test('Twitch on phones: region beside search, sources in one row, sort beside the count', async ({ page }) => {
  // The fixed site data has no Twitch snapshot; a small one fills the list.
  const generated = frozenAt.toISOString().replace(/\.\d{3}Z$/, 'Z');
  await page.route('**/data/twitch_live.json', route => route.fulfill({ json: {
    schema_version: 2, generated_at: generated, min_viewers: 7000, coverage: { collection_complete: true },
    candidate_games: ['1', '2', '3'].map((id, index) => ({ game_id: id, game_name: `遊戲 ${id}`,
      viewer_count: 20000 - index * 1000, streamer_count: 4, verification: { status: 'new', observed_at: generated } })),
  } }));
  for (const name of ['twitch_tracking', 'twitch_steam_mapping'])
    await page.route(`**/data/${name}.json`, route => route.fulfill({ json: {
      schema_version: 1, updated_at: generated, games: {} } }));
  await page.setViewportSize(phone);
  await page.goto('twitch.html');
  await expect(page.locator('.tw-game').first()).toBeVisible();
  expect(await top(page, '.tw-game')).toBeLessThanOrEqual(470);
  const region = await page.locator('#audienceRegion').boundingBox();
  const search = await page.locator('#gameSearch').boundingBox();
  expect(Math.abs(region!.y + region!.height / 2 - (search!.y + search!.height / 2))).toBeLessThanOrEqual(2);
  const sources = page.locator('.tw-source-filters button');
  const rows = new Set((await sources.evaluateAll(buttons => buttons.map(button => Math.round(button.getBoundingClientRect().top)))));
  expect(rows.size).toBe(1);
  await expect(page.locator('.tw-results-bar #gameSort')).toBeVisible();
  await expect(page.locator('.tw-guide-link')).toBeVisible();
  // The scope bar only stays for screen readers and is no longer sticky.
  expect(await page.locator('#currentObservation .tw-list-scope-toolbar').evaluate(element => getComputedStyle(element).position)).toBe('absolute');

  await page.locator('#audienceRegion').selectOption('zh');
  await expect(page).toHaveURL(/region=zh/);
  // The archive keeps its own scope bar on phones, in the page flow.
  await page.locator('#archiveTab').click();
  await expect(page.locator('#archiveRegion')).toBeVisible();
  await expect(page.locator('#archiveRefresh')).toBeVisible();
  await expect(page.locator('#historyArchive .tw-list-scope-toolbar')).toHaveCSS('position', 'static');
  await page.locator('#currentTab').click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.tw-list-scope-toolbar #audienceRegion')).toBeVisible();
  await expect(page.locator('.tw-tools #gameSort')).toBeVisible();
});
