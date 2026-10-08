const HOUR = 3600000, DAY = 24 * HOUR, ACTION_REFRESH = 5 * 60000;
const OWNER = "danielet087";
const RAW = "https://raw.githubusercontent.com/" + OWNER + "/";
const JOBS = Object.freeze([
  { id: "steam_daily", name: "每日候選更新", repo: "game-trend-radar-backend", workflow: "steam-two-phase.yml", hours: [0, 6, 12, 18], minute: 0, oncePerDay: true, note: "00:00／06:00／12:00／18:00 · 今日成功後略過" },
  { id: "steam_growth", name: "Steam 成長追蹤", repo: "game-trend-radar-backend", workflow: "steam-public-growth.yml", hours: [1, 7, 13, 19], minute: 15, oncePerDay: true, note: "01:15／07:15／13:15／19:15 · 今日成功後略過" },
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

export { HOUR, DAY, ACTION_REFRESH, OWNER, RAW, JOBS, ACTIVE, num, appid, instant, day, dateLabel, clockLabel, esc, runUrl, steamUrl, UNRESOLVED_GROUP_STATUSES };
