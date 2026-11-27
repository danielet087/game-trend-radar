// Taiwan Steam price, CSRR rating, Steam Deck status and Advance Access for one
// game. data/store_facts.json is checked four times a day by the content
// backend; each game keeps the time Steam last confirmed its values.

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

// Steam Advance Access: buyers of some editions play before the full release.
function validAdvanceAccess(access) {
  const startsAt = isRecord(access) ? time(access.starts_at) : null;
  if (startsAt === null) return null;
  const editions = Array.isArray(access.editions)
    ? [...new Set(access.editions.filter(name => typeof name === 'string' && name.trim()).map(name => name.trim()))].slice(0, 6)
    : [];
  return { startsAt, editions };
}

// Steam's display of the release date: the precision it stands for (a month,
// quarter or year is given by its last day).
const DISPLAYS = { date_full: 'day', date_month: 'month', date_quarter: 'quarter', date_year: 'year' };
function validRelease(release) {
  const at = isRecord(release) ? time(release.at) : null;
  return at === null ? null : { at, precision: DISPLAYS[release.display] ?? null };
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
  const advanceAccess = validAdvanceAccess(entry.advance_access);
  const release = validRelease(entry.release);
  if (!price && !rating && !steamDeck && !advanceAccess && !release) return null;
  return { price, rating, steamDeck, advanceAccess, release, checkedAt };
}

const DAY = 86400000, HOUR = 3600000;

// The Steam release instant: the developer's time on the Taiwan day shown, or
// that day's midnight in Taiwan.
export function steamReleaseAt(game) {
  const row = (Array.isArray(game?.releases) ? game.releases : []).find(release => release?.platform === 'Steam');
  if (!row || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return null;
  const clock = time(row.time_utc);
  return clock ?? time(`${row.date}T00:00:00+08:00`);
}

// "3 天" or, under a day, "5 小時".
export function leadText(lead) {
  return lead >= DAY ? `${Math.floor(lead / DAY)} 天` : `${Math.max(1, Math.floor(lead / HOUR))} 小時`;
}

// 「豪華版可提前 3 天玩（12/2 01:00 起）」 before the release, a past tense after it.
export function advanceAccessText(access, releaseAt, now = Date.now()) {
  if (!access || !Number.isFinite(releaseAt) || access.startsAt >= releaseAt) return '';
  const lead = leadText(Math.round((releaseAt - access.startsAt) / HOUR) * HOUR);
  const from = `${taipeiTime(access.startsAt)} 起`;
  if (now >= releaseAt) return `豪華版曾提前 ${lead}開放（${from}）`;
  if (now >= access.startsAt) return `豪華版已開放提前玩（${from}，比正式上市早 ${lead}）`;
  return `豪華版可提前 ${lead}玩（${from}）`;
}

const parts = (value, options) => Object.fromEntries(
  new Intl.DateTimeFormat('en-US', { timeZone: TAIPEI, hour12: false, ...options })
    .formatToParts(new Date(value)).map(part => [part.type, part.value]));

// "11/19 12:30" in Taiwan time.
export function taipeiTime(value) {
  const at = parts(value, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${at.month}/${at.day} ${at.hour === '24' ? '00' : at.hour}:${at.minute}`;
}

// Steam and PlayStation prices are Taiwan dollars; the Nintendo eShop's are Hong Kong dollars.
const SYMBOLS = { TWD: 'NT$', HKD: 'HK$' };

export function money(value, currency = 'TWD') {
  const amount = value / 100;
  return `${SYMBOLS[currency] || 'NT$'} ${amount.toLocaleString('en-US', { maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 })}`;
}

export function priceText(price) {
  if (!price) return '';
  if (price.free) return '免費';
  return money(price.final, price.currency);
}

export function discountText(price) {
  if (!price?.discountPct) return '';
  const ends = price.discountEndsAt ? `，特價到 ${taipeiTime(price.discountEndsAt)}` : '';
  return `-${price.discountPct}%，原價 ${money(price.original, price.currency)}${ends}`;
}

export function ratingText(rating) {
  if (!rating) return '';
  return rating.descriptors.length ? `${rating.label}（${rating.descriptors.join('、')}）` : rating.label;
}

export const deckText = value => DECK[value] || '';
