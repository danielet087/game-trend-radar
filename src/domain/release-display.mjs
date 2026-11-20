// One Taiwan release day per platform, its clock time when a source gives
// one, and how sure that day is for Taiwan. The calendar, the cards and the
// game page all read these rules, so a platform that launches later never
// looks like it launches with the others, and an IGDB worldwide day is never
// called a Taiwan date.
import { validDate, awareTime, todayInTaipei } from './dates.mjs';
import { nativePlatformOrder } from './constants.mjs';
import { nintendoReleaseAudited, officialTaiwanReleaseTime } from './release-audit.mjs';
import { platformURL } from './storefronts.mjs';

export const releasePlatformOrder = Object.freeze(['Steam', ...nativePlatformOrder]);

const REGION_NAMES = {
  worldwide: '全球', asia: '亞洲', taiwan: '台灣', japan: '日本', north_america: '北美',
  europe: '歐洲', australia: '澳洲', hong_kong: '香港', south_korea: '韓國', china: '中國',
  united_kingdom: '英國', brazil: '巴西',
};
const TAIPEI_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// The official sources a Taiwan date may cite (the game page's own rule).
const OFFICIAL_HOSTS = /(^|\.)(igdb\.com|nintendo\.com|nintendo\.com\.hk|nintendo\.co\.jp|sega\.com|konami\.com|playtombraider\.com|layton\.jp)$/;
export function officialSourceURL(value) {
  try {
    const consoleURL = platformURL(value, 'PS5');
    if (consoleURL) return consoleURL;
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && OFFICIAL_HOSTS.test(url.hostname)
      ? url.href : '';
  } catch { return ''; }
}

/**
 * Whether a release row's day is the Taiwan day. Steam days come from the
 * developer's release time converted to Taipei; a console day counts only
 * with a Taiwan official source. Everything else keeps its region's name.
 */
export function releaseEvidence(row) {
  if (row?.platform === 'Steam')
    return { taiwan: true, label: '台灣時間', badge: '台灣時間', short: '', source: 'Steam',
      title: 'Steam 發售時間換算台灣時間（UTC+8）' };
  if (row?.taiwan_release_confirmed === true && row.region === 'taiwan' && row.source === 'official_registry' &&
    row.date_basis === 'taiwan_official_calendar_day' && row.timezone_status === 'taiwan_official_date' &&
    officialSourceURL(row.official_source_url) && nintendoReleaseAudited(row))
    return { taiwan: true, label: '台灣官方', badge: '台灣官方', short: '', source: 'official', title: '台灣官方公布的上市日' };
  const hongKong = ['NS', 'NS2'].includes(row?.platform) && row?.source === 'official_registry' && row.region === 'hong_kong' &&
    row.timezone_status === 'hong_kong_official_date' && nintendoReleaseAudited(row);
  const source = hongKong ? 'official' : row?.source === 'IGDB' ? 'IGDB' : 'other';
  // A Taiwan day without a verified official source is still only a claim.
  if (!hongKong && row?.region === 'taiwan')
    return { taiwan: false, label: '台灣日期待確認', badge: '台灣日期待確認', short: '待確認', source,
      title: '台灣日期尚無可核對的官方來源，台灣上市日待確認' };
  const region = hongKong ? '香港' : REGION_NAMES[row?.region] || '';
  const label = hongKong ? '香港官方日期' : region ? `${region}日期` : '地區未確認的日期';
  const origin = source === 'IGDB' ? `IGDB ${label}` : label;
  return { taiwan: false, label, badge: `${label}・台灣待確認`, short: region || '他區', source,
    title: `${origin}，台灣上市日待確認` };
}

/**
 * How sure one day is for the versions shown on it, or null when every one is
 * a Taiwan day. `pending` names the versions still unconfirmed; `mixed` when
 * a Taiwan day (Steam) shares the date, so only the console part is unsure.
 */
export function dayEvidence(rows) {
  const entries = (rows || []).filter(Boolean).map(row => ({ platform: row.platform, evidence: releaseEvidence(row) }));
  const unsure = entries.filter(entry => !entry.evidence.taiwan);
  if (!unsure.length) return null;
  const evidence = unsure[0].evidence;
  const names = list => [...new Set(list.map(entry => entry.platform))];
  const confirmed = names(entries.filter(entry => entry.evidence.taiwan)), pending = names(unsure);
  const mixed = confirmed.length > 0;
  return { ...evidence, pending, confirmed, mixed,
    // "全球日期" on a console-only day; "主機全球日期" beside a Steam day.
    chip: mixed ? `主機${evidence.label}` : evidence.label,
    detail: mixed ? `${pending.join('、')}：${evidence.title}` : evidence.title };
}

/** The Taiwan clock time a source gives for a release day, or null. */
export function releaseClock(row) {
  if (!row || !validDate(row.date)) return null;
  let instant = null;
  if (row.platform === 'Steam') {
    instant = awareTime(row.time_utc);
    if (instant !== null && todayInTaipei(new Date(instant)) !== row.date) instant = null;
  } else if (releaseEvidence(row).source === 'official') {
    instant = officialTaiwanReleaseTime(row);
  }
  if (instant === null) return null;
  return { time: TAIPEI_CLOCK.format(new Date(instant)), utc: new Date(instant).toISOString(),
    source: row.platform === 'Steam' ? 'steam' : 'official' };
}

export function releaseState(date, today) {
  if (!validDate(date)) return 'undated';
  return date < today ? 'released' : date === today ? 'today' : 'upcoming';
}

/**
 * Each tracked platform of the game with its first known release day (or
 * null). `listed` is false when the data has no release at all for that
 * platform — often a version that came out before the radar followed it —
 * so its day is unknown here, not "to be announced".
 */
export function platformFirstReleases(game) {
  const tracked = releasePlatformOrder.filter(code => (game?.platforms || []).includes(code));
  const first = new Map(), listed = new Set();
  for (const row of Array.isArray(game?.releases) ? game.releases : []) {
    if (!row || !tracked.includes(row.platform)) continue;
    listed.add(row.platform);
    if (row.precision !== 'day' || !validDate(row.date)) continue;
    const prior = first.get(row.platform);
    if (!prior || row.date < prior.date ||
      (row.date === prior.date && releaseEvidence(row).taiwan && !releaseEvidence(prior).taiwan)) first.set(row.platform, row);
  }
  return tracked.map(platform => ({ platform, row: first.get(platform) || null, listed: listed.has(platform) }));
}

const platformState = ({ row, listed }, today) => row ? releaseState(row.date, today) : listed ? 'undated' : 'unlisted';

/** The tracked platforms whose first release falls on a day. */
export function platformsOnDate(game, date) {
  return platformFirstReleases(game).filter(({ row }) => row?.date === date).map(({ platform }) => platform);
}

/** Tracked platforms that do not release on the shown day: when they did or will. */
export function otherPlatformReleases(game, shown, today) {
  const showing = new Set(shown || []);
  if (!showing.size) return [];
  return platformFirstReleases(game).filter(({ platform }) => !showing.has(platform)).map(entry => ({
    platform: entry.platform, date: entry.row?.date || '', state: platformState(entry, today),
    evidence: entry.row ? releaseEvidence(entry.row) : null, clock: entry.row ? releaseClock(entry.row) : null,
  }));
}

/** Tracked platforms grouped by release state, in the order a reader meets them; unlisted ones say nothing. */
export function releaseStatusGroups(game, today) {
  const groups = new Map();
  for (const entry of platformFirstReleases(game)) {
    const state = platformState(entry, today);
    if (state === 'unlisted') continue;
    if (!groups.has(state)) groups.set(state, []);
    groups.get(state).push(entry.platform);
  }
  return ['released', 'today', 'upcoming', 'undated'].filter(state => groups.has(state))
    .map(state => ({ state, platforms: groups.get(state) }));
}

export const releaseStateText = Object.freeze({
  released: '已發售', today: '今天發售', upcoming: '即將上市', undated: '日期未定', unlisted: '日期未收錄',
});
/** Why an unlisted version has no day here. */
export const unlistedReleaseNote = '雷達沒有這個版本的發售日：可能早已上市，或還沒公布';

/** "12/04", or "2025/02/28" when the year differs from the reference day. */
export function shortReleaseDay(date, reference) {
  if (!validDate(date)) return '';
  return date.slice(0, 4) === String(reference || '').slice(0, 4)
    ? date.slice(5).replace('-', '/') : date.replaceAll('-', '/');
}

/**
 * Other platforms in short phrases, platforms that share a day and state
 * together: "Steam、PS5 10/27 已上市"、"NS2 12/03 發售（全球日期）"、"PS5 日期未定".
 * A version with no release in the data is left to the game page, which can
 * say why; a short line would only add "unknown".
 */
export function otherPlatformPhrases(others, reference) {
  const groups = new Map();
  for (const entry of others || []) {
    if (entry.state === 'unlisted') continue;
    const marker = entry.state === 'upcoming' && entry.evidence && !entry.evidence.taiwan ? entry.evidence.label : '';
    const clock = entry.state === 'upcoming' ? entry.clock?.time || '' : '';
    const key = [entry.state, entry.date, clock, marker].join('|');
    if (!groups.has(key)) groups.set(key, { ...entry, clock, marker, platforms: [] });
    groups.get(key).platforms.push(entry.platform);
  }
  return [...groups.values()].map(group => {
    const names = group.platforms.join('、');
    const day = shortReleaseDay(group.date, reference);
    if (group.state === 'undated') return `${names} 日期未定`;
    if (group.state === 'released') return `${names} ${day} 已上市`;
    if (group.state === 'today') return `${names} 今天發售`;
    return `${names} ${day}${group.clock ? ` ${group.clock}` : ''} 發售${group.marker ? `（${group.marker}）` : ''}`;
  });
}
