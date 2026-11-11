import { test, expect } from '@playwright/test';

test('shows regional heat on the planning list and keeps paired trial hours on the game detail', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await page.clock.setFixedTime(new Date('2026-11-11T12:00:00+08:00'));
  const hours: Record<string, object> = {}, indexHours: Record<string, string> = {};
  const audience = [3600, 3800, 4000, 1600, 1400, 1200, 10000];
  const chineseAudience = [0, 0, 2, 7, 150, 100, 5000];
  for (let day = 5; day <= 11; day++) {
    for (let hour = 0; hour < (day === 11 ? 12 : 24); hour++) {
      const start = Date.parse(`2026-11-${String(day).padStart(2, '0')}T00:00:00+08:00`);
      const at = start + hour * 3600000;
      const stamp = new Date(at).toISOString().replace('.000Z', 'Z');
      const generated_at = new Date(at + 600000).toISOString().replace('.000Z', 'Z');
      indexHours[stamp] = generated_at;
      const viewers = audience[day - 5], chinese = chineseAudience[day - 5];
      hours[stamp] = { generated_at, viewer_count:viewers + (hour === 20 ? 200 : 0),
        streamer_count:hour === 20 ? 4 : 8, audience_regions:hour === 22 && day >= 7
          ? undefined : { zh:{ viewer_count:chinese, streamer_count:chinese ? 1 : 0 } } };
    }
  }
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const generated = '2026-11-11T03:15:00Z';
  await page.route('**/data/twitch_live.json', route => route.fulfill({ json:{
    schema_version:2, generated_at:generated, min_viewers:7000, coverage:{ collection_complete:true },
    candidate_games:Array.from({ length:25 }, (_, i) => ({ game_id:String(i + 1), game_name:i === 0 ? '試播遊戲' : `遊戲 ${i + 1}`,
      viewer_count:20000 - i, streamer_count:i + 1, verification:{ status:'new', observed_at:generated } })),
  } }));
  for (const name of ['twitch_tracking', 'twitch_steam_mapping', 'catalog'])
    await page.route(`**/data/${name}.json`, route => route.fulfill({ status:404, body:'{}' }));
  await page.route('**/data/twitch_series/index.json', route => route.fulfill({ json:{
    schema_version:1, timezone:'Asia/Taipei', generated_at:'2026-11-11T03:15:00Z', months:{ '2026-11':indexHours },
    games:{ '1':{ name:'試播遊戲', archive_eligible:true, tracking_status:'active', months:['2026-11'],
      first_hour:'2026-11-04T16:00:00Z', last_hour:'2026-11-11T03:00:00Z', sample_count:156, peak_viewer_count:10000,
      release_reference:{ date:'2026-11-05', precision:'day', source:'Steam 台灣商店' },
      audience_regions:{ zh:{ sample_count:152, peak_viewer_count:5000 } } } },
  } }));
  await page.route('**/data/twitch_series/1/2026-11.json', route => route.fulfill({ json:{
    schema_version:1, timezone:'Asia/Taipei', game_id:'1', month:'2026-11', hours,
  } }));

  await page.goto('twitch.html?view=streamer&sort=viewers&stream_hour=22');
  const card = page.locator('.tw-stream-game[data-game="1"]');
  const globalCard = card.locator('[data-region="global"]');
  const chineseCard = card.locator('[data-region="zh"]');
  await expect(globalCard.locator('.tw-stream-signal')).toHaveText('已退燒');
  await expect(globalCard.locator('.tw-stream-reason')).toContainText('11/11 確認');
  await expect(globalCard.locator('.tw-stream-metrics')).toContainText('3,800 人');
  await expect(globalCard.locator('.tw-stream-metrics')).toContainText('1,400 人');
  await expect(chineseCard.locator('.tw-stream-signal')).toHaveText('黑馬竄起');
  await expect(chineseCard.locator('.tw-stream-reason')).toContainText('2/3 天達標');
  await expect(chineseCard.locator('.tw-stream-metrics dd')).toHaveText(['0 人', '100 人']);
  await expect(page.locator('#streamHour')).toHaveCount(0);
  await expect(page.locator('.tw-stream-game[data-game="2"] [data-region="global"] .tw-stream-reason')).toHaveText('尚無逐時紀錄');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height:844 });
    const [left, right] = await Promise.all([globalCard.boundingBox(), chineseCard.boundingBox()]);
    expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x);
    expect(left!.y).toEqual(right!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.setViewportSize({ width:390, height:844 });
  const ids = () => page.locator('.tw-stream-game').evaluateAll(cards => cards.map(card => card.getAttribute('data-game')));
  const currentIds = () => page.locator('#gameResults .tw-game').evaluateAll(cards => cards.map(card => card.getAttribute('data-game-id')));
  const initial = await ids();
  await page.locator('#currentTab').click();
  expect(await currentIds()).toEqual(initial);
  await page.locator('#gameSort').selectOption('streamers');
  const reordered = await currentIds();
  expect(reordered[0]).toBe('25');
  await page.locator('#streamPlanningTab').click();
  await expect(page.locator('.tw-stream-game')).toHaveCount(24);
  expect(await ids()).toEqual(reordered);
  await page.locator('#streamLoadMore').click();
  await expect(page.locator('.tw-stream-game')).toHaveCount(25);
  await page.locator('#currentTab').click();
  expect(await currentIds()).toEqual([...reordered, '1']);
  await page.locator('#streamPlanningTab').click();
  await page.getByRole('link', { name:'試播遊戲', exact:true }).click();
  await page.locator('#trialTimesJump').click();
  await expect(page).toHaveURL(/#trialTimes$/);
  await expect(page.locator('#trialHourA')).toHaveValue('22');
  await expect(page.locator('#trialHourB')).toHaveValue('20');
  await expect(page.locator('#trialRegion')).toHaveValue('compare');
  const global = page.locator('#trialTimeResults [data-region="global"]');
  const chinese = page.locator('#trialTimeResults [data-region="zh"]');
  await expect(global).toContainText('可優先試播 20:00');
  await expect(global.getByRole('row', { name:/20:00/ })).toContainText('2,800 人');
  await expect(global).toContainText('同日可比較 6／7 天');
  await expect(chinese).toContainText('同日可比較 2／7 天');
  await expect(chinese.getByRole('table')).toHaveCount(0);
  await expect(page.locator('#trialTimeTitle')).toBeInViewport();

  await page.locator('#trialHourB').selectOption('22');
  await expect(page.locator('#trialTimeStatus')).toHaveText('請選兩個不同的時段。');
  await page.locator('#trialHourB').selectOption('21');
  await page.locator('#trialRegion').selectOption('zh');
  await expect(chinese).toContainText('22:00 有 2 天紀錄，21:00 有 6 天');
  await expect(chinese).toContainText('同日可比較 2／7 天');
  await expect(page.locator('#summaryRegion')).toHaveValue('compare');
  await page.reload();
  await expect(page.locator('#trialHourB')).toHaveValue('21');
  await expect(page.locator('#trialRegion')).toHaveValue('zh');
  await expect(page.locator('#trialTimes')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
