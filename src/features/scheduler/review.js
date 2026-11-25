import { instant, dateLabel, esc } from "./primitives.js";

// The monthly rule review: scripts/rule_review.mjs reruns the checks behind the
// launch and heat rules with the first projection of each Taiwan month and the
// site publishes the result as data/rule_review.json. The page only reports it;
// a rule marked 要注意 is looked at again with the backtest scripts.
const STATES = Object.freeze({
  watch: Object.freeze({ label: "要注意", tone: "state-interrupted" }),
  few: Object.freeze({ label: "樣本不足", tone: "state-waiting" }),
  ok: Object.freeze({ label: "正常", tone: "state-success" }),
});
const ORDER = Object.keys(STATES);
const SEEN_KEY = "radarRuleReviewSeen";
const dayLabel = v => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit" }).format(new Date(v));
const text = value => typeof value === "string" && value.trim() ? value.trim() : null;

/** The review in a shape the page can trust, or null when it is missing or malformed. */
export function validateReview(value) {
  if (!value || typeof value !== "object" || value.schema_version !== 1 || !Array.isArray(value.checks)) return null;
  const generatedAt = instant(value.generated_at);
  if (generatedAt === null) return null;
  const checks = value.checks
    .filter(check => check && typeof check === "object" && text(check.id) && text(check.title) && text(check.summary) && Object.hasOwn(STATES, check.status))
    .map(check => ({ id: text(check.id), title: text(check.title), status: check.status, rule: text(check.rule),
      summary: text(check.summary), baseline: text(check.baseline), advice: text(check.advice) }));
  if (!checks.length) return null;
  return { generatedAt, stamp: value.generated_at, dataThrough: instant(value.data_through),
    launches: Number.isSafeInteger(value.launches) && value.launches >= 0 ? value.launches : null, checks };
}

const count = (review, status) => review.checks.filter(check => check.status === status).length;

/** One line on what this month's review found. */
export function reviewVerdict(review) {
  const watch = review.checks.filter(check => check.status === "watch"), ok = count(review, "ok"), few = count(review, "few");
  const parts = [];
  if (watch.length) parts.push(`${watch.length} 項要注意（${watch.map(check => check.title).join("、")}），要用回測重看`);
  if (ok) parts.push(watch.length ? `${ok} 項正常` : `${ok} 項都還在標準內，不用改`);
  if (few) parts.push(`${few} 項案例還不夠，先不判斷`);
  return parts.join("；") + "。";
}

/** The notice for a review the reader has not dismissed yet, or null. */
export function reviewNotice(review, seen) {
  if (!review) return null;
  const seenAt = instant(seen);
  if (seenAt !== null && seenAt >= review.generatedAt) return null;
  return { watch: count(review, "watch") > 0, text: `每月重算有更新（${dateLabel(review.generatedAt)}）：${reviewVerdict(review)}` };
}

/** The panel's date, note and check cards. */
export function reviewPanel(review) {
  if (!review) return { date: "尚未重算", note: "每月重算還沒有產生；每月第一次整理動態時會自動執行。",
    items: '<li class="empty-state">還沒有重算結果。</li>' };
  const facts = [`${dateLabel(review.generatedAt)} 重算`];
  if (review.dataThrough !== null) facts.push(`資料到 ${dateLabel(review.dataThrough)}`);
  if (review.launches !== null) facts.push(`有首日紀錄的新作 ${review.launches.toLocaleString("zh-TW")} 款`);
  const checks = [...review.checks].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const items = checks.map(check => {
    const state = STATES[check.status];
    const rows = [["這次", check.summary], ["驗證時", check.baseline], ["何時重看", check.advice]].filter(([, value]) => value);
    return `<li class="review-check is-${check.status}"><div class="review-check-head"><h3>${esc(check.title)}</h3><span class="event-state ${state.tone}">${state.label}</span></div>`
      + (check.rule ? `<p class="review-rule">${esc(check.rule)}</p>` : "")
      + `<dl class="review-facts">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl></li>`;
  });
  return { date: dayLabel(review.generatedAt) + " 重算", note: facts.join(" · ") + "。" + reviewVerdict(review), items: items.join("") };
}

export function seenReview() {
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}
export function markReviewSeen(review) {
  try { localStorage.setItem(SEEN_KEY, review.stamp); } catch {}
}
