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
  /* Comparison uses one shared calendar window, including archived observations.
     Neither an absent daily sample nor an absent endpoint is estimated. */
  function comparisonWindow(games, span = 30, end, today) {
    if (!day(today)) throw new TypeError("A valid Taipei calendar date is required");
    span = [7, 30, 90].includes(Number(span)) ? Number(span) : 30;
    const selected = [];
    const seen = new Set();
    for (const game of Array.isArray(games) ? games : []) {
      const appid = comparisonIds([game?.appid])[0];
      if (!appid || seen.has(appid)) continue;
      seen.add(appid);
      const release = day(game.date);
      const trackUntil = release ? offset(release, 30) : null;
      const history = release ? points((Array.isArray(game.history) ? game.history : [])
        .filter(point => day(typeof point?.at === "string" ? point.at.slice(0, 10) : null)), today)
        .filter(point => point.day <= trackUntil) : [];
      selected.push({ appid, trackUntil, history });
      if (selected.length === 3) break;
    }
    const lastObserved = selected.map(game => game.history.at(-1)?.day)
      .filter(Boolean).sort().at(-1);
    end = day(end) && end <= today ? end : lastObserved || today;
    const start = offset(end, -span);
    const days = Array.from({ length: span + 1 }, (_, index) => offset(start, index));
    const series = selected.map(game => {
      const visible = game.history.filter(point => point.day >= start && point.day <= end);
      const byDay = new Map(visible.map(point => [point.day, point]));
      const values = days.map(date => byDay.get(date)?.followers ?? null);
      const daily = values.map((value, index) => index > 0 && value !== null && values[index - 1] !== null
        ? value - values[index - 1] : null);
      const baseline = byDay.get(start) || null;
      const endPoint = byDay.get(end) || null;
      const delta = baseline && endPoint ? endPoint.followers - baseline.followers : null;
      const percent = delta !== null && baseline.followers > 0 ? delta / baseline.followers * 100 : null;
      return {
        appid: game.appid, points: visible, values, daily, baseline, endPoint, delta, percent,
        status: !game.trackUntil ? "invalid" : baseline && endPoint ? "ready" : visible.length ? "partial" : "missing",
        trackUntil: game.trackUntil, tracking: !!game.trackUntil && today <= game.trackUntil,
        observedDays: visible.length,
      };
    });
    return { start, end, days, span, series };
  }
  const api = { day, offset, taipeiDay, points, metric, tracking, comparisonIds, comparisonWindow };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RadarInsights = api;
})(typeof window !== "undefined" ? window : globalThis);
