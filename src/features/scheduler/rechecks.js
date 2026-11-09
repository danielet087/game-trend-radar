import { num, instant, day } from "./primitives.js";

function recheckPlanSummary(snapshot, now = Date.now()) {
  const plan = snapshot?.follower_recheck_plan;
  const unknown = { confirmed: false, at: null, text: "等待今日盤點", detail: "今日候選更新完成後，才會確認是否需要回查及遊戲筆數。" };
  if (!plan || plan.schema_version !== 1 || plan.status !== "completed" || plan.date_taipei !== day(now)) return unknown;
  const at = instant(plan.checked_at), total = num(plan.planned_count), completed = num(plan.completed_count);
  const remaining = num(plan.remaining_count), due = num(plan.due_now_count);
  if (at === null || at > now || day(at) !== day(now) || [total, completed, remaining, due].some(v => v === null) ||
      total !== completed + remaining || due > remaining || plan.needed !== (total > 0)) return unknown;
  const text = total ? `今天需回查 ${total.toLocaleString("zh-TW")} 款` : "今天無需回查";
  return { confirmed: true, at, total, completed, remaining, due, text,
    detail: total ? `盤點完成：今天需回查 ${total.toLocaleString("zh-TW")} 款，已完成 ${completed.toLocaleString("zh-TW")} 款，尚待 ${remaining.toLocaleString("zh-TW")} 款；其中 ${due.toLocaleString("zh-TW")} 款已到期，其餘於今天到期。實際查詢由「官方 Followers」分批執行。` : "盤點完成，今天沒有到期的定期回查項目。首次查詢與 Twitch 發現仍依原本佇列處理。" };
}

function recheckScheduleRow(job, date, snapshot, now) {
  const summary = recheckPlanSummary(snapshot, now);
  const at = summary.at ?? Date.parse(date + "T00:00:00+08:00");
  return { job, summary, slots: [{ at, hour: new Date(at + 8 * 3600000).getUTCHours(), minute: new Date(at).getUTCMinutes(),
    state: summary.confirmed ? "success" : "waiting", text: summary.detail, run: null }] };
}

export { recheckPlanSummary, recheckScheduleRow };
