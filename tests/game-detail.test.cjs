const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const D = require("../src/domain/index.mjs").RadarData;
const from = (path) => readFileSync(join(__dirname, "..", path), "utf8");
const folder = (path) => readdirSync(join(__dirname, "..", path))
  .filter(name => /\.(?:js|ts)$/.test(name)).map(name => from(join(path, name))).join("\n");
// The shipped catalog card and detail page modules.
const card = from("src/features/catalog/GameCard.ts");
const browse = folder("src/features/catalog");
const profile = folder("src/features/detail");
const styles = from("src/features/catalog/cards.css");
const profileStyles = from("src/features/detail/styles.css");

test("card surface opens detail; separate visible Steam link opens externally; save remains independent", () => {
  assert.match(card, /detailAttributes = \{ href: D\.detailURL\(game\)/);
  assert.match(card, /h\('a', \{ class: 'card-detail-link', tabindex: -1, \.\.\.detailAttributes \}\)/);
  assert.match(card, /class: 'steam-store-link', href: storeGame\.link, target: '_blank', rel: 'noopener noreferrer'/);
  assert.match(card, /'Steam 商店'/);
  assert.match(styles, /\.game-card \.card-detail-link \{[\s\S]*?z-index: 1;/);
  assert.match(styles, /\.game-card \.steam-store-link \{[\s\S]*?z-index: 5;/);
  assert.match(styles, /\.game-card \.save-button \{[\s\S]*?z-index: 4;/);
});

test("quick view dialog and its triggers are removed on all old pages", () => {
  assert.doesNotMatch(browse, /quick-view|data-peek|setupDialog|gameDialog/);
  for (const name of ["index", "upcoming", "released", "saved", "date"]) {
    const page = from(name + ".html");
    assert.doesNotMatch(page, /gameDialog|closeDialog|dialogContent/);
    assert.match(page, /<script type="module"[^>]*src="\/game-trend-radar\/assets\/app\//);
    assert.match(page, /<link rel="stylesheet"[^>]*href="\/game-trend-radar\/assets\/app\/play-/);
  }
});

test("detail reads published game metadata; no invented genres or separate Followers call", () => {
  const html = from("game.html");
  for (const id of ["gameTitle", "gameEnglish", "gameArt", "gameDate",
                    "gameFollowers", "gameAppId", "gameSteam", "gameSave"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(profile, /D\.datasets\(official, preview, nintendo\)/);
  assert.match(from("src/data/storage.ts"), /raw\.githubusercontent\.com\/danielet087\/game-trend-radar\/main\/data\//);
  assert.match(profile, /data\.games, \.\.\.data\.recent/);
  assert.match(profile, /\$\("gameSteam"\)\.href = game\.link/);
  assert.match(from("src/shared/artwork.js"), /game\.artSources/);
  // Saving goes through the shared favorites store, which persists to localStorage.
  assert.match(profile, /from '\.\.\/\.\.\/shared\/state\/favorites\.ts'/);
  assert.match(from("src/shared/state/favorites.ts"), /localStorage\.setItem\(SAVED_STORAGE_KEY/);
  assert.match(profileStyles, /@media \(max-width: 640px\)/);
  assert.doesNotMatch(profile, /group\/|members\?|followers\.xml|api\/appdetails/);
});

test("detail URL uses only verified positive integer AppID", () => {
  for (const id of [2769570, 632950]) {
    const game = D.normalize({
      appid: id, name: "game", release_start: "2026-09-24",
      followers: 6000,
    });
    assert.equal(game.appid, id);
    assert.equal(game.link, "https://store.steampowered.com/app/" + id + "/");
    assert.equal(D.detailURL(game), "./game.html?appid=" + id);
  }
  assert.match(card, /href: D\.detailURL\(game\)/);
  assert.match(profile, /\/\^\[1-9\]\[0-9\]\{0,9\}\$\/\.test\(value \|\| ''\)/);
});
