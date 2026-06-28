<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { usePlayerStore } from "@/stores/player";
import { useAudioBinding } from "@/composables/useAudioBinding";
import { log } from "@/composables/logger";
import Sidebar from "@/components/Sidebar.vue";
import GlobalSearchBar from "@/components/GlobalSearchBar.vue";
import SearchView from "@/components/SearchView.vue";
import NeteaseView from "@/components/NeteaseView.vue";
import QueueView from "@/components/QueueView.vue";
import LibraryView from "@/components/LibraryView.vue";
import PlayerBar from "@/components/PlayerBar.vue";
import NowPlayingView from "@/components/NowPlayingView.vue";
import SettingsPanel, { useSettings } from "@/components/SettingsPanel.vue";
import ToastContainer from "@/components/ToastContainer.vue";
import Icon from "@/components/Icon.vue";
import { getCookie, getCachedUser, logout, setCookie, qrKey, qrCreate, qrCheck, _cachedUser } from "@/api/netease";

const store = usePlayerStore();
const { settings } = useSettings();

const audioRef = ref<HTMLAudioElement | null>(null);
useAudioBinding(audioRef);

const showSettings = ref(false);
const showNowPlaying = computed(() => store.currentView === "nowplaying");

// ===== 网易云登录状态（标题栏显示）=====
const neLoggedIn = ref(false);
const neUser = ref<{ nickname: string; avatarUrl: string } | null>(null);
const showLoginDropdown = ref(false);
const qrCodeImg = ref("");
const qrStatus = ref<"idle" | "loading" | "waiting" | "expired">("idle");
const qrMessage = ref("");
let qrCheckTimer: ReturnType<typeof setInterval> | null = null;
let qrKeyVal = "";

async function checkNeLogin() {
  if (!getCookie()) return;
  const user = await getCachedUser();
  if (user) {
    neLoggedIn.value = true;
    neUser.value = { nickname: user.nickname, avatarUrl: user.avatarUrl };
  }
}

async function startNeLogin() {
  qrStatus.value = "loading"; qrMessage.value = "正在生成二维码..."; qrCodeImg.value = "";
  try {
    const keyRes = await qrKey();
    if (!keyRes.unikey) { qrMessage.value = "生成失败"; qrStatus.value = "idle"; return; }
    qrKeyVal = keyRes.unikey;
    const createRes = await qrCreate(qrKeyVal);
    if (!createRes.qrimg) { qrMessage.value = "生成失败"; qrStatus.value = "idle"; return; }
    qrCodeImg.value = createRes.qrimg;
    qrStatus.value = "waiting"; qrMessage.value = "请用网易云音乐 App 扫码";
    stopNeQrCheck();
    qrCheckTimer = setInterval(async () => {
      try {
        const res = await qrCheck(qrKeyVal);
        if (res.code === 800) { qrStatus.value = "expired"; qrMessage.value = "二维码已过期"; stopNeQrCheck(); }
        else if (res.code === 802) { qrMessage.value = "已扫码，请确认"; }
        else if (res.code === 803) {
          if (res.cookie) setCookie(res.cookie);
          stopNeQrCheck();
          await checkNeLogin();
          showLoginDropdown.value = false;
        }
      } catch { /* ignore */ }
    }, 2000);
  } catch (e) { qrMessage.value = "出错: " + String(e); qrStatus.value = "idle"; }
}
function stopNeQrCheck() { if (qrCheckTimer) { clearInterval(qrCheckTimer); qrCheckTimer = null; } }

async function doNeLogout() {
  try { await logout(); } catch { /* ignore */ }
  neLoggedIn.value = false; neUser.value = null;
  showLoginDropdown.value = false;
  qrStatus.value = "idle"; qrCodeImg.value = "";
}

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
  checkNeLogin();
  // 恢复上次播放的歌曲：重新获取 URL 和歌词
  const song = store.currentSong;
  if (song) {
    log.info("app", "restoring last song", { name: song.name, hasUrl: !!song.url, hasLrc: !!song.lrc });
    if (song.source === "netease" && song.neteaseId) {
      // 清除缓存的 URL 和歌词（URL 可能过期，yrcText/tlyricText 未持久化）
      // 强制重新获取，确保逐字歌词和翻译完整
      song.url = "";
      song.lrc = "";
      (song as any).yrcText = "";
      (song as any).tlyricText = "";
      // 同步清除队列中该歌曲的缓存
      const idx = store.queue.findIndex(s => s.id === song.id);
      if (idx >= 0) {
        store.queue[idx].url = "";
        store.queue[idx].lrc = "";
        (store.queue[idx] as any).yrcText = "";
        (store.queue[idx] as any).tlyricText = "";
      }
      // 并行获取 URL 和歌词（不阻塞，后台加载）
      const urlP = store._ensureNeteaseUrl(song);
      const lrcP = store._ensureNeteaseLyrics(song).then(() => {
        if (store.currentSong?.id === song.id) store.loadLyrics(song);
      });
      store.lyrics = []; // 清空，等歌词加载完显示
      void urlP; void lrcP;
    } else {
      // 本地歌曲：直接加载歌词
      if (song.lrc) store.loadLyrics(song);
    }
  }
  // 定期保存会话（每 10 秒）
  sessionTimer = setInterval(() => store.saveSession(), 10000);
  // 页面关闭前保存
  window.addEventListener("beforeunload", () => store.saveSession());
});
let sessionTimer: ReturnType<typeof setInterval> | null = null;
onUnmounted(() => {
  if (sessionTimer) clearInterval(sessionTimer);
  store.saveSession();
});
</script>

<template>
  <div class="app-shell" :data-color-mode="settings.colorMode">
    <!-- Hidden audio element for online streaming (local files use Rodio) -->
    <audio ref="audioRef" preload="auto" />

    <!-- Titlebar -->
    <header class="titlebar tauri-drag">
      <div class="tb-left">
        <div class="brand">
          <img src="/favicon.svg" alt="Zephyr" class="brand-icon" />
          <span class="brand-name">Zephyr</span>
        </div>
      </div>

      <!-- 搜索框（左移 5px）-->
      <div class="tb-center" style="margin-left: -5px;">
        <GlobalSearchBar />
      </div>

      <div class="tb-right">
        <!-- 网易云登录/头像 -->
        <div class="ne-auth tauri-no-drag">
          <button v-if="!neLoggedIn" class="ne-login-btn" @click="showLoginDropdown = !showLoginDropdown">
            <Icon name="music" :size="14" />
            <span>登录</span>
          </button>
          <button v-else class="ne-user-btn" @click="showLoginDropdown = !showLoginDropdown">
            <img v-if="neUser?.avatarUrl" :src="neUser.avatarUrl" class="ne-avatar" referrerpolicy="no-referrer" />
            <span class="ne-name truncate">{{ neUser?.nickname }}</span>
          </button>

          <!-- 登录下拉 -->
          <Transition name="dropdown">
            <div v-if="showLoginDropdown" class="ne-dropdown" @click.stop>
              <!-- 未登录：二维码 -->
              <template v-if="!neLoggedIn">
                <div v-if="qrStatus === 'idle'" class="qr-start">
                  <button class="qr-gen-btn" @click="startNeLogin">生成二维码登录</button>
                </div>
                <div v-else-if="qrStatus === 'loading'" class="qr-loading">
                  <div class="spinner" /><span>正在生成...</span>
                </div>
                <div v-else class="qr-show">
                  <img v-if="qrCodeImg" :src="qrCodeImg" alt="二维码" class="qr-img" />
                  <div v-if="qrStatus === 'expired'" class="qr-expired" @click="startNeLogin">点击刷新</div>
                </div>
                <p class="qr-msg">{{ qrMessage }}</p>
              </template>
              <!-- 已登录：退出 -->
              <template v-else>
                <div class="ne-logged-info">
                  <img v-if="neUser?.avatarUrl" :src="neUser.avatarUrl" class="ne-avatar-lg" referrerpolicy="no-referrer" />
                  <span>{{ neUser?.nickname }}</span>
                </div>
                <button class="ne-logout-btn" @click="doNeLogout">退出登录</button>
              </template>
            </div>
          </Transition>
        </div>

        <button class="icon-btn tauri-no-drag" :class="{ active: showNowPlaying }" title="全屏播放器" @click="toggleNowPlaying">
          <Icon name="expand" :size="16" />
        </button>
        <button class="icon-btn tauri-no-drag" title="设置" @click="showSettings = true">
          <img src="/icons/settings.svg" alt="settings" class="settings-icon" />
        </button>
        <div class="win-ctrls tauri-no-drag">
          <button class="win-btn" title="最小化" @click="minimizeWindow"><Icon name="minimize" :size="14" /></button>
          <button class="win-btn" title="最大化" @click="toggleMaximize"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.3"/></svg></button>
          <button class="win-btn win-close" title="关闭" @click="closeWindow"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>
        </div>
      </div>
    </header>

    <!-- Body: sidebar + main view + playerbar -->
    <div class="app-body">
      <Sidebar />

      <main class="main-view">
        <SearchView v-if="store.currentView === 'search'" />
        <NeteaseView v-else-if="store.currentView === 'netease'" />
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

    <!-- Toast 通知容器（右下角） -->
    <ToastContainer />
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
.settings-icon { width: 16px; height: 16px; display: inline-block; pointer-events: none; }

/* 网易云登录 */
.ne-auth { position: relative; margin-right: 4px; }
.ne-login-btn, .ne-user-btn {
  display: flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 10px; border-radius: 14px;
  font-size: 12px; color: var(--text-secondary); transition: all 0.15s;
}
.ne-login-btn { background: var(--bg-elev-3); }
.ne-login-btn:hover { color: var(--accent); }
.ne-user-btn { background: var(--bg-elev-3); max-width: 120px; }
.ne-user-btn:hover { background: var(--bg-hover); }
.ne-avatar { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.ne-name { font-size: 12px; color: var(--text); }

.ne-dropdown {
  position: absolute; top: 34px; right: 0; z-index: 300;
  min-width: 200px; background: var(--bg-elev-3);
  border: 1px solid var(--border-strong); border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.4); padding: 16px; text-align: center;
}
.qr-gen-btn { padding: 10px 20px; border-radius: 8px; background: var(--accent); color: #fff; font-size: 13px; }
.qr-gen-btn:hover { opacity: 0.9; }
.qr-loading { display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 12px; }
.spinner { width: 24px; height: 24px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
.qr-show { position: relative; display: flex; justify-content: center; }
.qr-img { width: 160px; height: 160px; border-radius: 8px; background: #fff; padding: 6px; }
.qr-expired { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.7); border-radius: 8px; color: #fff; font-size: 12px; cursor: pointer; }
.qr-msg { font-size: 11px; color: var(--text-tertiary); margin: 8px 0 0; }
.ne-logged-info { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 12px; }
.ne-avatar-lg { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; }
.ne-logged-info span { font-size: 13px; color: var(--text); }
.ne-logout-btn { padding: 6px 16px; border-radius: 6px; font-size: 12px; color: var(--text-tertiary); border: 1px solid var(--border); }
.ne-logout-btn:hover { color: var(--accent); border-color: var(--accent); }
.dropdown-enter-active, .dropdown-leave-active { transition: all 0.15s; }
.dropdown-enter-from, .dropdown-leave-to { opacity: 0; transform: translateY(-8px); }
@keyframes spin { to { transform: rotate(360deg); } }

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
