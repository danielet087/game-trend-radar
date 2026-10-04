const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../assets/radar-data-v1.js');

const PSID = 'JP0005-PPSA23593_00-APPLICATION00000';
const psURL = `https://store.playstation.com/zh-hant-tw/product/${PSID}`;
const platform = code => ({ id: D.nativePlatformIDs[code], code });
const release = (fields = {}) => ({ platform: 'PS5', date: '2027-02-18', precision: 'day',
  source: 'IGDB', region: 'worldwide', source_date: '2027-02-18',
  timestamp_taipei_date: '2027-02-18', time_zone: 'Asia/Taipei', timezone_status: 'same_calendar_day',
  taiwan_release_confirmed: false, ...fields });
const raw = (fields = {}) => ({ id: 'igdb:348210', igdb_id: 348210, name_en: 'Persona 4 Revival',
  name_zh_tw: '女神異聞錄４ Revival', hypes: 50, sexual_content_screened: true,
  platform_data_complete: true, platforms: [platform('PS5')], known_platforms: [platform('PS5')],
  playstation_url: psURL, url: 'https://www.igdb.com/games/persona-4-revival',
  releases: [release()], ...fields });
const payload = (...games) => ({ schema_version: 1, source: { provider: 'IGDB' }, games });
const normalized = fields => D.nintendoGames(payload(raw(fields)));
const steam = (fields = {}) => ({ appid: 2963950, name_en: 'Persona 4 Revival', followers: 5000,
  release_start: '2027-02-18', language_support: { tchinese: true, schinese: true }, ...fields });
const admission = fields => raw({ websites: [{ url: 'https://store.steampowered.com/app/2963950/' }], ...fields });
const support = (fields = {}) => ({ status: 'confirmed', region: 'taiwan', complete: true,
  languages: { tchinese: false, schinese: false, english: true, chinese: false },
  supported_languages: [{ code: 'en', name: '英文' }], source: 'PlayStation 台灣', source_url: psURL,
  product_id: PSID, checked_at: '2026-10-04T13:00:00Z', evidence_type: 'official_product_languages', ...fields });
const edition = (fields = {}) => ({ type: 'deluxe', label: 'Deluxe 版', title: 'Persona 4 Revival Deluxe Edition',
  product_id: PSID, region: 'taiwan', source_url: psURL, checked_at: '2026-10-04T13:00:00Z', ...fields });

test('PS5 admission requires native ID 167, hypes 30, content screening and an audited exact day', () => {
  const [game] = normalized({ hypes: 30 });
  assert.equal(game.sourceProvider, 'IGDB');
  assert.equal(game.source, 'nintendo'); // Retain existing saved/activity transport identities.
  assert.equal(game.hasPlayStation, true);
  assert.equal(game.hypes, 30);
  assert.equal(game.followers, null);
  assert.deepEqual(game.platforms, ['PS5']);
  for (const fields of [{ hypes: 29 }, { hypes: '50' }, { sexual_content_screened: false },
    { platforms: [{ id: 48, code: 'PS5' }] }, { platforms: [{ id: 167, code: 'PS4' }] },
    { releases: [release({ platform: 'PS4' })] }, { releases: [release({ precision: 'month' })] },
    { releases: [release({ timezone_status: undefined })] },
    { releases: [release({ timestamp_taipei_date: '2027-02-19' })] }])
    assert.deepEqual(normalized(fields), [], JSON.stringify(fields));
});

test('PS4 compatibility and known platform lists cannot invent a native PS5 date', () => {
  const [game] = normalized({ platforms: [platform('NS2')], known_platforms: [platform('NS2'), platform('PS5'), { id: 48 }],
    releases: [release({ platform: 'NS2' })], compatible_platforms: [platform('PS5')] });
  assert.deepEqual(game.platforms, ['NS2']);
  assert.deepEqual(game.releasePlatforms, ['NS2']);
  assert.equal(game.hasPlayStation, false);
  assert.ok(game.releases.every(row => row.platform !== 'PS5'));
  assert.equal(D.cardPlatformBadge(game).label, '主機多平台');
  assert.match(D.cardPlatformBadge(game).title, /PS4.*PS5.*NS2/);
});

test('sole observed PS5 is neutral while rigorous Sony exclusivity uses a distinct non-Nintendo status', () => {
  assert.equal(D.cardPlatformBadge(normalized()[0]).label, '主機');
  const proof = { status: 'confirmed', platform: 'PS5', url: psURL };
  const [exclusive] = normalized({ exclusivity: proof });
  assert.equal(D.cardPlatformBadge(exclusive).label, 'PS5 獨佔');
  assert.equal(D.cardPlatformBadge(exclusive).status, 'playstation-exclusive');
  for (const fields of [{ platform_data_complete: false }, { known_platforms: [] },
    { known_platforms: [{ id: 6 }, platform('PS5')] },
    { exclusivity: { ...proof, url: 'https://www.nintendo.com/tw/games/example/' } },
    { exclusivity: { ...proof, url: 'https://store.playstation.com.evil.example/' } }])
    assert.doesNotMatch(D.cardPlatformBadge(normalized({ exclusivity: proof, ...fields })[0]).label, /獨佔/);
  assert.equal(D.cardPlatformBadge(normalized({ known_platforms: [{ id: 6 }, platform('PS5')] })[0]).label, 'PC＋主機');
});

test('exact Steam product identity merges PS5 same-day releases and preserves distinct date events', () => {
  for (const steamDate of ['2027-02-18', '2027-02-19']) {
    const result = D.datasets({ games: [steam({ release_start: steamDate })] }, null, payload(admission()));
    assert.equal(result.games.length, steamDate === '2027-02-18' ? 1 : 2);
    assert.equal(D.cardGames(result.games).length, 1);
    for (const game of result.games) {
      assert.equal(game.appid, 2963950);
      assert.equal(game.identityKey, 'steam:2963950');
      assert.deepEqual(game.platforms, ['Steam', 'PS5']);
      assert.equal(game.followers, 5000);
      assert.equal(game.hypes, 50);
      assert.equal(game.releases.length, 2);
      assert.equal(game.platformLinks.PS5.url, psURL);
      assert.equal(D.isSaved(game, new Set(['igdb:348210'])), true);
      assert.equal(D.isSaved(game, new Set([2963950])), true);
      assert.equal(D.detailURL(game), `./game.html?appid=2963950&date=${game.date}`);
    }
    assert.deepEqual(result.games[0].releasePlatforms, steamDate === '2027-02-18' ? ['Steam', 'PS5'] : ['PS5']);
  }
  const distinct = D.datasets({ games: [steam()] }, null, payload(raw({ steam_appid: 2963950, websites: [] })));
  assert.equal(distinct.games.length, 2);
});

test('unadmitted Steam products do not lend Steam dates, follower counts or languages to PS5 events', () => {
  const [game] = D.datasets({ games: [steam({ followers: 4999 })] }, null, payload(admission())).games;
  assert.equal(game.source, 'nintendo');
  assert.deepEqual(game.platforms, ['PS5']);
  assert.deepEqual(game.releasePlatforms, ['PS5']);
  assert.equal(game.followers, null);
  assert.equal(game.languages.tchinese, null);
  assert.equal(D.cardPlatformBadge(game).label, 'PC＋主機');
  assert.ok(game.releases.every(row => row.platform !== 'Steam'));
  assert.equal(D.detailURL(game), './game.html?igdb=348210&date=2027-02-18');
});

test('NS, NS2 and PS5 same-day events deduplicate and later ports retain one game identity', () => {
  const rows = [release({ platform: 'NS' }), release({ platform: 'NS2' }), release(), release(),
    release({ date: '2027-03-01', source_date: '2027-03-01', timestamp_taipei_date: '2027-03-01' })];
  const games = normalized({ platforms: ['NS', 'NS2', 'PS5'].map(platform),
    known_platforms: ['NS', 'NS2', 'PS5'].map(platform), releases: rows });
  assert.equal(games.length, 2);
  assert.deepEqual(games[0].releasePlatforms, ['NS', 'NS2', 'PS5']);
  assert.deepEqual(games[1].releasePlatforms, ['PS5']);
  assert.equal(games[0].releases.length, 4);
  assert.equal(D.cardGames(games).length, 1);
  assert.equal(D.cardPlatformBadge(games[0]).label, '主機多平台');
  assert.match(D.cardPlatformBadge(games[0]).title, /PS5.*NS.*NS2/);
});

test('multiple verified native records share an admitted Steam identity without dropping any platform date', () => {
  const nintendo = admission({ id: 'igdb:348211', igdb_id: 348211,
    platforms: [platform('NS'), platform('NS2')],
    known_platforms: [{ id: 6 }, platform('NS'), platform('NS2'), platform('PS5')],
    releases: [release({ platform: 'NS' }), release({ platform: 'NS2', date: '2027-05-20',
      source_date: '2027-05-20', timestamp_taipei_date: '2027-05-20' })] });
  const result = D.datasets({ games: [steam()] }, null, payload(admission(), nintendo));
  assert.deepEqual(result.games.map(game => game.date), ['2027-02-18', '2027-05-20']);
  assert.deepEqual(result.games[0].releasePlatforms, ['Steam', 'NS', 'PS5']);
  assert.deepEqual(result.games[1].releasePlatforms, ['NS2']);
  for (const game of result.games) {
    assert.deepEqual(game.platforms, ['Steam', 'NS', 'NS2', 'PS5']);
    assert.equal(game.releases.length, 4);
    assert.deepEqual(game.igdbIds, [348210, 348211]);
    assert.equal(D.isSaved(game, new Set(['igdb:348211'])), true);
    assert.equal(D.detailURL(game), `./game.html?appid=2963950&date=${game.date}`);
  }
  assert.equal(D.cardGames(result.games).length, 1);
});

test('Taiwan PS5 official dates require matching Sony product identity and retain regional provenance', () => {
  const official = release({ date: '2027-02-19', region: 'taiwan', source: 'official_registry',
    timezone_status: 'taiwan_official_date', date_basis: 'taiwan_official_calendar_day', taiwan_release_confirmed: true,
    official_source_url: psURL, official_product_id: PSID, official_source_name: 'PlayStation 台灣',
    official_verified_at: '2026-10-04T13:00:00Z' });
  const [game] = normalized({ releases: [official] });
  assert.equal(game.date, '2027-02-19');
  assert.equal(game.dateRegion, 'taiwan');
  assert.equal(game.releases[0].source_date, '2027-02-18');
  for (const fields of [{ official_product_id: '10009999' }, { official_product_id: undefined },
    { official_source_url: psURL.replace('zh-hant-tw', 'zh-hant-hk') },
    { official_source_url: 'https://www.nintendo.com/tw/schedule/' }, { region: 'worldwide' },
    { official_verified_at: null }, { official_verified_at: '2026-10-04T13:00:00' }, { official_source_name: '' },
    { date_basis: 'timestamp_shift' }, { taiwan_release_confirmed: false }])
    assert.deepEqual(normalized({ releases: [{ ...official, ...fields }] }), [], JSON.stringify(fields));
});

test('PS5 language proof is product-specific and Hong Kong fallback never claims Taiwan support', () => {
  const [game] = normalized({ platform_language_support: { PS5: support() },
    language_support: { tchinese: true }, platform_editions: {} });
  assert.equal(game.platformLanguages.PS5.languages.tchinese, false);
  assert.equal(game.languages.tchinese, null);
  assert.deepEqual(game.languageBadges.map(row => row.label), ['支援英文']);
  const hongKong = support({ region: 'hong_kong', source: 'PlayStation 香港',
    source_url: psURL.replace('zh-hant-tw', 'zh-hant-hk') });
  const [foreign] = normalized({ platform_language_support: { PS5: hongKong } });
  assert.equal(foreign.platformLanguages.PS5.region, 'hong_kong');
  assert.match(foreign.languageBadges[0].title, /PS5 版本.*香港來源.*尚未確認台灣/);
  for (const fields of [{ product_id: undefined }, { product_id: 'wrong' },
    { source_url: 'https://www.nintendo.com/tw/games/example/' },
    { source_url: psURL.replace('zh-hant-tw', 'zh-hant-hk') },
    { source_url: psURL.replace('store.playstation.com', 'store.playstation.com.evil.test') }])
    assert.equal(D.platformLanguageSupport(support(fields), 'PS5').status, 'unknown');
  assert.equal(D.nintendoLanguageSupport(support()).status, 'unknown');
});

test('PS5 languages remain separate from Nintendo and Steam after cross-platform merging', () => {
  const chineseNintendo = support({ source: 'Nintendo 台灣', source_url: 'https://www.nintendo.com/tw/games/example/',
    languages: { tchinese: true, schinese: false, english: false, chinese: true },
    supported_languages: [{ code: 'zh-Hant', name: '繁體中文' }] });
  const [game] = D.datasets({ games: [steam()] }, null, payload(admission({
    platforms: [platform('NS2'), platform('PS5')], known_platforms: [{ id: 6 }, platform('NS2'), platform('PS5')],
    releases: [release({ platform: 'NS2' }), release()],
    platform_language_support: { NS2: chineseNintendo, PS5: support() },
  }))).games;
  assert.equal(game.languages.tchinese, true);
  assert.equal(game.platformLanguages.NS2.languages.tchinese, true);
  assert.equal(game.platformLanguages.PS5.languages.tchinese, false);
  assert.deepEqual(D.nativeCardLanguages(game.platformLanguages, ['NS2', 'PS5']).languageBadges.map(row => row.label),
    ['NS2 支援繁中', 'PS5 支援英文']);
});

test('PS5 editions require an exact official product and scope titles to their release platform', () => {
  const [game] = normalized({ platform_editions: { PS5: edition() } });
  assert.deepEqual(D.releaseDisplayNames(game), {
    name: '女神異聞錄４ Revival（Deluxe 版）', nameEn: 'Persona 4 Revival Deluxe Edition',
  });
  for (const fields of [{ product_id: '10009999', source_url: 'https://store.playstation.com/zh-hant-tw/concept/10009999' },
    { product_id: 'JP0005-PPSA23593_00-APPLICATION00001' },
    { source_url: psURL.replace('zh-hant-tw', 'zh-hant-hk') },
    { source_url: 'https://www.nintendo.com/tw/games/example/' }])
    assert.equal(D.platformEdition(edition(fields), 'PS5'), null);
  const [merged] = D.datasets({ games: [steam({ name_zh_tw: '女神異聞錄４ Revival' })] }, null,
    payload(admission({ platform_editions: { PS5: edition() } }))).games;
  assert.equal(D.releaseDisplayNames(merged).name, '女神異聞錄４ Revival（PS5 Deluxe 版）');
  assert.equal(D.releaseDisplayNames(merged, ['Steam']).name, '女神異聞錄４ Revival');
});

test('PlayStation store links reject credentials, foreign-region proof and unrelated or unsafe URL shapes', () => {
  const [game] = normalized();
  assert.equal(game.link, psURL);
  assert.equal(game.linkLabel, 'PlayStation 商店');
  assert.equal(game.platformLinks.PS5.url, psURL);
  for (const url of ['javascript:alert(1)', 'https://store.playstation.com.evil.test/zh-hant-tw/concept/10009999',
    psURL.replace('https://', 'https://user:pass@'), psURL + '#other',
    'https://store.playstation.com/zh-hant-tw/search/persona',
    'https://www.playstation.com/zh-hant-tw/support/'])
    assert.equal(D.platformURL(url, 'PS5'), '', url);
  assert.equal(D.platformURL(psURL.replace('zh-hant-tw', 'zh-hant-hk'), 'PS5', 'taiwan'), '');
  assert.equal(normalized({ playstation_url: 'https://evil.test/', nintendo_url: 'https://www.nintendo.com/tw/' })[0].link, raw().url);
});
