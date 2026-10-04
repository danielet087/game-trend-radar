const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const D = require('../assets/radar-data-v1.js');
const R = require('../assets/radar-discovery-v1.js');
const profile = readFileSync(join(__dirname, '..', 'assets/radar-game-detail-v1.js'), 'utf8');
const html = readFileSync(join(__dirname, '..', 'game.html'), 'utf8');

class Element {
  constructor(tag = 'div') { this.tagName = tag; this.dataset = {}; this.style = {}; this.attributes = {}; this.children = []; this.listeners = {}; this.hidden = false; this._text = ''; }
  set textContent(value) { this._text = String(value ?? ''); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent || '').join(''); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(key, listener) { this.listeners[key] = listener; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  remove() {}
  querySelector(selector) { return selector === '[data-save-label]' ? this.saveLabel : this.children.find(child => child.tagName === selector) || null; }
  get classList() { return { add() {}, remove() {} }; }
}
function sample(overrides = {}) {
  return {
    schema_version: 1, generated_at: '2026-10-03T15:56:37Z',
    games: [{ id: 'igdb:366896', igdb_id: 366896, name_en: "Fire Emblem: Fortune's Weave", hypes: 45,
      platforms: [{ id: 508, name: 'Nintendo Switch 2', code: 'NS2' }],
      known_platforms: [{ id: 508, name: 'Nintendo Switch 2', code: 'NS2' }],
      platform_data_complete: true,
      exclusivity: { status: 'confirmed', platform: 'NS2', source: 'Nintendo', url: 'https://www.nintendo.com/us/store/products/fire-emblem-fortunes-weave-switch-2/' },
      releases: [{ date: '2027-01-15', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB' }],
      url: 'https://www.igdb.com/games/fire-emblem-fortunes-weave',
      nintendo_url: 'https://www.nintendo.com/us/store/products/fire-emblem-fortunes-weave-switch-2/',
      sexual_content_screened: true, checked_at: '2026-10-03T15:56:37Z', ...overrides }],
  };
}
async function display(search, nintendo = sample(), catalog = null, stored = [], options = {}) {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
  for (const id of ['gameSave', 'gameSaveMobile']) elements.get(id).saveLabel = new Element('span');
  elements.get('allRelatedTags').dataset.tag = '';
  const storage = new Map([['game-trend-radar:saved:v1', JSON.stringify(stored)]]);
  const savedCount = new Element('span');
  const calls = { steam: 0, nintendo: 0, sources: 0 };
  const document = {
    body: new Element('body'), documentElement: new Element('html'), referrer: '', title: '',
    getElementById: id => elements.get(id), createElement: tag => new Element(tag),
    querySelectorAll: selector => selector === '[data-game-save]' ? [elements.get('gameSave'), elements.get('gameSaveMobile')]
      : selector === '[data-game-steam]' ? [elements.get('gameSteam'), elements.get('gameSteamMobile')]
      : selector === '[data-saved-count]' ? [savedCount]
      : selector === '.game-tag-panel .tag-option' ? [elements.get('allRelatedTags')] : [],
  };
  const window = {
    RadarData: { ...D, todayInTaipei: () => '2026-10-04' }, RadarDiscovery: R,
    RadarStorage: {
      loadNintendo: async () => {
        calls.nintendo++;
        if (options.nintendoFailure) throw new Error('Nintendo data unavailable');
        if (options.nintendoPending) return options.nintendoPending;
        return nintendo;
      },
      loadSources: async () => { calls.sources++; return { catalog, preview: null }; },
      loadGame: async () => { calls.steam++; return catalog?.games?.[0] || null; },
    },
    RadarCompare: { ids: () => [] }, RadarArtwork: { load: (_img, _game, callbacks = {}) => callbacks.onExhausted?.() },
    addEventListener() {},
  };
  const context = vm.createContext({
    document, window, location: { search, origin: 'https://example.test', href: `https://example.test/game.html${search}` },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    sessionStorage: { getItem: () => null }, URL, URLSearchParams, Intl, Date, Number, Set, Map,
    setTimeout: () => 0, clearTimeout() {}, console: { error() {} },
  });
  vm.runInContext(profile, context);
  await new Promise(resolve => setImmediate(resolve));
  return { elements, document, calls, storage, savedCount };
}

test('Nintendo detail uses its own public source, hypes and verified native exclusive label', async () => {
  const { elements: e, document, calls } = await display('?igdb=366896&date=2027-01-15');
  assert.equal(calls.steam, 0);
  assert.equal(calls.nintendo, 1);
  assert.equal(e.get('detailPage').hidden, false);
  assert.equal(e.get('gameFollowers').textContent, '45');
  assert.equal(e.get('gameInterestCaption').textContent, 'IGDB hypes · 發售前關注數');
  assert.equal(e.get('gameAppId').textContent, 'IGDB ID：366896');
  assert.equal(e.get('gameCompare').hidden, true);
  assert.equal(e.get('gameLanguageContent').hidden, true);
  assert.equal(e.get('gamePlatformLabel').textContent, 'NS2 獨佔');
  assert.match(e.get('gamePlatformDates').textContent, /NS2 · 2027\/01\/15 · 全球/);
  assert.match(e.get('gameReleaseNote').textContent, /IGDB.*尚未另行確認台灣上市日/);
  assert.match(e.get('gameSteam').href, /^https:\/\/www\.nintendo\.com\//);
  assert.doesNotMatch(e.get('gameSteam').textContent, /Steam/);
  assert.equal(document.body.dataset.gameSource, 'nintendo');
});

test('Nintendo date route selects the requested native-platform release and saves a stable IGDB identity', async () => {
  const payload = sample({
    platforms: [{ id: 130, code: 'NS', name: 'Nintendo Switch' }, { id: 508, code: 'NS2', name: 'Nintendo Switch 2' }],
    exclusivity: { status: 'multi_platform' },
    releases: [{ date: '2027-01-15', platform: 'NS', precision: 'day', region: 'japan', source: 'IGDB' },
      { date: '2027-03-19', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB' }],
  });
  const { elements: e, storage } = await display('?igdb=366896&date=2027-03-19', payload, null, [632950]);
  assert.equal(e.get('gameDate').textContent, '2027/03/19');
  assert.equal(e.get('gamePlatformLabel').textContent, 'NS／NS2・多平台');
  assert.equal(e.get('gamePlatformDates').children.length, 2);
  e.get('gameSave').listeners.click({ currentTarget: e.get('gameSave') });
  assert.deepEqual(JSON.parse(storage.get('game-trend-radar:saved:v1')), [632950, 'igdb:366896']);
  assert.equal(e.get('gameSave').attributes['aria-pressed'], 'true');
});

test('invalid IGDB ID or date does not fall through to a Steam request', async () => {
  for (const search of ['?igdb=0&appid=632950', '?igdb=366896&date=2027-02-30']) {
    const { elements: e, calls } = await display(search);
    assert.deepEqual(calls, { steam: 0, nintendo: 0, sources: 0 });
    assert.equal(e.get('detailPage').hidden, true);
    assert.match(e.get('detailStatusMessage').textContent, /有效的 IGDB ID 或發售日期/);
  }
});

test('unqualified Nintendo records remain unavailable on direct detail routes', async () => {
  for (const overrides of [{ hypes: 29 }, { hypes: null }, { sexual_content_screened: false }, { releases: [{ date: '2027-01-15', platform: 'NS2', precision: 'year' }] }]) {
    const { elements: e } = await display('?igdb=366896', sample(overrides));
    assert.equal(e.get('detailPage').hidden, true);
    assert.match(e.get('detailStatusTitle').textContent, /不在公開清單/);
  }
});

test('existing Steam detail route retains Followers, external Steam link and numeric saved identity', async () => {
  const catalog = { version: 3, generated_at: '2026-10-03T15:56:37Z', games: [{ appid: 632950, name: 'Steam Game', followers: 6000, release_start: '2027-01-15' }] };
  const { elements: e, calls, storage } = await display('?appid=632950', sample(), catalog, ['igdb:366896']);
  assert.equal(calls.steam, 1);
  assert.equal(calls.nintendo, 1);
  assert.equal(e.get('detailPage').hidden, false);
  assert.equal(e.get('gameFollowers').textContent, '6,000');
  assert.equal(e.get('gameInterestCaption').textContent, 'Steam Followers · 非願望清單數');
  assert.equal(e.get('gameReleaseLabel').textContent, '預定發售・台灣');
  assert.equal(e.get('gameCompare').hidden, false);
  assert.equal(e.get('gamePlatforms').hidden, true);
  assert.equal(e.get('gameSteam').href, 'https://store.steampowered.com/app/632950/');
  e.get('gameSave').listeners.click({ currentTarget: e.get('gameSave') });
  assert.deepEqual(JSON.parse(storage.get('game-trend-radar:saved:v1')), ['igdb:366896', 632950]);
});

const steamCatalog = () => ({ version: 3, generated_at: '2026-10-03T15:56:37Z',
  games: [{ appid: 632950, name: 'Steam Game', followers: 6000, release_start: '2027-01-15' }] });
const crossPlatformSample = () => sample({
  exclusivity: { status: 'multi_platform' },
  known_platforms: [{ id: 6, name: 'PC' }, { id: 508, name: 'Nintendo Switch 2', code: 'NS2' }],
  websites: [{ url: 'https://store.steampowered.com/app/632950/Steam_Game/' }],
  releases: [{ date: '2027-03-19', platform: 'NS2', precision: 'day', region: 'japan', source: 'IGDB' }],
});

test('merged Steam detail preserves its Steam date, separate hypes and Nintendo dates, and existing IGDB saves', async () => {
  const { elements: e, storage, savedCount } = await display('?appid=632950', crossPlatformSample(), steamCatalog(), ['igdb:366896', 632950, 632951]);
  assert.equal(e.get('gameDate').textContent, '2027/01/15');
  assert.equal(e.get('gameReleaseLabel').textContent, '預定發售・台灣');
  assert.equal(e.get('gameFollowers').textContent, '6,000');
  assert.equal(e.get('gameInterestCaption').textContent, 'Steam Followers · 非願望清單數');
  assert.equal(e.get('gamePlatforms').hidden, false);
  assert.equal(e.get('gamePlatformLabel').textContent, 'Steam／NS2・多平台');
  assert.match(e.get('gamePlatformDates').textContent, /Steam · 2027\/01\/15 · 台灣/);
  assert.match(e.get('gamePlatformDates').textContent, /NS2 · 2027\/03\/19 · 日本/);
  assert.match(e.get('gamePlatformNote').textContent, /IGDB hypes 45/);
  assert.match(e.get('gameFootnote').textContent, /Steam Followers 分別呈現/);
  assert.equal(e.get('gameSteam').href, 'https://store.steampowered.com/app/632950/');
  assert.equal(e.get('gameSave').attributes['aria-pressed'], 'true');
  assert.equal(savedCount.textContent, '2');
  e.get('gameSave').listeners.click({ currentTarget: e.get('gameSave') });
  assert.deepEqual(JSON.parse(storage.get('game-trend-radar:saved:v1')), [632951]);
  assert.equal(savedCount.textContent, '1');
  e.get('gameSave').listeners.click({ currentTarget: e.get('gameSave') });
  assert.deepEqual(JSON.parse(storage.get('game-trend-radar:saved:v1')), [632951, 632950]);
  assert.equal(savedCount.textContent, '2');
});

test('tag recommendation counts treat separate platform release dates as one game', async () => {
  const catalog = steamCatalog();
  catalog.games[0].tags = ['Action'];
  catalog.games.push({ appid: 632951, name: 'Another Game', followers: 7000,
    release_start: '2027-01-16', tags: ['Action'] });
  const nintendo = crossPlatformSample();
  nintendo.games[0].websites = [{ url: 'https://store.steampowered.com/app/632951/' }];
  const { elements: e } = await display('?appid=632950', nintendo, catalog);
  assert.equal(e.get('gameTags').children[0].children[1].textContent, '1 款');
  assert.match(e.get('recommendationSummary').textContent, /串起 1 款/);
  assert.equal(e.get('gameRelatedGrid').children.length, 1);
});

test('both merged Steam event links and existing IGDB event links retain the requested Nintendo release context', async () => {
  for (const search of ['?appid=632950&date=2027-03-19', '?igdb=366896&date=2027-03-19']) {
    const { elements: e } = await display(search, crossPlatformSample(), steamCatalog());
    assert.equal(e.get('detailPage').hidden, false);
    assert.equal(e.get('gameDate').textContent, '2027/03/19');
    assert.equal(e.get('gameReleaseLabel').textContent, '預定發售・日本');
    assert.equal(e.get('gameReleaseNote').hidden, false);
    assert.match(e.get('gameReleaseNote').textContent, /尚未另行確認台灣上市日/);
    assert.equal(e.get('gameFollowers').textContent, '6,000');
    assert.match(e.get('gamePlatformNote').textContent, /IGDB hypes 45/);
  }
});

test('optional Nintendo failure leaves the Steam profile usable without unconfirmed platform metadata', async () => {
  const { elements: e } = await display('?appid=632950', null, steamCatalog(), [], { nintendoFailure: true });
  assert.equal(e.get('detailPage').hidden, false);
  assert.equal(e.get('gameDate').textContent, '2027/01/15');
  assert.equal(e.get('gamePlatforms').hidden, true);
  assert.equal(e.get('gameFollowers').textContent, '6,000');
  assert.equal(e.get('gameSteam').href, 'https://store.steampowered.com/app/632950/');
});

test('Steam first paint does not wait for Nintendo and later enrichment keeps the selected Steam date', async () => {
  let finishNintendo;
  const nintendoPending = new Promise(resolve => { finishNintendo = resolve; });
  const { elements: e } = await display('?appid=632950', null, steamCatalog(), [], { nintendoPending });
  assert.equal(e.get('detailPage').hidden, false);
  assert.equal(e.get('gameDate').textContent, '2027/01/15');
  assert.equal(e.get('gamePlatforms').hidden, true);
  finishNintendo(crossPlatformSample());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(e.get('gamePlatforms').hidden, false);
  assert.equal(e.get('gameDate').textContent, '2027/01/15');
  assert.match(e.get('gamePlatformDates').textContent, /NS2 · 2027\/03\/19/);
});

test('invalid merged Steam event dates stop before any source request', async () => {
  const { elements: e, calls } = await display('?appid=632950&date=2027-02-30');
  assert.deepEqual(calls, { steam: 0, nintendo: 0, sources: 0 });
  assert.equal(e.get('detailPage').hidden, true);
  assert.match(e.get('detailStatusMessage').textContent, /有效的 Steam AppID 或發售日期/);
});

const officialRelease = (overrides = {}) => ({
  date: '2027-01-16', platform: 'NS2', precision: 'day', region: 'taiwan',
  source: 'official_registry', date_basis: 'taiwan_official_calendar_day',
  source_date: '2027-01-15', source_timestamp: 1800057600, source_region: 'worldwide',
  time_zone: 'Asia/Taipei', timestamp_taipei_date: '2027-01-15', timezone_status: 'taiwan_official_date',
  taiwan_release_confirmed: true,
  official_source_url: 'https://www.nintendo.com/tw/schedule/', official_source_name: 'Nintendo 台灣',
  ...overrides,
});

test('official Taiwan dates show their official source and regional correction in the detail page', async () => {
  const { elements: e } = await display('?igdb=366896&date=2027-01-16', sample({ releases: [officialRelease()] }));
  assert.equal(e.get('gameDate').textContent, '2027/01/16');
  assert.equal(e.get('gameReleaseLabel').textContent, '預定發售・台灣');
  assert.match(e.get('gameReleaseNote').textContent, /來源：Nintendo 台灣。已確認台灣上市日/);
  assert.match(e.get('gameReleaseNote').textContent, /原始 IGDB 日期為 2027\/01\/15，已依台灣官方日期修正/);
  assert.doesNotMatch(e.get('gameReleaseNote').textContent, /尚未另行確認|08:00|IGDB 平台發售資料/);
  const date = e.get('gamePlatformDates').children[0];
  assert.match(date.textContent, /NS2 · 2027\/01\/16 · 台灣/);
  const source = date.children[0].children[1];
  assert.equal(source.tagName, 'a');
  assert.equal(source.textContent, 'Nintendo 台灣');
  assert.equal(source.href, 'https://www.nintendo.com/tw/schedule/');
  assert.equal(source.rel, 'noopener noreferrer');
});

test('audited IGDB dates show unconfirmed Taiwan provenance without inventing an unlock time', async () => {
  const release = { date: '2027-01-15', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB',
    source_date: '2027-01-15', source_timestamp: 1800057600, source_region: 'worldwide',
    time_zone: 'Asia/Taipei', timestamp_taipei_date: '2027-01-15', timezone_status: 'same_calendar_day', taiwan_release_confirmed: false };
  const { elements: e } = await display('?igdb=366896', sample({ releases: [release] }));
  assert.match(e.get('gameReleaseNote').textContent, /尚未另行確認台灣上市日.*Asia\/Taipei.*不代表確切解鎖時間/);
  assert.match(e.get('gamePlatformDates').textContent, /NS2 · 2027\/01\/15 · 全球.*尚未另行確認台灣上市日/);
  assert.doesNotMatch(e.get('gamePlatformDates').textContent, /08:00|已確認台灣上市日/);
});

test('official release evidence sanitizes its source link before claiming Taiwan confirmation', async () => {
  const { elements: e } = await display('?igdb=366896', sample({
    releases: [officialRelease({ official_source_url: 'javascript:alert(1)' })],
  }));
  assert.match(e.get('gameReleaseNote').textContent, /尚未另行確認台灣上市日/);
  assert.doesNotMatch(e.get('gameReleaseNote').textContent, /已確認台灣上市日/);
  assert.equal(e.get('gamePlatformDates').children[0].children[0].children[1].tagName, 'span');
});

test('Konami official Nintendo release evidence keeps its confirmed Taiwan source', async () => {
  const sourceURL = 'https://www.konami.com/games/castlevania/belmonts_curse/tc/';
  const { elements: e } = await display('?igdb=366896', sample({ releases: [officialRelease({
    official_source_url: sourceURL, official_source_name: 'KONAMI 亞洲',
  })] }));
  assert.match(e.get('gameReleaseNote').textContent, /來源：KONAMI 亞洲。已確認台灣上市日/);
  assert.doesNotMatch(e.get('gameReleaseNote').textContent, /尚未另行確認|IGDB 平台發售資料/);
  assert.equal(e.get('gamePlatformDates').children[0].children[0].children[1].href, sourceURL);
});

test('merged profiles retain official Nintendo dates and source separately from the Steam date', async () => {
  const nintendo = crossPlatformSample();
  nintendo.games[0].releases = [officialRelease()];
  const { elements: e } = await display('?appid=632950', nintendo, steamCatalog());
  assert.equal(e.get('gameDate').textContent, '2027/01/15');
  assert.match(e.get('gamePlatformDates').textContent, /Steam · 2027\/01\/15 · 台灣.*NS2 · 2027\/01\/16 · 台灣.*Nintendo 台灣.*已確認台灣上市日/);
  assert.equal(e.get('gamePlatformDates').children.length, 2);
});
