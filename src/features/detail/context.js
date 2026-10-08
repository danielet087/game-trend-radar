import { RadarData } from '../../domain/index.mjs';
import { RadarStorage } from '../../data/storage.ts';
import { RadarDiscovery } from '../discovery/index.js';

export function parseDetailRoute(search) {
  const query = new URLSearchParams(search);
  const positiveId = value => /^[1-9][0-9]{0,9}$/.test(value || '') ? Number(value) : null;
  return { appid: positiveId(query.get('appid')), igdbId: positiveId(query.get('igdb')),
    nintendoRoute: query.has('igdb'), requestedDate: query.get('date') };
}

export function createDetailContext(options = {}) {
  const document = options.document || globalThis.document;
  const window = options.window || globalThis.window;
  const D = options.data || RadarData;
  const node = (tag, className = '', text = null) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== null) element.textContent = text;
    return element;
  };
  const isNativeConsole = game => game?.source === 'nintendo';
  const number = new Intl.NumberFormat('zh-TW');
  const cleanup = [];
  const on = (target, event, callback) => {
    target.addEventListener(event, callback);
    cleanup.push(() => target.removeEventListener(event, callback));
  };
  return {
    document, window, location: options.location || window.location, node, on,
    $: id => document.getElementById(id), D, R: options.discovery || RadarDiscovery,
    storage: options.storage || RadarStorage, number, isNativeConsole,
    today: options.today || D.todayInTaipei(),
    enhancements: options.enhancements || window.RadarEnhancements,
    motion: options.motion || window.RadarMotion,
    ...parseDetailRoute((options.location || window.location).search),
    interestText: game => isNativeConsole(game)
      ? Number.isSafeInteger(game.hypes) ? `IGDB hypes ${number.format(game.hypes)}` : 'IGDB hypes 未知'
      : `${number.format(game.followers)} 人關注`,
    detailURL: game => D.detailURL(game),
    state: { currentGame: null, candidates: [], knownGames: [], tagsExpanded: false,
      selectedTag: '', recommendationsReady: false },
    dispose() { cleanup.splice(0).forEach(dispose => dispose()); },
  };
}
