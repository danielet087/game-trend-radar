import { nextTick } from 'vue';
import { RadarData } from '../domain/index.mjs';
import { RadarStorage } from '../data/storage.ts';
import { RadarDiscovery } from '../features/discovery/index.js';
import { RadarInsights } from '../features/insights/metrics.js';
import { RadarArtwork } from '../shared/artwork.js';
import { mountShell } from '../shared/mount-shell.ts';
import { initInteractions } from '../shared/interactions/index.js';
import '../shared/styles/index.css';
import radarMark from '../../assets/radar-mark.svg';

export type RadarPage = 'home' | 'all' | 'upcoming' | 'released' | 'saved' | 'date' | 'explore' | 'game' | 'growth' | 'analysis' | 'twitch' | 'scheduler';

// A single compatibility boundary supports the existing native SVG/lifecycle
// renderers while new feature code imports its dependencies explicitly.
function installBoundary(apis: Record<string, unknown>) {
  Object.assign(window, apis);
}

export async function bootstrap(page: RadarPage) {
  const favicon = document.getElementById('siteFavicon') as HTMLLinkElement | null;
  if (favicon) favicon.href = radarMark;
  installBoundary({ RadarData, RadarStorage, RadarDiscovery, RadarInsights, RadarArtwork });
  mountShell(page);
  await nextTick();
  const motion = (window as unknown as { RadarMotion: { enabled: boolean } }).RadarMotion;
  let interactions;
  if (!['twitch', 'scheduler'].includes(page)) {
    interactions = initInteractions({ insights: RadarInsights, storage: RadarStorage, motion });
    installBoundary(interactions);
  }
  if (['home', 'all', 'upcoming', 'released', 'saved', 'date', 'explore'].includes(page)) {
    const { initCatalogPage } = await import('../features/catalog/index.ts');
    return initCatalogPage({ data: RadarData, discovery: RadarDiscovery, storage: RadarStorage });
  }
  if (page === 'game') {
    const { initGameDetail } = await import('../features/detail/index.js');
    return initGameDetail({ data: RadarData, discovery: RadarDiscovery, storage: RadarStorage, enhancements: interactions?.RadarEnhancements, compare: interactions?.RadarCompare });
  }
  if (page === 'growth' || page === 'analysis') {
    const { initInsightsPage } = await import('../features/insights/index.js');
    return initInsightsPage({ enhancements: interactions?.RadarEnhancements, compare: interactions?.RadarCompare });
  }
  if (page === 'twitch') {
    const { initTwitchPage } = await import('../features/twitch/index.js');
    return initTwitchPage();
  }
  const { initSchedulerPage } = await import('../features/scheduler/index.js');
  return initSchedulerPage();
}
