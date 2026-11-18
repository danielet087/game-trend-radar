const { test } = require('node:test');
const assert = require('node:assert/strict');
const W = require('../scripts/radar-watchdog.cjs');

const NOW = Date.parse('2026-11-16T10:50:00Z');
const hoursAgo = hours => new Date(NOW - hours * 3600000).toISOString();
const spec = W.RECEIPTS[0];

const LIVE = [{ id: 11, sha: 'live', statuses: [{ state: 'success', created_at: '2026-11-16T10:33:00Z' }] }];

function fakeGithub({ files = {}, dirs = {}, runs = [], scheduled = {}, issues = [], deployments = LIVE } = {}) {
  const calls = [];
  const notFound = () => Object.assign(new Error('Not Found'), { status: 404 });
  const github = { rest: {
    repos: {
      async getContent({ repo, path, ref, mediaType }) {
        const id = `${repo}@${ref}:${path}`;
        if (id in dirs) return { data: dirs[id] };
        if (!(id in files)) throw notFound();
        if (mediaType?.format === 'raw') return { data: JSON.stringify(files[id]) };
        return { data: { type: 'file', sha: 'sha-1', content: Buffer.from(JSON.stringify(files[id])).toString('base64') } };
      },
      async createOrUpdateFileContents(args) { calls.push(['write', args]); },
      async listDeployments({ environment }) {
        assert.equal(environment, 'github-pages');
        return { data: deployments.map(({ id, sha }) => ({ id, sha })) };
      },
      async listDeploymentStatuses({ deployment_id }) {
        return { data: deployments.find(item => item.id === deployment_id).statuses };
      },
    },
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
  // Receipts come from the published site, which serves the frontend's data.
  const fetchImpl = async url => {
    const match = /^https:\/\/danielet087\.github\.io\/game-trend-radar\/(.+)\?watchdog=\d+$/.exec(url);
    if (!match) throw new Error('unexpected URL ' + url);
    const id = `game-trend-radar@main:${match[1]}`;
    calls.push(['site', match[1]]);
    return id in files ? { ok: true, status: 200, json: async () => files[id] } : { ok: false, status: 404 };
  };
  return { github, calls, fetchImpl };
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
  const actions = (conclusion, hours) => ({ ...run(conclusion, hours), name: 'Deploy site to Pages' });
  assert.equal(W.pagesProblems([actions('failure', 1), actions('skipped', 1.2), run('failure', 2)]).length, 1);
  assert.deepEqual(W.pagesProblems([actions('failure', 1), actions('success', 1.5), run('failure', 2)]), []);
  const [scheduled] = W.SCHEDULED;
  assert.equal(W.scheduledProblems([{ spec: scheduled, run: { conclusion: 'failure', created_at: hoursAgo(6) } }]).length, 1);
  assert.deepEqual(W.scheduledProblems([{ spec: scheduled, run: { conclusion: 'success', created_at: hoursAgo(6) } },
    { spec: scheduled, run: null }]), []);
});

test('a site whose last live deploy is over three hours old alerts', () => {
  assert.deepEqual(W.deployProblems({ sha: 'a', live_at: hoursAgo(W.DEPLOY_STALE_HOURS - 0.1) }, NOW), []);
  const [stale] = W.deployProblems({ sha: 'a', live_at: hoursAgo(3.5) }, NOW);
  assert.equal(stale.key, 'pages-stale');
  assert.match(stale.text, /最後一次部署上線在 3\.5 小時前（2026-11-16 15:20）/);
  assert.match(W.deployProblems(null, NOW)[0].text, /最近 10 次部署都沒有成功上線/);
  // An unavailable deployment check is reported as unavailable, not as a problem.
  assert.deepEqual(W.findings({ receipts: [], counters: [], pages: [], latest: [] }, NOW), []);
});

test('the live deployment is the newest one whose latest status is success', async () => {
  const deployments = [
    { id: 3, sha: 'failed', statuses: [{ state: 'failure', created_at: hoursAgo(0.2) }] },
    { id: 2, sha: 'live', statuses: [{ state: 'success', created_at: hoursAgo(4) }] },
    { id: 1, sha: 'old', statuses: [{ state: 'inactive', created_at: hoursAgo(4) }] },
  ];
  const files = { ...healthyCredentials(), ...Object.fromEntries(W.RECEIPTS.map(item => [`game-trend-radar@main:${item.path}`, { [item.field]: hoursAgo(1) }])) };
  const fake = fakeGithub({ files, deployments });
  await W.run({ ...fake, context, core, now: NOW });
  const created = fake.calls.find(([name]) => name === 'create')[1];
  assert.equal(created.title, '雷達網站監控：1 項異常');
  assert.match(created.body, /最後一次部署上線在 4\.0 小時前/);
});

test('receipts are read from the published site, not from Git', async () => {
  const files = { ...healthyCredentials(), ...Object.fromEntries(W.RECEIPTS.map(item => [`game-trend-radar@main:${item.path}`, { [item.field]: hoursAgo(1) }])) };
  delete files['game-trend-radar@main:data/content_refresh_status.json'];
  const fake = fakeGithub({ files });
  const asked = [];
  const fetchImpl = async (url, options) => { asked.push([url, options]); return fake.fetchImpl(url); };
  await W.run({ ...fake, fetchImpl, context, core, now: NOW });
  assert.deepEqual(asked.map(([url]) => url), W.RECEIPTS.map(item =>
    `https://danielet087.github.io/game-trend-radar/${item.path}?watchdog=${NOW}`));
  assert.equal(asked[0][1].headers['Cache-Control'], 'no-cache');
  // A receipt the site does not serve is a problem; an unreachable site is an unavailable check.
  assert.match(fake.calls.find(([name]) => name === 'create')[1].body, /Steam 內容更新：`data\/content_refresh_status\.json` 沒有有效的/);
  const offline = fakeGithub({ files, issues: [] });
  const failing = async () => { throw new Error('network down'); };
  const warnings = [];
  await W.run({ ...offline, fetchImpl: failing, context, core: { info() {}, warning: text => warnings.push(text) }, now: NOW });
  assert.equal(warnings.filter(text => /Watchdog check unavailable: data\//.test(text)).length, W.RECEIPTS.length);
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

const daysFromNow = days => new Date(NOW + days * 86400000).toISOString();
const record = (credentials, checkedHoursAgo = 1) => ({ schema_version: 1, checked_at: hoursAgo(checkedHoursAgo), credentials });
const healthyCredentials = () => Object.fromEntries(W.CREDENTIAL_REPOS.map(repo =>
  [`${repo}@radar-notification-state:${W.CREDENTIAL_PATH}`, record([{ name: 'TURSO_AUTH_TOKEN', status: 'ok', expires_at: null }])]));

test('credentials alert 14 days ahead, when expired or invalid, and when the check stops', () => {
  const at = (credentials, hours) => W.credentialProblems([{ repo: 'r', value: record(credentials, hours) }], null, NOW);
  assert.deepEqual(at([{ name: 'A', status: 'ok', expires_at: null }, { name: 'B', status: 'ok', expires_at: daysFromNow(15) },
    { name: 'C', status: 'missing', expires_at: null }, { name: 'D', status: 'unknown', expires_at: null }]), []);
  const [soon] = at([{ name: 'A', status: 'ok', expires_at: daysFromNow(13.5) }]);
  assert.equal(soon.key, 'credential:r/A:expiring');
  assert.match(soon.text, /r \/ `A`：將在 2026-11-30 06:50 到期（剩 14 天）/);
  assert.equal(at([{ name: 'A', status: 'ok', expires_at: hoursAgo(1) }])[0].key, 'credential:r/A:expired');
  assert.match(at([{ name: 'A', status: 'invalid', detail: 'http_401' }])[0].text, /已經失效（http_401）/);
  assert.deepEqual(at([], 79), []);
  assert.match(at([], 81)[0].text, /超過 3 天沒有更新/);
  assert.match(W.credentialProblems([{ repo: 'r', value: null }], null, NOW)[0].text, /沒有有效結果/);
  const scheduler = expires => W.credentialProblems([], { status: 'ok', expires_at: expires }, NOW);
  assert.deepEqual(scheduler(null), []);
  assert.deepEqual(scheduler(daysFromNow(30)), []);
  assert.match(scheduler(daysFromNow(3))[0].text, /Cloudflare 排程器用的 GitHub token.*剩 3 天/);
});

test('only "none" or a full timestamp counts as a scheduler token report', () => {
  assert.deepEqual(W.schedulerReport('none', NOW), { schema_version: 1, status: 'ok', expires_at: null, reported_at: '2026-11-16T10:50:00Z' });
  assert.equal(W.schedulerReport('2026-12-01T00:00:00Z', NOW).expires_at, '2026-12-01T00:00:00Z');
  for (const value of [undefined, '', 'unknown', '2026-12-01', 'none; rm -rf']) assert.equal(W.schedulerReport(value, NOW), null);
});

test('a scheduler report is stored only when it changes and later runs use the stored one', async () => {
  const files = { ...healthyCredentials(), ...Object.fromEntries(W.RECEIPTS.map(item => [`game-trend-radar@main:${item.path}`, { [item.field]: hoursAgo(1) }])) };
  const dispatched = soon => ({ ...context, payload: { inputs: { scheduler_token_expires_at: soon } } });
  let fake = fakeGithub({ files });
  await W.run({ ...fake, context: dispatched(daysFromNow(5)), core, now: NOW });
  const write = fake.calls.find(([name]) => name === 'write')[1];
  assert.equal(write.branch, 'radar-notification-state');
  assert.equal(write.path, W.SCHEDULER_PATH);
  assert.match(fake.calls.find(([name]) => name === 'create')[1].body, /Worker secret `GITHUB_ACTIONS_TOKEN`/);
  files[`game-trend-radar@radar-notification-state:${W.SCHEDULER_PATH}`] = JSON.parse(Buffer.from(write.content, 'base64').toString('utf8'));
  for (const run of [dispatched(daysFromNow(5)), context]) {
    fake = fakeGithub({ files });
    await W.run({ ...fake, context: run, core, now: NOW });
    assert.deepEqual(fake.calls.filter(([name]) => name === 'write'), []);
    assert.match(fake.calls.find(([name]) => name === 'create')[1].body, /剩 5 天/);
  }
  fake = fakeGithub({ files });
  await W.run({ ...fake, context: dispatched('none'), core, now: NOW });
  assert.equal(fake.calls.filter(([name]) => name === 'write').length, 1);
  assert.equal(fake.calls.filter(([name]) => name === 'create').length, 0);
});

test('run reads receipts, counters and runs from GitHub', async () => {
  const files = Object.fromEntries(W.RECEIPTS.map(item => [`game-trend-radar@main:${item.path}`, { [item.field]: hoursAgo(1) }]));
  Object.assign(files, healthyCredentials());
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
