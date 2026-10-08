import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';

const pages = ['index', 'games', 'upcoming', 'released', 'saved', 'date', 'explore', 'game', 'growth', 'analysis', 'twitch', 'scheduler', 'discover'];
const root = resolve(import.meta.dirname, 'src/pages');

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
        cpSync(resolve(import.meta.dirname, 'data'), resolve(output, 'data'), { recursive: true });
        writeFileSync(resolve(output, '.nojekyll'), '');
      },
      configureServer(server) {
        // Data stays at its existing publication path, outside the source tree.
        server.middlewares.use('/game-trend-radar/data', async (req, res, next) => {
          const { default: sirv } = await import('sirv');
          sirv(resolve(import.meta.dirname, 'data'), { dev: true })(req, res, next);
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
