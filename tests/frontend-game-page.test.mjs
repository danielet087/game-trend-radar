// The game page's own sections: Steam media, radar news, the Followers chart and overview cards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { steamMedia } from '../src/features/detail/media.js';
import { newsItems, chartModel, followerChanges, weekday } from '../src/features/detail/radar.js';
import { highlightTags, playModes } from '../src/features/detail/overview.js';
import { deckText, discountText, money, priceText, ratingText, storeFacts, taipeiTime } from '../src/features/detail/store.js';
import { RadarDiscovery as R } from '../src/features/discovery/index.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/site-data/${name}`, import.meta.url), 'utf8'));
const number = new Intl.NumberFormat('zh-TW');
const point = (at, followers) => ({ at, followers, source: 'steam_community' });

test('Steam media keeps only Steam CDN addresses for the requested game', () => {
  const doc = fixture('media/3926930.json');
  const media = steamMedia(doc, 3926930);
  assert.equal(media.screenshots.length, doc.screenshots.length);
  assert.equal(media.trailers.length, 1);
  assert.match(media.hero, /^https:\/\/shared\.akamai\.steamstatic\.com\/store_item_assets\//);
  assert.match(media.trailers[0].mp4, /^https:\/\/video\.akamai\.steamstatic\.com\/store_trailers\//);
  assert.deepEqual(media.developers, ['EmilJoes Games']);
  assert.equal(steamMedia(doc, 42), null);
  assert.equal(steamMedia({ ...doc, schema_version: 2 }, 3926930), null);
  const hostile = steamMedia({ ...doc, hero_image: 'javascript:alert(1)', developers: ['', 7, ' A '],
    screenshots: [{ thumbnail: 'https://evil.test/a.jpg', full: doc.screenshots[0].full }, ...Array(20).fill(doc.screenshots[0])],
    trailers: [{ ...doc.trailers[0], microtrailer_mp4: 'https://evil.test/a.mp4', microtrailer_webm: null }] }, 3926930);
  assert.equal(hostile.hero, null);
  assert.deepEqual(hostile.developers, ['A']);
  assert.equal(hostile.screenshots.length, 12);
  assert.ok(hostile.screenshots.every(shot => shot.thumb.startsWith('https://shared.akamai.steamstatic.com/')));
  assert.equal(hostile.trailers.length, 0);
});

test('radar news lists dated records newest first and never invents a measurement', () => {
  const history = [point('2026-09-20T01:56:48Z', 140298), point('2026-10-09T23:17:20Z', 141243),
    point('2026-10-17T17:18:54Z', 141908), point('2026-11-09T17:26:16Z', 143938), point('2026-11-16T17:24:26Z', 144799)];
  const game = { appid: 2769570, source: 'steam', date: '2027-02-24', name: '神鬼寓言' };
  const record = { release_start: '2027-02-24', release_date_verified_at: '2026-09-27T14:18:56Z' };
  const media = { hero: 'x', screenshots: Array(12).fill({}), trailers: [{}], updatedAt: '2026-11-19T02:26:51Z' };
  const items = newsItems({ game, record, history, activity: null, media, today: '2026-11-19', number });
  assert.deepEqual(items.map(item => [item.date, item.kind]), [
    ['2026-11-19', 'media'], ['2026-11-17', 'followers'], ['2026-09-27', 'release'], ['2026-09-20', 'added']]);
  assert.equal(items[0].text, 'Steam 影音更新：主視覺、12 張截圖、1 支預告');
  assert.equal(items[1].text, '關注數來到 144,799 人，7 天 +861、30 天 +2,891');
  assert.equal(items[2].text, 'Steam 確認完整發售日：2027 年 2 月 24 日');
  assert.equal(items[3].text, '第一次量測關注數：140,298 人');
  // A re-check after launch is not news, and a recorded admission replaces the first measurement.
  const released = newsItems({ game: { ...game, date: '2026-09-25' }, record: { ...record, release_start: '2026-09-25' },
    history, media: null, today: '2026-11-19', number,
    activity: { events: [{ type: 'added', appid: 2769570, name: 'Fable', date: '2026-09-25', at: '2026-11-18T04:00:00Z', update_reason: 'steam_daily_search' }] } });
  assert.deepEqual(released.map(item => item.kind), ['added', 'followers']);
  assert.equal(released[0].text, '收錄進雷達（每日 Steam 搜尋）');
  assert.deepEqual(newsItems({ game, record: null, history: [], activity: null, media: null, today: '2026-11-19', number }), []);
  assert.equal(weekday('2027-02-24'), '三');
});

test('console news uses only that game’s IGDB events', () => {
  const game = { source: 'nintendo', igdbId: 42, date: '2026-12-01' };
  const event = (id, type, extra = {}) => ({ source: 'nintendo', type, igdb_id: id, game_id: `igdb:${id}`, name: 'Game',
    date: '2026-12-01', at: '2026-11-18T03:00:00Z', platforms: ['NS2'], ...extra });
  const items = newsItems({ game, history: [], media: null, today: '2026-11-19', number,
    activity: { events: [event(42, 'release_date', { previous_date: '2026-11-20' }), event(7, 'added')] } });
  assert.deepEqual(items.map(item => item.text), ['發售日從 2026/11/20 改成 2026/12/01']);
  // Without a recorded admission, the game's first sighting is its arrival, on that Taiwan day.
  const first = newsItems({ game: { ...game, firstObservedAt: '2026-09-30T18:00:00Z' }, history: [], media: null,
    today: '2026-11-19', number, activity: { events: [event(42, 'release_date', { previous_date: '2026-11-20' })] } });
  assert.deepEqual(first.map(item => [item.date, item.kind, item.text]), [['2026-11-18', 'release', '發售日從 2026/11/20 改成 2026/12/01'],
    ['2026-10-01', 'added', '收錄進雷達（IGDB 主機新作）']]);
  const recorded = newsItems({ game: { ...game, firstObservedAt: '2026-09-30T18:00:00Z' }, history: [], media: null,
    today: '2026-11-19', number, activity: { events: [event(42, 'added')] } });
  assert.equal(recorded.filter(item => item.kind === 'added').length, 1);
  assert.equal(newsItems({ game: { ...game, firstObservedAt: 'not a time' }, history: [], media: null, today: '2026-11-19',
    number, activity: null }).length, 0);
});

test('the Followers chart breaks only where measurements stop for more than a week', () => {
  const history = [point('2026-09-20T01:56:48Z', 140298), point('2026-10-09T23:17:20Z', 141243),
    point('2026-10-10T17:17:38Z', 141306), point('2026-10-17T17:18:54Z', 141908), point('2026-10-24T17:20:02Z', 142468)];
  const model = chartModel(history, '2026-11-19');
  assert.deepEqual(model.segments.map(segment => segment.length), [1, 4]);
  assert.equal(model.gaps, 1);
  assert.equal(model.segments[0][0].x, 0);
  assert.equal(model.latest.x, 100);
  assert.equal(model.latest.followers, 142468);
  assert.ok(model.segments.flat().every(row => row.y >= 0 && row.y <= 100));
  assert.equal(chartModel([point('2026-11-01T00:00:00Z', 9)], '2026-11-19'), null);
  assert.equal(chartModel([], '2026-11-19'), null);
  // Changes use the nearest real baseline and say how many days they actually span.
  assert.deepEqual(followerChanges(history, '2026-10-25').map(({ span, metric }) => [span, metric.delta, metric.days]),
    [[7, 560, 7], [30, 2170, 35]]);
  // A latest measurement more than 8 days old reports no change at all.
  assert.deepEqual(followerChanges(history, '2026-11-19'), []);
});

test('overview highlights TAGs beyond genres and reports verified play modes', () => {
  const game = { genres: ['Action', 'Adventure', 'RPG'], tags: ['RPG', 'Action', 'Adventure', 'Fantasy', 'Singleplayer',
    'Open World', 'Action-Adventure', 'LGBTQ+', 'Choices Matter', 'Character Customization', 'Third Person'] };
  assert.deepEqual(highlightTags(game, R), ['Fantasy', 'Open World', 'Action-Adventure', 'LGBTQ+', 'Choices Matter', 'Character Customization']);
  assert.deepEqual(playModes({ platforms: ['Steam'], platformMultiplayer: { Steam: { status: 'single', source: 'Steam', modes: [] } } }),
    [{ platform: 'Steam', text: '單人', source: 'Steam' }]);
  assert.deepEqual(playModes({ platforms: ['NS2', 'PS5'], platformMultiplayer: {
    NS2: { status: 'multiplayer', source: 'IGDB', scope: 'game', modes: ['多人', '合作'] },
    PS5: { status: 'unknown', source: 'IGDB', scope: 'game', modes: [] } } }),
  [{ platform: 'NS2', text: '多人、合作', source: 'IGDB' }]);
});

test('store facts keep only valid price, CSRR rating and Steam Deck values for the requested game', () => {
  const doc = fixture('store_facts.json');
  const onimusha = storeFacts(doc, 2638890);
  assert.deepEqual(onimusha.price, { free: false, final: 199000 });
  assert.equal(priceText(onimusha.price), 'NT$ 1,990');
  assert.equal(ratingText(onimusha.rating), '限制級（暴力）');
  assert.equal(deckText(onimusha.steamDeck), '可遊玩');
  assert.equal(taipeiTime(onimusha.checkedAt), '11/18 19:30');
  const sale = storeFacts(doc, 499170);
  assert.equal(discountText(sale.price), '-20%，原價 NT$ 561，特價到 12/1 02:00');
  assert.equal(priceText(storeFacts(doc, 1732430).price), '免費');
  assert.equal(storeFacts(doc, 42), null);
  assert.equal(storeFacts({ ...doc, schema_version: 2 }, 2638890), null);
  const entry = doc.games['2638890'];
  const hostile = storeFacts({ ...doc, games: { 2638890: { ...entry,
    price: { free: false, final_cents: -5 }, rating: { code: 'R', label: '普遍級', descriptors: [] }, steam_deck: 'great' } } }, 2638890);
  assert.equal(hostile, null);
  const noTime = storeFacts({ ...doc, games: { 2638890: { ...entry, checked_at: 'soon' } } }, 2638890);
  assert.equal(noTime, null);
  assert.equal(money(12345), 'NT$ 123.45');
  assert.equal(taipeiTime(Date.parse('2026-11-18T16:05:00Z')), '11/19 00:05');
});
