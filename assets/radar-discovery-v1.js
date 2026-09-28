/* Shared, local-only discovery over the already-published Steam dataset. */
(function (root) {
  "use strict";
  const names = {
    Action: "動作",
    Adventure: "冒險",
    RPG: "角色扮演",
    Strategy: "策略",
    Simulation: "模擬",
    Casual: "休閒",
    Indie: "獨立製作",
    Racing: "競速",
    Sports: "運動",
    "Early Access": "搶先體驗",
    "Free To Play": "免費遊玩",
    "Massively Multiplayer": "大型多人連線",
    Exploration: "探索",
    Singleplayer: "單人遊玩",
    Multiplayer: "多人遊玩",
    "Co-op": "合作遊玩",
    "Online Co-Op": "線上合作",
    "Local Co-Op": "本機合作",
    "Action-Adventure": "動作冒險",
    "Action RPG": "動作角色扮演",
    "Story Rich": "豐富劇情",
    Atmospheric: "氛圍感",
    Management: "經營管理",
    Fantasy: "奇幻",
    "Dark Fantasy": "黑暗奇幻",
    "Open World": "開放世界",
    Sandbox: "沙盒",
    Building: "建造",
    Horror: "恐怖",
    "Survival Horror": "生存恐怖",
    "Psychological Horror": "心理恐怖",
    "Pixel Graphics": "像素風格",
    Crafting: "製作合成",
    "City Builder": "城市建造",
    "Base Building": "基地建造",
    "First-Person": "第一人稱",
    "Third Person": "第三人稱",
    "Female Protagonist": "女性主角",
    "Hack and Slash": "砍殺",
    Realistic: "寫實",
    "Life Sim": "生活模擬",
    Relaxing: "放鬆療癒",
    Cozy: "溫馨療癒",
    "Farming Sim": "農場模擬",
    Farming: "農耕",
    Cinematic: "電影敘事",
    Shooter: "射擊",
    FPS: "第一人稱射擊",
    JRPG: "日式角色扮演",
    "Sci-fi": "科幻",
    Gore: "血腥",
    Violent: "暴力",
    "Character Customization": "角色自訂",
    Puzzle: "解謎",
    Cute: "可愛",
    Survival: "生存",
    Funny: "幽默",
    "Dark Humor": "黑色幽默",
    "Hand-drawn": "手繪",
    Anime: "動畫風格",
    "Turn-Based Combat": "回合制戰鬥",
    "Turn-Based Strategy": "回合制策略",
    "Turn-Based Tactics": "回合制戰術",
    "Choices Matter": "選擇影響劇情",
    "Multiple Endings": "多重結局",
    Platformer: "平台跳躍",
    "Precision Platformer": "精準平台跳躍",
    "3D Platformer": "3D 平台跳躍",
    "2D Platformer": "2D 平台跳躍",
    "Puzzle Platformer": "解謎平台跳躍",
    Roguelike: "Roguelike",
    Roguelite: "Roguelite",
    "Action Roguelike": "動作 Roguelike",
    "Souls-like": "類魂",
    Metroidvania: "類銀河戰士惡魔城",
    "Dungeon Crawler": "地下城探索",
    Deckbuilding: "牌組構築",
    "Roguelike Deckbuilder": "Roguelike 牌組構築",
    "Card Game": "卡牌遊戲",
    Automation: "自動化",
    Agriculture: "農業",
    Medieval: "中世紀",
    Capitalism: "資本經營",
    "Resource Management": "資源管理",
    "Colony Sim": "殖民地模擬",
    "Tower Defense": "塔防",
    "Visual Novel": "視覺小說",
    Romance: "戀愛",
    Detective: "偵探",
    Mystery: "懸疑",
    "Point & Click": "點擊冒險",
    "Walking Simulator": "步行模擬",
    Futuristic: "未來風格",
    Cyberpunk: "賽博龐克",
    Space: "太空",
    Robots: "機器人",
    "Space Sim": "太空模擬",
    Rhythm: "節奏",
    Music: "音樂",
    Fighting: "格鬥",
    "Party Game": "派對遊戲",
    "Split Screen": "分割畫面",
    "Local Multiplayer": "本機多人",
    "Online PvP": "線上對戰",
    PvP: "玩家對戰",
    PvE: "玩家對環境",
    "Family Friendly": "闔家同樂",
    Colorful: "繽紛色彩",
    Controller: "控制器支援",
    "Great Soundtrack": "出色配樂",
    Dark: "黑暗風格",
    Combat: "戰鬥",
    Nature: "自然",
    "1990's": "90 年代",
    "1980s": "80 年代",
    Difficult: "高難度",
    "Old School": "經典玩法",
    Retro: "復古",
    "Top-Down": "俯視視角",
    Animals: "動物",
    Zoo: "動物園",
    "Boomer Shooter": "復古射擊",
    Cartoony: "卡通風格",
    Cartoon: "卡通",
    Comedy: "喜劇",
    "Dynamic Narration": "動態敘事",
    "Inventory Management": "物品管理",
    "Lore-Rich": "豐富世界觀",
    Magic: "魔法",
    Surreal: "超現實",
    "Arena Shooter": "競技場射擊",
    "Automobile Sim": "汽車模擬",
    "Board Game": "桌遊",
    Cooking: "烹飪",
    Demons: "惡魔",
    Driving: "駕駛",
    Economy: "經濟",
    "Grand Strategy": "大戰略",
    Historical: "歷史",
    Investigation: "調查",
    Loot: "戰利品",
    "Mystery Dungeon": "不思議迷宮",
    Offroad: "越野",
    Physics: "物理",
    "Post-apocalyptic": "末日後世界",
    RTS: "即時戰略",
    Stealth: "潛行",
    Supernatural: "超自然",
    Swordplay: "劍術",
    "Time Manipulation": "時間操控",
    "4 Player Local": "本機四人",
    "Action RTS": "動作即時戰略",
    "Alternate History": "架空歷史",
    Arcade: "街機",
    Archery: "弓箭",
    "Beat 'em up": "清版格鬥",
    Cats: "貓咪",
    "Class-Based": "職業分工",
    "Co-op Campaign": "合作戰役",
    "Comic Book": "漫畫",
    Conspiracy: "陰謀",
    "Dark Comedy": "黑色喜劇",
    Dice: "骰子",
    Emotional: "情感敘事",
    "Extraction Shooter": "撤離射擊",
    "Fast-Paced": "快節奏",
    FMV: "真人互動影像",
    "Grid-Based Movement": "格線移動",
    "Gun Customization": "槍械自訂",
    "Hidden Object": "尋物",
    Isometric: "等角視角",
    "Looter Shooter": "刷寶射擊",
    Lovecraftian: "洛夫克拉夫特風格",
    Military: "軍事",
    Minimalist: "極簡",
    Moddable: "支援模組",
    Modern: "現代",
    Mythology: "神話",
    Narrative: "敘事",
    Noir: "黑色電影風格",
    Nonlinear: "非線性",
    "Perma Death": "永久死亡",
    "Procedural Generation": "程序生成",
    Psychedelic: "迷幻",
    "Real Time Tactics": "即時戰術",
    "Replay Value": "可重複遊玩",
    Rome: "羅馬",
    Short: "短篇",
    "Side Scroller": "橫向卷軸",
    Snow: "冰雪",
    Sokoban: "推箱子",
    Soundtrack: "原聲配樂",
    Superhero: "超級英雄",
    Tabletop: "桌上遊戲",
    "Top-Down Shooter": "俯視射擊",
    Transportation: "交通運輸",
    Vampires: "吸血鬼",
    War: "戰爭",
    Wargame: "戰爭遊戲",
    Wholesome: "暖心",
    "World War II": "第二次世界大戰",
    Zombies: "殭屍",
    "Open World Survival Craft": "開放世界生存製作",
    "Sexual Content": "性相關內容",
    Nudity: "裸露",
    Hentai: "成人情色",
  };
  const key = (value) =>
    typeof value === "string"
      ? value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()
      : "";
  const translated = new Map(
    Object.entries(names).map(([name, label]) => [key(name), label]),
  );
  const storeLabels = new Map();
  const storeGenreLabels = new Map();
  const label = (value) => storeLabels.get(key(value)) || translated.get(key(value)) || value;
  const genreLabel = (value) => storeGenreLabels.get(key(value)) || translated.get(key(value)) || value;
  function registerStoreLabels(values, target) {
    if (!values || typeof values !== "object" || Array.isArray(values)) return;
    for (const [name, label] of Object.entries(values)) {
      if (key(name) && typeof label === "string" && label.trim() && label.length <= 120)
        target.set(key(name), label.trim());
    }
  }
  function labels(values) {
    if (!Array.isArray(values)) return [];
    const unique = new Map();
    for (const entry of values) {
      const value =
        typeof entry === "string" ? entry : entry?.name || entry?.description;
      if (
        typeof value !== "string" ||
        !value.trim() ||
        value.trim().length > 120
      )
        continue;
      if (!unique.has(key(value))) unique.set(key(value), value.trim());
      if (unique.size === 30) break;
    }
    return [...unique.values()];
  }
  function enrich(data, official, preview) {
    if (!data) return data;
    const index = (rows) =>
      new Map(
        (rows || []).filter(Boolean).map((row) => [Number(row.appid), row]),
      );
    const primary = index(official?.games);
    const fallback = index(preview?.games);
    const recent = index(preview?.recent_games);
    const attach = (game) => {
      const source =
        primary.get(game.appid) ||
        (game.recent ? recent.get(game.appid) : fallback.get(game.appid));
      const backup = game.recent
        ? recent.get(game.appid) || fallback.get(game.appid)
        : fallback.get(game.appid);
      // Explicit empty metadata in the official record must not resurrect stale preview values.
      const field = (name) =>
        source && Object.hasOwn(source, name) ? source[name] : backup?.[name];
      registerStoreLabels(field("tag_labels_zh_tw"), storeLabels);
      registerStoreLabels(field("genre_labels_zh_tw"), storeGenreLabels);
      const descriptionRecord = source && Object.hasOwn(source, "short_description") ? source : backup;
      const description = descriptionRecord?.short_description;
      const isTraditional = descriptionRecord?.short_description_language === "zh-TW";
      return {
        ...game,
        tags: labels(field("tags")),
        genres: labels(field("genres")),
        description:
          isTraditional && typeof description === "string"
            ? description.trim().slice(0, 4000)
            : "",
        descriptionSource: isTraditional ? descriptionRecord.short_description_source || "" : "",
      };
    };
    return {
      ...data,
      games: data.games.map(attach),
      recent: data.recent.map(attach),
    };
  }
  const hasTag = (game, tag) =>
    (game.tags || []).some((value) => key(value) === key(tag));
  function tagFilters(params) {
    const exclude = labels(params.getAll("exclude")).slice(0, 12);
    const include = labels(params.getAll("tag")).filter(tag => !exclude.some(value => key(value) === key(tag))).slice(0, 12);
    return { include, exclude, match: params.get("match") === "any" ? "any" : "all" };
  }
  function matchesTags(game, filters) {
    if (filters.exclude.some(tag => hasTag(game, tag))) return false;
    return !filters.include.length || (filters.match === "any"
      ? filters.include.some(tag => hasTag(game, tag))
      : filters.include.every(tag => hasTag(game, tag)));
  }
  function catalog(games) {
    const counts = new Map();
    for (const game of games)
      for (const tag of labels(game.tags)) {
        const id = key(tag);
        if (!counts.has(id))
          counts.set(id, { tag, label: label(tag), count: 0 });
        counts.get(id).count++;
      }
    return [...counts.values()].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-TW"),
    );
  }
  function recommendations(game, games, selected = "", limit = 3) {
    const own = new Set((game.tags || []).map(key));
    const unique = new Map(
      games
        .filter((row) => row.appid !== game.appid)
        .map((row) => [row.appid, row]),
    );
    let rows = [...unique.values()]
      .filter((row) => !selected || hasTag(row, selected))
      .map((row) => ({
        ...row,
        sharedTags: (row.tags || []).filter((tag) => own.has(key(tag))),
      }));
    const hasShared = rows.some((row) => row.sharedTags.length > 0);
    if (!selected && hasShared)
      rows = rows.filter((row) => row.sharedTags.length);
    rows.sort(
      (a, b) =>
        b.sharedTags.length - a.sharedTags.length ||
        Math.abs(Date.parse(a.date) - Date.parse(game.date)) -
          Math.abs(Date.parse(b.date) - Date.parse(game.date)) ||
        b.followers - a.followers ||
        a.appid - b.appid,
    );
    return {
      games: rows.slice(0, limit),
      count: rows.length,
      basis: selected ? "tag" : hasShared ? "shared" : "date",
    };
  }
  function theme(game) {
    const all = new Set(
      [...(game.tags || []), ...(game.genres || [])].map(key),
    );
    const any = (...tags) => tags.some((tag) => all.has(key(tag)));
    if (
      any("Horror", "Survival Horror", "Psychological Horror", "Dark Fantasy")
    )
      return "twilight";
    if (
      any(
        "Relaxing",
        "Cozy",
        "Farming Sim",
        "Life Sim",
        "Management",
        "City Builder",
      )
    )
      return "grove";
    if (any("Sci-fi", "Cyberpunk", "Space", "Futuristic")) return "sky";
    if (any("RPG", "Fantasy", "JRPG", "Adventure")) return "iris";
    return "sunset";
  }
  const url = (tag = "") =>
    "./explore.html" +
    (tag ? "?" + new URLSearchParams({ tag }).toString() : "");
  const api = {
    key,
    label,
    genreLabel,
    labels,
    enrich,
    hasTag,
    tagFilters,
    matchesTags,
    catalog,
    recommendations,
    theme,
    url,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RadarDiscovery = api;
})(typeof window !== "undefined" ? window : globalThis);
