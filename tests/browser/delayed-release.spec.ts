import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { RadarData } from '../../src/domain/index.mjs';

// Never Be Alone, 11-26: listed on 12-08, Steam then moved it to 2027 Q1. The
// list still said 12-08 while Steam's time was 2027-03-31.
const catalog = JSON.parse(readFileSync('tests/fixtures/site-data/catalog.json', 'utf8'));
const base = catalog.games.find((row: any) => {
  const game = RadarData.normalize(row);
  return game && game.source === 'steam' && game.followers >= 5000 && game.date >= '2026-11-10';
});
const listed = { ...base, release_start: '2026-12-08', release_end: '2026-12-08', release_precision: 'day',
  release_time_utc: '2026-12-07T16:00:00Z', release_timestamp_taipei_date: '2026-12-08', release_date_conflict: false };
const moved = { ...listed, release_time_utc: '2027-03-31T07:00:00Z', release_timestamp_taipei_date: '2027-03-31' };

test('a game Steam moved to a later window keeps its page, leaves the calendar and is news', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-27T04:00:00Z') });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue() : route.abort());
  await page.route('**/data/catalog.json', route => route.fulfill({ json: {
    version: 3, revision: 'delayed-release', generated_at: '2026-11-27T01:00:00Z', count: 1, games: [moved],
  } }));
  await page.route(`**/data/games/${moved.appid}.json`, route => route.fulfill({ json: moved }));
  await page.route('**/data/store_facts.json', route => route.fulfill({ json: { schema_version: 1, checked_at: '2026-11-27T01:00:00Z',
    games: { [moved.appid]: { price: null, rating: null, steam_deck: null, advance_access: null,
      release: { at: '2027-03-31T07:00:00Z', coming_soon: true, display: 'date_quarter' }, checked_at: '2026-11-27T01:00:00Z' } } } }));
  await page.route('**/data/activity.json', route => route.fulfill({ json: { version: 1, generated_at: '2026-11-27T01:17:00Z',
    started_at: '2026-09-01T00:00:00Z', events: [{ type: 'delayed', appid: moved.appid, name: 'Delayed game',
      previous_date: '2026-12-08', date: '2027-03-31', precision: 'quarter', at: '2026-11-27T01:17:00Z',
      update_reason: 'steam_metadata_refresh', id: 'a'.repeat(20) }] } }));

  // The page stays, with Steam's window and the day it replaced.
  await page.goto(`game.html?appid=${moved.appid}`);
  await expect(page.locator('#gameHeroDate')).toHaveText('2027 年第一季');
  await expect(page.locator('#gameHeroLabel')).toHaveText('延期・Steam');
  await expect(page.locator('#gameHeroNote')).toHaveText('原定 2026.12.08；Steam 公布確定日期後才放回月曆');
  await expect(page.locator('#gamePlatforms .is-state')).toHaveText('延期');
  await expect(page.locator('#gameVersionRows .game-version[data-platform="Steam"] .game-version-dates'))
    .toHaveText('2027 年第一季（延期）原定 2026/12/08');
  await expect(page.locator('#gameNews')).toContainText('延期：原定 2026/12/08，Steam 改成 2027 年第一季');

  // The calendar leaves it out.
  await page.goto('date.html?date=2026-12-08');
  await expect(page.locator(`a[href*="appid=${moved.appid}"]`)).toHaveCount(0);

  // The ticker says so and links to the page.
  await page.goto('index.html');
  const item = page.locator('#activityTrack .activity-item').first();
  await expect(item.locator('.activity-kind.is-delay')).toHaveText('延期');
  await expect(item.locator('.activity-change')).toHaveText('2026/12/08 → 2027 年第一季');
  await expect(item).toHaveAttribute('href', `./game.html?appid=${moved.appid}`);
});
