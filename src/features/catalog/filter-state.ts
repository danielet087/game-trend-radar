import { reactive } from 'vue';
import type { CatalogAPI, CatalogMode, FilterValues, TagFilters } from './types';

export const PAGE_SIZE = 36;
export const MONTH_PATTERN = /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/;
const noTags = (): TagFilters => ({ include: [], exclude: [], match: 'all' });

/** One source of truth. Controls mirror this state; selectors and URLs never read controls. */
export class FilterState {
  readonly state: FilterValues;
  readonly defaults = { minimum: '0', sort: 'date', period: '', language: '' };
  private choices: Record<string, string[]> = {};

  constructor(readonly mode: CatalogMode, readonly today: string, private domain: CatalogAPI,
    private discovery: CatalogAPI, params = new URLSearchParams(), compact = false) {
    this.state = reactive({ term: '', ...this.defaults, savedOnly: false, tags: noTags(),
      month: today.slice(0, 7), view: compact ? 'list' : 'calendar', date: null });
    this.restore(params);
  }

  configure(choices: Record<string, string[]>) {
    this.choices = choices;
    for (const key of ['minimum', 'sort', 'period', 'language'] as const)
      if (choices[key]?.length) this.defaults[key] = choices[key][0];
  }

  restore(params: URLSearchParams) {
    const state = this.state;
    state.term = params.get('q') || '';
    state.savedOnly = this.mode !== 'saved' && params.get('saved') === '1';
    state.tags = this.mode === 'explore' ? this.discovery.tagFilters(params) : noTags();
    const fields = { minimum: 'min', sort: 'sort', period: 'period', language: 'language' };
    for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
      const value = params.get(fields[key]);
      state[key] = value !== null && (!this.choices[key] || this.choices[key].includes(value))
        ? value : this.defaults[key];
    }
    if (MONTH_PATTERN.test(params.get('month') || '')) state.month = params.get('month')!;
    if (['calendar', 'list'].includes(params.get('view') || '')) state.view = params.get('view') as FilterValues['view'];
    state.date = this.domain.validDate(params.get('date')) ? params.get('date') : null;
  }

  get active() {
    const f = this.state;
    return !!(f.term.trim() || f.minimum !== this.defaults.minimum || f.tags.include.length ||
      f.tags.exclude.length || f.savedOnly || (this.mode === 'all' && f.period) ||
      (['all', 'explore'].includes(this.mode) && f.language));
  }

  reset() {
    Object.assign(this.state, { term: '', minimum: this.defaults.minimum, period: this.defaults.period,
      language: this.defaults.language, savedOnly: false, tags: noTags() });
  }

  url(href: string) {
    const url = new URL(href), f = this.state;
    const set = (key: string, value: string) => value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
    if (this.mode === 'home') { set('month', f.month); set('view', f.view); }
    set('q', f.term.trim());
    set('min', f.minimum !== this.defaults.minimum ? f.minimum : '');
    set('sort', f.sort !== this.defaults.sort ? f.sort : '');
    set('saved', f.savedOnly ? '1' : '');
    if (this.mode === 'explore') {
      url.searchParams.delete('tag'); url.searchParams.delete('exclude');
      f.tags.include.forEach(tag => url.searchParams.append('tag', tag));
      f.tags.exclude.forEach(tag => url.searchParams.append('exclude', tag));
      set('match', f.tags.match === 'any' ? 'any' : '');
    }
    if (['all', 'explore'].includes(this.mode)) set('language', f.language);
    if (this.mode === 'all') set('period', f.period);
    return url;
  }
}
