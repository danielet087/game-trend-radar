import { test, expect } from '@playwright/test';

test('compares two trial hours with matched coverage and preserves the independent region and hour choices', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await page.clock.setFixedTime(new Date('2026-11-11T12:00:00+08:00'));
  const hours: Record<string, object> = {}, indexHours: Record<string, string> = {};
  for (const day of [8,9,10]) {
    for (const hour of [12,14]) {
      const stamp = `2026-11-${String(day).padStart(2, '0')}T${hour}:00:00Z`;
      const generated_at = stamp.replace(':00:00', ':10:00');
      indexHours[stamp] = generated_at;
      hours[stamp] = { generated_at, viewer_count:hour === 12 ? day * 20 : day * 10,
        streamer_count:hour === 12 ? 4 : 8, audience_regions:day !== 10 || hour === 12
          ? { zh:{ viewer_count:day, streamer_count:1 } } : undefined };
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
      first_hour:'2026-11-08T12:00:00Z', last_hour:'2026-11-10T14:00:00Z', sample_count:6, peak_viewer_count:200,
      release_reference:{ date:'2026-11-08', precision:'day', source:'Steam 台灣商店' },
      audience_regions:{ zh:{ sample_count:5, peak_viewer_count:10 } } } },
  } }));
  await page.route('**/data/twitch_series/1/2026-11.json', route => route.fulfill({ json:{
    schema_version:1, timezone:'Asia/Taipei', game_id:'1', month:'2026-11', hours,
  } }));

  await page.goto('twitch.html?view=streamer&sort=viewers&stream_hour=22');
  const card = page.locator('.tw-stream-game[data-game="1"]');
  const globalCard = card.locator('[data-region="global"]');
  const chineseCard = card.locator('[data-region="zh"]');
  await expect(globalCard.locator('.tw-stream-reason')).toHaveText('有觀眾 · 同區可比遊戲較少');
  await expect(globalCard.locator('.tw-stream-metrics')).toContainText('90 人');
  await expect(globalCard.locator('.tw-stream-metrics')).toContainText('8 台');
  await expect(chineseCard.locator('.tw-stream-reason')).toHaveText('這個時段資料不足');
  await expect(chineseCard.locator('.tw-stream-coverage')).toContainText('2/7 天');
  await expect(chineseCard.locator('.tw-stream-metrics')).toHaveCount(0);
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
  await page.locator('#streamHour').selectOption('20');
  await expect(chineseCard.locator('.tw-stream-metrics')).toContainText('9 人');
  await expect(globalCard.locator('.tw-stream-metrics')).toContainText('180 人');
  expect(await ids()).toEqual(initial);
  await page.locator('#streamHour').selectOption('22');
  await expect(chineseCard.locator('.tw-stream-reason')).toHaveText('這個時段資料不足');
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
  await page.getByRole('link', { name:'比較 試播遊戲 的試播時段' }).click();
  await expect(page).toHaveURL(/#trialTimes$/);
  await expect(page.locator('#trialHourA')).toHaveValue('22');
  await expect(page.locator('#trialHourB')).toHaveValue('20');
  await expect(page.locator('#trialRegion')).toHaveValue('compare');
  const global = page.locator('#trialTimeResults [data-region="global"]');
  const chinese = page.locator('#trialTimeResults [data-region="zh"]');
  await expect(global).toContainText('可優先試播 20:00');
  await expect(global.getByRole('row', { name:/20:00/ })).toContainText('180 人');
  await expect(global).toContainText('同日可比較 3／7 天');
  await expect(chinese).toContainText('同日可比較 2／7 天');
  await expect(chinese.getByRole('table')).toHaveCount(0);
  await expect(page.locator('#trialTimeTitle')).toBeInViewport();

  await page.locator('#trialHourB').selectOption('22');
  await expect(page.locator('#trialTimeStatus')).toHaveText('請選兩個不同的時段。');
  await page.locator('#trialHourB').selectOption('21');
  await page.locator('#trialRegion').selectOption('zh');
  await expect(chinese).toContainText('22:00 有 2 天紀錄，21:00 有 0 天');
  await expect(chinese).toContainText('同日可比較 0／7 天');
  await expect(page.locator('#summaryRegion')).toHaveValue('global');
  await page.reload();
  await expect(page.locator('#trialHourB')).toHaveValue('21');
  await expect(page.locator('#trialRegion')).toHaveValue('zh');
  await expect(page.locator('#trialTimes')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
