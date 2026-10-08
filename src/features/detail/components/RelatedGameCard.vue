<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RadarArtwork, cancelArtwork } from '../../../shared/artwork.js';

const props = defineProps({
  game: { type: Object, required: true },
  basis: { type: String, required: true },
  selectedTag: { type: String, default: '' },
  ctx: { type: Object, required: true },
});
const image = ref(null);
const loaded = ref(false);
const exhausted = ref(false);
const names = computed(() => props.ctx.D.releaseDisplayNames(props.game));
const english = computed(() => names.value.nameEn !== names.value.name ? names.value.nameEn : '');
const shared = computed(() => props.selectedTag
  ? [props.selectedTag, ...props.game.sharedTags.filter(tag => props.ctx.R.key(tag) !== props.ctx.R.key(props.selectedTag))]
  : props.game.sharedTags);
onMounted(() => {
  if (image.value) RadarArtwork.load(image.value, props.game, {
    onLoad: () => { loaded.value = true; },
    onExhausted: () => { exhausted.value = true; },
  });
});
onBeforeUnmount(() => { if (image.value) cancelArtwork(image.value); });
</script>

<template>
  <a class="game-related-link" :href="ctx.detailURL(game)" :aria-label="`查看 ${names.name} 遊戲資訊`">
    <div class="related-cover">
      <span v-if="!loaded" class="cover-placeholder" aria-hidden="true"></span>
      <img v-if="game.art && !exhausted" ref="image" alt="" loading="lazy" decoding="async">
    </div>
    <div class="game-related-copy">
      <div class="related-names">
        <strong :title="names.name">{{ names.name }}</strong>
        <p v-if="english" class="related-english" :title="english">{{ english }}</p>
      </div>
      <div class="match-tags">
        <span v-if="basis === 'date'">發售時間相近</span>
        <template v-else>
          <span v-for="tag in shared.slice(0, 2)" :key="ctx.R.key(tag)" :title="`共同 TAG：${tag}`">{{ ctx.R.label(tag) }}</span>
        </template>
      </div>
      <div class="related-meta">
        <time :datetime="game.date">{{ game.date.replaceAll('-', '/') }}</time>
        <b>{{ ctx.interestText(game) }}</b>
      </div>
      <span class="related-action">認識這款遊戲<span aria-hidden="true">↗</span></span>
    </div>
  </a>
</template>
