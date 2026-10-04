const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../assets/radar-discovery-v1.js");
const D = require("../assets/radar-data-v1.js");

test("multi-tag URLs preserve legacy links and combine exact ALL/ANY matching with exclusions", () => {
  const game = { tags: ['Action', 'Co-op', 'Indie'] };
  assert.equal(R.matchesTags(game, R.tagFilters(new URLSearchParams('tag=Action'))), true);
  const both = R.tagFilters(new URLSearchParams('tag=Action&tag=Open+World'));
  assert.equal(R.matchesTags(game, both), false);
  assert.equal(R.matchesTags(game, { ...both, match: 'any' }), true);
  assert.equal(R.matchesTags(game, R.tagFilters(new URLSearchParams('tag=Action&match=any&exclude=Co-op'))), false);
  assert.equal(R.matchesTags(game, R.tagFilters(new URLSearchParams('exclude=Horror'))), true);
  assert.deepEqual(R.tagFilters(new URLSearchParams('tag=Action&tag=ACTION&exclude=action&tag=Co-op')), { include:['Co-op'], exclude:['action'], match:'all' });
  assert.equal(R.matchesTags({tags:['Action RPG']}, R.tagFilters(new URLSearchParams('tag=Action'))), false);
});

test("official Taiwan labels override fallback translations without changing tag identity or genre labels", () => {
  const data = { games: [{ appid: 1 }], recent: [] };
  const source = { games: [{ appid: 1, tags: ["Artificial Intelligence", "Capitalism", "Indie"], genres: ["Indie"],
    tag_labels_zh_tw: { "Artificial Intelligence": "人工智慧", Capitalism: "資本主義", Indie: "獨立" },
    genre_labels_zh_tw: { Indie: "獨立製作" } }] };
  const game = R.enrich(data, source, null).games[0];
  assert.deepEqual(game.tags, source.games[0].tags);
  assert.equal(R.label("Artificial Intelligence"), "人工智慧");
  assert.equal(R.label("Capitalism"), "資本主義");
  assert.equal(R.label("Indie"), "獨立");
  assert.equal(R.genreLabel("Indie"), "獨立製作");
  assert.equal(R.hasTag(game, "artificial intelligence"), true);
  assert.equal(R.catalog([game])[0].tag, "Artificial Intelligence");
  assert.equal(R.url("Artificial Intelligence"), "./explore.html?tag=Artificial+Intelligence");
});

test("descriptions require their own Traditional Chinese locale and cannot borrow stale locale markers", () => {
  const data = { games: [{ appid: 1 }], recent: [] };
  const preview = { games: [{ appid: 1, short_description: "舊的繁中介紹", short_description_language: "zh-TW" }] };
  const english = { games: [{ appid: 1, short_description: "New English source" }] };
  assert.equal(R.enrich(data, english, preview).games[0].description, "");
  const translated = { games: [{ appid: 1, short_description: "本站繁中翻譯", short_description_language: "zh-TW", short_description_source: "editorial_zh_tw" }] };
  const game = R.enrich(data, translated, preview).games[0];
  assert.equal(game.description, "本站繁中翻譯");
  assert.equal(game.descriptionSource, "editorial_zh_tw");
  assert.equal(R.enrich(data, { games: [{ appid: 1, short_description: "", short_description_language: "" }] }, preview).games[0].description, "");
});

test("metadata enrichment keeps verified records and respects official empty values", () => {
  const official = {
    games: [
      {
        appid: 1,
        name: "Verified",
        release_start: "2026-12-20",
        followers: 6000,
        tags: [],
        genres: ["RPG"],
        short_description: "官方繁體中文介紹",
        short_description_language: "zh-TW",
      },
      {
        appid: 2,
        name: "Incomplete",
        release_start: "2026-12-21",
        followers: 7000,
      },
      {
        appid: 3,
        name: "Below threshold",
        release_start: "2026-12-22",
        followers: 20,
        tags: ["Action"],
      },
    ],
  };
  const preview = {
    games: [
      { appid: 1, tags: ["Stale Tag"], short_description: "Old" },
      { appid: 2, tags: ["Co-op"], short_description: "已發布繁中備援介紹", short_description_language: "zh-TW" },
      {
        appid: 4,
        tags: ["Adventure"],
        followers: 9000,
        release_start: "2026-12-22",
      },
    ],
  };
  const normalized = D.datasets(official, preview);
  const result = R.enrich(normalized, official, preview);
  assert.deepEqual(
    result.games.map((row) => row.appid),
    [1, 2],
  );
  assert.deepEqual(result.games[0].tags, []);
  assert.equal(result.games[0].description, "官方繁體中文介紹");
  assert.deepEqual(result.games[1].tags, ["Co-op"]);
  assert.equal(result.games[1].description, "已發布繁中備援介紹");
  assert.equal(normalized.games[0].tags, undefined);
  assert.equal(result.games[0].followers, normalized.games[0].followers);
  assert.equal(result.games[0].date, normalized.games[0].date);
});

test("tags preserve source labels, normalize duplicates and never derive tags from genres", () => {
  assert.deepEqual(
    R.labels([
      " Co-op ",
      "CO-OP",
      { name: "Open World" },
      { description: "RPG" },
      null,
      9,
      {},
      "",
    ]),
    ["Co-op", "Open World", "RPG"],
  );
  assert.equal(R.label("OPEN WORLD"), "開放世界");
  assert.equal(R.label("Unlisted tag"), "Unlisted tag");
  assert.deepEqual(R.labels({ Action: 3 }), []);
  const data = { games: [{ appid: 1 }], recent: [] };
  assert.deepEqual(
    R.enrich(data, { games: [{ appid: 1, genres: ["Action"] }] }, null).games[0]
      .tags,
    [],
  );
});

test("recent releases retain metadata from the published month catalog", () => {
  const official = {
    games: [
      {
        appid: 10,
        name: "Released",
        followers: 6000,
        release_start: "2026-09-20",
        tags: ["Building"],
        genres: [],
        short_description: "目前的繁中介紹",
        short_description_language: "zh-TW",
      },
    ],
  };
  const preview = {
    games: [],
    recent_games: [{ appid: 10, tags: ["Stale"], short_description: "Old" }],
  };
  const data = R.enrich(D.datasets(official, preview), official, preview);
  assert.deepEqual(data.recent[0].tags, ["Building"]);
  assert.equal(data.recent[0].description, "目前的繁中介紹");
});

test("catalog counts each game once per exact tag and supports original plus translated search labels", () => {
  const entries = R.catalog([
    { tags: ["Action", "action", "Action RPG"] },
    { tags: ["ACTION", "Open World"] },
  ]);
  assert.equal(entries.find((row) => R.key(row.tag) === "action").count, 2);
  assert.equal(entries.find((row) => row.tag === "Action RPG").count, 1);
  assert.equal(
    entries.find((row) => row.tag === "Open World").label,
    "開放世界",
  );
  assert.equal(R.hasTag({ tags: ["Action RPG"] }, "Action"), false);
  assert.equal(R.hasTag({ tags: ["Open World"] }, " open world "), true);
});

test("recommendations prioritize shared tags, exclude the current game and deduplicate", () => {
  const game = { appid: 1, date: "2026-12-20", tags: ["RPG", "Open World"] };
  const pool = [
    game,
    { appid: 2, date: "2026-12-21", tags: ["Action"], followers: 90000 },
    {
      appid: 3,
      date: "2027-01-20",
      tags: ["RPG", "Open World"],
      followers: 6000,
    },
    { appid: 4, date: "2026-12-21", tags: ["RPG"], followers: 7000 },
    { appid: 4, date: "2026-12-21", tags: ["RPG"], followers: 7000 },
  ];
  const result = R.recommendations(game, pool);
  assert.equal(result.basis, "shared");
  assert.equal(result.count, 2);
  assert.deepEqual(
    result.games.map((row) => row.appid),
    [3, 4],
  );
  assert.deepEqual(result.games[0].sharedTags, ["RPG", "Open World"]);
});

test("selected tags do not silently fall back to unrelated games, even for zero matches", () => {
  const game = { appid: 1, date: "2026-12-20", tags: ["RPG", "Open World"] };
  const pool = [
    { appid: 2, date: "2026-12-21", tags: ["RPG"], followers: 9000 },
    { appid: 3, date: "2026-12-22", tags: ["Open World"], followers: 9000 },
    { appid: 4, date: "2026-12-23", tags: ["Open World"], followers: 9000 },
  ];
  const selected = R.recommendations(game, pool, "open world", 1);
  assert.equal(selected.count, 2);
  assert.deepEqual(
    selected.games.map((row) => row.appid),
    [3],
  );
  assert.deepEqual(R.recommendations(game, pool, "Co-op").games, []);
});

test("missing tag metadata uses an explicit date basis; URL encoding preserves special tag characters", () => {
  const game = { appid: 1, date: "2026-12-20", tags: [] };
  const result = R.recommendations(game, [
    { appid: 2, date: "2027-01-20", tags: [], followers: 8000 },
    { appid: 3, date: "2026-12-21", tags: ["RPG"], followers: 6000 },
  ]);
  assert.equal(result.basis, "date");
  assert.deepEqual(
    result.games.map((row) => row.appid),
    [3, 2],
  );
  for (const tag of ["LGBTQ+", "Point & Click", "開放世界", "<tag>"]) {
    const url = new URL(R.url(tag), "https://example.com/game-trend-radar/");
    assert.equal(url.searchParams.get("tag"), tag);
    assert.equal(url.pathname, "/game-trend-radar/explore.html");
  }
});

test("catalog descriptions explain the verified Twitch admission without universal Followers claims", () => {
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  for (const asset of ["radar-play-v2.js", "radar-ui-v1.js"]) {
    const script = readFileSync(join(__dirname, "..", "assets", asset), "utf8");
    assert.match(script, /(?:一般新作需至少 5,000 人關注；已驗證的 Twitch 新作可另行收錄|Steam 新作需至少 5,000 人關注，已驗證 Twitch 新作可另行收錄)/);
    assert.doesNotMatch(script, /款具備明確日期、至少 5,000 人關注的遊戲|僅列出近 30 天內、已確認發售且關注人數嚴格超過 3,000/);
    assert.doesNotMatch(script, /(?:upcoming|released|date|explore): "[^"\n]*(?:至少 5,000|關注人數超過 3,000)/);
  }
  for (const page of ["index", "date", "explore", "upcoming", "released", "games", "saved"]) {
    const html = readFileSync(join(__dirname, "..", page + ".html"), "utf8");
    assert.match(html, /清單包含 Steam、已驗證 Twitch 新作與 NS／NS2／PS5 遊戲/);
    assert.match(html, /radar-play-v2\.js\?v=[\d.]+/);
  }
});
