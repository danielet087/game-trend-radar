const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const D = require('../assets/radar-data-v1.js');
const R = require('../assets/radar-discovery-v1.js');
const script = readFileSync(join(__dirname, '..', 'assets/radar-play-v2.js'), 'utf8');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toLowerCase();
    this.dataset = new Proxy({}, { set(target, key, value) { target[key] = String(value); return true; } });
    this.attributes = {};
    this.children = []; this._text = ''; this.className = ''; this.parentElement = null;
  }
  set textContent(value) { this._text = String(value ?? ''); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent || '').join(''); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { this._text = ''; this.children = []; this.append(...children); }
  matches(selector) {
    if (selector === '.game-card[data-appid]') return this.className.split(/\s+/).includes('game-card') && this.dataset.appid !== undefined;
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    if (selector === 'button[data-save]') return this.tagName === 'button' && this.dataset.save !== undefined;
    if (selector === '[data-saved-count]') return this.dataset.savedCount !== undefined;
    return this.tagName === selector;
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  get classList() {
    return {
      add: (...values) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...values])].join(' '); },
      remove: (...values) => { this.className = this.className.split(/\s+/).filter(value => !values.includes(value)).join(' '); },
    };
  }
  remove() {}
  addEventListener() {}
}

function renderer(stored = [], page = 'all', search = '') {
  const root = new Element('body'); root.dataset.page = page;
  const grid = new Element(); const toast = new Element();
  const count = new Element('span'); count.dataset.savedCount = '';
  root.append(grid, toast, count);
  const listeners = {};
  const controls = new Map(['searchInput', 'followersFilter', 'releaseFilter', 'languageFilter', 'sortSelect',
    'savedFilter', 'resetFilters', 'resultCount', 'loadMoreWrap', 'calendarArea', 'calendarView', 'listView',
    'sortWrap', 'monthPicker', 'monthLabel', 'calendarGrid'].map(id => {
      const control = new Element(); control.value = ''; control.selectedIndex = 0;
      return [id, control];
    }));
  controls.get('followersFilter').value = '0';
  const document = {
    body: root, activeElement: null,
    getElementById: id => id === 'gamesGrid' ? grid : id === 'toast' ? toast : controls.get(id) || null,
    createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment'),
    querySelectorAll: selector => root.querySelectorAll(selector),
    addEventListener: (type, callback) => { listeners[type] = callback; },
    dispatchEvent() {},
  };
  const storage = new Map([['game-trend-radar:saved:v1', JSON.stringify(stored)]]);
  const window = {
    RadarData: { ...D, todayInTaipei: () => '2026-10-04' }, RadarDiscovery: R,
    RadarArtwork: { load() {} },
    RadarEnhancements: { attachCompare() { throw new Error('Cards must not attach comparison controls'); }, pulseSaved() {} },
    addEventListener() {},
  };
  const context = vm.createContext({
    window, document, location: { search }, URLSearchParams, Intl, Date, Number, Set, Map, WeakMap,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    matchMedia: () => ({ matches: false }), setTimeout: () => 0, clearTimeout() {},
  });
  // Execute the real card renderer without starting unrelated page/network setup.
  const prefix = script.slice(0, script.indexOf('  function empty('));
  const filters = script.slice(script.indexOf('  function activeFilters('), script.indexOf('  function resetFilters('));
  vm.runInContext(prefix + filters + '\n const motionOn = false, revealObserver = null; function celebrateSave() {} function revealCards() {}\n window.renderCard = makeCard;\n window.filterCards = filteredGames;\n window.renderGrid = renderExplorer;\n window.setData = data => { model.data = data; model.loading = false; updateSavedControls(); };\n})();', context);
  return {
    card(game, options) { const card = window.renderCard(game, options); grid.append(card); return card; },
    click(button) { listeners.click({ target: button }); }, storage, count,
    setData(data) { window.setData(data); },
    filtered(order) { controls.get('sortSelect').value = order; return window.filterCards(); },
    render() { window.renderGrid(); return grid.querySelectorAll('.game-card'); },
    calendar: controls.get('calendarGrid'),
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

test('merged card keeps both independent interest counts with one multi-platform tag and one earliest date', () => {
  const data = D.datasets({ games: [steam()] }, null, nintendo());
  const card = renderer().card(D.cardGames(data.games)[0]);
  assert.deepEqual(card.querySelectorAll('.platform-badge').map(tag => tag.textContent), ['多平台']);
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
  assert.deepEqual(languages.children.map(chip => chip.textContent), ['支援繁中', '支援簡中']);
  assert.equal(card.querySelector('.card-footer').querySelector('.card-languages'), null);
});

test('ordinary NS2 listing and official sole-platform proof produce different card tags', () => {
  const listed = nintendo({ websites: [], known_platforms: [{ id: 508, code: 'NS2' }], exclusivity: { status: 'listed_only' } });
  assert.deepEqual(renderer().card(D.nintendoGames(listed)[0]).querySelectorAll('.platform-badge').map(tag => tag.textContent), ['NS2']);
  const confirmed = nintendo({ websites: [], known_platforms: [{ id: 508, code: 'NS2' }],
    exclusivity: { status: 'confirmed', platform: 'NS2', url: 'https://www.nintendo.com/us/store/products/hela-switch-2/' } });
  assert.deepEqual(renderer().card(D.nintendoGames(confirmed)[0]).querySelectorAll('.platform-badge').map(tag => tag.textContent), ['NS2 獨佔']);
});

test('Nintendo titles on both NS and NS2 or another confirmed platform show only the multi-platform tag', () => {
  const both = nintendo({ websites: [],
    platforms: [{ id: 130, code: 'NS' }, { id: 508, code: 'NS2' }],
    known_platforms: [{ id: 130, code: 'NS' }, { id: 508, code: 'NS2' }],
    releases: [{ date: '2026-12-01', platform: 'NS', precision: 'day', region: 'worldwide', source: 'IGDB' },
      { date: '2026-12-05', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB' }],
  });
  const later = D.nintendoGames(both).find(game => game.date === '2026-12-05');
  const card = renderer().card(later);
  assert.deepEqual(card.querySelectorAll('.platform-badge').map(tag => tag.textContent), ['多平台']);
  assert.equal(card.querySelector('time').dateTime, '2026-12-01');
  const otherPlatform = nintendo({ websites: [] });
  assert.deepEqual(renderer().card(D.nintendoGames(otherPlatform)[0]).querySelectorAll('.platform-badge').map(tag => tag.textContent), ['多平台']);
});

test('old Nintendo bookmarks remain selected on merged cards and toggle both identities together', () => {
  const game = D.cardGames(D.datasets({ games: [steam()] }, null, nintendo()).games)[0];
  const app = renderer(['igdb:314449', 999]);
  const card = app.card(game), button = card.querySelector('button[data-save]');
  assert.equal(button.attributes['aria-pressed'], 'true');
  app.click(button);
  assert.deepEqual(JSON.parse(app.storage.get('game-trend-radar:saved:v1')), [999]);
  assert.equal(button.attributes['aria-pressed'], 'false');
  app.click(button);
  assert.deepEqual(JSON.parse(app.storage.get('game-trend-radar:saved:v1')), [999, 3167930]);
  assert.equal(button.attributes['aria-pressed'], 'true');
});

test('saved badge counts merged identities once while retaining unrelated browser bookmarks', () => {
  const data = D.datasets({ games: [steam()] }, null, nintendo());
  const app = renderer([3167930, 'igdb:314449', 999]);
  app.setData(data);
  assert.equal(app.count.textContent, '2');
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

test('October calendar list writes the Nintendo edition into its title while the Steam event retains the original name', () => {
  const data = D.datasets({ games: [steam({ release_start: '2026-10-09' })] }, null, nintendo({
    releases: [{ date: '2026-10-08', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB' }],
    platform_editions: { NS2: edition() },
  }));
  const app = renderer([], 'home', '?month=2026-10&view=list');
  app.setData(data);
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
  assert.deepEqual(cards.map(card => card.querySelectorAll('.platform-badge').map(tag => tag.textContent)), [['多平台'], ['多平台']]);
  const calendarLinks = app.calendar.querySelectorAll('.day-game');
  assert.deepEqual(calendarLinks.map(link => link.querySelector('.day-platform').textContent), ['NS2', 'Steam']);
  assert.match(calendarLinks[0].querySelector('.day-game-name').textContent, /Deluxe版/);
  assert.match(calendarLinks[0].title, /Hela: Of Mice & Magic Deluxe Edition/);
  assert.equal(calendarLinks[0].href, './game.html?appid=3167930&date=2026-10-08');
});

test('daily release card names its edition while the general physical card selected for the original Steam event keeps the base title', () => {
  const data = D.datasets({ games: [steam({ release_start: '2027-02-18' })] }, null, nintendo({
    releases: [{ date: '2027-05-20', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB' }],
    platform_editions: { NS2: edition({ type: 'base_plus_expansion', label: '本體＋Dark Arisen擴充版',
      title: 'Hela: Of Mice & Magic - Dark Arisen' }) },
  }));
  const day = renderer([], 'date', '?date=2027-05-20'); day.setData(data);
  const dailyCard = day.render()[0];
  assert.equal(dailyCard.querySelector('time').dateTime, '2027-05-20');
  assert.equal(dailyCard.querySelector('.card-release-platform').textContent, 'NS2');
  assert.equal(dailyCard.querySelector('.card-title').textContent, 'Hela：鼠鼠奇旅（本體＋Dark Arisen擴充版）');
  assert.equal(dailyCard.querySelector('.card-english').textContent, 'Hela: Of Mice & Magic - Dark Arisen');
  assert.equal(dailyCard.querySelector('.card-edition'), null);
  const catalog = renderer(); catalog.setData(data);
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

test('same-day Steam and Nintendo versions produce one monthly release card showing both event platforms', () => {
  const data = D.datasets({ games: [steam({ release_start: '2026-10-08' })] }, null, nintendo({
    releases: [{ date: '2026-10-08', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB' }],
  }));
  const app = renderer([], 'home', '?month=2026-10&view=list'); app.setData(data);
  const cards = app.render();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].querySelector('.card-release-platform').textContent, 'Steam／NS2');
  assert.equal(cards[0].querySelector('time').dateTime, '2026-10-08');
  assert.equal(cards[0].querySelector('.card-editions'), null);
});
