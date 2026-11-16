const { test } = require('node:test');
const assert = require('node:assert/strict');
const W = require('../scripts/radar-watchdog.cjs');

const NOW = Date.parse('2026-11-16T10:50:00Z');
const hoursAgo = hours => new Date(NOW - hours * 3600000).toISOString();
const spec = W.RECEIPTS[0];

function fakeGithub({ files = {}, dirs = {}, runs = [], scheduled = {}, issues = [] } = {}) {
  const calls = [];
  const notFound = () => Object.assign(new Error('Not Found'), { status: 404 });
  const github = { rest: {
    repos: { async getContent({ repo, path, ref }) {
      const id = `${repo}@${ref}:${path}`;
      if (id in dirs) return { data: dirs[id] };
      if (id in files) return { data: JSON.stringify(files[id]) };
      throw notFound();
    } },
    actions: {
      async listWorkflowRunsForRepo() { return { data: { workflow_runs: runs } }; },
      async listWorkflowRuns({ repo, workflow_id }) { return { data: { workflow_runs: scheduled[`${repo}/${workflow_id}`] || [] } }; },
    },
    issues: {
      async listForRepo() { return { data: issues }; },
      async createLabel(args) { calls.push(['createLabel', args]); },
      async create(args) { calls.push(['create', args]); return { data: { number: 7 } }; },
      async update(args) { calls.push(['update', args]); },
      async createComment(args) { calls.push(['comment', args]); },
    },
  } };
  return { github, calls };
}
const context = { repo: { owner: 'danielet087', repo: 'game-trend-radar' } };
const core = { info() {}, warning() {} };

test('receipts alert only past their limit or without a valid time', () => {
  assert.deepEqual(W.receiptProblems([{ spec, value: { completed_at: hoursAgo(2.5) } }], NOW), []);
  const [late] = W.receiptProblems([{ spec, value: { completed_at: hoursAgo(4.25) } }], NOW);
  assert.equal(late.key, 'receipt:data/twitch_collection_status.json');
  assert.match(late.text, /4\.3 小時前（2026-11-16 14:35）/);
  assert.equal(W.receiptProblems([{ spec, value: null }], NOW).length, 1);
  assert.equal(W.receiptProblems([{ spec, value: { completed_at: '2026-11-16 10:00' } }], NOW).length, 1);
});

test('failure streaks, Pages deployments and scheduled runs', () => {
  const counter = n => ({ repo: 'r', workflow: 'w.yml', state: { consecutive_failures: n, updated_at: hoursAgo(1) } });
  assert.deepEqual(W.streakProblems([counter(W.FAILURE_STREAK - 1)]), []);
  assert.match(W.streakProblems([counter(W.FAILURE_STREAK)])[0].text, /連續失敗 3 次/);
  const run = (conclusion, hours) => ({ name: 'pages build and deployment', status: 'completed', conclusion, created_at: hoursAgo(hours) });
  assert.equal(W.pagesProblems([run('failure', 1), run('cancelled', 1.5), run('failure', 2)]).length, 1);
  assert.deepEqual(W.pagesProblems([run('failure', 1), run('success', 2)]), []);
  assert.deepEqual(W.pagesProblems([run('failure', 1)]), []);
  const [scheduled] = W.SCHEDULED;
  assert.equal(W.scheduledProblems([{ spec: scheduled, run: { conclusion: 'failure', created_at: hoursAgo(6) } }]).length, 1);
  assert.deepEqual(W.scheduledProblems([{ spec: scheduled, run: { conclusion: 'success', created_at: hoursAgo(6) } },
    { spec: scheduled, run: null }]), []);
});

test('the issue body records its problem keys and mentions the owner', () => {
  const body = W.issueBody([{ key: 'b', text: 'B' }, { key: 'a', text: 'A' }], NOW);
  assert.match(body, /^<!-- radar-watchdog keys=\["a","b"\] -->/);
  assert.match(body, /@danielet087 /);
  assert.deepEqual([...W.previousKeys(body)], ['a', 'b']);
  assert.deepEqual([...W.previousKeys('no marker')], []);
});

test('opens one labelled issue, comments only on new problems and closes on recovery', async () => {
  const problems = [{ key: 'a', text: 'A' }];
  let fake = fakeGithub();
  await W.report({ ...fake, context, core, problems, errors: [], now: NOW });
  assert.deepEqual(fake.calls.map(([name]) => name), ['createLabel', 'create']);
  assert.deepEqual(fake.calls[1][1].labels, [W.LABEL]);
  const open = { number: 7, body: W.issueBody(problems, NOW) };
  fake = fakeGithub({ issues: [open] });
  await W.report({ ...fake, context, core, problems, errors: [], now: NOW });
  assert.deepEqual(fake.calls.map(([name]) => name), ['update']);
  fake = fakeGithub({ issues: [open] });
  await W.report({ ...fake, context, core, problems: [...problems, { key: 'b', text: 'B' }], errors: [], now: NOW });
  assert.deepEqual(fake.calls.map(([name]) => name), ['update', 'comment']);
  assert.match(fake.calls[1][1].body, /- B/);
  assert.doesNotMatch(fake.calls[1][1].body, /- A/);
  fake = fakeGithub({ issues: [open] });
  await W.report({ ...fake, context, core, problems: [], errors: ['counters unavailable'], now: NOW });
  assert.deepEqual(fake.calls, []);
  fake = fakeGithub({ issues: [open] });
  await W.report({ ...fake, context, core, problems: [], errors: [], now: NOW });
  assert.deepEqual(fake.calls.map(([name]) => name), ['comment', 'update']);
  assert.equal(fake.calls[1][1].state, 'closed');
});

test('run reads receipts, counters and runs from GitHub', async () => {
  const files = Object.fromEntries(W.RECEIPTS.map(item => [`game-trend-radar@main:${item.path}`, { [item.field]: hoursAgo(1) }]));
  files['game-trend-radar@main:data/twitch_collection_status.json'] = { completed_at: hoursAgo(5) };
  files['game-trend-radar-twitch-backend@radar-notification-state:workflows/collect.yml.json'] =
    { consecutive_failures: 4, updated_at: hoursAgo(1) };
  const dirs = { 'game-trend-radar-twitch-backend@radar-notification-state:workflows':
    [{ type: 'file', name: 'collect.yml.json', path: 'workflows/collect.yml.json' }] };
  const fake = fakeGithub({ files, dirs, scheduled: {
    'game-trend-radar-backend/storage-evidence-retention.yml': [{ conclusion: 'failure', created_at: hoursAgo(6) }] } });
  await W.run({ ...fake, context, core, now: NOW });
  const created = fake.calls.find(([name]) => name === 'create')[1];
  assert.equal(created.title, '雷達網站監控：3 項異常');
  assert.match(created.body, /Twitch 每小時收集：最後成功在 5\.0 小時前/);
  assert.match(created.body, /game-trend-radar-twitch-backend \/ `collect\.yml`：連續失敗 4 次/);
  assert.match(created.body, /資料庫每日清理/);
});
