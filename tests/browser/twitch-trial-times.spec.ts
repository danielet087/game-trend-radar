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

  await page.goto('twitch.html?view=streamer&stream_hour=22&stream_region=compare');
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
  await expect(page.locator('#summaryRegion')).toHaveValue('compare');
  await page.reload();
  await expect(page.locator('#trialHourB')).toHaveValue('21');
  await expect(page.locator('#trialRegion')).toHaveValue('zh');
  await expect(page.locator('#trialTimes')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
