// Allowed product URLs preserve storefront region and exact product identity.

export function nintendoURL(value, kind = "link") {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.startsWith("//") ? "https:" + value : value);
    const allowed = /(^|\.)(igdb\.com|nintendo\.com|nintendo\.com\.hk|nintendo\.co\.jp)$/.test(url.hostname);
    return url.protocol === "https:" && !url.username && !url.password && allowed ? url.href : "";
  } catch { return ""; }
}

export const playstationProductID = /^[A-Z]{2}[0-9]{4}-[A-Z0-9]{9}_[A-Z0-9]{2}-[A-Z0-9]{16}$/;

export const playstationRegionLocales = {
  taiwan: ["zh-hant-tw", "en-tw"], hong_kong: ["zh-hant-hk", "en-hk"],
  north_america: ["en-us"], japan: ["ja-jp"], united_kingdom: ["en-gb"],
  europe: ["en-gb"], australia: ["en-au"], asia: ["en-sg"],
};

export function playstationProduct(value, region = null) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "store.playstation.com" ||
      url.username || url.password || url.port || url.hash || url.search) return null;
    const match = /^\/([a-z]{2}(?:-[a-z]+)?-[a-z]{2})\/(product|concept)\/([^/]+)\/?$/.exec(url.pathname);
    if (!match || (region && !(playstationRegionLocales[region] || []).includes(match[1])) ||
      !(match[2] === "product" ? playstationProductID.test(match[3]) : /^[1-9][0-9]*$/.test(match[3]))) return null;
    return { url: url.href, kind: match[2], id: match[3], locale: match[1] };
  } catch { return null; }
}

export function platformURL(value, platform, region = null) {
  if (platform !== "PS5") return ["NS", "NS2"].includes(platform)
    ? region ? nintendoLanguageURL(value, region) : nintendoURL(value) : "";
  const product = playstationProduct(value, region);
  if (product) return product.url;
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "www.playstation.com" ||
      url.username || url.password || url.port || url.hash || url.search) return "";
    const match = /^\/([a-z]{2}(?:-[a-z]+)?-[a-z]{2})\/games\/[a-z0-9-]+\/?$/.exec(url.pathname);
    if (!match || (region && !(playstationRegionLocales[region] || []).includes(match[1]))) return "";
    return url.href;
  } catch { return ""; }
}

export const officialLanguageHosts = new Set(["www.nintendo.com", "www.nintendo.co.jp", "www.nintendo.com.hk",
  "ec.nintendo.com", "asia.sega.com", "www.konami.com", "www.playtombraider.com", "www.layton.jp"]);

export function nintendoLanguageURL(value, region = null) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
      !officialLanguageHosts.has(url.hostname)) return "";
    if (region) {
      if (region === "australia" && !["www.nintendo.com", "ec.nintendo.com"].includes(url.hostname)) return "";
      if (url.hostname === "www.nintendo.com" && !url.pathname.startsWith(
        { taiwan: "/tw/", north_america: "/us/", united_kingdom: "/en-gb/", europe: "/en-gb/", australia: "/au/" }[region] || "\0")) return "";
      if (url.hostname === "www.nintendo.co.jp" && region !== "japan") return "";
      if (url.hostname === "www.nintendo.com.hk" && region !== "hong_kong") return "";
      if (url.hostname === "ec.nintendo.com" && !url.pathname.startsWith(
        { taiwan: "/TW/", hong_kong: "/HK/", japan: "/JP/", australia: "/AU/" }[region] || "\0")) return "";
    }
    return url.href;
  } catch { return ""; }
}

export function nintendoHongKongDateURL(value) {
  if (typeof value !== "string" || value.length > 2000) return "";
  try {
    const url = new URL(value);
    const rawPath = /^https:\/\/[^/?#]+([^?#]*)/i.exec(value)?.[1] || "";
    const decodedPath = decodeURIComponent(rawPath);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || url.search ||
      /^https:\/\/[^/?#]+:[0-9]+(?:[/?#]|$)/i.test(value) || decodedPath.includes("\\") ||
      decodedPath.split("/").some(part => [".", ".."].includes(part))) return "";
    const hongKongHost = ["nintendo.com.hk", "www.nintendo.com.hk", "store.nintendo.com.hk"].includes(url.hostname);
    return (hongKongHost && !["/", "/index.html", "/index.htm"].includes(url.pathname) ||
      url.hostname === "www.nintendo.com" && url.pathname.startsWith("/hk/") &&
      !["", "index.html", "index.htm"].includes(url.pathname.slice(4))) ? url.href : "";
  } catch { return ""; }
}
