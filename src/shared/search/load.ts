// Loaded only when someone opens the site search: the same published files,
// read the same way, as the 全部遊戲 page, so both find the same games.
import { RadarStorage } from '../../data/storage.ts';
import { RadarData } from '../../domain/index.mjs';
import { RadarDiscovery } from '../../features/discovery/index.js';
import { catalogCardDate, normalizeCatalog } from '../../features/catalog/boundary.ts';
import { buildIndex, type SearchIndex } from './match.ts';

let pending: Promise<SearchIndex> | null = null;

export function loadSearchIndex(): Promise<SearchIndex> {
  pending ??= (async () => {
    const [sources, native] = await Promise.all([
      RadarStorage.loadSources(),
      // Console games are optional: Steam games stay searchable without them.
      Promise.resolve(RadarStorage.loadNintendo()).catch(() => null),
    ]);
    const { catalog: official, preview } = sources as any;
    const references = (sources as any).references ?? null;
    const R = RadarDiscovery as any, D = RadarData as any;
    const { model, viewModel } = normalizeCatalog({ official, preview, native, references } as any, 'all', R);
    if (!viewModel) throw new Error('Search data unavailable');
    return buildIndex(viewModel, D, R, D.todayInTaipei(), (game: any) => catalogCardDate(game, D, false, model));
  })().catch(error => { pending = null; throw error; });
  return pending;
}
