import { test, expect } from '@playwright/test';

// A past date replays its closing hour from the small closing view, or from
// the raw day file when no view exists.
for (const historySource of ['closing view', 'raw day file']) {
test(`plans from the list to the game page with a past date, a stream slot and one region switch (${historySource})`, async ({ page }) => {
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
  for (const folder of ['twitch_history', 'twitch_history_close'])
    await page.route(`**/data/${folder}/**`, route => route.fulfill({ status:404, body:'{}' }));
  const closingHour = { '2026-11-10T15:00:00Z':{ generated_at:historicalAt, min_viewers:7000, games:archived } };
  const dayHours = historySource === 'closing view' ? closingHour : { ...closingHour,
    '2026-11-10T14:00:00Z':{ generated_at:'2026-11-10T14:18:00Z', min_viewers:7000, games:candidates } };
  const dayFolder = historySource === 'closing view' ? 'twitch_history_close' : 'twitch_history';
  await page.route(`**/data/${dayFolder}/2026-11-10.json`, route => route.fulfill({ json:{
    schema_version:1, date:'2026-11-10', timezone:'Asia/Taipei', hours:dayHours,
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
  // The planning page reads the month's heat file and falls back to the full
  // month when it is missing; each run covers one of the two paths.
  const heatHours = Object.fromEntries(Object.entries(hours).map(([hour, row]: [string, any]) => [hour, {
    generated_at:row.generated_at, viewer_count:row.viewer_count, streamer_count:row.streamer_count,
    ...(row.audience_regions ? { audience_regions:{ zh:Object.fromEntries(Object.entries(row.audience_regions.zh)
      .filter(([name]) => ['viewer_count', 'streamer_count', 'largest_stream_viewer_count', 'measurement_source'].includes(name))) } } : {}),
  }]));
  const servesHeat = historySource === 'closing view';
  await page.route('**/data/twitch_series/1/2026-11-heat.json', route => servesHeat ? route.fulfill({ json:{
    schema_version:1, timezone:'Asia/Taipei', game_id:'1', month:'2026-11', projection:'stream_heat_v1', hours:heatHours,
  } }) : route.fulfill({ status:404, body:'{}' }));
  const seriesRequests: string[] = [];
  page.on('request', request => {
    const match = /twitch_series\/1\/(2026-11(?:-heat)?\.json)/.exec(request.url());
    if (match) seriesRequests.push(match[1]);
  });
  // Days every 24 hours from the start: the game started at 00:00 on 11-05, so six days have ended.
  const curve = { kind:'release', date:'2026-10-01', launch_at:'2026-09-30T16:00:00Z', start_at:'2026-09-30T16:00:00Z',
    start_basis:'launch', daily:[3500,4000,300,200,100,90,80] };
  await page.route('**/data/twitch-launch-curves.json', route => route.fulfill({ json:{
    schema_version:2, generated_at:generated, genres:{ Action:'動作', Strategy:'策略' }, forecast:null, games:{
      ...Object.fromEntries([2,3,4,5,6].map(id => [String(id), { genres:['Action'], launches:[curve] }])),
      '1':{ genres:['Action','Strategy'], launches:[{ ...curve, date:'2026-11-05', launch_at:'2026-11-04T16:00:00Z',
        start_at:'2026-11-04T16:00:00Z', daily:[3000,5000,700,4000,500,400,null],
        audience_regions:{ zh:{ daily:[90,80,70,45,50,null,null], heat:[true,true,null,false,false,null,null],
          measurement_sources:['global_census','global_census','global_census','global_census','global_census',null,null] } } }] },
    },
  } }));

  await page.goto('twitch.html?view=streamer&sort=viewers&stream_hour=22');
  await expect(page).toHaveURL(/stream-planning\.html/);
  await expect(page.getByRole('heading', { name:'開台選題', exact:true })).toBeVisible();
  await expect(page.getByRole('tab', { name:'目前觀測' })).toHaveCount(0);
  const card = page.locator('.tw-plan-card[data-game="1"]');
  const profile = card.getByRole('link', { name:'遊戲頁（試播遊戲）', exact:true });
  await expect(card.getByRole('heading', { name:'試播遊戲', exact:true })).toBeVisible();
  await expect(card.getByRole('heading').getByRole('link')).toHaveCount(0);
  await expect(profile).toHaveAttribute('href', './game.html?appid=88001');
  await expect(card.locator('.tw-plan-links a')).toHaveText(['遊戲頁', '詳細分析']);
  await expect(page.locator('#streamTrendResults a[href^="https://store.steampowered.com/"]')).toHaveCount(0);
  const date = page.getByLabel('觀測日期（台灣）');
  await expect(date).toHaveValue('2026-11-11');
  await expect(page.locator('#streamPlanStatus')).toContainText('趨勢算到 11/10');
  // Cooled worldwide, still four hours at 100 Chinese viewers on most days.
  await expect(card).toHaveAttribute('data-group', 'cooled');
  await expect(card).toHaveAttribute('data-split', 'true');
  const globalRow = card.locator('.tw-plan-region[data-region="global"]'), chineseRow = card.locator('.tw-plan-region[data-region="zh"]');
  await expect(globalRow.locator('.tw-verdict-chip')).toHaveText('已退燒');
  await expect(chineseRow.locator('.tw-verdict-chip')).toHaveText('有熱度');
  const globalTile = card.locator('.tw-plan-tile[data-region="global"]'), chineseTile = card.locator('.tw-plan-tile[data-region="zh"]');
  await expect(globalTile.locator('strong')).toHaveText('1,400');
  await expect(globalTile.locator('.tw-plan-trend')).toHaveText('↓ 比前 3 天少 63%');
  await expect(chineseTile.locator('strong')).toHaveText('200');
  await expect(chineseTile.locator('.tw-plan-trend')).toHaveText('↓ 少 60%');
  await expect(page.locator('#streamDailyRule')).toContainText('有 4 個小時達 100 人為「有熱度」');
  // Games without hourly records wait at the bottom, folded.
  const unrecorded = page.locator('.tw-plan-more[data-group="none"]');
  await expect(unrecorded.locator('summary')).toContainText('沒有每小時紀錄');
  await unrecorded.locator('summary').click();
  const storeOnly = page.locator('.tw-plan-card[data-game="2"]');
  await expect(storeOnly.locator('.tw-plan-meta')).toHaveText('尚無逐時紀錄');
  await expect(storeOnly.getByRole('link')).toHaveCount(0);
  // Until the detail page opens, only the planning page has read the series.
  expect(seriesRequests[0]).toBe('2026-11-heat.json');
  expect(seriesRequests.includes('2026-11.json')).toBe(!servesHeat);
  const consoleProfile = page.locator('.tw-plan-card[data-game="3"]').getByRole('link', { name:'遊戲頁（遊戲 3）', exact:true });
  await expect(consoleProfile).toHaveAttribute('href', './game.html?igdb=303&date=2026-11-20');
  await expect(page.locator('.tw-plan-card[data-game="4"]').getByRole('link')).toHaveCount(0);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height:844 });
    const [left, right] = await Promise.all([globalTile.boundingBox(), chineseTile.boundingBox()]);
    expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x);
    expect(left!.y).toEqual(right!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.setViewportSize({ width:390, height:844 });
  // The filters fold behind 篩選 on a phone.
  await expect(date).toBeHidden();
  await page.locator('#planFilterToggle').click();
  await date.fill('2026-11-10');
  await expect(page).toHaveURL(/stream_date=2026-11-10/);
  await expect(page.locator('#streamPlanStatus')).toContainText('23:18');
  await expect(page.locator('.tw-plan-card[data-game="99"]')).toHaveCount(1);
  await expect(page.locator('.tw-plan-card[data-game="25"]')).toHaveCount(0);
  await expect(chineseRow.locator('.tw-verdict-chip')).toHaveText('有熱度');
  await date.fill('2026-11-04');
  await expect(page.locator('#streamPlanStatus')).toContainText('沒有已發布的觀測快照');
  await expect(page.locator('.tw-plan-card')).toHaveCount(0);
  await date.fill('2026-11-10');
  await page.locator('#gameSort').selectOption('viewers');
  await expect(page.locator('.tw-plan-card')).toHaveCount(25);
  await page.locator('.tw-plan-more[data-group="none"] summary').click();
  await consoleProfile.click();
  await expect(page.locator('#gameTitle')).toHaveText('遊戲 3');
  const back = page.getByRole('link', { name:'← 返回開台選題', exact:true });
  await expect(back).toHaveAttribute('href', /stream-planning\.html\?.*stream_date=2026-11-10/);
  await back.click();
  await expect(page.locator('.tw-plan-card')).toHaveCount(25);
  await expect(date).toHaveValue('2026-11-10');
  await expect(page.locator('#gameSort')).toHaveValue('viewers');
  await profile.click();
  await expect(page.locator('#gameTitle')).toHaveText('試播遊戲');
  await expect(page.locator('#gameSteam')).toHaveAttribute('href', 'https://store.steampowered.com/app/88001/');
  const mobileStore = page.locator('#gameSteamMobile');
  await expect(mobileStore).toBeVisible();
  await expect(mobileStore).toHaveAttribute('href', 'https://store.steampowered.com/app/88001/');
  await expect(mobileStore).toHaveAttribute('target', '_blank');
  await expect(back).toHaveAttribute('href', /stream-planning\.html\?.*stream_date=2026-11-10/);
  await back.click();
  await card.getByRole('link', { name:'詳細分析（試播遊戲）', exact:true }).click();
  await expect(page.locator('#historyStart')).toHaveValue('2026-11-10');
  await expect(page.locator('#historyBack')).toHaveAttribute('href', /stream-planning\.html\?.*stream_date=2026-11-10/);
  await expect(page.locator('#historyEnd')).toHaveValue('2026-11-10');
  await expect(page.locator('#gameMeta')).toHaveText('Steam 11/05 上市・今天第 7 天・動作');
  // The verdicts as of now: cooled worldwide, today already has Chinese heat.
  await expect(page.locator('#verdictPanel .tw-verdict-region[data-region="global"] strong')).toHaveText('建議收尾或換題');
  await expect(page.locator('#verdictPanel .tw-verdict-region[data-region="zh"] .tw-verdict-chip')).toHaveText('有熱度');
  await expect(page.locator('#dailyPanel .tw-daily-hot-label')).toHaveText('熱門線 3,000 人');
  // 什麼時候開: 60 viewers and 11:00～15:00 by default.
  await expect(page.locator('#slotViewers')).toHaveValue('60');
  await expect(page.locator('#slotStart')).toHaveValue('11');
  await expect(page.locator('#slotEnd')).toHaveValue('15');
  await expect(page.locator('#slotRank')).toHaveText('最近 7 天這段時間的名次紀錄不到 3 天，還不能算。');
  await expect(page.locator('#verdictPanel .tw-verdict-tile').nth(1)).toContainText('還不能算');
  // The tiers were counted at 22:00 only, before the 60-viewer tier: a range from 50 and 100.
  await page.locator('#slotStart').selectOption('22');
  await page.locator('#slotEnd').selectOption('23');
  await expect(page.locator('#slotRank')).toHaveText('平常 60 人的台，22:00～23:00 開大約排第 3～4 名（這一級的名次還在累積，先用前後兩級推估）。');
  await page.locator('#slotViewers').selectOption('50');
  await expect(page.locator('#slotRank')).toHaveText('平常 50 人的台，22:00～23:00 開常見排第 4 名，通常有 3 台比你多。');
  await expect(page.locator('#verdictPanel .tw-verdict-tile').nth(1)).toContainText('常見第 4 名');
  await page.locator('#slotCompare').selectOption('20');
  const tiles = page.locator('#slotTiles .tw-slot-tile');
  await expect(tiles.nth(0).locator('.tw-slot-label')).toHaveText('22:00～23:00・你的時段');
  await expect(tiles.nth(0).locator('strong')).toHaveText('約 2,600 人');
  await expect(tiles.nth(1).locator('.tw-slot-label')).toHaveText('20:00～21:00・看的人較多');
  await expect(tiles.nth(1).locator('strong')).toHaveText('約 2,800 人');
  await expect(tiles.nth(1).locator('.tw-slot-sub').first()).toHaveText('4 台在開・每台約 700 人');
  await expect(page.locator('#slotStatus')).toHaveText('11/04～11/10 有 6／7 天紀錄・全球');
  // The launch curves, folded under 詳細數據.
  await page.locator('#moreCurves > summary').click();
  const curves = page.locator('#launchCurves');
  await expect(curves).toContainText('同類中位數 · 5 款');
  await expect(curves.locator('.tw-launch-heat-metrics dd')).toHaveText(['3 天', '2 天']);
  await expect(curves).toContainText('第 3 天跌破門檻 · 第 4 天再次達標');
  await expect(curves).toContainText('同類 5／5 款在前 6 天曾達標');
  await expect(page.locator('#launchCurveStatus')).toHaveText('2026-11-05 · Steam 商店上市 · 全球 Twitch');
  await expect(curves.getByRole('img', {name:'上市後首週每日全球觀眾中位數'})).toBeVisible();
  await expect(curves.locator('svg .tw-chart-threshold')).toHaveCSS('stroke', 'rgb(183, 122, 67)');
  await expect(curves.getByRole('row', {name:/這款遊戲/})).toContainText('700 人');
  await expect(curves.getByRole('row', {name:/這款遊戲/})).toContainText('—');
  await page.locator('#moreHistory > summary').click();
  await page.locator('#moreCooldown > summary').click();
  await expect(page.locator('#cooldownRule')).toContainText('3,000 人');
  // One switch moves every section to the Chinese region.
  await page.locator('#pageRegion [data-region="zh"]').click();
  await expect(curves.getByRole('img', {name:'上市後首週每日中文區觀眾中位數'})).toBeVisible();
  await expect(curves.locator('.tw-launch-heat-metrics dd')).toHaveText(['2 天', '2 天']);
  await expect(curves).toContainText('前 6 天有 4 天可判定 · 100 人至少 4 個時段');
  await expect(page.locator('#dailyPanel .tw-daily-hot-label')).toHaveText('熱門線：4 小時 100 人');
  await expect(page.locator('#cooldownRule')).toContainText('達 100 人至少 4 次');
  await expect(page.locator('#cooldownStatus')).toHaveText('今日有熱度');
  const trend = page.locator('#remainingTrend .tw-remaining-trend');
  await expect(trend).toContainText('截至 2026/11/10');
  await expect(trend.getByRole('row', { name:/11\/10/ }).getByRole('cell')).toHaveText(['11/10', '90%', '-30 人', '0 台', '6']);
  await expect(trend.getByRole('row', { name:/11\/09/ }).getByRole('cell')).toHaveText(['11/09', '80%', '—', '—', '0']);
  await expect(trend.getByRole('row', { name:/11\/11/ })).toHaveCount(0);
  await page.locator('[data-history-range="7d"]').click();
  await expect(trend).toContainText('截至 2026/11/11');
  await expect(trend.getByRole('row', { name:/11\/11/ }).getByRole('cell')).toHaveText(['11/11（截至目前）', '100%', '—', '—', '2']);
  // Seven days draw the daily chart; only the worldwide one has the 3,000 line.
  await expect(page.locator('#historyChart [data-region="zh"] .tw-chart-threshold-label')).toHaveCount(0);
  await page.locator('#pageRegion [data-region="global"]').click();
  await expect(page.locator('#historyChart [data-region="global"] .tw-chart-threshold-label')).toHaveText('3,000 人門檻');
  await expect(page.locator('#remainingTrend .tw-remaining-trend')).toHaveCount(0);
  await page.locator('#pageRegion [data-region="zh"]').click();
  await page.locator('#launchCurveGenre').selectOption('Strategy');
  await expect(curves).toContainText('至少需要 5 款');
  await expect(page.locator('#moreCurves > summary strong')).toHaveText('同類策略新作的上市曲線');
  await page.setViewportSize({ width:320, height:844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.setViewportSize({ width:390, height:844 });
  await page.reload();
  await expect(page.locator('#pageRegion [data-region="zh"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#slotStart')).toHaveValue('22');
  await expect(page.locator('#slotEnd')).toHaveValue('23');
  await expect(page.locator('#slotViewers')).toHaveValue('50');
  await expect(page.locator('#slotCompare')).toHaveValue('20');
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
}
