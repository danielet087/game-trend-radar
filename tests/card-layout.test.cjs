const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const D = require('../src/domain/index.mjs').RadarData;
const R = require('../src/features/discovery/index.js').RadarDiscovery;
const { FakeElement: Element, createDocument, vueGlobals } = require('./support/fake-dom.cjs');
const { bundle } = require('./support/bundle.cjs');

// The shipped catalog card, page controller, selectors and favorites, bundled once.
let catalog;
test.before(async () => { catalog = await bundle('tests/support/catalog-entry.mjs', 'RadarCatalog'); });
const TODAY = '2026-10-04';
const PAGES = { all: 'games.html', home: 'index.html', released: 'released.html', date: 'date.html' };
const flush = async () => { for (let turn = 0; turn < 5; turn++) await new Promise(resolve => setImmediate(resolve)); };

function pageElements(page) {
  const html = readFileSync(join(__dirname, '..', PAGES[page]), 'utf8');
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => {
    const element = new Element(); element.id = id; return [id, element];
  }));
  for (const [, id, body] of html.matchAll(/<select[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    elements.get(id).options = [...body.matchAll(/<option value="([^"]*)"/g)].map(([, value]) => ({ value }));
  }
  return elements;
}

function renderer(stored = [], page = 'all', search = '') {
  const elements = pageElements(page);
  const body = new Element('body'); body.dataset.page = page;
  for (const element of elements.values()) body.append(element);
  const document = createDocument({
    body, activeElement: null,
    getElementById: id => elements.get(id) || null,
    querySelector: selector => body.querySelector(selector),
    querySelectorAll: selector => body.querySelectorAll(selector),
    dispatchEvent() { return true; },
  });
  const storage = new Map([['game-trend-radar:saved:v1', JSON.stringify(stored)]]);
  const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  const sessionStorage = { getItem: () => null, setItem() {} };
  const location = { search, origin: 'https://example.test', pathname: '/' + PAGES[page], href: 'https://example.test/' + PAGES[page] + search };
  const window = { localStorage, sessionStorage, location, RadarMotion: { enabled: false }, addEventListener() {}, removeEventListener() {} };
  const context = vm.createContext({
    window, document, location, localStorage, sessionStorage,
    history: { state: null, replaceState() {} }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    URL, URLSearchParams, Intl, Date, Number, Set, Map, WeakMap, AbortController,
    setTimeout: () => 0, clearTimeout() {}, queueMicrotask, console: { error() {}, warn() {} },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    ...vueGlobals,
  });
  vm.runInContext(catalog, context);
  const C = context.RadarCatalog, domain = { ...D, todayInTaipei: () => TODAY };
  const filters = new C.FilterState(page, TODAY, domain, R, new URLSearchParams(search), false);
  filters.configure(Object.fromEntries([['minimum', 'followersFilter'], ['sort', 'sortSelect'], ['period', 'releaseFilter'],
    ['language', 'languageFilter']].filter(([, id]) => elements.get(id)?.options).map(([key, id]) => [key, elements.get(id).options.map(option => option.value)])));
  filters.restore(new URLSearchParams(search));
  let pageController = null, dataset = null;
  const cards = C.createCardFactory({ domain, discovery: R, mode: page, today: TODAY,
    model: () => pageController?.state.model || null, tags: () => filters.state.tags,
    isSaved: (game, entity) => C.favorites.isSaved({ appid: game.appid, savedAliases: entity?.identity.savedAliases || game.savedAliases }),
    subscribeSaved: listener => C.favorites.subscribeSaved(listener), artwork: { load() {} } });
  // Real save-button handling, bound to these cards rather than a loaded page.
  C.createCatalogFavorites(filters, () => {}, cards.gameFor, () => {}, () => {}, C.favorites);
  const grid = elements.get('gamesGrid');
  return {
    card(game, options) { const card = cards.create(game, options); grid.append(card); return card; },
    async click(button) { document.listeners.click({ target: button }); await flush(); },
    storage, savedCount: () => C.favorites.savedCount(),
    // A ready dataset for the pure catalog selectors.
    setData(data) { dataset = data; },
    // The real page: it loads these public sources and renders its grid and calendar.
    async load(official, preview, native) {
      pageController = C.initCatalogPage({ data: domain, discovery: R, artwork: { load() {} },
        storage: { loadSources: async () => ({ catalog: official, preview }), loadNintendo: async () => native } });
      await pageController.ready; await flush();
    },
    filtered(order) {
      const active = pageController?.filters || filters;
      active.state.sort = order;
      return C.selectCatalog(pageController?.state.viewModel || dataset, active, domain, R, C.favorites.readSaved());
    },
    render() { pageController.render(); return grid.querySelectorAll('.game-card'); },
    calendar: elements.get('calendarGrid'),
  };
}

function steam(changes = {}) {
  return { appid: 3167930, name: 'Hela: Of Mice & Magic', display_name: 'Hela：鼠鼠奇旅', followers: 39021,
    release_start: '2026-12-01', language_support: { tchinese: true, schinese: true }, ...changes };
}
function nintendo(changes = {}) {
  return { schema_version: 1, games: [{ id: 'igdb:314449', igdb_id: 314449, name_en: 'Hela: Of Mice & Magic',
    name_zh_tw: 'Hela：鼠鼠奇旅', hypes: 46, sexual_content_screened: true, platform_data_complete: true,
    platforms: [{ id: 508, code: 'NS2' }], known_platforms: [{ id: 508, code: 'NS2' }, { id: 6, name: 'PC' }],
    exclusivity: { status: 'multi_platform' },
    releases: [{ date: '2026-12-01', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB' }],
    websites: [{ url: 'https://store.steampowered.com/app/3167930/' }],
    url: 'https://www.igdb.com/games/hela-of-mice-and-magic', ...changes }] };
}
function edition(changes = {}) {
  return { type: 'deluxe', label: 'Deluxe版', title: 'Hela: Of Mice & Magic Deluxe Edition',
    product_id: '70010000106881', region: 'taiwan',
    source_url: 'https://ec.nintendo.com/TW/zh/titles/70010000106881', checked_at: '2026-10-04T03:00:00Z', ...changes };
}

test('merged PC and console card renders one combined tag, with the actual platforms available on hover', () => {
  const data = D.datasets({ games: [steam()] }, null, nintendo());
  const card = renderer().card(D.cardGames(data.games)[0]);
  assert.deepEqual(card.querySelectorAll('.platform-badge').map(tag => tag.textContent), ['PC＋主機']);
  assert.equal(card.querySelector('.card-platforms').textContent, 'PC＋主機');
  assert.match(card.querySelector('.platform-badge').title, /PC|Steam/);
  assert.match(card.querySelector('.platform-badge').title, /Nintendo Switch 2|NS2/);
  assert.deepEqual(card.querySelectorAll('.card-followers').map(metric => metric.textContent), ['39,021人關注', '46IGDB hypes']);
  assert.equal(card.querySelectorAll('time').length, 1);
  assert.equal(card.querySelector('.card-release-date').textContent, '2026/12/01');
  assert.equal(card.querySelector('.card-release-platform'), null);
  assert.equal(card.querySelector('.card-title').title, 'Hela：鼠鼠奇旅');
  assert.equal(card.querySelector('.card-english').title, 'Hela: Of Mice & Magic');
  assert.deepEqual(card.querySelector('.card-names').children.map(node => node.className), ['card-title', 'card-english']);
  assert.equal(card.querySelector('.card-names').href, './game.html?appid=3167930&date=2026-12-01');
  assert.equal(card.querySelector('.steam-store-link').href, 'https://store.steampowered.com/app/3167930/');
  assert.equal(card.querySelectorAll('.card-compare').length, 0);
});

test('cards reserve an empty subtitle row without repeating an identical original name or exposing blank accessible text', () => {
  for (const nameEn of ['', 'Warhammer 40,000: Boltgun 2']) {
    const game = { ...D.normalize(steam()), name: 'Warhammer 40,000: Boltgun 2', nameEn };
    const card = renderer().card(game), names = card.querySelector('.card-names');
    const english = card.querySelector('.card-english');
    assert.deepEqual(names.children.map(node => node.className), ['card-title', 'card-english']);
    assert.equal(english.textContent, '');
    assert.equal(english.attributes['aria-hidden'], 'true');
    assert.equal(english.title, undefined);
    assert.equal(names.textContent, game.name);
    assert.equal(names.attributes['aria-label'], `查看 ${game.name} 的遊戲資訊`);
    assert.equal(card.querySelectorAll('time').length, 1);
  }
});

test('a later native-port event shows only the earliest verified date and uses it for countdown, preserving its detail context', () => {
  const data = D.datasets({ games: [steam({ release_start: '2026-11-01' })] }, null, nintendo());
  const event = D.selectGames(data, 'date', '2026-10-04', '2026-12-01')[0];
  const card = renderer().card(event);
  assert.deepEqual(card.querySelectorAll('.card-release-date').map(line => line.textContent), ['2026/11/01']);
  assert.equal(card.querySelector('time').dateTime, '2026-11-01');
  assert.equal(card.querySelector('.countdown').textContent, '28 天後登場');
  assert.equal(card.querySelector('.card-release-platform'), null);
  assert.equal(card.querySelector('.card-detail-link').href, './game.html?appid=3167930&date=2026-12-01');
});

test('Steam card keeps support languages directly above the dates-and-interest separator, outside its footer', () => {
  const card = renderer().card(D.normalize(steam()));
  assert.deepEqual(card.querySelectorAll('.platform-badge').map(tag => tag.textContent), ['Steam']);
  assert.equal(card.querySelectorAll('.card-followers').length, 1);
  const body = card.querySelector('.card-body'), languages = card.querySelector('.card-languages');
  assert.equal(languages.parentElement, body);
  assert.equal(body.children[body.children.indexOf(languages) + 1].className, 'card-meta');
  assert.deepEqual(languages.querySelectorAll('.card-language').map(chip => chip.textContent), ['支援繁中', '支援簡中']);
  assert.equal(card.querySelector('.card-footer').querySelector('.card-languages'), null);
});

test('multiplayer badge shares the language row on its left and single-player cards omit it', () => {
  const multiplayer = D.normalize(steam({ categories: [{ id: 2 }, { id: 9 }],
    categories_source: 'Steam Store appdetails cc=TW categories', categories_checked_at: '2026-10-05T07:00:00Z' }));
  const card = renderer().card(multiplayer), row = card.querySelector('.card-languages');
  assert.deepEqual(row.children.map(child => child.className), ['card-multiplayer', 'card-language-badges']);
  assert.equal(row.children[0].textContent, '多人');
  assert.match(row.children[0].title, /Steam.*合作/);
  assert.match(row.children[0].attributes['aria-label'], /多人遊戲/);
  assert.deepEqual(row.querySelectorAll('.card-language').map(chip => chip.textContent), ['支援繁中', '支援簡中']);
  const body = card.querySelector('.card-body');
  assert.equal(body.children[body.children.indexOf(row) + 1].className, 'card-meta');
  for (const categories of [undefined, [{ id: 2 }]]) {
    const single = renderer().card(D.normalize(steam({ categories,
      categories_source: 'Steam Store appdetails cc=TW categories', categories_checked_at: '2026-10-05T07:00:00Z' })));
    assert.equal(single.querySelector('.card-multiplayer'), null);
    assert.equal(single.querySelector('.card-language-badges').parentElement, single.querySelector('.card-languages'));
  }
});

test('calendar event cards do not show another platform multiplayer mode while summary cards can identify it on hover', () => {
  const data = D.datasets({ games: [steam({ release_start: '2026-11-01', categories: [{ id: 2 }],
    categories_source: 'Steam Store appdetails cc=TW categories', categories_checked_at: '2026-10-05T07:00:00Z' })] },
    null, nintendo({ multiplayer_modes: [{ platform: { id: 508 }, onlinemax: 4 }] }));
  const early = data.games.find(game => game.date === '2026-11-01'), late = data.games.find(game => game.date === '2026-12-01');
  assert.equal(renderer().card(early, { event: true }).querySelector('.card-multiplayer'), null);
  const nativeBadge = renderer().card(late, { event: true }).querySelector('.card-multiplayer');
  assert.equal(nativeBadge.textContent, '多人');
  assert.match(nativeBadge.title, /NS2：IGDB/);
  const summary = renderer().card(D.cardGames(data.games)[0]).querySelector('.card-multiplayer');
  assert.equal(summary.textContent, '多人');
  assert.match(summary.title, /NS2：IGDB/);
  assert.doesNotMatch(summary.title, /Steam/);
});

test('ordinary NS2 listing and official sole-platform proof produce different card tags', () => {
  const listed = nintendo({ websites: [], known_platforms: [{ id: 508, code: 'NS2' }], exclusivity: { status: 'listed_only' } });
  assert.deepEqual(renderer().card(D.nintendoGames(listed)[0]).querySelectorAll('.platform-badge').map(tag => tag.textContent), ['主機']);
  const confirmed = nintendo({ websites: [], known_platforms: [{ id: 508, code: 'NS2' }],
    exclusivity: { status: 'confirmed', platform: 'NS2', url: 'https://www.nintendo.com/us/store/products/hela-switch-2/' } });
  assert.deepEqual(renderer().card(D.nintendoGames(confirmed)[0]).querySelectorAll('.platform-badge').map(tag => tag.textContent), ['NS2 獨佔']);
  const confirmedNS = nintendo({ websites: [], platforms: [{ id: 130, code: 'NS' }],
    known_platforms: [{ id: 130, code: 'NS' }],
    releases: [{ date: '2026-12-01', platform: 'NS', precision: 'day', region: 'worldwide', source: 'IGDB' }],
    exclusivity: { status: 'confirmed', platform: 'NS', url: 'https://www.nintendo.com/us/store/products/hela-switch/' } });
  assert.deepEqual(renderer().card(D.nintendoGames(confirmedNS)[0]).querySelectorAll('.platform-badge').map(tag => tag.textContent), ['NS 獨佔']);
});

test('console-only titles render one console tag while Nintendo titles also on PC render one PC-and-console tag', () => {
  const both = nintendo({ websites: [],
    platforms: [{ id: 130, code: 'NS' }, { id: 508, code: 'NS2' }],
    known_platforms: [{ id: 130, code: 'NS' }, { id: 508, code: 'NS2' }],
    releases: [{ date: '2026-12-01', platform: 'NS', precision: 'day', region: 'worldwide', source: 'IGDB' },
      { date: '2026-12-05', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB' }],
  });
  const later = D.nintendoGames(both).find(game => game.date === '2026-12-05');
  const card = renderer().card(later);
  assert.deepEqual(card.querySelectorAll('.platform-badge').map(tag => tag.textContent), ['主機多平台']);
  assert.equal(card.querySelector('.card-platforms').textContent, '主機多平台');
  assert.match(card.querySelector('.platform-badge').title, /Nintendo Switch|NS/);
  assert.match(card.querySelector('.platform-badge').title, /Nintendo Switch 2|NS2/);
  assert.equal(card.querySelector('time').dateTime, '2026-12-01');
  const otherPlatform = nintendo({ websites: [] });
  assert.deepEqual(renderer().card(D.nintendoGames(otherPlatform)[0]).querySelectorAll('.platform-badge').map(tag => tag.textContent), ['PC＋主機']);
});

test('unknown additional platform evidence does not falsely label a card as console-only multi-platform', () => {
  const payload = nintendo({ websites: [], known_platforms: [{ id: 508, code: 'NS2' }, { id: 999999, name: 'Unclassified platform' }] });
  const card = renderer().card(D.nintendoGames(payload)[0]);
  const tags = card.querySelectorAll('.platform-badge');
  assert.equal(tags.length, 1);
  assert.notEqual(tags[0].textContent, '主機多平台');
  assert.notEqual(tags[0].textContent, 'PC＋主機');
  assert.match(tags[0].title, /Nintendo Switch 2|NS2/);
});

test('old Nintendo bookmarks remain selected on merged cards and toggle both identities together', async () => {
  const game = D.cardGames(D.datasets({ games: [steam()] }, null, nintendo()).games)[0];
  const app = renderer(['igdb:314449', 999]);
  const card = app.card(game), button = card.querySelector('button[data-save]');
  assert.equal(button.attributes['aria-pressed'], 'true');
  await app.click(button);
  assert.deepEqual(JSON.parse(app.storage.get('game-trend-radar:saved:v1')), [999]);
  assert.equal(button.attributes['aria-pressed'], 'false');
  await app.click(button);
  assert.deepEqual(JSON.parse(app.storage.get('game-trend-radar:saved:v1')), [999, 3167930]);
  assert.equal(button.attributes['aria-pressed'], 'true');
});

test('saved badge counts merged identities once while retaining unrelated browser bookmarks', async () => {
  const app = renderer([3167930, 'igdb:314449', 999]);
  await app.load({ games: [steam()] }, null, nintendo());
  // The header badge shows this count.
  assert.equal(app.savedCount(), 2);
  assert.deepEqual(JSON.parse(app.storage.get('game-trend-radar:saved:v1')), [3167930, 'igdb:314449', 999]);
});

test('card date ordering follows the earliest displayed release while calendar retains every event', () => {
  const early = D.normalize(steam({ appid: 1, release_start: '2026-10-05' }));
  const late = { ...early, date: '2026-10-20', key: 'steam:1@2026-10-20' };
  const middle = D.normalize(steam({ appid: 2, release_start: '2026-10-15' }));
  const app = renderer();
  app.setData({ games: [late, middle, early], recent: [] });
  const newest = app.filtered('newest');
  assert.deepEqual(newest.items.map(game => game.appid), [2, 1]);
  assert.equal(renderer().card(newest.items[1]).querySelector('time').dateTime, '2026-10-05');
  assert.deepEqual(Array.from(newest.events, game => game.date), ['2026-10-20', '2026-10-15', '2026-10-05']);
  assert.deepEqual(app.filtered('date').items.map(game => game.date), ['2026-10-05', '2026-10-15']);
});

test('recently released list retains the latest event context and orders cards by their earliest release', () => {
  const early = D.normalize(steam({ appid: 1, release_start: '2026-09-21' }), true);
  const late = { ...early, date: '2026-10-01', key: 'steam:1@2026-10-01' };
  const middle = D.normalize(steam({ appid: 2, release_start: '2026-09-28' }), true);
  const app = renderer([], 'released');
  app.setData({ games: [], recent: [early, middle, late] });
  assert.deepEqual(app.filtered('newest').items.map(game => game.date), ['2026-09-28', '2026-10-01']);
  const card = app.card(app.filtered('newest').items[1]);
  assert.equal(card.querySelector('time').dateTime, '2026-09-21');
  assert.equal(card.querySelector('.countdown').textContent, '已上市');
});

test('October calendar list writes the Nintendo edition into its title while the Steam event retains the original name', async () => {
  const official = { games: [steam({ release_start: '2026-10-09' })] }, native = nintendo({
    releases: [{ date: '2026-10-08', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB' }],
    platform_editions: { NS2: edition() },
  });
  const app = renderer([], 'home', '?month=2026-10&view=list');
  await app.load(official, null, native);
  const cards = app.render();
  assert.deepEqual(cards.map(card => card.querySelector('time').dateTime), ['2026-10-08', '2026-10-09']);
  assert.deepEqual(cards.map(card => card.querySelector('.card-release-platform').textContent), ['NS2', 'Steam']);
  assert.deepEqual(cards.map(card => card.querySelector('.card-detail-link').href), [
    './game.html?appid=3167930&date=2026-10-08', './game.html?appid=3167930&date=2026-10-09',
  ]);
  assert.equal(cards[0].querySelector('.card-title').textContent, 'Hela：鼠鼠奇旅（Deluxe版）');
  assert.equal(cards[0].querySelector('.card-title').title, 'Hela：鼠鼠奇旅（Deluxe版）');
  assert.equal(cards[0].querySelector('.card-english').textContent, 'Hela: Of Mice & Magic Deluxe Edition');
  assert.equal(cards[0].querySelector('.card-english').title, 'Hela: Of Mice & Magic Deluxe Edition');
  assert.equal(cards[0].querySelector('.card-names').attributes['aria-label'], '查看 Hela：鼠鼠奇旅（Deluxe版） 的遊戲資訊');
  assert.equal(cards[0].querySelector('.card-detail-link').attributes['aria-label'], '查看 Hela：鼠鼠奇旅（Deluxe版） 的遊戲資訊');
  assert.equal(cards[0].querySelector('button[data-save]').attributes['aria-label'], '收藏 Hela：鼠鼠奇旅（Deluxe版）');
  assert.equal(cards[0].querySelector('.steam-store-link').attributes['aria-label'], '在 Steam 開啟 Hela：鼠鼠奇旅（另開分頁）');
  assert.equal(cards[1].querySelector('.card-title').textContent, 'Hela：鼠鼠奇旅');
  for (const card of cards) {
    assert.equal(card.querySelector('.card-editions'), null);
    assert.equal(card.querySelector('.card-edition'), null);
  }
  assert.equal(cards[0].querySelector('.card-languages').attributes['aria-label'], 'Nintendo 版本遊戲支援語言');
  assert.deepEqual(cards[0].querySelectorAll('.card-language').map(chip => chip.textContent), ['語言支援待確認']);
  assert.deepEqual(cards[1].querySelectorAll('.card-language').map(chip => chip.textContent), ['支援繁中', '支援簡中']);
  assert.deepEqual(cards.map(card => card.querySelectorAll('.platform-badge').map(tag => tag.textContent)), [['PC＋主機'], ['PC＋主機']]);
  const calendarLinks = app.calendar.querySelectorAll('.day-game');
  assert.deepEqual(calendarLinks.map(link => link.querySelector('.day-platform').textContent), ['PC＋主機', 'PC＋主機']);
  assert.match(calendarLinks[0].querySelector('.day-platform').title, /PC|Steam/);
  assert.match(calendarLinks[0].querySelector('.day-platform').title, /Nintendo Switch 2|NS2/);
  assert.match(calendarLinks[0].querySelector('.day-platform').title, /本日發售：NS2/);
  assert.match(calendarLinks[1].querySelector('.day-platform').title, /本日發售：Steam/);
  assert.match(calendarLinks[0].querySelector('.day-game-name').textContent, /Deluxe版/);
  assert.match(calendarLinks[0].title, /Hela: Of Mice & Magic Deluxe Edition/);
  assert.equal(calendarLinks[0].href, './game.html?appid=3167930&date=2026-10-08');
});

test('daily release card names its edition while the general physical card selected for the original Steam event keeps the base title', async () => {
  const official = { games: [steam({ release_start: '2027-02-18' })] }, native = nintendo({
    releases: [{ date: '2027-05-20', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB' }],
    platform_editions: { NS2: edition({ type: 'base_plus_expansion', label: '本體＋Dark Arisen擴充版',
      title: 'Hela: Of Mice & Magic - Dark Arisen' }) },
  });
  const data = D.datasets(official, null, native);
  const day = renderer([], 'date', '?date=2027-05-20'); await day.load(official, null, native);
  const dailyCard = day.render()[0];
  assert.equal(dailyCard.querySelector('time').dateTime, '2027-05-20');
  assert.equal(dailyCard.querySelector('.card-release-platform').textContent, 'NS2');
  assert.equal(dailyCard.querySelector('.card-title').textContent, 'Hela：鼠鼠奇旅（本體＋Dark Arisen擴充版）');
  assert.equal(dailyCard.querySelector('.card-english').textContent, 'Hela: Of Mice & Magic - Dark Arisen');
  assert.equal(dailyCard.querySelector('.card-edition'), null);
  const catalog = renderer(); await catalog.load(official, null, native);
  const generalCard = catalog.render()[0];
  assert.equal(catalog.render().length, 1);
  assert.equal(generalCard.querySelector('time').dateTime, '2027-02-18');
  assert.equal(generalCard.querySelector('.card-release-platform'), null);
  assert.equal(generalCard.querySelector('.card-title').textContent, 'Hela：鼠鼠奇旅');
  assert.equal(generalCard.querySelector('.card-english').textContent, 'Hela: Of Mice & Magic');
  assert.equal(generalCard.querySelector('.card-edition'), null);
  assert.equal(data.games[0].name, 'Hela：鼠鼠奇旅');
  assert.equal(data.games[0].nameEn, 'Hela: Of Mice & Magic');
});

test('same-day Steam and Nintendo versions produce one monthly release card showing both event platforms', async () => {
  const app = renderer([], 'home', '?month=2026-10&view=list');
  await app.load({ games: [steam({ release_start: '2026-10-08' })] }, null, nintendo({
    releases: [{ date: '2026-10-08', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB' }],
  }));
  const cards = app.render();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].querySelector('.card-release-platform').textContent, 'Steam／NS2');
  assert.equal(cards[0].querySelector('time').dateTime, '2026-10-08');
  assert.equal(cards[0].querySelector('.card-editions'), null);
});

test('month calendar reserves named Nintendo tags for verified exclusivity and keeps actual native platforms on hover', async () => {
  const cases = [
    { expected: '主機', changes: { exclusivity: { status: 'listed_only' } } },
    { expected: '主機', changes: { platform_data_complete: false, exclusivity: { status: 'unknown' } } },
    { expected: 'NS2 獨佔', changes: { exclusivity: { status: 'confirmed', platform: 'NS2',
      url: 'https://www.nintendo.com/us/store/products/hela-switch-2/' } } },
    { expected: '平台待確認', changes: { known_platforms: [{ id: 508, code: 'NS2' }, { id: 999999, name: 'Unclassified platform' }] } },
  ];
  for (const { expected, changes } of cases) {
    const app = renderer([], 'home', '?month=2026-12&view=list');
    await app.load({ games: [] }, null, nintendo({ websites: [],
      known_platforms: [{ id: 508, code: 'NS2' }], ...changes }));
    const card = app.render()[0], links = app.calendar.querySelectorAll('.day-game');
    assert.equal(links.length, 1);
    const tags = links[0].querySelectorAll('.day-platform');
    assert.deepEqual(tags.map(tag => tag.textContent), [expected]);
    assert.equal(card.querySelector('.platform-badge').textContent, expected);
    assert.match(tags[0].title, /Nintendo Switch 2|NS2/);
    assert.match(tags[0].title, /本日發售：NS2/);
    assert.equal(links[0].href, './game.html?igdb=314449&date=2026-12-01');
  }
});


test('PS5 calendar event retains its release date, own shop and unknown language beside the merged Steam game', () => {
  const ps5Store = 'https://store.playstation.com/zh-hant-tw/concept/10009999';
  const native = nintendo({ platforms: [{ id: 167, code: 'PS5' }],
    known_platforms: [{ id: 6, name: 'PC' }, { id: 167, code: 'PS5', name: 'PlayStation 5' }],
    playstation_url: ps5Store,
    releases: [{ date: '2027-01-15', platform: 'PS5', precision: 'day', region: 'taiwan',
      source: 'official_registry', date_basis: 'taiwan_official_calendar_day', time_zone: 'Asia/Taipei',
      timezone_status: 'taiwan_official_date', taiwan_release_confirmed: true,
      official_source_url: ps5Store, official_source_name: 'PlayStation 台灣', official_product_id: null,
      official_concept_id: '10009999', official_release_time_utc: '2027-01-14T16:00:00Z',
      official_verified_at: '2026-10-04T13:00:00Z' }],
  });
  const data = D.datasets({ games: [steam()] }, null, native);
  const summary = renderer().card(D.cardGames(data.games)[0]);
  assert.equal(summary.querySelector('time').textContent, '2026/12/01');
  assert.match(summary.querySelector('.card-languages').textContent, /支援繁中/);
  assert.equal(summary.querySelector('.steam-store-link').href, 'https://store.steampowered.com/app/3167930/');
  const event = data.games.find(game => game.date === '2027-01-15');
  const card = renderer([], 'date').card(event);
  assert.equal(card.querySelector('time').textContent, '2027/01/15');
  assert.equal(card.querySelector('.card-release-platform').textContent, 'PS5');
  assert.match(card.querySelector('.card-languages').textContent, /語言支援待確認/);
  assert.doesNotMatch(card.querySelector('.card-languages').textContent, /支援繁中|支援簡中/);
  assert.equal(card.querySelector('.steam-store-link').href, ps5Store);
  assert.match(card.querySelector('.steam-store-link').textContent, /PlayStation 商店/);
  assert.equal(card.querySelector('.card-names').href, './game.html?appid=3167930&date=2027-01-15');
  assert.deepEqual(card.querySelectorAll('.platform-badge').map(tag => tag.textContent), ['PC＋主機']);
  assert.match(card.querySelector('.platform-badge').title, /PS5/);
});
