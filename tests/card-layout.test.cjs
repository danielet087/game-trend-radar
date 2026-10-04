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
}

function renderer(stored = [], page = 'all') {
  const root = new Element('body'); root.dataset.page = page;
  const grid = new Element(); const toast = new Element();
  const count = new Element('span'); count.dataset.savedCount = '';
  root.append(grid, toast, count);
  const listeners = {};
  const controls = new Map(['searchInput', 'followersFilter', 'releaseFilter', 'languageFilter', 'sortSelect'].map(id => [id, { value: '' }]));
  controls.get('followersFilter').value = '0';
  const document = {
    body: root, activeElement: null,
    getElementById: id => id === 'gamesGrid' ? grid : id === 'toast' ? toast : controls.get(id) || null,
    createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment'),
    querySelectorAll: selector => root.querySelectorAll(selector),
    addEventListener: (type, callback) => { listeners[type] = callback; },
  };
  const storage = new Map([['game-trend-radar:saved:v1', JSON.stringify(stored)]]);
  const window = {
    RadarData: { ...D, todayInTaipei: () => '2026-10-04' }, RadarDiscovery: R,
    RadarArtwork: { load() {} },
    RadarEnhancements: { attachCompare() { throw new Error('Cards must not attach comparison controls'); }, pulseSaved() {} },
    addEventListener() {},
  };
  const context = vm.createContext({
    window, document, location: { search: '' }, URLSearchParams, Intl, Date, Number, Set, Map, WeakMap,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    matchMedia: () => ({ matches: false }), setTimeout: () => 0, clearTimeout() {},
  });
  // Execute the real card renderer without starting unrelated page/network setup.
  const prefix = script.slice(0, script.indexOf('  function empty('));
  const filters = script.slice(script.indexOf('  function filteredGames('), script.indexOf('  function renderCalendar('));
  vm.runInContext(prefix + filters + '\n function celebrateSave() {}\n window.renderCard = makeCard;\n window.filterCards = filteredGames;\n window.setData = data => { model.data = data; updateSavedControls(); };\n})();', context);
  return {
    card(game) { const card = window.renderCard(game); grid.append(card); return card; },
    click(button) { listeners.click({ target: button }); }, storage, count,
    setData(data) { window.setData(data); },
    filtered(order) { controls.get('sortSelect').value = order; return window.filterCards(); },
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

test('merged card keeps both independent interest counts and one same-day platform date', () => {
  const data = D.datasets({ games: [steam()] }, null, nintendo());
  const card = renderer().card(D.cardGames(data.games)[0]);
  assert.deepEqual(card.querySelectorAll('.platform-badge').map(tag => tag.textContent), ['Steam', 'NS2', '多平台']);
  assert.deepEqual(card.querySelectorAll('.card-followers').map(metric => metric.textContent), ['39,021人關注', '46IGDB hypes']);
  assert.equal(card.querySelectorAll('time').length, 1);
  assert.equal(card.querySelector('.card-release-platform').textContent, 'Steam／NS2');
  assert.equal(card.querySelector('.card-title').title, 'Hela：鼠鼠奇旅');
  assert.equal(card.querySelector('.card-english').title, 'Hela: Of Mice & Magic');
  assert.deepEqual(card.querySelector('.card-names').children.map(node => node.className), ['card-title', 'card-english']);
  assert.equal(card.querySelector('.card-names').href, './game.html?appid=3167930&date=2026-12-01');
  assert.equal(card.querySelector('.steam-store-link').href, 'https://store.steampowered.com/app/3167930/');
  assert.equal(card.querySelectorAll('.card-compare').length, 0);
});

test('a later native port retains every labeled release and highlights the filtered event date', () => {
  const data = D.datasets({ games: [steam({ release_start: '2026-11-01' })] }, null, nintendo());
  const event = D.selectGames(data, 'date', '2026-10-04', '2026-12-01')[0];
  const card = renderer().card(event);
  assert.deepEqual(card.querySelectorAll('.card-release-date').map(line => line.textContent), ['Steam2026/11/01', 'NS22026/12/01']);
  assert.equal(card.querySelector('.current-release').textContent, 'NS22026/12/01');
  assert.equal(card.querySelector('.card-detail-link').href, './game.html?appid=3167930&date=2026-12-01');
});

test('Steam card has Steam tag and places support languages last in its footer right column', () => {
  const card = renderer().card(D.normalize(steam()));
  assert.deepEqual(card.querySelectorAll('.platform-badge').map(tag => tag.textContent), ['Steam']);
  assert.equal(card.querySelectorAll('.card-followers').length, 1);
  const right = card.querySelector('.card-footer-right');
  assert.equal(right.children.at(-1).className, 'card-languages');
  assert.deepEqual(right.children.at(-1).children.map(chip => chip.textContent), ['支援繁中', '支援簡中']);
});

test('ordinary NS2 listing and official sole-platform proof produce different card tags', () => {
  const listed = nintendo({ websites: [], known_platforms: [{ id: 508, code: 'NS2' }], exclusivity: { status: 'listed_only' } });
  assert.deepEqual(renderer().card(D.nintendoGames(listed)[0]).querySelectorAll('.platform-badge').map(tag => tag.textContent), ['NS2']);
  const confirmed = nintendo({ websites: [], known_platforms: [{ id: 508, code: 'NS2' }],
    exclusivity: { status: 'confirmed', platform: 'NS2', url: 'https://www.nintendo.com/us/store/products/hela-switch-2/' } });
  assert.deepEqual(renderer().card(D.nintendoGames(confirmed)[0]).querySelectorAll('.platform-badge').map(tag => tag.textContent), ['NS2 獨佔']);
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

test('card date ordering uses the chosen visible release after consolidation while calendar retains every event', () => {
  const early = D.normalize(steam({ appid: 1, release_start: '2026-10-05' }));
  const late = { ...early, date: '2026-10-20', key: 'steam:1@2026-10-20' };
  const middle = D.normalize(steam({ appid: 2, release_start: '2026-10-15' }));
  const app = renderer();
  app.setData({ games: [late, middle, early], recent: [] });
  const newest = app.filtered('newest');
  assert.deepEqual(newest.items.map(game => game.date), ['2026-10-20', '2026-10-15']);
  assert.deepEqual(newest.events.map(game => game.date), ['2026-10-20', '2026-10-15', '2026-10-05']);
  assert.deepEqual(app.filtered('date').items.map(game => game.date), ['2026-10-05', '2026-10-15']);
});

test('recently released list keeps the latest in-scope native-platform event for each game', () => {
  const early = D.normalize(steam({ appid: 1, release_start: '2026-09-21' }), true);
  const late = { ...early, date: '2026-10-01', key: 'steam:1@2026-10-01' };
  const middle = D.normalize(steam({ appid: 2, release_start: '2026-09-28' }), true);
  const app = renderer([], 'released');
  app.setData({ games: [], recent: [early, middle, late] });
  assert.deepEqual(app.filtered('newest').items.map(game => game.date), ['2026-10-01', '2026-09-28']);
});
