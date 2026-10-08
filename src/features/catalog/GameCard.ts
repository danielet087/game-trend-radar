import { createApp, defineComponent, h, onBeforeUnmount, onMounted, ref, type App, type PropType } from 'vue';
import { NATIVE_PLATFORMS } from './selectors';
import { catalogCardDate, catalogEntity } from './boundary';
import type { GameEntity } from '../../domain/contracts';
import type { CatalogAPI, CatalogDomainModel, CatalogGame, CatalogMode, TagFilters } from './types';

export interface CardOptions { eager?: boolean; priority?: boolean; event?: boolean }
export interface CardEnvironment {
  domain: CatalogAPI; discovery: CatalogAPI; mode: CatalogMode; today: string;
  model?: () => CatalogDomainModel | null;
  tags: () => TagFilters; isSaved: (game: CatalogGame, entity?: GameEntity | null) => boolean;
  subscribeSaved: (listener: () => void) => () => void;
  artwork: { load: (image: HTMLImageElement, game: CatalogGame, options: any) => void };
}

/** Shared Vue card for every catalog view, including platform-specific release events. */
export const GameCard = defineComponent({
  name: 'GameCard',
  props: {
    game: { type: Object as PropType<CatalogGame>, required: true },
    options: { type: Object as PropType<CardOptions>, default: () => ({}) },
    environment: { type: Object as PropType<CardEnvironment>, required: true },
  },
  setup(props) {
    const image = ref<HTMLImageElement | null>(null), loaded = ref(false), exhausted = ref(false);
    const savedRevision = ref(0);
    const unsubscribe = props.environment.subscribeSaved(() => savedRevision.value++);
    onBeforeUnmount(unsubscribe);
    onMounted(() => {
      if (image.value && props.game.art) props.environment.artwork.load(image.value, props.game, {
        onLoad: () => { loaded.value = true; },
        onExhausted: () => { exhausted.value = true; loaded.value = false; },
      });
    });
    return () => {
      const game = props.game, options = props.options, env = props.environment;
      const D = env.domain, R = env.discovery;
      void savedRevision.value;
      const display = D.releaseDisplayNames?.(game, game.releasePlatforms) || { name: game.name, nameEn: game.nameEn };
      const event = options.event ?? env.mode === 'date';
      const model = env.model?.() || null;
      const entity = catalogEntity(game, model);
      const displayedDate = catalogCardDate(game, D, event, model);
      const days = Math.round((Date.parse(displayedDate + 'T12:00:00Z') - Date.parse(env.today + 'T12:00:00Z')) / 86400000);
      const nativePlatforms = (game.releasePlatforms || []).filter(platform => NATIVE_PLATFORMS.includes(platform));
      const nativeEvent = event && nativePlatforms.length > 0 && !game.releasePlatforms?.includes('Steam');
      const nativeLanguages = nativeEvent || game.source === 'nintendo';
      const support = nativeEvent ? (D.nativeCardLanguages || D.nintendoCardLanguages)?.(game.platformLanguages || {}, nativePlatforms) ||
        { languageBadges: [{ label: '語言支援待確認', status: 'unknown', title: '此主機版本語言支援待確認' }] } : game;
      const nativeLabel = nativePlatforms.includes('PS5') ? nativePlatforms.length === 1 ? 'PS5' : '主機' : 'Nintendo';
      const multiplayer = D.cardMultiplayerBadge?.(game, event);
      const originalName = display.nameEn && display.nameEn !== display.name ? display.nameEn : '';
      const detailAttributes = { href: D.detailURL(game), 'aria-label': `查看 ${display.name} 的遊戲資訊` };
      const languages = [
        multiplayer ? h('span', { class: 'card-multiplayer', title: multiplayer.title, 'aria-label': `多人遊戲；${multiplayer.title}` }, multiplayer.label) : null,
        support.languageBadges?.length ? h('div', { class: 'card-language-badges' }, support.languageBadges.map((badge: any) =>
          h('span', { class: `card-language language-${badge.status}`, title: nativeLanguages ? badge.title || '此主機版本語言支援待確認' :
            'Steam 版本公布的遊戲語言支援；介面、字幕及配音的詳細項目請以商店為準' }, badge.label))) : null,
      ].filter(Boolean);
      const selected = env.tags().include;
      const tags = ['explore', 'all'].includes(env.mode) && game.tags?.length ? h('div', { class: 'explorer-card-tags' }, [...game.tags].sort((a, b) =>
        Number(selected.some(tag => R.key(tag) === R.key(b))) - Number(selected.some(tag => R.key(tag) === R.key(a))))
        .slice(0, 2).map(tag => h('span', { title: tag }, R.label(tag)))) : null;
      const metrics = [[game.followers, '人關注'], [game.hypes, 'IGDB hypes']].filter(([value]) => Number.isFinite(value));
      const merchant = nativeEvent && nativePlatforms.length === 1 ? game.platformLinks?.[nativePlatforms[0]] : null;
      const merchantURL = merchant && D.platformURL?.(merchant.url, nativePlatforms[0]);
      const storeGame = merchantURL ? { ...game, source: 'nintendo', link: merchantURL, linkLabel: merchant.label } : game;
      const storeName = game.source === 'nintendo' ? display.name : game.name;
      const badge = D.cardPlatformBadge(game), active = env.isSaved(game, entity);
      return h('article', { class: 'game-card', 'data-appid': game.appid, 'data-game-key': D.gameKey(game), 'data-source': game.source || 'steam' }, [
        h('div', { class: 'cover-link' }, [
          h('span', { class: 'cover-placeholder', 'aria-hidden': 'true', hidden: loaded.value }),
          game.art && !exhausted.value ? h('img', { ref: image, alt: '', loading: options.eager ? 'eager' : 'lazy', decoding: 'async',
            fetchpriority: options.priority ? 'high' : 'auto', width: 616, height: 288, class: loaded.value ? 'art-loaded' : '' }) : null,
          h('span', { class: ['countdown', days < 0 && 'released'] }, days === 0 ? '今日登場' : days > 0 ? `${days} 天後登場` : '已上市'),
        ]),
        h('div', { class: 'card-body' }, [
          h('a', { class: 'card-names', ...detailAttributes }, [
            h('h3', { class: 'card-title', title: display.name }, display.name),
            h('p', { class: 'card-english', title: originalName || undefined, 'aria-hidden': originalName ? undefined : 'true' }, originalName),
          ]), tags,
          game.darkHorse ? h('span', { class: 'dark-horse', title: '直接上市，並於發售首週內確認超過 3,000 人關注' }, '近期黑馬') : null,
          languages.length ? h('div', { class: 'card-languages', 'aria-label': nativeLanguages ? `${nativeLabel} 版本遊戲支援語言` : 'Steam 版本遊戲支援語言',
            title: !nativeLanguages && (game.hasNativePlatforms || game.hasNintendo) ? '此處標籤為 Steam 版本語言支援；主機各版本請進入遊戲頁查看' : undefined }, languages) : null,
          h('div', { class: 'card-meta' }, [
            h('div', { class: 'card-release-dates' }, [
              h('div', { class: 'card-release-date' }, [h('time', { datetime: displayedDate,
                title: event ? '本次平台發售日期' : '最早發售日期；各平台日期可於遊戲資訊查看' }, displayedDate.replaceAll('-', '/'))]),
              event && game.releasePlatforms?.length ? h('span', { class: 'card-release-platform', title: '本次發售的平台' }, game.releasePlatforms.join('／')) : null,
            ]),
            h('div', { class: 'card-interest' }, metrics.map(([value, label]) => h('span', { class: 'card-followers' }, [
              new Intl.NumberFormat('zh-TW').format(Number(value)), h('small', null, String(label)),
            ]))),
          ]),
          h('div', { class: 'card-footer' }, [
            h('div', { class: 'card-platforms', 'aria-label': '遊戲平台與獨佔狀態' }, [h('span', { class: 'platform-badge platform-' + badge.status, title: badge.title }, badge.label)]),
            h('div', { class: 'card-footer-right' }, [h('a', { class: 'steam-store-link', href: storeGame.link, target: '_blank', rel: 'noopener noreferrer',
              'aria-label': `在 ${storeGame.source === 'nintendo' ? storeGame.linkLabel : 'Steam'} 開啟 ${storeName}（另開分頁）` }, [
              storeGame.source === 'nintendo' ? storeGame.linkLabel : 'Steam 商店', h('span', { 'aria-hidden': 'true' }, '↗'),
            ])]),
          ]),
        ]),
        h('a', { class: 'card-detail-link', tabindex: -1, ...detailAttributes }),
        h('button', { class: 'save-button', type: 'button', 'data-save': game.appid, 'data-name': display.name,
          'aria-label': `${active ? '取消收藏' : '收藏'} ${display.name}`, 'aria-pressed': String(active), title: active ? '取消收藏' : '加入我的收藏' }, [
          h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [h('path', { d: 'M20.8 4.8a5.6 5.6 0 0 0-7.9 0L12 5.7l-.9-.9a5.6 5.6 0 0 0-7.9 7.9L12 21l8.8-8.3a5.6 5.6 0 0 0 0-7.9Z' })]),
        ]),
      ]);
    };
  },
});

/** Incremental Vue mounting keeps existing grid DOM and returns the real article. */
export function createCardFactory(environment: CardEnvironment) {
  const games = new WeakMap<Element, CatalogGame>(), applications = new Map<HTMLElement, App>();
  return {
    create(game: CatalogGame, options: CardOptions = {}) {
      const host = document.createElement('div');
      const app = createApp(GameCard, { game, options, environment });
      app.mount(host);
      const card = host.firstElementChild as HTMLElement;
      games.set(card, game); applications.set(card, app);
      return card;
    },
    gameFor: (card: Element | null | undefined) => card ? games.get(card) : undefined,
    dispose(card: HTMLElement) { applications.get(card)?.unmount(); applications.delete(card); },
    disposeAll() { for (const app of applications.values()) app.unmount(); applications.clear(); },
  };
}
