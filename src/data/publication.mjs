import { decimalID } from '../domain/identity.mjs';

const object = value => !!value && typeof value === 'object' && !Array.isArray(value);

// These fields enrich the detail view without changing catalog membership,
// release dates, follower admission, platform evidence or language evidence.
const detailFields = new Set([
  'short_description', 'short_description_en', 'short_description_language',
  'short_description_source', 'description_checked_at', 'detailed_description',
  'about_the_game', 'screenshots', 'movies', 'videos', 'developers', 'publishers',
  'pc_requirements', 'mac_requirements', 'linux_requirements', 'support_info',
  'header_image', 'header_image_2x', 'main_capsule_image', 'main_capsule_image_2x',
  'small_capsule_image', 'capsule_image', 'artwork_checked_at',
]);

export function publicationRevision(value) {
  if (!object(value)) return null;
  const candidate = value.revision ?? value.catalog_revision;
  return typeof candidate === 'string' && candidate.trim() ? candidate : null;
}

/** Missing revisions mean unknown consistency, never proof of a match. */
export function knownPublicationConflict(catalog, record) {
  const expected = publicationRevision(catalog);
  const actual = publicationRevision(record);
  return !!expected && !!actual && expected !== actual;
}

/**
 * Catalog membership and its complete row are authoritative once available.
 * Per-AppID files may supplement descriptions/media, including when their
 * publication revision is unknown. They cannot restore removed games or
 * supply missing qualification/date proof from a different public copy.
 * generated_at values are intentionally not used as cross-file revisions.
 */
export function detailCatalog(catalog, rawGame, appid) {
  const id = decimalID(appid);
  const recordId = decimalID(rawGame?.appid);
  const raw = object(rawGame) && id !== null && id === recordId && Number.isSafeInteger(Number(id))
    ? rawGame : null;
  if (!object(catalog) || !Array.isArray(catalog.games)) {
    if (!raw) return null;
    return {
      generated_at: raw.content_enriched_at || raw.follower_checked_at || null,
      games: [{ ...raw }],
    };
  }
  if (!raw || knownPublicationConflict(catalog, raw)) return catalog;
  const index = catalog.games.findIndex(row => decimalID(row?.appid) === id);
  if (index < 0) return catalog;
  const supplements = Object.fromEntries(Object.entries(raw).filter(([field]) => detailFields.has(field)));
  const games = [...catalog.games];
  games[index] = { ...supplements, ...catalog.games[index] };
  return { ...catalog, games };
}
