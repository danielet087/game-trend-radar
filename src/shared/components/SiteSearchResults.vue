<script setup lang="ts">
import { computed } from 'vue';
import { artShape } from '../artwork.js';
import type { SearchResult, SearchTag } from '../search/match.ts';

// The search's content. On desktop it is the combobox's listbox (options move
// with ↑↓ while focus stays in the field); in the phone sheet the same rows are
// plain links and buttons.
const props = defineProps<{
  idPrefix: string;
  query: string;
  state: string;
  result: SearchResult;
  recent: string[];
  tags: SearchTag[];
  active: number;
  compact: boolean;
}>();
const emit = defineEmits<{ remember: []; fill: [term: string]; forget: [term: string]; clear: [] }>();

const term = computed(() => props.query.trim());
const exact = computed(() => props.result.games[0]?.exact === true);
const gameHeading = computed(() => exact.value ? 'AppID 完全相符' : `${props.result.gameCount} 筆相符`);
const allLabel = computed(() => {
  if (exact.value) return `在全部遊戲搜尋「${term.value}」`;
  if (!props.result.games.length) return '在全部遊戲看有這些 TAG 的遊戲';
  return props.result.pageCount > 0 ? `在全部遊戲看全部 ${props.result.pageCount} 筆` : `在全部遊戲搜尋「${term.value}」`;
});
const slashDate = (date: string) => (date || '').replaceAll('-', '/');

const listbox = computed(() => props.compact ? {} : { id: `${props.idPrefix}-listbox`, role: 'listbox', 'aria-label': '搜尋' });
const group = (label: string) => props.compact ? {} : { role: 'group', 'aria-label': label };
// Inside the listbox only options may be read; its visible headings name the groups instead.
const decorative = computed(() => props.compact ? {} : { 'aria-hidden': 'true' as const });
const option = (index: number) => props.compact ? {} : {
  id: `${props.idPrefix}-option-${index}`, role: 'option', tabindex: -1,
  'aria-selected': (props.active === index ? 'true' : 'false') as 'true' | 'false',
};
// On desktop the × is for the mouse; the keyboard removes the selected term with Delete.
const forgetButton = (item: string) => props.compact
  ? { 'aria-label': `從最近搜尋移除 ${item}` }
  : { 'aria-hidden': 'true' as const, tabindex: -1 };
const keepFocus = (event: Event) => { if (!props.compact) event.preventDefault(); };
const shape = (event: Event) => {
  const image = event.target as HTMLImageElement;
  image.classList.toggle('is-whole', artShape(image).whole);
};
const hideImage = (event: Event) => { (event.target as HTMLImageElement).hidden = true; };
</script>

<template>
  <div class="site-search-results">
    <template v-if="term">
      <p v-if="state === 'error'" class="site-search-status" role="status">遊戲資料暫時讀不到，請稍後再試，或按 Enter 到全部遊戲搜尋。</p>
      <p v-else-if="state !== 'ready'" class="site-search-status" role="status">正在讀取遊戲資料…</p>
      <div v-else-if="!result.games.length && !result.tags.length" class="site-search-empty" role="status">
        <span class="site-search-empty-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M8 11h6" /></svg></span>
        <strong>找不到「{{ term }}」</strong>
        <p>雷達只收錄一年內上市、通過收錄條件的新作。可以試試中文名、英文原名或 Steam AppID。</p>
        <div class="site-search-empty-links">
          <a class="site-search-pill is-primary" href="./explore.html">去 TAG 探索</a>
          <a class="site-search-pill" href="./games.html">看全部遊戲</a>
        </div>
      </div>
      <template v-else>
        <div v-bind="listbox" class="site-search-list">
          <section v-if="result.games.length" v-bind="group(`遊戲，${gameHeading}`)" class="site-search-section">
            <div class="site-search-heading-row" v-bind="decorative">
              <h3 class="site-search-heading">遊戲 <span>· {{ gameHeading }}</span></h3>
              <span v-if="!compact && !exact" class="site-search-order">名稱開頭相符的先，再依發售日</span>
            </div>
            <a v-for="(game, index) in result.games" :key="game.key" v-bind="option(index)" class="site-search-game"
              :href="game.url" @mousedown="keepFocus" @click="emit('remember')">
              <span class="site-search-art"><img v-if="game.art" :src="game.art" alt="" width="616" height="353" loading="lazy" decoding="async" @load="shape" @error="hideImage" /></span>
              <span class="site-search-copy">
                <span class="site-search-name"><template v-for="(part, n) in game.titleParts" :key="n"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
                <span v-if="game.sub" class="site-search-sub"><template v-for="(part, n) in game.subParts" :key="n"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
                <span v-if="game.exact" class="site-search-appid">Steam AppID <mark>{{ game.appid }}</mark></span>
                <span class="site-search-chips">
                  <span v-for="chip in game.chips" :key="chip.label" :class="['site-search-chip', `is-${chip.family}`]">{{ chip.label }}</span>
                  <template v-if="compact"><b class="site-search-date">{{ slashDate(game.date) }}</b><span class="site-search-state" :data-kind="game.statusKind">{{ game.status }}</span></template>
                </span>
              </span>
              <span v-if="!compact" class="site-search-meta">
                <time :datetime="game.date">{{ slashDate(game.date) }}</time>
                <span class="site-search-state" :data-kind="game.statusKind">{{ game.status }}</span>
                <span v-if="game.interest" class="site-search-interest">{{ game.interest }}</span>
              </span>
            </a>
          </section>
          <section v-if="result.tags.length" v-bind="group(`TAG，${result.tagCount} 個`)" class="site-search-section">
            <div class="site-search-heading-row" v-bind="decorative">
              <h3 class="site-search-heading">TAG <span>· {{ result.tagCount }} 個</span></h3>
            </div>
            <a v-for="(tag, index) in result.tags" :key="tag.key" v-bind="option(result.games.length + index)" class="site-search-tag-row"
              :href="tag.url" @mousedown="keepFocus" @click="emit('remember')">
              <span class="site-search-tag-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8L3 12Z" /><circle cx="7.5" cy="7.5" r="1.5" /></svg></span>
              <span class="site-search-copy">
                <span class="site-search-name"><template v-for="(part, n) in tag.labelParts" :key="n"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
                <span v-if="tag.key !== tag.label" class="site-search-sub"><template v-for="(part, n) in tag.keyParts" :key="n"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
              </span>
              <span class="site-search-count">{{ tag.count }} 款</span>
            </a>
          </section>
        </div>
        <template v-if="!result.games.length">
          <div class="site-search-heading-row"><h3 class="site-search-heading">遊戲</h3></div>
          <p class="site-search-note">沒有名稱裡有「{{ term }}」的遊戲。</p>
        </template>
        <div class="site-search-footer">
          <a class="site-search-all" :href="result.allURL" @mousedown="keepFocus" @click="emit('remember')">{{ allLabel }}<span v-if="!compact" aria-hidden="true">→</span></a>
          <span v-if="!compact" class="site-search-keys" aria-hidden="true"><span><kbd>↑</kbd> <kbd>↓</kbd> 選擇</span><span><kbd>Enter</kbd> 開啟</span><span><kbd>Esc</kbd> 關閉</span></span>
        </div>
      </template>
    </template>
    <template v-else>
      <div v-if="recent.length" class="site-search-heading-row">
        <h3 class="site-search-heading">最近搜尋</h3>
        <button type="button" class="site-search-text-button" @mousedown="keepFocus" @click="emit('clear')">清除</button>
      </div>
      <div v-if="recent.length || tags.length" v-bind="listbox" class="site-search-list">
        <div v-if="recent.length" v-bind="group('最近搜尋')" class="site-search-recent-list">
          <div v-for="(item, index) in recent" :key="item" class="site-search-recent">
            <button type="button" v-bind="option(index)" class="site-search-recent-term" @mousedown="keepFocus" @click="emit('fill', item)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg><span>{{ item }}</span>
            </button>
            <button type="button" v-bind="forgetButton(item)" class="site-search-forget" @mousedown="keepFocus" @click.stop="emit('forget', item)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
        </div>
        <template v-if="tags.length">
          <div class="site-search-heading-row" v-bind="decorative"><h3 class="site-search-heading">常見 TAG</h3></div>
          <div v-bind="group('常見 TAG')" class="site-search-tags">
            <a v-for="(tag, index) in tags" :key="tag.key" v-bind="option(recent.length + index)" class="site-search-tag"
              :href="tag.url" :aria-label="`${tag.label}，${tag.count} 款`" @mousedown="keepFocus">{{ tag.label }}<span aria-hidden="true">{{ tag.count }}</span></a>
          </div>
        </template>
      </div>
      <p v-if="state === 'loading'" class="site-search-status" role="status">正在讀取遊戲資料…</p>
      <p v-else-if="state === 'error'" class="site-search-status" role="status">遊戲資料暫時讀不到，請稍後再試。</p>
      <p class="site-search-hint">可以用中文名、英文原名、Steam AppID 或 TAG 找。最近搜尋只記在這台裝置，最多 5 筆。</p>
    </template>
  </div>
</template>
