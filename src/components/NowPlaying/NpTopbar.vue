<script setup lang="ts">
/**
 * 顶栏（topbar）+ 歌词选择模式提示条 + 翻译开关按钮
 *
 * - 顶栏本身始终可见；中间歌曲信息始终展示；左右图标组根据
 *   `topbarVisible`（鼠标移到顶部时显示）淡入淡出。
 * - 歌词选择模式提示条由 `lyricSelectMode` 控制显示。
 * - 翻译开关按钮放在右下角热区，鼠标靠近时显示。
 *
 * 所有状态从 useNowPlaying 取（topbarVisible / showSettings /
 * showQueue / lyricSelectMode / selectedLyricLines / translateBtnVisible /
 * song / close / toggleFullscreen / selectAllLyrics / copySelectedLyrics /
 * exitLyricSelectMode）。
 */
import Icon from "@/components/Icon.vue";
import { useNowPlaying } from "./useNowPlaying";

const {
  settings,
  topbarVisible,
  showSettings,
  showQueue,
  song,
  close,
  toggleFullscreen,
  lyricSelectMode,
  selectedLyricLines,
  translateBtnVisible,
  selectAllLyrics,
  copySelectedLyrics,
  exitLyricSelectMode,
} = useNowPlaying();
</script>

<template>
  <!-- Topbar: center song info is ALWAYS visible; only side icons fade in/out -->
  <header class="topbar">
    <div class="topbar-drag-bg" data-tauri-drag-region></div>
    <!-- Left icons (collapse, etc.) — hide when mouse leaves topbar -->
    <div class="topbar-side topbar-left" :class="{ visible: topbarVisible || showSettings || showQueue }">
      <button class="icon-btn" title="收起到迷你播放器" @click="close">
        <Icon name="chevronDown" :size="20" />
      </button>
    </div>
    <!-- Center song info — always visible -->
    <div class="topbar-title truncate">
      {{ song?.name || "未在播放" }}
      <span v-if="song" class="sep">—</span>
      <span v-if="song" class="artist truncate">{{ song.artist }}</span>
    </div>
    <!-- Right icons (fullscreen, settings) — hide when mouse leaves topbar -->
    <div class="topbar-side topbar-right" :class="{ visible: topbarVisible || showSettings || showQueue }">
      <button class="icon-btn" title="全屏" @click="toggleFullscreen">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
      </button>
      <button class="icon-btn" title="设置" @click="showSettings = true">
        <img src="/icons/settings.svg" alt="settings" class="settings-icon" />
      </button>
    </div>
  </header>

  <!-- 歌词选择模式提示条 -->
  <div v-if="lyricSelectMode" class="lyric-select-bar">
    <span class="lyric-select-hint">已选 {{ selectedLyricLines.size }} 行</span>
    <button class="lyric-select-btn" title="全选" @click="selectAllLyrics">
      <Icon name="list" :size="14" />
      <span>全选</span>
    </button>
    <button class="lyric-select-btn lyric-select-copy" title="复制选中歌词" :disabled="selectedLyricLines.size === 0" @click="copySelectedLyrics">
      <Icon name="download" :size="14" />
      <span>复制</span>
    </button>
    <button class="lyric-select-exit" title="退出选择模式（Esc）" @click="exitLyricSelectMode">
      <Icon name="close" :size="16" />
      <span>退出</span>
    </button>
  </div>

  <!-- 翻译开关按钮（右下角，hover 区域附近时显示） -->
  <div class="translate-toggle-zone" @mouseenter="translateBtnVisible = true" @mouseleave="translateBtnVisible = false">
    <button
      v-show="translateBtnVisible"
      class="translate-toggle-btn"
      :class="{ active: settings.showTranslation }"
      :title="settings.showTranslation ? '关闭翻译' : '开启翻译'"
      @click="settings.showTranslation = !settings.showTranslation"
    >
      <img src="/icons/translate.svg" alt="translate" class="translate-toggle-icon" />
    </button>
  </div>
</template>

<style scoped>
/* ----- Topbar -----
   The topbar itself is always visible. The center song title is always shown.
   Only the side icon groups (left: collapse; right: fullscreen/settings)
   fade in when the user moves the mouse to the top of the screen. */
.topbar {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--titlebar-h);
  padding: 0 16px;
}
.topbar-drag-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
}
.topbar > *:not(.topbar-drag-bg) {
  position: relative;
  z-index: 1;
}
.topbar-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  text-align: center;
}
.topbar-title .sep { margin: 0 6px; opacity: 0.4; }
.topbar-title .artist { color: var(--text-tertiary); }
/* Side icon groups: fade out when mouse leaves the top strip. They take up
   fixed width so the center title stays centered whether they're visible
   or not. */
.topbar-side {
  display: flex;
  gap: 4px;
  min-width: 44px;
  opacity: 0;
  transition: opacity 0.25s var(--ease-out);
}
.topbar-side.visible { opacity: 1; }
.topbar-left { justify-content: flex-start; }
.topbar-right { justify-content: flex-end; }
.topbar .icon-btn {
  color: rgba(255, 255, 255, 0.7);
}
.topbar .icon-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}
.settings-icon { width: 18px; height: 18px; display: inline-block; pointer-events: none; }

/* 歌词选择模式提示条 */
.lyric-select-bar {
  position: absolute;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 200;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: var(--radius-full);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  animation: slide-down 0.25s var(--ease-out);
}
.lyric-select-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  font-weight: 500;
  margin-right: 4px;
}
.lyric-select-btn,
.lyric-select-exit {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-full);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.lyric-select-btn:hover,
.lyric-select-exit:hover {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.4);
}
.lyric-select-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.lyric-select-btn.lyric-select-copy:not(:disabled) {
  background: var(--accent, #c20c0c);
  border-color: var(--accent, #c20c0c);
}
.lyric-select-btn.lyric-select-copy:not(:disabled):hover {
  background: var(--accent-strong, #e23b3b);
  border-color: var(--accent-strong, #e23b3b);
}
.lyric-select-btn .icon-svg,
.lyric-select-exit .icon-svg { width: 14px; height: 14px; }
@keyframes slide-down {
  from { opacity: 0; transform: translate(-50%, -8px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

/* ===== 翻译开关按钮（右下角，hover 区域附近时显示） ===== */
.translate-toggle-zone {
  position: fixed;
  right: 0;
  bottom: 0;
  width: 120px;
  height: 120px;
  z-index: 100;
  /* 透明热区，鼠标进入时显示按钮 */
  pointer-events: auto;
}
.translate-toggle-btn {
  position: absolute;
  right: 20px;
  bottom: 20px;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: #fff;
  cursor: pointer;
  transition: color 0.15s, background 0.15s, transform 0.12s;
  padding: 0;
}
.translate-toggle-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}
.translate-toggle-btn:active {
  transform: scale(0.92);
}
.translate-toggle-btn.active {
  color: #fff;
  background: rgba(255, 255, 255, 0.22);
}
.translate-toggle-btn.active:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.3);
}
.translate-toggle-icon {
  width: 20px;
  height: 20px;
  pointer-events: none;
  display: block;
}
</style>
