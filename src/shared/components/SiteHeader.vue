<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import radarMark from '../../../assets/radar-mark.svg';
import { savedCount, subscribeSaved } from '../state/favorites';
import { readMotion, subscribeMotion, toggleMotion } from '../state/motion';

const props = withDefaults(defineProps<{ page?: string }>(), { page: 'home' });
const disclosure = ref<HTMLDetailsElement>();
const count = ref(savedCount());
const motion = ref(readMotion());
const exploreActive = computed(() => ['all', 'games', 'upcoming', 'released', 'explore', 'growth', 'analysis', 'twitch'].includes(props.page));
const motionLabel = computed(() => motion.value.reduced
  ? '裝置已設定減少動態效果'
  : motion.value.enabled ? '關閉動態效果' : '開啟動態效果');
const unsubscribeSaved = subscribeSaved(value => { count.value = value.count; });
const unsubscribeMotion = subscribeMotion(value => { motion.value = value; });

function closeMenu(): void {
  if (disclosure.value) disclosure.value.open = false;
}

function outsidePointer(event: PointerEvent): void {
  if (event.target instanceof Node && !disclosure.value?.contains(event.target)) closeMenu();
}

function focusOut(event: FocusEvent): void {
  if (event.relatedTarget instanceof Node) {
    if (!disclosure.value?.contains(event.relatedTarget)) closeMenu();
    return;
  }
  // Wait for the destination focus; closing on blur can swallow a link click.
  requestAnimationFrame(() => {
    if (!disclosure.value?.contains(document.activeElement)) closeMenu();
  });
}

function escapeMenu(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !disclosure.value?.open) return;
  event.preventDefault();
  event.stopPropagation();
  closeMenu();
  disclosure.value.querySelector('summary')?.focus();
}

function moveMenuFocus(event: KeyboardEvent): void {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const menu = disclosure.value;
  if (!menu) return;
  const links = [...menu.querySelectorAll<HTMLAnchorElement>('.explore-route')];
  const index = links.findIndex(link => link === document.activeElement);
  let next: number;
  if (event.key === 'ArrowDown') next = (index + 1) % links.length;
  else if (event.key === 'ArrowUp') next = index <= 0 ? links.length - 1 : index - 1;
  else if (index >= 0 && event.key === 'Home') next = 0;
  else if (index >= 0 && event.key === 'End') next = links.length - 1;
  else return;
  event.preventDefault();
  menu.open = true;
  links[next]?.focus();
}

onMounted(() => {
  document.addEventListener('pointerdown', outsidePointer);
  document.addEventListener('keydown', escapeMenu, true);
  window.addEventListener('pageshow', closeMenu);
});

onBeforeUnmount(() => {
  unsubscribeSaved();
  unsubscribeMotion();
  document.removeEventListener('pointerdown', outsidePointer);
  document.removeEventListener('keydown', escapeMenu, true);
  window.removeEventListener('pageshow', closeMenu);
});
</script>

<template>
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="./index.html" aria-label="Game Trend Radar 首頁">
        <img :src="radarMark" width="40" height="40" alt="" />
        <span>GAME TREND <b>RADAR<span class="brand-dot">.</span></b></span>
      </a>
      <nav class="main-nav" aria-label="主要導覽">
        <a href="./index.html" :aria-current="page === 'home' ? 'page' : undefined">發售月曆</a>
        <details ref="disclosure" class="explore-nav" :data-active="exploreActive ? '' : undefined" @focusout="focusOut" @keydown="moveMenuFocus">
          <summary class="explore-toggle" aria-controls="exploreMenu">遊戲探索<svg class="explore-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></summary>
          <div id="exploreMenu" class="explore-menu">
            <a class="explore-route explore-route-all" href="./games.html" :aria-current="['all', 'games'].includes(page) ? 'page' : undefined">
              <span class="explore-route-art"><svg viewBox="0 0 80 80" aria-hidden="true"><rect x="14" y="15" width="22" height="22" rx="6" /><rect x="44" y="15" width="22" height="22" rx="6" /><rect x="14" y="45" width="22" height="22" rx="6" /><path d="M55 47v18m-9-9h18" /></svg></span>
              <span class="explore-route-copy"><span class="explore-route-title">全部遊戲</span><span class="explore-route-note">瀏覽本站全部收錄</span></span>
              <span class="explore-route-arrow" aria-hidden="true">{{ ['all', 'games'].includes(page) ? '✓' : '↗' }}</span>
            </a>
            <a class="explore-route explore-route-upcoming" href="./upcoming.html" :aria-current="page === 'upcoming' ? 'page' : undefined">
              <span class="explore-route-art"><svg viewBox="0 0 80 80" aria-hidden="true"><rect x="13" y="18" width="49" height="47" rx="10" /><path d="M13 33h49M26 12v13m22-13v13M27 47h8m-8 10h8" /><circle cx="59" cy="58" r="15" /><path d="m53 58 5 5 8-10" /></svg></span>
              <span class="explore-route-copy"><span class="explore-route-title">即將上市</span><span class="explore-route-note">未來 45 天的新作</span></span>
              <span class="explore-route-arrow" aria-hidden="true">{{ page === 'upcoming' ? '✓' : '↗' }}</span>
            </a>
            <a class="explore-route explore-route-released" href="./released.html" :aria-current="page === 'released' ? 'page' : undefined">
              <span class="explore-route-art"><svg viewBox="0 0 80 80" aria-hidden="true"><path d="m24 49 3-15 26-20 13 13-20 26-15 3-7-7Z" /><circle cx="50" cy="30" r="6" /><path d="m29 56-5 13-2-11-11-2 13-6M43 20l-17-1-9 16 12-1m31 12 1 17-16 9 1-19" /></svg></span>
              <span class="explore-route-copy"><span class="explore-route-title">近期上市</span><span class="explore-route-note">近 30 天的新登場</span></span>
              <span class="explore-route-arrow" aria-hidden="true">{{ page === 'released' ? '✓' : '↗' }}</span>
            </a>
            <a class="explore-route explore-route-tags" href="./explore.html" :aria-current="page === 'explore' ? 'page' : undefined">
              <span class="explore-route-art"><svg viewBox="0 0 80 80" aria-hidden="true"><path d="m13 37 27-24 24 4 4 24-27 27-28-31Z" /><circle cx="52" cy="28" r="5" /><path d="m25 40 12 13m-5-20 13 13M13 17l-4-6m55 48 7 2M49 72l1 5" /></svg></span>
              <span class="explore-route-copy"><span class="explore-route-title">TAG 探索</span><span class="explore-route-note">依照喜好找新作</span></span>
              <span class="explore-route-arrow" aria-hidden="true">{{ page === 'explore' ? '✓' : '↗' }}</span>
            </a>
            <p class="explore-menu-label">觀察與分析</p>
            <a class="explore-route explore-route-growth" href="./growth.html" :aria-current="page === 'growth' ? 'page' : undefined">
              <span class="explore-route-art"><svg viewBox="0 0 80 80" aria-hidden="true"><path d="M15 16v48h52M22 50l15-16 12 7 16-22M53 19h12v13" /><circle cx="37" cy="34" r="4" /></svg></span>
              <span class="explore-route-copy"><span class="explore-route-title">關注成長榜</span><span class="explore-route-note">找出正在上升的新作</span></span>
              <span class="explore-route-arrow" aria-hidden="true">{{ page === 'growth' ? '✓' : '↗' }}</span>
            </a>
            <a class="explore-route explore-route-analysis" href="./analysis.html" :aria-current="page === 'analysis' ? 'page' : undefined">
              <span class="explore-route-art"><svg viewBox="0 0 80 80" aria-hidden="true"><rect x="12" y="20" width="23" height="42" rx="6" /><rect x="45" y="13" width="23" height="49" rx="6" /><path d="M20 33h7m-7 9h7m26-14h7m-7 9h7m-7 9h7M25 71h30" /></svg></span>
              <span class="explore-route-copy"><span class="explore-route-title">遊戲比較 <small>實驗</small></span><span class="explore-route-note">一次並排 2～3 款</span></span>
              <span class="explore-route-arrow" aria-hidden="true">{{ page === 'analysis' ? '✓' : '↗' }}</span>
            </a>
            <a class="explore-route explore-route-twitch" href="./twitch.html" :aria-current="page === 'twitch' ? 'page' : undefined">
              <span class="explore-route-art"><svg viewBox="0 0 80 80" aria-hidden="true"><rect x="15" y="25" width="50" height="38" rx="10" /><path d="m28 12 12 13 12-13M29 72h22M31 39v8m18-8v8m-16 7h14M6 34v16m68-16v16" /></svg></span>
              <span class="explore-route-copy"><span class="explore-route-title">Twitch 新作觀測 <small>實驗</small></span><span class="explore-route-note">直播熱度與全新判讀</span></span>
              <span class="explore-route-arrow" aria-hidden="true">{{ page === 'twitch' ? '✓' : '↗' }}</span>
            </a>
          </div>
        </details>
        <a href="./saved.html" :aria-current="page === 'saved' ? 'page' : undefined">我的收藏 <span class="saved-count" data-saved-count>{{ count }}</span></a>
      </nav>
      <button id="motionToggle" class="motion-toggle" type="button" :disabled="motion.reduced" :aria-pressed="motion.enabled" :aria-label="motionLabel" :title="motionLabel" @click="toggleMotion">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="motion.enabled ? 'M9 5v14M15 5v14' : 'm8 5 11 7-11 7Z'" /></svg>
        <span>{{ motion.enabled ? '動態 ON' : '動態 OFF' }}</span>
      </button>
      <span class="header-tag">發現遊戲的下一站 <span aria-hidden="true">↗</span></span>
    </div>
  </header>
</template>
