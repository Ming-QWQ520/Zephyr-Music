<script setup lang="ts">
/**
 * TrayPopup — 托盘右键弹出的迷你播放器窗口（紧凑版）
 *
 * 布局（从上到下）：
 *   1. 封面 + 歌曲名 + 歌手（歌曲信息区，占据上半部分）
 *   2. 控制按钮（上一首/播放暂停/下一首）
 *   3. 账户名
 *   4. 显示主窗口
 *   5. 退出
 *
 * 事件协议：
 *   - 主窗口 → popup:  `player-state`  { song, isPlaying, accountName }
 *   - popup → 主窗口:  `player-action` { action: "togglePlay"|"next"|"prev"|"showMain"|"quit" }
 */
import { ref, computed, onMounted, onUnmounted } from "vue";
import { log } from "@/composables/logger";

interface PlayerState {
  song: {
    name: string;
    artist: string;
    pic: string;
  } | null;
  isPlaying: boolean;
  accountName: string | null;
}

const song = ref<PlayerState["song"]>(null);
const isPlaying = ref(false);
const accountName = ref<string | null>(null);

const coverUrl = computed(() => {
  const pic = song.value?.pic || "";
  if (!pic) return "";
  if (pic.includes("music.126.net")) {
    return pic.replace(/\?param=\d+x\d+/g, "") + "?param=200x200";
  }
  return pic;
});

let unlistenState: (() => void) | null = null;

async function setupEventListeners() {
  try {
    const eventMod = await import("@tauri-apps/api/event");
    unlistenState = await eventMod.listen<PlayerState>("player-state", (event) => {
      const s = event.payload;
      song.value = s.song;
      isPlaying.value = s.isPlaying;
      accountName.value = s.accountName ?? null;
    });
  } catch (e) {
    log.warn("tray-popup", "failed to setup event listener", { error: String(e) });
  }
}

async function sendAction(action: string) {
  try {
    const eventMod = await import("@tauri-apps/api/event");
    await eventMod.emit("player-action", { action });
  } catch (e) {
    log.warn("tray-popup", "failed to send action", { action, error: String(e) });
  }
}

function onTogglePlay() { void sendAction("togglePlay"); }
function onNext() { void sendAction("next"); }
function onPrev() { void sendAction("prev"); }
function onShowMain() { void sendAction("showMain"); void hideWindow(); }
function onQuit() { void sendAction("quit"); }

async function hideWindow() {
  try {
    const coreMod = await import("@tauri-apps/api/core");
    await coreMod.invoke("hide_tray_popup");
  } catch { /* ignore */ }
}

async function setupFocusLossListener() {
  try {
    const winMod = await import("@tauri-apps/api/window");
    const w = winMod.getCurrentWindow?.() ?? (winMod as any).window?.();
    if (w) {
      await w.onFocusChanged((event: { payload: boolean }) => {
        if (!event.payload) {
          setTimeout(() => void hideWindow(), 150);
        }
      });
    }
  } catch (e) {
    log.warn("tray-popup", "focus listener setup failed", { error: String(e) });
  }
}

onMounted(() => {
  void setupEventListeners();
  void setupFocusLossListener();
  void sendAction("request-state");
});

onUnmounted(() => {
  if (unlistenState) unlistenState();
});
</script>

<template>
  <div class="tray-popup">
    <!-- 歌曲信息区：封面 + 歌名 + 歌手 -->
    <div class="song-section">
      <div class="cover-area">
        <img
          v-if="coverUrl"
          :src="coverUrl"
          class="cover-img"
          alt="cover"
          @error="(e: Event) => (e.target as HTMLImageElement).style.display = 'none'"
        />
        <div v-else class="cover-placeholder">
          <svg viewBox="0 0 24 24" width="28" height="28"><path fill="currentColor" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
        </div>
      </div>
      <div class="song-text">
        <div class="song-name" :title="song?.name || '未在播放'">
          {{ song?.name || "未在播放" }}
        </div>
        <div class="song-artist" :title="song?.artist || '未知歌手'">
          {{ song?.artist || "未知歌手" }}
        </div>
      </div>
    </div>

    <!-- 控制按钮（紧凑横排） -->
    <div class="controls">
      <button class="ctrl-btn" title="上一首" @click="onPrev">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z"/></svg>
      </button>
      <button class="ctrl-btn play-btn" :title="isPlaying ? '暂停' : '播放'" @click="onTogglePlay">
        <svg v-if="isPlaying" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/></svg>
        <svg v-else viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M8 5v14l11-7L8 5z"/></svg>
      </button>
      <button class="ctrl-btn" title="下一首" @click="onNext">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M16 6h2v12h-2V6zM6 6l8.5 6L6 18V6z"/></svg>
      </button>
    </div>

    <!-- 账户名 -->
    <button class="row-btn account-row" :title="accountName || '未登录'" @click="onShowMain">
      <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
      <span class="row-text">{{ accountName || "未登录" }}</span>
    </button>

    <!-- 显示主窗口 -->
    <button class="row-btn" @click="onShowMain">
      <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M3 5h18v14H3V5zm2 2v10h14V7H5z"/></svg>
      <span class="row-text">显示主窗口</span>
    </button>

    <!-- 退出 -->
    <button class="row-btn quit-row" @click="onQuit">
      <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
      <span class="row-text">退出</span>
    </button>
  </div>
</template>

<style>
html, body, #app {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #1c1c20; /* 与 .tray-popup 背景一致：不透明窗口下避免圆角四角露白 */
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei",
    "PingFang SC", "Helvetica Neue", sans-serif;
  -webkit-user-select: none;
  user-select: none;
}
</style>

<style scoped>
.tray-popup {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 8px;
  box-sizing: border-box;
  background: rgba(28, 28, 32, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 8px;
  color: #fff;
  overflow: hidden;
  gap: 4px;
}

/* ===== 歌曲信息区（封面 + 歌名 + 歌手，横向布局，完全平行） ===== */
.song-section {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.cover-area {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 5px;
  overflow: hidden;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cover-placeholder {
  color: rgba(255, 255, 255, 0.25);
}

.song-text {
  flex: 1;
  min-width: 0;
}

.song-name {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #fff;
}

.song-artist {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ===== 控制按钮（与首页 PlayerBar 样式一致） ===== */
.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex-shrink: 0;
}

.ctrl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: color 0.2s ease, background 0.2s ease, transform 0.15s ease;
}

.ctrl-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}

.ctrl-btn:active {
  background: rgba(255, 255, 255, 0.18);
}

/* 播放按钮：与 PlayerBar 一致，scale 变换 */
.ctrl-btn.play-btn {
  width: 36px;
  height: 36px;
  color: #fff;
  margin: 0 4px;
}

.ctrl-btn.play-btn:hover {
  color: #fff;
  background: transparent;
  transform: scale(1.05);
}

.ctrl-btn.play-btn:active {
  background: transparent;
  transform: scale(0.95);
}

/* ===== 底部行按钮（账户/显示主窗口/退出） ===== */
.row-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 10px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  font-size: 12px;
  cursor: pointer;
  border-radius: 5px;
  transition: color 0.2s ease, background 0.2s ease;
  flex-shrink: 0;
}

.row-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.row-btn:active {
  background: rgba(255, 255, 255, 0.14);
}

.row-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.account-row {
  color: rgba(255, 255, 255, 0.6);
  cursor: default;
}

.account-row:hover {
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
}

.quit-row:hover {
  background: rgba(255, 80, 80, 0.15);
  color: #ff6b6b;
}

.quit-row:active {
  background: rgba(255, 80, 80, 0.25);
}
</style>
