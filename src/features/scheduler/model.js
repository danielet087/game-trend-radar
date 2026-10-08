import { HOUR, JOBS, ACTIVE, num, instant, day, dateLabel, clockLabel, runUrl } from "./primitives.js";
import { queueGameState } from "./queue.js";
function jobForRun(run, repo) {
  const path = String(run?.path || "").split("@")[0];
  return JOBS.find(j => j.repo === repo && path === ".github/workflows/" + j.workflow);
}
function normalizeRun(run, repo) {
  const job = jobForRun(run, repo);
  if (!job || !/^[1-9]\d{0,19}$/.test(String(run.id)) || !instant(run.created_at)) return null;
  const slot = String(run.display_title || "").match(/(?:^|[|·]\s*)slot=(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ|manual)(?:\s*[|·]|$)/)?.[1];
  const planned = instant(slot);
  return { id: String(run.id), job_id: job.id, status: String(run.status || "unknown"), conclusion: run.conclusion || null,
    created_at: run.created_at, started_at: ACTIVE.has(run.status) && run.status !== "in_progress" ? null : instant(run.run_started_at) ? run.run_started_at : null, updated_at: run.updated_at || run.created_at,
    slot: planned ? slot : slot === "manual" ? "manual" : null, event: run.event || "unknown", url: runUrl(job, run.id) };
}
function interruptionForRun(run, snapshot, growth) {
  const start = instant(run.started_at), finish = instant(run.updated_at);
  if (run.job_id === "steam_catchup") {
    if (snapshot?.batch && String(snapshot.batch.run_id) === run.id) {
      const reason = String(snapshot.batch.stop_reason || "");
      if (/cooldown_no_request/.test(reason)) return "冷卻中，未查詢";
      if (/429|error|failure|invalid/.test(reason)) return /429/.test(reason) ? "429 中斷查詢" : "查詢中斷";
    }
    const matched = (snapshot?.events || []).find(e => {
      const at = instant(e.at), bad = e.http === 429 || (e.status && !["ok", "request_started"].includes(e.status));
      return bad && at !== null && (e.run_id ? String(e.run_id) === run.id : start !== null && finish !== null && at >= start && at <= finish + 60000);
    });
    if (matched) return matched.http === 429 || /rate_limit/.test(matched.status) ? "429 中斷查詢" : "查詢中斷";
  }
  if (run.job_id === "steam_growth" && start !== null && finish !== null) {
    const at = instant(growth?.collection?.at);
    if (at !== null && at >= start && at <= finish + 60000) {
      if (growth.collection.status === "rate_limited") return "429 中斷量測";
      if (growth.collection.status === "bounded_run") return "本輪時間範圍已到，部分完成";
      if (growth.collection.status === "source_unavailable") return "來源無法讀取，量測中斷";
    }
  }
  return null;
}
function runState(run, snapshot, growth, fresh = true) {
  if (ACTIVE.has(run.status)) return fresh ? { state: "running", text: run.status === "in_progress" ? "執行中" : "排隊／等待中" } : { state: "unknown", text: "上次觀測仍在執行，待更新" };
  const interrupted = interruptionForRun(run, snapshot, growth);
  if (interrupted) return { state: /冷卻|部分完成/.test(interrupted) ? "waiting" : "interrupted", text: interrupted };
  if (run.status !== "completed") return { state: "unknown", text: "狀態未確認" };
  if (run.conclusion === "success") return { state: "success", text: "流程完成" };
  if (["failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(run.conclusion)) return { state: "interrupted", text: ({ failure: "執行失敗", cancelled: "執行取消", timed_out: "執行逾時", action_required: "等待人工處理", startup_failure: "無法啟動" })[run.conclusion] };
  return { state: "waiting", text: run.conclusion === "skipped" ? "已略過" : "未完成確認" };
}
function priorDailySuccess(job, runs, snapshot, growth, date, before, excludedId = null) {
  if (!job.oncePerDay) return null;
  const midnight = Date.parse(date + "T00:00:00+08:00");
  return runs.filter(run => {
    const finish = instant(run.updated_at), created = instant(run.created_at), target = instant(run.slot);
    const allowedSlot = job.hours.some(hour => target === midnight + hour * HOUR + job.minute * 60000) ||
      job.id === "steam_growth" && run.slot === "manual";
    return run.job_id === job.id && run.id !== excludedId && allowedSlot && created !== null && day(created) === date &&
      finish !== null && day(finish) === date && finish <= before && runState(run, snapshot, growth).state === "success" &&
      (job.id !== "steam_growth" || run.complete_growth_verified === true);
  }).sort((a, b) => instant(a.updated_at) - instant(b.updated_at))[0] || null;
}
function skippedAfterSuccess(success) {
  return { state: "skipped", text: "今日已於 " + clockLabel(instant(success.updated_at)) + " 成功，略過後續檢查" };
}
function buildSlots(date, runs = [], snapshot, growth, now = Date.now(), freshRepos = {}) {
  const midnight = Date.parse(date + "T00:00:00+08:00");
  return JOBS.map(job => ({ job, slots: job.hours.map(hour => {
    const at = midnight + hour * HOUR + job.minute * 60000;
    const runSlot = job.id === "twitch" ? at - 5 * 60000 : at;
    const matches = runs.filter(r => r.job_id === job.id && instant(r.slot) === runSlot).sort((a, b) => instant(b.created_at) - instant(a.created_at));
    const run = matches[0];
    let status = run ? runState(run, snapshot, growth, freshRepos[job.repo] !== false) : at > now ? { state: "planned", text: "原定時段，尚未到期" } : { state: "unknown", text: "此時段尚未觀測到執行紀錄" };
    const priorSuccess = priorDailySuccess(job, runs, snapshot, growth, date, Math.min(now, run ? instant(run.created_at) : at), run?.id);
    if (priorSuccess && (!run || status.state === "success" || run.conclusion === "skipped")) status = skippedAfterSuccess(priorSuccess);
    if (!run && job.id === "twitch" && snapshot?.twitchReceipt?.collection_complete === true && instant(snapshot.twitchReceipt.target_slot) === midnight + hour * HOUR) {
      status = { state: "success", text: "完整量測已發布" };
    }
    return { at, hour, minute: job.minute, run, ...status };
  }) }));
}
function dashboardState(snapshot, runs, freshness, now = Date.now()) {
  if (!snapshot) return { headline: "佇列資料暫時無法讀取", detail: "保留已取得的執行紀錄；待查數量不填成 0。", state: "unknown" };
  const running = runs.find(r => r.job_id === "steam_catchup" && ACTIVE.has(r.status) && freshness["game-trend-radar-backend"]);
  const until = instant(snapshot.cooldown?.until), cooling = until !== null && until > now;
  const awaiting = (snapshot.queue || []).filter(game => queueGameState(game, snapshot, now).awaitingGroup).length;
  const apiRetry = instant(snapshot.group_resolution_api_cooldown?.retry_at), apiCooling = awaiting > 0 && apiRetry !== null && apiRetry > now;
  if (running) return { headline: running.status === "in_progress" ? "官方佇列流程執行中" : "官方佇列流程正在等待", detail: `已觀測到執行或排隊中的工作；先解析群組 ID，再查 Followers。${awaiting ? "目前快照有 " + awaiting + " 款等待群組解析。" : ""}${cooling ? "Steam Community Followers 查詢仍須等到 " + dateLabel(until) + " 冷卻結束。" : "實際處理進度以最新佇列快照為準。"}`, state: "running" };
  if (apiCooling) return { headline: "群組 ID 解析 API 正在冷卻", detail: `${awaiting} 款尚未取得群組 ID；解析 API 可重試時間為 ${dateLabel(apiRetry)}。${cooling ? "Followers 查詢另有 Steam Community 冷卻，至 " + dateLabel(until) + "。" : "取得群組 ID 後才會查詢 Followers。"}`, state: "waiting" };
  if (cooling) return { headline: awaiting ? "Followers 冷卻中，仍有群組待解析" : "Followers 查詢正在冷卻", detail: `Steam Community 429 後保留佇列，Followers 冷卻至 ${dateLabel(until)}。${awaiting ? awaiting + " 款須先解析群組 ID；這與 Followers 冷卻分開處理。" : ""}下一次可嘗試的原定時段：${instant(snapshot.cooldown.next_eligible_slot) ? dateLabel(instant(snapshot.cooldown.next_eligible_slot)) : "尚未確認"}。`, state: "waiting" };
  if (snapshot.today_taipei !== day(now) || now - instant(snapshot.generated_at) > 2 * HOUR) return { headline: "目前顯示上次佇列快照", detail: "快照較舊，最新剩餘數與處理狀態待更新；原有清單仍保留供核對。", state: "unknown" };
  if (snapshot.summary.ready_pending === 0) return { headline: snapshot.summary.parked ? "可處理佇列已完成，仍有待處理問題" : "目前可處理佇列已完成", detail: snapshot.summary.parked ? "暫停項目仍保留，取得有效群組資料後由後端恢復處理。" : "目前快照沒有待查項目；後續新候選仍會加入既有流程。", state: "success" };
  return { headline: awaiting ? "佇列等待群組 ID 解析" : "佇列保留中，等待下一輪", detail: `接下來依序處理 ${snapshot.summary.ready_pending} 款遊戲，Twitch 發現優先。${awaiting ? awaiting + " 款須先解析 GroupID，再查 Followers。" : "已取得群組 ID 的項目直接進入 Followers 流程。"}原定時段可能因冷卻、其他執行中的工作或延遲而略過。`, state: "waiting" };
}
function eventHistory(snapshot, runs, growth, now = Date.now(), freshness = {}) {
  const date = day(now), events = [];
  for (const run of runs) {
    const start = instant(run.started_at), end = instant(run.updated_at), job = JOBS.find(j => j.id === run.job_id);
    if (day(instant(run.created_at)) !== date && (start === null || day(start) !== date)) continue;
    let s = runState(run, snapshot, growth, freshness[job.repo] !== false);
    const priorSuccess = priorDailySuccess(job, runs, snapshot, growth, day(instant(run.slot) ?? instant(run.created_at)), Math.min(now, instant(run.created_at)), run.id);
    if (priorSuccess && (s.state === "success" || run.conclusion === "skipped")) s = skippedAfterSuccess(priorSuccess);
    const active = ACTIVE.has(run.status);
    const batchSlot = instant(run.slot), scheduleAt = batchSlot === null ? null : batchSlot + (job.id === "twitch" ? 5 * 60000 : 0);
    events.push({ id: "run-" + run.id, at: start || instant(run.created_at), job_id: job.id, state: s.state,
      title: job.name + " · " + s.text, detail: `${scheduleAt !== null ? "原定 " + clockLabel(scheduleAt) : "手動／其他入口"} → ${clockLabel(start || instant(run.created_at))} ${start ? "開始" : "建立／排隊"}${!active && end ? " → " + clockLabel(end) + " 結束" : ""}。${s.state === "success" ? "流程完成與實際資料成果分開核對。" : ""}`, url: run.url });
  }
  for (const [index, e] of (snapshot?.events || []).entries()) {
    const at = instant(e.at); if (at === null || day(at) !== date) continue;
    const limited = e.http === 429 || /rate_limit/.test(String(e.status)), ok = e.status === "ok";
    const matched = runs.find(r => r.job_id === "steam_catchup" && (e.run_id ? r.id === String(e.run_id) : instant(r.started_at) !== null && at >= instant(r.started_at) && at <= instant(r.updated_at) + 60000));
    events.push({ id: "attempt-" + index, at, job_id: "steam_catchup", state: limited ? "interrupted" : ok ? "success" : "interrupted",
      title: `${e.name || "Steam AppID " + e.appid} · ${limited ? "429 中斷查詢" : ok ? "官方查詢成功" : "官方查詢未完成"}`,
      detail: limited ? "本輪停止查詢，遊戲仍留在佇列。" : ok ? `已取得官方 Followers${num(e.official_followers) !== null ? "：" + Number(e.official_followers).toLocaleString("zh-TW") : ""}；是否收錄由資格流程判定。` : "保留實際錯誤，等待後續處理。",
      url: matched?.url || (/^[1-9]\d{0,19}$/.test(String(e.run_id)) ? runUrl(JOBS.find(j => j.id === "steam_catchup"), e.run_id) : null) });
  }
  const collection = growth?.collection, growthAt = instant(collection?.at);
  if (growthAt !== null && day(growthAt) === date) {
    const done = ["completed", "complete"].includes(collection.status), limited = collection.status === "rate_limited", partial = collection.status === "bounded_run";
    events.push({ id: "growth-measurement", at: growthAt, job_id: "steam_growth", state: done ? "success" : partial ? "waiting" : "interrupted", title: "Steam 成長 · " + (limited ? "部分量測後遇到 429" : done ? "本輪量測完成" : partial ? "本輪時間範圍已到，部分完成" : "本輪量測未完成"), detail: `實際取得／重用 ${num(collection.measurements) ?? "未知"} 筆量測；這是量測時間，與前端檔案更新時間分開顯示。` });
  }
  return events.sort((a, b) => b.at - a.at);
}
export { normalizeRun, runState, buildSlots, dashboardState, eventHistory };
