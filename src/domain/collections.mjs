// Event selection and identity-scoped list representatives.
import { gameKey } from './identity.mjs';
import { offsetDate } from './dates.mjs';

export function detailURL(game) {
  return game.source === "nintendo"
    ? `./game.html?igdb=${game.igdbId}&date=${game.date}`
    : `./game.html?appid=${game.appid}${game.hasNintendo ? `&date=${game.date}` : ""}`;
}

export function observedMetricCompare(left, right) {
  const knownLeft = Number.isFinite(left), knownRight = Number.isFinite(right);
  return knownLeft !== knownRight ? knownLeft ? -1 : 1
    : knownLeft ? right - left : 0;
}

export function popularityCompare(a, b) {
  // Counts belong to different communities; only compare within their source.
  if ((a.source === "nintendo") !== (b.source === "nintendo")) return a.source === "nintendo" ? 1 : -1;
  return observedMetricCompare(a.source === "nintendo" ? a.hypes : a.followers,
    b.source === "nintendo" ? b.hypes : b.followers) ||
    a.date.localeCompare(b.date) || a.name.localeCompare(b.name, "zh-TW");
}

export function calendarFeatured(games) {
  const ranked = [...games].sort(popularityCompare);
  const steam = ranked.filter(game => game.source !== "nintendo");
  const nintendo = ranked.filter(game => game.source === "nintendo");
  return steam.length && nintendo.length ? [steam[0], nintendo[0]] : ranked.slice(0, 2);
}

export const unique = (items) =>
  Array.from(new Map(items.map((game) => [gameKey(game), game])).values());

export function cardGames(items, direction = "earliest") {
  const groups = new Map();
  for (const game of items) {
    const key = game.identityKey || `game:${game.appid}`;
    const current = groups.get(key);
    if (!current || (direction === "latest" ? game.date > current.date : game.date < current.date))
      groups.set(key, game);
  }
  return [...groups.values()];
}

export function selectGames(data, mode, today, date = null) {
  if (mode === "released")
    return data.recent.filter(
      (game) => game.date >= offsetDate(today, -30) && game.date <= today,
    );
  if (mode === "upcoming")
    return data.games.filter(
      (game) => game.date >= today && game.date <= offsetDate(today, 45),
    );
  if (mode === "date") return data.games.filter((game) => game.date === date);
  if (mode === "saved" || mode === "all")
    return unique([...data.games, ...data.recent]);
  return data.games;
}
