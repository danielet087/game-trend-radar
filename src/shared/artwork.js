/* Use Steam-provided responsive artwork; never guess an asset hash or 2x URL. */
const failed = new Set();
const cleanup = new WeakMap();
function load(img, game, { large = false, onLoad = () => {}, onExhausted = () => {} } = {}) {
  cleanup.get(img)?.();
  const sources = game.artSources?.length ? game.artSources : game.art ? [game.art] : [];
  let index = 0;
  let base = "";
  let high = "";
  function next() {
    img.removeAttribute("srcset");
    while (index < sources.length && failed.has(sources[index])) index++;
    if (index >= sources.length) { onExhausted(); return; }
    base = sources[index++];
    high = game.artVariants?.[base] || "";
    if (high && !failed.has(high)) {
      if (large) { img.src = high; return; }
      img.srcset = `${base} 1x, ${high} 2x`;
    }
    img.src = base;
  }
  const onError = () => {
    // A missing optional 2x image falls back to its known 1x image first.
    if (high && !failed.has(high)) {
      failed.add(high);
      high = "";
      img.removeAttribute("srcset");
      img.src = base;
    } else { failed.add(base); next(); }
  };
  img.addEventListener("error", onError);
  img.addEventListener("load", onLoad);
  cleanup.set(img, () => { img.removeEventListener("error", onError); img.removeEventListener("load", onLoad); });
  next();
}
/** Steam capsule art is 616×353. Other shapes (Steam headers, IGDB's portrait
 * covers) are shown whole over a blurred copy instead of being cropped. */
export const CAPSULE_RATIO = 616 / 353;
export function artShape(img) {
  const ratio = img?.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0;
  const source = img?.currentSrc || img?.src || "";
  const whole = ratio > 0 && Math.abs(ratio - CAPSULE_RATIO) / CAPSULE_RATIO > 0.06;
  // Only plain https artwork URLs go into CSS.
  const backdrop = whole && /^https:\/\/[^\s"'()\\]+$/.test(source) ? `url("${source}")` : "";
  return { whole, backdrop };
}
export function cancelArtwork(img) {
  cleanup.get(img)?.();
  cleanup.delete(img);
}
export const RadarArtwork = { load, artShape };
export { load as loadArtwork };
export default RadarArtwork;
