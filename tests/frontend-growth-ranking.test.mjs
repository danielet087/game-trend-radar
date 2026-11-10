import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInsightsContext } from '../src/features/insights/context.js';
import { createGrowthView } from '../src/features/insights/growth.js';
import { RadarInsights } from '../src/features/insights/metrics.js';

const today = '2026-11-10';
const observation = (day, followers) => ({ at:`${day}T01:00:00Z`, followers, source:'steam_community' });

function element(tag, className = '', text = '') {
  return { tag, className, textContent:text, children:[], dataset:{}, value:'', hidden:false,
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
  };
}

function fixture(search = '') {
  const elements = new Map();
  const document = {
    body:{ dataset:{ page:'growth' } },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element('div'));
      return elements.get(id);
    },
    querySelectorAll:() => [],
  };
  const ctx = createInsightsContext({ document, today,
    window:{ location:new URL(`https://example.com/growth.html${search}`) },
    enhancements:{ make:element },
  });
  const histories = new Map();
  const add = (appid, baseline, latest, { date = '2026-12-01', stale = false } = {}) => {
    const latestDay = stale ? '2026-11-07' : today;
    ctx.state.games.push({ appid, name:`Game ${appid}`, nameEn:'', date, followers:latest });
    histories.set(appid, [
      ...[1, 7, 30].flatMap(span => baseline === null ? [] : [observation(RadarInsights.offset(latestDay, -span), baseline)]),
      observation(latestDay, latest),
    ]);
  };
  // Deliberately give the larger game both more total followers and more new followers.
  add(1, 100000, 110000);
  add(2, 5000, 6000);
  add(3, 8000, 8000);
  add(4, 10000, 9000);
  add(5, 0, 5000);
  add(6, null, 6000);
  add(7, 5000, 10000, { stale:true });
  add(8, 5000, 20000, { date:'2026-10-10' });
  add(9, 5000, 20000, { date:'2027-11-11' });
  add(10, 6000, 6600);
  ctx.state.growthData = { version:1 };
  const view = createGrowthView(ctx, {
    history:game => histories.get(game.appid),
    cover:() => element('div'), gameLink:game => element('a', '', game.name),
    sparkline:() => element('svg'), empty:() => element('div'),
  });
  return { ctx, view, add, get:id => document.getElementById(id) };
}

for (const span of [1, 7, 30]) {
  test(`${span}-day growth ranks and displays percentages across different follower scales`, () => {
    const { ctx, view, get } = fixture();
    ctx.state.span = span;
    view.render();
    const rows = get('growthRows').children;
    assert.deepEqual(rows.map(row => row.dataset.appid), [2, 1, 10, 3, 4]);
    const changes = rows.map(row => row.children.find(child => child.className.startsWith('growth-change')));
    assert.deepEqual(changes.map(change => change.children[0].textContent), ['+20.0%', '+10.0%', '+10.0%', '0.0%', '-10.0%']);
    assert.ok(changes.every(change => change.children[1].textContent === `${span} 日成長率`));
    assert.match(changes.at(-1).className, /is-down/);
    assert.match(get('growthResultCount').textContent, new RegExp(`^${span} 日成長率榜`));
    assert.equal(get('growthRanked').textContent, '5');
    assert.equal(get('growthTracked').textContent, '8');
  });
}

test('zero baselines, absent history and stale observations remain outside the percentage ranking', () => {
  const { view, get } = fixture();
  view.render();
  assert.equal(get('growthPending').textContent, '3');
  const pending = get('pendingList').children;
  assert.deepEqual(pending.map(row => row.children[0].textContent), ['Game 5', 'Game 6', 'Game 7']);
  assert.deepEqual(pending.map(row => row.children[1].textContent), ['基準日關注數為 0', '歷史累積中', '等待更新']);
});

test('legacy absolute-count sort links keep percentage ranking through period, scope and search changes', () => {
  const { ctx, view, get } = fixture('?sort=delta&days=1');
  const top = () => get('growthRows').children[0].dataset.appid;
  view.render();
  assert.equal(top(), 2);
  ctx.state.span = 30;
  ctx.state.scope = 'future';
  view.render();
  assert.equal(top(), 2);
  get('growthSearch').value = 'Game 1';
  view.render();
  assert.deepEqual(get('growthRows').children.map(row => row.dataset.appid), [1, 10]);
});

for (const span of [1, 7, 30]) {
  test(`${span}-day ranking includes 5,000 and excludes 4,999 based on the latest measurement`, () => {
    const { ctx, view, add, get } = fixture();
    ctx.state.span = span;
    add(11, 1, 4999);
    add(12, 4000, 5000);
    add(13, null, 4999);
    add(14, null, 5000);
    ctx.state.games.find(game => game.appid === 11).followers = 50000;
    ctx.state.games.find(game => game.appid === 12).followers = 1;
    view.render();
    const ranked = get('growthRows').children.map(row => row.dataset.appid);
    assert.ok(ranked.includes(12), 'a new official measurement can cross the threshold');
    assert.ok(!ranked.includes(11), 'an old catalog count cannot keep a game qualified');
    const pending = get('pendingList').children.map(row => row.children[0].textContent);
    assert.ok(pending.includes('Game 14'));
    assert.ok(!pending.includes('Game 13'), 'games below the threshold do not appear as accumulating');
    assert.equal(get('growthTracked').textContent, '10');
  });
}
