import { count } from './metrics.js';
import { dateStart } from './series.js';

// A game can launch twice: Early Access, when everyone can already play, and
// the full release, which may come years later. The Twitch backend publishes
// both days as `launches` in the series index (Steam's record first, then
// IGDB's); each launch has its own tracking window and launch rules.

function day(value) {
  return value && typeof value === 'object' && Number.isFinite(dateStart(value.date)) ? value : null;
}

/** Both launches of an Early Access game, or null for a single launch. */
export function gameLaunches(record) {
  const earlyAccess = day(record?.launches?.early_access);
  if (!earlyAccess) return null;
  const full = day(record.launches.full_release);
  return { earlyAccess, fullRelease: full && dateStart(full.date) > dateStart(earlyAccess.date) ? full : null };
}

/**
 * The launch the launch rules count from at `asOf`: the full release once its
 * day has begun, otherwise the Early Access start, otherwise the release
 * reference. Keeps the reference's own fields (its Steam app) when it is that
 * same day, so Steam's release time still applies.
 */
export function currentLaunch(record, asOf) {
  const reference = record?.release_reference?.precision === 'day'
    && Number.isFinite(dateStart(record.release_reference.date)) ? record.release_reference : null;
  const launches = gameLaunches(record);
  if (!launches) return reference ? { ...reference, kind: 'release' } : null;
  const full = launches.fullRelease;
  const chosen = full && dateStart(full.date) <= asOf ? [full, 'full_release'] : [launches.earlyAccess, 'early_access'];
  const [launch, kind] = chosen;
  const base = reference?.date === launch.date ? reference
    : { date: launch.date, precision: 'day', source: launch.source, source_type: launch.source_type };
  return { ...base, kind };
}

const slash = date => date.replaceAll('-', '/');

/** "搶先體驗 2026/09/10 · 正式上市 2027/06/01", with where `date` falls. */
export function launchLine(record, date) {
  const launches = gameLaunches(record);
  if (!launches) return null;
  const { earlyAccess, fullRelease } = launches, at = dateStart(date);
  const parts = [`搶先體驗 ${slash(earlyAccess.date)}`,
    fullRelease ? `正式上市 ${slash(fullRelease.date)}` : '正式上市日未定'];
  if (at < dateStart(earlyAccess.date)) parts.push('還沒上市');
  else if (!fullRelease || at < dateStart(fullRelease.date)) parts.push('搶先體驗中');
  return parts.join(' · ');
}

/**
 * After the full release: its highest hour against the highest hour recorded
 * during Early Access, to see whether the full release made a new peak.
 */
export function launchPeaks(rows, record, asOf) {
  const launches = gameLaunches(record), full = launches?.fullRelease;
  const fullAt = full ? dateStart(full.date) : NaN;
  if (!(fullAt <= asOf)) return null;
  const startAt = dateStart(launches.earlyAccess.date);
  let earlyAccess = null, fullRelease = null;
  for (const row of rows || []) {
    const at = Date.parse(row?.hour), value = count(row?.viewer_count);
    if (row?.status !== 'observed' || value === null || !(at <= asOf) || at < startAt) continue;
    if (at < fullAt) earlyAccess = Math.max(earlyAccess ?? 0, value);
    else fullRelease = Math.max(fullRelease ?? 0, value);
  }
  if (earlyAccess === null || fullRelease === null) return null;
  return { earlyAccess, fullRelease, ratio: earlyAccess > 0 ? fullRelease / earlyAccess : null,
    newPeak: fullRelease > earlyAccess };
}

const fmt = value => new Intl.NumberFormat('zh-TW').format(value);

/** One line for the full release's peak against Early Access. */
export function launchPeakText(peaks) {
  if (!peaks) return null;
  const { earlyAccess, fullRelease, ratio } = peaks;
  const against = `搶先體驗時最高 ${fmt(earlyAccess)} 人`;
  const text = ratio === null ? `正式上市後最高 ${fmt(fullRelease)} 人；${against}。`
    : ratio >= 1.05 ? `正式上市後最高 ${fmt(fullRelease)} 人，是${against}的 ${ratio.toFixed(1)} 倍。`
      : ratio <= 0.95 ? `正式上市後最高 ${fmt(fullRelease)} 人，比${against}少 ${Math.round((1 - ratio) * 100)}%。`
        : `正式上市後最高 ${fmt(fullRelease)} 人，跟${against}差不多。`;
  return { label: peaks.newPeak ? '正式上市新高峰' : '正式上市沒有新高峰', text };
}

/** Why a game is not recorded now, and when it resumes, for a waiting game. */
export function waitingText(record) {
  const resumes = Date.parse(record?.tracking_resumes_at);
  const when = Number.isFinite(resumes) ? `，${slash(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(resumes))} 起恢復每小時記錄` : '';
  if (record?.tracking_reason === 'awaiting_full_release') return `等正式上市${when || '；查到正式上市日會在前 14 天恢復記錄'}`;
  if (record?.tracking_reason === 'awaiting_launch' || record?.tracking_reason === 'steam_not_released') {
    return `等下一次上市${when || '；查到確切上市日會在前 14 天恢復記錄'}`;
  }
  return null;
}
