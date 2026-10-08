import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTwitchPage } from '../src/features/twitch/index.js';
import { initSchedulerPage } from '../src/features/scheduler/index.js';
import { createTwitchCards } from '../src/features/twitch/cards.js';
import { RadarTwitch } from '../src/features/twitch/data.js';

class Element extends EventTarget {
  value = ''; dataset = {}; attributes = new Map(); children = [];
  setAttribute(key,value) { this.attributes.set(key,String(value)); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  remove() { this.removed = true; }
}
test('page controllers initialize once, release bindings, and ignore responses after destroy', async () => {
  const originals = {};
  const keys = ['window','document','location','history','fetch','localStorage','setInterval','clearInterval'];
  for (const key of keys) originals[key] = globalThis[key];
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id,new Element()); return elements.get(id); };
  const document = new EventTarget();
  document.getElementById = get; document.querySelectorAll = () => []; document.querySelector = () => new Element();
  document.createElement = () => new Element(); document.createDocumentFragment = () => new Element();
  const window = new EventTarget(); window.localStorage = {getItem:() => '[]',setItem:() => {}};
  const intervals = new Set(); let id = 0;
  globalThis.window = window; globalThis.document = document;
  globalThis.location = {search:'',href:'https://example.com/game-trend-radar/twitch.html'};
  globalThis.history = {replaceState() {}};
  globalThis.localStorage = window.localStorage;
  globalThis.fetch = async () => { throw new Error('offline'); };
  globalThis.setInterval = () => {const current = ++id;intervals.add(current);return current;};
  globalThis.clearInterval = current => { intervals.delete(current); };
  try {
    // Artwork and the in-card IGDB signal must not shadow the page AbortSignal.
    const data = RadarTwitch.normalize({schema_version:2,generated_at:'2026-10-08T09:00:00Z',candidate_games:[{
      game_id:'101',game_name:'Test',viewer_count:7000,streamer_count:21,median_viewer_count:0,
      box_art_url:'https://static-cdn.jtvnw.net/ttv-boxart/101-{width}x{height}.jpg',
    }]});
    const cardEvents = new AbortController();
    const cardFactory = createTwitchCards({state:{data},historyPanel:() => new Element(),signal:cardEvents.signal});
    const card = cardFactory.gameCard(data.games[0]);
    card.open = true; card.dispatchEvent(new Event('toggle'));
    assert.equal(card.children.length,2); cardEvents.abort();
    const twitch = initTwitchPage();
    assert.equal(initTwitchPage(),twitch);
    assert.equal(twitch.state.savedCount,0);
    twitch.destroy(); assert.equal(twitch.state.disposed,true);
    const next = initTwitchPage(); assert.notEqual(next,twitch);
    next.destroy(); await next.refresh();
    assert.equal(next.state.disposed,true);
    const scheduler = initSchedulerPage();
    assert.equal(initSchedulerPage(),scheduler); assert.equal(intervals.size,1);
    scheduler.destroy(); assert.equal(intervals.size,0);
    const another = initSchedulerPage(); assert.notEqual(another,scheduler);
    another.destroy(); assert.equal(intervals.size,0);
    await new Promise(resolve => setTimeout(resolve,10));
    // Late failed transports must not draw error or empty-result panels.
    assert.equal(get('gameResults').children.length,0);
    assert.equal(get('errorMessage').textContent,undefined);
  } finally {
    for (const key of keys) {
      if (originals[key] === undefined) delete globalThis[key]; else globalThis[key] = originals[key];
    }
  }
});
