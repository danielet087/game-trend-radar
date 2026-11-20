// A console game's IGDB profile in the site's words, and its media as safe addresses.
const test = require('node:test');
const assert = require('node:assert/strict');
const { consoleProfile, igdbImage, youtubeURL, youtubePoster } = require('../src/domain/console-profile.mjs');
const D = require('../src/domain/index.mjs').RadarData;
const R = require('../src/features/discovery/index.js').RadarDiscovery;

test('IGDB genres and themes read as the site genres and tags the discovery labels translate', () => {
  const profile = consoleProfile({
    igdb_genres: ['Role-playing (RPG)', "Hack and slash/Beat 'em up", 'Unknown genre', 7],
    igdb_themes: ['Fantasy', 'Open world', 'Action', 'Non-fiction'],
    developers: ['Monolith Soft', '', '⁠', 'Monolith Soft'], publishers: ['Nintendo'], franchises: ['Xenoblade Chronicles'],
  });
  assert.deepEqual(profile.genres, ['RPG', 'Action']);
  assert.deepEqual(profile.tags, ['RPG', 'Hack and Slash', "Beat 'em up", 'Fantasy', 'Open World', 'Action']);
  assert.deepEqual(profile.tags.map(R.label), ['角色扮演', '砍殺', '清版格鬥', '奇幻', '開放世界', '動作']);
  assert.deepEqual([profile.developers, profile.publishers, profile.franchises],
    [['Monolith Soft'], ['Nintendo'], ['Xenoblade Chronicles']]);
  assert.deepEqual(consoleProfile(null), { genres: [], tags: [], developers: [], publishers: [], franchises: [],
    igdbMedia: { screenshots: [], artworks: [], videos: [] } });
});

test('media keep only IGDB image IDs and YouTube video IDs, and addresses are built from them', () => {
  const { igdbMedia } = consoleProfile({ media: {
    screenshots: ['sc6h3s', 'sc6h3s', '../evil', 'https://evil.test/a.jpg', ...Array.from({ length: 10 }, (_, i) => `sc${i}`)],
    artworks: ['ar1x0b', 'AR-UPPER'],
    videos: [{ id: 'dQw4w9WgXcQ', name: ' Announcement Trailer ' }, { id: 'javascript:a', name: 'bad' }, { id: 'dQw4w9WgXcQ' }],
  } });
  assert.equal(igdbMedia.screenshots.length, 8);
  assert.equal(igdbMedia.screenshots[0], 'sc6h3s');
  assert.ok(igdbMedia.screenshots.every(id => /^[a-z0-9]+$/.test(id)));
  assert.deepEqual(igdbMedia.artworks, ['ar1x0b']);
  assert.deepEqual(igdbMedia.videos, [{ id: 'dQw4w9WgXcQ', name: 'Announcement Trailer' }]);
  assert.equal(igdbImage('sc6h3s', 't_1080p'), 'https://images.igdb.com/igdb/image/upload/t_1080p/sc6h3s.jpg');
  assert.equal(igdbImage('../evil', 't_1080p'), '');
  assert.equal(youtubeURL('dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(youtubePoster('dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(youtubeURL('bad id'), '');
});

test('a console game carries its profile, so similar games can share its tags', () => {
  const games = D.nintendoGames({ schema_version: 1, games: [{
    id: 'igdb:99', igdb_id: 99, name_en: 'Example', hypes: 40, sexual_content_screened: true,
    platforms: [{ id: 508, code: 'NS2' }], url: 'https://www.igdb.com/games/example',
    releases: [{ date: '2026-12-10', platform: 'NS2', precision: 'day', region: 'worldwide', source: 'IGDB' }],
    igdb_genres: ['Role-playing (RPG)'], igdb_themes: ['Fantasy'], developers: ['Studio'],
    media: { screenshots: ['sc1'], artworks: [], videos: [] },
  }] });
  const [game] = games;
  assert.deepEqual([game.genres, game.tags, game.developers], [['RPG'], ['RPG', 'Fantasy'], ['Studio']]);
  assert.deepEqual(game.igdbMedia.screenshots, ['sc1']);
  const other = { appid: 7, date: '2026-12-11', followers: 9000, tags: ['Fantasy'] };
  assert.equal(R.recommendations(game, [game, other]).basis, 'shared');
});
