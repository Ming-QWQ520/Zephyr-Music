<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";

interface SongInfo { name: string; artist: string; pic: string; duration: number; }
interface LyricLine { time: number; text: string; translation?: string; }

const song = ref<SongInfo | null>(null);
const isPlaying = ref(false);
const currentTime = ref(0);
const lyrics = ref<LyricLine[]>([]);
const activeLyricIndex = ref(-1);
const yrcWords = ref<{ start: number; duration: number; text: string }[]>([]);
const hasYrc = computed(() => yrcWords.value.length > 0);

const currentLyricText = computed(() => {
  if (activeLyricIndex.value < 0 || !lyrics.value.length) return "";
  return lyrics.value[activeLyricIndex.value]?.text || "";
});
const nextLyricText = computed(() => {
  const idx = activeLyricIndex.value + 1;
  if (idx < 0 || idx >= lyrics.value.length) return "";
  return lyrics.value[idx]?.text || "";
});

// 逐字擦除
const wipePercent = ref(0);
let wipeRAF = 0;
function updateWipe() {
  if (!hasYrc.value || activeLyricIndex.value < 0) {
    wipePercent.value = 0;
    wipeRAF = requestAnimationFrame(updateWipe);
    return;
  }
  const t = currentTime.value;
  let sungChars = 0, totalChars = 0;
  for (const w of yrcWords.value) {
    const wLen = [...w.text].length || 1;
    totalChars += wLen;
    if (t >= w.start + w.duration) sungChars += wLen;
    else if (t >= w.start) {
      const p = Math.max(0, Math.min(1, (t - w.start) / w.duration));
      sungChars += wLen * p;
    }
  }
  wipePercent.value = totalChars > 0 ? Math.max(0, Math.min(100, (sungChars / totalChars) * 100)) : 0;
  wipeRAF = requestAnimationFrame(updateWipe);
}
onMounted(() => { wipeRAF = requestAnimationFrame(updateWipe); });
onUnmounted(() => { if (wipeRAF) cancelAnimationFrame(wipeRAF); });

// 逐行进度
const lineProgress = computed(() => {
  if (hasYrc.value || activeLyricIndex.value < 0) return 0;
  const cur = lyrics.value[activeLyricIndex.value];
  const next = lyrics.value[activeLyricIndex.value + 1];
  if (!cur) return 0;
  const endTime = next ? next.time : (song.value?.duration || cur.time + 5);
  return Math.max(0, Math.min(100, ((currentTime.value - cur.time) / (endTime - cur.time)) * 100));
});

// 拖动
const isDragging = ref(false);
const dragOffsetX = ref(0);
const dragOffsetY = ref(0);

async function onMouseDown(e: MouseEvent) {
  isDragging.value = true;
  dragOffsetX.value = e.clientX;
  dragOffsetY.value = e.clientY;
  e.preventDefault();
}
async function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return;
  try {
    const mod = await import("@tauri-apps/api/window");
    const win = mod.getCurrentWindow();
    const pos = await win.outerPosition();
    await win.setPosition(new mod.LogicalPosition(
      pos.x + (e.clientX - dragOffsetX.value),
      pos.y + (e.clientY - dragOffsetY.value)
    ));
    dragOffsetX.value = e.clientX;
    dragOffsetY.value = e.clientY;
  } catch { /* ignore */ }
}
async function onMouseUp() { isDragging.value = false; }

onMounted(() => {
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  import("@tauri-apps/api/event").then(mod => {
    mod.listen("song-changed", (e: any) => { song.value = e.payload; yrcWords.value = []; });
    mod.listen("play-state", (e: any) => { isPlaying.value = e.payload.playing; });
    mod.listen("time-update", (e: any) => { currentTime.value = e.payload.time; });
    mod.listen("lyrics-update", (e: any) => { lyrics.value = e.payload.lyrics || []; });
    mod.listen("lyric-index", (e: any) => { activeLyricIndex.value = e.payload.idx; });
    mod.listen("yrc-update", (e: any) => { yrcWords.value = e.payload.words || []; });
  });
});
onUnmounted(() => {
  window.removeEventListener("mousemove", onMouseMove);
  window.removeEventListener("mouseup", onMouseUp);
});
</script>

<template>
  <div class="desktop-lyrics" @mousedown="onMouseDown">
    <div class="dl-current"
      :style="{
        background: hasYrc
          ? `linear-gradient(to right, var(--accent, #fa233b) ${wipePercent}%, rgba(255,255,255,0.3) ${wipePercent}%)`
          : `linear-gradient(to right, var(--accent, #fa233b) ${lineProgress}%, rgba(255,255,255,0.3) ${lineProgress}%)`,
        '-webkit-background-clip': 'text',
        'background-clip': 'text',
        '-webkit-text-fill-color': 'transparent',
      }"
    >{{ currentLyricText || '♪ ♪ ♪' }}</div>
    <div class="dl-next">{{ nextLyricText }}</div>
  </div>
</template>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { background: transparent; overflow: hidden; font-family: -apple-system, "Microsoft YaHei", sans-serif; }
</style>

<style scoped>
.desktop-lyrics {
  width: 600px;
  height: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: grab;
  user-select: none;
  text-align: center;
}
.desktop-lyrics:active { cursor: grabbing; }
.dl-current {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.3;
  text-shadow: 0 2px 8px rgba(0,0,0,0.8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.dl-next {
  font-size: 16px;
  font-weight: 500;
  color: rgba(255,255,255,0.35);
  text-shadow: 0 1px 4px rgba(0,0,0,0.6);
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
</style>
