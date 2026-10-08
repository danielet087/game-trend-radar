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
export function cancelArtwork(img) {
  cleanup.get(img)?.();
  cleanup.delete(img);
}
export const RadarArtwork = { load };
export { load as loadArtwork };
export default RadarArtwork;
