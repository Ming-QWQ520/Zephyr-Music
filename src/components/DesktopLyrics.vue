<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { usePlayerStore } from "@/stores/player";
import { useSettings } from "@/components/SettingsPanel.vue";

const store = usePlayerStore();
const { settings } = useSettings();

// 当前歌词
const currentLyric = computed(() => {
  const idx = store.activeLyricIndex;
  if (idx < 0 || !store.lyrics.length) return "";
  return store.lyrics[idx]?.text || "";
});
const nextLyric = computed(() => {
  const idx = store.activeLyricIndex + 1;
  if (idx < 0 || idx >= store.lyrics.length) return "";
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

// 拖动
const isDragging = ref(false);
const dragOffsetX = ref(0);
const dragOffsetY = ref(0);
const dlX = ref(window.innerWidth / 2 - 200);
const dlY = ref(window.innerHeight - 120);

function onMouseDown(e: MouseEvent) {
  if (settings.desktopLyricsLocked) return;
  isDragging.value = true;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dragOffsetX.value = e.clientX - rect.left;
  dragOffsetY.value = e.clientY - rect.top;
  e.preventDefault();
}
function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return;
  dlX.value = e.clientX - dragOffsetX.value;
  dlY.value = e.clientY - dragOffsetY.value;
}
function onMouseUp() { isDragging.value = false; }

onMounted(() => {
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
});
onUnmounted(() => {
  window.removeEventListener("mousemove", onMouseMove);
  window.removeEventListener("mouseup", onMouseUp);
});
</script>

<template>
  <div
    v-if="settings.desktopLyrics"
    class="desktop-lyrics"
    :class="{ locked: settings.desktopLyricsLocked }"
    :style="{ left: dlX + 'px', top: dlY + 'px' }"
    @mousedown="onMouseDown"
  >
    <div class="dl-line current"
      :style="{ background: `linear-gradient(to right, var(--accent) ${wipePercent}%, rgba(255,255,255,0.3) ${wipePercent}%)`, '-webkit-background-clip': 'text', 'background-clip': 'text', '-webkit-text-fill-color': 'transparent' }"
    >{{ currentLyric || '♪ ♪ ♪' }}</div>
    <div class="dl-line next">{{ nextLyric }}</div>
  </div>
</template>

<style scoped>
.desktop-lyrics {
  position: fixed;
  width: 400px;
  z-index: 9997;
  text-align: center;
  cursor: grab;
  user-select: none;
  padding: 8px 16px;
  border-radius: 12px;
}
.desktop-lyrics:hover { background: rgba(0,0,0,0.3); }
.desktop-lyrics.locked { cursor: default; }
.dl-line {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.4;
  text-shadow: 0 2px 8px rgba(0,0,0,0.8);
}
.dl-line.next {
  font-size: 16px;
  font-weight: 500;
  color: rgba(255,255,255,0.35);
  text-shadow: 0 1px 4px rgba(0,0,0,0.6);
}
</style>
