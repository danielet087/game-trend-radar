import { node } from '../catalog/dom';
import type { CatalogAPI } from '../catalog/types';
import type { FilterState } from '../catalog/filter-state';
interface TagControl extends HTMLElement { value: string }
export function createTagExplorer(R: CatalogAPI, filters: FilterState, changeFilters: () => void, notify: (message: string) => void) {
  const $ = (id: string) => document.getElementById(id) as TagControl;
  const mode = filters.mode;
  const controller = new AbortController();
  let allTagChoices: {tag: string; label: string; count: number}[] = [];
  let showAllTags = false;
  let tagIntent: "include" | "exclude" = "include";
  function renderTagSelection() {
    const f = filters.state.tags;
    $("tagActive").hidden = !f.include.length && !f.exclude.length;
    $("allTags").setAttribute("aria-pressed", String(!f.include.length && !f.exclude.length));
    const chips = [];
    for (const kind of ["include", "exclude"] as const) for (const tag of f[kind]) {
      const button = node("button", "selected-tag" + (kind === "exclude" ? " excluded" : ""));
      button.type = "button";
      button.append(node("span", "", (kind === "exclude" ? "排除 · " : "") + R.label(tag)), node("span", "", "×"));
      button.setAttribute("aria-label", `移除${kind === "exclude" ? "排除" : ""} ${R.label(tag)} 篩選`);
      button.addEventListener("click", () => {
        f[kind] = f[kind].filter(value => R.key(value) !== R.key(tag));
        changeFilters();
        $("tagSelectionSummary").focus({ preventScroll: true });
      }, { signal: controller.signal });
      chips.push(button);
    }
    $("selectedTags").replaceChildren(...chips);
    $("tagSelectionSummary").textContent = `${f.match === "all" ? "全部符合" : "任一符合"} ${f.include.length} 個 TAG${f.exclude.length ? ` · 排除 ${f.exclude.length} 個` : ""}`;
    $("tagMatch").value = f.match;
    $("tagIntentInclude").setAttribute("aria-pressed", String(tagIntent === "include"));
    $("tagIntentExclude").setAttribute("aria-pressed", String(tagIntent === "exclude"));
    document.querySelectorAll<HTMLButtonElement>("#tagCatalog button").forEach(button => {
      const included = f.include.some(tag => R.key(tag) === R.key(button.dataset.tag));
      const excluded = f.exclude.some(tag => R.key(tag) === R.key(button.dataset.tag));
      button.setAttribute("aria-pressed", String(included || excluded));
      button.classList.toggle("is-excluded", excluded);
      button.title = `${button.dataset.tag}${excluded ? "（已排除）" : included ? "（已選取）" : ""}`;
    });
  }
  function renderTagCatalog() {
    if (mode !== "explore") return;
    const term = R.key($("tagSearch")?.value || "");
    const matches = allTagChoices.filter(entry => R.key(entry.tag + " " + entry.label).includes(term));
    const visible = term || showAllTags ? matches : matches.slice(0, 14);
    const selected = [...filters.state.tags.include, ...filters.state.tags.exclude];
    if (!term && !showAllTags) for (const tag of selected) {
      const entry = allTagChoices.find(value => R.key(value.tag) === R.key(tag));
      if (entry && !visible.includes(entry)) visible.push(entry);
    }
    $("tagCatalog").replaceChildren(...visible.map(entry => {
      const button = node("button", "explore-tag");
      button.type = "button";
      button.dataset.tag = entry.tag;
      button.setAttribute("aria-label", `${entry.label}，${entry.count} 款遊戲`);
      const count = node("small", "", String(entry.count));
      count.setAttribute("aria-hidden", "true");
      button.append(node("span", "", entry.label), count);
      button.addEventListener("click", () => {
        const f = filters.state.tags;
        const already = f[tagIntent].some(tag => R.key(tag) === R.key(entry.tag));
        if (!already && f[tagIntent].length >= 12) { notify("同一組最多選擇 12 個 TAG。"); return; }
        f[tagIntent] = already ? f[tagIntent].filter(tag => R.key(tag) !== R.key(entry.tag)) : [...f[tagIntent], entry.tag];
        const other = tagIntent === "include" ? "exclude" : "include";
        f[other] = f[other].filter(tag => R.key(tag) !== R.key(entry.tag));
        changeFilters();
      }, { signal: controller.signal });
      return button;
    }));
    $("tagCatalogEmpty").hidden = visible.length > 0;
    $("tagCatalogEmpty").textContent = term ? "找不到這個 TAG，試試中文或英文名稱。" : "目前尚未提供 TAG，仍可瀏覽下方清單。";
    $("moreTags").hidden = !!term || allTagChoices.length <= 14;
    $("moreTags").textContent = showAllTags ? "收合 TAG −" : `查看全部 ${allTagChoices.length} 個 TAG ＋`;
    $("moreTags").setAttribute("aria-expanded", String(showAllTags));
    $("tagCatalogCount").textContent = `${allTagChoices.length} 個 TAG · 數字為各 TAG 的全部收錄數`;
    renderTagSelection();
  }
  function bind() {
    $("tagSearch").addEventListener("input", renderTagCatalog, { signal: controller.signal });
    $("moreTags").addEventListener("click", () => { showAllTags = !showAllTags; renderTagCatalog(); }, { signal: controller.signal });
    $("allTags").addEventListener("click", () => { filters.state.tags.include = []; filters.state.tags.exclude = []; changeFilters(); }, { signal: controller.signal });
    $("clearTags").addEventListener("click", () => { filters.state.tags.include = []; filters.state.tags.exclude = []; changeFilters(); $("allTags").focus(); }, { signal: controller.signal });
    $("tagIntentInclude").addEventListener("click", () => { tagIntent = "include"; renderTagSelection(); }, { signal: controller.signal });
    $("tagIntentExclude").addEventListener("click", () => { tagIntent = "exclude"; renderTagSelection(); }, { signal: controller.signal });
    $("tagMatch").addEventListener("change", () => { filters.state.tags.match = ($("tagMatch") as HTMLSelectElement).value as 'all' | 'any'; changeFilters(); }, { signal: controller.signal });
  }
  return { render: renderTagCatalog, renderSelection: renderTagSelection, bind,
    setCatalog(choices: typeof allTagChoices) {
      allTagChoices = choices;
      for (const kind of ['include', 'exclude'] as const) filters.state.tags[kind] = filters.state.tags[kind].map(tag =>
        allTagChoices.find(entry => R.key(entry.tag) === R.key(tag))?.tag || tag);
      renderTagCatalog();
    },
    reset() { $("tagSearch").value = ""; renderTagCatalog(); },
    dispose() { controller.abort(); },
  };
}
