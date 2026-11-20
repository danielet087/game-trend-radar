import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The home page after the Nintendo-style layout: a focus carousel, the 近期新作
// strip around today, the release calendar with month tabs, and on phones the
// calendar as a dated list. The fixture data is frozen, so two clocks are used:
// 2026-10-01 noon in Taiwan has Steam games within two weeks (carousel and
// strip), and the fixture's own time (11/18) has one earlier release this month.
const DATA = 'tests/fixtures/site-data';
const fixtureTime = new Date(JSON.parse(readFileSync(resolve(DATA, 'catalog.json'), 'utf8')).generated_at);
const october = new Date('2026-10-01T04:00:00Z');
const phone = { width: 390, height: 844 };

async function open(page: Page, time: Date, path = 'index.html') {
  await page.clock.install({ time });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(path);
}

/** Stop the clock so the carousel only moves when a test advances time. */
async function holdClock(page: Page) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 100));
}

test('the carousel shows the five most-followed Steam games of the next two weeks and rotates', async ({ page }) => {
  await open(page, october);
  const hero = page.locator('#homeHero');
  await expect(hero).toBeVisible();
  const tabs = hero.getByRole('tab');
  await expect(tabs).toHaveCount(5);
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.first()).toContainText(/\d\d\.\d\d（.）/);
  const slide = hero.getByRole('tabpanel');
  await expect(slide).toHaveCount(1);
  // The latest official count (followers.json, 11/14), not the catalog's 396,361 from 10/16.
  await expect(slide.locator('.home-hero-meta')).toHaveText('Steam · 410,124 人關注');
  await expect(slide.locator('.home-hero-when')).toContainText('還有 14 天');
  await expect(hero.locator('.home-hero-count')).toHaveText('1 / 5');
  await expect(hero.getByRole('button', { name: '暫停輪播' })).toBeVisible();

  await holdClock(page);
  await page.clock.runFor(6_000);
  await expect(hero.locator('.home-hero-count')).toHaveText('2 / 5');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
});

test('choosing a slide stops the carousel; 播放 restarts it and arrow keys move between tabs', async ({ page }) => {
  await open(page, october);
  const hero = page.locator('#homeHero');
  const tabs = hero.getByRole('tab');
  await expect(tabs).toHaveCount(5);
  await holdClock(page);

  await tabs.nth(3).click();
  await expect(hero.locator('.home-hero-count')).toHaveText('4 / 5');
  await expect(hero.getByRole('button', { name: '播放輪播' })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(5, 5);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.clock.runFor(13_000);
  await expect(hero.locator('.home-hero-count')).toHaveText('4 / 5');

  await hero.getByRole('button', { name: '播放輪播' }).click();
  await expect(hero.getByRole('button', { name: '暫停輪播' })).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.move(5, 5);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.clock.runFor(6_000);
  await expect(hero.locator('.home-hero-count')).toHaveText('5 / 5');

  await tabs.nth(4).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.first()).toBeFocused();
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(tabs.nth(4)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.first()).toHaveAttribute('tabindex', '0');
  await expect(tabs.nth(1)).toHaveAttribute('tabindex', '-1');
});

test('reduced motion hides the carousel control and keeps the slide still', async ({ page }) => {
  await open(page, october);
  const hero = page.locator('#homeHero');
  await expect(hero.getByRole('tab')).toHaveCount(5);
  await holdClock(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(hero.locator('.home-hero-pause')).toBeHidden();
  await page.clock.runFor(13_000);
  await expect(hero.locator('.home-hero-count')).toHaveText('1 / 5');
});

test('the carousel save button follows the shared favorites', async ({ page }) => {
  await open(page, october);
  const save = page.locator('#homeHero').getByRole('tabpanel').locator('.home-hero-save');
  await expect(save).toHaveAttribute('aria-pressed', 'false');
  await save.click();
  await expect(save).toHaveAttribute('aria-pressed', 'true');
  await expect(save).toHaveAccessibleName(/^取消收藏 /);
});

test('近期新作 opens on today with the past week to the left, and the week buttons jump', async ({ page }) => {
  await open(page, october);
  const strip = page.locator('#homeReleases');
  const scroller = strip.locator('.releases-scroller');
  await expect(strip.locator('.release-day').first()).toBeVisible();
  // The first day from today sits at the left edge, after a 72px peek of the past.
  const opening = await scroller.evaluate(element => {
    const first = [...element.querySelectorAll<HTMLElement>('.release-day')].find(day => day.dataset.date! >= '2026-10-01')!;
    return { date: first.dataset.date, left: Math.round(first.getBoundingClientRect().left - element.getBoundingClientRect().left), scrolled: element.scrollLeft };
  });
  expect(opening.date).toBe('2026-10-01');
  expect(opening.scrolled).toBeGreaterThan(0);
  expect(Math.abs(opening.left - 72)).toBeLessThanOrEqual(2);
  await expect(strip.locator('.release-day.is-today')).toHaveAttribute('data-date', '2026-10-01');
  await expect(strip.locator('.release-day.is-today .release-day-label')).toContainText('今天');
  await expect(strip.locator('.release-day.is-past').first()).toBeAttached();
  await expect(strip.locator('.release-card-link').first()).toHaveAttribute('href', /game\.html\?/);

  const week = (label: string) => strip.locator('.releases-weeks').getByRole('button', { name: label });
  await expect(week('本週')).toHaveAttribute('aria-current', 'true');
  await expect(week('上週')).not.toHaveAttribute('aria-current', 'true');
  await week('下週').click();
  await expect(week('下週')).toHaveAttribute('aria-current', 'true');
  await expect(week('本週')).not.toHaveAttribute('aria-current', 'true');
  const next = await scroller.evaluate(element => {
    const box = element.getBoundingClientRect();
    return [...element.querySelectorAll<HTMLElement>('.release-day')]
      .find(day => day.getBoundingClientRect().right > box.left + 73)?.dataset.date;
  });
  expect(next! >= '2026-10-04' && next! <= '2026-10-10').toBe(true);
  await week('上週').click();
  await expect(week('上週')).toHaveAttribute('aria-current', 'true');
  const before = await scroller.evaluate(element => element.scrollLeft);
  await strip.getByRole('button', { name: '往後看' }).click();
  await expect.poll(() => scroller.evaluate(element => element.scrollLeft)).toBeGreaterThan(before);
});

test('each strip day keeps three cards and links the rest to that date', async ({ page }) => {
  await open(page, october);
  const days = page.locator('#homeReleases .release-day');
  await expect(days.first()).toBeVisible();
  const counts = await days.evaluateAll(groups => groups.map(group => ({
    cards: group.querySelectorAll('.release-card').length,
    more: group.querySelector<HTMLAnchorElement>('.release-more a')?.getAttribute('href') || null,
    date: (group as HTMLElement).dataset.date,
  })));
  expect(counts.every(day => day.cards >= 1 && day.cards <= 3)).toBe(true);
  const crowded = counts.find(day => day.more);
  expect(crowded, 'a day with more than three releases').toBeTruthy();
  expect(crowded!.more).toBe(`./date.html?date=${crowded!.date}`);
});

test('month tabs cover eight months from this one and follow the arrows', async ({ page }) => {
  await open(page, fixtureTime);
  const tabs = page.locator('#monthTabs .month-tab');
  await expect(tabs).toHaveCount(8);
  await expect(tabs.first()).toHaveText('11月');
  await expect(tabs.first()).toHaveAttribute('aria-current', 'true');
  await expect(tabs.first()).toHaveAccessibleName('2026 年 11 月（本月）');
  await expect(page.locator('#monthLabel')).toHaveText('2026.11');

  await tabs.nth(2).click();
  await expect(page.locator('#monthLabel')).toHaveText('2027.01');
  await expect(tabs.nth(2)).toHaveAttribute('aria-current', 'true');
  await expect(tabs.first()).not.toHaveAttribute('aria-current', 'true');
  await expect(page).toHaveURL(/month=2027-01/);
  await page.locator('#prevMonth').click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#monthLabel')).toHaveText('2026.12');
});

test('the old 即將登場 and 新鮮上架 sections are gone; the ticker and the link row stay', async ({ page }) => {
  await open(page, fixtureTime);
  await expect(page.locator('#releaseCalendar')).toBeVisible();
  await expect(page.locator('#spotlightGames, #recentGames, .workspace-heading')).toHaveCount(0);
  await expect(page.locator('.activity-ticker')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1, name: /發售月曆/ })).toBeVisible();
  const links = page.getByRole('navigation', { name: '更多探索' }).getByRole('link');
  await expect(links).toHaveCount(6);
  await expect(links.first()).toHaveAttribute('href', './games.html');
});

test('phones get the calendar as a dated list with the earlier days folded', async ({ page }) => {
  await page.setViewportSize(phone);
  await open(page, fixtureTime);
  const list = page.locator('#gamesGrid.schedule-list');
  await expect(list).toBeVisible();
  await expect(page.locator('.view-switch').filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('.calendar-day').filter({ visible: true })).toHaveCount(0);
  const earlier = page.locator('.schedule-earlier');
  await expect(earlier).toHaveText('11/1～11/17 已發售 1 款');
  await expect(earlier).toHaveAttribute('aria-expanded', 'false');
  await expect(list.locator('.schedule-date').first()).toContainText('19');
  await expect(list.locator('.schedule-date').first()).toContainText('（四）');
  const before = await list.locator('.game-card').count();

  await earlier.click();
  await expect(earlier).toHaveAttribute('aria-expanded', 'true');
  await expect(earlier).toHaveText('收起本月較早已發售的 1 款');
  await expect(list.locator('.game-card')).toHaveCount(before + 1);
  await expect(list.locator('.schedule-date').first()).toContainText('10');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.locator('#monthTabs .month-tab').nth(1).click();
  await expect(page.locator('#monthLabel')).toHaveText('2026.12');
  await expect(page.locator('.schedule-earlier')).toHaveCount(0);

  // A wider screen (a phone turned sideways, say) keeps the list but offers the calendar again.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.calendar-toolbar .view-switch')).toBeVisible();
  await page.locator('#calendarView').click();
  await expect(page.locator('.calendar-day').first()).toBeVisible();
  await expect(page).toHaveURL(/view=calendar/);
});

test('a list on desktop folds the same way and a filter shows every day again', async ({ page }) => {
  await open(page, fixtureTime, 'index.html?view=list');
  const earlier = page.locator('.schedule-earlier');
  await expect(earlier).toBeVisible();
  await page.getByRole('searchbox').fill('Warhammer');
  await expect(earlier).toHaveCount(0);
  await expect(page.locator('#gamesGrid .game-card')).toHaveCount(1);
});

test('platforms are named in the calendar, on the strip band and under the art in the list', async ({ page }) => {
  await open(page, fixtureTime, 'index.html?view=list');
  // GTA VI comes out on PS5 on 11/19 and IGDB also lists Xbox.
  const band = page.locator('#homeReleases .release-day[data-date="2026-11-19"] .release-card-platform').first();
  await expect(band).toHaveText('PlayStation 5');
  await expect(band.locator('.is-playstation')).toHaveCount(1);
  const card = page.locator('#gamesGrid .game-card').filter({ hasText: 'Grand Theft Auto VI' });
  await expect(card.locator('.platform-chip')).toHaveText(['PS5', 'Xbox']);
  await expect(card.locator('.platform-chip.is-released')).toHaveText(['PS5']);
  await expect(card.locator('.card-platforms')).toHaveAttribute('aria-label', '平台：PS5、Xbox；本次發售：PS5');
  const art = await card.locator('.cover-link').boundingBox(), chips = await card.locator('.card-platforms').boundingBox();
  expect(chips!.y).toBeGreaterThan(art!.y + art!.height);
  expect(Math.abs(chips!.x - art!.x)).toBeLessThanOrEqual(1);

  await page.locator('#calendarView').click();
  const entry = page.locator('.calendar-day .day-game').filter({ hasText: 'Grand Theft Auto VI' });
  await expect(entry.locator('.day-platform')).toHaveText('PS5');
  await expect(entry).toHaveClass(/day-game-playstation/);
  // IGDB's worldwide day is named as such, never as a Taiwan date.
  await expect(entry.locator('.day-platform')).toHaveAttribute('title', /^本日發售：PS5（IGDB 全球日期，台灣上市日待確認）。/);
  await expect(entry.locator('.day-platform')).toHaveClass(/is-unconfirmed/);
  await expect(entry.locator('.day-flag')).toHaveCount(0);
});

test('an NS2 game listed by IGDB PopScore shows its rank on the strip, the card and the calendar', async ({ page }) => {
  const consoles = JSON.parse(readFileSync(resolve(DATA, 'nintendo_upcoming.json'), 'utf8'));
  const base = consoles.games.find((game: any) => game.id === 'igdb:408719');
  const release = { date: '2026-11-21', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB',
    date_basis: 'igdb_calendar_day', source_date: '2026-11-21', source_region: 'worldwide', time_zone: 'Asia/Taipei',
    timezone_status: 'date_only', taiwan_release_confirmed: false, official_source_url: null, official_source_name: null,
    official_verified_at: null, official_product_id: null, official_concept_id: null, official_release_time_utc: null };
  const listed = { ...base, id: 'igdb:999001', igdb_id: 999001, display_name: '熱度範例', name_zh_tw: '熱度範例',
    name_en: 'PopScore Example', hypes: 4, popularity_status: 'below_threshold', popularity_basis: 'igdb_popscore',
    popscore: { visits: 0.0001, want_to_play: 0.0002, top_percent: 8 }, releases: [release], websites: [],
    url: 'https://www.igdb.com/games/popscore-example', nintendo_url: null, platform_urls: {} };
  await page.clock.install({ time: fixtureTime });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.route('**/data/nintendo_upcoming.json', route => route.fulfill({ json: { ...consoles, games: [...consoles.games, listed] } }));
  await page.goto('index.html?view=list');
  const strip = page.locator('#homeReleases .release-day[data-date="2026-11-21"] .release-card');
  await expect(strip.locator('.release-card-title')).toHaveText('熱度範例');
  await expect(strip.locator('.release-card-interest')).toHaveText('IGDB 熱度前 8%');
  const card = page.locator('#gamesGrid .game-card').filter({ hasText: '熱度範例' });
  await expect(card.locator('.card-followers')).toHaveText('前 8%IGDB 熱度');
  await expect(card).not.toContainText('hypes');
  await page.locator('#calendarView').click();
  const entry = page.locator('.calendar-day .day-game').filter({ hasText: '熱度範例' });
  await expect(entry).toHaveAttribute('title', /IGDB 熱度前 8%/);
});
