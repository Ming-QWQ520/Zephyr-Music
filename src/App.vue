<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { usePlayerStore } from "@/stores/player";
import { useAudioBinding } from "@/composables/useAudioBinding";
import { log } from "@/composables/logger";
import { useNeteaseAuth } from "@/composables/useNeteaseAuth";
import { useNeteaseUser } from "@/composables/useNeteaseUser";
import { useWindowControls } from "@/composables/useWindowControls";
import { useHomeSettings } from "@/composables/useHomeSettings";
import Sidebar from "@/components/Sidebar.vue";
import GlobalSearchBar from "@/components/GlobalSearchBar.vue";
import SearchView from "@/components/SearchView.vue";
import NeteaseView from "@/components/NeteaseView.vue";
import QueueView from "@/components/QueueView.vue";
import LibraryView from "@/components/LibraryView.vue";
import RecommendView from "@/components/RecommendView.vue";
import PlayerBar from "@/components/PlayerBar.vue";
import NowPlayingView from "@/components/NowPlayingView.vue";
import SettingsPanel, { useSettings } from "@/components/SettingsPanel.vue";
import HomeSettingsPanel from "@/components/HomeSettingsPanel.vue";
import WindowControls from "@/components/WindowControls.vue";
import ToastContainer from "@/components/ToastContainer.vue";
import Icon from "@/components/Icon.vue";

const store = usePlayerStore();
const { settings } = useSettings();
const { settings: homeSettings } = useHomeSettings();

// 网易云登录逻辑（高内聚：登录相关状态+操作集中在一个 composable）
const {
  neLoggedIn, neUser, showLoginDropdown,
  qrCodeImg, qrStatus, qrMessage,
  showLoginModal, loginTab, loginLoading, loginError,
  phoneForm, captchaSentFlag, emailForm,
  checkNeLogin, startNeLogin, doNeLogout,
  closeDropdown, openLoginModal, closeLoginModal,
  doPhoneLogin, doSendCaptcha, doEmailLogin,
} = useNeteaseAuth();

// 网易云用户信息（VIP/等级/听歌时长）
const { neVipInfo, neListenTotal, neUserLevel } = useNeteaseUser();

// 窗口控制（最小化/最大化/关闭）
const { minimizeWindow, toggleMaximize, closeWindow } = useWindowControls();

const audioRef = ref<HTMLAudioElement | null>(null);
useAudioBinding(audioRef);

/** 首页设置弹窗（独立于播放界面设置） */
const showHomeSettings = ref(false);
const showNowPlaying = computed(() => store.currentView === "nowplaying");

/** 是否启用壁纸背景 */
const hasWallpaper = computed(() =>
  homeSettings.bgType === "image" && !!homeSettings.bgImage && !showNowPlaying.value
);
/** 同步壁纸状态到 body，让子组件（RecommendView 等）能检测并应用毛玻璃样式 */
watch(hasWallpaper, (v) => {
  if (typeof document !== "undefined") {
    document.body.classList.toggle("has-wallpaper", v);
  }
}, { immediate: true });
/** 壁纸加载失败处理 */
function onWallpaperError() {
  log.warn("app", "wallpaper image load failed", { bgImage: homeSettings.bgImage?.substring(0, 80) });
}
/** 壁纸遮罩层样式（用于加深可读性） */
const hasSidebarTransparent = computed(() => hasWallpaper.value && homeSettings.transparentSidebar);

function toggleNowPlaying() {
  if (showNowPlaying.value) store.closeFullscreenPlayer();
  else store.openFullscreenPlayer();
}

onMounted(() => {
  log.init();
  log.info("app", "booted");
  checkNeLogin();
  // 全局禁用原生右键菜单（返回、刷新、另存为、打印等）
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });
  // 点击外部关闭用户下拉框
  document.addEventListener("click", (e) => {
    if (showLoginDropdown.value) {
      const target = e.target as HTMLElement;
      if (target && !target.closest(".ne-auth")) {
        closeDropdown();
      }
    }
  });
  // 恢复上次播放的歌曲：重新获取 URL 和歌词
  const song = store.currentSong;
  if (song) {
    log.info("app", "restoring last song", { name: song.name, hasUrl: !!song.url, hasLrc: !!song.lrc });
    if (song.source === "netease" && song.neteaseId) {
      song.url = "";
      song.lrc = "";
      (song as any).yrcText = "";
      (song as any).tlyricText = "";
      const idx = store.queue.findIndex(s => s.id === song.id);
      if (idx >= 0) {
        store.queue[idx].url = "";
        store.queue[idx].lrc = "";
        (store.queue[idx] as any).yrcText = "";
        (store.queue[idx] as any).tlyricText = "";
      }
      const urlP = store._ensureNeteaseUrl(song);
      const lrcP = store._ensureNeteaseLyrics(song).then(() => {
        if (store.currentSong?.id === song.id) store.loadLyrics(song);
      });
      store.lyrics = [];
      void urlP; void lrcP;
    } else {
      if (song.lrc) store.loadLyrics(song);
    }
  }
  sessionTimer = setInterval(() => store.saveSession(), 10000);
  window.addEventListener("beforeunload", () => store.saveSession());
});
let sessionTimer: ReturnType<typeof setInterval> | null = null;
onUnmounted(() => {
  if (sessionTimer) clearInterval(sessionTimer);
  store.saveSession();
});
</script>

<template>
  <div class="app-shell" :class="{ 'has-wallpaper': hasWallpaper, 'transparent-sidebar': hasSidebarTransparent }" :data-color-mode="settings.colorMode">
    <!-- Hidden audio element for online streaming (local files use Rodio) -->
    <audio ref="audioRef" preload="auto" />

    <!-- 全屏壁纸背景层（覆盖整个窗口，包括标题栏） -->
    <div v-if="hasWallpaper" class="wallpaper-bg">
      <img :src="homeSettings.bgImage" class="wallpaper-img" :style="{ filter: `blur(${homeSettings.bgBlur}px) brightness(${1 - homeSettings.bgDim / 100 * 0.7})`, objectFit: homeSettings.bgFit }" @error="onWallpaperError" />
    </div>

    <!-- Titlebar（品牌 + 右侧操作，搜索框和窗口控件已剥离浮于其上）-->
    <header class="titlebar" data-tauri-drag-region>
      <div class="tb-left">
        <div class="brand">
          <img src="/favicon.svg" alt="Zephyr" class="brand-icon" />
          <span class="brand-name">Zephyr</span>
        </div>
      </div>

      <div class="tb-spacer" />

      <div class="tb-right">
        <!-- 网易云登录/头像 -->
        <div class="ne-auth">
          <button v-if="!neLoggedIn" class="ne-login-btn" @click="openLoginModal">
            <Icon name="music" :size="14" />
            <span>登录</span>
          </button>
          <button v-else class="ne-user-btn" @click="showLoginDropdown = !showLoginDropdown">
            <img v-if="neUser?.avatarUrl" :src="neUser.avatarUrl" class="ne-avatar" referrerpolicy="no-referrer" />
            <span class="ne-name truncate">{{ neUser?.nickname }}</span>
          </button>

          <!-- 已登录：用户信息下拉 -->
          <Transition name="dropdown">
            <div v-if="showLoginDropdown && neLoggedIn" class="ne-dropdown" @click.stop>
              <div class="ne-logged-info">
                <img v-if="neUser?.avatarUrl" :src="neUser.avatarUrl" class="ne-avatar-lg" referrerpolicy="no-referrer" />
                <span class="ne-logged-name">{{ neUser?.nickname }}</span>
                <div v-if="neVipInfo" class="ne-vip-badge" :class="{ vip: neVipInfo.isVip }">
                  <span v-if="neVipInfo.isVip">VIP{{ neVipInfo.redVipLevel || "" }}</span>
                  <span v-else>非 VIP</span>
                  <span v-if="neVipInfo.expireText" class="ne-vip-expire">到期: {{ neVipInfo.expireText }}</span>
                </div>
              </div>
              <div v-if="neListenTotal" class="ne-listen-total">
                <Icon name="clock" :size="13" />
                <span>总听歌时长: {{ neListenTotal }}</span>
              </div>
              <!-- 用户等级 -->
              <div v-if="neUserLevel" class="ne-level-info">
                <div class="ne-level-header">
                  <span class="ne-level-badge">Lv.{{ neUserLevel.level }}</span>
                  <span class="ne-level-progress-text">{{ neUserLevel.progress }}%</span>
                </div>
                <div class="ne-level-bar">
                  <div class="ne-level-bar-fill" :style="{ width: neUserLevel.progress + '%' }"></div>
                </div>
                <div class="ne-level-detail">
                  <span>还需登录 {{ neUserLevel.needLogin }} 天</span>
                  <span>还需听歌 {{ neUserLevel.needPlay }} 首</span>
                </div>
              </div>
              <button class="ne-logout-btn" @click="doNeLogout">退出登录</button>
            </div>
          </Transition>
        </div>

        <button class="icon-btn" :class="{ active: showNowPlaying }" title="全屏播放器" @click="toggleNowPlaying">
          <Icon name="expand" :size="16" />
        </button>
        <button class="icon-btn" title="首页设置" @click="showHomeSettings = true">
          <img src="/icons/settings.svg" alt="settings" class="settings-icon" />
        </button>
      </div>
    </header>

    <!-- 搜索框：浮于标题栏上方，居中，与标题栏剥离 -->
    <div class="floating-search">
      <GlobalSearchBar />
    </div>

    <!-- 窗口控件：浮于标题栏右上角，与标题栏剥离 -->
    <div class="floating-win-ctrls">
      <WindowControls @minimize="minimizeWindow" @toggleMaximize="toggleMaximize" @close="closeWindow" />
    </div>

    <!-- Body: sidebar + main view + playerbar -->
    <div class="app-body">
      <Sidebar />

      <main class="main-view">
        <SearchView v-if="store.currentView === 'search'" />
        <NeteaseView v-else-if="store.currentView === 'netease'" />
        <RecommendView v-else-if="store.currentView === 'recommend'" />
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

    <!-- 首页设置弹窗（独立于播放界面设置） -->
    <HomeSettingsPanel :visible="showHomeSettings" @close="showHomeSettings = false" />

    <!-- 登录弹窗 -->
    <Transition name="login-modal">
      <div v-if="showLoginModal" class="login-modal-overlay" @click="closeLoginModal">
        <div class="login-modal" @click.stop>
          <button class="login-modal-close" @click="closeLoginModal"><Icon name="close" :size="20" /></button>
          <h2 class="login-modal-title">登录网易云音乐</h2>
          <!-- 标签页切换 -->
          <div class="login-tabs">
            <button class="login-tab" :class="{ active: loginTab === 'qr' }" @click="loginTab = 'qr'">扫码登录</button>
            <button class="login-tab" :class="{ active: loginTab === 'phone' }" @click="loginTab = 'phone'">手机登录</button>
            <button class="login-tab" :class="{ active: loginTab === 'email' }" @click="loginTab = 'email'">邮箱登录</button>
          </div>

          <!-- 扫码登录 -->
          <div v-if="loginTab === 'qr'" class="login-qr-content">
            <div v-if="qrStatus === 'loading'" class="qr-loading"><div class="spinner" /><span>正在生成...</span></div>
            <div v-else class="qr-show">
              <img v-if="qrCodeImg" :src="qrCodeImg" alt="二维码" class="qr-img" />
              <div v-if="qrStatus === 'expired'" class="qr-expired" @click="startNeLogin">点击刷新</div>
            </div>
            <p class="qr-msg">{{ qrMessage }}</p>
          </div>

          <!-- 手机登录 -->
          <div v-if="loginTab === 'phone'" class="login-form">
            <input class="login-input" v-model="phoneForm.phone" placeholder="手机号码" type="tel" />
            <input class="login-input" v-model="phoneForm.countrycode" placeholder="国家码（可选，如 1=美国）" type="text" />
            <input class="login-input" v-model="phoneForm.password" placeholder="密码（与验证码二选一）" type="password" />
            <div class="captcha-row">
              <input class="login-input captcha-input" v-model="phoneForm.captcha" placeholder="验证码（与密码二选一）" type="text" />
              <button class="captcha-btn" @click="doSendCaptcha" :disabled="!phoneForm.phone">发送</button>
            </div>
            <button class="login-submit" @click="doPhoneLogin" :disabled="loginLoading">
              {{ loginLoading ? "登录中..." : "登录" }}
            </button>
          </div>

          <!-- 邮箱登录 -->
          <div v-if="loginTab === 'email'" class="login-form">
            <input class="login-input" v-model="emailForm.email" placeholder="163 网易邮箱" type="email" />
            <input class="login-input" v-model="emailForm.password" placeholder="密码" type="password" />
            <button class="login-submit" @click="doEmailLogin" :disabled="loginLoading">
              {{ loginLoading ? "登录中..." : "登录" }}
            </button>
          </div>

          <!-- 错误提示 -->
          <p v-if="loginError" class="login-error">{{ loginError }}</p>
        </div>
      </div>
    </Transition>

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
  position: relative;
}
/* 有壁纸时 app-shell 背景透明，露出壁纸 */
.app-shell.has-wallpaper {
  background: transparent;
}

/* ----- 全屏壁纸背景层（用 img 标签，CSP 友好） ----- */
.wallpaper-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}
.wallpaper-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-position: center;
  transform: scale(1.05); /* 避免 blur 边缘出现透明边 */
}
/* 有壁纸时，标题栏/侧边栏/主视图背景透明，露出壁纸 */
.app-shell.has-wallpaper .titlebar {
  background: transparent !important;
  border-bottom-color: rgba(255,255,255,0.06);
  position: relative;
  z-index: 2;
}
.app-shell.has-wallpaper.transparent-sidebar .app-body > :deep(.sidebar) {
  background: transparent !important;
}
.app-shell.has-wallpaper .main-view {
  background: transparent !important;
}
.app-shell.has-wallpaper .app-body {
  position: relative;
  z-index: 1;
}

/* ----- Titlebar ----- */
.titlebar {
  display: flex;
  align-items: center;
  height: var(--titlebar-h);
  padding: 0 12px;
  /* 右侧留出窗口控件空间 */
  padding-right: 110px;
  background: var(--bg-elev-1);
  border-bottom: 1px solid var(--border);
  gap: 8px;
  flex-shrink: 0;
  position: relative;
  z-index: 2;
}
.tb-left {
  display: flex;
  align-items: center;
  gap: 8px;
  width: var(--sidebar-w);
  flex-shrink: 0;
}
.tb-left .icon-btn { width: 28px; height: 28px; }
.tb-spacer { flex: 1; }
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
.tb-right {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tb-right .icon-btn { width: 28px; height: 28px; }
.settings-icon { width: 16px; height: 16px; display: inline-block; pointer-events: none; }

/* 搜索框：浮于标题栏上方，居中，与标题栏剥离 */
.floating-search {
  position: fixed;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  width: 420px;
  max-width: calc(100vw - 280px);
  -webkit-app-region: no-drag;
}
.floating-search :deep(.search-bar) {
  background: var(--bg-elev-3);
  box-shadow: 0 2px 12px rgba(0,0,0,0.25);
}
/* 有壁纸时搜索框改为毛玻璃半透明，适应壁纸背景 */
.app-shell.has-wallpaper .floating-search :deep(.search-bar) {
  background: rgba(40, 38, 46, 0.55);
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow: 0 4px 20px rgba(0,0,0,0.35);
}
.app-shell.has-wallpaper .floating-search :deep(.search-bar:focus-within) {
  border-color: var(--accent);
  background: rgba(50, 48, 56, 0.65);
}

/* 窗口控件：浮于标题栏右上角，与标题栏剥离 */
.floating-win-ctrls {
  position: fixed;
  top: 9px;
  right: 12px;
  z-index: 50;
  -webkit-app-region: no-drag;
}

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
  position: absolute; top: 100%; right: 0; z-index: 9999;
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
.ne-logged-info { display: flex; flex-direction: column; align-items: center; gap: 6px; margin-bottom: 10px; }
.ne-avatar-lg { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; }
.ne-logged-name { font-size: 14px; color: var(--text); font-weight: 600; }
.ne-logged-info span { font-size: 13px; color: var(--text); }
/* VIP 标识 */
.ne-vip-badge { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 3px 10px; border-radius: 10px; font-size: 11px; background: var(--bg-elev-1); color: var(--text-tertiary); }
.ne-vip-badge.vip { background: linear-gradient(135deg, #ffd700, #ff8c00); color: #fff; font-weight: 600; }
.ne-vip-expire { font-size: 10px; opacity: 0.8; font-weight: 400; }
/* 总听歌时长 */
.ne-listen-total { display: flex; align-items: center; justify-content: center; gap: 5px; font-size: 11px; color: var(--text-tertiary); margin-bottom: 10px; }
.ne-listen-total :deep(.icon-svg) { opacity: 0.7; }
.ne-logout-btn { padding: 6px 16px; border-radius: var(--radius-full); font-size: 12px; color: var(--text-tertiary); border: 1px solid var(--border); transition: all 0.15s; }
.ne-logout-btn:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
/* 用户等级 */
.ne-level-info { width: 100%; margin-bottom: 10px; padding: 10px 12px; background: var(--bg-elev-1); border-radius: var(--radius-sm); }
.ne-level-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.ne-level-badge { font-size: 13px; font-weight: 700; color: var(--accent); }
.ne-level-progress-text { font-size: 11px; color: var(--text-tertiary); }
.ne-level-bar { width: 100%; height: 4px; background: var(--bg-elev-3); border-radius: 2px; overflow: hidden; margin-bottom: 6px; }
.ne-level-bar-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.3s var(--ease-out); }
.ne-level-detail { display: flex; justify-content: space-between; font-size: 10px; color: var(--text-tertiary); }
.dropdown-enter-active, .dropdown-leave-active { transition: all 0.15s; }
.dropdown-enter-from, .dropdown-leave-to { opacity: 0; transform: translateY(-8px); }
@keyframes spin { to { transform: rotate(360deg); } }

/* ===== 登录弹窗 ===== */
.login-modal-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}
.login-modal {
  position: relative;
  width: 380px; max-width: 90vw;
  background: var(--bg-elev-3); border: 1px solid var(--border-strong);
  border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  padding: 28px 28px 24px; display: flex; flex-direction: column; align-items: center;
}
.login-modal-close {
  position: absolute; top: 12px; right: 12px;
  width: 32px; height: 32px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); transition: all 0.15s;
}
.login-modal-close:hover { color: var(--text); background: var(--bg-hover); }
.login-modal-title { margin: 0 0 20px; font-size: 18px; font-weight: 700; }
.login-tabs { display: flex; gap: 4px; margin-bottom: 20px; background: var(--bg-elev-1); padding: 3px; border-radius: 10px; }
.login-tab {
  padding: 6px 16px; border-radius: 8px; font-size: 13px; font-weight: 500;
  color: var(--text-secondary); transition: all 0.15s;
}
.login-tab:hover { color: var(--text); }
.login-tab.active { background: var(--accent); color: #fff; }
/* 扫码 */
.login-qr-content { display: flex; flex-direction: column; align-items: center; gap: 8px; }
/* 表单 */
.login-form { display: flex; flex-direction: column; gap: 10px; width: 100%; }
.login-input {
  width: 100%; height: 38px; padding: 0 12px; border-radius: 8px;
  background: var(--bg-elev-1); border: 1px solid var(--border);
  color: var(--text); font-size: 13px; transition: border-color 0.15s;
}
.login-input:focus { outline: none; border-color: var(--accent); }
.login-input::placeholder { color: var(--text-tertiary); }
.captcha-row { display: flex; gap: 8px; }
.captcha-input { flex: 1; }
.captcha-btn {
  padding: 0 14px; border-radius: 8px; font-size: 12px;
  background: var(--bg-elev-1); border: 1px solid var(--border);
  color: var(--text-secondary); transition: all 0.15s; white-space: nowrap;
}
.captcha-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
.captcha-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.login-submit {
  margin-top: 6px; height: 40px; border-radius: 10px;
  background: var(--accent); color: #fff; font-size: 14px; font-weight: 600;
  transition: all 0.15s;
}
.login-submit:hover:not(:disabled) { opacity: 0.9; }
.login-submit:disabled { opacity: 0.5; cursor: not-allowed; }
.login-error { margin: 12px 0 0; font-size: 12px; color: #ff4d4f; text-align: center; }
/* 弹窗动画 */
.login-modal-enter-active, .login-modal-leave-active { transition: opacity 0.2s; }
.login-modal-enter-from, .login-modal-leave-to { opacity: 0; }
.login-modal-enter-active .login-modal, .login-modal-leave-active .login-modal {
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.login-modal-enter-from .login-modal, .login-modal-leave-to .login-modal {
  transform: scale(0.92);
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

<!-- 非 scoped 样式：有壁纸时用户按钮毛玻璃半透明 -->
<style>
body.has-wallpaper .ne-login-btn,
body.has-wallpaper .ne-user-btn {
  background: rgba(40, 38, 46, 0.55) !important;
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  border: 1px solid rgba(255, 255, 255, 0.10);
  box-shadow: 0 2px 12px rgba(0,0,0,0.25);
}
body.has-wallpaper .ne-user-btn:hover {
  background: rgba(50, 48, 56, 0.65) !important;
}
body.has-wallpaper .ne-login-btn:hover {
  background: rgba(50, 48, 56, 0.65) !important;
}
</style>
