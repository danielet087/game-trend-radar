import { normalizeBoundary } from '../../domain/index.mjs';
import { RadarDiscovery } from '../discovery/index.js';
import type { BoundaryInput, GameEntity } from '../../domain/contracts';
import type { CatalogAPI, CatalogDomainModel, CatalogGame, CatalogMode } from './types';
import { cardDate, NATIVE_PLATFORMS } from './selectors';

/** Provider JSON enters once; canonical evidence and legacy presentation have distinct roles. */
export function normalizeCatalog(input: BoundaryInput, mode: CatalogMode, discovery: CatalogAPI = RadarDiscovery) {
  const projection = normalizeBoundary(input);
  if (!projection) return { model: null, viewModel: null };
  const model: CatalogDomainModel = {
    entities: new Map(projection.entities.map(entity => [entity.id, entity])),
    versions: new Map(projection.entities.flatMap(entity => entity.versions.map(version => [version.id, version] as const))),
    releaseEvents: new Map(projection.releaseEvents.map(event => [event.id, event])),
  };
  const viewModel = ['all', 'explore'].includes(mode)
    ? discovery.enrich(projection.dataset, input.official, input.preview) : projection.dataset;
  return { model, viewModel };
}

export function catalogEntity(game: CatalogGame, model: CatalogDomainModel | null): GameEntity | null {
  return model?.entities.get(game.identityKey) || null;
}

/** Cards obtain dates from admitted, platform-scoped canonical release evidence. */
export function catalogCardDate(game: CatalogGame, domain: CatalogAPI, event: boolean,
  model: CatalogDomainModel | null): string {
  const entity = catalogEntity(game, model);
  if (!entity || !model) return cardDate(game, domain, event);
  const dates = entity.releaseEventIds.flatMap(id => {
    const release = model.releaseEvents.get(id);
    if (!release || !['Steam', ...NATIVE_PLATFORMS].includes(release.platform) ||
      !model.versions.has(release.versionId)) return [];
    if (event && (release.date !== game.date || !game.releasePlatforms.includes(release.platform))) return [];
    return [release.date];
  });
  return dates.sort()[0] || cardDate(game, domain, event);
}
