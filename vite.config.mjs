import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';

const pages = ['index', 'games', 'upcoming', 'released', 'saved', 'date', 'explore', 'game', 'growth', 'analysis', 'twitch', 'stream-planning', 'twitch-game', 'scheduler', 'discover'];
const root = resolve(import.meta.dirname, 'src/pages');
// The deploy puts the real data into the published site, so a build needs data
// only for preview and tests. RADAR_SITE_DATA picks the folder (the tests use
// the fixed set in tests/fixtures/site-data); otherwise data/ when present.
const fixtures = 'tests/fixtures/site-data';
const siteData = () => resolve(import.meta.dirname, process.env.RADAR_SITE_DATA ||
  (existsSync(resolve(import.meta.dirname, 'data')) ? 'data' : fixtures));

export default defineConfig({
  root,
  base: '/game-trend-radar/',
  plugins: [
    vue(),
    {
      name: 'public-data-snapshot',
      closeBundle() {
        const output = resolve(import.meta.dirname, 'dist');
        mkdirSync(output, { recursive: true });
        if (existsSync(siteData())) cpSync(siteData(), resolve(output, 'data'), { recursive: true });
        writeFileSync(resolve(output, '.nojekyll'), '');
      },
      configureServer(server) {
        // Data stays at its existing publication path, outside the source tree.
        server.middlewares.use('/game-trend-radar/data', async (req, res, next) => {
          const { default: sirv } = await import('sirv');
          sirv(siteData(), { dev: true })(req, res, next);
        });
      },
      configurePreviewServer(server) {
        // A preview serves the chosen data folder, whatever the build copied.
        if (!process.env.RADAR_SITE_DATA) return;
        server.middlewares.use('/game-trend-radar/data', async (req, res, next) => {
          const { default: sirv } = await import('sirv');
          sirv(siteData(), { dev: true })(req, res, next);
        });
      }
    }
  ],
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    assetsDir: 'assets/app',
    sourcemap: false,
    rolldownOptions: {
      input: Object.fromEntries(pages.map(page => [page, resolve(root, page + '.html')]))
    }
  }
});
