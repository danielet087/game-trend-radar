import { awareTime } from './dates.mjs';

export function followerDay(value) {
  const time = awareTime(value);
  return time === null ? null : new Date(time + 8 * 3600000).toISOString().slice(0, 10);
}

/** The catalog and dated official history describe the same Steam measurement. */
export function followerHistory(record, history) {
  return [
    ...(Array.isArray(history) ? history : []),
    ...(record?.follower_checked_at ? [{ at:record.follower_checked_at,
      followers:record.followers, source:'steam_community' }] : []),
  ];
}

export function dailyFollowerPoints(history, today) {
  const days = new Map();
  for (const point of Array.isArray(history) ? history : []) {
    const date = followerDay(point?.at);
    if (!date || date > today || !Number.isSafeInteger(point.followers) || point.followers < 0 || point.source !== 'steam_community') continue;
    if (!days.has(date) || Date.parse(days.get(date).at) < Date.parse(point.at))
      days.set(date, { ...point, day:date });
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Apply display metrics only after the catalog has established membership and dates. */
export function withLatestFollowers(game, record, history, today) {
  if (game.source === 'nintendo') return game;
  const latest = dailyFollowerPoints(followerHistory(record, history), today).at(-1);
  return latest ? { ...game, followers:latest.followers, followersCheckedAt:latest.at } : game;
}
