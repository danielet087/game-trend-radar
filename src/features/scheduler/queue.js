import { HOUR, num, appid, instant, dateLabel, UNRESOLVED_GROUP_STATUSES } from "./primitives.js";
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
    const twitchAlternative = " 若本次查無 GroupID，可依本作 Twitch 新遊戲資格與曾達 7,000 總觀眾的有效證據收錄；未達標或缺少證據仍待觀察。";
    return { stage: "awaiting_group", awaitingGroup: true, label, detail: detail + twitchAlternative + (parked ? " 目前仍計入暫停項目。" : ""), kind, metadata };
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
export { queueGameState, groupQueueCounts, igdbReceiptSummary, validateQueue };
