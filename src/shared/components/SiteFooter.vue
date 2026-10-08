<script setup lang="ts">
withDefaults(defineProps<{ page?: string }>(), { page: 'home' });
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
    <a href="#mainContent" class="back-top">回到頂端 ↑</a>
  </footer>
</template>
