import { forRegion, viewOf } from './audience-region.js';

export const regionsFor = mode => mode === 'compare' ? ['global', 'zh'] : [viewOf(mode)];
export const projectRows = (rows, region) => rows.map(row => forRegion(row, region));
