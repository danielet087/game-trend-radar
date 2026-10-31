const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const I = require('../assets/radar-insights-v1.js');
const script = readFileSync(join(__dirname, '..', 'assets/radar-enhancements-v1.js'), 'utf8');
const steam = (overrides = {}) => ({ appid: 42, type: 'added', name: 'Steam game', date: '2026-11-05', at: '2026-10-03T16:40:12Z', ...overrides });
const nintendo = (overrides = {}) => ({ source: 'nintendo', igdb_id: 42, game_id: 'igdb:42', platforms: ['NS2'], type: 'added', name: 'Nintendo game', date: '2026-11-05', at: '2026-10-04T02:30:00Z', ...overrides });

test('activity keeps equal numeric Steam and Nintendo identities separate with source-specific links', () => {
  const events = I.activityEvents([steam(), nintendo()]);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(I.activityURL), ['./game.html?igdb=42&date=2026-11-05', './game.html?appid=42']);
  assert.equal(events[0].appid, undefined);
  assert.equal(events[1].igdb_id, undefined);
  assert.equal(I.activityURL(steam({ source: 'steam' })), './game.html?appid=42');
});

test('Nintendo native platform labels use only the platforms involved in an event', () => {
  assert.equal(I.activityPlatform(nintendo({ platforms: ['NS'] })), 'NS');
  assert.equal(I.activityPlatform(nintendo()), 'NS2');
  assert.equal(I.activityPlatform(nintendo({ platforms: ['NS2', 'NS', 'NS2'] })), 'NS／NS2');
  assert.equal(I.activityPlatform(steam()), 'Steam');
  assert.equal(I.activityEvent(nintendo({ type: 'platform_added' })).type, 'platform_added');
  assert.equal(I.activityEvent(steam({ type: 'platform_added' })), null);
});

test('activity reasons describe the triggering collector independently of platform identity', () => {
  const examples = [
    [steam({ update_reason: 'steam_daily_search' }), '每日 Steam 搜尋'],
    [steam({ update_reason: 'twitch_rankings' }), 'Twitch 排行榜'],
    [steam({ type: 'release_date', previous_date: '2026-10-30', update_reason: 'steam_official_verification' }), 'Steam 官方驗證'],
    [steam({ update_reason: 'steam_metadata_refresh' }), 'Steam 資料更新'],
    [steam({ update_reason: 'steam_catalog_sync' }), 'Steam 清單同步'],
    [steam({ update_reason: 'steam_recent_release' }), 'Steam 新上市補入'],
    [nintendo({ platforms: ['PS5'], update_reason: 'igdb_update' }), 'IGDB 更新'],
  ];
  for (const [event, label] of examples) {
    assert.equal(I.activityEvent(event).update_reason, event.update_reason);
    assert.equal(I.activityReason(event), label);
    assert.equal(I.activityEvent(event).source, event.source || 'steam');
  }
  assert.equal(I.activityPlatform(examples[1][0]), 'Steam');
  assert.equal(I.activityURL(examples[1][0]), './game.html?appid=42');
  assert.equal(I.activityReason(steam({ source: 'twitch' })), null);
});

test('missing or unknown activity reasons preserve valid history without guessing a Steam collector', () => {
  assert.equal(I.activityReason(steam()), '更新來源未記錄');
  assert.equal(I.activityReason(nintendo()), 'IGDB 更新');
  for (const update_reason of ['unknown', 'toString', '<img src=x onerror=alert(1)>', null, 7, {}]) {
    for (const factory of [steam, nintendo]) {
      const event = factory({ update_reason });
      assert.equal(I.activityEvent(event).update_reason, 'legacy_unrecorded');
      assert.equal(I.activityReason(event), '更新來源未記錄');
      assert.ok(I.activityURL(event));
    }
  }
  const context = vm.createContext({});
  const source = readFileSync(join(__dirname, '..', 'src/features/insights/metrics.js'), 'utf8')
    .replace(/export \{ RadarInsights \};\s*export default RadarInsights;/, 'globalThis.insights = RadarInsights;');
  vm.runInContext(source, context);
  for (const event of [steam(), steam({ update_reason: 'twitch_rankings' }), nintendo(), nintendo({ update_reason: 'unknown' })]) {
    assert.equal(context.insights.activityReason(event), I.activityReason(event));
    assert.deepEqual(JSON.parse(JSON.stringify(context.insights.activityEvent(event))), I.activityEvent(event));
  }
});

test('PS5 activity shares stable IGDB identity while distinguishing native platform additions', () => {
  const original = nintendo();
  const port = nintendo({ platforms: ['PS5'], type: 'platform_added', date: '2026-12-01', at: '2026-10-04T03:00:00Z' });
  const events = I.activityEvents([original, port, { ...port, id: 'duplicate-receipt' }]);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(I.activityPlatform), ['PS5', 'NS2']);
  assert.equal(I.activityURL(events[0]), './game.html?igdb=42&date=2026-12-01');
  assert.equal(I.activityPlatform(nintendo({ platforms: ['PS5', 'NS2', 'NS', 'PS5'] })), 'NS／NS2／PS5');
  assert.equal(I.activityEvent(nintendo({ platforms: ['PS4'] })), null);
});

test('ambiguous, forged or unsupported source identities never become navigable game links', () => {
  const bad = [
    steam({ source: 'other' }), steam({ source: null }), steam({ source: 'nintendo' }),
    steam({ igdb_id: 42 }), steam({ game_id: 'igdb:42' }), steam({ appid: '42' }),
    steam({ appid: 0 }), steam({ appid: Number.MAX_SAFE_INTEGER }),
    nintendo({ source: undefined }), nintendo({ source: 'steam' }), nintendo({ appid: 42 }),
    nintendo({ igdb_id: '42' }), nintendo({ igdb_id: -42 }), nintendo({ game_id: 'igdb:43' }),
    nintendo({ platforms: [] }), nintendo({ platforms: ['NS2', 'PC'] }),
    nintendo({ platforms: ['Switch'] }), nintendo({ platforms: 'NS2' }),
    nintendo({ type: 'removed' }), nintendo({ name: '  ' }),
  ];
  for (const value of bad) {
    assert.equal(I.activityEvent(value), null, JSON.stringify(value));
    assert.equal(I.activityURL(value), null);
  }
  assert.deepEqual(I.activityEvents(bad), []);
});

test('activity requires genuine dates and explicit valid timestamp offsets, including Taipei midnight', () => {
  const bad = ['2026-10-04T10:30:00', '2026-02-30T01:00:00Z', '2026-10-04T24:00:00Z',
    '2026-10-04T10:60:00Z', '2026-10-04T10:30:60Z', '2026-10-04T10:30:00+25:00',
    '2026-10-04T10:30:00+08:60', '2026-10-04', 'invalid'];
  for (const at of bad) assert.equal(I.activityEvent(nintendo({ at })), null, at);
  assert.equal(I.activityEvent(nintendo({ date: '2026-02-30' })), null);
  assert.equal(I.activityEvent(nintendo({ at: '2026-10-04T10:30:00.123+08:00' })).at, '2026-10-04T10:30:00.123+08:00');
  assert.equal(I.taipeiDay(I.activityEvent(steam()).at), '2026-10-04');
});

test('date changes retain their valid earlier release date for both source formats', () => {
  for (const factory of [steam, nintendo]) {
    const changed = factory({ type: 'release_date', previous_date: '2026-10-30' });
    assert.equal(I.activityEvent(changed).previous_date, '2026-10-30');
    for (const previous_date of [undefined, '2026-02-30', '2026-11-05'])
      assert.equal(I.activityEvent({ ...changed, previous_date }), null);
  }
});

test('mixed history is chronologically sorted, semantically deduplicated and bounded without mutating input', () => {
  const input = [steam(), nintendo(), nintendo({ at: '2026-10-04T10:30:00+08:00', id: 'different-hash' }),
    nintendo({ platforms: ['NS'], name: 'different platform' }),
    ...Array.from({ length: 410 }, (_, index) => steam({ appid: index + 100, at: new Date(Date.UTC(2026, 9, 4, 3, index)).toISOString() }))];
  const copy = structuredClone(input);
  const events = I.activityEvents(input);
  assert.equal(events.length, 400);
  assert.equal(events[0].appid, 509);
  assert.equal(events.at(-1).appid, 110);
  assert.deepEqual(input, copy);
  const sameId = I.activityEvents(input.slice(0, 4));
  assert.equal(sameId.length, 3);
  assert.deepEqual(sameId.map(I.activityPlatform), ['NS2', 'NS', 'Steam']);
});

class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.dataset = {}; this.children = []; this.attributes = {};
    this.listeners = {}; this._text = ''; this.hidden = false; this.clientHeight = 42; this.open = false;
    this.classList = { toggle() {}, add() {}, remove() {}, contains: () => false };
  }
  set textContent(value) { this._text = String(value ?? ''); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_value) { throw new Error('Activity data must never be inserted as markup'); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(key, callback) { this.listeners[key] = callback; }
  append(...children) { children.forEach(child => { child.parent = this; this.children.push(child); }); }
  replaceChildren(...children) { this._text = ''; this.children = []; this.append(...children); }
  get lastElementChild() { return this.children.at(-1); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  querySelector() { return null; }
  matches() { return false; }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; this.listeners.close?.(); }
}
async function display(events, animated = false, payloadOverrides = {}, modular = false) {
  const elements = new Map(['activityTicker', 'activityViewport', 'activityTrack', 'activityPause', 'activityMore', 'activityDialog', 'activityList', 'activityClose'].map(id => [id, new Element()]));
  const frames = [], timeouts = [];
  if (animated) elements.get('activityTrack').animate = keyframes => { frames.push(keyframes); return { finished: Promise.resolve(), cancel() {} }; };
  const payload = { version: 1, events, ...payloadOverrides };
  const window = { RadarInsights: I, RadarMotion: { enabled: animated },
    RadarStorage: { readJSON: async (_url, validate) => validate(payload) ? payload : null }, addEventListener() {} };
  const document = { body: new Element('body'), referrer: '', hidden: false,
    createElement: tag => new Element(tag), getElementById: id => elements.get(id) || null,
    querySelectorAll: () => [], addEventListener() {} };
  const context = vm.createContext({ window, document,
    location: { origin: 'https://example.test', pathname: '/index.html', search: '', href: 'https://example.test/index.html' },
    localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null },
    performance: { getEntriesByType: () => [] }, URL, setTimeout: callback => { timeouts.push(callback); return timeouts.length; },
    clearTimeout() {}, queueMicrotask, console });
  if (modular) {
    const source = readFileSync(join(__dirname, '..', 'src/shared/interactions/activity.js'), 'utf8')
      .replace('export function createActivity', 'function createActivity');
    vm.runInContext(source, context);
    vm.runInContext(`createActivity({ insights: window.RadarInsights, storage: window.RadarStorage, motion: window.RadarMotion,
      helpers: { make(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className;
        if (text !== undefined) node.textContent = text; return node; } } });`, context);
  } else vm.runInContext(script, context);
  await new Promise(resolve => setImmediate(resolve));
  return { elements, frames, timeouts };
}

test('actual ticker and history render safe mixed-source names with Taipei date first and correct detail routes', async () => {
  const name = '<img src=x onerror=alert(1)> & Nintendo';
  const { elements: e } = await display([steam({ update_reason: 'twitch_rankings' }), nintendo({ name }), nintendo({ type: 'release_date', previous_date: '2026-10-30', at: '2026-10-04T02:31:00Z' })]);
  const rows = e.get('activityList').children.map(item => item.children[0]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].children[0].tagName, 'time');
  assert.equal(rows[0].children[0].textContent, '2026/10/04');
  assert.equal(rows[0].children[0].dateTime, '2026-10-04');
  assert.equal(rows[0].href, './game.html?igdb=42&date=2026-11-05');
  assert.match(rows[0].textContent, /日期更新IGDB 更新NS2Nintendo game2026\/10\/30 → 2026\/11\/05/);
  assert.equal(rows[1].children[4].textContent, name);
  assert.equal(rows[1].attributes['aria-label'], rows[1].title);
  assert.equal(rows[2].href, './game.html?appid=42');
  assert.equal(rows[2].children[0].textContent, '2026/10/04');
  assert.equal(rows[2].children[2].textContent, 'Twitch 排行榜');
  assert.equal(rows[2].children[2].className, 'activity-kind activity-origin');
  assert.equal(rows[2].children[2].title, '更新原因：Twitch 排行榜；平台：Steam');
  assert.match(rows[2].attributes['aria-label'], /更新原因：Twitch 排行榜；平台：Steam/);
  assert.equal(e.get('activityTrack').children[0].href, rows[0].href);
  assert.equal(e.get('activityMore').disabled, false);
});

test('platform additions show their IGDB trigger and retain native platform context in accessible titles', async () => {
  for (const platform of ['NS', 'PS5']) {
    const { elements: e } = await display([nintendo({ type: 'platform_added', platforms: [platform], name: 'Native port' })]);
    const link = e.get('activityTrack').children[0];
    assert.ok(link.textContent.includes('新增平台IGDB 更新' + platform + 'Native port2026/11/05 上市'));
    assert.equal(link.children[2].title, '更新原因：IGDB 更新；平台：' + platform);
    assert.equal(link.children[0].textContent, '2026/10/04');
    assert.doesNotMatch(link.textContent, /NS2/);
    e.get('activityMore').listeners.click();
    assert.equal(e.get('activityDialog').open, true);
    assert.equal(e.get('activityList').children[0].children[0].textContent, link.textContent);
  }
});

test('daily Steam date changes retain the recorded cause rather than inferring it from event type', async () => {
  const { elements: e } = await display([steam({ type: 'release_date', previous_date: '2026-10-30', update_reason: 'steam_daily_search' })]);
  const link = e.get('activityTrack').children[0];
  assert.match(link.textContent, /日期更新每日 Steam 搜尋SteamSteam game2026\/10\/30 → 2026\/11\/05/);
  assert.equal(link.children[2].title, '更新原因：每日 Steam 搜尋；平台：Steam');
  const { elements: legacy } = await display([steam({ type: 'release_date', previous_date: '2026-10-30' })]);
  assert.equal(legacy.get('activityTrack').children[0].children[2].textContent, '更新來源未記錄');
});

for (const modular of [false, true]) {
  test(`${modular ? 'modular' : 'legacy'} ticker and history visibly identify only the platforms of each date or launch`, async () => {
    const input = [
      nintendo({ type: 'release_date', previous_date: '2026-10-30', platforms: ['PS5', 'NS2', 'NS', 'NS2'], name: 'Shared date change', at: '2026-10-04T05:00:00Z' }),
      steam({ type: 'release_date', previous_date: '2026-10-30', name: 'Steam date change', at: '2026-10-04T04:00:00Z' }),
      nintendo({ platforms: ['NS'], name: 'NS launch', date: '2026-11-05', at: '2026-10-04T03:00:00Z' }),
      nintendo({ platforms: ['NS2'], name: 'NS2 launch', date: '2026-12-01', at: '2026-10-04T02:00:00Z' }),
      nintendo({ type: 'platform_added', platforms: ['PS5'], name: 'PS5 launch', at: '2026-10-04T01:00:00Z' }),
    ];
    const { elements: e } = await display(input, false, {}, modular);
    const rows = e.get('activityList').children.map(item => item.children[0]);
    const labels = rows.map(row => row.children.find(child => child.className === 'activity-kind activity-platform'));
    assert.deepEqual(labels.map(label => label.textContent), ['NS／NS2／PS5', 'Steam', 'NS', 'NS2', 'PS5']);
    assert.equal(e.get('activityTrack').children[0].children[3].textContent, 'NS／NS2／PS5');
    assert.equal(rows[0].children[1].textContent, '日期更新');
    assert.equal(rows[0].children[5].textContent, '2026/10/30 → 2026/11/05');
    assert.equal(rows[2].children[5].textContent, '2026/11/05 上市');
    assert.equal(rows[3].children[5].textContent, '2026/12/01 上市');
    assert.match(rows[0].attributes['aria-label'], /NS／NS2／PS5/);
  });
}

test('vertical ticker still flips upward through only the latest eight valid mixed events', async () => {
  const events = Array.from({ length: 10 }, (_, index) => (index % 2 ? steam : nintendo)({
    ...(index % 2 ? {} : { platforms: index % 4 ? ['NS2'] : ['PS5'] }),
    name: 'Game ' + index, at: new Date(Date.UTC(2026, 9, 4, 2, index)).toISOString() }));
  const { elements: e, frames, timeouts } = await display(events, true);
  assert.equal(e.get('activityList').children.length, 10);
  assert.match(e.get('activityTrack').textContent, /Game 9/);
  timeouts.at(-1)();
  assert.deepEqual(JSON.parse(JSON.stringify(frames[0])), [{ transform: 'translateY(0)' }, { transform: 'translateY(-42px)' }]);
  assert.equal(e.get('activityTrack').children[1].attributes['aria-hidden'], 'true');
  assert.equal(e.get('activityTrack').children[1].tabIndex, -1);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(e.get('activityTrack').textContent, /Game 8/);
  for (let index = 0; index < 7; index++) { timeouts.at(-1)(); await new Promise(resolve => setImmediate(resolve)); }
  assert.match(e.get('activityTrack').textContent, /Game 9/);
  assert.doesNotMatch(e.get('activityTrack').textContent, /Game [01]/);
});

test('invalid or missing activity stays non-navigable and hides unused controls', async () => {
  for (const overrides of [{}, { version: 2 }]) {
    const { elements: e } = await display([nintendo({ appid: 42 }), steam({ at: 'missing' })], false, overrides);
    assert.equal(e.get('activityMore').hidden, true);
    assert.equal(e.get('activityPause').hidden, true);
    assert.equal(e.get('activityList').children.length, 0);
    assert.equal(e.get('activityTrack').children[0].tagName, 'span');
  }
});
