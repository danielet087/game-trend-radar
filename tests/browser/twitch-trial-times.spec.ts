import { test, expect } from '@playwright/test';

test('shows single-date heat and keeps the hourly comparison on the detail page', async ({ page }) => {
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
      const viewers = audience[day - 5];
      const chinese = hour >= 19 ? chineseAudience[day - 5] + (day === 9 || day === 10 ? 100 : 0)
        : day <= 7 ? 150 : day === 11 ? 5000 : 0;
      const concentration = day === 10 && hour >= 19;
      hours[stamp] = { generated_at, viewer_count:viewers + (hour === 20 ? 200 : 0),
        streamer_count:hour === 20 ? 4 : 8, audience_regions:hour === 22 && day >= 7
          ? undefined : { zh:{ viewer_count:chinese, streamer_count:concentration ? 2 : chinese ? 1 : 0,
            ...(concentration ? { largest_stream_viewer_count:180 } : {}) } } };
    }
  }
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const generated = '2026-11-11T03:15:00Z';
  const steamGames = [
    { appid:88001, name:'試播遊戲', followers:6000, release_start:'2026-11-05' },
    { appid:88002, name:'遊戲 2', followers:100, release_start:'2026-11-06' },
  ];
  await page.route('**/data/twitch_live.json', route => route.fulfill({ json:{
    schema_version:2, generated_at:generated, min_viewers:7000, coverage:{ collection_complete:true },
    candidate_games:Array.from({ length:25 }, (_, i) => ({ game_id:String(i + 1), game_name:i === 0 ? '試播遊戲' : `遊戲 ${i + 1}`,
      ...(i < steamGames.length ? { steam_matches:[{ steam_appid:steamGames[i].appid, display_name:steamGames[i].name }] } : {}),
      ...(i === 2 ? { igdb_id:'303' } : {}),
      viewer_count:20000 - i, streamer_count:i + 1, verification:{ status:'new', observed_at:generated } })),
  } }));
  for (const name of ['twitch_tracking', 'twitch_steam_mapping'])
    await page.route(`**/data/${name}.json`, route => route.fulfill({ status:404, body:'{}' }));
  await page.route('**/data/catalog.json', route => route.fulfill({ json:{
    version:3, generated_at:generated, count:steamGames.length, games:steamGames,
  } }));
  await page.route('**/data/nintendo_upcoming.json', route => route.fulfill({ json:{
    schema_version:1, generated_at:generated, games:[{
      id:'igdb:303', igdb_id:303, name:'遊戲 3', hypes:60, sexual_content_screened:true,
      platforms:[{ id:167, code:'PS5' }],
      releases:[{ date:'2026-11-20', precision:'day', platform:'PS5', source:'IGDB', region:'worldwide',
        source_region:'worldwide', source_date:'2026-11-20', date_basis:'igdb_calendar_day',
        timezone_status:'date_only', time_zone:'Asia/Taipei', taiwan_release_confirmed:false }],
    }],
  } }));
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
  const profile = card.getByRole('link', { name:'遊戲頁（試播遊戲）', exact:true });
  await expect(card.getByRole('heading', { name:'試播遊戲', exact:true })).toBeVisible();
  await expect(card.getByRole('heading').getByRole('link')).toHaveCount(0);
  await expect(profile).toHaveAttribute('href', './game.html?appid=88001');
  await expect(card.locator('.tw-stream-game-actions a')).toHaveText(['遊戲頁', '詳細分析']);
  await expect(page.locator('#streamTrendResults a[href^="https://store.steampowered.com/"]')).toHaveCount(0);
  const globalCard = card.locator('[data-region="global"]');
  const chineseCard = card.locator('[data-region="zh"]');
  const date = page.getByLabel('觀測日期（台灣）');
  await expect(date).toHaveValue('2026-11-11');
  await expect(globalCard.locator('.tw-stream-signal')).toHaveText('統計中');
  await expect(chineseCard.locator('.tw-stream-signal')).toHaveText('有熱度');
  await expect(chineseCard.locator('.tw-stream-metrics dd')).toHaveText(['12 次', '12/24']);
  await date.fill('2026-11-10');
  await expect(page).toHaveURL(/stream_date=2026-11-10/);
  await expect(globalCard.locator('.tw-stream-signal')).toHaveText('已退燒');
  await expect(globalCard.locator('.tw-stream-reason')).toContainText('11/11 確認');
  await expect(globalCard.locator('.tw-stream-metrics dd')).toHaveText(['1,200 人', '24/24']);
  await expect(chineseCard.locator('.tw-stream-signal')).toHaveText('有熱度');
  await expect(chineseCard.locator('.tw-stream-metrics dd')).toHaveText(['4 次', '23/24']);
  await expect(chineseCard.locator('.tw-stream-concentration span')).toHaveText(['最大台占比 90%', '其餘台 20 人']);
  await expect(globalCard.locator('.tw-stream-concentration')).toHaveCount(0);
  await expect(page.locator('#streamHour')).toHaveCount(0);
  await page.locator('.tw-stream-method summary').click();
  await expect(page.locator('#streamDailyRule')).toContainText('達 100 人至少 4 次');
  await page.locator('.tw-stream-method summary').click();
  const storeOnly = page.locator('.tw-stream-game[data-game="2"]');
  await expect(storeOnly.locator('[data-region="global"] .tw-stream-reason')).toHaveText('尚無逐時紀錄');
  await expect(storeOnly.getByRole('link')).toHaveCount(0);
  const consoleProfile = page.locator('.tw-stream-game[data-game="3"]').getByRole('link', { name:'遊戲頁（遊戲 3）', exact:true });
  await expect(consoleProfile).toHaveAttribute('href', './game.html?igdb=303&date=2026-11-20');
  await expect(page.locator('.tw-stream-game[data-game="4"]').getByRole('link')).toHaveCount(0);
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
  await consoleProfile.click();
  await expect(page.locator('#gameTitle')).toHaveText('遊戲 3');
  const back = page.getByRole('link', { name:'← 返回開台選題', exact:true });
  await expect(back).toHaveAttribute('href', /stream_limit=48/);
  await back.click();
  await expect(page.locator('.tw-stream-game')).toHaveCount(25);
  await expect(date).toHaveValue('2026-11-10');
  await profile.click();
  await expect(page.locator('#gameTitle')).toHaveText('試播遊戲');
  await expect(page.locator('#gameSteam')).toHaveAttribute('href', 'https://store.steampowered.com/app/88001/');
  const mobileStore = page.locator('#gameSteamMobile');
  await expect(mobileStore).toBeVisible();
  await expect(mobileStore).toHaveAttribute('href', 'https://store.steampowered.com/app/88001/');
  await expect(mobileStore).toHaveAttribute('target', '_blank');
  await expect(back).toHaveAttribute('href', /twitch\.html\?.*view=streamer/);
  await back.click();
  await card.getByRole('link', { name:'詳細分析', exact:true }).click();
  await expect(page.locator('#historyStart')).toHaveValue('2026-11-10');
  await expect(page.locator('#historyEnd')).toHaveValue('2026-11-10');
  await page.locator('[data-history-range="7d"]').click();
  await expect(page.locator('#historyChart [data-region="global"] .tw-chart-threshold-label')).toHaveText('3,000 人門檻');
  await expect(page.locator('#historyChart [data-region="zh"] .tw-chart-threshold-label')).toHaveCount(0);
  await expect(page.locator('#global-cooldownRule')).toContainText('3,000 人');
  await expect(page.locator('#zh-cooldownRule')).toContainText('達 100 人至少 4 次');
  await expect(page.locator('#zh-cooldownStatus')).toHaveText('今日有熱度');
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
