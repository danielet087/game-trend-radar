// Stable native-platform identifiers shared across domain modules.

export const nativePlatformIDs = Object.freeze({ NS: 130, NS2: 508, PS5: 167 });

export const nativePlatformOrder = Object.freeze(Object.keys(nativePlatformIDs));

export const cardPlatformNames = {
  6: { label: "PC（Windows）", type: "pc" }, 14: { label: "Mac", type: "pc" }, 3: { label: "Linux", type: "pc" },
  130: { label: "NS", type: "console" }, 508: { label: "NS2", type: "console" },
  48: { label: "PS4", type: "console" }, 167: { label: "PS5", type: "console" },
  49: { label: "Xbox One", type: "console" }, 169: { label: "Xbox Series X|S", type: "console" },
  39: { label: "iOS", type: "mobile" }, 34: { label: "Android", type: "mobile" },
};

export const languageRegionNames = { taiwan: "台灣", north_america: "北美", japan: "日本", hong_kong: "香港", asia: "亞洲", worldwide: "全球公告",
  united_kingdom: "英國", europe: "歐洲", australia: "澳洲" };
