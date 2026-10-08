import { createApp, type App } from 'vue';
import SiteHeader from './components/SiteHeader.vue';
import SiteFooter from './components/SiteFooter.vue';
import { readSaved } from './state/favorites';
import { initializeMotion } from './state/motion';

const mounted = new Map<Element, App>();

/** Mount only the global shell; page content retains its own feature lifecycle. */
export function mountShell(page = document.body.dataset.page || 'home'): () => void {
  readSaved();
  initializeMotion();
  const apps: { target: Element; app: App }[] = [];
  for (const [id, component] of [['siteHeader', SiteHeader], ['siteFooter', SiteFooter]] as const) {
    const target = document.getElementById(id);
    if (!target || mounted.has(target)) continue;
    const app = createApp(component, { page });
    app.mount(target);
    mounted.set(target, app);
    apps.push({ target, app });
  }
  return () => {
    for (const { target, app } of apps) {
      app.unmount();
      mounted.delete(target);
    }
  };
}
