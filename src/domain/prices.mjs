// Console prices from the IGDB backend (platform_prices): the Taiwan
// PlayStation Store for PS5 (NT$), the Hong Kong Nintendo eShop for NS/NS2
// (HK$; Taiwan has no eShop of its own). Each carries its last check; the
// backend publishes a price only while that check is at most a week old.
import { awareTime } from './dates.mjs';
import { platformURL } from './storefronts.mjs';

const CURRENCY = { PS5: 'TWD', NS: 'HKD', NS2: 'HKD' };
const cents = value => Number.isSafeInteger(value) && value >= 0;

export function consolePrice(value, platform) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.currency !== CURRENCY[platform]) return null;
  if (!['onsale', 'preorder'].includes(value.status) || typeof value.free !== 'boolean' || !cents(value.final_cents)) return null;
  const checkedAt = awareTime(value.checked_at);
  const sourceURL = platformURL(value.source_url, platform);
  const source = typeof value.source === 'string' ? value.source.trim().slice(0, 40) : '';
  if (checkedAt === null || !sourceURL || !source) return null;
  const result = { currency: value.currency, free: value.free || value.final_cents === 0, final: value.final_cents,
    preorder: value.status === 'preorder', source, sourceURL, checkedAt };
  if (cents(value.original_cents) && value.original_cents > value.final_cents &&
      Number.isInteger(value.discount_pct) && value.discount_pct > 0 && value.discount_pct < 100) {
    result.original = value.original_cents;
    result.discountPct = value.discount_pct;
    const ends = awareTime(value.discount_ends_at);
    if (ends !== null) result.discountEndsAt = ends;
  }
  return result;
}

export function consolePrices(raw, platforms) {
  return Object.fromEntries(platforms.flatMap(code => {
    const price = consolePrice(raw?.platform_prices?.[code], code);
    return price ? [[code, price]] : [];
  }));
}
