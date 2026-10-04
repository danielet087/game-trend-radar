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
  /* Activity identities stay in their source namespace. A missing source is
     supported only for the existing Steam event format. */
  function activityTime(value) {
    if (typeof value !== "string") return null;
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
    if (!match || !day(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 ||
        Number(match[4]) > 59 || Number(match[6] || 0) > 23 || Number(match[7] || 0) > 59) return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }
  const activityId = value => Number.isSafeInteger(value) && value > 0 && /^[1-9]\d{0,9}$/.test(String(value));
  function activityEvent(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        typeof value.name !== "string" || !value.name.trim() || !day(value.date) || activityTime(value.at) === null) return null;
    const source = value.source === undefined ? "steam" : value.source;
    if (!["steam", "nintendo"].includes(source) || !["added", "release_date", "platform_added"].includes(value.type)) return null;
    if (value.type === "release_date" && (!day(value.previous_date) || value.previous_date === value.date)) return null;
    const event = { source, type: value.type, name: value.name.trim(), date: value.date, at: value.at };
    if (value.type === "release_date") event.previous_date = value.previous_date;
    if (source === "nintendo") {
      if (!activityId(value.igdb_id) || value.game_id !== "igdb:" + value.igdb_id || value.appid !== undefined ||
          !Array.isArray(value.platforms) || !value.platforms.length || value.platforms.some(platform => !["NS", "NS2"].includes(platform))) return null;
      event.igdb_id = value.igdb_id;
      event.game_id = value.game_id;
      event.platforms = ["NS", "NS2"].filter(platform => value.platforms.includes(platform));
    } else {
      if (!activityId(value.appid) || value.igdb_id !== undefined || value.game_id !== undefined || value.type === "platform_added") return null;
      event.appid = value.appid;
    }
    return event;
  }
  function activityEvents(values) {
    const events = (Array.isArray(values) ? values : []).map(activityEvent).filter(Boolean);
    events.sort((a, b) => activityTime(b.at) - activityTime(a.at));
    const seen = new Set();
    return events.filter(event => {
      const key = JSON.stringify([event.source, event.appid ?? event.game_id, event.type, event.date,
        event.previous_date ?? null, event.platforms ?? null, activityTime(event.at)]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 400);
  }
  function activityURL(value) {
    const event = activityEvent(value);
    return !event ? null : event.source === "nintendo"
      ? `./game.html?igdb=${event.igdb_id}&date=${event.date}` : `./game.html?appid=${event.appid}`;
  }
  function activityPlatform(value) {
    const event = activityEvent(value);
    return !event ? null : event.source === "nintendo" ? event.platforms.join("／") : "Steam";
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
  const api = { day, offset, taipeiDay, activityEvent, activityEvents, activityURL, activityPlatform,
    points, metric, tracking, comparisonIds, comparisonWindow };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RadarInsights = api;
})(typeof window !== "undefined" ? window : globalThis);
