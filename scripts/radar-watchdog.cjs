"use strict";

// Hourly health check for the whole radar pipeline. It reads the receipts the
// published site serves and, from GitHub, the failure counters that
// scheduled-failure-notice keeps in each repository, the daily credential
// expiry records, recent workflow runs and the live Pages deployment. Collector
// jobs use continue-on-error, so their runs stay green; these signals do not.
// Findings go to one labelled issue that is opened, updated and closed here.
// Its only write besides the issue is the scheduler token's reported expiry
// date on the notification-state branch.

const LABEL = "radar-watchdog";
const OWNER = "danielet087";
const FRONTEND = "game-trend-radar";
const COUNTER_BRANCH = "radar-notification-state";
const COUNTER_REPOS = ["game-trend-radar-backend", "game-trend-radar-twitch-backend",
  "game-trend-radar-content-backend", FRONTEND];
// Each of these runs credential-expiry.yml daily and keeps the result here.
const CREDENTIAL_REPOS = COUNTER_REPOS;
const CREDENTIAL_PATH = "credentials/status.json";
const SCHEDULER_PATH = "credentials/scheduler.json";
const CREDENTIAL_WARN_DAYS = 14;
// A daily check: two missed days stay quiet, the third alerts.
const CREDENTIAL_STALE_HOURS = 80;
const FAILURE_STREAK = 3;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Receipts are read from the published site: its data is built from the
// database at each hourly deploy and is not kept in Git. A receipt's age is
// therefore what visitors see, including a deploy that stopped.
const SITE = "https://danielet087.github.io/game-trend-radar/";
// Each limit allows at least one missed run, so a single slow run stays quiet.
const RECEIPTS = [
  { path: "data/twitch_collection_status.json", field: "completed_at", maxHours: 3, label: "Twitch 每小時收集" },
  { path: "data/scheduler_queue_status.json", field: "generated_at", maxHours: 6, label: "Steam 收集佇列" },
  { path: "data/description_refresh_status.json", field: "generated_at", maxHours: 13, label: "Steam 簡介更新" },
  { path: "data/content_refresh_status.json", field: "generated_at", maxHours: 25, label: "Steam 內容更新" },
  { path: "data/nintendo_refresh_status.json", field: "generated_at", maxHours: 30, label: "Nintendo 每日更新" },
];
const SCHEDULED = [
  { repo: "game-trend-radar-backend", workflow: "storage-evidence-retention.yml", label: "資料庫每日清理" },
];
// The branch deploy's built-in workflow, and the Actions deploy that replaces
// it once the Pages source is switched. A run of either that got as far as a
// result counts; cancelled (superseded) and skipped runs do not.
const PAGES = ["pages build and deployment", "Deploy site to Pages"];
// Data reaches the site only through a Pages deploy (hourly at :30), so a
// deploy that stops leaves the site on old data while every receipt in Git
// stays fresh. Two missed hours stay quiet; the third alerts.
const DEPLOY_STALE_HOURS = 3;
const MARKER = /<!-- radar-watchdog keys=(\[.*?\]) -->/;

function taipei(ms) {
  return new Date(ms + 8 * HOUR).toISOString().slice(0, 16).replace("T", " ");
}

function parseTime(value) {
  return typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
}

function receiptProblems(receipts, now) {
  const problems = [];
  for (const { spec, value } of receipts) {
    const at = parseTime(value?.[spec.field]);
    const key = "receipt:" + spec.path;
    if (!Number.isFinite(at)) {
      problems.push({ key, text: `${spec.label}：\`${spec.path}\` 沒有有效的 \`${spec.field}\`` });
    } else if (now - at > spec.maxHours * HOUR) {
      const hours = ((now - at) / HOUR).toFixed(1);
      problems.push({ key, text: `${spec.label}：最後成功在 ${hours} 小時前（${taipei(at)}），超過 ${spec.maxHours} 小時` });
    }
  }
  return problems;
}

function streakProblems(counters) {
  return counters.filter(({ state }) => Number.isSafeInteger(state?.consecutive_failures) &&
      state.consecutive_failures >= FAILURE_STREAK)
    .map(({ repo, workflow, state }) => {
      const at = parseTime(state.updated_at);
      return { key: `streak:${repo}/${workflow}`,
        text: `${repo} / \`${workflow}\`：連續失敗 ${state.consecutive_failures} 次` +
          (Number.isFinite(at) ? `（最近一次 ${taipei(at)}）` : "") };
    });
}

function pagesProblems(runs) {
  const finished = runs.filter(run => PAGES.includes(run.name) && run.status === "completed" &&
      ["success", "failure"].includes(run.conclusion))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (finished.length < 2 || finished[0].conclusion !== "failure" || finished[1].conclusion !== "failure") return [];
  return [{ key: "pages", text: `GitHub Pages：最近兩次部署都失敗（${taipei(Date.parse(finished[0].created_at))}），網站停在舊版` }];
}

// deployment: the newest github-pages deployment that went live, or null.
function deployProblems(deployment, now) {
  const at = parseTime(deployment?.live_at);
  if (!Number.isFinite(at)) return [{ key: "pages-stale", text: "GitHub Pages：最近 10 次部署都沒有成功上線，網站停在舊版" }];
  if (now - at <= DEPLOY_STALE_HOURS * HOUR) return [];
  const hours = ((now - at) / HOUR).toFixed(1);
  return [{ key: "pages-stale", text: `GitHub Pages：最後一次部署上線在 ${hours} 小時前（${taipei(at)}），網站資料停在那時` }];
}

function scheduledProblems(latest) {
  return latest.filter(({ run }) => run && run.conclusion === "failure")
    .map(({ spec, run }) => ({ key: `scheduled:${spec.repo}/${spec.workflow}`,
      text: `${spec.label}（${spec.repo} / \`${spec.workflow}\`）：最近一次執行失敗（${taipei(Date.parse(run.created_at))}）` }));
}

function expiryProblem(expiresAt, now) {
  const at = parseTime(expiresAt);
  if (!Number.isFinite(at)) return null;
  if (at <= now) return { kind: "expired", text: `已在 ${taipei(at)} 到期` };
  if (at - now > CREDENTIAL_WARN_DAYS * DAY) return null;
  return { kind: "expiring", text: `將在 ${taipei(at)} 到期（剩 ${Math.ceil((at - now) / DAY)} 天）` };
}

// Records come from credential-expiry.yml; they hold names and dates only.
function credentialProblems(statuses, scheduler, now) {
  const problems = [];
  for (const { repo, value } of statuses) {
    const checked = parseTime(value?.checked_at);
    if (!value || value.schema_version !== 1 || !Number.isFinite(checked) || !Array.isArray(value.credentials)) {
      problems.push({ key: `credentials:${repo}`, text: `${repo}：金鑰到期檢查（\`credential-expiry.yml\`）沒有有效結果` });
      continue;
    }
    if (now - checked > CREDENTIAL_STALE_HOURS * HOUR) {
      problems.push({ key: `credentials:${repo}`,
        text: `${repo}：金鑰到期檢查最後一次在 ${taipei(checked)}，已超過 3 天沒有更新` });
    }
    for (const item of value.credentials) {
      if (!item || typeof item.name !== "string") continue;
      const name = `${repo} / \`${item.name}\``;
      if (item.status === "invalid") {
        problems.push({ key: `credential:${repo}/${item.name}:invalid`,
          text: `${name}：已經失效${item.detail ? `（${item.detail}）` : ""}，要重新產生並更新這個 secret` });
        continue;
      }
      const expiry = item.status === "ok" ? expiryProblem(item.expires_at, now) : null;
      if (expiry) {
        problems.push({ key: `credential:${repo}/${item.name}:${expiry.kind}`,
          text: `${name}：${expiry.text}，要換新並更新這個 secret` });
      }
    }
  }
  const expiry = scheduler?.status === "ok" ? expiryProblem(scheduler.expires_at, now) : null;
  if (expiry) {
    problems.push({ key: `credential:scheduler/GITHUB_ACTIONS_TOKEN:${expiry.kind}`,
      text: `Cloudflare 排程器用的 GitHub token（Worker secret \`GITHUB_ACTIONS_TOKEN\`）：${expiry.text}，` +
        "到期後所有自動排程都會停，要換新並更新 Worker 的 secret" });
  }
  return problems;
}

// The Cloudflare scheduler reports its own token's expiry ("none" or a time)
// with each hourly dispatch. GitHub-scheduled runs carry no report and use the
// stored one, so the two kinds of run always agree.
function schedulerReport(value, now) {
  const text = typeof value === "string" ? value.trim() : "";
  const at = parseTime(text);
  if (text !== "none" && !Number.isFinite(at)) return null;
  return { schema_version: 1, status: "ok",
    expires_at: text === "none" ? null : new Date(at).toISOString().replace(".000Z", "Z"),
    reported_at: new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z") };
}

function issueBody(problems, now, owner = OWNER) {
  const keys = JSON.stringify(problems.map(problem => problem.key).sort());
  return [`<!-- radar-watchdog keys=${keys} -->`,
    `@${owner} 雷達網站自動檢查（台灣時間 ${taipei(now)}）發現 ${problems.length} 項異常：`, "",
    ...problems.map(problem => "- " + problem.text), "",
    "每小時重新檢查；全部恢復後這則 issue 會自動關閉。"].join("\n");
}

function previousKeys(body) {
  try { return new Set(JSON.parse(MARKER.exec(body || "")?.[1] || "[]")); } catch { return new Set(); }
}

async function readJSON(github, repo, path, ref) {
  const { data } = await github.rest.repos.getContent({ owner: OWNER, repo, path, ref, mediaType: { format: "raw" } });
  return JSON.parse(typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
}

async function readSite(fetchImpl, path, now) {
  // A new query each run skips a CDN copy cached before the newest deploy.
  const response = await fetchImpl(`${SITE}${path}?watchdog=${now}`, { headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  return await response.json();
}

async function readScheduler(github) {
  try {
    const { data } = await github.rest.repos.getContent({ owner: OWNER, repo: FRONTEND, path: SCHEDULER_PATH, ref: COUNTER_BRANCH });
    if (!data || data.type !== "file" || typeof data.content !== "string" || !data.sha) throw new Error("invalid scheduler record");
    return { value: JSON.parse(Buffer.from(data.content, "base64").toString("utf8")), sha: data.sha };
  } catch (error) {
    if (error.status === 404) return { value: null, sha: undefined };
    throw error;
  }
}

async function storeScheduler(github, report, sha) {
  await github.rest.repos.createOrUpdateFileContents({ owner: OWNER, repo: FRONTEND, path: SCHEDULER_PATH,
    branch: COUNTER_BRANCH, message: "Record the Cloudflare scheduler token's reported expiry",
    content: Buffer.from(JSON.stringify(report, null, 2) + "\n").toString("base64"), ...(sha ? { sha } : {}) });
}

async function collect(github, fetchImpl = globalThis.fetch, now = Date.now()) {
  const errors = [], receipts = [], counters = [], latest = [], credentials = [];
  for (const spec of RECEIPTS) {
    try { receipts.push({ spec, value: await readSite(fetchImpl, spec.path, now) }); }
    catch (error) {
      if (error.status === 404) receipts.push({ spec, value: null });
      else errors.push(`${spec.path}: ${error.message}`);
    }
  }
  for (const repo of COUNTER_REPOS) {
    try {
      const { data } = await github.rest.repos.getContent({ owner: OWNER, repo, path: "workflows", ref: COUNTER_BRANCH });
      for (const entry of Array.isArray(data) ? data : []) {
        if (entry.type !== "file" || !entry.name.endsWith(".json")) continue;
        counters.push({ repo, workflow: entry.name.replace(/\.json$/, ""),
          state: await readJSON(github, repo, entry.path, COUNTER_BRANCH) });
      }
    } catch (error) { if (error.status !== 404) errors.push(`${repo} counters: ${error.message}`); }
  }
  let pages = [];
  try {
    pages = (await github.rest.actions.listWorkflowRunsForRepo({ owner: OWNER, repo: FRONTEND, per_page: 50 })).data.workflow_runs;
  } catch (error) { errors.push(`Pages runs: ${error.message}`); }
  // Left undefined when the check itself fails, so it is reported as unavailable.
  let deployment;
  try { deployment = await liveDeployment(github); }
  catch (error) { errors.push(`Pages deployments: ${error.message}`); }
  for (const spec of SCHEDULED) {
    try {
      // Cloudflare dispatches these; GitHub's own schedule is only a fallback.
      const { data } = await github.rest.actions.listWorkflowRuns({ owner: OWNER, repo: spec.repo,
        workflow_id: spec.workflow, status: "completed", per_page: 1 });
      latest.push({ spec, run: data.workflow_runs[0] || null });
    } catch (error) { if (error.status !== 404) errors.push(`${spec.workflow}: ${error.message}`); }
  }
  for (const repo of CREDENTIAL_REPOS) {
    try { credentials.push({ repo, value: await readJSON(github, repo, CREDENTIAL_PATH, COUNTER_BRANCH) }); }
    catch (error) {
      if (error.status === 404) credentials.push({ repo, value: null });
      else errors.push(`${repo} credentials: ${error.message}`);
    }
  }
  let scheduler = { value: null, sha: undefined };
  try { scheduler = await readScheduler(github); }
  catch (error) { errors.push(`scheduler token record: ${error.message}`); }
  return { errors, receipts, counters, pages, deployment, latest, credentials, scheduler };
}

// The newest github-pages deployment whose latest status is success: the one
// being served. A superseded deployment's status turns inactive.
async function liveDeployment(github) {
  const { data } = await github.rest.repos.listDeployments({ owner: OWNER, repo: FRONTEND, environment: "github-pages", per_page: 10 });
  for (const deployment of data) {
    const { data: statuses } = await github.rest.repos.listDeploymentStatuses({ owner: OWNER, repo: FRONTEND,
      deployment_id: deployment.id, per_page: 1 });
    if (statuses[0]?.state === "success") return { sha: deployment.sha, live_at: statuses[0].created_at };
  }
  return null;
}

function findings(inputs, now) {
  return [...receiptProblems(inputs.receipts, now), ...streakProblems(inputs.counters),
    ...pagesProblems(inputs.pages),
    ...(inputs.deployment === undefined ? [] : deployProblems(inputs.deployment, now)),
    ...scheduledProblems(inputs.latest),
    ...credentialProblems(inputs.credentials || [], inputs.scheduler?.value, now)];
}

async function report({ github, context, core, problems, errors, now }) {
  const repo = { owner: context.repo.owner, repo: context.repo.repo };
  const { data: open } = await github.rest.issues.listForRepo({ ...repo, labels: LABEL, state: "open", per_page: 10 });
  const issue = open.find(item => !item.pull_request);
  for (const error of errors) core.warning("Watchdog check unavailable: " + error);
  if (!problems.length) {
    // An unavailable check cannot prove recovery.
    if (issue && !errors.length) {
      await github.rest.issues.createComment({ ...repo, issue_number: issue.number,
        body: `台灣時間 ${taipei(now)} 檢查全部正常，自動關閉。` });
      await github.rest.issues.update({ ...repo, issue_number: issue.number, state: "closed", state_reason: "completed" });
      core.info(`Closed #${issue.number}; every check passed.`);
    } else core.info(errors.length ? "No problems found, but some checks were unavailable." : "Every check passed.");
    return;
  }
  const title = `雷達網站監控：${problems.length} 項異常`;
  const body = issueBody(problems, now, context.repo.owner);
  if (!issue) {
    try { await github.rest.issues.createLabel({ ...repo, name: LABEL, color: "b60205", description: "雷達網站自動監控警報" }); }
    catch (error) { if (error.status !== 422) throw error; }
    const { data } = await github.rest.issues.create({ ...repo, title, body, labels: [LABEL] });
    core.warning(`Opened #${data.number}: ${problems.length} problem(s).`);
    return;
  }
  const before = previousKeys(issue.body);
  const added = problems.filter(problem => !before.has(problem.key));
  await github.rest.issues.update({ ...repo, issue_number: issue.number, title, body });
  if (added.length) {
    await github.rest.issues.createComment({ ...repo, issue_number: issue.number,
      body: ["新增異常：", ...added.map(problem => "- " + problem.text)].join("\n") });
  }
  core.warning(`Updated #${issue.number}: ${problems.length} problem(s), ${added.length} new.`);
}

async function run({ github, context, core, now = Date.now(), fetchImpl = globalThis.fetch }) {
  const inputs = await collect(github, fetchImpl, now);
  const reported = schedulerReport(context.payload?.inputs?.scheduler_token_expires_at, now);
  const stored = inputs.scheduler.value;
  if (reported && (stored?.status !== reported.status || stored?.expires_at !== reported.expires_at)) {
    // Store only changes; evaluate the fresh report even if storing fails.
    try { await storeScheduler(github, reported, inputs.scheduler.sha); }
    catch (error) { inputs.errors.push(`scheduler token record: ${error.message}`); }
    inputs.scheduler = { value: reported, sha: undefined };
  }
  const problems = findings(inputs, now);
  for (const problem of problems) core.info("Problem: " + problem.text);
  await report({ github, context, core, problems, errors: inputs.errors, now });
}

module.exports = { RECEIPTS, SCHEDULED, FAILURE_STREAK, LABEL, CREDENTIAL_REPOS, CREDENTIAL_PATH, SCHEDULER_PATH,
  CREDENTIAL_WARN_DAYS, DEPLOY_STALE_HOURS, taipei, receiptProblems, streakProblems, pagesProblems, deployProblems, scheduledProblems,
  credentialProblems, schedulerReport, issueBody, previousKeys, findings, report, run };
