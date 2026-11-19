// Taiwan Steam price, CSRR rating and Steam Deck status for one game.
// data/store_facts.json is checked four times a day by the content backend;
// each game keeps the time Steam last confirmed its values.

const RATINGS = { G: '普遍級', P6: '保護級', C12: '輔12級', C15: '輔15級', R: '限制級' };
const DECK = { verified: '已驗證', playable: '可遊玩', unsupported: '不支援' };
const TAIPEI = 'Asia/Taipei';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const cents = value => Number.isSafeInteger(value) && value >= 0;
const time = value => {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

function validPrice(price) {
  if (price === null || price === undefined) return null;
  if (!isRecord(price) || typeof price.free !== 'boolean') return null;
  if (price.free) return { free: true };
  if (!cents(price.final_cents)) return null;
  const result = { free: false, final: price.final_cents };
  if (cents(price.original_cents) && price.original_cents > price.final_cents
      && Number.isInteger(price.discount_pct) && price.discount_pct > 0 && price.discount_pct < 100) {
    result.original = price.original_cents;
    result.discountPct = price.discount_pct;
    const ends = time(price.discount_ends_at);
    if (ends !== null) result.discountEndsAt = ends;
  }
  return result;
}

function validRating(rating) {
  if (!isRecord(rating) || !RATINGS[rating.code] || rating.label !== RATINGS[rating.code]) return null;
  const descriptors = Array.isArray(rating.descriptors)
    ? rating.descriptors.filter(name => typeof name === 'string' && name.trim()).slice(0, 9)
    : [];
  return { code: rating.code, label: rating.label, descriptors };
}

export function storeFacts(document, appid) {
  if (!isRecord(document) || document.schema_version !== 1 || !isRecord(document.games)) return null;
  const entry = document.games[String(appid)];
  if (!isRecord(entry)) return null;
  const checkedAt = time(entry.checked_at);
  if (checkedAt === null) return null;
  const price = validPrice(entry.price);
  const rating = validRating(entry.rating);
  const steamDeck = DECK[entry.steam_deck] ? entry.steam_deck : null;
  if (!price && !rating && !steamDeck) return null;
  return { price, rating, steamDeck, checkedAt };
}

const parts = (value, options) => Object.fromEntries(
  new Intl.DateTimeFormat('en-US', { timeZone: TAIPEI, hour12: false, ...options })
    .formatToParts(new Date(value)).map(part => [part.type, part.value]));

// "11/19 12:30" in Taiwan time.
export function taipeiTime(value) {
  const at = parts(value, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${at.month}/${at.day} ${at.hour === '24' ? '00' : at.hour}:${at.minute}`;
}

export function money(value) {
  const amount = value / 100;
  return `NT$ ${amount.toLocaleString('en-US', { maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 })}`;
}

export function priceText(price) {
  if (!price) return '';
  if (price.free) return '免費';
  return money(price.final);
}

export function discountText(price) {
  if (!price?.discountPct) return '';
  const ends = price.discountEndsAt ? `，特價到 ${taipeiTime(price.discountEndsAt)}` : '';
  return `-${price.discountPct}%，原價 ${money(price.original)}${ends}`;
}

export function ratingText(rating) {
  if (!rating) return '';
  return rating.descriptors.length ? `${rating.label}（${rating.descriptors.join('、')}）` : rating.label;
}

export const deckText = value => DECK[value] || '';
