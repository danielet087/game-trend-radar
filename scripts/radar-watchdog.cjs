"use strict";

// Hourly health check for the whole radar pipeline. It only reads GitHub:
// published receipts, the failure counters that scheduled-failure-notice keeps
// in each repository, and recent workflow runs. Collector jobs use
// continue-on-error, so their runs stay green; these signals do not.
// Findings go to one labelled issue that is opened, updated and closed here.

const LABEL = "radar-watchdog";
const OWNER = "danielet087";
const FRONTEND = "game-trend-radar";
const COUNTER_BRANCH = "radar-notification-state";
const COUNTER_REPOS = ["game-trend-radar-backend", "game-trend-radar-twitch-backend",
  "game-trend-radar-content-backend", FRONTEND];
const FAILURE_STREAK = 3;
const HOUR = 3_600_000;
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
const PAGES = "pages build and deployment";
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
  const finished = runs.filter(run => run.name === PAGES && run.status === "completed" && run.conclusion !== "cancelled")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (finished.length < 2 || finished[0].conclusion !== "failure" || finished[1].conclusion !== "failure") return [];
  return [{ key: "pages", text: `GitHub Pages：最近兩次部署都失敗（${taipei(Date.parse(finished[0].created_at))}），網站停在舊版` }];
}

function scheduledProblems(latest) {
  return latest.filter(({ run }) => run && run.conclusion === "failure")
    .map(({ spec, run }) => ({ key: `scheduled:${spec.repo}/${spec.workflow}`,
      text: `${spec.label}（${spec.repo} / \`${spec.workflow}\`）：最近一次排程執行失敗（${taipei(Date.parse(run.created_at))}）` }));
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

async function collect(github) {
  const errors = [], receipts = [], counters = [], latest = [];
  for (const spec of RECEIPTS) {
    try { receipts.push({ spec, value: await readJSON(github, FRONTEND, spec.path, "main") }); }
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
  for (const spec of SCHEDULED) {
    try {
      const { data } = await github.rest.actions.listWorkflowRuns({ owner: OWNER, repo: spec.repo,
        workflow_id: spec.workflow, event: "schedule", status: "completed", per_page: 1 });
      latest.push({ spec, run: data.workflow_runs[0] || null });
    } catch (error) { if (error.status !== 404) errors.push(`${spec.workflow}: ${error.message}`); }
  }
  return { errors, receipts, counters, pages, latest };
}

function findings(inputs, now) {
  return [...receiptProblems(inputs.receipts, now), ...streakProblems(inputs.counters),
    ...pagesProblems(inputs.pages), ...scheduledProblems(inputs.latest)];
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

async function run({ github, context, core, now = Date.now() }) {
  const inputs = await collect(github);
  const problems = findings(inputs, now);
  for (const problem of problems) core.info("Problem: " + problem.text);
  await report({ github, context, core, problems, errors: inputs.errors, now });
}

module.exports = { RECEIPTS, SCHEDULED, FAILURE_STREAK, LABEL, taipei, receiptProblems, streakProblems,
  pagesProblems, scheduledProblems, issueBody, previousKeys, findings, report, run };
