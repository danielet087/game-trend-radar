import { createDetailContext } from './context.js';
import { createReleasePolicy } from './release-policy.js';
import { createReleasePresenter } from './release.js';
import { createDetailFavorites } from './favorites.js';
import { createDetailArtwork } from './artwork.js';
import { createDetailMetadata } from './metadata.js';
import { createRelatedGames } from './related.js';
import { createDetailRenderer } from './render.js';
import { createDetailLoader } from './load.js';

const controllers = new WeakMap();
/** Initializes once per detail page and returns its explicit lifecycle. */
export function initGameDetail(options = {}) {
  const ctx = createDetailContext(options);
  const host = ctx.$('detailPage');
  if (!host) return null;
  controllers.get(host)?.destroy();
  const policy = createReleasePolicy(ctx);
  const release = createReleasePresenter(ctx, policy);
  const favorites = createDetailFavorites(ctx);
  const artwork = createDetailArtwork(ctx);
  const metadata = createDetailMetadata(ctx, policy);
  const related = createRelatedGames(ctx);
  const render = createDetailRenderer(ctx, policy, release, metadata, artwork, favorites, related);
  const loader = createDetailLoader(ctx, render, favorites, related);
  ctx.on(ctx.$('detailRetry'), 'click', async () => {
    ctx.$('detailRetry').disabled = true;
    ctx.$('detailStatusTitle').textContent = '正在重新讀取…';
    try { await loader.load(true); }
    finally { if (!ctx.disposed) ctx.$('detailRetry').disabled = false; }
  });
  const controller = {
    ready: loader.load(),
    reload: () => loader.load(true),
    destroy() {
      ctx.disposed = true;
      related.destroy(); artwork.destroy(); favorites.destroy(); ctx.dispose();
      controllers.delete(host);
    },
  };
  controllers.set(host, controller);
  return controller;
}
export { createReleasePolicy } from './release-policy.js';
export { parseDetailRoute } from './context.js';
