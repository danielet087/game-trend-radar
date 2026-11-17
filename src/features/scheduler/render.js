import { HOUR, DAY, JOBS, num, instant, day, dateLabel, clockLabel, esc, steamUrl } from "./primitives.js";
import { buildSlots, dashboardState, eventHistory, queueGameState, groupQueueCounts, igdbReceiptSummary } from "./data.js";
import { freshRepositories } from "./state.js";
export function createSchedulerRenderer(state, $) {
const freshRepos = () => freshRepositories(state);
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
  $("scheduleTimeline").innerHTML = `<div class="schedule-hours"><span class="schedule-label">原定時段 → 實際執行</span><div class="schedule-track schedule-ticks">${ticks}</div></div>` + rows.map(({ job, slots, summary }, index) => `${job.maintenance && !rows[index - 1]?.job.maintenance ? '<div class="schedule-group"><span class="schedule-label">維護工作</span></div>' : ""}<div class="schedule-lane${summary ? " is-recheck" : ""}"><div class="schedule-label"><strong>${esc(job.name)}</strong><small>${esc(job.note)}</small>${summary ? `<span class="schedule-result${summary.confirmed ? " is-confirmed" : ""}" role="status">${esc(summary.text)}</span>${summary.confirmed && summary.total ? `<small>已完成 ${summary.completed.toLocaleString("zh-TW")} · 尚待 ${summary.remaining.toLocaleString("zh-TW")}</small>` : ""}` : ""}</div><div class="schedule-track"><span class="schedule-now" style="left:${nowPosition}%" aria-hidden="true"></span>${slots.map(slot => {
    const label = `${clockLabel(slot.at)} · ${job.name} · ${slot.text}${slot.run ? "，實際 " + clockLabel(instant(slot.run.started_at) ?? instant(slot.run.created_at)) + (slot.run.started_at ? " 開始" : " 建立／排隊") : ""}`;
    const common = `class="schedule-slot is-${slot.state}" style="left:${(slot.at - start) / DAY * 100}%" title="${esc(label)}" aria-label="${esc(label)}"`;
    return slot.run?.url ? `<a ${common} href="${slot.run.url}" target="_blank" rel="noopener noreferrer"><span class="sr-only">${esc(label)}</span></a>` : `<button ${common} type="button" data-slot-note="${esc(label)}"><span class="sr-only">${esc(label)}</span></button>`;
  }).join("")}</div></div>`).join("");
  $("scheduleCaption").textContent = `藍線為現在 ${clockLabel(now)}。圓點位置代表原定時段；點選可查看實際開始時間與 Actions。「Follower 回查盤點」顯示最近實際盤點回報的時間與今日筆數，盤點完成後由「官方 Followers」分批查詢。每日候選更新與 Steam 成長追蹤每 6 小時檢查，當日完整成功後略過後續時段。維護工作另保留 GitHub 原生排程作備援，備援執行會記在它涵蓋的原定時段；憑證到期檢查把四個儲存庫合成一點，點選可看各自結果。資料更新觸發的前端動態若在 :17 時還在跑，控制器不再另派，該時段記為那次執行。灰色過去時段代表尚未取得紀錄，不直接判定失敗。`;
}
const STATE_LABEL = { success: "已完成", interrupted: "已中斷", running: "進行中", waiting: "等待", skipped: "已略過", unknown: "待確認" };
function eventItem(e) {
  return `<li class="timeline-event is-${e.state}" id="${e.id}"><time class="event-time" datetime="${new Date(e.at).toISOString()}">${clockLabel(e.at)}</time><div class="event-card"><span class="event-state state-${e.state}">${STATE_LABEL[e.state]}</span><h3>${esc(e.title)}</h3><p>${esc(e.detail)}</p>${e.url ? `<a class="event-link" href="${e.url}" target="_blank" rel="noopener noreferrer">查看這次執行 ↗</a>` : ""}</div></li>`;
}
// One folded line per job for today's routine successes; every one stays reachable.
function routineItem(group) {
  const latest = group.events[0], attempts = group.key === "official_attempts";
  const summary = attempts ? `${group.title} · 今天 ${group.events.length} 款` : `${group.title} · 今天 ${group.events.length} 次例行執行完成`;
  const entries = group.events.map(e => {
    const text = esc(clockLabel(e.at) + (e.brief ? " " + e.brief : ""));
    return e.url ? `<a href="${e.url}" target="_blank" rel="noopener noreferrer">${text}</a>` : `<span>${text}</span>`;
  }).join(" · ");
  return `<li class="timeline-event is-success is-routine" id="routine-${esc(group.key)}"><time class="event-time" datetime="${new Date(latest.at).toISOString()}">${clockLabel(latest.at)}</time><div class="event-card"><span class="event-state state-success">例行</span><details class="routine-group"><summary>${esc(summary)}</summary><p class="routine-runs">${entries}</p></details></div></li>`;
}
function renderEvents() {
  const events = eventHistory(state.queue, state.runs, state.growth, Date.now(), freshRepos());
  const groups = new Map();
  for (const e of events) {
    if (!e.routine) continue;
    if (!groups.has(e.group)) groups.set(e.group, { key: e.group, title: e.group_title, events: [] });
    groups.get(e.group).events.push(e);
  }
  const folded = [...groups.values()].map(routineItem);
  const listed = events.filter(e => !e.routine).map(eventItem).concat(folded.length ? ['<li class="timeline-group-label">例行成功（依工作收合，時間為最近一次）</li>', ...folded] : []);
  $("eventTimeline").innerHTML = listed.length ? listed.join("") : '<li class="empty-state">今日執行紀錄尚未取得。原定排程不會被當成實際執行。</li>';
  $("eventTimelineNote").textContent = "由新到舊列出需要注意的事件與手動執行；例行成功依工作收合在最後，點開可看每一次。實際查詢中斷會單獨記錄，即使 Actions 最後顯示成功。";
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
  const sources = [q ? `<p><strong>佇列快照</strong> ${esc(q.generated_at)} · ${esc(state.queueSource)}</p>` : "<p>佇列快照無法讀取。</p>", ...[...new Set(JOBS.map(j => j.repo))].map(repo => `<p><strong>${esc(repo)}</strong> · ${state.repoChecks[repo] ? "上次核對 " + dateLabel(state.repoChecks[repo]) : "尚未取得執行紀錄"}${state.repoErrors[repo] ? " · " + esc(state.repoErrors[repo]) : ""}</p>`), `<p>Cloudflare 沿用 <code>0,5,15,17,30 * * * *</code>。原定排程、Actions 執行結果與實際收集成果分開呈現。</p>`, `<p>內容對帳：${state.content ? state.content.complete ? "最近快照已完成對帳" : "仍有未完成內容" : "尚未取得"}。Twitch 最近完整發布：${instant(state.twitch?.completed_at) ? dateLabel(instant(state.twitch.completed_at)) : "尚未確認"}。</p>`];
  const igdb = igdbReceiptSummary(state.igdb);
  sources.push(igdb ? `<p><strong>IGDB 主機收集（${igdb.platforms}）</strong> ${igdb.partial ? "公開資料已保存於 " + dateLabel(igdb.committedAt) + "，另有歷史候選待查；保留原查詢時間，下次排程再試" : igdb.persisted ? "資料已保存於 " + dateLabel(igdb.committedAt) : igdb.published ? "完整發布於 " + dateLabel(igdb.publishedAt) : "最近回報尚未確認完成"}；收集時間 ${dateLabel(igdb.generatedAt)}；候選 ${igdb.candidateCount.toLocaleString("zh-TW")} 款、公開 ${igdb.publicCount.toLocaleString("zh-TW")} 款、待處理 ${igdb.pendingCount.toLocaleString("zh-TW")} 款。每日 08:30 沿用既有 IGDB 流程，這些數量不計入上方 Steam Followers 待查佇列。</p>` : "<p><strong>IGDB 主機收集（NS／NS2／PS5）</strong> 最近收集與發布回條尚未取得；待處理數量保留未知。每日 08:30 沿用既有 IGDB 流程，與 Steam Followers 待查佇列分開。</p>");
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
  sources.push("<p>每個儲存庫讀取今日（台灣時間）建立的 Actions；當天超過 100 筆時，較早的部分最多每 30 分鐘補讀一次，仍未涵蓋的時段保留待確認。官方查詢事件保留最近 100 筆，本頁呈現其中今日事件。</p>");
  $("sourcesDetails").innerHTML = sources.join("");
  renderQueue(); renderSchedule(); renderEvents();
}
return { render, renderQueue };
}
