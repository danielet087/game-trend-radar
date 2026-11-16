import { test, expect } from '@playwright/test';

test('shows an as-of-date trend and keeps the hourly comparison on the detail page', async ({ page }) => {
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
        : day <= 7 ? 500 : day === 11 ? 5000 : 0;
      const concentration = (day === 9 || day === 10) && hour >= 19;
      hours[stamp] = { generated_at, viewer_count:viewers + (hour === 20 ? 200 : 0),
        ...(day >= 8 && hour === 22 ? { streamer_counts_above_viewers:[5, 3, 2] } : {}),
        streamer_count:hour === 20 ? 4 : 8, audience_regions:hour === 22 && day >= 7
          ? undefined : { zh:{ viewer_count:chinese, streamer_count:concentration ? 2 : chinese ? 1 : 0,
            ...(concentration ? { largest_stream_viewer_count:day === 9 ? 200 : 180 }
              : (day === 9 || day === 10) && hour < 2 ? { largest_stream_viewer_count:0 }
              : day === 11 && hour < 8 ? { largest_stream_viewer_count:5000 } : {}) } } };
    }
  }
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const generated = '2026-11-11T03:15:00Z';
  const steamGames = [
    { appid:88001, name:'試播遊戲', followers:6000, release_start:'2026-11-05' },
    { appid:88002, name:'遊戲 2', followers:100, release_start:'2026-11-06' },
  ];
  const candidates = Array.from({ length:25 }, (_, i) => ({ game_id:String(i + 1), game_name:i === 0 ? '試播遊戲' : `遊戲 ${i + 1}`,
    ...(i < steamGames.length ? { steam_matches:[{ steam_appid:steamGames[i].appid, display_name:steamGames[i].name }] } : {}),
    ...(i === 2 ? { igdb_id:'303' } : {}),
    viewer_count:20000 - i, streamer_count:i + 1, verification:{ status:'new', observed_at:generated } }));
  await page.route('**/data/twitch_live.json', route => route.fulfill({ json:{
    schema_version:2, generated_at:generated, min_viewers:7000, coverage:{ collection_complete:true },
    candidate_games:candidates,
  } }));
  const historicalAt = '2026-11-10T15:18:00Z';
  const archived = [
    ...candidates.slice(0, 24),
    { game_id:'99', game_name:'當日限定遊戲', viewer_count:30000, streamer_count:50, verification:{ status:'new' } },
  ].map(game => ({ ...game, verification:{ ...game.verification, observed_at:historicalAt } }));
  await page.route('**/data/twitch_history/**', route => route.fulfill({ status:404, body:'{}' }));
  await page.route('**/data/twitch_history/2026-11-10.json', route => route.fulfill({ json:{
    schema_version:1, date:'2026-11-10', timezone:'Asia/Taipei',
    hours:{
      '2026-11-10T15:00:00Z':{ generated_at:historicalAt, min_viewers:7000, games:archived },
      '2026-11-10T14:00:00Z':{ generated_at:'2026-11-10T14:18:00Z', min_viewers:7000, games:candidates },
    },
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
      release_reference:{ date:'2026-11-05', precision:'day', source:'Steam 台灣商店', steam_appid:'88001' },
      audience_regions:{ zh:{ sample_count:152, peak_viewer_count:5000 } } } },
  } }));
  await page.route('**/data/twitch_series/1/2026-11.json', route => route.fulfill({ json:{
    schema_version:1, timezone:'Asia/Taipei', game_id:'1', month:'2026-11', hours,
  } }));
  const curve = { date:'2026-10-01', edition:'standard_store_date', genres:['Action'], daily:[3500,4000,300,200,100,90,80] };
  await page.route('**/data/twitch-launch-curves.json', route => route.fulfill({ json:{
    schema_version:1, generated_at:generated, genres:{ Action:'動作', Strategy:'策略' }, games:{
      ...Object.fromEntries([2,3,4,5,6].map(id => [String(id), curve])),
      '1':{ ...curve, date:'2026-11-05', genres:['Action','Strategy'], daily:[3000,5000,700,4000,500,400,null],
        audience_regions:{ zh:{ daily:[90,80,70,45,50,null,null], heat:[true,true,null,false,false,null,null],
          measurement_sources:['global_census','global_census','global_census','global_census','global_census',null,null] } } },
    },
  } }));

  await page.goto('twitch.html?view=streamer&sort=viewers&stream_hour=22');
  await expect(page).toHaveURL(/stream-planning\.html.*stream_hour=22/);
  await expect(page.getByRole('heading', { name:'開台選題', exact:true })).toBeVisible();
  await expect(page.getByRole('tab', { name:'目前觀測' })).toHaveCount(0);
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
  await expect(page.locator('#streamPlanStatus')).toContainText('趨勢截至 11/10');
  await expect(globalCard.locator('.tw-stream-signal')).toHaveText('已退燒');
  await expect(globalCard.locator('.tw-stream-week')).toHaveText('近 6 日有 3 天達標');
  await expect(globalCard.locator('.tw-stream-reason')).toContainText('11/10 日中位數 1,200 人');
  await expect(globalCard.locator('.tw-stream-movement')).toHaveText('今日較平常 +7,400 人');
  await expect(chineseCard.locator('.tw-stream-signal')).toHaveText('熱度下滑');
  await expect(chineseCard.locator('.tw-stream-week')).toHaveText('近 6 日有 5 天達標');
  await expect(chineseCard.locator('.tw-stream-reason')).toContainText('11/11 · 12 次達 100 人');
  await date.fill('2026-11-10');
  await expect(page).toHaveURL(/stream_date=2026-11-10/);
  await expect(page.locator('#streamPlanStatus')).toContainText('23:18');
  await expect(page.locator('.tw-stream-game').first()).toHaveAttribute('data-game', '99');
  await expect(page.locator('.tw-stream-game[data-game="25"]')).toHaveCount(0);
  await expect(globalCard.locator('.tw-stream-movement')).toHaveCount(0);
  await expect(globalCard.locator('.tw-stream-signal')).toHaveText('已退燒');
  await expect(globalCard.locator('.tw-stream-reason')).toContainText('11/11 確認');
  await expect(globalCard.locator('.tw-stream-metrics dd')).toHaveText(['3,800 人', '1,400 人', '-63.2%']);
  await expect(chineseCard.locator('.tw-stream-signal')).toHaveText('熱度下滑');
  await expect(chineseCard.locator('.tw-stream-metrics dd')).toHaveText(['500 人', '200 人', '-60%']);
  await expect(chineseCard.locator('.tw-stream-reason')).toContainText('11/10 · 4 次達 100 人 · 有效 23/24');
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
  await date.fill('2026-11-04');
  await expect(page.locator('#streamPlanStatus')).toContainText('沒有已發布的觀測快照');
  await expect(page.locator('.tw-stream-game')).toHaveCount(0);
  await date.fill('2026-11-10');
  await page.locator('#gameSort').selectOption('streamers');
  await expect(page.locator('.tw-stream-game')).toHaveCount(24);
  await expect(page.locator('.tw-stream-game').first()).toHaveAttribute('data-game', '99');
  await page.locator('#streamLoadMore').click();
  await expect(page.locator('.tw-stream-game')).toHaveCount(25);
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
  await expect(back).toHaveAttribute('href', /stream-planning\.html\?.*stream_date=2026-11-10/);
  await back.click();
  await card.getByRole('link', { name:'詳細分析', exact:true }).click();
  await expect(page.locator('#historyStart')).toHaveValue('2026-11-10');
  await expect(page.locator('#historyBack')).toHaveAttribute('href', /stream-planning\.html\?.*stream_date=2026-11-10/);
  await expect(page.locator('#historyEnd')).toHaveValue('2026-11-10');
  const trend = page.locator('#heatOverview-zh .tw-remaining-trend');
  await expect(trend).toContainText('截至 2026/11/10');
  await expect(trend.getByRole('row', { name:/11\/10/ }).getByRole('cell')).toHaveText(['11/10', '90%', '-30 人', '0 台', '6']);
  await expect(trend.getByRole('row', { name:/11\/09/ }).getByRole('cell')).toHaveText(['11/09', '80%', '—', '—', '0']);
  await expect(trend.getByRole('row', { name:/11\/11/ })).toHaveCount(0);
  await expect(page.locator('#heatOverview-global .tw-remaining-trend')).toHaveCount(0);
  const ranking = page.getByRole('region', {name:'我大概排第幾？'});
  await expect(ranking.locator('[data-region="global"]')).toContainText('約第 4 名');
  await expect(ranking.locator('[data-region="zh"]')).toContainText('級距紀錄不足');
  await ranking.locator('#viewerRankAudience').selectOption('100');
  await expect(ranking.locator('[data-region="global"]')).toContainText('約第 3 名');
  const curves = page.getByRole('region', {name:'同類新作的上市曲線'});
  await expect(curves).toContainText('同類中位數 · 5 款');
  await expect(curves.locator('.tw-launch-heat-metrics dd')).toHaveText(['3 天', '2 天']);
  await expect(curves).toContainText('第 3 天跌破門檻 · 第 4 天再次達標');
  await expect(curves).toContainText('同類 5／5 款在前 5 天曾達標');
  await expect(curves.getByRole('img', {name:'上市後首週每日全球觀眾中位數'})).toBeVisible();
  await expect(curves.locator('svg .tw-chart-threshold')).toHaveCSS('stroke', 'rgb(183, 122, 67)');
  await expect(curves.getByRole('row', {name:/這款遊戲/})).toContainText('700 人');
  await expect(curves.getByRole('row', {name:/這款遊戲/})).toContainText('—');
  await curves.getByLabel('曲線範圍').selectOption('zh');
  await expect(curves.getByRole('img', {name:'上市後首週每日中文區觀眾中位數'})).toBeVisible();
  await expect(curves.locator('.tw-launch-heat-metrics dd')).toHaveText(['2 天', '2 天']);
  await expect(curves).toContainText('前 5 天有 4 天可判定 · 100 人至少 4 個時段');
  await curves.getByLabel('曲線範圍').selectOption('global');
  await curves.locator('#launchCurveGenre').selectOption('Strategy');
  await expect(curves).toContainText('至少需要 5 款');
  await page.locator('[data-history-range="7d"]').click();
  await expect(trend).toContainText('截至 2026/11/11');
  await expect(trend.getByRole('row', { name:/11\/11/ }).getByRole('cell')).toHaveText(['11/11（截至目前）', '100%', '—', '—', '2']);
  await page.setViewportSize({ width:320, height:844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.setViewportSize({ width:390, height:844 });
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
  await page.locator('.analysis-nav > summary').click();
  const menu = page.locator('#analysisMenu');
  await expect(menu.getByRole('link', { name:/開台選題/ })).toHaveAttribute('aria-current', 'page');
  await menu.getByRole('link', { name:/Twitch 新作觀測/ }).click();
  await expect(page).toHaveURL(/twitch\.html$/);
  await expect(page.getByRole('tab')).toHaveText(['目前觀測', '歷史資料庫']);
  await page.locator('.analysis-nav > summary').click();
  await menu.getByRole('link', { name:/開台選題/ }).click();
  await expect(page).toHaveURL(/stream-planning\.html$/);
  await expect(date).toHaveValue('2026-11-11');

});
