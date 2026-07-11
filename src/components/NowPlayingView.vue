<script setup lang="ts">
/**
 * NowPlayingView — 全屏播放器主组件
 *
 * 拆分后只负责：
 *   - np-overlay 根元素（背景层 + 顶栏 + 主区 + 可视化 + 队列 + 设置）
 *   - 全局键盘快捷键（onKey）— Esc/Space/Ctrl+←/→/Ctrl+A/Ctrl+C
 *   - mousemove 监听（驱动 topbarVisible）
 *   - 显示模式（mode-both/cover/lyrics）+ 响应式 grid 布局
 *   - 挂载 SettingsPanel（侧边栏模式）
 *
 * 各功能子组件：
 *   - NpBackground   背景层（blur/fluid/gradient/solid + dim/blur overlay）
 *   - NpTopbar       顶栏 + 歌词选择模式提示条 + 翻译开关
 *   - NpCoverControls 左侧封面 + 控制按钮 + 音量/进度/音质
 *   - NpLyrics       右侧歌词（解析/渲染/变换/yrc 擦除/选择模式）
 *   - NpVisualizer   底部 Canvas 音频可视化
 *   - NpQueuePanel   右侧播放队列面板
 *
 * 跨组件共享状态由 useNowPlaying composable（模块级单例）提供。
 */
import { onMounted, onUnmounted } from "vue";
import SettingsPanel from "@/components/SettingsPanel.vue";
import { useNowPlaying } from "@/components/NowPlaying/useNowPlaying";
import { log } from "@/composables/logger";
import NpBackground from "@/components/NowPlaying/NpBackground.vue";
import NpTopbar from "@/components/NowPlaying/NpTopbar.vue";
import NpCoverControls from "@/components/NowPlaying/NpCoverControls.vue";
import NpLyrics from "@/components/NowPlaying/NpLyrics.vue";
import NpQueuePanel from "@/components/NowPlaying/NpQueuePanel.vue";

const {
  store,
  settings,
  showSettings,
  showQueue,
  coverUrl,
  onMouseMove,
  close,
  lyricSelectMode,
  exitLyricSelectMode,
} = useNowPlaying();

// ----- Keyboard shortcuts -----
function onKey(ev: KeyboardEvent) {
  if (ev.key === "Escape") {
    // 优先退出歌词选择模式
    if (lyricSelectMode.value) { exitLyricSelectMode(); return; }
    if (showSettings.value) showSettings.value = false;
    else if (showQueue.value) showQueue.value = false;
    else close();
    return;
  }
  // 歌词选择模式下：允许 Ctrl+C / Ctrl+A 放行，其他快捷键暂停
  if (lyricSelectMode.value) {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "c") return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") return;
    return;
  }
  if (ev.code === "Space") { ev.preventDefault(); store.togglePlay(); }
  if (ev.key === "ArrowRight" && (ev.ctrlKey || ev.metaKey)) store.next();
  if (ev.key === "ArrowLeft" && (ev.ctrlKey || ev.metaKey)) store.prev();
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  log.info("nowplaying", "mounted");
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  // 清理歌词选择模式可能在 body 上残留的 class
  if (lyricSelectMode.value && typeof document !== "undefined") {
    document.body.classList.remove("lyric-select-mode");
  }
});
</script>

<template>
  <div
    class="np-overlay"
    :class="[`bg-${settings.bgType}`, `mode-${settings.displayMode}`]"
    @mousemove="onMouseMove"
  >
    <!-- Background layers (RNP-style: type switches which layers show) -->
    <NpBackground :cover-url="coverUrl" />

    <!-- Topbar + 歌词选择提示条 + 翻译开关（多个根节点，全部 portal 到此处） -->
    <NpTopbar />

    <!-- Main content: cover (left) + lyrics (right) -->
    <main class="np-main">
      <NpCoverControls />
      <NpLyrics />
    </main>

    <!-- Queue panel (从右侧居中弹出) -->
    <NpQueuePanel />

    <!-- Settings -->
    <SettingsPanel :visible="showSettings" mode="sidebar" @close="showSettings = false" />
  </div>
</template>

<style scoped>
.np-overlay {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #000;
  color: var(--text);
}

/* ----- Main split: left 45% (cover+controls), right 55% (lyrics) ----- */
.np-main {
  position: relative;
  z-index: 2;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(320px, 45%) 1fr;
  gap: clamp(20px, 3vw, 48px);
  padding: 0 clamp(24px, 4vw, 56px) clamp(20px, 3vh, 40px);
  min-height: 0;
  overflow: visible;
}
.mode-both .np-main {
  grid-template-columns: minmax(320px, 45%) 1fr;
}

/* mode-cover: only show the cover (centered), hide lyrics pane */
.mode-cover .np-main {
  grid-template-columns: 1fr;
  text-align: center;
  justify-items: center;
}
.mode-cover .np-main :deep(.right-pane) { display: none; }
.mode-cover .np-main :deep(.left-pane) { align-items: center; }

/* mode-lyrics: only show lyrics, hide cover + controls */
.mode-lyrics .np-main {
  grid-template-columns: 1fr;
}
.mode-lyrics .np-main :deep(.left-pane) { display: none; }
.mode-lyrics .np-main :deep(.right-pane) { display: flex; }

@media (max-width: 900px) {
  .np-main {
    grid-template-columns: 1fr;
    padding: 0 16px 24px;
    gap: 16px;
  }
  /* On narrow screens, force cover mode (hide lyrics) unless the user
     explicitly chose lyrics-only mode. */
  .mode-both .np-main :deep(.right-pane) { display: none; }
  .mode-both .np-main :deep(.left-pane) { align-items: center; }
  .mode-lyrics .np-main { grid-template-columns: 1fr; }
  .mode-lyrics .np-main :deep(.right-pane) { display: flex; }
  .mode-lyrics .np-main :deep(.left-pane) { display: none; }
  .mode-cover .np-main :deep(.right-pane) { display: none; }
  .np-main :deep(.left-pane) { align-items: center; }
  .np-main :deep(.cover-wrap) { width: min(260px, 60vw); }
  .np-main :deep(.controls-block) { width: 100%; max-width: 480px; }
  .np-main :deep(.vol-cluster) { margin-left: 0; }
}
</style>
