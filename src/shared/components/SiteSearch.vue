<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import SiteSearchResults from './SiteSearchResults.vue';
import { popularTags, searchIndex, type SearchIndex } from '../search/match.ts';
import { clearRecent, forgetSearch, readRecent, rememberSearch } from '../search/recent.ts';

// Site search in the header: a field with a dropdown on wide screens, a button
// that opens a full-screen sheet on narrower ones. The game data loads the
// first time someone opens it.
const props = defineProps<{ page: string }>();
// These pages' own search already takes 「/」 (全部遊戲, TAG 探索, Twitch and the
// other list pages); everywhere else 「/」 opens this one.
const OWN_SLASH = new Set(['home', 'all', 'games', 'upcoming', 'released', 'explore', 'saved', 'date', 'twitch', 'stream-planning']);
const WIDE = '(min-width: 1081px)';
const LISTBOX = 'site-search-listbox';

const root = ref<HTMLElement>();
const input = ref<HTMLInputElement>();
const sheet = ref<HTMLDialogElement>();
const sheetInput = ref<HTMLInputElement>();
const query = ref('');
const open = ref(false);
const sheetOpen = ref(false);
const focused = ref(false);
const active = ref(-1);
const index = shallowRef<SearchIndex | null>(null);
const state = ref<'idle' | 'loading' | 'ready' | 'error'>('idle');
const recent = ref<string[]>(readRecent());

const term = computed(() => query.value.trim());
const result = computed(() => searchIndex(index.value, query.value));
const starters = computed(() => popularTags(index.value, 6));
const optionCount = computed(() => term.value
  ? state.value === 'ready' ? result.value.games.length + result.value.tags.length : 0
  : recent.value.length + starters.value.length);
const expanded = computed(() => open.value && optionCount.value > 0);
const activeId = computed(() => expanded.value && active.value >= 0 ? `site-search-option-${active.value}` : undefined);
const slashHint = computed(() => !OWN_SLASH.has(props.page) && !focused.value && !query.value);

function ensureIndex(): void {
  if (state.value === 'loading' || state.value === 'ready') return;
  state.value = 'loading';
  import('../search/load.ts')
    .then(module => module.loadSearchIndex())
    .then(value => { index.value = value; state.value = 'ready'; })
    .catch(error => { console.error('Unable to load site search:', error); state.value = 'error'; });
}

function openPanel(): void {
  recent.value = readRecent();
  open.value = true;
  ensureIndex();
}

function closePanel(): void {
  open.value = false;
  active.value = -1;
}

function remember(): void {
  if (term.value) recent.value = rememberSearch(term.value);
}

function submit(): void {
  if (!term.value) return;
  remember();
  location.assign(result.value.allURL);
}

function fieldInput(): HTMLInputElement | undefined {
  return sheetOpen.value ? sheetInput.value : input.value;
}

function fill(value: string): void {
  query.value = value;
  fieldInput()?.focus();
}

function forget(value: string): void {
  recent.value = forgetSearch(value);
  active.value = Math.min(active.value, optionCount.value - 1);
  fieldInput()?.focus();
}

function clearAll(): void {
  recent.value = clearRecent();
  active.value = -1;
  fieldInput()?.focus();
}

function clearQuery(): void {
  query.value = '';
  fieldInput()?.focus();
}

function onFocus(): void {
  focused.value = true;
  openPanel();
}

function onInput(): void {
  if (!open.value) openPanel();
}

function onKeydown(event: KeyboardEvent): void {
  // Keys that confirm an IME composition belong to the IME.
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!open.value) { openPanel(); return; }
    const count = optionCount.value;
    if (!count) return;
    active.value = event.key === 'ArrowDown'
      ? (active.value + 1) % count
      : active.value <= 0 ? count - 1 : active.value - 1;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const chosen = activeId.value && document.getElementById(activeId.value);
    if (chosen) chosen.click();
    else submit();
  } else if (event.key === 'Escape') {
    // Handled here so the browser does not clear the field on its own.
    event.preventDefault();
    if (open.value) closePanel();
    else if (query.value) query.value = '';
    else input.value?.blur();
  } else if (event.key === 'Delete' && !term.value && open.value && active.value >= 0 && active.value < recent.value.length) {
    event.preventDefault();
    forget(recent.value[active.value]);
  }
}

function focusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  // Focus that goes nowhere (a click on the page, another window) is handled by the pointer.
  if (next instanceof Node && !root.value?.contains(next)) closePanel();
}

function outsidePointer(event: PointerEvent): void {
  if (open.value && event.target instanceof Node && !root.value?.contains(event.target)) closePanel();
}

function openSheet(): void {
  const dialog = sheet.value;
  if (!dialog) return;
  recent.value = readRecent();
  ensureIndex();
  if (!dialog.open) dialog.showModal();
  sheetOpen.value = true;
  document.documentElement.classList.add('site-search-locked');
  sheetInput.value?.focus();
}

function closeSheet(): void {
  if (sheet.value?.open) sheet.value.close();
}

function sheetClosed(): void {
  sheetOpen.value = false;
  document.documentElement.classList.remove('site-search-locked');
}

function sheetKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Enter') { event.preventDefault(); submit(); }
  if (event.key === 'Escape') { event.preventDefault(); closeSheet(); }
}

function slash(event: KeyboardEvent): void {
  if (event.key !== '/' || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (target instanceof Element && target.closest('input,textarea,select,[contenteditable]')) return;
  event.preventDefault();
  if (matchMedia(WIDE).matches) input.value?.focus();
  else openSheet();
}

function restored(event: PageTransitionEvent): void {
  // A page restored from the back/forward cache comes back with the search closed.
  if (!event.persisted) return;
  closePanel();
  closeSheet();
  recent.value = readRecent();
}

watch([query, index], () => {
  // An exact AppID is the obvious choice, so Enter opens it; otherwise Enter shows the full list.
  active.value = result.value.games[0]?.exact ? 0 : -1;
  if (term.value) ensureIndex();
});

watch(active, value => {
  if (value >= 0 && activeId.value) document.getElementById(activeId.value)?.scrollIntoView({ block: 'nearest' });
}, { flush: 'post' });

onMounted(() => {
  window.addEventListener('keydown', slash);
  document.addEventListener('pointerdown', outsidePointer);
  window.addEventListener('pageshow', restored);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', slash);
  document.removeEventListener('pointerdown', outsidePointer);
  window.removeEventListener('pageshow', restored);
  document.documentElement.classList.remove('site-search-locked');
});
</script>

<template>
  <div ref="root" class="site-search" :data-open="open ? '' : undefined" @focusout="focusOut">
    <div class="site-search-box">
      <label class="sr-only" for="siteSearchInput">搜尋遊戲、AppID 或 TAG</label>
      <div class="site-search-field">
        <svg class="site-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input id="siteSearchInput" ref="input" v-model="query" type="search" role="combobox" aria-autocomplete="list"
          :aria-expanded="expanded ? 'true' : 'false'" :aria-controls="expanded ? LISTBOX : undefined" :aria-activedescendant="activeId"
          placeholder="搜尋遊戲、AppID 或 TAG" autocomplete="off" spellcheck="false" enterkeyhint="search"
          @focus="onFocus" @blur="focused = false" @input="onInput" @keydown="onKeydown" />
        <kbd v-if="slashHint" class="site-search-kbd" title="按 / 開始搜尋" aria-hidden="true">/</kbd>
        <button v-if="query" type="button" class="site-search-clear" aria-label="清除搜尋" @mousedown.prevent @click="clearQuery">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div v-if="open" class="site-search-panel">
        <SiteSearchResults id-prefix="site-search" :query="query" :state="state" :result="result" :recent="recent" :tags="starters"
          :active="active" :compact="false" @remember="remember" @fill="fill" @forget="forget" @clear="clearAll" />
      </div>
    </div>
    <div v-if="open" class="site-search-scrim" aria-hidden="true" @click="closePanel"></div>
    <button type="button" class="site-search-button" aria-label="搜尋遊戲、AppID 或 TAG" aria-haspopup="dialog" @click="openSheet">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
    </button>
    <dialog ref="sheet" class="site-search-sheet" aria-label="搜尋" @close="sheetClosed">
      <div class="site-search-sheet-bar">
        <button type="button" class="site-search-back" aria-label="關閉搜尋" @click="closeSheet">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" /></svg>
        </button>
        <label class="sr-only" for="siteSearchSheetInput">搜尋遊戲、AppID 或 TAG</label>
        <div class="site-search-field">
          <svg class="site-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input id="siteSearchSheetInput" ref="sheetInput" v-model="query" type="search" placeholder="搜尋遊戲、AppID 或 TAG"
            autocomplete="off" spellcheck="false" enterkeyhint="search" @keydown="sheetKeydown" />
          <button v-if="query" type="button" class="site-search-clear" aria-label="清除搜尋" @click="clearQuery">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
      </div>
      <div class="site-search-sheet-body">
        <SiteSearchResults v-if="sheetOpen" id-prefix="site-search-sheet" :query="query" :state="state" :result="result" :recent="recent"
          :tags="starters" :active="-1" compact @remember="remember" @fill="fill" @forget="forget" @clear="clearAll" />
      </div>
    </dialog>
  </div>
</template>
