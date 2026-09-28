# Game Trend Radar UI

## Visual direction and provenance

An original, content-first game discovery interface. The calendar opens immediately, followed by upcoming picks and recent releases. A warm cream field, sparse radar marks, dotted texture and large cropped orbital shapes give the backdrop depth. The upper color field curves into the page, with honey, mint, peach, lavender and sky themes for the calendar, upcoming, released, saved and date pages. Lavender and mint patterned sections, cobalt controls and clean reading surfaces retain a playful identity without a promotional hero, carousel, scrolling ribbon or summary counters. A shared type scale, restrained shadows and consistent card actions connect all seven pages.

- `assets/radar-mark.svg`, `assets/radar-pattern.svg`, radar decoration, heart icon, CSS and UI text are authored for this project. The abstract pattern uses original circles, arcs, dots and strokes; it is a decorative CSS background with no hit targets or accessibility-tree content. No Nintendo/Pokémon logos, characters, illustrations, videos, sounds, screenshots, fonts or source code are included.
- **Noto Sans TC** is loaded from Google Fonts with `display=swap`; installed system fonts are the fallback. Its upstream license is [SIL Open Font License 1.1](https://github.com/google/fonts/blob/main/ofl/notosanstc/OFL.txt). The repository does not bundle font binaries.
- Game covers continue to use the Steam asset URLs provided by the existing dataset. Their rights remain with their respective owners. Those assets are distinct from the original site interface; this redesign does not grant additional rights to third-party game artwork.
- The reference websites informed general principles (clear hierarchy, cheerful color, generous imagery and responsive feedback), not reusable artwork or distinctive compositions. These implementation choices are not a legal clearance opinion.

## Interaction

- The single-day page uses an unframed date headline with compact circular previous/next controls. The year and weekday sit above the date, with supporting copy alongside on wide screens and below on phones. Adjacent-day navigation reuses the loaded catalog and retains filters and browser history.

- The home calendar opens first. Previous/next buttons, the current-month button and a native month picker keep the calendar and URL synchronized. Phones default to a card list with an explicit calendar/list switch.
- The entire card opens the site's `game.html?appid=...` profile. Favorite and visible Steam-store links remain separate controls above the card link; Steam opens in a new tab.
- The profile presents a framed, expandable game cover beside its title and published description. A release ticket groups the date, follower count and language support. Five warm palettes respond to published tags/genres; decorative shapes and textures remain original. A mobile action dock keeps the Steam link and local favorite available while reading. The native image dialog supports keyboard closing and restores scroll state.
- Tags are controls, with translated labels and exact counts of other matching games. Selection updates recommendations and the shareable URL without moving keyboard focus. Recommendations rank shared tag counts before release-date distance and followers, show their common tags, and never substitute unrelated games when a selected tag has no matches. With no common tags, the date-based fallback is explicitly labeled.
- `explore.html` filters all published eligible upcoming games, beyond the 45-day shortlist. Tag search accepts English or translated labels; name, followers, sort and local favorite filters combine with the selected tag. Detail pages retain the referring list's filters on return and offer a retry when public JSON cannot load.
- Language badges preserve independent Traditional/Simplified support and existing English/other/unknown fallbacks. Display-name script conversion never changes a game's actual language support.
- The shared `radar-motion-v1.js` preference works across all pages and tabs. The device's reduced-motion preference always wins. Motion is limited to short card entrances, a single brief background entrance, hover feedback, month changes and favorite feedback; there is no autoplay or persistent decorative movement.
- Search supports localized titles, original titles and AppID. Home search applies to the selected month. Follower filters, sort order and calendar state are represented in the URL. `/` focuses search and Escape clears it.
- Favorites use localStorage under `game-trend-radar:saved:v1`, with cross-tab updates and session-only fallback if storage is restricted. Favorites are local to the browser, not Steam follows or wishlists. Missing records retain their favorite IDs but are not shown as current data.
- Lists render 36 records at a time. Loading, empty, search-empty, unavailable-data and unavailable-cover states are distinct. The data-loading retry works without reloading the whole page.
- Focus indicators, semantic labels, skip navigation, native controls and reduced-motion preferences are supported. Game data is inserted with `textContent`; only a constant authored SVG icon uses `innerHTML`.

## Data boundary

No backend jobs, thresholds or JSON files are changed. The existing `radar-storage-v2.js` reads the public index/month shards and per-AppID records, with the existing legacy JSON fallback. The data adapter retains current title, image, follower and recent-release rules. Discovery enriches only those accepted records, respects explicit empty metadata, and never infers tags from genres. Dates remain in Asia/Taipei. The detail page merges the AppID record over the corresponding catalog record so missing optional metadata can still be read from the catalog.

## Checks

Run `node --test tests/data.test.cjs tests/game-detail.test.cjs tests/discovery.test.cjs` for timezone, threshold, provenance, source preference, date range, localization, asset URLs, exact tag matching, metadata precedence and recommendation fallback checks. Open `tests/responsive.html` on a served checkout to inspect the actual pages inside 320/390/768/1280px viewports. Navigate from an upcoming card to inspect a detail page, or use the TAG link for discovery. The harness has `noindex,nofollow` and is not linked from the product.

The browse pages use the shared data/storage/motion modules, `radar-play-v2.js` and `radar-play-v2.css`. Detail and exploration share `radar-discovery-v1.js`; the profile adds `radar-game-detail-v1.js` / `.css`. Asset query versions are bumped together when the UI changes. Older UI/list/date files remain in the repository for history but are no longer referenced by current HTML.
