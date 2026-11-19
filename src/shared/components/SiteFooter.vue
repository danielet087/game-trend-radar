<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { readMotion, subscribeMotion, toggleMotion } from '../state/motion';

withDefaults(defineProps<{ page?: string }>(), { page: 'home' });
// Phones move the motion switch out of the compact header into the footer.
const motion = ref(readMotion());
const unsubscribe = subscribeMotion(value => { motion.value = value; });
const motionLabel = computed(() => motion.value.reduced
  ? '裝置已設定減少動態效果'
  : motion.value.enabled ? '關閉動態效果' : '開啟動態效果');
onBeforeUnmount(unsubscribe);
</script>

<template>
  <footer class="site-footer">
    <div v-if="page === 'twitch'">
      <strong>GAME TREND RADAR<span>・發現遊戲的下一站</span></strong>
      <p>Twitch 新作觀測實驗 · 資料來源與時間見各款明細 · 本站與 Twitch 無隸屬關係</p>
    </div>
    <div v-else>
      <a class="footer-brand" href="./index.html">GAME TREND RADAR<span>◎</span></a>
      <p v-if="page === 'game'">
        資料來源：Steam 商店、Steam Community 與 IGDB。<br />遊戲名稱與封面屬各自權利人所有；本站與
        Valve / Steam、Nintendo、Sony / PlayStation 無官方隸屬關係。
      </p>
      <p v-else>
        資料來源：Steam、IGDB、Nintendo 與 PlayStation 官方公告。<br />遊戲名稱與封面屬各自權利人所有；本站與
        Valve / Steam 無官方隸屬關係。
      </p>
    </div>
    <div class="footer-actions">
      <button class="footer-motion" type="button" :disabled="motion.reduced" :aria-pressed="motion.enabled" :aria-label="motionLabel" @click="toggleMotion">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="motion.enabled ? 'M9 5v14M15 5v14' : 'm8 5 11 7-11 7Z'" /></svg>
        <span>{{ motion.enabled ? '動態 ON' : '動態 OFF' }}</span>
      </button>
      <a href="#mainContent" class="back-top">回到頂端 ↑</a>
    </div>
  </footer>
</template>
