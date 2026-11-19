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
// The shipped detail page (src/features/detail), bundled once and run as a fresh page per display.
const profile = bundle('src/features/detail/index.js', 'RadarDetail');

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
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => {
    const element = new Element(); element.id = match[1]; return [match[1], element];
  }));
  for (const id of ['gameSave', 'gameSaveMobile']) {
    const label = new Element('span'); label.setAttribute('data-save-label', ''); elements.get(id).append(label);
  }
  elements.get('allRelatedTags').dataset.tag = '';
  const storage = new Map([['game-trend-radar:saved:v1', JSON.stringify(stored)]]);
  const savedCount = new Element('span');
  const calls = { steam: 0, nintendo: 0, sources: 0 };
  const document = createDocument({
    getElementById: id => elements.get(id) || null,
    querySelectorAll: selector => selector === '[data-game-save]' ? [elements.get('gameSave'), elements.get('gameSaveMobile')]
      : selector === '[data-game-steam]' ? [elements.get('gameSteam'), elements.get('gameSteamMobile')]
      : selector === '[data-saved-count]' ? [savedCount]
      : selector === '.game-tag-panel .tag-option' ? [elements.get('allRelatedTags')]
      : selector === '#gameTags button' ? elements.get('gameTags').querySelectorAll('button') : [],
    dispatchEvent() { return true; },
  });
  const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  const sessionStorage = { getItem: () => null, setItem() {} };
  const location = { search, origin: 'https://example.test', href: `https://example.test/game.html${search}` };
  const window = { localStorage, sessionStorage, location, addEventListener() {}, removeEventListener() {} };
  const radarStorage = {
    loadNintendo: async () => {
      calls.nintendo++;
      if (options.nintendoFailure) throw new Error('Nintendo data unavailable');
      if (options.nintendoPending) return options.nintendoPending;
      return nintendo;
    },
    loadSources: async () => { calls.sources++; return { catalog, preview: null }; },
    loadGame: async () => { calls.steam++; return catalog?.games?.[0] || null; },
    readJSON: async () => null,
  };
  const context = vm.createContext({
    document, window, location, localStorage, sessionStorage, URL, URLSearchParams, Intl, Date, Number, Set, Map,
    setTimeout: () => 0, clearTimeout() {}, queueMicrotask, console: { error() {}, warn() {} },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    ...vueGlobals,
  });
  vm.runInContext(await profile, context);
  context.RadarDetail.initGameDetail({
    document, window, location, data: { ...D, todayInTaipei: () => '2026-10-04' }, today: '2026-10-04',
    storage: radarStorage, discovery: R,
    artwork: { load: (_img, _game, callbacks = {}) => callbacks.onExhausted?.() },
  });
  for (let turn = 0; turn < 10; turn++) await new Promise(resolve => setImmediate(resolve));
  return { elements, document, calls, storage, savedCount };
}

// 平台版本: one row per tracked platform, and one collapsed list of every source.
const versionRows = e => e.get('gameVersionRows').children;
const versionDates = e => versionRows(e).map(row => [row.dataset.platform, row.dataset.date]);
const versionRow = (e, code) => versionRows(e).find(row => row.dataset.platform === code);
const versionCell = (row, name) => row.children.find(cell => cell.classList.contains(`game-version-${name}`));
const languageChips = row => versionCell(row, 'languages').children[0].children.map(chip => chip.textContent);
const shopLink = (e, code) => versionCell(versionRow(e, code), 'store').children[0];
const sourceItems = e => e.get('gameVersionSourceList').children;
const sourceText = e => e.get('gameVersionSourceList').textContent;
const sourceLinks = e => e.get('gameVersionSourceList').querySelectorAll('a');
const sourceNote = (e, prefix) => sourceItems(e).find(item => item.textContent.startsWith(prefix));
const titleChips = e => e.get('gamePlatforms').children.map(chip => chip.textContent);
const pageText = e => ['gameHeroLabel', 'gameHeroNote', 'gamePlatforms', 'gameVersionRows', 'gameVersionSourceList']
  .map(id => e.get(id).textContent).join(' ');

test('Nintendo detail uses its own public source, hypes and verified native exclusive label', async () => {
  const { elements: e, document, calls } = await display('?igdb=366896&date=2027-01-15');
  assert.deepEqual(versionDates(e), [['NS2', '2027-01-15']]);
  assert.equal(calls.steam, 0);
  assert.equal(calls.nintendo, 1);
  assert.equal(e.get('detailPage').hidden, false);
  assert.equal(e.get('gameFollowers').textContent, '45');
  assert.equal(e.get('gameInterestCaption').textContent, 'IGDB hypes · 發售前關注數');
  assert.equal(e.get('gameAppId').textContent, 'IGDB ID：366896');
  for (const removed of ['gameCompare', 'gameTagPreview', 'heroTags', 'gameJump', 'gameReleaseDates', 'gamePlatformDates',
    'gamePlatformSupport', 'gameLanguageContent', 'gameState', 'gameArt']) {
    assert.equal(e.has(removed), false);
  }
  // The title card: one date, the release state and the official exclusive label.
  assert.deepEqual(titleChips(e), ['即將上市', 'NS2 獨佔']);
  assert.equal(e.get('gameHeroLabel').textContent, '預定發售・台灣時間');
  assert.equal(e.get('gameHeroDate').textContent, '2027.01.15');
  assert.equal(e.get('gameHeroWeekday').textContent, '（五）');
  assert.equal(e.get('gameHeroCountdown').textContent, '還有 103 天');
  assert.equal(e.get('gameHeroNote').textContent, '全球日期，台灣上市日待確認');
  // 平台版本: the NS2 row, and where its date and (missing) languages come from.
  const ns2 = versionRow(e, 'NS2');
  assert.equal(ns2.dataset.selected, 'true');
  assert.equal(versionCell(ns2, 'platform').textContent, 'NS2 獨佔Nintendo Switch 2 版');
  assert.equal(versionCell(ns2, 'dates').textContent, '2027/01/15（五）全球日期・台灣待確認');
  assert.deepEqual(languageChips(ns2), ['語言待確認']);
  assert.match(sourceText(e), /Nintendo Switch 2 版發售日：來源 IGDB。依全球發售資料顯示；來源僅提供日期，尚未另行確認台灣上市日/);
  assert.match(sourceText(e), /Nintendo Switch 2 版中文：尚無可確認的官方語言資料。/);
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
  assert.equal(e.get('gameHeroDate').textContent, '2027.03.19');
  assert.equal(e.get('gameHeroLabel').textContent, 'Nintendo Switch 2 版發售・台灣時間');
  assert.deepEqual(titleChips(e), ['即將上市', 'NS', 'NS2']);
  assert.deepEqual(versionDates(e), [['NS', '2027-01-15'], ['NS2', '2027-03-19']]);
  assert.equal(versionRow(e, 'NS2').dataset.selected, 'true');
  assert.equal(versionRow(e, 'NS').dataset.selected, undefined);
  // The other version counts down to its own date.
  assert.equal(versionCell(versionRow(e, 'NS'), 'dates').textContent, '2027/01/15（五）日本日期・台灣待確認還有 103 天');
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
  assert.equal(e.get('gameHeroLabel').textContent, '預定發售・台灣時間');
  assert.equal(e.get('gameHeroNote').hidden, true);
  assert.equal(e.has('gameCompare'), false);
  assert.equal(e.get('gamePlatforms').hidden, false);
  assert.deepEqual(titleChips(e), ['即將上市', 'Steam']);
  assert.deepEqual(versionDates(e), [['Steam', '2027-01-15']]);
  assert.equal(versionCell(versionRow(e, 'Steam'), 'dates').textContent, '2027/01/15（五）');
  assert.match(sourceText(e), /Steam 版發售日：來源 Steam 台灣商店。/);
  assert.equal(e.get('gameSteam').href, 'https://store.steampowered.com/app/632950/');
  assert.equal(e.get('gameSteam').target, '_blank');
  e.get('gameSave').listeners.click({ currentTarget: e.get('gameSave') });
  assert.deepEqual(JSON.parse(storage.get('game-trend-radar:saved:v1')), ['igdb:366896', 632950]);
  assert.equal(e.get('gameSave').attributes['aria-pressed'], 'true');
  assert.equal(e.get('gameSaveMobile').attributes['aria-pressed'], 'true');
  e.get('gameSaveMobile').listeners.click({ currentTarget: e.get('gameSaveMobile') });
  assert.deepEqual(JSON.parse(storage.get('game-trend-radar:saved:v1')), ['igdb:366896']);
  assert.equal(e.get('gameSave').attributes['aria-pressed'], 'false');
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
  assert.deepEqual(versionDates(e), [['Steam', '2027-01-15'], ['NS2', '2027-03-19']]);
  assert.equal(versionRow(e, 'Steam').dataset.selected, 'true');
  assert.equal(versionCell(versionRow(e, 'Steam'), 'dates').textContent, '2027/01/15（五）');
  assert.equal(versionCell(versionRow(e, 'NS2'), 'dates').textContent, '2027/03/19（五）日本日期・台灣待確認還有 166 天');
  assert.match(sourceText(e), /Nintendo Switch 2 版發售日：來源 IGDB。依日本發售資料顯示；來源僅提供日期，尚未另行確認台灣上市日/);
  assert.equal(e.get('gameHeroDate').textContent, '2027.01.15');
  assert.equal(e.get('gameHeroLabel').textContent, '最早發售・台灣時間');
  assert.equal(e.get('gameHeroCountdown').textContent, '還有 103 天');
  assert.equal(e.get('gameHeroNote').textContent, '各平台日期不同，見平台版本');
  assert.equal(e.get('gameFollowers').textContent, '6,000');
  assert.equal(e.get('gameInterestCaption').textContent, 'Steam Followers · 非願望清單數');
  assert.deepEqual(titleChips(e), ['即將上市', 'Steam', 'NS2']);
  // The console interest number stays separate from Steam Followers.
  assert.equal(e.get('gameHeatConsole').hidden, false);
  assert.match(e.get('gameHeatConsole').textContent, /^主機版本：IGDB 45 hypes.*不跟 Steam 合併/);
  assert.match(e.get('gameFootnote').textContent, /Steam Followers 分別呈現/);
  // Two stores: the buy button opens 平台版本, where each row links to its own shop.
  assert.equal(e.get('gameSteam').href, '#gameVersions');
  assert.equal(e.get('gameSteam').textContent, '選擇平台購買↓');
  assert.equal(e.get('gameSteamMobile').textContent, '選擇平台購買 ↓');
  assert.equal(e.get('gameSteam').target, undefined);
  assert.equal(e.get('gameSteam').rel, undefined);
  assert.equal(shopLink(e, 'Steam').href, 'https://store.steampowered.com/app/632950/');
  assert.equal(shopLink(e, 'Steam').target, '_blank');
  assert.equal(shopLink(e, 'Steam').rel, 'noopener noreferrer');
  assert.match(shopLink(e, 'NS2').href, /^https:\/\/www\.nintendo\.com\//);
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
    assert.deepEqual(versionDates(e), [['Steam', '2027-01-15'], ['NS2', '2027-03-19']]);
    assert.equal(versionRow(e, 'NS2').dataset.selected, 'true');
    assert.equal(versionRow(e, 'Steam').dataset.selected, undefined);
    assert.equal(e.get('detailPage').hidden, false);
    assert.equal(e.get('gameHeroDate').textContent, '2027.03.19');
    assert.equal(e.get('gameHeroLabel').textContent, 'Nintendo Switch 2 版發售・台灣時間');
    assert.equal(e.get('gameHeroNote').hidden, false);
    assert.equal(e.get('gameHeroNote').textContent, '各平台日期不同，見平台版本・日本日期，台灣上市日待確認');
    assert.equal(versionCell(versionRow(e, 'Steam'), 'dates').textContent, '2027/01/15（五）還有 103 天');
    assert.equal(e.get('gameFollowers').textContent, '6,000');
    assert.match(e.get('gameHeatConsole').textContent, /IGDB 45 hypes/);
  }
});

test('optional Nintendo failure leaves the Steam profile usable without unconfirmed platform metadata', async () => {
  const { elements: e } = await display('?appid=632950', null, steamCatalog(), [], { nintendoFailure: true });
  assert.equal(e.get('detailPage').hidden, false);
  assert.equal(e.get('gameHeroDate').textContent, '2027.01.15');
  assert.equal(e.get('gamePlatforms').hidden, false);
  assert.deepEqual(titleChips(e), ['即將上市', 'Steam']);
  assert.equal(e.get('gameVersions').hidden, false);
  assert.deepEqual(versionDates(e), [['Steam', '2027-01-15']]);
  assert.doesNotMatch(sourceText(e), /Nintendo|IGDB/);
  assert.equal(e.get('gameHeatConsole').hidden, true);
  assert.equal(e.get('gameFollowers').textContent, '6,000');
  assert.equal(e.get('gameSteam').href, 'https://store.steampowered.com/app/632950/');
});

test('Steam first paint does not wait for Nintendo and later enrichment keeps the selected Steam date', async () => {
  let finishNintendo;
  const nintendoPending = new Promise(resolve => { finishNintendo = resolve; });
  const { elements: e } = await display('?appid=632950', null, steamCatalog(), [], { nintendoPending });
  assert.equal(e.get('detailPage').hidden, false);
  assert.equal(e.get('gameHeroDate').textContent, '2027.01.15');
  assert.equal(e.get('gamePlatforms').hidden, false);
  assert.deepEqual(titleChips(e), ['即將上市', 'Steam']);
  assert.deepEqual(versionDates(e), [['Steam', '2027-01-15']]);
  finishNintendo(crossPlatformSample());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(e.get('gamePlatforms').hidden, false);
  assert.equal(e.get('gameHeroDate').textContent, '2027.01.15');
  assert.equal(e.get('gameHeroLabel').textContent, '最早發售・台灣時間');
  assert.deepEqual(titleChips(e), ['即將上市', 'Steam', 'NS2']);
  assert.deepEqual(versionDates(e), [['Steam', '2027-01-15'], ['NS2', '2027-03-19']]);
  assert.equal(versionRow(e, 'Steam').dataset.selected, 'true');
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
  assert.equal(e.get('gameHeroDate').textContent, '2027.01.16');
  assert.equal(e.get('gameHeroLabel').textContent, '預定發售・台灣時間');
  // A verified Taiwan announcement needs no caveat in the title card.
  assert.equal(e.get('gameHeroNote').hidden, true);
  assert.equal(versionCell(versionRow(e, 'NS2'), 'dates').textContent, '2027/01/16（六）台灣官方');
  assert.match(sourceText(e), /Nintendo Switch 2 版發售日：來源 Nintendo 台灣。已確認台灣上市日（Asia\/Taipei）；日期依台灣官方公告。/);
  assert.match(sourceText(e), /原始 IGDB 日期為 2027\/01\/15，已依台灣官方日期修正/);
  assert.doesNotMatch(sourceText(e), /尚未另行確認|08:00|IGDB 平台發售資料/);
  const [source] = sourceLinks(e);
  assert.equal(source.tagName, 'a');
  assert.equal(source.textContent, 'Nintendo 台灣');
  assert.equal(source.href, 'https://www.nintendo.com/tw/schedule/');
  assert.equal(source.rel, 'noopener noreferrer');
  assert.equal(source.target, '_blank');
});

test('Hong Kong official Nintendo dates show their real region and source without claiming Taiwan confirmation', async () => {
  const hk = officialRelease({ date: '2027-01-16', region: 'hong_kong', source_timestamp: 1799971200,
    date_basis: 'hong_kong_official_calendar_day', timezone_status: 'hong_kong_official_date',
    taiwan_release_confirmed: false, official_source_url: 'https://www.nintendo.com/hk/schedule',
    official_source_name: 'Nintendo 香港', official_verified_at: '2026-10-04T15:00:00Z' });
  const { elements: e } = await display('?igdb=366896', sample({ releases: [hk] }));
  assert.equal(e.get('gameHeroDate').textContent, '2027.01.16');
  assert.equal(e.get('gameHeroNote').textContent, '香港官方日期，台灣上市日待確認');
  assert.equal(versionCell(versionRow(e, 'NS2'), 'dates').textContent, '2027/01/16（六）香港官方');
  assert.match(sourceText(e), /Nintendo Switch 2 版發售日：來源 Nintendo 香港。已確認香港官方發售日（UTC\+8，與台灣同時區）。/);
  assert.match(sourceText(e), /官方僅提供日期，未另行推算解鎖時間/);
  assert.doesNotMatch(pageText(e), /已確認台灣上市日|台灣官方|08:00/);
  const [source] = sourceLinks(e);
  assert.equal(source.tagName, 'a');
  assert.equal(source.textContent, 'Nintendo 香港');
  assert.equal(source.href, hk.official_source_url);
  const { elements: timed } = await display('?igdb=366896', sample({ releases: [{ ...hk,
    official_release_time_utc: '2027-01-15T18:00:00Z' }] }));
  assert.equal(timed.get('gameHeroDate').textContent, '2027.01.16');
  assert.equal(timed.get('gameHeroDate').dateTime, '2027-01-15T18:00:00.000Z');
  assert.equal(timed.get('gameHeroNote').textContent, '02:00（台灣時間）・香港官方日期，台灣上市日待確認');
  assert.equal(versionCell(versionRow(timed, 'NS2'), 'dates').textContent, '2027/01/16（六） 02:00香港官方');
  assert.match(sourceText(timed), /已確認香港官方發售日.*台灣時間 2027\/01\/16 02:00（UTC\+8），依官方發售時間換算/);
});

test('audited IGDB dates show unconfirmed Taiwan provenance without inventing an unlock time', async () => {
  const release = { date: '2027-01-15', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB',
    source_date: '2027-01-15', source_timestamp: 1800057600, source_region: 'worldwide',
    time_zone: 'Asia/Taipei', timestamp_taipei_date: '2027-01-15', timezone_status: 'same_calendar_day', taiwan_release_confirmed: false };
  const { elements: e } = await display('?igdb=366896', sample({ releases: [release] }));
  assert.equal(e.get('gameHeroLabel').textContent, '預定發售・台灣時間');
  assert.equal(e.get('gameHeroDate').dateTime, '2027-01-15');
  assert.equal(e.get('gameHeroNote').textContent, '全球日期，台灣上市日待確認');
  assert.equal(versionCell(versionRow(e, 'NS2'), 'dates').textContent, '2027/01/15（五）全球日期・台灣待確認');
  assert.match(sourceText(e), /來源僅提供日期，尚未另行確認台灣上市日，無法推算台灣解鎖時間/);
  assert.doesNotMatch(sourceText(e), /日期已核對台灣時區/);
  assert.doesNotMatch(pageText(e), /08:00|已確認台灣上市日/);
});

const unifiedRelease = (overrides = {}) => ({
  date: '2027-01-16', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB',
  source_date: '2027-01-15', source_timestamp: Date.parse('2027-01-15T18:00:00Z') / 1000,
  source_region: 'worldwide', date_basis: 'igdb_timestamp_taipei', timezone_status: 'converted_to_taipei',
  time_zone: 'Asia/Taipei', timestamp_taipei_date: '2027-01-16', taiwan_release_confirmed: false,
  official_source_url: null, official_source_name: null, official_verified_at: null,
  official_product_id: null, official_concept_id: null, official_release_time_utc: null, ...overrides,
});

test('all console versions display unified IGDB Taipei days without synthetic unlock clocks', async () => {
  for (const platform of ['NS', 'NS2', 'PS5']) {
    const payload = sample({ platforms: [{ id: D.nativePlatformIDs[platform], code: platform }],
      known_platforms: [{ id: D.nativePlatformIDs[platform], code: platform }],
      releases: [unifiedRelease({ platform })] });
    const { elements: e } = await display('?igdb=366896&date=2027-01-16', payload);
    assert.equal(e.get('gameHeroLabel').textContent, '預定發售・台灣時間');
    assert.equal(e.get('gameHeroDate').textContent, '2027.01.16');
    assert.equal(e.get('gameHeroDate').dateTime, '2027-01-16');
    assert.equal(e.get('gameHeroWeekday').textContent, '（六）');
    assert.equal(e.get('gameHeroNote').textContent, 'IGDB 日期，台灣上市日待確認');
    assert.deepEqual(versionDates(e), [[platform, '2027-01-16']]);
    assert.equal(versionCell(versionRow(e, platform), 'dates').textContent, '2027/01/16（六）IGDB 日期');
    assert.match(sourceText(e), /發售日：來源 IGDB 平台發售資料。依 IGDB 全球發售資料換算為台灣時區（Asia\/Taipei／UTC\+8）的日期。/);
    assert.match(sourceText(e), /原始 IGDB 日期為 2027\/01\/15，換算後為 2027\/01\/16/);
    assert.match(sourceText(e), /不視為實際解鎖時間/);
    assert.doesNotMatch(e.get('gameHeroDate').textContent + e.get('gameHeroNote').textContent +
      e.get('gameVersionRows').textContent, /02:00|08:00|00:00/);
    assert.doesNotMatch(e.get('gameHeroLabel').textContent, /官方|待確認/);
  }
});

test('date-only IGDB rows clearly retain calendar precision without a synthetic timezone conversion', async () => {
  const payload = sample({ releases: [unifiedRelease({ date: '2027-01-15', date_basis: 'igdb_calendar_day',
    timezone_status: 'date_only', source_timestamp: null, timestamp_taipei_date: null })] });
  const { elements: e } = await display('?igdb=366896', payload);
  assert.equal(e.get('gameHeroDate').textContent, '2027.01.15');
  assert.equal(e.get('gameHeroDate').dateTime, '2027-01-15');
  assert.equal(e.get('gameHeroNote').textContent, 'IGDB 日期，台灣上市日待確認');
  assert.equal(versionCell(versionRow(e, 'NS2'), 'dates').textContent, '2027/01/15（五）IGDB 日期');
  assert.match(sourceText(e), /依 IGDB 全球發售日期顯示。來源僅提供年月日，未提供可換算的時刻/);
  assert.doesNotMatch(sourceText(e), /換算為台灣時區|08:00|00:00/);
});

test('unified console days remain separate from Steam dates and route to one merged profile', async () => {
  const payload = crossPlatformSample();
  payload.games[0].releases = [unifiedRelease()];
  for (const search of ['?appid=632950', '?appid=632950&date=2027-01-16']) {
    const { elements: e } = await display(search, payload, steamCatalog());
    const selectedConsole = search.includes('date=');
    assert.deepEqual(versionDates(e), [['Steam', '2027-01-15'], ['NS2', '2027-01-16']]);
    assert.equal(versionRow(e, selectedConsole ? 'NS2' : 'Steam').dataset.selected, 'true');
    assert.equal(e.get('gameHeroDate').textContent, selectedConsole ? '2027.01.16' : '2027.01.15');
    assert.equal(e.get('gameHeroLabel').textContent, selectedConsole ? 'Nintendo Switch 2 版發售・台灣時間' : '最早發售・台灣時間');
    assert.equal(e.get('gameHeroNote').textContent, selectedConsole
      ? '各平台日期不同，見平台版本・IGDB 日期，台灣上市日待確認' : '各平台日期不同，見平台版本');
    assert.match(versionCell(versionRow(e, 'Steam'), 'dates').textContent, /^2027\/01\/15（五）/);
    assert.match(versionCell(versionRow(e, 'NS2'), 'dates').textContent, /^2027\/01\/16（六）IGDB 日期/);
    assert.equal(shopLink(e, 'Steam').href, 'https://store.steampowered.com/app/632950/');
  }
});

test('official release evidence sanitizes its source link before claiming Taiwan confirmation', async () => {
  const { elements: e } = await display('?igdb=366896', sample({
    releases: [officialRelease({ official_source_url: 'javascript:alert(1)' })],
  }));
  assert.match(sourceText(e), /尚未另行確認台灣上市日/);
  assert.doesNotMatch(pageText(e), /已確認台灣上市日/);
  assert.doesNotMatch(e.get('gameVersionRows').textContent, /台灣官方/);
  assert.equal(sourceLinks(e).length, 0);
  assert.equal(versionCell(versionRow(e, 'NS2'), 'dates').textContent, '2027/01/16（六）台灣日期待確認');
  assert.equal(e.get('gameHeroNote').textContent, '台灣上市日待確認');
});

test('Konami official Nintendo release evidence keeps its confirmed Taiwan source', async () => {
  const sourceURL = 'https://www.konami.com/games/castlevania/belmonts_curse/tc/';
  const { elements: e } = await display('?igdb=366896', sample({ releases: [officialRelease({
    official_source_url: sourceURL, official_source_name: 'KONAMI 亞洲',
  })] }));
  assert.match(sourceText(e), /Nintendo Switch 2 版發售日：來源 KONAMI 亞洲。已確認台灣上市日/);
  assert.doesNotMatch(sourceText(e), /尚未另行確認|IGDB 平台發售資料/);
  assert.equal(sourceLinks(e)[0].href, sourceURL);
  assert.equal(versionCell(versionRow(e, 'NS2'), 'dates').textContent, '2027/01/16（六）台灣官方');
});

test('merged profiles retain official Nintendo dates and source separately from the Steam date', async () => {
  const nintendo = crossPlatformSample();
  nintendo.games[0].releases = [officialRelease()];
  const { elements: e } = await display('?appid=632950', nintendo, steamCatalog());
  assert.equal(e.get('gameHeroDate').textContent, '2027.01.15');
  assert.deepEqual(versionDates(e), [['Steam', '2027-01-15'], ['NS2', '2027-01-16']]);
  assert.equal(versionCell(versionRow(e, 'NS2'), 'dates').textContent, '2027/01/16（六）台灣官方還有 104 天');
  assert.match(sourceText(e), /Steam 版發售日：來源 Steam 台灣商店。.*Nintendo Switch 2 版發售日：來源 Nintendo 台灣。已確認台灣上市日/);
  nintendo.games[0].releases = [
    { date: '2027-01-15', platform: 'NS2', precision: 'day', region: 'japan', source: 'IGDB' },
    officialRelease({ date: '2027-01-15' }),
  ];
  const { elements: same } = await display('?appid=632950', nintendo, steamCatalog());
  assert.deepEqual(versionDates(same), [['Steam', '2027-01-15'], ['NS2', '2027-01-15']]);
  // The verified Taiwan date replaces the unconfirmed IGDB date of the same version.
  assert.equal(versionCell(versionRow(same, 'NS2'), 'dates').textContent, '2027/01/15（五）台灣官方');
  assert.equal(same.get('gameHeroNote').textContent, '兩個平台同一天');
  assert.equal(sourceItems(same).filter(item => item.textContent.startsWith('Nintendo Switch 2 版發售日')).length, 1);
  assert.doesNotMatch(sourceText(same), /日本/);
  const { elements: native } = await display('?igdb=366896', nintendo);
  assert.deepEqual(versionDates(native), [['NS2', '2027-01-15']]);
  assert.equal(native.get('gameHeroLabel').textContent, '預定發售・台灣時間');
  assert.equal(native.get('gameHeroNote').hidden, true);
});

function languageSupport(fields = {}) {
  return { status: 'confirmed', region: 'taiwan', complete: true,
    languages: { tchinese: false, schinese: true, english: true, chinese: true },
    supported_languages: [{ code: 'zh-Hans', name: '簡體中文' }, { code: 'en', name: '英文' }],
    source: 'Nintendo 台灣', source_url: 'https://www.nintendo.com/tw/games/switch2/example/',
    checked_at: '2026-10-04T05:00:00Z', evidence_type: 'official_product_languages', ...fields };
}

test('merged language detail shows Steam and NS2 support separately, including confirmed absence of Traditional Chinese', async () => {
  const catalog = steamCatalog();
  catalog.games[0].language_support = { tchinese: true, schinese: true };
  const payload = crossPlatformSample();
  payload.games[0].platform_language_support = { NS2: languageSupport() };
  const { elements: e } = await display('?appid=632950', payload, catalog);
  assert.deepEqual(languageChips(versionRow(e, 'Steam')), ['繁中', '簡中']);
  assert.deepEqual(languageChips(versionRow(e, 'NS2')), ['簡中']);
  const ns2 = versionCell(versionRow(e, 'NS2'), 'languages');
  assert.equal(ns2.children[1].textContent, '共 2 種語言');
  assert.doesNotMatch(ns2.textContent, /繁中/);
  assert.match(sourceText(e), /Steam 版中文：Steam 商店標示同時支援繁中與簡中/);
  assert.match(sourceText(e), /Nintendo Switch 2 版中文：台灣版本，來源 Nintendo 台灣。已公布語言：簡體中文、英文。官方完整語言列表未列繁體中文。/);
  assert.equal(sourceLinks(e).find(link => link.textContent === 'Nintendo 台灣').href, 'https://www.nintendo.com/tw/games/switch2/example/');
  assert.match(sourceText(e), /各平台、地區版本的語言分開確認；中文名稱不代表遊戲支援中文。/);
});

test('partial generic Chinese never invents a script or unsupported language claim', async () => {
  const row = languageSupport({ status: 'partial', complete: false,
    languages: { tchinese: null, schinese: null, english: null, chinese: true },
    supported_languages: [{ code: 'zh', name: '中文' }], evidence_type: 'official_chinese_unspecified' });
  const { elements: e } = await display('?igdb=366896', sample({ platform_language_support: { NS2: row } }));
  assert.deepEqual(versionDates(e), [['NS2', '2027-01-15']]);
  assert.deepEqual(languageChips(versionRow(e, 'NS2')), ['中文（字體待確認）']);
  assert.match(sourceText(e), /Nintendo Switch 2 版中文：台灣版本，來源 Nintendo 台灣。已公布語言：中文。官方僅標示中文，尚未區分繁體／簡體字體。/);
  assert.doesNotMatch(versionCell(versionRow(e, 'NS2'), 'languages').textContent, /繁中|簡中|無中文/);
  assert.doesNotMatch(sourceText(e), /未列繁體|未列簡體|繁中|簡中/);
});

test('separate NS and NS2 versions retain platform-specific official language sources', async () => {
  const payload = sample({ platforms: [{ id: 130, code: 'NS' }, { id: 508, code: 'NS2' }],
    releases: [{ platform: 'NS', date: '2027-01-15', precision: 'day', source: 'IGDB' },
      { platform: 'NS2', date: '2027-01-15', precision: 'day', source: 'IGDB' }],
    platform_language_support: { NS: languageSupport({ region: 'north_america', source: 'Nintendo 北美',
      source_url: 'https://www.nintendo.com/us/store/products/example/' }), NS2: languageSupport() } });
  const { elements: e } = await display('?igdb=366896', payload);
  assert.deepEqual(versionDates(e), [['NS', '2027-01-15'], ['NS2', '2027-01-15']]);
  assert.match(sourceNote(e, 'Nintendo Switch 版中文：').textContent, /北美版本，來源 Nintendo 北美。.*台灣販售版本的語言是否相同仍待確認/);
  assert.match(sourceNote(e, 'Nintendo Switch 2 版中文：').textContent, /台灣版本，來源 Nintendo 台灣/);
  assert.doesNotMatch(sourceNote(e, 'Nintendo Switch 2 版中文：').textContent, /台灣販售版本.*待確認/);
  assert.equal(sourceLinks(e).find(link => link.textContent === 'Nintendo 北美').href, 'https://www.nintendo.com/us/store/products/example/');
  // IGDB rows that name no region say so instead of inventing one.
  assert.equal(e.get('gameHeroNote').textContent, '兩個平台同一天・地區未確認，台灣上市日待確認');
  assert.equal(versionCell(versionRow(e, 'NS'), 'dates').textContent, '2027/01/15（五）地區未確認・台灣待確認');
  assert.match(sourceText(e), /Nintendo Switch 版、Nintendo Switch 2 版發售日：來源 IGDB。來源未標示發售地區；/);
});

test('pure Steam detail keeps only the Steam version and its language source', async () => {
  const { elements: e } = await display('?appid=632950', null, steamCatalog());
  assert.deepEqual(versionDates(e), [['Steam', '2027-01-15']]);
  assert.deepEqual(languageChips(versionRow(e, 'Steam')), ['語言待確認']);
  assert.match(sourceText(e), /Steam 版中文：Steam 尚未提供足以確認的語言資訊/);
  assert.doesNotMatch(sourceText(e), /Nintendo|PlayStation|各平台、地區版本的語言分開確認/);
  assert.equal(e.get('gameVersionsAlso').hidden, true);
});

function edition(fields = {}) {
  return { type: 'base_plus_dlc', label: '本體＋Re Mind DLC', title: 'KINGDOM HEARTS III + Re Mind',
    product_id: '70010000117242', region: 'hong_kong',
    source_url: 'https://ec.nintendo.com/HK/zh/titles/70010000117242',
    checked_at: '2026-10-04T08:00:00Z', ...fields };
}

test('every merged game entry point keeps the game title and shows the edition, official title and regional source in its version', async () => {
  const payload = crossPlatformSample();
  payload.games[0].platform_editions = { NS2: edition() };
  const catalog = steamCatalog();
  catalog.games[0].name = 'KINGDOM HEARTS III';
  catalog.games[0].display_name = '王國之心 III';
  for (const search of ['?appid=632950&date=2027-01-15', '?appid=632950&date=2027-03-19',
    '?igdb=366896&date=2027-01-15', '?igdb=366896&date=2027-03-19']) {
    const { elements: e, document } = await display(search, payload, catalog);
    assert.equal(e.get('detailPage').hidden, false);
    const native = search.includes('2027-03-19');
    // An edition never renames the page (it once read "NS2 KINGDOM HEARTS III + Re Mind (DLC)").
    assert.equal(e.get('gameTitle').textContent, '王國之心 III');
    assert.equal(e.get('gameEnglish').textContent, 'KINGDOM HEARTS III');
    assert.equal(e.get('gameEnglish').hidden, false);
    assert.equal(document.title, '王國之心 III｜遊戲資訊・Game Trend Radar');
    assert.equal(e.get('gameHeroDate').textContent, native ? '2027.03.19' : '2027.01.15');
    assert.equal(versionRow(e, native ? 'NS2' : 'Steam').dataset.selected, 'true');
    assert.deepEqual(titleChips(e), ['即將上市', 'Steam', 'NS2']);
    assert.deepEqual(versionDates(e), [['Steam', '2027-01-15'], ['NS2', '2027-03-19']]);
    assert.doesNotMatch(versionRow(e, 'Steam').textContent, /Re Mind|原版|本體/);
    assert.equal(versionCell(versionRow(e, 'NS2'), 'platform').textContent,
      'NS2Nintendo Switch 2 版本體＋Re Mind DLC商店名稱：KINGDOM HEARTS III + Re Mind');
    const note = sourceNote(e, 'Nintendo Switch 2 版販售版本：');
    assert.match(note.textContent, /官方商品名稱「KINGDOM HEARTS III \+ Re Mind」，香港版本，來源 Nintendo 官方商品頁。此平台發售的是包含本體與追加內容的版本。.*台灣販售版本是否相同仍待確認/);
    const link = note.children[0];
    assert.equal(link.href, 'https://ec.nintendo.com/HK/zh/titles/70010000117242');
    assert.equal(link.rel, 'noopener noreferrer');
    assert.equal(link.target, '_blank');
    for (const item of sourceItems(e).filter(item => item.textContent.includes('中文：')))
      assert.doesNotMatch(item.textContent, /Re Mind|官方商品名稱/);
  }
});

test('Nintendo-only expansion and Deluxe releases keep their own confirmed edition without inventing a Steam base version', async () => {
  const variants = [
    edition({ type: 'base_plus_expansion', label: '本體＋Dark Arisen 擴充版', title: "Dragon's Dogma 2: Dark Arisen",
      product_id: '70010000116366', region: 'australia', source_url: 'https://www.nintendo.com/au/games/nintendo-switch-2/dragons-dogma-2-dark-arisen/' }),
    edition({ type: 'deluxe', label: 'Deluxe 版', title: 'Resident Evil 2: Deluxe Edition', product_id: '70010000114443',
      region: 'australia', source_url: 'https://ec.nintendo.com/AU/en/titles/70010000114443' }),
  ];
  for (const version of variants) {
    const { elements: e, document } = await display('?igdb=366896&date=2027-01-15', sample({ platform_editions: { NS2: version } }));
    assert.equal(e.get('detailPage').hidden, false);
    assert.equal(e.get('gameTitle').textContent, "Fire Emblem: Fortune's Weave");
    assert.equal(document.title, "Fire Emblem: Fortune's Weave｜遊戲資訊・Game Trend Radar");
    assert.doesNotMatch(e.get('gamePlatforms').textContent, /本體|Dark Arisen|Deluxe/);
    assert.equal(versionCell(versionRow(e, 'NS2'), 'platform').textContent,
      `NS2 獨佔Nintendo Switch 2 版${version.label}商店名稱：${version.title}`);
    assert.equal(versionCell(versionRow(e, 'NS2'), 'dates').textContent, '2027/01/15（五）全球日期・台灣待確認');
    const note = sourceNote(e, 'Nintendo Switch 2 版販售版本：').textContent;
    assert.ok(note.includes(`官方商品名稱「${version.title}」，澳洲版本，來源 Nintendo 官方商品頁。`));
    assert.ok(note.includes(version.type === 'deluxe' ? '此平台發售的是上述 Deluxe 版本。' : '此平台發售的是包含本體與追加內容的版本。'));
    assert.match(note, /發售日期對應上述版本與內容組合。版本內容依此地區商品頁確認；台灣販售版本是否相同仍待確認。/);
    assert.doesNotMatch(e.get('gameVersionRows').textContent + sourceText(e), /Steam|重製|高畫質|原版/);
  }
});

test('a NS2 content bundle does not become a label on an ordinary NS release or its language source', async () => {
  const payload = sample({ platforms: [{ id: 130, code: 'NS' }, { id: 508, code: 'NS2' }],
    known_platforms: [{ id: 130, code: 'NS' }, { id: 508, code: 'NS2' }], exclusivity: { status: 'multi_platform' },
    releases: [{ platform: 'NS', date: '2027-01-15', precision: 'day', source: 'IGDB' },
      { platform: 'NS2', date: '2027-03-19', precision: 'day', source: 'IGDB' }],
    platform_editions: { NS2: edition() } });
  const { elements: e } = await display('?igdb=366896&date=2027-01-15', payload);
  assert.equal(e.get('gameHeroDate').textContent, '2027.01.15');
  assert.equal(e.get('gameTitle').textContent, "Fire Emblem: Fortune's Weave");
  assert.deepEqual(versionDates(e), [['NS', '2027-01-15'], ['NS2', '2027-03-19']]);
  assert.doesNotMatch(versionRow(e, 'NS').textContent, /本體|Re Mind|DLC/);
  assert.match(versionCell(versionRow(e, 'NS2'), 'platform').textContent, /本體＋Re Mind DLC/);
  assert.deepEqual(sourceItems(e).filter(item => item.textContent.includes('販售版本：'))
    .map(item => item.textContent.split('販售版本：')[0]), ['Nintendo Switch 2 版']);
  for (const item of sourceItems(e).filter(item => item.textContent.includes('中文：')))
    assert.doesNotMatch(item.textContent, /本體|Re Mind|DLC/);
});

test('missing or unverified edition records never produce an edition or base-version claim', async () => {
  for (const entry of [null, edition({ source_url: 'https://nintendo.com.evil.test/product' }),
    edition({ type: 'remaster' }), edition({ checked_at: '2026-10-04T08:00:00' })]) {
    const { elements: e } = await display('?igdb=366896', sample({ platform_editions: { NS2: entry } }));
    assert.doesNotMatch(e.get('gamePlatforms').textContent, /本體|Re Mind|原版|重製/);
    assert.doesNotMatch(e.get('gameVersionRows').textContent + sourceText(e), /官方商品名稱|商店名稱|販售版本|本體|Re Mind|原版|重製/);
    assert.equal(e.get('gameTitle').textContent, "Fire Emblem: Fortune's Weave");
  }
});

test('detail recommendations show the candidate release edition in its title and original English subtitle', async () => {
  const payload = sample({ name_en: 'Resident Evil 2', name_zh_tw: '惡靈古堡 2', tags: ['Action'],
    platform_editions: { NS2: edition({ type: 'deluxe', label: 'Deluxe 版', title: 'Resident Evil 2: Deluxe Edition',
      product_id: '70010000114443', region: 'australia', source_url: 'https://ec.nintendo.com/AU/en/titles/70010000114443' }) } });
  const catalog = steamCatalog(); catalog.games[0].tags = ['Action'];
  const { elements: e } = await display('?appid=632950', payload, catalog);
  assert.equal(e.get('gameRelatedGrid').children.length, 1);
  const card = e.get('gameRelatedGrid').children[0];
  assert.equal(card.href, './game.html?igdb=366896&date=2027-01-15');
  const names = card.children[1].children[0];
  assert.equal(names.className, 'related-names');
  assert.equal(names.children[0].textContent, '惡靈古堡 2（Deluxe 版）');
  assert.equal(names.children[0].title, '惡靈古堡 2（Deluxe 版）');
  assert.equal(names.children[1].textContent, 'Resident Evil 2: Deluxe Edition');
  assert.equal(names.children[1].title, 'Resident Evil 2: Deluxe Edition');
});


const ps5StoreURL = 'https://store.playstation.com/zh-hant-tw/concept/10009999';
const ps5Sample = (overrides = {}) => sample({
  name_en: 'PS5 Future Game', name_zh_tw: 'PS5 未來遊戲', nintendo_url: null,
  platforms: [{ id: 167, name: 'PlayStation 5', code: 'PS5' }],
  known_platforms: [{ id: 167, name: 'PlayStation 5', code: 'PS5' }],
  exclusivity: { status: 'listed_only', platform: 'PS5' },
  playstation_url: ps5StoreURL,
  releases: [officialRelease({ platform: 'PS5', source_timestamp: 1799971200, official_source_url: ps5StoreURL,
    official_source_name: 'PlayStation 台灣', official_concept_id: '10009999', official_product_id: null,
    official_release_time_utc: '2027-01-15T16:00:00Z', official_verified_at: '2026-10-04T13:00:00Z' })],
  ...overrides,
});
const ps5LanguageSupport = (overrides = {}) => languageSupport({
  source: 'PlayStation 台灣', source_url: ps5StoreURL, product_id: '10009999', ...overrides,
});

test('PS5 native detail uses its PlayStation shop and confirmed Taiwan release without Nintendo wording', async () => {
  const { elements: e, document, storage } = await display('?igdb=366896&date=2027-01-16', ps5Sample());
  assert.equal(e.get('detailPage').hidden, false);
  assert.deepEqual(versionDates(e), [['PS5', '2027-01-16']]);
  assert.deepEqual(titleChips(e), ['即將上市', 'PS5']);
  assert.equal(versionCell(versionRow(e, 'PS5'), 'dates').textContent, '2027/01/16（六） 00:00台灣官方');
  assert.match(sourceText(e), /PlayStation 5 版發售日：來源 PlayStation 台灣。已確認台灣上市日/);
  assert.equal(e.get('gameSteam').href, ps5StoreURL);
  assert.equal(e.get('gameSteam').textContent, '前往 PlayStation 商店↗');
  assert.equal(e.get('gameSteamMobile').textContent, 'PlayStation 商店 ↗');
  assert.match(e.get('gameSteam').attributes['aria-label'], /PlayStation 商店/);
  assert.equal(shopLink(e, 'PS5').textContent, 'PlayStation 商店 ↗');
  assert.equal(shopLink(e, 'PS5').href, ps5StoreURL);
  assert.deepEqual(languageChips(versionRow(e, 'PS5')), ['語言待確認']);
  assert.match(sourceText(e), /PlayStation 5 版中文：尚無可確認的官方語言資料。/);
  assert.doesNotMatch(e.get('gameFootnote').textContent + pageText(e), /任天堂|Nintendo/);
  assert.equal(document.body.dataset.gameSource, 'nintendo');
  e.get('gameSave').listeners.click({ currentTarget: e.get('gameSave') });
  assert.deepEqual(JSON.parse(storage.get('game-trend-radar:saved:v1')), ['igdb:366896']);
});

test('Sony official release instant crosses midnight into the next Taiwan calendar day and displays the exact time', async () => {
  const source = 'https://store.playstation.com/zh-hant-tw/concept/10016571';
  const payload = ps5Sample({ name_en: 'Valor Mortis', playstation_url: source,
    releases: [officialRelease({ platform: 'PS5', date: '2026-10-14', source_date: '2026-10-13',
      source_timestamp: Date.parse('2026-10-13T00:00:00Z') / 1000, timestamp_taipei_date: '2026-10-13',
      official_source_url: source, official_source_name: 'PlayStation 台灣', official_product_id: null,
      official_concept_id: '10016571', official_release_time_utc: '2026-10-13T18:00:00Z',
      official_verified_at: '2026-10-04T14:00:00Z' })] });
  const { elements: e } = await display('?igdb=366896&date=2026-10-14', payload);
  assert.equal(e.get('gameHeroLabel').textContent, '預定發售・台灣時間');
  assert.equal(e.get('gameHeroDate').textContent, '2026.10.14');
  assert.equal(e.get('gameHeroDate').dateTime, '2026-10-13T18:00:00.000Z');
  assert.equal(e.get('gameHeroWeekday').textContent, '（三）');
  assert.equal(e.get('gameHeroCountdown').textContent, '還有 10 天');
  assert.equal(e.get('gameHeroNote').textContent, '02:00（台灣時間）');
  assert.equal(versionCell(versionRow(e, 'PS5'), 'dates').textContent, '2026/10/14（三） 02:00台灣官方');
  assert.match(sourceText(e), /台灣時間 2026\/10\/14 02:00（UTC\+8），依官方發售時間換算。官方原始時間：2026-10-13 18:00 UTC/);
});

test('merged Steam and PS5 detail keeps both versions and official shops with independent language support', async () => {
  const catalog = steamCatalog();
  catalog.games[0].language_support = { tchinese: true, schinese: true };
  const payload = ps5Sample({
    websites: [{ url: 'https://store.steampowered.com/app/632950/' }],
    known_platforms: [{ id: 6, name: 'PC' }, { id: 167, name: 'PlayStation 5', code: 'PS5' }],
    exclusivity: { status: 'multi_platform' },
    platform_language_support: { PS5: ps5LanguageSupport() },
  });
  for (const search of ['?appid=632950', '?appid=632950&date=2027-01-16', '?igdb=366896&date=2027-01-16']) {
    const { elements: e } = await display(search, payload, catalog);
    assert.deepEqual(versionDates(e), [['Steam', '2027-01-15'], ['PS5', '2027-01-16']]);
    assert.equal(versionRow(e, search.includes('date=') ? 'PS5' : 'Steam').dataset.selected, 'true');
    assert.equal(e.get('gameSteam').href, '#gameVersions');
    assert.equal(shopLink(e, 'Steam').href, 'https://store.steampowered.com/app/632950/');
    assert.equal(shopLink(e, 'PS5').href, ps5StoreURL);
    assert.equal(shopLink(e, 'PS5').rel, 'noopener noreferrer');
    assert.equal(shopLink(e, 'PS5').target, '_blank');
    // The Windows build is the Steam version, never an extra platform.
    assert.equal(e.get('gameVersionsAlso').hidden, true);
    assert.deepEqual(languageChips(versionRow(e, 'Steam')), ['繁中', '簡中']);
    assert.deepEqual(languageChips(versionRow(e, 'PS5')), ['簡中']);
    assert.match(sourceText(e), /PlayStation 5 版中文：台灣版本，來源 PlayStation 台灣。已公布語言：簡體中文、英文。官方完整語言列表未列繁體中文。/);
    assert.doesNotMatch(sourceText(e), /Nintendo/);
  }
});

test('unconfirmed PS5 language stays unknown even when Steam supports Chinese', async () => {
  const catalog = steamCatalog();
  catalog.games[0].language_support = { tchinese: true, schinese: true };
  const payload = ps5Sample({ websites: [{ url: 'https://store.steampowered.com/app/632950/' }] });
  const { elements: e } = await display('?appid=632950', payload, catalog);
  assert.deepEqual(languageChips(versionRow(e, 'Steam')), ['繁中', '簡中']);
  assert.deepEqual(languageChips(versionRow(e, 'PS5')), ['語言待確認']);
  assert.match(sourceText(e), /PlayStation 5 版中文：尚無可確認的官方語言資料。/);
});

test('PS5 evidence rejects lookalike hosts, foreign Taiwan claims and mismatched language product identity', async () => {
  for (const source_url of ['https://store.playstation.com.evil.test/zh-hant-tw/concept/10009999',
    'https://store.playstation.com/en-us/concept/10009999', 'javascript:alert(1)']) {
    const payload = ps5Sample({
      playstation_url: source_url,
      releases: [officialRelease({ platform: 'PS5', source_timestamp: 1799971200, official_source_url: source_url,
        official_source_name: 'PlayStation 台灣', official_product_id: '10009999', official_verified_at: '2026-10-04T13:00:00Z' })],
      platform_language_support: { PS5: ps5LanguageSupport({ source_url }) },
    });
    const { elements: e } = await display('?igdb=366896', payload);
    assert.equal(e.get('detailPage').hidden, true);
    assert.equal(e.get('gameTitle').textContent, '');
    assert.equal(e.get('gameSteam').href, undefined);
    assert.equal(versionRows(e).length, 0);
    assert.doesNotMatch(sourceText(e), /已確認台灣上市日/);
    assert.match(e.get('detailStatusTitle').textContent, /不在公開清單/);
  }
  const { elements: e } = await display('?igdb=366896', ps5Sample({
    platform_language_support: { PS5: ps5LanguageSupport({ product_id: '10008888' }) },
  }));
  assert.deepEqual(languageChips(versionRow(e, 'PS5')), ['語言待確認']);
  assert.match(sourceText(e), /PlayStation 5 版中文：尚無可確認的官方語言資料。/);
});

test('PS5 Deluxe edition title and product evidence stay distinct from the Steam base version', async () => {
  const product_id = 'JP0005-PPSA23593_00-APPLICATION00000';
  const source_url = `https://store.playstation.com/zh-hant-tw/product/${product_id}`;
  const payload = ps5Sample({
    websites: [{ url: 'https://store.steampowered.com/app/632950/' }],
    platform_editions: { PS5: { type: 'deluxe', label: 'Deluxe 版', title: 'PS5 Future Game Deluxe Edition',
      product_id, region: 'taiwan', source_url, checked_at: '2026-10-04T05:00:00Z' } },
  });
  for (const search of ['?appid=632950&date=2027-01-16', '?appid=632950']) {
    const { elements: e } = await display(search, payload, steamCatalog());
    assert.equal(e.get('gameTitle').textContent, 'PS5 未來遊戲');
    assert.equal(versionCell(versionRow(e, 'PS5'), 'platform').textContent,
      'PS5PlayStation 5 版Deluxe 版商店名稱：PS5 Future Game Deluxe Edition');
    assert.doesNotMatch(versionRow(e, 'Steam').textContent, /Deluxe/);
    const note = sourceNote(e, 'PlayStation 5 版販售版本：');
    assert.match(note.textContent, /官方商品名稱「PS5 Future Game Deluxe Edition」，台灣版本，來源 PlayStation 官方商品頁。此平台發售的是上述 Deluxe 版本。.*版本內容依台灣官方商品頁確認。/);
    assert.equal(note.children[0].href, source_url);
    for (const item of sourceItems(e).filter(item => item.textContent.includes('中文：')))
      assert.doesNotMatch(item.textContent, /Deluxe|DLC/);
  }
});

test('NS detail admitted by IGDB PopScore shows its rank instead of a hypes count', async () => {
  const { elements: e } = await display('?igdb=366896&date=2027-01-15', sample({ hypes: null,
    popularity_basis: 'igdb_popscore', popscore: { visits: 0.001, want_to_play: 0.002, top_percent: 8 } }));
  assert.equal(e.get('detailPage').hidden, false);
  assert.equal(e.get('gameInterestLabel').textContent, 'IGDB 熱度');
  assert.equal(e.get('gameFollowers').textContent, '前 8%');
  assert.equal(e.get('gameInterestUnit').textContent, '');
  assert.equal(e.get('gameInterestCaption').textContent, 'IGDB PopScore · NS／NS2 頁面瀏覽或「想玩」排名');
  assert.match(e.get('gameFootnote').textContent, /IGDB 熱度是 IGDB 頁面瀏覽或「想玩」在 NS／NS2 遊戲間的排名/);
  assert.doesNotMatch(e.get('gameFootnote').textContent, /hypes/);
});

test('one source note covers every version it applies to, so the same sentence never repeats', async () => {
  const support = languageSupport();
  const payload = sample({ platforms: [{ id: 130, code: 'NS' }, { id: 508, code: 'NS2' }],
    known_platforms: [{ id: 130, code: 'NS' }, { id: 508, code: 'NS2' }], exclusivity: { status: 'multi_platform' },
    releases: [{ platform: 'NS', date: '2027-01-15', precision: 'day', region: 'worldwide', source: 'IGDB' },
      { platform: 'NS2', date: '2027-01-15', precision: 'day', region: 'worldwide', source: 'IGDB' }],
    platform_language_support: { NS: support, NS2: support } });
  const { elements: e } = await display('?igdb=366896', payload);
  const notes = sourceItems(e).map(item => item.textContent);
  assert.deepEqual(notes.filter(text => text.includes('發售日：')).map(text => text.split('：')[0]),
    ['Nintendo Switch 版、Nintendo Switch 2 版發售日']);
  assert.match(notes.find(text => text.includes('中文：')), /^Nintendo Switch 版、Nintendo Switch 2 版中文：台灣版本，來源 Nintendo 台灣。/);
  assert.equal(notes.filter(text => text.includes('中文：')).length, 1);
  assert.equal(sourceLinks(e).filter(link => link.textContent === 'Nintendo 台灣').length, 1);
  assert.equal(notes.filter(text => text.startsWith('各平台、地區版本的語言分開確認')).length, 1);
  // Each row still shows its own date and languages.
  assert.deepEqual(versionDates(e), [['NS', '2027-01-15'], ['NS2', '2027-01-15']]);
  assert.deepEqual(languageChips(versionRow(e, 'NS')), ['簡中']);
  assert.deepEqual(languageChips(versionRow(e, 'NS2')), ['簡中']);
  // Launching together is not "earliest", and one shared shop page is one buy button.
  assert.equal(e.get('gameHeroLabel').textContent, '預定發售・台灣時間');
  assert.equal(e.get('gameHeroNote').textContent, '兩個平台同一天・全球日期，台灣上市日待確認');
  assert.equal(shopLink(e, 'NS').href, shopLink(e, 'NS2').href);
  assert.equal(e.get('gameSteam').href, shopLink(e, 'NS').href);
  assert.equal(e.get('gameSteam').textContent, '前往 Nintendo 官網↗');
});

test('the title says when a game has no official Chinese name, and the info card names it only when it has one', async () => {
  const labels = e => e.get('gameFacts').children.map(row => row.children[0].textContent);
  const { elements: e } = await display('?igdb=366896');
  assert.equal(e.get('gameTitle').textContent, "Fire Emblem: Fortune's Weave");
  assert.equal(e.get('gameTitle').lang, 'en');
  assert.equal(e.get('gameEnglish').textContent, '暫無官方中文名稱');
  assert.equal(e.get('gameEnglish').dataset.kind, 'missing');
  assert.deepEqual(labels(e), ['原名']);
  const { elements: zh } = await display('?igdb=366896', sample({ name_zh_tw: '聖火降魔錄 命運織錦' }));
  assert.equal(zh.get('gameTitle').textContent, '聖火降魔錄 命運織錦');
  assert.equal(zh.get('gameTitle').lang, 'zh-Hant');
  assert.equal(zh.get('gameEnglish').textContent, "Fire Emblem: Fortune's Weave");
  assert.equal(zh.get('gameEnglish').dataset.kind, 'original');
  assert.deepEqual(labels(zh), ['中文名稱', '原名']);
});

test('platforms the radar does not track are named once and outlined, and the Steam build is never one of them', async () => {
  const { elements: e } = await display('?igdb=366896', crossPlatformSample());
  assert.deepEqual(titleChips(e), ['即將上市', 'NS2', 'PC']);
  assert.equal(e.get('gamePlatforms').children[2].className, 'game-title-chip is-other');
  assert.equal(e.get('gameVersionsAlso').hidden, false);
  assert.equal(e.get('gameVersionsAlso').textContent, '也在 PC 推出；本站沒有追蹤這個平台的日期與語言。');
  assert.deepEqual(versionDates(e), [['NS2', '2027-03-19']]);
  const { elements: merged } = await display('?appid=632950', crossPlatformSample(), steamCatalog());
  assert.deepEqual(titleChips(merged), ['即將上市', 'Steam', 'NS2']);
  assert.equal(merged.get('gameVersionsAlso').hidden, true);
});

test('a released game says so in the title card and never calls its date overdue', async () => {
  const { elements: e } = await display('?igdb=366896', sample({
    releases: [{ date: '2026-09-20', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB' }] }));
  assert.equal(e.get('detailPage').hidden, false);
  assert.deepEqual(titleChips(e), ['已發售', 'NS2 獨佔']);
  assert.equal(e.get('gameHeroLabel').textContent, '發售日・台灣時間');
  assert.equal(e.get('gameHeroCountdown').textContent, '已發售 14 天');
  assert.equal(e.get('gameHeroCountdown').dataset.state, 'released');
  assert.doesNotMatch(pageText(e), /原定日期已過/);
});

test('a version without a verified shop leaves its store cell empty and the buy button falls back to the IGDB page', async () => {
  const { elements: e } = await display('?igdb=366896', sample({ nintendo_url: null,
    exclusivity: { status: 'listed_only', platform: 'NS2' } }));
  const store = versionCell(versionRow(e, 'NS2'), 'store');
  assert.equal(store.children.length, 0);
  assert.ok(store.classList.contains('is-empty'));
  assert.equal(e.get('gameSteam').href, 'https://www.igdb.com/games/fire-emblem-fortunes-weave');
  assert.equal(e.get('gameSteam').textContent, '前往 IGDB 遊戲頁↗');
  assert.equal(e.get('gameSteamMobile').textContent, 'IGDB 遊戲頁 ↗');
});
