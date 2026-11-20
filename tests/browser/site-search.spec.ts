import { test, expect, type Page } from '@playwright/test';

// The header's site search: a field with a dropdown above 1080px, a button and
// a full-screen sheet below. It reads the frozen fixture catalog.
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

async function smallParts(page: Page, scope: string) {
  return page.evaluate(selector => {
    const root = document.querySelector(selector)!;
    const visible = (element: Element) => element.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const small = [...root.querySelectorAll('*')].filter(element =>
      [...element.childNodes].some(node => node.nodeType === 3 && node.textContent!.trim()) && visible(element) &&
      parseFloat(getComputedStyle(element).fontSize) < 12).map(element => element.className);
    const tiny = [...root.querySelectorAll('a[href], button, input')].filter(element => {
      const box = element.getBoundingClientRect();
      return visible(element) && box.width > 0 && (box.width < 24 || box.height < 24);
    }).map(element => element.className);
    return [...small, ...tiny];
  }, scope);
}

test('desktop: 「/」 opens the header search where the page has none, and ↑↓ Enter open a game', async ({ page }) => {
  await page.goto('growth.html');
  const field = page.locator('#siteSearchInput');
  await expect(page.locator('.site-search-kbd')).toBeVisible();
  await page.keyboard.press('/');
  await expect(field).toBeFocused();
  await expect(page.locator('.site-search-panel')).toContainText('常見 TAG');
  await field.fill('kingdom');
  const first = page.locator('#site-search-option-0');
  await expect(first).toContainText('王國保衛戰');
  await expect(field).toHaveAttribute('aria-expanded', 'true');
  expect(await field.getAttribute('aria-activedescendant')).toBeNull();
  expect(await smallParts(page, '.site-search-panel')).toEqual([]);
  await field.press('ArrowDown');
  await expect(field).toHaveAttribute('aria-activedescendant', 'site-search-option-0');
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await field.press('Enter');
  await expect(page).toHaveURL(/game\.html\?appid=4259190/);

  await page.goto('growth.html');
  await page.locator('#siteSearchInput').focus();
  await expect(page.locator('.site-search-recent-term')).toHaveText(['kingdom']);
  await page.locator('#siteSearchInput').press('ArrowDown');
  await page.locator('#siteSearchInput').press('Delete');
  await expect(page.locator('.site-search-recent-term')).toHaveCount(0);
});

test('desktop: an exact AppID is chosen first, and Enter opens it', async ({ page }) => {
  await page.goto('growth.html');
  const field = page.locator('#siteSearchInput');
  await field.fill('2638890');
  await expect(page.locator('#site-search-option-0')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.site-search-appid')).toContainText('2638890');
  await expect(page.locator('.site-search-all')).toContainText('在全部遊戲搜尋「2638890」');
  await field.press('Enter');
  await expect(page).toHaveURL(/game\.html\?appid=2638890/);
});

test('desktop: TAGs open TAG 探索, the count is what 全部遊戲 shows, and Esc or the dimmed page close it', async ({ page }) => {
  await page.goto('growth.html');
  const field = page.locator('#siteSearchInput');
  await field.fill('開放');
  await expect(page.locator('.site-search-tag-row').first()).toHaveAttribute('href', './explore.html?tag=Open+World');
  await expect(page.locator('.site-search-all')).toContainText('在全部遊戲看有這些 TAG 的遊戲');
  await field.press('Escape');
  await expect(page.locator('.site-search-panel')).toHaveCount(0);
  await expect(field).toHaveValue('開放');

  await field.fill('王國');
  const all = page.locator('.site-search-all');
  await expect(all).toContainText(/看全部 \d+ 筆/);
  const count = Number((await all.textContent())!.match(/看全部 (\d+) 筆/)![1]);
  await page.mouse.click(640, 700);
  await expect(page.locator('.site-search-panel')).toHaveCount(0);
  await expect(page).toHaveURL(/growth\.html$/);
  await field.focus();
  await all.click();
  await expect(page).toHaveURL(/games\.html\?q=%E7%8E%8B%E5%9C%8B/);
  await expect(page.locator('#searchInput')).toHaveValue('王國');
  await expect(page.locator('#resultCount')).toHaveText(new RegExp(`^共 ${count} 款`));
});

test('desktop: nothing found offers TAG 探索, and Enter searches 全部遊戲', async ({ page }) => {
  await page.goto('growth.html');
  const field = page.locator('#siteSearchInput');
  await field.fill('silksong');
  await expect(page.locator('.site-search-empty')).toContainText('找不到「silksong」');
  await expect(page.locator('.site-search-empty a')).toHaveText(['去 TAG 探索', '看全部遊戲']);
  await field.press('Enter');
  await expect(page).toHaveURL(/games\.html\?q=silksong/);
  await expect(page.locator('#searchInput')).toHaveValue('silksong');
});

test('pages with their own search keep 「/」 for it', async ({ page }) => {
  await page.goto('games.html');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.site-search-kbd')).toHaveCount(0);
  await page.keyboard.press('/');
  await expect(page.locator('#searchInput')).toBeFocused();
  await expect(page.locator('.site-search-panel')).toHaveCount(0);
});

test('phones: the header button opens a full-screen search over the bottom bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('growth.html');
  await expect(page.locator('#siteSearchInput')).toBeHidden();
  const button = page.getByRole('button', { name: '搜尋遊戲、AppID 或 TAG' });
  await button.click();
  const sheet = page.getByRole('dialog', { name: '搜尋' });
  await expect(sheet).toBeVisible();
  await expect(page.locator('#siteSearchSheetInput')).toBeFocused();
  expect(await page.evaluate(() => !!document.elementFromPoint(195, 820)?.closest('.site-search-sheet'))).toBe(true);
  await expect(sheet).toContainText('常見 TAG');
  expect(await smallParts(page, '.site-search-sheet')).toEqual([]);
  await page.locator('#siteSearchSheetInput').fill('王國');
  await expect(sheet.locator('.site-search-game').first()).toContainText('王國保衛戰');
  expect(await smallParts(page, '.site-search-sheet')).toEqual([]);
  await sheet.getByRole('button', { name: '關閉搜尋' }).click();
  await expect(sheet).toBeHidden();
  await expect(button).toBeFocused();

  await button.click();
  await sheet.locator('.site-search-all').click();
  await expect(page).toHaveURL(/games\.html\?q=/);
  await page.goto('growth.html');
  await button.click();
  await expect(sheet.locator('.site-search-recent-term')).toHaveText(['王國']);
  await sheet.getByRole('button', { name: '從最近搜尋移除 王國' }).click();
  await expect(sheet.locator('.site-search-recent-term')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('the header keeps every item inside its padding from 801px up', async ({ page }) => {
  for (const width of [801, 900, 1080, 1081, 1101, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('growth.html');
    const layout = await page.evaluate(() => {
      const inner = document.querySelector('.header-inner')!;
      const items = [...inner.children].filter(element => element.getBoundingClientRect().width > 0);
      return {
        scroll: document.documentElement.scrollWidth,
        right: Math.max(...items.map(element => element.getBoundingClientRect().right)),
        limit: inner.getBoundingClientRect().right - parseFloat(getComputedStyle(inner).paddingRight),
        field: document.querySelector('.site-search-field')!.getBoundingClientRect().width,
      };
    });
    expect(layout.scroll, `${width}px`).toBeLessThanOrEqual(width);
    expect(layout.right, `${width}px`).toBeLessThanOrEqual(layout.limit + 0.5);
    if (width > 1080) expect(layout.field, `${width}px`).toBeGreaterThanOrEqual(220);
  }
});
