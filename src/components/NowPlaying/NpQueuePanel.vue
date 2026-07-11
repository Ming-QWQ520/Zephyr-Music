<script setup lang="ts">
import { ref } from "vue";
/**
 * 播放列表面板（queue-panel）
 *
 * - qp-head / qp-list / qp-item
 * - 复位键（qp-locate-fab）
 * - 转圈占位（queueLoading 期间）
 * - Transition 进入/退出动画
 * - 滚动到当前播放：scrollQueueToCurrent
 *
 * qpListRef 直接绑定 useNowPlaying 的模块级 ref，使 toggleQueue /
 * scrollQueueToCurrent 能跨组件访问列表 DOM。
 *
 * 自身可见性由 showQueue 控制（v-if 内置在组件内）。父组件只需挂载
 * <NpQueuePanel />。
 */
import Icon from "@/components/Icon.vue";
import { useNowPlaying } from "./useNowPlaying";

const {
  store,
  showQueue,
  queueLoading,
  qpListRef,
  queueList,
  song,
  scrollQueueToCurrent,
} = useNowPlaying();

function playQueueItem(idx: number) {
  store.currentIndex = idx;
  store.setPlaying(true);
  const s = store.queue[idx];
  if (s) store.loadLyrics(s);
}

// ===== 拖动排序 =====
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
function onDrop(e: DragEvent, idx: number) {
  e.preventDefault();
  const from = dragFromIdx.value;
  if (from !== null && from !== idx) store.moveInQueue(from, idx);
  dragFromIdx.value = null;
  dragOverIdx.value = null;
}
function onDragEnd() {
  dragFromIdx.value = null;
  dragOverIdx.value = null;
}
</script>

<template>
  <Transition name="queue-slide">
    <aside v-if="showQueue" class="queue-panel">
      <header class="qp-head">
        <h3>播放队列</h3>
        <span class="qp-count">{{ queueList.length }} 首</span>
        <button class="icon-btn" title="关闭" @click="showQueue = false">
          <Icon name="close" :size="18" />
        </button>
      </header>
      <div v-if="queueLoading" class="qp-loading">
        <div class="spinner" />
      </div>
      <div v-else ref="qpListRef" class="qp-list nice-scroll">
        <button
          v-for="(s, idx) in queueList"
          :key="s.id"
          class="qp-item"
          :class="{ active: s.id === song?.id, 'drag-over': dragOverIdx === idx && dragFromIdx !== idx, dragging: dragFromIdx === idx }"
          draggable="true"
          @click="playQueueItem(idx)"
          @dragstart="onDragStart($event, idx)"
          @dragover="onDragOver($event, idx)"
          @drop="onDrop($event, idx)"
          @dragend="onDragEnd"
        >
          <div class="cover">
            <img v-if="s.pic" :src="s.pic" :alt="s.name" referrerpolicy="no-referrer" loading="lazy" />
            <Icon v-else name="music" :size="14" />
          </div>
          <div class="meta">
            <div class="title truncate">{{ s.name }}</div>
            <div class="artist truncate">{{ s.artist }}</div>
          </div>
          <Icon v-if="s.id === song?.id && store.isPlaying" name="volume" :size="14" class="now-playing" />
        </button>
      </div>
      <!-- 复位键（浮动在右下角） -->
      <button v-if="store.currentIndex >= 0 && !queueLoading" class="qp-locate-fab" title="定位当前播放" @click.stop="scrollQueueToCurrent(true)">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg>
      </button>
    </aside>
  </Transition>
</template>

<style scoped>
/* ----- Queue panel ----- */
.queue-panel {
  position: absolute;
  top: 50%;
  right: 16px;
  transform: translateY(-50%);
  width: min(300px, 26vw);
  max-height: 70vh;
  height: 70vh;
  z-index: 30;
  background: rgba(10, 10, 12, 0.88);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid var(--border);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  padding: 12px;
  box-shadow: -8px 0 40px rgba(0, 0, 0, 0.5);
}
/* 复位键（浮动在播放队列右下角） */
.qp-locate-fab {
  position: absolute;
  right: 12px; bottom: 12px;
  width: 36px; height: 36px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  z-index: 10;
  transition: transform 0.15s var(--ease-out), opacity 0.15s;
  cursor: pointer;
}
.qp-locate-fab:hover { transform: scale(1.1); }
.qp-locate-fab:active { transform: scale(0.95); }
.qp-loading { flex: 1; display: flex; align-items: center; justify-content: center; }
.qp-loading .spinner { width: 28px; height: 28px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
.queue-slide-enter-active,
.queue-slide-leave-active {
  transition: transform 0.32s var(--ease-out), opacity 0.32s var(--ease-out);
}
.queue-slide-enter-from,
.queue-slide-leave-to {
  transform: translateY(-50%) translateX(40px);
  opacity: 0;
}
.qp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px 12px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
}
.qp-head h3 { margin: 0; font-size: 16px; font-weight: 600; }
.qp-count {
  flex: 1;
  font-size: 12px;
  color: var(--text-tertiary);
}
.qp-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.qp-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px;
  border-radius: 8px;
  text-align: left;
  transition: background 0.15s;
}
.qp-item:hover { background: rgba(255, 255, 255, 0.06); }
.qp-item.active { background: rgba(255, 255, 255, 0.1); }
.qp-item.drag-over { border-top: 2px solid var(--accent); }
.qp-item.dragging { opacity: 0.4; }
.qp-item .cover {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  background: var(--bg-elev-3);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.qp-item .cover img { width: 100%; height: 100%; object-fit: cover; }
.qp-item .meta { flex: 1; min-width: 0; }
.qp-item .title { font-size: 13px; color: var(--text); font-weight: 500; }
.qp-item.active .title { color: var(--accent); }
.qp-item .artist { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }
.now-playing { color: var(--accent); }
</style>
