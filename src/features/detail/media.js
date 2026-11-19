// Steam hero art, screenshots and short trailers (data/media/<appid>.json).
// Only Steam CDN addresses are accepted; the files themselves stay on Steam.
import { cancelArtwork } from '../../shared/artwork.js';

const IMAGE_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/';
const VIDEO_BASE = 'https://video.akamai.steamstatic.com/store_trailers/';
const MAX_SCREENSHOTS = 12;
const MAX_TRAILERS = 3;
const INITIAL_SHOTS = 6;
const safe = (value, base) => typeof value === 'string' && value.startsWith(base) && !/[\s"'<>\\]/.test(value) ? value : null;
const image = value => safe(value, IMAGE_BASE);
const video = value => safe(value, VIDEO_BASE);
const names = value => (Array.isArray(value) ? value : [])
  .filter(name => typeof name === 'string' && name.trim()).map(name => name.trim().slice(0, 120)).slice(0, 5);

export function steamMedia(value, appid) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema_version !== 1 ||
      !Number.isSafeInteger(appid) || Number(value.appid) !== appid) return null;
  const screenshots = (Array.isArray(value.screenshots) ? value.screenshots : [])
    .map(row => ({ thumb: image(row?.thumbnail), full: image(row?.full) }))
    .filter(row => row.thumb && row.full).slice(0, MAX_SCREENSHOTS);
  const trailers = (Array.isArray(value.trailers) ? value.trailers : []).map(row => ({
    name: typeof row?.name === 'string' ? row.name.trim().slice(0, 200) : '',
    poster: image(row?.poster), posterFull: image(row?.poster_full),
    webm: video(row?.microtrailer_webm), mp4: video(row?.microtrailer_mp4),
  })).filter(row => row.poster && (row.webm || row.mp4)).slice(0, MAX_TRAILERS);
  const updated = typeof value.updated_at === 'string' && Number.isFinite(Date.parse(value.updated_at)) ? value.updated_at : null;
  return { appid, hero: image(value.hero_image), hero2x: image(value.hero_image_2x), screenshots, trailers,
    developers: names(value.developers), publishers: names(value.publishers), franchises: names(value.franchises), updatedAt: updated };
}

const icon = (document, paths, size = 22) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
};

export function createDetailMedia(ctx) {
  const { $, node, document, window, motion, on, isNativeConsole } = ctx;
  let current = null, key = '', expanded = false, gallery = [], position = 0, watcher = null, clip = null;
  const preferStill = () => {
    const reduced = typeof window?.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wide = typeof window?.matchMedia === 'function' && window.matchMedia('(min-width: 900px)').matches;
    return reduced || !wide || motion?.enabled === false || window?.navigator?.connection?.saveData === true;
  };

  function renderHero(game, media) {
    const art = $('gameHeroArt'), img = $('gameHeroImage');
    const source = !isNativeConsole(game) ? media?.hero : null;
    art.dataset.state = source ? 'loading' : 'empty';
    if (!source) { img.hidden = true; img.removeAttribute('src'); img.removeAttribute('srcset'); return; }
    if (img.getAttribute('src') === source) { art.dataset.state = img.hidden ? 'loading' : 'ready'; return; }
    img.hidden = true;
    img.alt = '';
    img.decoding = 'async';
    img.fetchPriority = 'high';
    img.onload = () => { img.hidden = false; art.dataset.state = 'ready'; };
    img.onerror = () => { img.hidden = true; art.dataset.state = 'empty'; };
    if (media.hero2x) img.setAttribute('srcset', `${source} 1920w, ${media.hero2x} 3840w`);
    else img.removeAttribute('srcset');
    img.setAttribute('sizes', '100vw');
    img.src = source;
  }

  function shotButton(shot, index, total, name) {
    const button = node('button', 'game-shot');
    button.type = 'button';
    button.setAttribute('aria-label', `看 ${name} 的截圖 ${index + 1}／${total} 大圖`);
    const img = node('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 600;
    img.height = 338;
    img.src = shot.thumb;
    img.addEventListener('error', () => { img.remove(); button.classList.add('is-missing'); });
    button.append(img);
    button.addEventListener('click', () => openShot(index));
    return button;
  }

  function stopClip() {
    watcher?.disconnect?.();
    watcher = null;
    if (clip) { clip.pause?.(); clip = null; }
  }

  function playClip(figure, trailer, autoplay) {
    if (clip) return clip;
    const player = node('video', 'game-trailer-video');
    player.muted = true;
    player.loop = true;
    player.playsInline = true;
    player.setAttribute('playsinline', '');
    player.setAttribute('muted', '');
    player.preload = 'none';
    player.poster = trailer.poster;
    player.controls = !autoplay;
    player.setAttribute('aria-label', `${trailer.name || '遊戲'}的短預告（無聲）`);
    for (const [src, type] of [[trailer.webm, 'video/webm'], [trailer.mp4, 'video/mp4']]) {
      if (!src) continue;
      const option = node('source');
      option.src = src;
      option.type = type;
      player.append(option);
    }
    figure.classList.add('is-playing');
    figure.querySelector?.('.game-trailer-poster')?.replaceWith(player);
    clip = player;
    player.play?.()?.catch?.(() => { player.controls = true; });
    return player;
  }

  function trailerFigure(game, trailer) {
    const figure = node('figure', 'game-trailer');
    const poster = node('div', 'game-trailer-poster');
    const still = node('img');
    still.alt = '';
    still.loading = 'lazy';
    still.decoding = 'async';
    still.src = trailer.poster;
    still.addEventListener('error', () => still.remove());
    const play = node('button', 'game-trailer-play');
    play.type = 'button';
    play.setAttribute('aria-label', `播放短預告：${trailer.name || game.name}（無聲）`);
    play.append(icon(document, ['M8.5 5.5v13l10-6.5Z'], 30));
    play.addEventListener('click', () => {
      stopClip();
      const player = playClip(figure, trailer, false);
      player.controls = true;
      player.focus?.();
    });
    poster.append(still, play);
    const caption = node('figcaption', 'game-trailer-caption');
    const title = node('strong', '', trailer.name || '短預告');
    if (/^[\x20-\x7e]+$/.test(trailer.name)) title.lang = 'en';
    caption.append(title, node('span', '', '短預告・無聲・完整預告請到 Steam 商店觀看'));
    figure.append(poster, caption);
    if (!preferStill() && typeof window?.IntersectionObserver === 'function') {
      watcher = new window.IntersectionObserver(entries => {
        const visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.5);
        if (visible) playClip(figure, trailer, true).play?.()?.catch?.(() => {});
        else clip?.pause?.();
      }, { threshold: [0, 0.5] });
      watcher.observe(figure);
    }
    return figure;
  }

  function renderShots() {
    const total = gallery.length;
    const side = current?.trailers.length ? gallery.slice(0, 2) : [];
    const rest = gallery.slice(side.length);
    const visible = expanded ? rest : rest.slice(0, Math.max(0, INITIAL_SHOTS - side.length));
    $('gameShots').replaceChildren(...visible.map((shot) => {
      const index = gallery.indexOf(shot);
      const item = node('li');
      item.append(shotButton(shot, index, total, current.name));
      return item;
    }));
    const hidden = rest.length - visible.length;
    $('gameShotsMore').hidden = hidden <= 0 && !expanded;
    $('gameShotsMore').textContent = expanded ? '收合截圖' : `看全部 ${total} 張截圖`;
    $('gameShotsMore').setAttribute('aria-expanded', String(expanded));
    return side;
  }

  function renderSection(game, media) {
    const usable = !isNativeConsole(game) && media && (media.trailers.length || media.screenshots.length);
    const nextKey = usable ? `${game.appid}|${media.updatedAt}|${media.screenshots.length}|${media.trailers.length}` : '';
    $('gameMedia').hidden = !usable;
    if (!usable) { stopClip(); key = ''; current = null; $('gameMediaStage').replaceChildren(); $('gameShots').replaceChildren(); return; }
    $('gameMediaStore').href = game.link;
    $('gameMediaStore').setAttribute('aria-label', `在 Steam 商店看 ${game.name} 的完整預告（另開分頁）`);
    if (nextKey === key) return;
    stopClip();
    key = nextKey;
    expanded = false;
    current = { name: game.name, trailers: media.trailers };
    gallery = media.screenshots;
    const side = renderShots();
    const stage = $('gameMediaStage');
    stage.dataset.layout = media.trailers.length ? (side.length ? 'trailer-shots' : 'trailer') : 'shots';
    const parts = [];
    if (media.trailers.length) parts.push(trailerFigure(game, media.trailers[0]));
    if (side.length) {
      const column = node('div', 'game-media-side');
      column.append(...side.map(shot => shotButton(shot, gallery.indexOf(shot), gallery.length, game.name)));
      parts.push(column);
    }
    stage.replaceChildren(...parts);
    stage.hidden = !parts.length;
  }

  function showShot(index) {
    const shot = gallery[index];
    if (!shot) return;
    position = index;
    const img = $('artDialogImage');
    cancelArtwork(img);
    img.removeAttribute('srcset');
    img.src = shot.full;
    img.alt = `${current?.name || '遊戲'}的截圖 ${index + 1}`;
    $('artDialogCaption').textContent = current?.name || '';
    $('artDialogCount').textContent = `截圖 ${index + 1}／${gallery.length}`;
    $('artPrev').hidden = $('artNext').hidden = gallery.length < 2;
  }

  function openShot(index) {
    const dialog = $('artDialog');
    showShot(index);
    dialog.dataset.mode = 'gallery';
    if (!dialog.open) {
      dialog.showModal();
      document.documentElement.style.overflow = 'hidden';
    }
  }

  const step = delta => { if (gallery.length) showShot((position + delta + gallery.length) % gallery.length); };
  on($('artPrev'), 'click', () => step(-1));
  on($('artNext'), 'click', () => step(1));
  on($('artDialog'), 'keydown', event => {
    if ($('artDialog').dataset.mode !== 'gallery') return;
    if (event.key === 'ArrowLeft') { event.preventDefault?.(); step(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault?.(); step(1); }
  });
  on($('gameShotsMore'), 'click', () => { expanded = !expanded; renderShots(); });

  return {
    render(game, media) { renderHero(game, media); renderSection(game, media); },
    destroy() { stopClip(); },
  };
}
