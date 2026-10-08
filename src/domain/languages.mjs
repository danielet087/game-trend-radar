// Game language support remains independent of storefront title localization.
import { nativePlatformIDs, languageRegionNames } from './constants.mjs';
import { awareTime } from './dates.mjs';
import { playstationProduct, nintendoLanguageURL } from './storefronts.mjs';

export function platformLanguageSupport(raw, platform = "NS") {
  const unknown = { status: "unknown", region: null,
    languages: { tchinese: null, schinese: null, english: null, chinese: null },
    supported_languages: [], complete: false, source: null, source_url: null, checked_at: null,
    evidence_type: null, languageBadges: [{ label: "語言支援待確認", status: "unknown" }] };
  if (!raw || !["confirmed", "partial"].includes(raw.status) ||
    !Object.hasOwn(languageRegionNames, raw.region) ||
    !(platform === "PS5" ? playstationProduct(raw.source_url, raw.region) : nintendoLanguageURL(raw.source_url, raw.region)) ||
    typeof raw.source !== "string" || !raw.source.trim() || awareTime(raw.checked_at) === null ||
    !["official_product_languages", "official_chinese_unspecified"].includes(raw.evidence_type) ||
    typeof raw.complete !== "boolean" || !raw.languages || !Array.isArray(raw.supported_languages) ||
    !raw.supported_languages.length || raw.supported_languages.length > 32) return unknown;
  if (!Object.hasOwn(nativePlatformIDs, platform)) return unknown;
  const product = platform === "PS5" ? playstationProduct(raw.source_url, raw.region) : null;
  if (product && raw.product_id !== product.id) return unknown;
  const sourceURL = product?.url || nintendoLanguageURL(raw.source_url);
  const rows = [], codes = new Set();
  for (const row of raw.supported_languages) {
    if (!row || typeof row.code !== "string" || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(row.code) ||
      typeof row.name !== "string" || !row.name.trim() || codes.has(row.code.toLowerCase())) return unknown;
    codes.add(row.code.toLowerCase());
    rows.push({ code: row.code, name: row.name.trim().slice(0, 80) });
  }
  const genericChinese = codes.has("zh");
  const traditional = [...codes].some(code => /^zh-(?:hant(?:-|$)|tw$|hk$|mo$)/.test(code));
  const simplified = [...codes].some(code => /^zh-(?:hans(?:-|$)|cn$|sg$)/.test(code));
  const english = [...codes].some(code => /^en(?:-|$)/.test(code));
  const complete = raw.complete === true;
  const expected = {
    tchinese: traditional ? true : genericChinese ? null : complete ? false : null,
    schinese: simplified ? true : genericChinese ? null : complete ? false : null,
    english: english ? true : complete ? false : null,
    chinese: genericChinese || traditional || simplified ? true : complete ? false : null,
  };
  if (Object.keys(expected).some(key => raw.languages[key] !== expected[key]) ||
    (raw.status === "confirmed" && (!complete || raw.evidence_type !== "official_product_languages")) ||
    (raw.status === "partial" && complete) ||
    (raw.evidence_type === "official_chinese_unspecified" &&
      (raw.status !== "partial" || codes.size !== 1 || !genericChinese))) return unknown;
  const badges = [];
  if (expected.tchinese === true) badges.push({ label: "支援繁中", status: "traditional" });
  if (expected.schinese === true) badges.push({ label: "支援簡中", status: "simplified" });
  if (expected.chinese === true && !badges.length) badges.push({ label: "中文（字體待確認）", status: "chinese" });
  if (!badges.length && expected.english === true) badges.push({ label: "支援英文", status: "english" });
  if (!badges.length && rows.length) badges.push({ label: `支援${rows[0].name}`, status: "other" });
  return { status: raw.status, region: raw.region, languages: expected, supported_languages: rows, complete,
    source: raw.source.trim().slice(0, 120), source_url: sourceURL, checked_at: raw.checked_at,
    evidence_type: raw.evidence_type, ...(product ? { product_id: product.id } : {}),
    languageBadges: badges.length ? badges : unknown.languageBadges };
}

export function nintendoLanguageSupport(raw) { return platformLanguageSupport(raw, "NS"); }

export function nintendoCardLanguages(platformLanguages = {}, platforms = []) {
  const selected = platforms.map(platform => ({ platform, support: platformLanguages[platform] || nintendoLanguageSupport() }));
  const badges = selected.flatMap(({ platform, support }) => support.languageBadges.map(badge => ({
    ...badge, label: `${selected.length > 1 ? platform + " " : ""}${badge.label}`,
    title: support.status === "unknown" ? `${platform} 版本語言支援待確認`
      : `${platform} 版本 · ${languageRegionNames[support.region]}來源；${support.source}。介面、字幕與配音請以該版本官方語言表為準。${support.region !== "taiwan" ? "尚未確認台灣販售版本是否相同。" : ""}`,
  })));
  const languages = Object.fromEntries(["tchinese", "schinese", "english", "chinese"].map(key =>
    [key, selected.length && selected.every(({ support }) => support.languages[key] === true) ? true : null]));
  return { languages, languageBadges: badges, languageBadge: badges.map(badge => badge.label).join("・"),
    languageStatus: badges[0]?.status || "unknown" };
}
