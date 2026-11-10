import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { RadarData } from '../../src/domain/index.mjs';

const catalog = JSON.parse(readFileSync('data/catalog.json', 'utf8'));
const archive = catalog.games.find((row: any) => row.appid === 5356470);
const high = catalog.games.find((row: any) => {
  const game = RadarData.normalize(row);
  return game && game.source === 'steam' && game.followers >= 5000 &&
    game.date >= '2026-10-11' && game.date <= '2027-11-10';
});
const at = (date: string, followers: number) => ({ at:date, followers, source:'steam_community' });

test('ranking and detail share the latest official Followers while the ranking excludes games below 5,000', async ({ page }) => {
  await page.clock.install({ time:new Date('2026-11-10T04:00:00Z') });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue() : route.abort());
  const rows = [archive, high].map(row => ({ ...row, follower_checked_at:'2026-10-27T00:02:43Z' }));
  await page.route('**/data/catalog.json', route => route.fulfill({ json:{
    version:3, revision:'followers-regression', generated_at:'2026-11-10T01:00:00Z', count:2, games:rows,
  } }));
  await page.route('**/data/nintendo_upcoming.json', route => route.fulfill({
    json:{ schema_version:1, generated_at:'2026-11-10T01:00:00Z', games:[] },
  }));
  await page.route('**/data/growth.json', route => route.fulfill({ json:{ version:1, games:[
    { appid:archive.appid, history:[at('2026-11-02T23:41:50Z', 500), at('2026-11-09T23:41:50Z', 807)] },
    { appid:high.appid, history:[at('2026-11-03T01:00:00Z', 5000), at('2026-11-10T01:00:00Z', 6000)] },
  ] } }));
  for (const row of rows) await page.route(`**/data/games/${row.appid}.json`, route => route.fulfill({ json:row }));

  await page.goto('growth.html');
  await expect(page.locator('#growthUpdated')).toContainText('5,000 Followers 以上');
  await expect(page.locator('.growth-row')).toHaveCount(1);
  await expect(page.locator('.growth-change strong')).toHaveText('+20.0%');
  await expect(page.locator('.growth-total strong')).toHaveText('6,000');
  await page.locator('.growth-game-copy a').click();
  await expect(page.locator('#gameFollowers')).toHaveText('6,000');
  await expect(page.locator('#gameFollowersMeasured')).toContainText('2026/11/10 09:00');

  await page.goto(`game.html?appid=${archive.appid}`);
  await expect(page.locator('#gameFollowers')).toHaveText('807');
  await expect(page.locator('#gameFollowersMeasured')).toContainText('2026/11/10 07:41');
  await page.goto('growth.html?q=Playable%20Archive');
  await expect(page.locator('#growthUpdated')).toContainText('5,000 Followers 以上');
  await expect(page.locator('.growth-row')).toHaveCount(0);
  await expect(page.locator('#pendingSection')).toBeHidden();
  await expect(page.locator('#growthRows')).toContainText('最新官方量測須達 5,000 Followers');
});
