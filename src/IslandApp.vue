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
// 设置
const showLyric = ref(true);
const coverRotate = ref(true);
const locked = ref(false);

// 当前歌词文本
const currentLyricText = computed(() => {
  if (activeLyricIndex.value < 0 || !lyrics.value.length) return "";
  return lyrics.value[activeLyricIndex.value]?.text || "";
});

// 显示模式：无歌词 → 歌曲信息，有歌词 → 歌词
const displayMode = computed<"info" | "lyric" | "waiting">(() => {
  if (!song.value) return "waiting";
  if (!showLyric.value) return "info"; // 设置关闭歌词显示
  if (!lyrics.value.length) return "info";
  if (activeLyricIndex.value < 0) return "waiting";
  return "lyric";
});

// 逐字擦除进度（rAF 逐帧更新）
const wipePercent = ref(0);
let wipeRAF = 0;
function getAudioTime(): number { return currentTime.value; }

function updateWipe() {
  if (!hasYrc.value || activeLyricIndex.value < 0) {
    wipePercent.value = 0;
    wipeRAF = requestAnimationFrame(updateWipe);
    return;
  }
  const t = getAudioTime();
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

// 非逐字歌词的行进度（用于逐行高亮）
const lineProgress = computed(() => {
  if (hasYrc.value || activeLyricIndex.value < 0) return 0;
  const cur = lyrics.value[activeLyricIndex.value];
  const next = lyrics.value[activeLyricIndex.value + 1];
  if (!cur) return 0;
  const endTime = next ? next.time : (song.value?.duration || cur.time + 5);
  return Math.max(0, Math.min(100, ((currentTime.value - cur.time) / (endTime - cur.time)) * 100));
});

// 拖动逻辑
const isDragging = ref(false);
const dragOffsetX = ref(0);
const dragOffsetY = ref(0);

async function onMouseDown(e: MouseEvent) {
  if (locked.value) return;
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
    const newX = pos.x + (e.clientX - dragOffsetX.value);
    const newY = pos.y + (e.clientY - dragOffsetY.value);
    await win.setPosition(new mod.LogicalPosition(newX, newY));
    dragOffsetX.value = e.clientX;
    dragOffsetY.value = e.clientY;
  } catch { /* ignore */ }
}
async function onMouseUp() {
  if (!isDragging.value) return;
  isDragging.value = false;
  // 回归顶部居中
  try {
    const mod = await import("@tauri-apps/api/window");
    const win = mod.getCurrentWindow() as any;
    const monitor = await win.currentMonitor();
    if (monitor) {
      const screenW = monitor.size.width / monitor.scaleFactor;
      const winW = 320;
      const x = (screenW - winW) / 2;
      await win.setPosition(new mod.LogicalPosition(x, 10));
    }
  } catch { /* ignore */ }
}

onMounted(() => {
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  // 监听主窗口事件
  import("@tauri-apps/api/event").then(mod => {
    mod.listen("song-changed", (e: any) => { song.value = e.payload; yrcWords.value = []; });
    mod.listen("play-state", (e: any) => { isPlaying.value = e.payload.playing; });
    mod.listen("time-update", (e: any) => { currentTime.value = e.payload.time; });
    mod.listen("lyrics-update", (e: any) => { lyrics.value = e.payload.lyrics || []; });
    mod.listen("lyric-index", (e: any) => { activeLyricIndex.value = e.payload.idx; });
    // 逐字歌词数据
    mod.listen("yrc-update", (e: any) => { yrcWords.value = e.payload.words || []; });
    mod.listen("settings-update", (e: any) => {
      showLyric.value = e.payload.showLyric;
      coverRotate.value = e.payload.coverRotate;
      locked.value = e.payload.locked;
    });
    // 初始居中
    import("@tauri-apps/api/window").then(wmod => {
      const win = wmod.getCurrentWindow() as any;
      win.currentMonitor().then((monitor: any) => {
        if (monitor) {
          const screenW = monitor.size.width / monitor.scaleFactor;
          const x = (screenW - 320) / 2;
          win.setPosition(new wmod.LogicalPosition(x, 10));
        }
      });
    });
  });
});
onUnmounted(() => {
  window.removeEventListener("mousemove", onMouseMove);
  window.removeEventListener("mouseup", onMouseUp);
});
</script>

<template>
  <div class="island" @mousedown="onMouseDown">
    <!-- 封面 -->
    <div class="island-cover" :class="{ spinning: isPlaying && coverRotate }">
      <img v-if="song?.pic" :src="song.pic" :alt="song?.name" referrerpolicy="no-referrer" />
      <span v-else class="placeholder">♪</span>
    </div>
    <!-- 信息区 -->
    <div class="island-info">
      <!-- 无歌词：显示歌曲信息 -->
      <div v-if="displayMode === 'info'" class="island-full-info truncate">
        {{ song?.name }} - {{ song?.artist }}
      </div>
      <!-- 等待阶段 -->
      <div v-else-if="displayMode === 'waiting'" class="island-waiting">
        ···
      </div>
      <!-- 逐字歌词 -->
      <div v-else-if="hasYrc" class="island-lyric truncate"
        :style="{
          background: `linear-gradient(to right, #fff ${wipePercent}%, rgba(255,255,255,0.35) ${wipePercent}%)`,
          '-webkit-background-clip': 'text',
          'background-clip': 'text',
          '-webkit-text-fill-color': 'transparent',
        }"
      >{{ currentLyricText }}</div>
      <!-- 逐行歌词 -->
      <div v-else class="island-lyric truncate"
        :style="{
          background: `linear-gradient(to right, #fff ${lineProgress}%, rgba(255,255,255,0.35) ${lineProgress}%)`,
          '-webkit-background-clip': 'text',
          'background-clip': 'text',
          '-webkit-text-fill-color': 'transparent',
        }"
      >{{ currentLyricText }}</div>
    </div>
  </div>
</template>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { background: transparent; overflow: hidden; font-family: -apple-system, "Microsoft YaHei", sans-serif; }
</style>

<style scoped>
.island {
  width: 320px;
  height: 56px;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-radius: 28px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 16px 6px 6px;
  cursor: grab;
  user-select: none;
}
.island:active { cursor: grabbing; }
.island-cover {
  width: 44px; height: 44px; border-radius: 50%; overflow: hidden; flex-shrink: 0;
  background: #222; display: flex; align-items: center; justify-content: center;
}
.island-cover.spinning { animation: spin 6s linear infinite; }
.island-cover img { width: 100%; height: 100%; object-fit: cover; }
.placeholder { color: #888; font-size: 18px; }
.island-info { flex: 1; min-width: 0; overflow: hidden; }
.island-full-info { font-size: 13px; font-weight: 600; color: #fff; line-height: 56px; }
.island-waiting { font-size: 16px; color: rgba(255,255,255,0.4); letter-spacing: 4px; line-height: 56px; }
.island-lyric { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 56px; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
