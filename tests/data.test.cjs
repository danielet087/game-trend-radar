const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../assets/radar-data-v1.js");
const game = (overrides) => ({
  appid: 10,
  name: "Test game",
  release_start: "2026-09-20",
  release_precision: "day",
  followers: 5000,
  ...overrides,
});

test("Taipei midnight rolls over without shifting date-only releases", () => {
  assert.equal(D.todayInTaipei(new Date("2026-09-19T15:59:59Z")), "2026-09-19");
  assert.equal(D.todayInTaipei(new Date("2026-09-19T16:00:00Z")), "2026-09-20");
  assert.equal(D.normalize(game()).date, "2026-09-20");
});
test("calendar dates must be real, exact days", () => {
  for (const value of [
    "2026-02-29",
    "2026-09-31",
    "2026-13-01",
    "2026-9-1",
    "invalid",
  ])
    assert.equal(D.validDate(value), false);
  assert.equal(D.validDate("2028-02-29"), true);
  assert.equal(D.normalize(game({ release_precision: "month" })), null);
});
test("upcoming keeps the inclusive 5,000 follower threshold and rejects missing data", () => {
  assert.ok(D.normalize(game({ followers: 5000 })));
  for (const followers of [4999, null, undefined, Infinity, "bad"])
    assert.equal(D.normalize(game({ followers })), null);
  for (const appid of [0, -1, 1.5, "bad"])
    assert.equal(D.normalize(game({ appid })), null);
});
test("recent releases require provenance and strictly more than 3,000 followers", () => {
  assert.equal(
    D.normalize(
      game({ followers: 3000, recent_source: "tracked_release" }),
      true,
    ),
    null,
  );
  assert.ok(D.normalize(game({ followers: 50000 }), true));
  assert.ok(
    D.normalize(
      game({ followers: 3001, recent_source: "tracked_release" }),
      true,
    ),
  );
  assert.equal(
    D.normalize(game({ recent_source: "direct_release" }), true).darkHorse,
    false,
  );
  assert.equal(
    D.normalize(
      game({
        recent_source: "direct_release",
        first_week_qualified_at: "2026-09-21T00:00:00Z",
      }),
      true,
    ).darkHorse,
    true,
  );
});
test("source preference, localization and de-duplication preserve verified official records", () => {
  const official = { games: [game(), game()], generated_at: "official" };
  const preview = {
    games: [game({ name_zh_tw: "測試遊戲", followers: 90000 })],
    recent_games: [],
  };
  const data = D.datasets(official, preview);
  assert.equal(data.games.length, 1);
  assert.equal(data.games[0].name, "測試遊戲");
  assert.equal(data.games[0].followers, 5000);
  assert.equal(data.updated, "official");
  assert.equal(D.datasets({ games: [] }, preview).games.length, 0);
  assert.equal(D.datasets(null, preview).source, "preview");
  assert.equal(D.datasets(null, null), null);
});
test("image paths are resolved for Steam assets; executable and untrusted origins are rejected", () => {
  assert.equal(
    D.imageURL("hash/capsule_231x87.jpg", 10),
    "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/10/hash/capsule_231x87.jpg",
  );
  assert.equal(
    D.imageURL("https://shared.fastly.steamstatic.com/a.jpg", 10),
    "https://shared.fastly.steamstatic.com/a.jpg",
  );
  for (const url of [
    "javascript:alert(1)",
    "http://shared.akamai.steamstatic.com/a.jpg",
    "https://steamstatic.com.evil.test/a.jpg",
    "//evil.test/a.jpg",
  ])
    assert.equal(D.imageURL(url, 10), "");
  const result = D.normalize(
    game({ capsule_image: "hash/capsule.jpg" }),
    false,
    { header_image: "https://shared.fastly.steamstatic.com/header.jpg" },
  );
  assert.equal(result.art, "https://shared.fastly.steamstatic.com/header.jpg");
  assert.equal(result.hasVerifiedHeader, true);
  assert.equal(result.artSources.at(-1),
    "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/10/hash/capsule.jpg");
});
test("a source-provided Traditional Chinese header wins over an English main capsule", () => {
  const en = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4814120/hash/capsule_616x353.jpg";
  const tw = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4814120/twhash/header_tchinese.jpg";
  const record = game({
    appid: 4814120,
    language_support: { tchinese: true, english: true },
    main_capsule_image: en,
    header_image: tw,
  });
  const traditional = D.normalize(record);
  assert.equal(traditional.art, tw);
  assert.equal(traditional.artSources[1], en);
  const english = D.normalize({
    ...record,
    language_support: { tchinese: false, english: true },
  });
  assert.equal(english.art, en);
});

test("prefer known Steam header, then discover larger legacy images, finally use real hashed capsule", () => {
  const record = D.normalize(game({
    appid: 2769570,
    capsule_image: "24f6ec304555c95bf5c1ee328ffa9caaea50a4f6/capsule_231x87.jpg",
  }));
  assert.equal(record.hasVerifiedHeader, false);
  assert.equal(record.art, "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2769570/header.jpg");
  assert.deepEqual(record.artSources.slice(0, 3), [
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2769570/header.jpg",
    "https://cdn.akamai.steamstatic.com/steam/apps/2769570/header.jpg",
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2769570/capsule_616x353.jpg",
  ]);
  assert.equal(record.artSources.at(-1),
    "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2769570/24f6ec304555c95bf5c1ee328ffa9caaea50a4f6/capsule_231x87.jpg");
});
test("45-day upcoming and 30-day recent ranges use Taipei date boundaries", () => {
  const today = "2026-09-20";
  const rows = [-31, -30, -1, 0, 45, 46].map((days, index) => ({
    appid: index + 1,
    date: D.offsetDate(today, days),
  }));
  const data = { games: rows, recent: rows };
  assert.deepEqual(
    D.selectGames(data, "upcoming", today).map((g) => g.appid),
    [4, 5],
  );
  assert.deepEqual(
    D.selectGames(data, "released", today).map((g) => g.appid),
    [2, 3, 4],
  );
  assert.deepEqual(
    D.selectGames(data, "date", today, today).map((g) => g.appid),
    [4],
  );
});
test("malformed rows do not erase the valid published dataset", () => {
  const data = D.datasets(
    { games: [null, {}, game(), game({ appid: 20, followers: 4999 })] },
    { games: [null], recent_games: [] },
  );
  assert.equal(data.games.length, 1);
});

test("the complete catalog retains older releases, distant future games and accepted dark horses without duplicates", () => {
  const data = D.datasets({ games: [
    game({ appid: 1, release_start: "2026-01-01" }),
    game({ appid: 2, release_start: "2027-04-01" }),
    game({ appid: 3, release_start: "2026-08-01", followers: 3500, recent_source: "direct_release", first_week_qualified_at: "2026-08-03T00:00:00Z" }),
    game({ appid: 4, followers: 100 }),
  ] }, null);
  assert.deepEqual(D.selectGames(data, "all", "2026-09-28").map(row => row.appid), [1, 2, 3]);
  assert.equal(D.selectGames(data, "upcoming", "2026-09-28").length, 0);
  assert.equal(D.selectGames(data, "released", "2026-09-28").length, 0);
});

test("Store title priority is Traditional > converted Simplified > English, independently of supported languages", () => {
  const base = {
    name: "Fable",
    name_en: "Fable",
    name_zh_tw: "繁體名稱",
    name_zh_cn: "神鬼寓言",
    name_zh_cn_traditional: "神鬼寓言",
  };
  const both = D.normalize(game({
    ...base,
    language_support: { tchinese: true, schinese: true, english: true },
  }));
  assert.equal(both.name, "繁體名稱");
  assert.equal(both.languageBadge, "支援繁中・支援簡中");
  assert.deepEqual(both.languageBadges, [
    { label: "支援繁中", status: "traditional" },
    { label: "支援簡中", status: "simplified" },
  ]);
  assert.equal(both.languageStatus, "traditional");
  assert.equal(both.nameEn, "Fable");
  const onlySimplified = D.normalize(game({
    ...base,
    name_zh_tw: null,
    language_support: { tchinese: false, schinese: true, english: true },
  }));
  assert.equal(onlySimplified.name, "神鬼寓言");
  assert.equal(onlySimplified.languageBadge, "支援簡中");
  assert.equal(onlySimplified.languageStatus, "simplified");
  const english = D.normalize(game({
    ...base,
    language_support: { tchinese: false, schinese: false, english: true },
  }));
  assert.equal(english.name, "繁體名稱");
  assert.equal(english.languageBadge, "支援英文");
  assert.deepEqual(english.languageBadges, [
    { label: "支援英文", status: "english" },
  ]);
  const undecided = D.normalize(game({
    name: "Unknown", name_zh_tw: null, name_zh_cn: null,
    language_support: { tchinese: null, schinese: null, english: null },
  }));
  assert.equal(undecided.languageBadge, "語言支援待確認");
  assert.equal(undecided.name, "Unknown");
  const other = D.normalize(game({
    ...base,
    language_support: {
      tchinese: false, schinese: false, english: false,
      other_languages: ["日文", "法文"],
    },
  }));
  assert.equal(other.languageBadge, "支援日文");
  const noKnownLanguage = D.normalize(game({
    ...base,
    language_support: { tchinese: false, schinese: false, english: false },
  }));
  assert.equal(noKnownLanguage.languageBadge, "語言支援待確認");
  assert.equal(noKnownLanguage.name, "繁體名稱");
});
test("Chinese Store page title alone does not imply game supports Chinese language", () => {
  const record = D.normalize(game({
    name: "English Game",
    name_zh_tw: "繁中商店標題",
    name_zh_cn: "簡中商店標題",
    language_support: { tchinese: false, schinese: false, english: true },
  }));
  assert.equal(record.name, "繁中商店標題");
  assert.equal(record.languages.tchinese, false);
  assert.equal(record.languages.schinese, false);
});

test("only a Simplified Store title uses its Traditional-converted display name", () => {
  const result = D.normalize(game({
    name: "English Game",
    name_en: "English Game",
    name_zh_tw: null,
    name_zh_cn: "针影裁梦",
    name_zh_cn_traditional: "針影裁夢",
    language_support: { tchinese: false, schinese: false, english: true },
  }));
  assert.equal(result.name, "針影裁夢");
  assert.equal(result.nameOriginalCn, "针影裁梦");
  assert.equal(result.languageBadge, "支援英文");
});

test("Traditional display names do not alter actual Steam game support or original search spellings", () => {
  const dressmaker = D.normalize(game({
    appid: 4019220,
    name: "Dressmaker",
    name_en: "Dressmaker",
    name_zh_cn: "针影裁梦",
    name_zh_cn_traditional: "針影裁夢",
    language_support: { tchinese: false, schinese: true, english: true },
  }));
  assert.equal(dressmaker.name, "針影裁夢");
  assert.equal(dressmaker.nameOriginalCn, "针影裁梦");
  assert.equal(dressmaker.nameEn, "Dressmaker");
  assert.equal(dressmaker.languageBadge, "支援簡中");
  assert.equal(dressmaker.languages.tchinese, false);
  const rivage = D.normalize(game({
    appid: 4094660,
    name: "Rivage",
    name_zh_cn: "她在时间之外",
    name_zh_cn_traditional: "她在時間之外",
    language_support: { tchinese: false, schinese: true, english: true },
  }));
  assert.equal(rivage.name, "她在時間之外");
  assert.equal(rivage.languageBadge, "支援簡中");
  const both = D.normalize(game({
    name: "Phantom Blade Zero",
    name_zh_tw: "影之刃零",
    name_zh_tw_traditional: "影之刃零",
    name_zh_cn: "影之刃零",
    language_support: { tchinese: true, schinese: true, english: true },
  }));
  assert.equal(both.name, "影之刃零");
  assert.equal(both.languageBadge, "支援繁中・支援簡中");
});

const twitchImported = (overrides = {}) => game({
  followers: 812,
  follower_checked_at: "2026-10-02T09:00:00Z",
  release_start: "2026-09-20", release_end: "2026-09-20",
  release_time_utc: "2026-09-19T16:30:00Z",
  release_timestamp_taipei_date: "2026-09-20",
  release_display_precision: "date_full",
  release_date_timezone: "Asia/Taipei", release_date_conflict: false,
  steam_type: "game", sexual_content_screened: true,
  twitch_admission: {
    schema_version: 1, method: "twitch_igdb_external_steam_v1", appid: 10,
    twitch_game_id: "100", igdb_id: "200", checked_at: "2026-10-02T09:00:00Z",
    source_frontend_commit: "a".repeat(40),
    source_enrollment: { source: "igdb_first_release_date", viewer_count: 7200,
      min_viewers: 7000, observed_at: "2026-09-20T01:00:00Z" },
  },
  ...overrides,
});

test("authoritatively imported Twitch games bypass only the Followers threshold", () => {
  for (const followers of [0, 1, 812, 3000, 4999]) {
    const raw = twitchImported({ followers });
    assert.equal(D.isTwitchQualified(raw), true);
    for (const recent of [false, true]) {
      const normalized = D.normalize(raw, recent);
      assert.equal(normalized.followers, followers);
      assert.equal(normalized.twitchAdmission.twitch_game_id, "100");
      assert.equal(normalized.darkHorse, false);
    }
  }
  const now = "2026-10-02";
  const released = twitchImported({ release_start: "2026-09-20" });
  const upcoming = twitchImported({ appid: 20, release_start: "2026-10-10", release_end: "2026-10-10",
    release_time_utc: "2026-10-09T17:00:00Z", release_timestamp_taipei_date: "2026-10-10",
    twitch_admission: { ...released.twitch_admission, appid: 20 } });
  const data = D.datasets({ version: 2, games: [released, upcoming] }, null);
  assert.deepEqual(D.selectGames(data, "all", now).map(row => row.appid), [10, 20]);
  assert.deepEqual(D.selectGames(data, "released", now).map(row => row.appid), [10]);
  assert.deepEqual(D.selectGames(data, "upcoming", now).map(row => row.appid), [20]);
  assert.deepEqual(D.selectGames(data, "date", now, "2026-10-10").map(row => row.appid), [20]);
  assert.equal(data.games.find(row => row.appid === 10).followers, 812);
});

test("Twitch source labels, forged identities and unverified enrollment cannot bypass Followers", () => {
  const valid = twitchImported();
  const corruptProofs = [null, {}, { ...valid.twitch_admission, schema_version: true },
    { ...valid.twitch_admission, method: "manual_match" },
    { ...valid.twitch_admission, appid: 20 },
    { ...valid.twitch_admission, twitch_game_id: "name" },
    { ...valid.twitch_admission, twitch_game_id: true },
    { ...valid.twitch_admission, igdb_id: "0" },
    { ...valid.twitch_admission, checked_at: "2026-10-02T09:00:00" },
    { ...valid.twitch_admission, checked_at: "2026-10-02T24:00:00Z" },
    { ...valid.twitch_admission, source_frontend_commit: "main" },
    { ...valid.twitch_admission, source_frontend_commit: "a".repeat(39) },
    ...[{ source: "steam_recent_release" }, { source: "historical_manual_restore" },
      { viewer_count: 6999 }, { viewer_count: "7200" }, { min_viewers: 6999 },
      { qualification: "unverified" }, { observed_at: "2026-10-02T10:00:00Z" },
      { observed_at: "2026-09-20T01:00:00" }].map(fields => ({ ...valid.twitch_admission,
        source_enrollment: { ...valid.twitch_admission.source_enrollment, ...fields } })),
  ];
  for (const twitch_admission of corruptProofs) {
    const raw = { ...valid, twitch_admission, recent_source: "twitch_new" };
    assert.equal(D.hasTwitchAdmission(raw), false, JSON.stringify(twitch_admission));
    assert.equal(D.normalize(raw), null);
    assert.equal(D.normalize(raw, true), null);
  }
  assert.equal(D.normalize(game({ followers: 4999, source: "twitch", official_ge5000: true })), null);
  assert.equal(D.normalize(game({ followers: 3000, recent_source: "twitch_new" }), true), null);
  // Existing Steam admissions keep their original thresholds even if a bad
  // optional import proof is attached to an otherwise qualified Steam row.
  assert.ok(D.normalize(game({ twitch_admission: {}, followers: 5000 })));
  assert.ok(D.normalize(game({ followers: 3001, recent_source: "direct_release" }), true));
});

test("Twitch admission still requires verified Steam game, content, exact Taipei date and real Followers", () => {
  const invalid = [{ steam_type: "dlc" }, { steam_type: undefined },
    { sexual_content_screened: false }, { sexual_content_screened: "true" },
    { release_precision: "month" }, { release_display_precision: "date_month" },
    { release_date_timezone: "UTC" }, { release_end: "2026-09-21" },
    { release_date_conflict: true }, { release_timestamp_taipei_date: "2026-09-19" },
    { release_timestamp_taipei_date: null }, { release_start: undefined, release_date: "2026-09-20" },
    { release_time_utc: "2026-09-19T15:59:59Z" }, { release_time_utc: "2026-09-20T16:00:00Z" },
    { release_time_utc: "2026-09-19T16:30:00" }, { release_time_utc: null },
    { followers: null }, { followers: "812" }, { followers: -1 }, { followers: 812.5 },
    { follower_checked_at: null }, { follower_checked_at: "2026-10-02T09:00:00" }];
  for (const fields of invalid) {
    const raw = twitchImported(fields);
    assert.equal(D.isTwitchQualified(raw), false, JSON.stringify(fields));
    assert.equal(D.normalize(raw), null, JSON.stringify(fields));
  }
  for (const fields of [{ release_end: "2026-09-21" }, { release_date_conflict: true },
    { release_timestamp_taipei_date: "2026-09-19" },
    { release_time_utc: "2026-09-19T15:59:59Z" }])
    assert.equal(D.normalize(game(fields)), null);
  assert.ok(D.normalize(game())); // Date-only legacy rows remain supported.
});

test("published Twitch admission survives duplicate stale preview entries and repeated normalization", () => {
  const official = { version: 2, games: [twitchImported()], generated_at: "2026-10-02T09:00:00Z" };
  const preview = { games: [], recent_games: [game({ followers: 9000,
    release_start: "2026-09-19", name: "Stale preview" })] };
  for (let run = 0; run < 2; run++) {
    const data = D.datasets(official, preview);
    const all = D.selectGames(data, "all", "2026-10-02");
    assert.equal(all.length, 1);
    assert.equal(all[0].date, "2026-09-20");
    assert.equal(all[0].followers, 812);
    assert.equal(all[0].twitchAdmission.method, "twitch_igdb_external_steam_v1");
  }
});

test("every catalog page defaults to all Followers so accepted Twitch discoveries are visible", () => {
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const data = D.datasets({ version: 2, games: [twitchImported(),
    game({ appid: 20, followers: 812, recent_source: "twitch_new" })] }, null);
  const catalog = D.selectGames(data, "all", "2026-10-02");
  for (const page of ["index", "date", "explore", "upcoming", "released", "games", "saved"]) {
    const html = readFileSync(join(__dirname, "..", page + ".html"), "utf8");
    const select = html.match(/<select id="followersFilter">([\s\S]*?)<\/select>/)?.[1];
    assert.ok(select, page);
    const first = select.match(/<option value="(\d+)">([^<]+)<\/option>/);
    assert.equal(first?.[2], "全部關注度", page);
    assert.equal(Number(first?.[1]), 0, page);
    assert.doesNotMatch(select, /selected(?:\s|=|>)/, page);
    assert.deepEqual(catalog.filter(game => game.followers >= Number(first[1])).map(game => game.appid), [10], page);
    assert.match(select, /<option value="5000">5 千人以上<\/option>/, page);
    assert.deepEqual(catalog.filter(game => game.followers >= 5000), [], page);
  }
});
