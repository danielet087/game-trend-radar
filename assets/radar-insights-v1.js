/* Exact dated observations: missing history never becomes zero growth. */
(function (root) {
  "use strict";
  const DAY = 86400000;
  const day = value => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const time = Date.parse(value + "T12:00:00Z");
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
  };
  const offset = (value, days) => day(value) ? new Date(Date.parse(value + "T12:00:00Z") + days * DAY).toISOString().slice(0, 10) : null;
  function taipeiDay(value) {
    if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 10) : null;
  }
  function points(history, today) {
    const days = new Map();
    for (const point of Array.isArray(history) ? history : []) {
      const date = taipeiDay(point?.at);
      if (!date || date > today || !Number.isSafeInteger(point.followers) || point.followers < 0 || point.source !== "steam_community") continue;
      if (!days.has(date) || Date.parse(days.get(date).at) < Date.parse(point.at))
        days.set(date, { ...point, day: date });
    }
    return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  }
  function metric(history, span, today) {
    const series = points(history, today);
    const latest = series.at(-1);
    if (!latest) return { status: "missing", series };
    if (latest.day < offset(today, -2)) return { status: "stale", latest, series };
    const baseline = series.find(point => point.day === offset(latest.day, -span));
    if (!baseline) return { status: "accumulating", latest, series };
    const delta = latest.followers - baseline.followers;
    return { status: "ready", latest, baseline, delta,
      percent: baseline.followers > 0 ? delta / baseline.followers * 100 : null, series };
  }
  const tracking = (release, today) => !!day(release) && !!day(today) && today <= offset(release, 30);
  function comparisonIds(value) {
    return [...new Set((Array.isArray(value) ? value : String(value || "").split(","))
      .map(String).filter(id => /^[1-9]\d{0,9}$/.test(id)).map(Number))].slice(0, 3);
  }
  const api = { day, offset, taipeiDay, points, metric, tracking, comparisonIds };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RadarInsights = api;
})(typeof window !== "undefined" ? window : globalThis);
