import { forRegion, viewOf } from './audience-region.js';

export const scopeKeys = { summary: 'summary_region', history: 'history_region', cooldown: 'cooldown_region', statistics: 'statistics_region' };
export const regionsFor = mode => mode === 'compare' ? ['global', 'zh'] : [viewOf(mode)];
export const projectRows = (rows, region) => rows.map(row => forRegion(row, region));
export function blockScopes(params) {
  const specific = Object.values(scopeKeys).some(key => params.has(key));
  const back = new URLSearchParams(params.get('back') || '');
  const legacy = specific ? 'global' : viewOf(params.get('region') || back.get('archive_region') || back.get('region'));
  return Object.fromEntries(Object.entries(scopeKeys).map(([block, key]) => [block, viewOf(params.get(key) ?? legacy)]));
}
export function writeBlockScopes(params, scopes) {
  params.delete('region');
  for (const [block, key] of Object.entries(scopeKeys)) {
    const value = viewOf(scopes[block]);
    if (value === 'global' && block !== 'history') params.delete(key); else params.set(key, value);
  }
}
