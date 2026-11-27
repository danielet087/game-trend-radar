// Calendar dates never undergo timestamp conversion; time-aware values use Taipei.

export const DAY = 86400000;

export const validDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + "T12:00:00Z")) &&
  new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value;

export function todayInTaipei(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((key) => parts.find((part) => part.type === key).value)
    .join("-");
}

const QUARTERS = ["一", "二", "三", "四"];
/** Steam's later date at the precision it gave it: "2027/03/31", "2027 年 3 月",
 *  "2027 年第一季", "2027 年"; a precision not known is "日期未定". A month,
 *  quarter or year is given by its last day. */
export function releaseWindowText(date, precision) {
  if (!validDate(date)) return "日期未定";
  const [year, month] = date.split("-").map(Number);
  return precision === "day" ? date.replaceAll("-", "/")
    : precision === "month" ? `${year} 年 ${month} 月`
    : precision === "quarter" ? `${year} 年第${QUARTERS[Math.ceil(month / 3) - 1]}季`
    : precision === "year" ? `${year} 年` : "日期未定";
}

export const offsetDate = (date, days) =>
  new Date(Date.parse(date + "T12:00:00Z") + days * DAY)
    .toISOString()
    .slice(0, 10);

export function awareTime(value) {
  if (typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !validDate(value.slice(0, 10)) || Number(value.slice(11, 13)) > 23 ||
    Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}
