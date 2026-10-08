import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVED_STORAGE_KEY, SAVED_CHANGE_EVENT, readSaved, savedCount, isSaved,
  registerSavedGames, toggleSaved, subscribeSaved,
} from '../src/shared/state/favorites.ts';
import {
  MOTION_STORAGE_KEY, MOTION_CHANGE_EVENT, readMotion, setMotionPreference,
  toggleMotion, subscribeMotion,
} from '../src/shared/state/motion.ts';

function browserFixture() {
  const values = new Map();
  const browser = new EventTarget();
  const document = new EventTarget();
  const media = new EventTarget();
  const classes = new Set();
  const fixture = { browser, document, media, values, classes, blocked:false, cancellations:0 };
  media.matches = false;
  browser.matchMedia = () => media;
  browser.localStorage = {
    getItem(key) {
      if (fixture.blocked) throw new Error('Storage access denied');
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (fixture.blocked) throw new Error('Storage access denied');
      values.set(key, value);
    },
  };
  document.body = { classList:{
    toggle(name, active) { active ? classes.add(name) : classes.delete(name); },
  } };
  document.documentElement = { style:{} };
  document.getAnimations = () => [{ cancel() { fixture.cancellations++; } }];
  fixture.storage = (key, newValue) => {
    // In a real cross-tab event the shared storage has changed before dispatch.
    if (key === null) values.clear();
    else if (newValue === null) values.delete(key);
    else values.set(key, newValue);
    browser.dispatchEvent(Object.assign(new Event('storage'), { key, newValue }));
  };
  fixture.reduced = value => {
    media.matches = value;
    media.dispatchEvent(new Event('change'));
  };
  return fixture;
}

test('shared source stores preserve collection and motion behavior across components', async t => {
  const fixture = browserFixture();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', { configurable:true, value:fixture.browser });
  Object.defineProperty(globalThis, 'document', { configurable:true, value:fixture.document });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
  });
  fixture.values.set(SAVED_STORAGE_KEY, JSON.stringify([
    42, 'igdb:84', 'igdb:85', 900, 42, 'igdb:084', 0, -7, null, '42',
  ]));

  await t.test('Steam numbers and IGDB aliases remain valid while invalid IDs are ignored', () => {
    assert.deepEqual([...readSaved()], [42, 'igdb:84', 'igdb:85', 900]);
    assert.equal(savedCount(), 4);
    const componentCopy = readSaved();
    componentCopy.clear();
    assert.equal(readSaved().size, 4, 'a component cannot mutate the shared collection via its copy');
  });

  await t.test('merged and transitive aliases count as one game without rewriting saved IDs', () => {
    const persistentIds = fixture.values.get(SAVED_STORAGE_KEY);
    registerSavedGames([
      { appid:42, savedAliases:[42, 'igdb:84'] },
      { appid:'igdb:84', savedAliases:['igdb:84', 'igdb:85'] },
    ]);
    assert.equal(savedCount(), 2);
    assert.deepEqual([...readSaved()], [42, 'igdb:84', 'igdb:85', 900]);
    assert.equal(fixture.values.get(SAVED_STORAGE_KEY), persistentIds);
    assert.equal(isSaved('igdb:85'), true);
  });

  await t.test('cancelling from any version removes every registered alias and preserves unrelated games', () => {
    const result = toggleSaved(42);
    assert.equal(result.saved, false);
    assert.equal(result.durable, true);
    assert.deepEqual([...readSaved()], [900]);
    assert.deepEqual(JSON.parse(fixture.values.get(SAVED_STORAGE_KEY)), [900]);
    assert.equal(toggleSaved('igdb:85').saved, true);
    assert.equal(isSaved(42), true, 'the Steam version reflects an IGDB save');
    toggleSaved({ appid:42, savedAliases:[42, 'igdb:84'] });
    assert.deepEqual([...readSaved()], [900], 'even the indirectly registered IGDB alias is removed');
  });

  await t.test('blocked storage keeps one session collection for all readers and subscribers', () => {
    fixture.blocked = true;
    const firstComponent = [], secondComponent = [];
    const firstStop = subscribeSaved(value => firstComponent.push(value));
    const secondStop = subscribeSaved(value => secondComponent.push(value));
    try {
      const result = toggleSaved(700);
      assert.equal(result.saved, true);
      assert.equal(result.durable, false);
      assert.equal(readSaved().has(700), true);
      assert.equal(fixture.browser.RadarSaved.read().has(700), true);
      assert.equal(secondComponent.at(-1).ids.has(700), true);
      firstComponent.at(-1).ids.clear();
      assert.equal(secondComponent.at(-1).ids.has(700), true, 'subscriber snapshots are independent');
      assert.equal(readSaved().has(700), true);
      fixture.browser.RadarSaved.toggle('igdb:701');
      assert.equal(firstComponent.at(-1).ids.has('igdb:701'), true);
      assert.equal(secondComponent.at(-1).durable, false);
      assert.equal(firstComponent.length, 3);
      assert.equal(secondComponent.length, 3);
      assert.deepEqual(JSON.parse(fixture.values.get(SAVED_STORAGE_KEY)), [900]);
    } finally {
      firstStop(); secondStop(); fixture.blocked = false;
    }
    toggleSaved(700);
    assert.equal(firstComponent.length, 3, 'unsubscribed components no longer receive changes');
  });

  await t.test('cross-tab changes update readers and counts; invalid or unrelated writes do not erase them', () => {
    registerSavedGames([{ appid:1000, savedAliases:[1000, 'igdb:2000'] }]);
    const received = [];
    const stop = subscribeSaved(value => received.push(value), { immediate:false });
    try {
      fixture.storage(SAVED_STORAGE_KEY, JSON.stringify([1000, 'igdb:2000']));
      assert.deepEqual([...readSaved()], [1000, 'igdb:2000']);
      assert.equal(savedCount(), 1);
      assert.equal(received.at(-1).count, 1);
      assert.equal(received.at(-1).durable, true);
      fixture.storage('another-app:collection', '[]');
      fixture.storage(SAVED_STORAGE_KEY, '{malformed');
      assert.deepEqual([...readSaved()], [1000, 'igdb:2000']);
      assert.equal(received.length, 1);
      fixture.storage(null, null);
      assert.equal(readSaved().size, 0);
      assert.equal(received.at(-1).count, 0);
    } finally { stop(); }
  });

  await t.test('a legacy same-tab announcement refreshes the shared store once', () => {
    const received = [];
    const stop = subscribeSaved(value => received.push(value), { immediate:false });
    try {
      fixture.values.set(SAVED_STORAGE_KEY, JSON.stringify([333]));
      fixture.document.dispatchEvent(new Event(SAVED_CHANGE_EVENT));
      assert.deepEqual([...readSaved()], [333]);
      assert.equal(received.length, 1, 'the shared announcement does not recurse into another refresh');
    } finally { stop(); }
  });

  await t.test('device reduced-motion takes priority over the saved on preference and the toggle', () => {
    fixture.values.set(MOTION_STORAGE_KEY, 'on');
    fixture.media.matches = true;
    const state = readMotion();
    assert.deepEqual(state, { enabled:false, reduced:true, preference:'on' });
    assert.equal(fixture.browser.RadarMotion.enabled, false);
    assert.equal(fixture.classes.has('motion-off'), true);
    assert.equal(fixture.document.documentElement.style.scrollBehavior, 'auto');
    assert.equal(toggleMotion().enabled, false);
    assert.equal(fixture.values.get(MOTION_STORAGE_KEY), 'on');
    fixture.reduced(false);
    assert.equal(readMotion().enabled, true, 'the saved preference resumes when the device setting permits it');
    assert.equal(fixture.classes.has('motion-on'), true);
    assert.equal(fixture.classes.has('motion-off'), false);
  });

  await t.test('motion subscribers, the DOM and compatibility readers stay synchronized', () => {
    const received = [];
    let announcements = 0;
    const announce = () => { announcements++; };
    fixture.document.addEventListener(MOTION_CHANGE_EVENT, announce);
    const stop = subscribeMotion(value => received.push(value));
    try {
      setMotionPreference('off');
      fixture.reduced(true);
      fixture.reduced(false);
      assert.equal(readMotion().enabled, false, 'explicit off survives reduced-motion setting changes');
      assert.equal(fixture.browser.RadarMotion.enabled, false);
      fixture.storage(MOTION_STORAGE_KEY, 'on');
      assert.equal(readMotion().enabled, true);
      assert.equal(received.at(-1).enabled, true);
      assert.equal(fixture.document.documentElement.style.scrollBehavior, 'smooth');
      fixture.storage(MOTION_STORAGE_KEY, 'off');
      assert.equal(received.at(-1).enabled, false);
      assert.equal(fixture.browser.RadarMotion.enabled, false);
      assert.equal(announcements, 5);
      assert.ok(fixture.cancellations >= 4, 'disabled motion cancels animations already in progress');
    } finally {
      stop();
      fixture.document.removeEventListener(MOTION_CHANGE_EVENT, announce);
    }
  });
});
