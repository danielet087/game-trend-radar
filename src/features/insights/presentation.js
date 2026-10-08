import { RadarArtwork } from '../../shared/artwork.js';
export function createInsightsPresentation(ctx) {
  const { $, node, E, I, state, number, document } = ctx;
  const { dateText } = ctx;
  function history(game) {
    const stored = state.observations.get(game.appid)?.history || [];
    const row = state.rawCatalog?.games.find(value => Number(value.appid) === game.appid);
    return [...stored, ...(row?.follower_checked_at ? [{ at: row.follower_checked_at, followers: row.followers, source: "steam_community" }] : [])];
  }
  function cover(game, className = "lab-cover") {
    const box = node("div", className);
    box.append(E.illustration("rocket"));
    if (!game.art) return box;
    const img = node("img");
    img.alt = ""; img.width = 616; img.height = 288; img.loading = "lazy"; img.decoding = "async";
    RadarArtwork.load(img, game, { onLoad: () => box.classList.add("has-art"), onExhausted: () => img.remove() });
    box.append(img);
    return box;
  }
  function gameLink(game) {
    const a = node("a", "lab-game-name", game.name);
    a.href = `./game.html?appid=${game.appid}`;
    return a;
  }
  function badges(game) {
    const box = node("div", "card-languages");
    for (const item of game.languageBadges) box.append(node("span", `card-language language-${item.status}`, item.label));
    return box;
  }
  function sparkline(series) {
    const box = node("div", "growth-sparkline");
    const values = series.slice(-31);
    if (values.length < 2) { box.append(node("span", "", "累積更多量測後顯示曲線")); return box; }
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 180 42");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${dateText(values[0].day)} 至 ${dateText(values.at(-1).day)}，${values.length} 次日量測，由 ${number.format(values[0].followers)} 至 ${number.format(values.at(-1).followers)} 人關注；獨立刻度`);
    const min = Math.min(...values.map(p => p.followers)), max = Math.max(...values.map(p => p.followers));
    const first = Date.parse(values[0].day), elapsed = Date.parse(values.at(-1).day) - first || 1;
    const line = document.createElementNS(ns, "polyline");
    line.setAttribute("points", values.map(p => `${4 + (Date.parse(p.day) - first) / elapsed * 172},${max === min ? 21 : 36 - (p.followers - min) / (max - min) * 30}`).join(" "));
    line.setAttribute("fill", "none"); line.setAttribute("stroke", "currentColor"); line.setAttribute("stroke-width", "2.5");
    svg.append(line); box.append(svg);
    return box;
  }
  function empty(kind, title, text) {
    const box = node("div", "lab-empty");
    box.append(E.illustration(kind), node("h2", "", title), node("p", "", text));
    return box;
  }
  return { history, cover, gameLink, badges, sparkline, empty };
}
