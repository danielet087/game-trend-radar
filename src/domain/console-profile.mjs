// A console game's profile from IGDB: its genres and themes in the site's own
// words (the Steam genre and tag names the discovery labels translate), the
// companies and series behind it, and its official media as IDs only — the
// image and video addresses are built here, so no other host can appear.

// IGDB genre -> the site's genre and tags.
const GENRES = Object.freeze({
  'Point-and-click': { genre: 'Adventure', tags: ['Point & Click'] },
  Fighting: { genre: 'Action', tags: ['Fighting'] },
  Shooter: { genre: 'Action', tags: ['Shooter'] },
  Music: { tags: ['Music', 'Rhythm'] },
  Platform: { genre: 'Action', tags: ['Platformer'] },
  Puzzle: { genre: 'Casual', tags: ['Puzzle'] },
  Racing: { genre: 'Racing', tags: ['Racing'] },
  'Real Time Strategy (RTS)': { genre: 'Strategy', tags: ['RTS'] },
  'Role-playing (RPG)': { genre: 'RPG', tags: ['RPG'] },
  Simulator: { genre: 'Simulation', tags: ['Simulation'] },
  Sport: { genre: 'Sports', tags: ['Sports'] },
  Strategy: { genre: 'Strategy', tags: ['Strategy'] },
  'Turn-based strategy (TBS)': { genre: 'Strategy', tags: ['Turn-Based Strategy'] },
  Tactical: { genre: 'Strategy', tags: ['Tactical'] },
  "Hack and slash/Beat 'em up": { genre: 'Action', tags: ['Hack and Slash', "Beat 'em up"] },
  'Quiz/Trivia': { genre: 'Casual', tags: ['Trivia'] },
  Pinball: { genre: 'Casual', tags: ['Pinball'] },
  Adventure: { genre: 'Adventure', tags: ['Adventure'] },
  Indie: { genre: 'Indie', tags: ['Indie'] },
  Arcade: { tags: ['Arcade'] },
  'Visual Novel': { genre: 'Adventure', tags: ['Visual Novel'] },
  'Card & Board Game': { tags: ['Card Game', 'Board Game'] },
  MOBA: { genre: 'Strategy', tags: ['MOBA'] },
});
// IGDB theme -> the site's tags (Action also names the genre).
const THEMES = Object.freeze({
  Action: { genre: 'Action', tags: ['Action'] },
  Fantasy: { tags: ['Fantasy'] },
  'Science fiction': { tags: ['Sci-fi'] },
  Horror: { tags: ['Horror'] },
  Thriller: { tags: ['Thriller'] },
  Survival: { tags: ['Survival'] },
  Historical: { tags: ['Historical'] },
  Stealth: { tags: ['Stealth'] },
  Comedy: { tags: ['Comedy'] },
  Business: { tags: ['Management'] },
  Drama: { tags: ['Drama'] },
  Sandbox: { tags: ['Sandbox'] },
  Educational: { tags: ['Education'] },
  Kids: { tags: ['Family Friendly'] },
  'Open world': { tags: ['Open World'] },
  Warfare: { tags: ['War'] },
  Party: { tags: ['Party Game'] },
  '4X (explore, expand, exploit, and exterminate)': { tags: ['4X'] },
  Mystery: { tags: ['Mystery'] },
  Romance: { tags: ['Romance'] },
});
const IMAGE_ID = /^[a-z0-9]{1,40}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const IMAGE_BASE = 'https://images.igdb.com/igdb/image/upload/';

const names = (value, limit) => [...new Set((Array.isArray(value) ? value : [])
  .filter(name => typeof name === 'string').map(name => name.replace(/\p{Cf}/gu, '').trim().slice(0, 120))
  .filter(Boolean))].slice(0, limit);
const imageIDs = (value, limit) => [...new Set((Array.isArray(value) ? value : [])
  .filter(id => typeof id === 'string' && IMAGE_ID.test(id)))].slice(0, limit);

/** IGDB image address of one size (t_screenshot_med, t_1080p, ...). */
export const igdbImage = (id, size) => IMAGE_ID.test(id || '') ? `${IMAGE_BASE}${size}/${id}.jpg` : '';
export const youtubeURL = id => VIDEO_ID.test(id || '') ? `https://www.youtube.com/watch?v=${id}` : '';
export const youtubePoster = id => VIDEO_ID.test(id || '') ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';

/** The fields a console row adds to its game: genres, tags, companies, series and media IDs. */
export function consoleProfile(raw) {
  const genres = [], tags = [];
  const add = mapping => {
    if (!mapping) return;
    if (mapping.genre && !genres.includes(mapping.genre)) genres.push(mapping.genre);
    for (const tag of mapping.tags || []) if (!tags.includes(tag)) tags.push(tag);
  };
  for (const name of names(raw?.igdb_genres, 6)) add(GENRES[name]);
  for (const name of names(raw?.igdb_themes, 6)) add(THEMES[name]);
  const media = raw?.media && typeof raw.media === 'object' && !Array.isArray(raw.media) ? raw.media : {};
  const videos = [];
  for (const row of Array.isArray(media.videos) ? media.videos : []) {
    if (!VIDEO_ID.test(row?.id || '') || videos.some(video => video.id === row.id)) continue;
    videos.push({ id: row.id, name: typeof row.name === 'string' ? row.name.trim().slice(0, 200) : '' });
  }
  return {
    genres, tags,
    developers: names(raw?.developers, 4), publishers: names(raw?.publishers, 4), franchises: names(raw?.franchises, 2),
    igdbMedia: { screenshots: imageIDs(media.screenshots, 8), artworks: imageIDs(media.artworks, 3), videos: videos.slice(0, 3) },
  };
}
