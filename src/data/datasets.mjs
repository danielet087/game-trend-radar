// Public dataset coordination and per-source update provenance.
import { awareTime } from '../domain/dates.mjs';
import { unique } from '../domain/collections.mjs';
import { mergePlatformGames } from '../domain/merge.mjs';
import { normalize, normalizeReference } from './steam.mjs';
import { nintendoGames } from './native.mjs';

export function latestSourceUpdate(...values) {
  const valid = values.map(value => ({ value, instant: awareTime(value) }))
    .filter(entry => entry.instant !== null);
  return valid.sort((a, b) => b.instant - a.instant)[0]?.value || null;
}

/** Steam versions of console games: merge targets only, never rows of their own. */
export function steamReferences(payload) {
  if (!payload || typeof payload !== "object" || payload.schema_version !== 1 || !Array.isArray(payload.games)) return [];
  return unique(payload.games.map(normalizeReference).filter(Boolean));
}

export function datasets(official, preview, nintendo = null, references = null) {
  const chosen = official || preview;
  const nintendoRows = nintendoGames(nintendo);
  if (!chosen && !nintendo) return null;
  const translations = new Map(
    (preview?.games || [])
      .filter(Boolean)
      .map((game) => [Number(game.appid), game]),
  );
  const steamUpdated = latestSourceUpdate(chosen?.generated_at, chosen?.updated_at);
  const nintendoUpdated = latestSourceUpdate(nintendo?.generated_at);
  const steamGames = unique((chosen?.games || []).map(game =>
    normalize(game, false, translations.get(Number(game?.appid)))).filter(Boolean));
  const steamRecent = unique([
    ...(preview?.recent_games || []).map(game => normalize(game, true)),
    ...(chosen?.games || []).map(game => normalize(game, true, translations.get(Number(game?.appid)))),
  ].filter(Boolean));
  // unique() keeps the last row per game: a catalog row wins over a console
  // game's Steam reference, as the complete catalog wins over recent rows.
  const steamReference = unique([...steamReferences(references), ...steamRecent, ...steamGames]);
  return {
    games: mergePlatformGames(steamGames, nintendoRows, steamReference),
    recent: mergePlatformGames(steamRecent, nintendoRows, steamReference),
    updated: latestSourceUpdate(steamUpdated, nintendoUpdated),
    steamUpdated,
    recentUpdated: chosen?.generated_at || preview?.generated_at || nintendo?.generated_at || null,
    nintendoUpdated,
    nintendoAvailable: !!nintendo,
    partial:
      !!chosen?.is_partial_preview ||
      chosen?.initialization?.complete === false || !chosen,
    initialization: chosen?.initialization || null,
    recentAvailable: chosen?.version >= 2 || (!!preview && Array.isArray(preview.recent_games)) || !!nintendo,
    source: official ? "official" : preview ? "preview" : "nintendo",
  };
}
