/**
 * Phones (≤ 800px) keep the search box in the page and move the other filter
 * controls into a bottom sheet behind the 篩選 button. Applied filters show as
 * removable chips under the search row. Desktop keeps every control in place.
 *
 * Markup opts in:
 *   data-sheet="filter"   moved into the sheet, counted, chipped and cleared
 *   data-sheet="setting"  moved into the sheet only (month jump, sort)
 *
 * Controls keep their ids and listeners; the catalog never reads positions,
 * and the sheet learns about every change from the catalog's
 * radar:content-ready event.
 */
import { PHONE_QUERY } from '../../shared/phone-slots';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

interface Moved { node: HTMLElement; marker: Comment }
export interface AppliedFilter { label: string; control: HTMLElement; clear: () => void }

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

/** Hidden by itself or by a parent below the boundary (the closed sheet does not count). */
function shown(element: HTMLElement, boundary: Element | null = null) {
  for (let item: HTMLElement | null = element; item && item !== boundary; item = item.parentElement) if (item.hidden) return false;
  return true;
}
const within = <T extends Element>(group: HTMLElement, selector: string) =>
  (group.matches(selector) ? [group] : [...group.querySelectorAll(selector)]) as unknown as T[];

/** The text a chip shows for a pressed toggle: its words without the leading symbol (♡ 只看收藏 → 只看收藏). */
export function toggleLabel(button: HTMLElement) {
  return button.dataset.chip || (button.textContent || '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/g, ' ').trim();
}

/** Filters that differ from their default: a select away from its first option, or a pressed toggle. */
export function appliedFilters(groups: HTMLElement[]): AppliedFilter[] {
  const applied: AppliedFilter[] = [];
  for (const group of groups) {
    if (group.hidden) continue;
    for (const select of within<HTMLSelectElement>(group, 'select')) {
      const first = select.options[0], current = select.options[select.selectedIndex];
      if (!first || !current || current === first || !shown(select, group.parentElement)) continue;
      applied.push({ label: current.text.trim(), control: select, clear() {
        select.value = first.value; select.dispatchEvent(new Event('change', { bubbles: true }));
      } });
    }
    for (const button of within<HTMLElement>(group, '[aria-pressed]')) {
      if (!shown(button, group.parentElement) || button.getAttribute('aria-pressed') !== 'true') continue;
      applied.push({ label: toggleLabel(button), control: button, clear: () => button.click() });
    }
  }
  return applied;
}

export function createFilterSheet(panel: HTMLElement, options: { media?: MediaQueryList; signal?: AbortSignal } = {}) {
  const parts = [panel.querySelector<HTMLButtonElement>('.filter-toggle'), panel.querySelector<HTMLElement>('.applied-filters')] as const;
  if (!parts[0] || !parts[1]) return null;
  // Hoisted helpers below read these, so they are typed as present once checked.
  const toggle: HTMLButtonElement = parts[0], chips: HTMLElement = parts[1];
  const media = options.media || matchMedia(PHONE_QUERY), signal = options.signal;
  const count = toggle.querySelector<HTMLElement>('.filter-toggle-count');
  const groups = [...panel.querySelectorAll<HTMLElement>('[data-sheet]')];
  const filterGroups = groups.filter(group => group.dataset.sheet === 'filter');
  // Filters first, then settings such as the month jump and sort.
  const moved: Moved[] = [...filterGroups, ...groups.filter(group => group.dataset.sheet !== 'filter')]
    .map(node => ({ node, marker: document.createComment('filter-sheet') }));
  for (const item of moved) item.node.before(item.marker);

  const title = toggle.dataset.sheetTitle || '篩選';
  const scrim = make('div', 'filter-scrim'); scrim.hidden = true; scrim.setAttribute('aria-hidden', 'true');
  const sheet = make('section', 'filter-sheet'); sheet.id = toggle.getAttribute('aria-controls') || 'filterSheet';
  Object.assign(sheet, { hidden: true, tabIndex: -1 });
  sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-labelledby', `${sheet.id}Title`);
  const head = make('div', 'filter-sheet-head'), heading = make('h2', '', title); heading.id = `${sheet.id}Title`;
  const close = make('button', 'filter-sheet-close'); close.type = 'button'; close.setAttribute('aria-label', `關閉${title}`); close.innerHTML = CLOSE_ICON;
  head.append(heading, close);
  const body = make('div', 'filter-sheet-body');
  const foot = make('div', 'filter-sheet-foot'), status = make('p', 'filter-sheet-count'); status.setAttribute('aria-live', 'polite');
  const actions = make('div', 'filter-sheet-actions');
  const clear = make('button', 'filter-sheet-clear', '清除'), done = make('button', 'filter-sheet-done', '完成');
  clear.type = done.type = 'button'; actions.append(clear, done); foot.append(status, actions);
  sheet.append(head, body, foot);
  document.body.append(scrim, sheet);

  let phone: boolean | null = null, open = false, inerted: Element[] = [];

  function refresh() {
    const applied = phone ? appliedFilters(filterGroups) : [];
    const focused = chips.contains(document.activeElement) ? [...chips.children].indexOf(document.activeElement as Element) : -1;
    chips.replaceChildren(...applied.map(filter => {
      const chip = make('button', 'applied-chip', filter.label); chip.type = 'button';
      chip.setAttribute('aria-label', `移除篩選：${filter.label}`); chip.insertAdjacentHTML('beforeend', CLOSE_ICON);
      // Clearing re-renders the catalog; refresh() then keeps focus on the chip row.
      chip.addEventListener('click', () => { filter.clear(); refresh(); });
      return chip;
    }));
    chips.hidden = !applied.length;
    if (focused >= 0 && !chips.contains(document.activeElement)) ((chips.children[focused] || chips.lastElementChild || toggle) as HTMLElement).focus();
    if (count) {
      count.hidden = !applied.length;
      const number = make('span', '', String(applied.length)); number.setAttribute('aria-hidden', 'true');
      count.replaceChildren(number, make('span', 'sr-only', `，已套用 ${applied.length} 項`));
    }
    clear.disabled = !applied.length;
    status.textContent = document.getElementById('resultCount')?.textContent || '';
  }

  function trap(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); hide(); return; }
    if (event.key !== 'Tab') return;
    const items = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(item => shown(item) && item.getClientRects().length);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function show() {
    if (!phone || open) return;
    open = true; refresh();
    for (const child of document.body.children) {
      if (child === sheet || child === scrim || child.matches('.toast') || (child as HTMLElement).inert) continue;
      (child as HTMLElement).inert = true; inerted.push(child);
    }
    scrim.hidden = sheet.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.documentElement.classList.add('filter-sheet-open');
    sheet.focus();
  }

  function hide(restore = true) {
    if (!open) return;
    open = false;
    for (const child of inerted) (child as HTMLElement).inert = false;
    inerted = [];
    scrim.hidden = sheet.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('filter-sheet-open');
    if (restore) toggle.focus();
  }

  function place() {
    if (phone === media.matches) return;
    phone = media.matches;
    if (!phone) hide(false);
    for (const item of moved) {
      if (phone) body.append(item.node);
      else item.marker.after(item.node);
    }
    refresh();
  }

  const listen = { signal };
  toggle.addEventListener('click', () => (open ? hide() : show()), listen);
  close.addEventListener('click', () => hide(), listen);
  done.addEventListener('click', () => hide(), listen);
  scrim.addEventListener('click', () => hide(), listen);
  clear.addEventListener('click', () => { for (const filter of appliedFilters(filterGroups)) filter.clear(); refresh(); done.focus(); }, listen);
  sheet.addEventListener('keydown', trap, listen);
  media.addEventListener('change', place, listen);
  document.addEventListener('radar:content-ready', refresh, listen);
  place();

  return {
    get open() { return open; }, show, hide, refresh,
    dispose() {
      hide(false);
      for (const item of moved) { item.marker.after(item.node); item.marker.remove(); }
      scrim.remove(); sheet.remove();
    },
  };
}
