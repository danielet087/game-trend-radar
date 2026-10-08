import { RadarData } from '../../domain/index.mjs';
import { RadarStorage } from '../../data/storage.ts';
import { RadarDiscovery } from '../discovery/index.js';
import { RadarInsights } from './metrics.js';

export function createInsightsContext(options = {}) {
  const document = options.document || globalThis.document;
  const window = options.window || globalThis.window;
  const D = options.data || RadarData;
  const E = options.enhancements || window.RadarEnhancements;
  const compare = options.compare || window.RadarCompare;
  const params = new URLSearchParams(window.location.search);
  const number = new Intl.NumberFormat('zh-TW');
  const cleanup = [];
  const on = (target, event, callback) => {
    target.addEventListener(event, callback);
    cleanup.push(() => target.removeEventListener(event, callback));
  };
  return { document, window, location: window.location, D, E, compare, number, params, on,
    $: id => document.getElementById(id), node: E.make,
    R: options.discovery || RadarDiscovery, I: options.insights || RadarInsights,
    storage: options.storage || RadarStorage, today: options.today || D.todayInTaipei(),
    mode: document.body.dataset.page,
    signed: value => `${value > 0 ? '+' : ''}${number.format(value)}`,
    percent: value => value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`,
    dateText: value => value?.replaceAll('-', '/') || '—',
    statusText: status => ({ missing:'尚無有效量測', stale:'等待更新', accumulating:'歷史累積中' })[status] || '',
    state: { games:[], observations:new Map(), rawCatalog:null, growthData:null,
      span:[1,7,30].includes(Number(params.get('days'))) ? Number(params.get('days')) : 7,
      scope:['all','future','released'].includes(params.get('period')) ? params.get('period') : 'all',
      sort:params.get('sort') === 'percent' ? 'percent' : 'delta', limit:25, searchTimer:null,
      initialized:false, analysisGeneration:0, loadComparisonDescriptions:null },
    dispose() { cleanup.splice(0).forEach(dispose => dispose()); },
  };
}
