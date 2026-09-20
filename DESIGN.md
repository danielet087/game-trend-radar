# Game Trend Radar UI

## Visual direction and provenance

An original, content-first game discovery interface. The calendar opens immediately, followed by upcoming picks and recent releases. A warm cream field, sparse radar marks, dotted texture and large cropped orbital shapes give the backdrop depth. The upper color field curves into the page, with honey, mint, peach, lavender and sky themes for the calendar, upcoming, released, saved and date pages. Lavender and mint patterned sections, cobalt controls and clean reading surfaces retain a playful identity without a promotional hero, carousel, scrolling ribbon or summary counters. A shared type scale, restrained shadows and consistent card actions connect all six pages.

- `assets/radar-mark.svg`, `assets/radar-pattern.svg`, radar decoration, heart icon, CSS and UI text are authored for this project. The abstract pattern uses original circles, arcs, dots and strokes; it is a decorative CSS background with no hit targets or accessibility-tree content. No Nintendo/Pokémon logos, characters, illustrations, videos, sounds, screenshots, fonts or source code are included.
- **Noto Sans TC** is loaded from Google Fonts with `display=swap`; installed system fonts are the fallback. Its upstream license is [SIL Open Font License 1.1](https://github.com/google/fonts/blob/main/ofl/notosanstc/OFL.txt). The repository does not bundle font binaries.
- Game covers continue to use the Steam asset URLs provided by the existing dataset. Their rights remain with their respective owners. Those assets are distinct from the original site interface; this redesign does not grant additional rights to third-party game artwork.
- The reference websites informed general principles (clear hierarchy, cheerful color, generous imagery and responsive feedback), not reusable artwork or distinctive compositions. These implementation choices are not a legal clearance opinion.

## Interaction

- The home calendar opens first. Previous/next buttons, the current-month button and a native month picker keep the calendar and URL synchronized. Phones default to a card list with an explicit calendar/list switch.
- The entire card opens the site's `game.html?appid=...` profile. Favorite and visible Steam-store links remain separate controls above the card link; Steam opens in a new tab.
- The profile groups the existing artwork, release date, follower count, language support and favorites. Published descriptions, genres and tags appear when present, with text-only rendering and a small genre translation map. It retains the referring list's filters on return and offers a retry when public JSON cannot load. Prototype roadmap copy is removed from the product.
- Language badges preserve independent Traditional/Simplified support and existing English/other/unknown fallbacks. Display-name script conversion never changes a game's actual language support.
- The shared `radar-motion-v1.js` preference works across all pages and tabs. The device's reduced-motion preference always wins. Motion is limited to short card entrances, a single brief background entrance, hover feedback, month changes and favorite feedback; there is no autoplay or persistent decorative movement.
- Search supports localized titles, original titles and AppID. Home search applies to the selected month. Follower filters, sort order and calendar state are represented in the URL. `/` focuses search and Escape clears it.
- Favorites use localStorage under `game-trend-radar:saved:v1`, with cross-tab updates and session-only fallback if storage is restricted. Favorites are local to the browser, not Steam follows or wishlists. Missing records retain their favorite IDs but are not shown as current data.
- Lists render 36 records at a time. Loading, empty, search-empty, unavailable-data and unavailable-cover states are distinct. The data-loading retry works without reloading the whole page.
- Focus indicators, semantic labels, skip navigation, native controls and reduced-motion preferences are supported. Game data is inserted with `textContent`; only a constant authored SVG icon uses `innerHTML`.

## Data boundary

No backend jobs or JSON files are changed. The UI reads the same `steam_upcoming.json` and `steam_preview.json` files, prioritizes official games, enriches names/images from preview records and obtains recent releases from `preview.recent_games`. Dates remain in Asia/Taipei. Upcoming/calendar/date pages require at least 5,000 followers; recent releases require more than 3,000 and existing source verification. Missing or ambiguous dates are excluded.

## Checks

Run `node --test tests/data.test.cjs tests/game-detail.test.cjs` for timezone, threshold, provenance, source preference, date range, localization and asset URL regression checks. Open `tests/responsive.html` on a served checkout to inspect the actual pages inside 320/390/768/1280px viewports. The harness has `noindex,nofollow` and is not linked from the product.

The browse pages use `assets/radar-data-v1.js`, `assets/radar-motion-v1.js`, `assets/radar-play-v2.js` and `assets/radar-play-v2.css`. The game profile shares the data/motion/base styles and adds `radar-game-detail-v1.js` / `.css`. Asset query versions are bumped together when the UI changes. Older UI/list/date files remain in the repository for history but are no longer referenced by current HTML.
