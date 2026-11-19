import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Every public page: no visible text under 12px, and no visible control or link
// smaller than 24×24 (WCAG 2.2 AA target size). A link whose ::after stretches
// over its row counts the row. The scheduler is an internal page with a dense
// timeline of status dots and is not covered here.
const DATA = 'tests/fixtures/site-data';
const frozenAt = new Date(JSON.parse(readFileSync(resolve(DATA, 'catalog.json'), 'utf8')).generated_at);
const pages = ['index.html', 'games.html', 'upcoming.html', 'released.html', 'explore.html', 'growth.html', 'analysis.html',
  'saved.html', 'date.html?date=2026-11-20', 'game.html?appid=2638890', 'twitch.html', 'stream-planning.html'];

async function problems(page: Page) {
  return page.evaluate(() => {
    const visible = (element: Element) => element.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const small = [...document.querySelectorAll('body *')].filter(element => {
      const text = [...element.childNodes].some(node => node.nodeType === 3 && node.textContent!.trim());
      return text && visible(element) && parseFloat(getComputedStyle(element).fontSize) < 12;
    }).map(element => `${element.tagName}.${element.className} ${getComputedStyle(element).fontSize}`);
    const area = (element: Element) => {
      const after = getComputedStyle(element, '::after');
      if (after.content !== 'none' && after.position === 'absolute') {
        let host = element.parentElement;
        while (host && getComputedStyle(host).position === 'static') host = host.parentElement;
        if (host) return host.getBoundingClientRect();
      }
      return element.getBoundingClientRect();
    };
    const tiny = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, summary')]
      .filter(element => {
        if (!visible(element)) return false;
        const box = area(element);
        return box.width > 0 && (box.width < 24 || box.height < 24);
      })
      .map(element => {
        const box = area(element);
        return `${element.tagName}.${element.className} ${Math.round(box.width)}x${Math.round(box.height)} ${element.textContent!.trim().slice(0, 20)}`;
      });
    return { small, tiny };
  });
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: frozenAt });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

for (const path of pages) {
  test(`${path}: text is at least 12px and targets at least 24×24 on desktop and phone`, async ({ page }) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const found = await problems(page);
      expect(found.small, `${path} at ${width}px`).toEqual([]);
      expect(found.tiny, `${path} at ${width}px`).toEqual([]);
    }
  });
}
