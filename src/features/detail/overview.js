// "What this game is" at a glance, and the fixed-format facts of the info card.
const PLAY_MODE_TAGS = new Set(['singleplayer', 'multiplayer']);
const LANGUAGES = [['tchinese', '繁體中文'], ['schinese', '簡體中文'], ['english', '英文']];

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

export function createDetailOverview(ctx) {
  const { $, node, R, D, isNativeConsole } = ctx;

  function card(title, symbol, ...content) {
    const item = node('article', 'game-overview-card');
    const head = node('h3', 'game-overview-title');
    const mark = node('span', 'game-overview-icon', symbol);
    mark.setAttribute('aria-hidden', 'true');
    head.append(mark, node('span', '', title));
    item.append(head, ...content);
    return item;
  }

  function render(game) {
    const cards = [];
    const genres = (game.genres || []).slice(0, 4).map(genre => R.genreLabel(genre));
    if (genres.length) cards.push(card('類型', '◆', node('p', 'game-overview-value', genres.join('、'))));
    const tags = highlightTags(game, R);
    if (tags.length) {
      const list = node('div', 'game-overview-tags');
      list.append(...tags.map(tag => {
        const link = node('a', 'game-overview-tag', R.label(tag));
        link.href = R.url(tag);
        return link;
      }));
      const all = node('a', 'game-overview-more', `看全部 ${game.tags.length} 個 TAG ↓`);
      all.href = '#gameDiscovery';
      const item = card('特色 TAG', '#', list, all);
      item.classList.add('is-wide');
      cards.push(item);
    }
    const modes = playModes(game);
    if (modes.length) {
      const single = modes.length === 1 || modes.every(mode => mode.text === modes[0].text);
      const value = single ? node('p', 'game-overview-value', modes[0].text)
        : node('ul', 'game-overview-list');
      if (!single) value.append(...modes.map(mode => node('li', '', `${mode.platform}：${mode.text}`)));
      const source = [...new Set(modes.map(mode => mode.source === 'Steam' ? 'Steam 遊玩類別' : 'IGDB 遊戲模式'))].join('、');
      cards.push(card('遊玩方式', '◎', value, node('p', 'game-overview-note', source)));
    }
    if (!isNativeConsole(game) && game.languages && typeof game.languages === 'object') {
      const list = node('ul', 'game-overview-languages');
      list.append(...LANGUAGES.map(([field, label]) => {
        const value = game.languages[field];
        const row = node('li', `game-overview-language is-${value === true ? 'yes' : value === false ? 'no' : 'unknown'}`);
        row.append(node('span', '', label), node('span', '', value === true ? '支援' : value === false ? '不支援' : '未確認'));
        return row;
      }));
      const item = card('語言（Steam）', '文', list);
      item.classList.add('is-languages');
      cards.push(item);
    }
    $('gameOverviewCards').replaceChildren(...cards);
    $('gameOverview').hidden = !cards.length;
  }

  function fact(label, value, options = {}) {
    const row = node('div', `game-fact${options.wide ? ' is-wide' : ''}`);
    const term = node('dt', '', label);
    const detail = node('dd', '', value);
    if (options.lang) detail.lang = options.lang;
    row.append(term, detail);
    return row;
  }

  function renderFacts(game, media) {
    const names = D.releaseDisplayNames(game);
    const latin = value => /^[\x20-\x7e]+$/.test(value) ? 'en' : undefined;
    const rows = [fact('中文名稱', names.name)];
    if (names.nameEn && names.nameEn !== names.name) rows.push(fact('原名', names.nameEn, { lang: latin(names.nameEn) }));
    if (media?.developers.length) rows.push(fact('開發商', media.developers.join('、'), { lang: latin(media.developers.join('')) }));
    if (media?.publishers.length) rows.push(fact('發行商', media.publishers.join('、'), { lang: latin(media.publishers.join('')) }));
    if (media?.franchises.length) rows.push(fact('系列', media.franchises.join('、'), { lang: latin(media.franchises.join('')) }));
    const modes = playModes(game);
    if (modes.length) rows.push(fact('遊玩方式', [...new Set(modes.map(mode => modes.length > 1 ? `${mode.platform}：${mode.text}` : mode.text))].join('；')));
    rows.push(fact('平台', game.platformLabel || (game.platforms || []).join('、') || '待確認'));
    $('gameFacts').replaceChildren(...rows);
  }

  return { render, renderFacts };
}
