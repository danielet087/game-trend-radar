import { element as $ } from '../catalog/dom';
import { PAGE_SIZE } from '../catalog/filter-state';
import type { FilterState } from '../catalog/filter-state';
import type { CatalogAPI, CatalogState } from '../catalog/types';

export function createDateNavigation(D: CatalogAPI, filters: FilterState, state: CatalogState,
  writeURL: () => void, render: () => void, cancelSearch: () => void) {
  let animation: Animation | undefined;
  const controller = new AbortController();
  function refreshLinks() {
    const date = filters.state.date;
    for (const [id, direction] of [['prevDate', -1], ['nextDate', 1]] as const) {
      const link = $<HTMLAnchorElement>(id), picker = $<HTMLInputElement>('datePicker');
      const adjacent = date ? D.offsetDate(date, direction) : null;
      const valid = D.validDate(adjacent) && adjacent >= picker.min && adjacent <= picker.max;
      link.hidden = !date; link.setAttribute('aria-disabled', String(!valid));
      if (!valid) { link.removeAttribute('href'); link.tabIndex = -1; continue; }
      const url = new URL(location.href); url.searchParams.set('date', adjacent); url.hash = '';
      link.href = url.pathname + url.search; link.removeAttribute('tabindex');
      $(id + 'Label').textContent = `${Number(adjacent.slice(5, 7))} / ${Number(adjacent.slice(8))}`;
      const label = `${direction < 0 ? '前一天' : '後一天'}：${adjacent.replaceAll('-', '/')}`;
      link.setAttribute('aria-label', label); link.title = label;
    }
  }
  function renderHeading() {
    const date = filters.state.date;
    if (date) {
      $('dateTitle').textContent = `${date.slice(0, 4)} 年 ${Number(date.slice(5, 7))} 月 ${Number(date.slice(8))} 日`;
      $('dateWeekday').textContent = new Intl.DateTimeFormat('zh-TW', { weekday: 'long', timeZone: 'Asia/Taipei' }).format(new Date(date + 'T12:00:00Z'));
      $<HTMLAnchorElement>('backCalendar').href = `./index.html?month=${date.slice(0, 7)}`;
      document.title = `${date} 發售遊戲｜Game Trend Radar`;
    } else {
      $('dateTitle').textContent = '選擇發售日期'; $('dateWeekday').textContent = '';
      $<HTMLAnchorElement>('backCalendar').href = './index.html'; document.title = '找不到指定日期｜Game Trend Radar';
    }
    $('dateWeekday').hidden = !date; $<HTMLInputElement>('datePicker').value = date || '';
    $('dateCurrent').classList.toggle('date-invalid', !date); refreshLinks();
  }
  function change(nextDate: string) {
    if (!D.validDate(nextDate)) return;
    cancelSearch(); writeURL();
    if (nextDate === filters.state.date) return;
    const direction = filters.state.date && nextDate < filters.state.date ? -1 : 1;
    filters.state.date = nextDate;
    const url = new URL(location.href); url.searchParams.set('date', nextDate); url.hash = '';
    history.pushState(null, '', url); state.limit = PAGE_SIZE; renderHeading(); render(); animation?.cancel();
    if (window.RadarMotion?.enabled && $('dateCurrent').animate)
      animation = $('dateCurrent').animate([{ opacity: .5, transform: `translateX(${direction * 6}px)` }, { opacity: 1, transform: 'translateX(0)' }], { duration: 170, easing: 'ease-out' });
  }
  function bind() {
    renderHeading();
    for (const [id, direction] of [['prevDate', -1], ['nextDate', 1]] as const) $(id).addEventListener('click', event => {
      if (!filters.state.date || $(id).getAttribute('aria-disabled') === 'true') { event.preventDefault(); return; }
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) { cancelSearch(); writeURL(); return; }
      event.preventDefault(); change(D.offsetDate(filters.state.date, direction));
    }, { signal: controller.signal });
    $('datePicker').addEventListener('change', event => {
      const picker = event.target as HTMLInputElement;
      if (!picker.validity.valid || !D.validDate(picker.value)) { picker.value = filters.state.date || ''; return; }
      change(picker.value);
    }, { signal: controller.signal });
  }
  return { bind, change, renderHeading, refreshLinks, dispose() { controller.abort(); animation?.cancel(); } };
}
