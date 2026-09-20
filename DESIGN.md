# Game Trend Radar UI

## Visual direction and provenance

An original game discovery interface: a full-width cobalt stage, lime ribbon, lavender spotlight area, coral accents and warm paper. A tilted stack of real game covers, solid ink shadows, bold typography and an original radar identity create a playful visual rhythm. The layout prioritizes upcoming releases, the calendar and recent releases. It does not reproduce the reference websites' page compositions.

- `assets/radar-mark.svg`, radar decoration, heart icon, CSS and UI text are authored for this project. No Nintendo/Pokémon logos, characters, illustrations, videos, sounds, screenshots, fonts or source code are included.
- **Noto Sans TC** is loaded from Google Fonts with `display=swap`; installed system fonts are the fallback. Its upstream license is [SIL Open Font License 1.1](https://github.com/google/fonts/blob/main/ofl/notosanstc/OFL.txt). The repository does not bundle font binaries.
- Game covers continue to use the Steam asset URLs provided by the existing dataset. Their rights remain with their respective owners. Those assets are distinct from the original site interface; this redesign does not grant additional rights to third-party game artwork.
- The reference websites informed general principles (clear hierarchy, cheerful color, generous imagery and responsive feedback), not reusable artwork or distinctive compositions. These implementation choices are not a legal clearance opinion.

## Interaction

- The home focus carousel uses four actual upcoming records, preferring readable header artwork already supplied by the dataset. Previous/next, individual game controls, arrow keys and touch swipe work without autoplay. Autoplay pauses on hover, keyboard focus, a hidden tab or an open preview.
- Every game card offers a native quick-preview dialog with release date, followers, Steam link and local favorite action. Escape closes it; native modal focus handling keeps keyboard navigation within the dialog.
- The header's motion switch pauses decorative movement and autoplay and saves the preference locally. Reduced-motion preferences disable motion by default. Scroll reveals finish before hover tilt takes over; saved games receive a brief heart animation. No animation is necessary to access content or controls.
- The home calendar defaults to an agenda-style card list at widths up to 520px, with an explicit calendar/list switch. Date links still open `date.html?date=YYYY-MM-DD`; game links open Steam in a new tab.
- Search supports localized titles, original titles and AppID. Home search applies to the selected month. Follower filters, sort order and calendar state are represented in the URL. `/` focuses search and Escape clears it.
- Favorites use localStorage under `game-trend-radar:saved:v1`, with cross-tab updates and session-only fallback if storage is restricted. Favorites are local to the browser, not Steam follows or wishlists. Missing records retain their favorite IDs but are not shown as current data.
- Lists render 36 records at a time. Loading, empty, search-empty, unavailable-data and unavailable-cover states are distinct. The data-loading retry works without reloading the whole page.
- Focus indicators, semantic labels, skip navigation, native controls and reduced-motion preferences are supported. Game data is inserted with `textContent`; only a constant authored SVG icon uses `innerHTML`.

## Data boundary

No backend jobs or JSON files are changed. The UI reads the same `steam_upcoming.json` and `steam_preview.json` files, prioritizes official games, enriches names/images from preview records and obtains recent releases from `preview.recent_games`. Dates remain in Asia/Taipei. Upcoming/calendar/date pages require at least 5,000 followers; recent releases require more than 3,000 and existing source verification. Missing or ambiguous dates are excluded.

## Checks

Run `node --test tests/data.test.cjs` for timezone, threshold, provenance, source preference, date range, localization and asset URL regression checks. Open `tests/responsive.html` on a served checkout to inspect the actual pages inside 320/390/768/1280px viewports. The harness has `noindex,nofollow` and is not linked from the product.

New pages use only `assets/radar-data-v1.js`, `assets/radar-play-v2.js` and `assets/radar-play-v2.css`. Versioned asset names avoid retaining the previous visual edition in the browser cache. Older UI/list/date files remain in the repository for history but are no longer referenced by the current HTML.
