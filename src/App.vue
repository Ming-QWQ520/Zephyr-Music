<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { usePlayerStore } from "@/stores/player";
import { useAudioBinding } from "@/composables/useAudioBinding";
import { log } from "@/composables/logger";
import Sidebar from "@/components/Sidebar.vue";
import GlobalSearchBar from "@/components/GlobalSearchBar.vue";
import SearchView from "@/components/SearchView.vue";
import QueueView from "@/components/QueueView.vue";
import LibraryView from "@/components/LibraryView.vue";
import PlayerBar from "@/components/PlayerBar.vue";
import NowPlayingView from "@/components/NowPlayingView.vue";
import SettingsPanel, { useSettings } from "@/components/SettingsPanel.vue";
import Icon from "@/components/Icon.vue";

const store = usePlayerStore();
const { settings } = useSettings();

const audioRef = ref<HTMLAudioElement | null>(null);
useAudioBinding(audioRef);

const sidebarCollapsed = ref(false);
const showSettings = ref(false);

const showNowPlaying = computed(() => store.currentView === "nowplaying");

async function minimizeWindow() {
  try {
    const mod = await import("@tauri-apps/api/window");
    const w = mod.getCurrentWindow?.() ?? (mod as any).window?.();
    if (w) await w.minimize();
  } catch (e) {
    log.warn("app", "minimize failed", { error: String(e) });
  }
}

async function toggleMaximize() {
  try {
    const mod = await import("@tauri-apps/api/window");
    const w = mod.getCurrentWindow?.() ?? (mod as any).window?.();
    if (w) await w.toggleMaximize();
  } catch (e) {
    log.warn("app", "toggleMaximize failed", { error: String(e) });
  }
}

async function closeWindow() {
  try {
    const mod = await import("@tauri-apps/api/window");
    const w = mod.getCurrentWindow?.() ?? (mod as any).window?.();
    if (w) await w.close();
  } catch (e) {
    log.warn("app", "close failed", { error: String(e) });
  }
}

function toggleNowPlaying() {
  if (showNowPlaying.value) store.closeFullscreenPlayer();
  else store.openFullscreenPlayer();
}

onMounted(() => {
  log.init();
  log.info("app", "booted");
});
</script>

<template>
  <div class="app-shell" :data-color-mode="settings.colorMode">
    <!-- Hidden audio element for online streaming (local files use Rodio) -->
    <audio ref="audioRef" preload="auto" />

    <!-- Titlebar -->
    <header class="titlebar tauri-drag">
      <div class="tb-left">
        <button
          class="icon-btn tauri-no-drag"
          :title="sidebarCollapsed ? '展开侧栏' : '折叠侧栏'"
          @click="sidebarCollapsed = !sidebarCollapsed"
        >
          <Icon name="collapse" :size="16" />
        </button>
        <div class="brand">
          <img src="/favicon.svg" alt="Zephyr" class="brand-icon" />
          <span class="brand-name">Zephyr</span>
        </div>
      </div>

      <div class="tb-center tauri-no-drag">
        <GlobalSearchBar />
      </div>

      <div class="tb-right tauri-no-drag">
        <button
          class="icon-btn"
          :class="{ active: showNowPlaying }"
          title="全屏播放器"
          @click="toggleNowPlaying"
        >
          <Icon name="expand" :size="16" />
        </button>
        <button class="icon-btn" title="设置" @click="showSettings = true">
          <Icon name="settings" :size="16" />
        </button>
        <!-- Window controls: minimize, maximize, close (rightmost) -->
        <div class="win-ctrls">
          <button class="win-btn" title="最小化" @click="minimizeWindow">
            <Icon name="minimize" :size="14" />
          </button>
          <button class="win-btn" title="最大化" @click="toggleMaximize">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.3"/></svg>
          </button>
          <button class="win-btn win-close" title="关闭" @click="closeWindow">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>
    </header>

    <!-- Body: sidebar + main view + playerbar -->
    <div class="app-body">
      <Sidebar v-model:collapsed="sidebarCollapsed" />

      <main class="main-view">
        <SearchView v-if="store.currentView === 'search'" />
        <QueueView v-else-if="store.currentView === 'queue'" />
        <LibraryView v-else-if="store.currentView === 'library'" />
        <div v-else class="placeholder-view">
          <Icon name="music" :size="48" />
          <p>选择一首歌开始播放</p>
        </div>
      </main>
    </div>

    <!-- Bottom mini player -->
    <PlayerBar />

    <!-- NowPlaying fullscreen overlay -->
    <Transition name="np-fade">
      <NowPlayingView v-if="showNowPlaying" />
    </Transition>

    <!-- Settings (modal/fullscreen on home page) -->
    <SettingsPanel :visible="showSettings" mode="modal" @close="showSettings = false" />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  background: var(--bg);
  color: var(--text);
  overflow: hidden;
}

/* ----- Titlebar ----- */
.titlebar {
  display: flex;
  align-items: center;
  height: var(--titlebar-h);
  padding: 0 12px;
  background: var(--bg-elev-1);
  border-bottom: 1px solid var(--border);
  gap: 8px;
  flex-shrink: 0;
}
.tb-left {
  display: flex;
  align-items: center;
  gap: 8px;
  width: var(--sidebar-w);
  flex-shrink: 0;
}
.tb-left .icon-btn { width: 28px; height: 28px; }
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
}
.brand-icon {
  width: 20px;
  height: 20px;
  border-radius: 4px;
}
.brand-name {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.4px;
}
.tb-center {
  flex: 1;
  display: flex;
  justify-content: center;
  min-width: 0;
}
.tb-right {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tb-right .icon-btn { width: 28px; height: 28px; }

/* Window controls (rightmost) */
.win-ctrls {
  display: flex;
  align-items: center;
  gap: 1px;
  margin-left: 4px;
}
.win-btn {
  width: 36px;
  height: 28px;
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  transition: background 0.12s, color 0.12s;
  -webkit-app-region: no-drag;
}
.win-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}
.win-close:hover {
  background: var(--accent);
  color: #fff;
}

/* ----- Body ----- */
.app-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.main-view {
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  background: var(--bg);
}

.placeholder-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--text-tertiary);
}

/* ----- NowPlaying transition ----- */
.np-fade-enter-active,
.np-fade-leave-active {
  transition: opacity 0.32s var(--ease-out), transform 0.32s var(--ease-out);
}
/* Enter: slide down from top (from -100% to 0) */
.np-fade-enter-from {
  opacity: 0;
  transform: translateY(-100%);
}
/* Leave: slide down to bottom (from 0 to 100%) — "从上往下移动收起" */
.np-fade-leave-to {
  opacity: 0;
  transform: translateY(100%);
}

@media (max-width: 720px) {
  .tb-left .brand-name { display: none; }
  .tb-left { width: auto; }
}
</style>
