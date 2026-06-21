<script setup lang="ts">
import { computed } from "vue";
import { usePlayerStore } from "@/stores/player";
import Icon from "@/components/Icon.vue";

const store = usePlayerStore();

const queue = computed(() => store.queue);
const currentId = computed(() => store.currentSong?.id);

function play(index: number) {
  if (index === store.currentIndex) {
    store.togglePlay();
    return;
  }
  store.currentIndex = index;
  store.setPlaying(true);
  const s = store.queue[index];
  if (s) store.loadLyrics(s);
}

function remove(index: number) {
  store.removeFromQueue(index);
}

function clear() {
  store.queue = [];
  store.currentIndex = -1;
  store.setPlaying(false);
  store.lyrics = [];
  store.activeLyricIndex = -1;
}
</script>

<template>
  <section class="queue-view">
    <header class="view-header">
      <div class="title-block">
        <h1>播放队列</h1>
        <p class="sub">
          共 <span class="count">{{ queue.length }}</span> 首
        </p>
      </div>
      <button v-if="queue.length" class="clear-btn" @click="clear">
        <Icon name="trash" :size="14" />
        <span>清空</span>
      </button>
    </header>

    <div class="list nice-scroll">
      <div v-if="!queue.length" class="empty">
        <Icon name="list" :size="42" />
        <p>播放队列为空</p>
        <p class="hint">从搜索结果中添加歌曲到队列开始播放。</p>
      </div>

      <div
        v-for="(song, idx) in queue"
        :key="song.id"
        class="row"
        :class="{ active: song.id === currentId, playing: song.id === currentId && store.isPlaying }"
        @dblclick="play(idx)"
      >
        <div class="idx-cell" @click="play(idx)">
          <span v-if="song.id !== currentId" class="idx">{{ idx + 1 }}</span>
          <template v-else>
            <Icon v-if="store.isPlaying" name="volume" :size="14" class="playing-icon" />
            <Icon v-else name="pause" :size="14" class="paused-icon" />
          </template>
        </div>
        <div class="cover">
          <img v-if="song.pic" :src="song.pic" :alt="song.name" referrerpolicy="no-referrer" />
          <Icon v-else name="music" :size="14" />
        </div>
        <div class="meta">
          <div class="title truncate">{{ song.name }}</div>
          <div class="artist truncate">{{ song.artist }}</div>
        </div>
        <div class="actions">
          <button class="row-action" title="从队列移除" @click.stop="remove(idx)">
            <Icon name="close" :size="14" />
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.queue-view {
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
.clear-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 12px;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.clear-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-right: 4px;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  color: var(--text-tertiary);
}
.empty .hint {
  font-size: 12px;
  max-width: 320px;
  text-align: center;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  border-radius: 8px;
  transition: background 0.12s;
  cursor: default;
}
.row:hover {
  background: var(--bg-hover);
}
.row.active {
  background: var(--bg-active);
}
.idx-cell {
  width: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.row.active .idx-cell {
  color: var(--accent);
}
.playing-icon {
  animation: pulse 1.2s ease-in-out infinite;
}
.cover {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 6px;
  background: var(--bg-elev-3);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.meta {
  flex: 1;
  min-width: 0;
}
.meta .title {
  font-size: 13px;
  color: var(--text);
  font-weight: 500;
}
.row.active .title {
  color: var(--accent);
}
.meta .artist {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 1px;
}
.actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}
.row:hover .actions,
.row.active .actions {
  opacity: 1;
}
.row-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: var(--text-tertiary);
  transition: color 0.15s, background 0.15s;
}
.row-action:hover {
  color: var(--accent);
  background: var(--accent-soft);
}

@media (max-width: 720px) {
  .queue-view { padding: 16px; }
  .actions { opacity: 1; }
}
</style>
