// Translation on request for an English description. Nothing is translated
// until the reader asks, and no translation is saved. Desktop Chrome (138+)
// and Edge (148+) translate on the device with the browser's built-in
// Translator; other browsers open the text in Google Translate.
const SOURCE = 'en';
const TARGET = 'zh-Hant';

export function googleTranslateURL(text) {
  const url = new URL('https://translate.google.com/');
  url.search = new URLSearchParams({ sl: 'en', tl: 'zh-TW', text, op: 'translate' }).toString();
  return url.href;
}

export function createDescriptionTranslation(ctx) {
  const { $, node, window } = ctx;
  // One built-in translator per page; each description is translated once.
  let translator = null;
  const cache = new Map();
  let state = null;
  const builtIn = () => typeof window?.Translator?.create === 'function';

  function show(translated) {
    const text = translated ? cache.get(state.text) : state.text;
    $('gameDescription').textContent = text;
    $('gameDescription').lang = translated ? 'zh-Hant' : 'en';
    $('gameDescriptionNote').hidden = !translated;
    $('gameDescriptionNote').textContent = translated ? '瀏覽器機器翻譯，僅供參考；原文是英文。' : '';
    state.showing = translated;
    state.button.disabled = false;
    state.button.textContent = translated ? '顯示英文' : '翻譯成中文';
    state.button.setAttribute('aria-pressed', String(translated));
  }

  function fallback(message) {
    // The built-in translator is not available here: offer Google instead.
    state.button.hidden = true;
    const link = googleLink(state.text, '改用 Google 翻譯 ↗');
    const note = node('span', 'description-translate-status', `${message}`);
    state.status.replaceChildren(note, link);
    state.status.hidden = false;
  }

  function googleLink(text, label) {
    const link = node('a', 'description-translate', label);
    link.href = googleTranslateURL(text);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `${label.replace(/\s*↗$/, '')}：在 Google 翻譯開啟這段介紹（另開分頁）`);
    return link;
  }

  async function translate(paragraphs) {
    // create() is called straight from the click: a first use downloads the
    // language pack, which needs the reader's gesture.
    translator ||= await window.Translator.create({ sourceLanguage: SOURCE, targetLanguage: TARGET,
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', event => {
          if (state && !state.showing) state.button.textContent = `下載翻譯模型 ${Math.round(event.loaded * 100)}%`;
        });
      } });
    const out = [];
    for (const paragraph of paragraphs) out.push(paragraph.trim() ? await translator.translate(paragraph) : paragraph);
    return out.join('\n');
  }

  async function toggle() {
    if (!state || state.button.disabled) return;
    if (state.showing) return show(false);
    if (cache.has(state.text)) return show(true);
    const current = state;
    current.button.disabled = true;
    current.button.textContent = '翻譯中…';
    try {
      const translated = await translate(current.text.split('\n'));
      if (state !== current || ctx.disposed) return;
      cache.set(current.text, translated);
      show(true);
    } catch {
      if (state !== current || ctx.disposed) return;
      translator = null;
      fallback('這個瀏覽器無法直接翻譯。');
    }
  }

  /** Adds the control after the description's source line; English only. */
  function render(game) {
    const text = game.descriptionLanguage === 'en' ? String(game.description || '') : '';
    const keep = state && state.text === text && state.showing && cache.has(text);
    $('gameDescriptionNote').hidden = true;
    $('gameDescriptionNote').textContent = '';
    state = null;
    if (!text) return;
    const source = $('descriptionSource');
    if (!builtIn()) {
      source.append(googleLink(text, 'Google 翻譯 ↗'));
      source.hidden = false;
      return;
    }
    const button = node('button', 'description-translate', '翻譯成中文');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-controls', 'gameDescription');
    button.addEventListener('click', toggle);
    const status = node('span', 'description-translate-fallback');
    status.hidden = true;
    source.append(button, status);
    source.hidden = false;
    state = { text, button, status, showing: false };
    if (keep) show(true);
  }

  return { render };
}
