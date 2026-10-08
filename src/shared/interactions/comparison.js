export function createComparison(I, helpers) {
const { make } = helpers;
  const compareKey = "game-trend-radar:compare:v1";
  let selected = [];
  try { selected = I.comparisonIds(JSON.parse(localStorage.getItem(compareKey) || "[]")); } catch {}
  const names = new Map();
  const onAnalysis = document.body.dataset.page === "analysis";
  const dock = make("aside", "compare-dock");
  dock.hidden = true;
  dock.setAttribute("aria-label", "遊戲比較清單");
  const dockLabel = make("span", "compare-dock-label");
  const dockLink = make("a", "compare-open", "開啟比較 ↗");
  const dockClear = make("button", "compare-clear", "清空");
  dockClear.type = "button";
  dock.append(dockLabel, dockLink, dockClear);
  if (!onAnalysis) document.body.append(dock);
  function compareURL(ids = selected) { return "./analysis.html" + (ids.length ? "?ids=" + ids.join(",") : ""); }
  function updateCompare() {
    dock.hidden = !selected.length;
    document.body.classList.toggle("has-comparison", !!selected.length && !onAnalysis);
    dockLabel.textContent = `已選 ${selected.length} / 3 款`;
    dockLink.href = compareURL();
    dockLink.title = selected.map(id => names.get(id) || `App ${id}`).join("、");
    document.querySelectorAll("button[data-compare]").forEach(button => {
      const active = selected.includes(Number(button.dataset.compare));
      button.setAttribute("aria-pressed", String(active));
      button.textContent = button.classList.contains("card-compare")
        ? (active ? "✓ 已選比較" : "＋ 比較") : (active ? "✓ 已加入比較" : "＋ 加入比較");
      button.setAttribute("aria-label", `${active ? "移出" : "加入"}比較：${button.dataset.gameName}`);
    });
  }
  function feedback(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(feedback.timer);
    feedback.timer = setTimeout(() => toast.classList.remove("visible"), 2800);
  }
  function setCompared(ids, silent = false) {
    selected = I.comparisonIds(ids);
    let durable = true;
    try { localStorage.setItem(compareKey, JSON.stringify(selected)); } catch { durable = false; }
    updateCompare();
    document.dispatchEvent(new CustomEvent("radar:comparechange", { detail: [...selected] }));
    if (!durable && !silent) feedback("已更新本次比較；瀏覽器目前無法儲存比較清單。");
  }
  function toggleCompared(id, name) {
    if (!selected.includes(id) && selected.length === 3) {
      feedback("一次最多比較 3 款，請先移除其中一款。");
      return false;
    }
    const exists = selected.includes(id);
    setCompared(exists ? selected.filter(value => value !== id) : [...selected, id]);
    feedback(exists ? `已將「${name}」移出比較` : `已加入「${name}」 · ${selected.length} / 3 款`);
    return true;
  }
  function attachCompare(card, game) {
    if (game.source === "nintendo") return;
    names.set(game.appid, game.name);
    if (card.querySelector("[data-compare]")) return;
    const button = make("button", "card-compare");
    button.type = "button";
    button.dataset.compare = game.appid;
    button.dataset.gameName = game.name;
    const active = selected.includes(game.appid);
    button.textContent = active ? "✓ 已選比較" : "＋ 比較";
    button.setAttribute("aria-label", `${active ? "移出" : "加入"}比較：${game.name}`);
    button.setAttribute("aria-pressed", String(active));
    card.append(button);
  }
  document.addEventListener("click", event => {
    const button = event.target.closest("button[data-compare]");
    if (button) toggleCompared(Number(button.dataset.compare), button.dataset.gameName);
  });
  dockClear.addEventListener("click", () => {
    const target = document.querySelector("button[data-compare][aria-pressed=true]");
    setCompared([]);
    target?.focus({ preventScroll: true });
  });
  window.addEventListener("storage", event => {
    if (event.key !== compareKey && event.key !== null) return;
    try { selected = I.comparisonIds(JSON.parse(event.newValue || "[]")); } catch { selected = []; }
    updateCompare();
    document.dispatchEvent(new CustomEvent("radar:comparechange", { detail: [...selected] }));
  });
  updateCompare();
  const api = { ids: () => [...selected], set: setCompared, toggle: toggleCompared, url: compareURL };


return { api, attachCompare, feedback };
}
