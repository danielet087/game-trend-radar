import { RAW, OWNER, JOBS, HOUR, ACTIVE, ACTION_REFRESH, day, instant, clockLabel } from "./primitives.js";
import { normalizeRun, validateQueue } from "./data.js";
import { isRecord } from "../../data/contracts.ts";
export function createSchedulerLoader(state) {
const storageRead = key => { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } };
const storageWrite = (key, value) => { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {} };
let ratePauseUntil = Number(storageRead("radarSchedulerRatePause")) || 0;
async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(12000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("http_" + response.status);
  const body = await response.text(); if (body.length > 2500000) throw new Error("response_too_large");
  return JSON.parse(body);
}
async function snapshotLoad() {
  let last;
  for (const [url, label] of [[RAW + "game-trend-radar-backend/main/data/scheduler_queue_status.json", "後端最新快照"], ["./data/scheduler_queue_status.json", "前端備份快照"]]) {
    try { state.queue = validateQueue(await fetchJson(url + "?v=" + Math.floor(Date.now() / 60000))); state.queueSource = label; state.queueFetched = Date.now(); return; }
    catch (e) { last = e; }
  }
  throw last;
}
async function readReceipt(file) {
  for (const url of [RAW + "game-trend-radar/main/data/" + file, "./data/" + file]) {
    try { const data = await fetchJson(url); if (isRecord(data)) return data; } catch {}
  }
  return null;
}
const PAGE = 100, OLDER_REFRESH = 30 * 60000;
const iso = time => new Date(time).toISOString().replace(".000Z", "Z");
async function listRuns(repo, created, now) {
  const response = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/actions/runs?per_page=${PAGE}&created=${encodeURIComponent(created)}`, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(12000), headers: { Accept: "application/vnd.github+json" } });
  if ([403, 429].includes(response.status)) {
    const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000, retry = Number(response.headers.get("retry-after")) * 1000;
    ratePauseUntil = Math.max(now + ACTION_REFRESH, Number.isFinite(reset) ? reset : 0, now + (Number.isFinite(retry) ? retry : 0));
    storageWrite("radarSchedulerRatePause", ratePauseUntil); throw new Error("rate_limited");
  }
  if (!response.ok) throw new Error("unavailable");
  const data = await response.json(); if (!Array.isArray(data.workflow_runs)) throw new Error("shape");
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (remaining !== null && Number(remaining) < 5) { ratePauseUntil = Math.max(now + ACTION_REFRESH, Number(response.headers.get("x-ratelimit-reset")) * 1000 || 0); storageWrite("radarSchedulerRatePause", ratePauseUntil); }
  return data.workflow_runs;
}
// Today's runs, from an hour before Taiwan midnight. A busy repository makes more
// than one page a day, so earlier runs come from the cache when it reaches the
// newest page, and from one range request at most every 30 minutes, or sooner
// when the cache has a gap or an earlier run is still active.
async function todayRuns(repo, cached, now) {
  const since = iso(Date.parse(day(now) + "T00:00:00+08:00") - HOUR);
  const latest = await listRuns(repo, ">=" + since, now);
  const runs = latest.map(r => normalizeRun(r, repo)).filter(Boolean);
  const reach = latest.length < PAGE ? null : Math.min(...latest.map(r => instant(r.created_at) ?? Infinity));
  if (reach === null || !Number.isFinite(reach) || reach <= Date.parse(since)) return { runs, since, olderAt: null };
  const earlier = cached?.since === since && Array.isArray(cached.runs) ? cached.runs.filter(r => instant(r.created_at) < reach) : [];
  if (cached?.since === since && Number(cached.at) >= reach && now - Number(cached.olderAt) < OLDER_REFRESH && !earlier.some(r => ACTIVE.has(r.status))) {
    return { runs: [...runs, ...earlier], since, olderAt: Number(cached.olderAt) };
  }
  const seen = new Set(runs.map(r => r.id));
  const older = (await listRuns(repo, since + ".." + iso(reach), now)).map(r => normalizeRun(r, repo)).filter(r => r && !seen.has(r.id));
  return { runs: [...runs, ...older], since, olderAt: now };
}
async function readRuns(repo) {
  const key = "radarSchedulerRunsV2:" + repo, now = Date.now(), cached = storageRead(key);
  if (cached && Array.isArray(cached.runs)) { state.repoChecks[repo] = Number(cached.at) || 0; returnCached(cached.runs, repo); }
  if (cached && now - cached.at < ACTION_REFRESH) return;
  if (now < ratePauseUntil) { state.repoErrors[repo] = "GitHub API 限流，暫停更新至 " + clockLabel(ratePauseUntil); return; }
  try {
    const { runs, since, olderAt } = await todayRuns(repo, cached, now);
    const cachedById = new Map((cached?.runs || []).map(run => [run.id, run]));
    await Promise.allSettled(runs.filter(run => run.job_id === "steam_growth" && run.status === "completed" && run.conclusion === "success" &&
      day(instant(run.created_at)) === day(now) && day(instant(run.updated_at)) === day(now)).map(async run => {
      const verified = cachedById.get(run.id)?.complete_growth_verified;
      if (typeof verified === "boolean" && cachedById.get(run.id)?.updated_at === run.updated_at) { run.complete_growth_verified = verified; return; }
      const jobsResponse = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/actions/runs/${run.id}/jobs?per_page=100`, {
        cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(12000), headers: { Accept: "application/vnd.github+json" } });
      if (!jobsResponse.ok) return;
      const jobs = await jobsResponse.json(); if (!Array.isArray(jobs.jobs)) return;
      run.complete_growth_verified = jobs.jobs.some(job => (job.steps || []).some(step =>
        step.name === "Require complete growth coverage" && step.status === "completed" && step.conclusion === "success"));
    }));
    state.repoChecks[repo] = now; delete state.repoErrors[repo]; returnCached(runs, repo); storageWrite(key, { at: now, runs, since, olderAt });
  } catch {
    state.repoErrors[repo] = now < ratePauseUntil ? "GitHub API 限流，保留上次紀錄" : "GitHub 執行狀態暫時無法更新";
  }
}
function returnCached(runs, repo) { const ids = JOBS.filter(j => j.repo === repo).map(j => j.id); state.runs = [...state.runs.filter(r => !ids.includes(r.job_id)), ...runs]; }
return { snapshotLoad, readReceipt, readRuns };
}
