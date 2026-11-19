// The game page's media, news, heat and info sections, rendered by the shipped
// detail module against the small test DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const D = require('../src/domain/index.mjs').RadarData;
const R = require('../src/features/discovery/index.js').RadarDiscovery;
const { FakeElement: Element, createDocument, vueGlobals } = require('./support/fake-dom.cjs');
const { bundle } = require('./support/bundle.cjs');
const html = readFileSync(join(__dirname, '..', 'game.html'), 'utf8');
const profile = bundle('src/features/detail/index.js', 'RadarDetail');
const fixture = name => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'site-data', name), 'utf8'));
const point = (at, followers) => ({ at, followers, source: 'steam_community' });

async function display(search, files, options = {}) {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => {
    const element = new Element(); element.id = match[1]; return [match[1], element];
  }));
  for (const id of ['gameSave', 'gameSaveMobile']) {
    const label = new Element('span'); label.setAttribute('data-save-label', ''); elements.get(id).append(label);
  }
  elements.get('allRelatedTags').dataset.tag = '';
  const requests = [];
  const document = createDocument({
    getElementById: id => elements.get(id) || null,
    querySelectorAll: selector => selector === '[data-game-save]' ? [elements.get('gameSave'), elements.get('gameSaveMobile')]
      : selector === '[data-game-steam]' ? [elements.get('gameSteam'), elements.get('gameSteamMobile')]
      : selector === '.game-tag-panel .tag-option' ? [elements.get('allRelatedTags')]
      : selector === '#gameTags button' ? elements.get('gameTags').querySelectorAll('button') : [],
    dispatchEvent() { return true; },
  });
  const memory = new Map();
  const local = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
  const location = { search, origin: 'https://example.test', href: `https://example.test/game.html${search}` };
  const window = { localStorage: local, sessionStorage: { getItem: () => null, setItem() {} }, location,
    addEventListener() {}, removeEventListener() {} };
  const storage = {
    loadNintendo: async () => files.nintendo || { schema_version: 1, generated_at: '2026-11-18T00:00:00Z', games: [] },
    loadSources: async () => ({ catalog: files.catalog || null, preview: null }),
    loadGame: async () => files.catalog?.games?.[0] || null,
    loadMedia: async appid => { requests.push(`media/${appid}`); return files.media || null; },
    readJSON: async path => {
      requests.push(path.replace('./data/', ''));
      return { './data/growth.json': files.growth, './data/activity.json': files.activity,
        './data/twitch_series/index.json': files.twitch }[path] ?? null;
    },
  };
  const context = vm.createContext({
    document, window, location, localStorage: local, sessionStorage: window.sessionStorage, URL, URLSearchParams, Intl, Date,
    Number, Set, Map, setTimeout: () => 0, clearTimeout() {}, queueMicrotask, console: { error() {}, warn() {} },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    ...vueGlobals,
  });
  vm.runInContext(await profile, context);
  context.RadarDetail.initGameDetail({ document, window, location, data: { ...D, todayInTaipei: () => options.today },
    today: options.today, storage, discovery: R });
  for (let turn = 0; turn < 12; turn++) await new Promise(resolve => setImmediate(resolve));
  return { e: elements, document, requests };
}

const steamFiles = () => {
  const row = { appid: 3926930, name: "Poopy's Playland", followers: 6000, follower_checked_at: '2026-11-15T03:00:00Z',
    release_start: '2026-12-10', release_date_verified_at: '2026-11-01T02:00:00Z' };
  return {
    catalog: { version: 3, generated_at: '2026-11-18T00:00:00Z', games: [row] },
    media: fixture('media/3926930.json'),
    growth: { version: 1, games: [{ appid: 3926930, history: [point('2026-11-01T03:00:00Z', 5800),
      point('2026-11-08T03:00:00Z', 5900), point('2026-11-15T03:00:00Z', 6000)] }] },
    activity: { version: 1, events: [] },
    twitch: { schema_version: 1, games: { 123456: { name: 'Poopy', aliases: [], steam_appids: ['3926930'],
      peak_viewer_count: 12345, sample_count: 40, first_hour: '2026-11-10T00:00:00Z', last_hour: '2026-11-15T00:00:00Z',
      tracking_status: 'active' } } },
  };
};

test('a Steam game shows its hero art, media gallery, radar news, heat and the fixed info card', async () => {
  const files = steamFiles();
  const { e, requests, document } = await display('?appid=3926930', files, { today: '2026-11-19' });
  assert.equal(e.get('detailPage').hidden, false);
  assert.equal(document.body.dataset.gameHero, 'on');
  assert.ok(requests.includes('media/3926930'));
  // Hero: Steam's library hero, the big release date and its countdown.
  assert.equal(e.get('gameHeroImage').src, files.media.hero_image);
  assert.equal(e.get('gameHeroArt').dataset.state, 'loading');
  assert.equal(e.get('gameHeroDate').textContent, '2026.12.10');
  assert.equal(e.get('gameHeroWeekday').textContent, '（四）');
  assert.equal(e.get('gameHeroCountdown').textContent, '還有 21 天');
  assert.equal(e.get('gameState').textContent, 'UPCOMING · STEAM');
  // Media: the trailer and two screenshots side by side, four more below, the rest behind a button.
  assert.equal(e.get('gameMedia').hidden, false);
  assert.equal(e.get('gameMediaStage').dataset.layout, 'trailer-shots');
  assert.equal(e.get('gameMediaStage').children.length, 2);
  assert.equal(e.get('gameShots').children.length, 4);
  assert.equal(e.get('gameShotsMore').hidden, false);
  assert.equal(e.get('gameShotsMore').textContent, `看全部 ${files.media.screenshots.length} 張截圖`);
  e.get('gameShotsMore').click();
  assert.equal(e.get('gameShots').children.length, files.media.screenshots.length - 2);
  assert.equal(e.get('gameShotsMore').attributes['aria-expanded'], 'true');
  // The gallery pages through the full-size screenshots.
  e.get('gameShots').children[0].children[0].click();
  assert.equal(e.get('artDialog').open, true);
  assert.equal(e.get('artDialog').dataset.mode, 'gallery');
  assert.equal(e.get('artDialogCount').textContent, `截圖 3／${files.media.screenshots.length}`);
  assert.equal(e.get('artDialogImage').src, files.media.screenshots[2].full);
  e.get('artNext').click();
  assert.equal(e.get('artDialogCount').textContent, `截圖 4／${files.media.screenshots.length}`);
  e.get('artPrev').click();
  e.get('artPrev').click();
  assert.equal(e.get('artDialogCount').textContent, `截圖 2／${files.media.screenshots.length}`);
  // News, newest first; the media date comes from the media file itself.
  assert.equal(e.get('gameNews').hidden, false);
  const news = e.get('gameNewsList').children.map(item => item.children[1].textContent);
  assert.deepEqual(news.slice(0, 2), [`Steam 影音更新：主視覺、${files.media.screenshots.length} 張截圖、1 支預告`, '關注數來到 6,000 人，7 天 +100']);
  assert.ok(news.includes('Steam 確認完整發售日：2026 年 12 月 10 日'));
  // Heat: the latest measurement, its change and a chart of the measured days.
  assert.equal(e.get('gameFollowers').textContent, '6,000');
  assert.equal(e.get('gameHeatChanges').hidden, false);
  assert.equal(e.get('gameHeatChanges').textContent, '7 天+100');
  assert.equal(e.get('gameHeatChart').hidden, false);
  assert.match(e.get('gameHeatPlot').attributes['aria-label'], /2026\/11\/01 5,800 人，到 2026\/11\/15 6,000 人；共 3 次量測/);
  // Twitch: the archive matched by Steam AppID.
  assert.equal(e.get('gameTwitchLink').hidden, false);
  assert.equal(e.get('gameTwitchLink').href, './twitch-game.html?game=123456');
  assert.match(e.get('gameTwitchText').textContent, /最高觀看是 12,345 人/);
  assert.equal(e.get('gameTwitchStatus').dataset.state, 'active');
  // The fixed info card names the developer and publisher from the media file.
  const facts = Object.fromEntries(e.get('gameFacts').children.map(row => [row.children[0].textContent, row.children[1].textContent]));
  assert.equal(facts['開發商'], 'EmilJoes Games');
  assert.ok(facts['平台']);
  assert.equal(e.get('gameSteamInfo').textContent, '前往 Steam 商店↗');
});

test('without Steam media the hero keeps the theme color and the media section stays hidden', async () => {
  const files = { ...steamFiles(), media: null, twitch: { games: {} } };
  const { e } = await display('?appid=3926930', files, { today: '2026-11-18' });
  assert.equal(e.get('detailPage').hidden, false);
  assert.equal(e.get('gameHeroArt').dataset.state, 'empty');
  assert.equal(e.get('gameHeroImage').hidden, true);
  assert.equal(e.get('gameMedia').hidden, true);
  assert.equal(e.get('gameTwitchLink').hidden, true);
  assert.equal(e.get('gameTwitchStatus').textContent, '目前：還沒有紀錄');
  assert.ok(!e.get('gameNewsList').textContent.includes('影音'));
});

test('a console game never requests Steam media and matches Twitch only by an exact name', async () => {
  const nintendo = { schema_version: 1, generated_at: '2026-11-18T00:00:00Z', games: [{ id: 'igdb:366896', igdb_id: 366896,
    name_en: "Fire Emblem: Fortune's Weave", hypes: 45, platforms: [{ id: 508, name: 'Nintendo Switch 2', code: 'NS2' }],
    known_platforms: [{ id: 508, name: 'Nintendo Switch 2', code: 'NS2' }], platform_data_complete: true,
    exclusivity: { status: 'confirmed', platform: 'NS2', source: 'Nintendo', url: 'https://www.nintendo.com/us/store/products/fire-emblem-fortunes-weave-switch-2/' },
    releases: [{ date: '2027-01-15', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB' }],
    url: 'https://www.igdb.com/games/fire-emblem-fortunes-weave', sexual_content_screened: true, checked_at: '2026-10-03T15:56:37Z' }] };
  const twitch = { games: { 77: { name: "fire emblem: fortune's weave", aliases: [], steam_appids: [], peak_viewer_count: 9000,
    sample_count: 3, first_hour: '2026-11-01T00:00:00Z', last_hour: '2026-11-02T00:00:00Z', tracking_status: 'active' } } };
  const { e, requests } = await display('?igdb=366896&date=2027-01-15', { nintendo, twitch, activity: { events: [] } }, { today: '2026-11-18' });
  assert.equal(e.get('detailPage').hidden, false);
  assert.ok(!requests.some(request => request.startsWith('media/')));
  assert.equal(e.get('gameMedia').hidden, true);
  assert.equal(e.get('gameHeroArt').dataset.state, 'empty');
  assert.equal(e.get('gameHeatChart').hidden, true);
  assert.equal(e.get('gameGrowthLink').hidden, true);
  assert.equal(e.get('gameTwitchLink').href, './twitch-game.html?game=77');
  assert.equal(e.get('gameState').textContent, 'UPCOMING · NINTENDO SWITCH 2');
  assert.equal(e.get('gameHeroDate').textContent, '2027.01.15');
});
