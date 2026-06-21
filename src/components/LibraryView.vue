<script setup lang="ts">
import { computed } from "vue";
import { usePlayerStore } from "@/stores/player";
import Icon from "@/components/Icon.vue";

const store = usePlayerStore();

const history = computed(() => store.history);

function play(song: Song, idx: number) {
  store.playList(history.value, idx);
}
</script>

<script lang="ts">
import type { Song } from "@/types";
</script>

<template>
  <section class="library-view">
    <header class="view-header">
      <div class="title-block">
        <h1>最近播放</h1>
        <p class="sub">
          共 <span class="count">{{ history.length }}</span> 首
        </p>
      </div>
    </header>

    <div v-if="!history.length" class="empty">
      <Icon name="history" :size="42" />
      <p>暂无播放记录</p>
      <p class="hint">播放过的歌曲会出现在这里，方便快速回看。</p>
    </div>

    <div v-else class="grid nice-scroll">
      <button
        v-for="(song, idx) in history"
        :key="song.id"
        class="card"
        :class="{ active: store.currentSong?.id === song.id }"
        @click="play(song, idx)"
      >
        <div class="cover">
          <img v-if="song.pic" :src="song.pic" :alt="song.name" referrerpolicy="no-referrer" />
          <Icon v-else name="music" :size="28" />
          <div class="overlay">
            <div class="play-circle">
              <Icon :name="store.currentSong?.id === song.id && store.isPlaying ? 'pause' : 'play'" :size="20" />
            </div>
          </div>
        </div>
        <div class="meta">
          <div class="title truncate">{{ song.name }}</div>
          <div class="artist truncate">{{ song.artist }}</div>
        </div>
      </button>
    </div>
  </section>
</template>

<style scoped>
.library-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px 28px 16px;
  gap: 16px;
}
.view-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}
.title-block h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.3px;
}
.sub {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}
.sub .count {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-tertiary);
}
.empty .hint {
  font-size: 12px;
  max-width: 320px;
  text-align: center;
}

.grid {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 18px;
  padding-right: 4px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
  transition: transform 0.18s var(--ease-out);
}
.card:hover {
  transform: translateY(-3px);
}
.card:hover .cover {
  box-shadow: var(--shadow-md);
}
.card.active .title {
  color: var(--accent);
}
.cover {
  position: relative;
  aspect-ratio: 1 / 1;
  width: 100%;
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-elev-3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  box-shadow: var(--shadow-sm);
  transition: box-shadow 0.18s var(--ease-out);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.55) 100%);
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 10px;
  opacity: 0;
  transition: opacity 0.18s var(--ease-out);
}
.card:hover .overlay {
  opacity: 1;
}
.play-circle {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px rgba(250, 35, 59, 0.5);
}
.meta .title {
  font-size: 13px;
  color: var(--text);
  font-weight: 500;
}
.meta .artist {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 1px;
}

@media (max-width: 720px) {
  .library-view { padding: 16px; }
  .grid {
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 14px;
  }
}
</style>
