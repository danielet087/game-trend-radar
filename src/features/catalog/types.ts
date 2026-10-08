import type { GameEntity, GameId, PlatformVersion, ReleaseEvent, LegacyGame, LegacyDataset } from '../../domain/contracts';
/** The catalog consumes the normalized domain model, never raw provider JSON. */
export type CatalogMode = 'home' | 'all' | 'upcoming' | 'released' | 'date' | 'explore' | 'saved';
/** Providers expose both helpers and immutable platform lookup constants. */
export type CatalogAPI = Record<string, any>;
export type CatalogGame = LegacyGame;
export type CatalogDataset = LegacyDataset;
export interface TagFilters { include: string[]; exclude: string[]; match: 'all' | 'any' }
export interface FilterValues {
  term: string;
  minimum: string;
  sort: string;
  period: string;
  language: string;
  savedOnly: boolean;
  tags: TagFilters;
  month: string;
  view: 'calendar' | 'list';
  date: string | null;
}
/** Canonical identity and evidence; presentation rows only live in viewModel. */
export interface CatalogDomainModel {
  entities: ReadonlyMap<GameId, GameEntity>;
  versions: ReadonlyMap<string, PlatformVersion>;
  releaseEvents: ReadonlyMap<string, ReleaseEvent>;
}
export interface CatalogState {
  model: CatalogDomainModel | null;
  viewModel: CatalogDataset | null;
  loading: boolean;
  limit: number;
}
