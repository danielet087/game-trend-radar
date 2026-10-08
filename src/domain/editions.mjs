// Official edition evidence and scoped event display names.
import { nativePlatformIDs, languageRegionNames } from './constants.mjs';
import { awareTime } from './dates.mjs';
import { nintendoLanguageURL, playstationProduct } from './storefronts.mjs';

export function nintendoEdition(raw) {
  if (!raw || !["base_plus_expansion", "deluxe", "base_plus_dlc"].includes(raw.type) ||
    typeof raw.label !== "string" || !raw.label.trim() || raw.label.trim().length > 120 ||
    typeof raw.title !== "string" || !raw.title.trim() || raw.title.trim().length > 240 ||
    typeof raw.product_id !== "string" || !/^[1-9][0-9]{13}$/.test(raw.product_id) ||
    !Object.hasOwn(languageRegionNames, raw.region) || awareTime(raw.checked_at) === null) return null;
  const sourceURL = nintendoLanguageURL(raw.source_url, raw.region);
  if (!sourceURL) return null;
  const url = new URL(sourceURL);
  if (!["www.nintendo.com", "www.nintendo.co.jp", "www.nintendo.com.hk", "ec.nintendo.com"].includes(url.hostname)) return null;
  if (url.hostname === "ec.nintendo.com") {
    const product = /^\/(?:TW|HK|JP|AU)\/[A-Za-z-]+\/titles\/([1-9][0-9]{13})\/?$/.exec(url.pathname);
    if (!product || product[1] !== raw.product_id) return null;
  }
  return { type: raw.type, label: raw.label.trim(), title: raw.title.trim(), product_id: raw.product_id,
    region: raw.region, source_url: sourceURL, checked_at: raw.checked_at };
}

export function platformEdition(raw, platform) {
  if (["NS", "NS2"].includes(platform)) return nintendoEdition(raw);
  if (platform !== "PS5" || !raw || !["base_plus_expansion", "deluxe", "base_plus_dlc"].includes(raw.type) ||
    typeof raw.label !== "string" || !raw.label.trim() || raw.label.trim().length > 120 ||
    typeof raw.title !== "string" || !raw.title.trim() || raw.title.trim().length > 240 ||
    !Object.hasOwn(languageRegionNames, raw.region) || awareTime(raw.checked_at) === null) return null;
  const product = playstationProduct(raw.source_url, raw.region);
  if (!product || product.kind !== "product" || raw.product_id !== product.id) return null;
  return { type: raw.type, label: raw.label.trim(), title: raw.title.trim(), product_id: product.id,
    region: raw.region, source_url: product.url, checked_at: raw.checked_at };
}

export function releaseEditionBadges(game, platforms = game?.releasePlatforms || []) {
  return [...new Set(Array.isArray(platforms) ? platforms : [])]
    .filter(platform => Object.hasOwn(nativePlatformIDs, platform) && game?.platforms?.includes(platform))
    .flatMap(platform => {
      const edition = platformEdition(game?.platformEditions?.[platform], platform);
      return edition ? [{ platform, ...edition }] : [];
    });
}

export function releaseDisplayNames(game, platforms = game?.releasePlatforms || []) {
  const original = { name: String(game?.name || ""), nameEn: String(game?.nameEn || "") };
  const selected = [...new Set(Array.isArray(platforms) ? platforms : [])]
    .filter(platform => game?.platforms?.includes(platform));
  const editions = releaseEditionBadges(game, selected);
  if (!editions.length) return original;
  const groups = new Map();
  for (const edition of editions) {
    const key = JSON.stringify([edition.type, edition.label, edition.title]);
    if (!groups.has(key)) groups.set(key, { label: edition.label, title: edition.title, platforms: [] });
    groups.get(key).platforms.push(edition.platform);
  }
  const versions = [...groups.values()];
  const scoped = versions.length > 1 || selected.some(platform => !editions.some(edition => edition.platform === platform));
  const platformPrefix = (version) => scoped ? version.platforms.join("／") + " " : "";
  const nameEn = versions.map(version => platformPrefix(version) + version.title).join("／");
  if (!/[\u3400-\u9fff]/.test(original.name)) return { name: nameEn, nameEn };
  // Canonical names stay intact. Repeated suffixes in a localized display
  // name are replaced by one version suffix with the current event's scope.
  const normalize = value => value.replace(/[\s：:]/g, "").toLocaleLowerCase("en-US");
  const labels = new Set(versions.map(version => normalize(version.label)));
  let base = original.name.trim();
  while (base) {
    const suffix = /[（(]([^（）()]*)[）)]$/.exec(base);
    if (!suffix || !labels.has(normalize(suffix[1].replace(/^(?:(?:NS2?|PS5|Steam)[／\s：:]*)+/, "")))) break;
    base = base.slice(0, suffix.index).trim();
  }
  for (const version of versions) {
    if (normalize(base).endsWith(normalize(version.label))) {
      const words = version.label.trim().split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const suffix = new RegExp(words.join("\\s*") + "\\s*$", "i");
      base = base.replace(suffix, "").replace(/[\s：:·・＋+／/—-]+$/, "").trim();
    }
  }
  const label = versions.map(version => platformPrefix(version) + version.label).join("；");
  return { name: `${base || original.name}（${label}）`, nameEn };
}
