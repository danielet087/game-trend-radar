const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const D = require("../assets/radar-data-v1.js");
const from = (path) => readFileSync(
  require("node:path").join(__dirname, "..", path), "utf8",
);
const browse = from("assets/radar-play-v2.js");
const profile = from("assets/radar-game-detail-v1.js");
const styles = from("assets/radar-play-v2.css");
const profileStyles = from("assets/radar-game-detail-v1.css");

test("card surface opens detail; separate visible Steam link opens externally; save remains independent", () => {
  assert.match(browse, /detailLink\(game, "card-detail-link"\)/);
  assert.match(browse, /steam = externalLink\(game, "steam-store-link"\)/);
  assert.match(browse, /steam\.textContent = "Steam 商店"/);
  assert.match(browse, /card\.append\(cover, body, detail, save, steam\)/);
  assert.match(browse, /a\.target = "_blank"/);
  assert.match(browse, /a\.rel = "noopener noreferrer"/);
  assert.match(styles, /\.game-card \.card-detail-link \{[\s\S]*?z-index: 1;/);
  assert.match(styles, /\.game-card \.steam-store-link \{[\s\S]*?z-index: 5;/);
  assert.match(styles, /\.game-card \.save-button \{[\s\S]*?z-index: 4;/);
});

test("quick view dialog and its triggers are removed on all old pages", () => {
  assert.doesNotMatch(browse, /quick-view|data-peek|setupDialog|gameDialog/);
  for (const name of ["index", "upcoming", "released", "saved", "date"]) {
    const page = from(name + ".html");
    assert.doesNotMatch(page, /gameDialog|closeDialog|dialogContent/);
    assert.match(page, /radar-play-v2\\.js\\?v=3\\.1\\.0/);
    assert.match(page, /radar-play-v2\.css\?v=3\.1\.0/);
  }
});

test("detail reads published game metadata; no invented genres or separate Followers call", () => {
  const html = from("game.html");
  for (const id of ["gameTitle", "gameEnglish", "gameArt", "gameDate",
                    "gameFollowers", "gameAppId", "gameSteam", "gameSave"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(profile, /D\.datasets\(official, preview\)/);
  assert.match(browse, /raw\.githubusercontent\.com\/danielet087\/game-trend-radar\/main\/data\//);
  assert.match(profile, /raw\.githubusercontent\.com\/danielet087\/game-trend-radar\/main\/data\//);
  assert.match(profile, /data\.games, \.\.\.data\.recent/);
  assert.match(profile, /\$\("gameSteam"\)\.href = game\.link/);
  assert.match(profile, /game\.artSources/);
  assert.match(profile, /localStorage\.setItem\(storageKey/);
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
  }
  assert.match(browse, /game\.html\?appid=\$\{game\.appid\}/);
  assert.match(profile, /const appid = \/\^\[1-9\]\[0-9\]\{0,9\}\$\//);
});
