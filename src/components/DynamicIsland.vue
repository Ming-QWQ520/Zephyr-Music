<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { usePlayerStore } from "@/stores/player";
import { useSettings } from "@/components/SettingsPanel.vue";

const store = usePlayerStore();
const { settings } = useSettings();

// 当前歌词文本
const currentLyric = computed(() => {
  const idx = store.activeLyricIndex;
  if (idx < 0 || !store.lyrics.length) return "";
  return store.lyrics[idx]?.text || "";
});

// 逐字擦除进度
const wipePercent = ref(0);
let wipeRAF = 0;
function getAudioTime(): number {
  const audio = document.querySelector("audio");
  if (audio && isFinite(audio.currentTime)) return audio.currentTime;
  return store.currentTime;
}
function updateWipe() {
  // 简单版：按行进度
  const idx = store.activeLyricIndex;
  if (idx < 0 || !store.lyrics.length) { wipePercent.value = 0; wipeRAF = requestAnimationFrame(updateWipe); return; }
  const cur = store.lyrics[idx];
  const next = store.lyrics[idx + 1];
  if (!cur) { wipePercent.value = 0; wipeRAF = requestAnimationFrame(updateWipe); return; }
  const t = getAudioTime();
  const endTime = next ? next.time : (store.duration || cur.time + 5);
  const progress = Math.max(0, Math.min(1, (t - cur.time) / (endTime - cur.time)));
  wipePercent.value = progress * 100;
  wipeRAF = requestAnimationFrame(updateWipe);
}
onMounted(() => { wipeRAF = requestAnimationFrame(updateWipe); });
onUnmounted(() => { if (wipeRAF) cancelAnimationFrame(wipeRAF); });

// 拖动逻辑
const isDragging = ref(false);
const dragOffsetX = ref(0);
const dragOffsetY = ref(0);
const islandX = ref(window.innerWidth / 2 - 150);
const islandY = ref(10);
const returnToOrigin = ref(false);
const originX = computed(() => window.innerWidth / 2 - 150);

function onMouseDown(e: MouseEvent) {
  if (settings.dynamicIslandLocked) return;
  isDragging.value = true;
  returnToOrigin.value = false;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dragOffsetX.value = e.clientX - rect.left;
  dragOffsetY.value = e.clientY - rect.top;
  e.preventDefault();
}
function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return;
  islandX.value = e.clientX - dragOffsetX.value;
  islandY.value = e.clientY - dragOffsetY.value;
}
function onMouseUp() {
  if (!isDragging.value) return;
  isDragging.value = false;
  // 取消拖动后回归原位（顶部居中）
  returnToOrigin.value = true;
  islandX.value = originX.value;
  islandY.value = 10;
}

onMounted(() => {
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  islandX.value = originX.value;
});
onUnmounted(() => {
  window.removeEventListener("mousemove", onMouseMove);
  window.removeEventListener("mouseup", onMouseUp);
});

const song = computed(() => store.currentSong);
</script>

<template>
  <div
    v-if="settings.dynamicIsland && song"
    class="dynamic-island"
    :class="{ dragging: isDragging, returning: returnToOrigin }"
    :style="{ left: islandX + 'px', top: islandY + 'px' }"
    @mousedown="onMouseDown"
  >
    <!-- 封面 -->
    <div class="island-cover" :class="{ spinning: store.isPlaying && settings.dynamicIslandCoverRotate }">
      <img v-if="song.pic" :src="song.pic" :alt="song.name" referrerpolicy="no-referrer" />
      <div v-else class="island-cover-placeholder">♪</div>
    </div>
    <!-- 歌曲信息 + 歌词 -->
    <div class="island-info">
      <div class="island-title truncate">{{ song.name }}</div>
      <div v-if="settings.dynamicIslandShowLyric" class="island-lyric-wrap">
        <div
          class="island-lyric"
          :style="{ background: `linear-gradient(to right, #fff ${wipePercent}%, rgba(255,255,255,0.4) ${wipePercent}%)`, '-webkit-background-clip': 'text', 'background-clip': 'text', '-webkit-text-fill-color': 'transparent' }"
        >{{ currentLyric || '♪ ♪ ♪' }}</div>
      </div>
      <div v-else class="island-artist truncate">{{ song.artist }}</div>
    </div>
  </div>
</template>

<style scoped>
.dynamic-island {
  position: fixed;
  width: 300px;
  height: 56px;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-radius: 28px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px 6px 6px;
  z-index: 9998;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
  cursor: grab;
  user-select: none;
  transition: left 0.4s cubic-bezier(0.4, 0, 0.2, 1), top 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}
.dynamic-island.dragging { cursor: grabbing; transition: none; }
.island-cover {
  width: 44px; height: 44px; border-radius: 50%; overflow: hidden; flex-shrink: 0;
  background: #222; display: flex; align-items: center; justify-content: center;
}
.island-cover.spinning { animation: island-spin 6s linear infinite; }
.island-cover img { width: 100%; height: 100%; object-fit: cover; }
.island-cover-placeholder { color: #888; font-size: 18px; }
.island-info { flex: 1; min-width: 0; overflow: hidden; }
.island-title { font-size: 12px; font-weight: 600; color: #fff; }
.island-artist { font-size: 10px; color: rgba(255,255,255,0.5); margin-top: 2px; }
.island-lyric-wrap { margin-top: 2px; overflow: hidden; }
.island-lyric { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@keyframes island-spin { to { transform: rotate(360deg); } }
</style>
