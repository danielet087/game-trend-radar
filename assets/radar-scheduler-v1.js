(function (root) {
  "use strict";
  const HOUR = 3600000, DAY = 24 * HOUR, ACTION_REFRESH = 5 * 60000;
  const OWNER = "danielet087";
  const RAW = "https://raw.githubusercontent.com/" + OWNER + "/";
  const JOBS = Object.freeze([
    { id: "steam_daily", name: "每日候選更新", repo: "game-trend-radar-backend", workflow: "steam-two-phase.yml", hours: [0], minute: 0, note: "每日 00:00" },
    { id: "steam_growth", name: "Steam 成長追蹤", repo: "game-trend-radar-backend", workflow: "steam-public-growth.yml", hours: [1], minute: 15, note: "每日 01:15" },
    { id: "steam_catchup", name: "官方 Followers", repo: "game-trend-radar-backend", workflow: "steam-official-daily-catchup-250.yml", hours: Array.from({ length: 21 }, (_, i) => i + 3), minute: 0, note: "03:00–23:00，每小時" },
    { id: "twitch", name: "Twitch 新作觀測", repo: "game-trend-radar-twitch-backend", workflow: "collect.yml", hours: Array.from({ length: 24 }, (_, i) => i), minute: 5, note: "每小時 :05" },
    { id: "frontend_insights", name: "前端動態與成長榜", repo: "game-trend-radar", workflow: "radar-insights.yml", hours: Array.from({ length: 24 }, (_, i) => i), minute: 17, note: "每小時 :17" },
    { id: "steam_content", name: "內容對帳與發布", repo: "game-trend-radar-content-backend", workflow: "steam-catalog-reconcile.yml", hours: [7, 19], minute: 30, note: "每日 07:30、19:30" },
    { id: "nintendo_daily", name: "IGDB 主機新作", repo: "game-trend-radar-twitch-backend", workflow: "collect-nintendo.yml", hours: [8], minute: 30, note: "每日 08:30 · NS／NS2／PS5" },
  ]);
  const ACTIVE = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);
  const num = v => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
  const appid = v => /^[1-9]\d{0,9}$/.test(String(v)) ? Number(v) : null;
  const instant = v => typeof v === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
  const day = v => new Date(Number(v) + 8 * HOUR).toISOString().slice(0, 10);
  const dateLabel = v => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(v));
  const clockLabel = v => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(v));
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const runUrl = (job, id) => appid(id) || /^[1-9]\d{0,19}$/.test(String(id)) ? `https://github.com/${OWNER}/${job.repo}/actions/runs/${id}` : null;
  const steamUrl = id => `https://store.steampowered.com/app/${appid(id)}/`;
  const UNRESOLVED_GROUP_STATUSES = new Set(["not_found", "missing_api_key", "api_rate_limited", "api_forbidden", "network_error", "api_error", "invalid_response"]);

  function queueGameState(game, snapshot, now = Date.now(), parked = false) {
    const hasGroupField = Object.prototype.hasOwnProperty.call(game, "group_id64");
    const groupId = typeof game.group_id64 === "string" && /^[1-9]\d{0,19}$/.test(game.group_id64) ? game.group_id64 : null;
    const resolution = game.group_resolution && typeof game.group_resolution === "object" ? game.group_resolution : null;
    const awaitingGroup = game.state === "awaiting_group" || hasGroupField && game.group_id64 === null || !groupId && UNRESOLVED_GROUP_STATUSES.has(resolution?.status);
    const metadata = [];
    if (groupId) metadata.push("GroupID " + groupId);
    if (instant(resolution?.checked_at) !== null) metadata.push("群組解析查核 " + dateLabel(instant(resolution.checked_at)));
    if (typeof resolution?.source === "string" && resolution.source) metadata.push("群組來源 " + resolution.source);
    if (Number.isInteger(resolution?.http) && resolution.http >= 100 && resolution.http <= 599) metadata.push("解析 API HTTP " + resolution.http);
    if (instant(resolution?.retry_at) !== null) metadata.push("群組解析可重試時間 " + dateLabel(instant(resolution.retry_at)));
    if (awaitingGroup) {
      const states = {
        not_found: ["本次未取得 GroupID", "本次 API 回應未取得群組 ID，保留候選等待後續解析；這不代表該遊戲沒有群組。", "waiting"],
        missing_api_key: ["群組解析缺少 API Key", "群組 ID 尚未解析；缺少 Steam API Key，等待設定後解析。", "waiting"],
        api_rate_limited: ["群組解析 API 限流", "群組 ID 解析 API 收到限流，等待可重試時間後再解析；尚未進入 Followers 查詢。", "interrupted"],
        api_forbidden: ["群組解析 API 拒絕存取", "本次群組解析 API 拒絕存取，尚未取得群組 ID，保留候選等待處理。", "interrupted"],
        network_error: ["群組解析網路錯誤", "本次群組解析網路連線失敗，尚未取得群組 ID，保留候選待重試。", "interrupted"],
        api_error: ["群組解析 API 錯誤", "本次群組解析 API 查詢失敗，尚未取得群組 ID，等待後續重試。", "interrupted"],
        invalid_response: ["群組解析回應無效", "本次群組解析 API 回應缺少有效資料，尚未取得群組 ID，等待後續解析。", "interrupted"],
      };
      const [label, detail, kind] = states[resolution?.status] || ["等待群組 ID 解析", "群組 ID 尚未解析；先取得 GroupID，再查詢官方 Followers。", "waiting"];
      return { stage: "awaiting_group", awaitingGroup: true, label, detail: detail + (parked ? " 目前仍計入暫停項目。" : ""), kind, metadata };
    }
    const until = instant(snapshot?.cooldown?.until), cooling = until !== null && until > now;
    const oldPausedReason = ({ official_xml_fallback_returned_html: "官方端點回傳 HTML，尚未取得有效群組 ID。", missing_official_group_id: "尚未取得有效官方群組 ID。" })[game.reason] || game.reason || "目前資料不足，暫停官方查詢。";
    return { stage: groupId ? "followers" : "legacy", awaitingGroup: false,
      label: groupId ? parked ? "群組 ID 已備妥，等待恢復" : cooling ? "Followers 冷卻中" : "等待 Followers 查詢" : null,
      detail: parked ? groupId ? "已取得群組 ID；目前仍列暫停項目，等待後端恢復處理。" : oldPausedReason : groupId ? cooling ? "群組 ID 已備妥；Followers 冷卻結束後依序查詢。" : "群組 ID 已備妥；等待官方 Followers 查詢。" : cooling ? "冷卻結束後依序處理" : "等待官方查詢",
      kind: "waiting", metadata };
  }
  function groupQueueCounts(snapshot) {
    const summary = snapshot?.summary;
    const ready = num(summary?.followers_ready_pending), awaiting = num(summary?.awaiting_group_pending);
    if (ready === null || awaiting === null || ready + awaiting !== num(summary?.ready_pending)) return null;
    return { followersReady: ready, awaitingGroup: awaiting };
  }
  function igdbReceiptSummary(receipt) {
    const platforms = receipt?.source?.platform_ids_verified;
    if (receipt?.schema_version !== 1 || receipt.source?.provider !== "IGDB" ||
        !Array.isArray(platforms) || ![[130, 508], [130, 508, 167]].some(ids =>
          ids.length === platforms.length && ids.every(id => platforms.includes(id))) ||
        instant(receipt.generated_at) === null || num(receipt.candidate_count) === null ||
        num(receipt.public_count) === null || num(receipt.pending_count) === null) return null;
    const published = receipt.complete === true && receipt.status === "published" && receipt.source.complete === true &&
      instant(receipt.published_at) !== null && instant(receipt.published_at) >= instant(receipt.generated_at);
    return { platforms: platforms.includes(167) ? "NS／NS2／PS5" : "NS／NS2", published,
      generatedAt: instant(receipt.generated_at), publishedAt: published ? instant(receipt.published_at) : null,
      candidateCount: receipt.candidate_count, publicCount: receipt.public_count, pendingCount: receipt.pending_count };
  }

  function validateQueue(data) {
    if (!data || data.schema_version !== 1 || !instant(data.generated_at) || !data.summary || !Array.isArray(data.queue) || !Array.isArray(data.parked)) throw new Error("queue_shape");
    const s = data.summary;
    if (["normal_pending", "twitch_priority_pending", "parked", "total_pending", "ready_pending"].some(k => num(s[k]) === null)) throw new Error("queue_counts");
    if (s.normal_pending + s.twitch_priority_pending !== s.ready_pending || s.ready_pending + s.parked !== s.total_pending || data.queue.length !== s.ready_pending || data.parked.length !== s.parked) throw new Error("queue_mismatch");
    const ids = [...data.queue, ...data.parked].map(g => appid(g.appid));
    if (ids.some(v => v === null) || new Set(ids).size !== ids.length) throw new Error("queue_ids");
    if (data.queue.filter(g => g.priority === true).length !== s.twitch_priority_pending) throw new Error("queue_priority");
    return data;
  }
  function jobForRun(run, repo) {
    const path = String(run?.path || "").split("@")[0];
    return JOBS.find(j => j.repo === repo && path === ".github/workflows/" + j.workflow);
  }
  function normalizeRun(run, repo) {
    const job = jobForRun(run, repo);
    if (!job || !/^[1-9]\d{0,19}$/.test(String(run.id)) || !instant(run.created_at)) return null;
    const slot = String(run.display_title || "").match(/(?:^|[|·]\s*)slot=(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)(?:\s*[|·]|$)/)?.[1];
    const planned = instant(slot);
    return { id: String(run.id), job_id: job.id, status: String(run.status || "unknown"), conclusion: run.conclusion || null,
      created_at: run.created_at, started_at: ACTIVE.has(run.status) && run.status !== "in_progress" ? null : instant(run.run_started_at) ? run.run_started_at : null, updated_at: run.updated_at || run.created_at,
      slot: planned ? slot : null, event: run.event || "unknown", url: runUrl(job, run.id) };
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
  function buildSlots(date, runs = [], snapshot, growth, now = Date.now(), freshRepos = {}) {
    const midnight = Date.parse(date + "T00:00:00+08:00");
    return JOBS.map(job => ({ job, slots: job.hours.map(hour => {
      const at = midnight + hour * HOUR + job.minute * 60000;
      const runSlot = job.id === "twitch" ? at - 5 * 60000 : at;
      const matches = runs.filter(r => r.job_id === job.id && instant(r.slot) === runSlot).sort((a, b) => instant(b.created_at) - instant(a.created_at));
      const run = matches[0];
      let status = run ? runState(run, snapshot, growth, freshRepos[job.repo] !== false) : at > now ? { state: "planned", text: "原定時段，尚未到期" } : { state: "unknown", text: "此時段尚未觀測到執行紀錄" };
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
      const s = runState(run, snapshot, growth, freshness[job.repo] !== false);
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
  const api = { JOBS, validateQueue, normalizeRun, runState, buildSlots, dashboardState, eventHistory, queueGameState, groupQueueCounts, igdbReceiptSummary, day, instant };
  root.RadarScheduler = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;

  const $ = id => document.getElementById(id);
  const state = { queue: null, queueSource: "", queueFetched: 0, runs: [], repoChecks: {}, repoErrors: {}, growth: null, content: null, twitch: null, igdb: null, busy: false };
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
      try { return await fetchJson(url); } catch {}
    }
    return null;
  }
  async function readRuns(repo) {
    const key = "radarSchedulerRunsV2:" + repo, now = Date.now(), cached = storageRead(key);
    if (cached && Array.isArray(cached.runs)) { state.repoChecks[repo] = Number(cached.at) || 0; returnCached(cached.runs, repo); }
    if (cached && now - cached.at < ACTION_REFRESH) return;
    if (now < ratePauseUntil) { state.repoErrors[repo] = "GitHub API 限流，暫停更新至 " + clockLabel(ratePauseUntil); return; }
    try {
      const response = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/actions/runs?per_page=50`, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(12000), headers: { Accept: "application/vnd.github+json" } });
      if ([403, 429].includes(response.status)) {
        const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000, retry = Number(response.headers.get("retry-after")) * 1000;
        ratePauseUntil = Math.max(now + ACTION_REFRESH, Number.isFinite(reset) ? reset : 0, now + (Number.isFinite(retry) ? retry : 0));
        storageWrite("radarSchedulerRatePause", ratePauseUntil); throw new Error("rate_limited");
      }
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json(); if (!Array.isArray(data.workflow_runs)) throw new Error("shape");
      const runs = data.workflow_runs.map(r => normalizeRun(r, repo)).filter(Boolean);
      state.repoChecks[repo] = now; delete state.repoErrors[repo]; returnCached(runs, repo); storageWrite(key, { at: now, runs });
      const remaining = response.headers.get("x-ratelimit-remaining");
      if (remaining !== null && Number(remaining) < 5) { ratePauseUntil = Math.max(now + ACTION_REFRESH, Number(response.headers.get("x-ratelimit-reset")) * 1000 || 0); storageWrite("radarSchedulerRatePause", ratePauseUntil); }
    } catch {
      state.repoErrors[repo] = now < ratePauseUntil ? "GitHub API 限流，保留上次紀錄" : "GitHub 執行狀態暫時無法更新";
    }
  }
  function returnCached(runs, repo) { const ids = JOBS.filter(j => j.repo === repo).map(j => j.id); state.runs = [...state.runs.filter(r => !ids.includes(r.job_id)), ...runs]; }
  const freshRepos = () => Object.fromEntries([...new Set(JOBS.map(j => j.repo))].map(repo => [repo, !state.repoErrors[repo] && Date.now() - (state.repoChecks[repo] || 0) <= ACTION_REFRESH + 30000]));
  const badge = (text, kind = "waiting") => `<span class="queue-badge state-${kind}">${esc(text)}</span>`;
  function gameCard(game, index, parked = false) {
    const title = game.name || "Steam AppID " + game.appid, priority = game.priority === true;
    const progress = queueGameState(game, state.queue, Date.now(), parked);
    return `<article class="queue-card ${parked ? "is-paused" : priority ? "is-priority" : ""}"><div class="queue-card-head"><span class="queue-rank">${parked ? "暫停" : "#" + (game.position || index + 1)}</span><div class="queue-badges">${badge(priority ? "Twitch 優先" : "一般 Steam", priority ? "priority" : "ordinary")}${parked ? badge("暫停", "interrupted") : ""}${progress.label ? badge(progress.label, progress.kind) : ""}</div></div><h3><a href="${steamUrl(game.appid)}" target="_blank" rel="noopener noreferrer">${esc(title)} <span aria-hidden="true">↗</span></a></h3><p class="queue-meta">AppID ${game.appid} · ${game.release_date ? "上市 " + esc(game.release_date) : "上市日期待確認"}</p><p class="queue-card-note">${esc(progress.detail)}</p>${progress.metadata.length ? `<p class="queue-meta">${esc(progress.metadata.join(" · "))}</p>` : ""}${game.last_attempt_at && instant(game.last_attempt_at) ? `<p class="queue-meta">上次 Followers 嘗試 ${dateLabel(instant(game.last_attempt_at))}${/rate_limit/.test(game.last_attempt_status || "") ? " · 429" : ""}</p>` : ""}</article>`;
  }
  function renderQueue() {
    const q = state.queue, search = ($("queueSearch")?.value || "").trim().toLocaleLowerCase(), filter = $("queueFilter")?.value || "all";
    if (!q) { $("nextQueue").innerHTML = '<p class="empty-state">待查清單暫時無法取得。</p>'; $("pausedQueue").innerHTML = '<p class="empty-state">暫停清單尚未確認。</p>'; $("pendingQueue").innerHTML = '<p class="empty-state">保留未知狀態，沒有將待查數量當成 0。</p>'; return; }
    $("nextQueue").innerHTML = q.queue.length ? q.queue.slice(0, 6).map((g, i) => gameCard(g, i)).join("") : '<p class="empty-state">目前沒有可處理遊戲。</p>';
    $("nextQueueNote").textContent = "依後端佇列順序顯示前 6 款；先解析群組 ID，再查 Followers。已取得 ID 的項目直接查 Followers，實際開始仍須通過各自的冷卻與執行鎖。";
    $("pausedQueue").innerHTML = q.parked.length ? q.parked.map((g, i) => gameCard(g, i, true)).join("") : '<p class="empty-state">目前沒有暫停項目。</p>';
    $("pausedQueueNote").textContent = "暫停項目計入總待處理數；尚未取得有效群組 ID 的項目等待解析，成功後由後端恢復至既有佇列。";
    const rows = [...q.queue.map(g => ({ ...g, parked: false })), ...q.parked.map(g => ({ ...g, parked: true }))].filter(g => (filter === "all" || filter === "paused" && g.parked || filter === "twitch" && !g.parked && g.priority || filter === "ordinary" && !g.parked && !g.priority) && (!search || String(g.name).toLocaleLowerCase().includes(search) || String(g.appid).includes(search)));
    $("queueCount").textContent = `顯示 ${rows.length} / ${q.summary.total_pending} 款`;
    $("pendingQueue").innerHTML = rows.length ? rows.map((g, i) => gameCard(g, i, g.parked)).join("") : '<p class="empty-state">沒有符合搜尋條件的遊戲。</p>';
  }
  function renderSchedule() {
    const now = Date.now(), today = day(now), fresh = freshRepos();
    const snapshot = state.queue ? { ...state.queue, twitchReceipt: state.twitch } : { twitchReceipt: state.twitch };
    const rows = buildSlots(today, state.runs, snapshot, state.growth, now, fresh), start = Date.parse(today + "T00:00:00+08:00");
    $("scheduleDate").textContent = today.replaceAll("-", "/") + " · 台灣時間";
    const ticks = Array.from({ length: 13 }, (_, i) => `<span style="left:${i / 12 * 100}%">${String(i * 2).padStart(2, "0")}:00</span>`).join("");
    const nowPosition = (now - start) / DAY * 100;
    $("scheduleTimeline").innerHTML = `<div class="schedule-hours"><span class="schedule-label">原定時段 → 實際執行</span><div class="schedule-track schedule-ticks">${ticks}</div></div>` + rows.map(({ job, slots }) => `<div class="schedule-lane"><div class="schedule-label"><strong>${esc(job.name)}</strong><small>${esc(job.note)}</small></div><div class="schedule-track"><span class="schedule-now" style="left:${nowPosition}%" aria-hidden="true"></span>${slots.map(slot => {
      const label = `${clockLabel(slot.at)} · ${job.name} · ${slot.text}${slot.run ? "，實際 " + clockLabel(instant(slot.run.started_at) ?? instant(slot.run.created_at)) + (slot.run.started_at ? " 開始" : " 建立／排隊") : ""}`;
      const common = `class="schedule-slot is-${slot.state}" style="left:${(slot.at - start) / DAY * 100}%" title="${esc(label)}" aria-label="${esc(label)}"`;
      return slot.run?.url ? `<a ${common} href="${slot.run.url}" target="_blank" rel="noopener noreferrer"><span class="sr-only">${esc(label)}</span></a>` : `<button ${common} type="button" data-slot-note="${esc(label)}"><span class="sr-only">${esc(label)}</span></button>`;
    }).join("")}</div></div>`).join("");
    $("scheduleCaption").textContent = `藍線為現在 ${clockLabel(now)}。圓點位置代表原定時段；點選可查看實際開始時間與 Actions。灰色過去時段代表尚未取得紀錄，不直接判定失敗。`;
  }
  function renderEvents() {
    const events = eventHistory(state.queue, state.runs, state.growth, Date.now(), freshRepos());
    $("eventTimeline").innerHTML = events.length ? events.map(e => `<li class="timeline-event is-${e.state}" id="${e.id}"><time class="event-time" datetime="${new Date(e.at).toISOString()}">${clockLabel(e.at)}</time><div class="event-card"><span class="event-state state-${e.state}">${({ success: "已完成", interrupted: "已中斷", running: "進行中", waiting: "等待", unknown: "待確認" })[e.state]}</span><h3>${esc(e.title)}</h3><p>${esc(e.detail)}</p>${e.url ? `<a class="event-link" href="${e.url}" target="_blank" rel="noopener noreferrer">查看這次執行 ↗</a>` : ""}</div></li>`).join("") : '<li class="empty-state">今日執行紀錄尚未取得。原定排程不會被當成實際執行。</li>';
    $("eventTimelineNote").textContent = "由新到舊呈現今日已觀測事件。實際查詢中斷會單獨記錄，即使 Actions 最後顯示成功。";
  }
  function render() {
    const q = state.queue, fresh = freshRepos(), hero = dashboardState(q, state.runs, fresh);
    $("currentTime").textContent = dateLabel(Date.now());
    $("statusHeadline").textContent = hero.headline; $("statusDetail").textContent = hero.detail;
    $("statusHeadline").closest("section")?.setAttribute("data-status", hero.state);
    for (const [id, key] of [["totalRemaining", "total_pending"], ["ordinaryCount", "normal_pending"], ["twitchCount", "twitch_priority_pending"], ["pausedCount", "parked"]]) $(id).textContent = q ? Number(q.summary[key]).toLocaleString("zh-TW") : "—";
    $("currentProgress").textContent = q ? `${q.today_taipei === day(Date.now()) ? "今日" : q.today_taipei + " 快照日"}官方 Followers 查詢 ${num(q.summary.today_attempts) ?? "—"} 次 · 成功 ${num(q.summary.today_successes) ?? "—"} 次 · 429 ${num(q.summary.today_429) ?? "—"} 次` : "今日查詢成果尚未確認";
    const oldDay = q && q.today_taipei !== day(Date.now());
    const incompleteCandidates = q && q.source_status?.status !== "current_day_prefilter_complete";
    const awaitingGroups = q ? q.queue.filter(game => queueGameState(game, q).awaitingGroup).length : 0;
    const groupCounts = groupQueueCounts(q);
    const groupBreakdown = groupCounts ? `（${groupCounts.followersReady} 款已取得 ID／${groupCounts.awaitingGroup} 款等待解析）` : awaitingGroups ? `（${awaitingGroups} 款先解析群組 ID）` : "";
    $("queueOverviewNote").textContent = q ? `${q.summary.ready_pending} 款可處理${groupBreakdown} + ${q.summary.parked} 款暫停。${oldDay ? "快照屬於前一個日期，今日數量尚待更新。" : incompleteCandidates ? "今日候選初篩尚未完成，保留既有佇列；待查可能再增加。" : "數量取自後端實際佇列，會隨處理與新增變動。"}` : "待查數量尚未取得。";
    $("sourceFreshness").textContent = q ? `${state.queueSource} · 產生於 ${dateLabel(instant(q.generated_at))}${Date.now() - instant(q.generated_at) > 2 * HOUR ? " · 快照較舊，請核對執行紀錄" : ""}` : "佇列來源尚未連上";
    const issues = Object.values(state.repoErrors);
    $("statusMessage").textContent = issues.length ? "部分執行狀態暫時無法更新；保留已取得紀錄並標示待確認。" : "佇列每分鐘更新；Actions 執行狀態每 5 分鐘更新。";
    const sources = [q ? `<p><strong>佇列快照</strong> ${esc(q.generated_at)} · ${esc(state.queueSource)}</p>` : "<p>佇列快照無法讀取。</p>", ...[...new Set(JOBS.map(j => j.repo))].map(repo => `<p><strong>${esc(repo)}</strong> · ${state.repoChecks[repo] ? "上次核對 " + dateLabel(state.repoChecks[repo]) : "尚未取得執行紀錄"}${state.repoErrors[repo] ? " · " + esc(state.repoErrors[repo]) : ""}</p>`), `<p>Cloudflare 沿用 <code>0,5,15,17,30 * * * *</code>。原定排程、Actions 執行結果與實際收集成果分開呈現。</p>`, `<p>內容對帳：${state.content ? state.content.complete ? "最近快照已完成對帳" : "仍有未完成內容" : "尚未取得"}${state.content?.description_translation_pending_count ? "；介紹翻譯待處理 " + state.content.description_translation_pending_count + " 款" : ""}。Twitch 最近完整發布：${instant(state.twitch?.completed_at) ? dateLabel(instant(state.twitch.completed_at)) : "尚未確認"}。</p>`];
    const igdb = igdbReceiptSummary(state.igdb);
    sources.push(igdb ? `<p><strong>IGDB 主機收集（${igdb.platforms}）</strong> ${igdb.published ? "完整發布於 " + dateLabel(igdb.publishedAt) : "最近回報尚未確認完整發布"}；收集時間 ${dateLabel(igdb.generatedAt)}；候選 ${igdb.candidateCount.toLocaleString("zh-TW")} 款、公開 ${igdb.publicCount.toLocaleString("zh-TW")} 款、待處理 ${igdb.pendingCount.toLocaleString("zh-TW")} 款。每日 08:30 沿用既有 IGDB 流程，這些數量不計入上方 Steam Followers 待查佇列。</p>` : "<p><strong>IGDB 主機收集（NS／NS2／PS5）</strong> 最近收集與發布回條尚未取得；待處理數量保留未知。每日 08:30 沿用既有 IGDB 流程，與 Steam Followers 待查佇列分開。</p>");
    if (q) {
      const groupUpdated = q.source && Object.prototype.hasOwnProperty.call(q.source, "group_resolution_updated_at") ? `；群組解析回報 ${instant(q.source.group_resolution_updated_at) !== null ? dateLabel(instant(q.source.group_resolution_updated_at)) : "尚未確認"}` : "";
      sources.push(`<p><strong>來源資料時間</strong> 官方查詢紀錄 ${instant(q.source?.checkpoint_updated_at) ? dateLabel(instant(q.source.checkpoint_updated_at)) : "尚未確認"}；每日初篩 ${instant(q.source?.prefilter_updated_at) ? dateLabel(instant(q.source.prefilter_updated_at)) : "尚未確認"}；資格清單 ${instant(q.source?.eligible_screened_at) ? dateLabel(instant(q.source.eligible_screened_at)) : "尚未確認"}；Twitch 匯入 ${instant(q.source?.twitch_import_updated_at) ? dateLabel(instant(q.source.twitch_import_updated_at)) : "尚未確認"}${groupUpdated}。快照產生時間不代表上述來源剛剛更新。</p>`);
    }
    if (q?.batch) sources.push(`<p><strong>最新批次回報</strong> ${instant(q.batch.last_updated_at) ? dateLabel(instant(q.batch.last_updated_at)) : "時間未確認"} · 本批查詢 ${num(q.batch.requests_this_run) ?? "未知"} 次 · 新取得官方值 ${num(q.batch.official_new_this_run) ?? "未知"} 款${q.batch.last_name ? "；最後回報嘗試 " + esc(q.batch.last_name) : ""}。這是已回報進度，當下執行狀態以 Actions 觀測為準。</p>`);
    if (q?.group_resolution_api_cooldown) {
      const apiCooldown = q.group_resolution_api_cooldown;
      const observed = instant(apiCooldown.observed_at), retry = instant(apiCooldown.retry_at);
      sources.push(`<p><strong>群組 ID 解析 API</strong> ${observed !== null ? "觀測於 " + dateLabel(observed) : "觀測時間未確認"}${apiCooldown.status ? " · " + esc(apiCooldown.status) : ""}${Number.isInteger(apiCooldown.http) ? " · HTTP " + apiCooldown.http : ""}${retry !== null ? " · 解析 API 可重試時間 " + dateLabel(retry) : ""}。這是群組解析 API 的狀態，與 Steam Community Followers 冷卻分開記錄。</p>`);
    }
    sources.push("<p>每個儲存庫讀取最近最多 50 筆 Actions；較早或未涵蓋的時段保留待確認。官方查詢事件保留最近 100 筆，本頁呈現其中今日事件。</p>");
    $("sourcesDetails").innerHTML = sources.join("");
    renderQueue(); renderSchedule(); renderEvents();
  }
  async function refresh() {
    if (state.busy) return; state.busy = true; $("refreshButton").disabled = true; $("errorMessage").hidden = true;
    try { await snapshotLoad(); } catch { $("errorMessage").hidden = false; $("errorMessage").textContent = state.queue ? "佇列更新失敗，目前保留上次快照。" : "佇列暫時無法讀取；待查數量保留未知，稍後可再更新。"; }
    render();
    const results = await Promise.allSettled([readReceipt("growth.json"), readReceipt("content_refresh_status.json"), readReceipt("twitch_collection_status.json"), readReceipt("nintendo_refresh_status.json"), ...[...new Set(JOBS.map(j => j.repo))].map(readRuns)]);
    for (const [i, key] of ["growth", "content", "twitch", "igdb"].entries()) if (results[i].status === "fulfilled" && results[i].value) state[key] = results[i].value;
    render(); state.busy = false; $("refreshButton").disabled = false;
  }
  $("refreshButton").addEventListener("click", refresh);
  $("queueSearch").addEventListener("input", renderQueue); $("queueFilter").addEventListener("change", renderQueue);
  $("scheduleTimeline").addEventListener("click", e => { const button = e.target.closest("[data-slot-note]"); if (button) $("scheduleCaption").textContent = button.dataset.slotNote; });
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  refresh();
})(typeof globalThis !== "undefined" ? globalThis : this);
