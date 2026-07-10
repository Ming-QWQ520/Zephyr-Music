<script setup lang="ts">
import { computed, ref, nextTick, onMounted, watch } from "vue";
import { usePlayerStore } from "@/stores/player";
import Icon from "@/components/Icon.vue";

const store = usePlayerStore();

const queue = computed(() => store.queue);
const currentId = computed(() => store.currentSong?.id);
const listRef = ref<HTMLElement | null>(null);

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
  store.clearQueue();
}

/** 滚动到当前播放歌曲（复位，直接设置 scrollTop 避免影响父容器） */
function scrollToCurrent() {
  const idx = store.currentIndex;
  if (idx < 0 || !listRef.value) return;
  const list = listRef.value;
  const el = list.children[idx] as HTMLElement;
  if (!el) return;
  const targetTop = el.offsetTop - list.offsetTop;
  list.scrollTo({ top: targetTop, behavior: "smooth" });
}

/** 打开时自动滚动到当前播放歌曲 */
onMounted(() => {
  nextTick(() => {
    const idx = store.currentIndex;
    if (idx > 0 && listRef.value) {
      const list = listRef.value;
      const el = list.children[idx] as HTMLElement;
      if (el) list.scrollTop = el.offsetTop - list.offsetTop;
    }
  });
});

// ===== 拖拽排序 =====
const dragFromIdx = ref<number | null>(null);
const dragOverIdx = ref<number | null>(null);

function onDragStart(e: DragEvent, idx: number) {
  dragFromIdx.value = idx;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  }
}
function onDragOver(e: DragEvent, idx: number) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  dragOverIdx.value = idx;
}
function onDragLeave() {
  // 不立即清空，避免抖动
}
function onDrop(e: DragEvent, idx: number) {
  e.preventDefault();
  const from = dragFromIdx.value;
  if (from !== null && from !== idx) {
    store.moveInQueue(from, idx);
  }
  dragFromIdx.value = null;
  dragOverIdx.value = null;
}
function onDragEnd() {
  dragFromIdx.value = null;
  dragOverIdx.value = null;
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
      <div class="header-actions">
        <button v-if="queue.length && store.currentIndex >= 0" class="locate-btn" title="定位当前播放" @click="scrollToCurrent">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg>
          <span>复位</span>
        </button>
        <button v-if="queue.length" class="clear-btn" @click="clear">
          <Icon name="trash" :size="14" />
          <span>清空</span>
        </button>
      </div>
    </header>

    <div ref="listRef" class="list nice-scroll">
      <div v-if="!queue.length" class="empty">
        <Icon name="list" :size="42" />
        <p>播放队列为空</p>
        <p class="hint">从搜索结果中添加歌曲到队列开始播放。</p>
      </div>

      <div
        v-for="(song, idx) in queue"
        :key="song.id"
        class="row"
        :class="{ active: song.id === currentId, playing: song.id === currentId && store.isPlaying, 'drag-over': dragOverIdx === idx && dragFromIdx !== idx, dragging: dragFromIdx === idx }"
        draggable="true"
        @dblclick="play(idx)"
        @dragstart="onDragStart($event, idx)"
        @dragover="onDragOver($event, idx)"
        @dragleave="onDragLeave"
        @drop="onDrop($event, idx)"
        @dragend="onDragEnd"
      >
        <div class="drag-handle" title="拖拽排序">
          <Icon name="grip" :size="14" />
        </div>
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
.header-actions { display: flex; gap: 8px; }
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
.locate-btn {
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
.locate-btn:hover {
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
  transition: background 0.12s, opacity 0.12s, transform 0.12s;
  cursor: default;
}
.row:hover {
  background: var(--bg-hover);
}
.row.active {
  background: var(--bg-active);
}
.row.dragging {
  opacity: 0.4;
}
.row.drag-over {
  border-top: 2px solid var(--accent);
  padding-top: 4px;
}
.drag-handle {
  width: 20px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  cursor: grab;
  opacity: 0;
  transition: opacity 0.15s;
}
.row:hover .drag-handle {
  opacity: 0.6;
}
.drag-handle:hover {
  opacity: 1 !important;
  color: var(--text-secondary);
}
.drag-handle:active {
  cursor: grabbing;
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
