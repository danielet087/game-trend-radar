// Play modes and highlight TAGs shared by 平台版本 and the fixed-format facts of the info card.
import { deckText, ratingText } from './store.js';

const PLAY_MODE_TAGS = new Set(['singleplayer', 'multiplayer']);

export function playModes(game) {
  return (game.platforms || []).flatMap(platform => {
    const mode = game.platformMultiplayer?.[platform];
    if (!mode || mode.status === 'unknown') return [];
    const text = mode.status === 'single' ? '單人'
      : mode.modes?.length && (mode.source === 'Steam' || mode.scope === 'game') ? mode.modes.join('、') : '多人';
    return [{ platform, text, source: mode.source }];
  });
}

export function highlightTags(game, R, limit = 6) {
  const genres = new Set((game.genres || []).map(R.key));
  return (game.tags || []).filter(tag => !genres.has(R.key(tag)) && !PLAY_MODE_TAGS.has(R.key(tag))).slice(0, limit);
}

// A name counts as Chinese only when it carries Han characters; an English
// store name is never labelled 中文名稱.
export const hasChineseName = name => /[\u3400-\u9fff\uf900-\ufaff]/.test(String(name || ''));

export function createDetailOverview(ctx) {
  const { $, node, R } = ctx;

  function fact(label, value, options = {}) {
    const row = node('div', `game-fact${options.wide ? ' is-wide' : ''}`);
    const term = node('dt', '', label);
    const detail = node('dd', '', typeof value === 'string' ? value : null);
    if (typeof value !== 'string') detail.append(value);
    if (options.lang) detail.lang = options.lang;
    for (const note of options.notes || []) if (note) detail.append(node('span', 'game-fact-note', note));
    row.append(term, detail);
    return row;
  }

  function storeRows(store) {
    if (!store) return [];
    const rows = [];
    // The Taiwan price belongs to the Steam version (平台版本); the rest are game facts.
    if (store.rating) rows.push(fact('分級', ratingText(store.rating)));
    if (store.steamDeck) rows.push(fact('Steam Deck', deckText(store.steamDeck)));
    return rows;
  }

  function tagList(game) {
    const tags = highlightTags(game, R, 8);
    if (!tags.length) return null;
    const list = node('div', 'game-fact-tags');
    list.append(...tags.map(tag => {
      const link = node('a', 'game-fact-tag', R.label(tag));
      link.href = R.url(tag);
      return link;
    }));
    if (game.tags.length > tags.length) {
      const all = node('a', 'game-fact-more', `看全部 ${game.tags.length} 個 ↓`);
      all.href = '#gameDiscovery';
      list.append(all);
    }
    return list;
  }

  function renderFacts(game, media, store = null) {
    const latin = value => /^[\x20-\x7e]+$/.test(value) ? 'en' : undefined;
    const name = String(game.name || ''), original = String(game.nameEn || '');
    const rows = [];
    if (hasChineseName(name)) rows.push(fact('中文名稱', name));
    const originalName = original && original !== name ? original : !hasChineseName(name) ? name : '';
    if (originalName) rows.push(fact('原名', originalName, { lang: latin(originalName) }));
    const genres = (game.genres || []).slice(0, 4).map(genre => R.genreLabel(genre));
    if (genres.length) rows.push(fact('類型', genres.join('、')));
    if (media?.developers.length) rows.push(fact('開發商', media.developers.join('、'), { lang: latin(media.developers.join('')) }));
    if (media?.publishers.length) rows.push(fact('發行商', media.publishers.join('、'), { lang: latin(media.publishers.join('')) }));
    if (media?.franchises.length) rows.push(fact('系列', media.franchises.join('、'), { lang: latin(media.franchises.join('')) }));
    const tags = tagList(game);
    if (tags) rows.push(fact('特色 TAG', tags, { wide: true }));
    rows.push(...storeRows(store));
    $('gameFacts').replaceChildren(...rows);
  }

  return { renderFacts };
}
