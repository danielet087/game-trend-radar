import { awareTime, validDate, todayInTaipei } from '../domain/dates.mjs';
import { decimalID } from '../domain/identity.mjs';
import { nativePlatformIDs } from '../domain/constants.mjs';
import { releaseDisplayNames } from '../domain/editions.mjs';
import { unknownMultiplayer } from '../domain/multiplayer.mjs';
import { datasets, latestSourceUpdate } from './datasets.mjs';

const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const timestamp = value => awareTime(value) === null ? null : value;
const list = value => Array.isArray(value) ? value.filter(object) : [];

// JSON is an external boundary: malformed collections do not reach adapters.
// Admission rules remain in the provider adapters, shared by every page.
function publicPayload(value) {
  if (!object(value) || !Array.isArray(value.games)) return null;
  return {
    ...value,
    games: list(value.games),
    ...(value.recent_games == null ? {} : { recent_games: list(value.recent_games) }),
  };
}

function provenance(provider, dataset, payload, raw, sourceUrl = null, checkedAt = null) {
  return {
    provider, dataset,
    datasetUpdatedAt: latestSourceUpdate(payload?.generated_at, payload?.updated_at),
    checkedAt: timestamp(checkedAt) || timestamp(raw?.checked_at),
    sourceUrl: sourceUrl || null,
  };
}

function observation(kind, provider, providerId, value, source) {
  const known = typeof value === 'number' && Number.isFinite(value) && value >= 0;
  return { kind, provider, providerId: String(providerId), value: known ? value : null,
    status: known ? 'observed' : 'unknown', provenance: source };
}

function sourceIndex(official, preview, native) {
  const steam = new Map();
  for (const raw of list(preview?.recent_games)) {
    if (decimalID(raw.appid)) steam.set(Number(raw.appid), { raw, payload: preview, dataset: 'preview' });
  }
  const chosen = official || preview;
  for (const raw of list(chosen?.games)) {
    if (decimalID(raw.appid)) steam.set(Number(raw.appid), {
      raw, payload: chosen, dataset: official ? 'official' : 'preview',
    });
  }
  const consoles = new Map();
  for (const raw of list(native?.games)) {
    if (decimalID(raw.igdb_id)) consoles.set(Number(raw.igdb_id), { raw, payload: native, dataset: 'native' });
  }
  return { steam, consoles };
}

function releaseKey(gameId, release) {
  return `${gameId}:${release.platform}:${release.date}:${release.region || ''}`;
}

function versionSource(row, platform, sources) {
  if (platform === 'Steam') return sources.steam.get(row.steamAppid || row.appid) || null;
  const ids = row.igdbIds || (row.igdbId ? [row.igdbId] : []);
  return ids.map(id => sources.consoles.get(id)).find(entry =>
    entry?.raw.platforms?.some(value => value?.code === platform && Number(value.id) === nativePlatformIDs[platform])) || null;
}

function languageSupport(row, platform) {
  if (platform !== 'Steam') return row.platformLanguages[platform];
  const raw = row.languages || {};
  const languages = { ...raw, tchinese: raw.tchinese ?? null,
    schinese: raw.schinese ?? null, english: raw.english ?? null };
  // Keep unknown Steam language support unknown; title localization is not proof.
  return { status: Object.keys(raw).length ? 'confirmed' : 'unknown', region: null,
    languages, languageBadges: row.languageBadges };
}

function projectVersion(row, platform, gameId, entry) {
  const provider = platform === 'Steam' ? 'Steam' : 'IGDB';
  const edition = row.platformEditions?.[platform] || null;
  const support = languageSupport(row, platform);
  const names = releaseDisplayNames(row, [platform]);
  const link = platform === 'Steam' ? { url: row.steamLink || row.link, label: 'Steam 商店' }
    : row.platformLinks?.[platform] || null;
  return {
    id: `${gameId}:${platform}`, gameId, platform,
    title: names.name, englishTitle: names.nameEn,
    storefront: link ? { ...link, region: edition?.region || support.region || null } : null,
    edition, languageSupport: support,
    multiplayer: row.platformMultiplayer?.[platform] || unknownMultiplayer(provider),
    provenance: provenance(provider, entry?.dataset || (platform === 'Steam' ? 'official' : 'native'),
      entry?.payload, entry?.raw, link?.url || null,
      platform === 'Steam' ? entry?.raw?.categories_checked_at : entry?.raw?.checked_at),
  };
}

function projectRelease(row, release, gameId, entry, visibility) {
  const steam = release.platform === 'Steam';
  const raw = entry?.raw || {};
  const audited = steam ? {
    ...release,
    ...Object.fromEntries(Object.entries(raw).filter(([field]) => field.startsWith('release_'))),
  } : { ...release };
  const instant = timestamp(steam ? raw.release_time_utc : release.official_release_time_utc);
  const originalTimestamp = Number.isSafeInteger(release.source_timestamp) && release.source_timestamp >= 0
    ? release.source_timestamp : null;
  const sourceUrl = steam ? row.steamLink || row.link : release.official_source_url || null;
  return {
    id: releaseKey(gameId, release), gameId, versionId: `${gameId}:${release.platform}`,
    platform: release.platform, date: release.date, precision: 'day',
    sourceRegion: release.source_region || release.region || null,
    source: release.source || (steam ? 'Steam' : 'IGDB'),
    dateBasis: release.date_basis || (steam ? raw.release_date_normalization || null : null),
    timeZone: release.time_zone === 'Asia/Taipei' || steam && raw.release_date_timezone === 'Asia/Taipei'
      ? 'Asia/Taipei' : null,
    timestamp: instant, sourceTimestamp: originalTimestamp,
    sourceDate: validDate(release.source_date) ? release.source_date : null,
    timestampTaipeiDate: validDate(release.timestamp_taipei_date) ? release.timestamp_taipei_date
      : validDate(raw.release_timestamp_taipei_date) ? raw.release_timestamp_taipei_date
        : instant ? todayInTaipei(new Date(instant)) : null,
    taiwanConfirmed: typeof release.taiwan_release_confirmed === 'boolean' ? release.taiwan_release_confirmed : null,
    visibility,
    provenance: provenance(steam ? 'Steam' : 'IGDB', entry?.dataset || (steam ? 'official' : 'native'),
      entry?.payload, raw, sourceUrl, steam ? raw.release_date_verified_at : release.official_verified_at),
    audit: audited,
  };
}

/**
 * Project admitted provider rows into explicit identity, version and event models.
 * Existing JSON contracts and presentation dataset behavior are unchanged.
 * @param {import('../domain/contracts').BoundaryInput} [input]
 * @returns {import('../domain/contracts').BoundaryProjection | null}
 */
export function normalizeBoundary(input = {}) {
  const official = publicPayload(input.official);
  const preview = publicPayload(input.preview);
  const native = publicPayload(input.native);
  const dataset = datasets(official, preview, native);
  if (!dataset) return null;
  const sources = sourceIndex(official, preview, native);
  const groups = new Map();
  const visibility = new Map();
  for (const scope of ['games', 'recent']) {
    for (const row of dataset[scope]) {
      const gameId = row.identityKey;
      if (!groups.has(gameId)) groups.set(gameId, []);
      groups.get(gameId).push(row);
      for (const release of row.dateReleases) {
        const key = releaseKey(gameId, release);
        if (!visibility.has(key)) visibility.set(key, { games: false, recent: false });
        visibility.get(key)[scope] = true;
      }
    }
  }
  const entities = [], events = new Map();
  for (const [gameId, rows] of groups) {
    const row = rows[0];
    const platforms = [...new Set(rows.flatMap(value => value.platforms))];
    const versions = platforms.map(platform => projectVersion(row, platform, gameId, versionSource(row, platform, sources)));
    const metrics = [];
    if (platforms.includes('Steam')) {
      const appid = row.steamAppid || row.appid;
      const entry = sources.steam.get(appid);
      const source = provenance('Steam', entry?.dataset || 'official', entry?.payload,
        entry?.raw, row.steamLink || row.link, entry?.raw?.follower_checked_at);
      metrics.push(observation('followers', 'Steam', appid, row.followers, source));
      const proof = row.twitchAdmission;
      if (proof) metrics.push(observation('viewers', 'Twitch', proof.twitch_game_id,
        proof.source_enrollment.viewer_count, provenance('Twitch', source.dataset,
          entry?.payload, null, null, proof.source_enrollment.observed_at)));
    }
    const igdbIds = [...new Set(rows.flatMap(value => value.igdbIds || (value.igdbId ? [value.igdbId] : [])))];
    for (const id of igdbIds) {
      const entry = sources.consoles.get(id);
      metrics.push(observation('hypes', 'IGDB', id, entry?.raw?.hypes,
        provenance('IGDB', 'native', entry?.payload, entry?.raw)));
    }
    const releaseEventIds = [];
    for (const release of rows.flatMap(value => value.releases)) {
      const key = releaseKey(gameId, release);
      if (!events.has(key)) events.set(key, projectRelease(row, release, gameId,
        versionSource(row, release.platform, sources), visibility.get(key) || { games: false, recent: false }));
      if (!releaseEventIds.includes(key)) releaseEventIds.push(key);
    }
    entities.push({
      id: gameId,
      identity: {
        steamAppid: platforms.includes('Steam') ? row.steamAppid || row.appid : row.steamAppid || null,
        igdbIds,
        twitchGameIds: row.twitchAdmission ? [String(row.twitchAdmission.twitch_game_id)] : [],
        savedAliases: [...new Set(rows.flatMap(value => value.savedAliases || []))],
      },
      names: { display: row.name, english: row.nameEn, traditional: row.nameTw,
        simplifiedConverted: row.nameCn, originalTraditional: row.nameOriginalTw || '',
        originalSimplified: row.nameOriginalCn || '',
        searchAliases: [...new Set(rows.flatMap(value => value.nameSearchAliases || []))] },
      versions, releaseEventIds, metrics,
      artwork: { primary: row.art, fallbacks: row.artSources },
      sources: versions.map(version => version.provenance),
    });
  }
  return {
    dataset, entities, releaseEvents: [...events.values()],
    sourceUpdates: { steam: dataset.steamUpdated, native: dataset.nintendoUpdated, latest: dataset.updated },
  };
}
