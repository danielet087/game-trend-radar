import test from 'node:test';
import assert from 'node:assert/strict';
import { RadarData as D } from '../src/domain/index.mjs';
import { RadarDiscovery as R } from '../src/features/discovery/index.js';
import { FilterState } from '../src/features/catalog/filter-state.ts';
import { cardDate, selectCatalog } from '../src/features/catalog/selectors.ts';
import { LIMITS, buildIndex, highlight, normalize, popularTags, releaseStatus, searchIndex } from '../src/shared/search/match.ts';
import { RECENT_LIMIT, clearRecent, forgetSearch, readRecent, rememberSearch } from '../src/shared/search/recent.ts';

const TODAY = '2026-10-08';
const steam = (appid, name, display_name, release_start, followers, tags = []) =>
  ({ appid, name, name_en: name, display_name, followers, release_start, language_support: { tchinese: true }, tags });
const games = [
  steam(4259190, 'Kingdom Rush 6: Genesis TD', '王國保衛戰 6：重啟', '2026-09-24', 8570, ['Strategy', 'Tower Defense']),
  steam(100, 'Sky Kingdom', '天空王國', '2026-10-20', 9000, ['Open World', 'Action']),
  steam(101, 'Mykingdomcraft', 'Mykingdomcraft', '2026-10-09', 50000, ['Open World Survival Craft']),
  steam(102, 'Kingdom Far Future', '遙遠王國', '2027-03-01', 6000, ['Action']),
  steam(103, 'Quiet Fields', '安靜原野', '2026-10-08', 7000, ['Open World', 'Action']),
  ...Array.from({ length: 8 }, (_, n) => steam(200 + n, `Echo ${n + 1}`, `Echo ${n + 1}`, `2026-11-0${n + 1}`, 5000 + n, ['Puzzle'])),
];
const native = {
  schema_version: 1,
  games: [{ id: 'igdb:99', igdb_id: 99, name_en: 'Harbor Lights', name_zh_tw: '港灣燈火', hypes: 40, sexual_content_screened: true,
    platform_data_complete: true, platforms: [{ id: 167, code: 'PS5' }], known_platforms: [{ id: 167, code: 'PS5' }],
    releases: [{ date: '2026-10-18', platform: 'PS5', precision: 'day', source: 'IGDB', date_basis: 'igdb_calendar_day', time_zone: 'Asia/Taipei',
      timezone_status: 'date_only', source_date: '2026-10-18', region: 'worldwide', source_region: 'worldwide', taiwan_release_confirmed: false }],
    url: 'https://www.igdb.com/games/harbor-lights' }],
};
const data = R.enrich(D.datasets({ games }, null, native), { games }, null);
const index = buildIndex(data, D, R, TODAY, game => cardDate(game, D));
const names = result => result.games.map(game => game.name);

function catalogCount(term) {
  const filters = new FilterState('all', TODAY, D, R, new URLSearchParams());
  filters.configure({ minimum: ['0', '5000'], sort: ['date', 'followers', 'name', 'newest'], period: ['', 'future', 'past'], language: ['', 'tchinese'] });
  filters.state.term = term;
  return selectCatalog(data, filters, D, R, new Set()).items.length;
}

test('names that start with the words come first, then names that contain them, each by how close the date is', () => {
  const kingdom = searchIndex(index, 'kingdom');
  assert.deepEqual(names(kingdom), ['天空王國', '王國保衛戰 6：重啟', '遙遠王國', 'Mykingdomcraft']);
  assert.equal(kingdom.gameCount, 4);
  assert.equal(kingdom.games[1].sub, 'Kingdom Rush 6: Genesis TD');
  assert.deepEqual(kingdom.games[1].subParts, [{ text: 'Kingdom', hit: true }, { text: ' Rush 6: Genesis TD', hit: false }]);
  assert.deepEqual(names(searchIndex(index, '王國')), ['王國保衛戰 6：重啟', '天空王國', '遙遠王國']);
});

test('width, case and spacing do not change a match', () => {
  assert.equal(normalize('ＫＩＮＧＤＯＭ　 Rush'), 'kingdom rush');
  assert.deepEqual(names(searchIndex(index, ' ＫＩＮＧＤＯＭ ')), names(searchIndex(index, 'kingdom')));
});

test('a number that is a Steam AppID puts that game first and marks it exact', () => {
  const result = searchIndex(index, '4259190');
  assert.equal(result.games[0].appid, '4259190');
  assert.equal(result.games[0].exact, true);
  assert.deepEqual(result.games[0].titleParts, [{ text: '王國保衛戰 6：重啟', hit: false }]);
  assert.equal(searchIndex(index, '6').games.some(game => game.exact), false);
});

test('games show at most six rows while the count says how many match', () => {
  const echo = searchIndex(index, 'echo');
  assert.equal(echo.games.length, LIMITS.games);
  assert.equal(echo.gameCount, 8);
});

test('TAGs match their label or Steam name, with how many games carry them', () => {
  const open = searchIndex(index, '開放');
  assert.deepEqual(open.tags.map(tag => [tag.label, tag.count]), [['開放世界', 2], ['開放世界生存製作', 1]]);
  assert.equal(open.tags[0].url, './explore.html?tag=Open+World');
  assert.deepEqual(open.games, []);
  assert.deepEqual(searchIndex(index, 'open world').tags.map(tag => tag.key), ['Open World', 'Open World Survival Craft']);
  assert.equal(searchIndex(index, 'a').tags.length <= LIMITS.tags, true);
  assert.deepEqual(popularTags(index, 2).map(tag => tag.key), ['Puzzle', 'Action']);
});

test('「看全部 N 筆」 counts exactly what 全部遊戲 shows for the same words', () => {
  for (const term of ['kingdom', '王國', '開放', 'Open World', '4259190', 'echo', '港灣', '不存在']) {
    const result = searchIndex(index, term);
    assert.equal(result.pageCount, catalogCount(term), term);
    assert.equal(result.allURL, `./games.html?${new URLSearchParams({ q: term })}`);
  }
});

test('rows carry the platform chips, date, release state and interest', () => {
  const [rush] = searchIndex(index, '王國保衛戰').games;
  assert.deepEqual(rush.chips, [{ label: 'Steam', family: 'steam' }]);
  assert.equal(rush.date, '2026-09-24');
  assert.equal(rush.status, '已上市');
  assert.equal(rush.interest, '8,570 人關注');
  assert.equal(rush.url, './game.html?appid=4259190');
  const [harbor] = searchIndex(index, '港灣').games;
  assert.deepEqual(harbor.chips, [{ label: 'PS5', family: 'playstation' }]);
  assert.equal(harbor.interest, 'IGDB 40 hypes');
  assert.equal(harbor.status, '10 天後');
  assert.match(harbor.url, /igdb=99/);
});

test('release state and highlighting', () => {
  assert.deepEqual(releaseStatus(TODAY, TODAY), { status: '今天', kind: 'today' });
  assert.deepEqual(releaseStatus(TODAY, '2026-10-11'), { status: '3 天後', kind: 'upcoming' });
  assert.deepEqual(releaseStatus(TODAY, '2026-10-07'), { status: '已上市', kind: 'released' });
  assert.deepEqual(highlight('Kingdom Rush', 'KING'), [{ text: 'King', hit: true }, { text: 'dom Rush', hit: false }]);
  assert.deepEqual(highlight('Echo', ''), [{ text: 'Echo', hit: false }]);
  assert.deepEqual(searchIndex(null, 'kingdom').games, []);
  assert.equal(searchIndex(index, '   ').gameCount, 0);
});

function memory() {
  const map = new Map();
  return { getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key), map };
}

test('recent searches stay on the device: newest first, no repeats, at most five', () => {
  const storage = memory();
  rememberSearch('王國', storage);
  rememberSearch('Kingdom', storage);
  assert.deepEqual(rememberSearch(' kingdom ', storage), ['kingdom', '王國']);
  for (const term of ['a', 'b', 'c', 'd', 'e']) rememberSearch(term, storage);
  assert.deepEqual(readRecent(storage), ['e', 'd', 'c', 'b', 'a']);
  assert.equal(readRecent(storage).length, RECENT_LIMIT);
  assert.deepEqual(rememberSearch('  ', storage), ['e', 'd', 'c', 'b', 'a']);
  assert.deepEqual(forgetSearch('c', storage), ['e', 'd', 'b', 'a']);
  assert.deepEqual(clearRecent(storage), []);
  assert.equal(storage.map.size, 0);
  storage.setItem('game-trend-radar:search:recent:v1', '{broken');
  assert.deepEqual(readRecent(storage), []);
  const locked = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  assert.deepEqual(rememberSearch('王國', locked), ['王國']);
});
