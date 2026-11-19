import test from 'node:test';
import assert from 'node:assert/strict';
import { RadarData as D } from '../src/domain/index.mjs';
import { addDays, daysBetween, dotDate, longDate, weekStart } from '../src/features/home/dates.ts';
import { heroCandidates, heroSlides } from '../src/features/home/hero.ts';
import { openingDay, releaseDays } from '../src/features/home/releases.ts';

const TODAY = '2026-11-19';
const steam = (appid, date, followers, extra = {}) => ({ appid, key: appid, source: 'steam', name: `Game ${appid}`, date, followers, ...extra });
const console_ = (id, date, hypes) => ({ appid: null, key: `igdb:${id}`, identityKey: `igdb:${id}`, igdbId: id, source: 'nintendo', name: `Console ${id}`, date, hypes });
const hero = appid => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_hero.jpg`;
const media = appid => ({ schema_version: 1, appid, hero_image: hero(appid), hero_image_2x: null });

test('home dates use Taiwan calendar days, Sunday-start weeks and Chinese weekdays', () => {
  assert.equal(dotDate(TODAY), '11.19（四）');
  assert.equal(longDate('2026-12-03'), '12 月 3 日（四）');
  assert.equal(weekStart(TODAY), '2026-11-15');
  assert.equal(weekStart('2026-11-15'), '2026-11-15');
  assert.equal(addDays('2026-11-30', 2), '2026-12-02');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(daysBetween(TODAY, '2026-12-03'), 14);
  assert.equal(daysBetween(TODAY, TODAY), 0);
});

test('carousel candidates are upcoming Steam games within two weeks, one per game, most followed first', () => {
  const games = [
    steam(1, '2026-11-20', 500), steam(2, '2026-12-03', 9000), steam(3, TODAY, 700),
    steam(1, '2026-11-25', 500), // the same game on another date counts once
    steam(4, '2026-12-04', 99999), // fifteen days away
    steam(5, '2026-11-18', 88888), // already out
    steam(6, '2026-11-21', NaN), // no follower count
    console_(7, '2026-11-20', 5000),
  ];
  assert.deepEqual(heroCandidates(games, TODAY, D).map(game => game.appid), [2, 3, 1]);
});

test('with fewer than three games in two weeks the carousel looks 45 days ahead', () => {
  const games = [steam(1, '2026-11-20', 500), steam(2, '2026-12-20', 9000), steam(3, '2027-01-02', 700), steam(4, '2027-01-04', 800)];
  assert.deepEqual(heroCandidates(games, TODAY, D).map(game => game.appid), [2, 3, 1]);
});

test('carousel slides keep the first five candidates whose media file has Steam hero art', async () => {
  const candidates = [1, 2, 3, 4, 5, 6, 7].map(appid => steam(appid, '2026-11-20', 1000 - appid));
  const load = appid => appid === 2 ? Promise.reject(new Error('missing'))
    : appid === 3 ? Promise.resolve({ ...media(3), hero_image: 'https://example.com/hero.jpg' })
      : appid === 4 ? Promise.resolve({ ...media(4), appid: 40 }) : Promise.resolve(media(appid));
  const slides = await heroSlides(candidates, load);
  assert.deepEqual(slides.map(slide => slide.game.appid), [1, 5, 6, 7]);
  assert.equal(slides[0].hero, hero(1));
});

test('the strip groups a week back and three weeks ahead by day, three cards per day, Steam first', () => {
  const games = [
    steam(1, '2026-11-12', 10), steam(2, '2026-11-11', 10), // the first day, then one day too early
    console_(3, TODAY, 9000), steam(4, TODAY, 30), steam(5, TODAY, 20), steam(6, TODAY, 40),
    steam(6, TODAY, 40), // the same release event twice
    steam(7, '2026-12-10', 10), steam(8, '2026-12-11', 10), // the last day, then one too late
  ];
  const days = releaseDays(games, TODAY, D);
  assert.deepEqual(days.map(day => day.date), ['2026-11-12', TODAY, '2026-12-10']);
  const today = days[1];
  assert.equal(today.total, 4);
  assert.deepEqual(today.games.map(game => game.appid ?? game.key), [6, 4, 5]);
});

test('the strip opens on today, else the next release day, else the last day', () => {
  const days = ['2026-11-14', '2026-11-22'].map(date => ({ date, games: [], total: 1 }));
  assert.equal(openingDay(days, '2026-11-14'), '2026-11-14');
  assert.equal(openingDay(days, TODAY), '2026-11-22');
  assert.equal(openingDay(days, '2026-11-30'), '2026-11-22');
  assert.equal(openingDay([], TODAY), null);
});
