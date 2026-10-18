<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, defineAsyncComponent, type Component } from "vue";
import type { ViewKey } from "@/types";
import { usePlayerStore } from "@/stores/player";
import { useAudioBinding } from "@/composables/useAudioBinding";
import { log } from "@/composables/logger";
import { useNeteaseAuth } from "@/composables/useNeteaseAuth";
import { useNeteaseUser, formatCreateTime, genderText, regionText } from "@/composables/useNeteaseUser";
import { useWindowControls } from "@/composables/useWindowControls";
import { useHomeSettings } from "@/composables/useHomeSettings";
import { initStores, initPlayerStore, flushPlayerStore } from "@/composables/useStore";
import { reloadSettingsFromStore } from "@/composables/useSettings";
import { reloadHomeSettingsFromStore } from "@/composables/useHomeSettings";
import { initCookie, flushCookie } from "@/composables/useCookie";
import { useToast } from "@/composables/useToast";
import { initSessionCache, flushSession, setPreloadAudioDataFn } from "@/stores/player";
import { initMediaSession } from "@/components/NowPlaying/useMediaSession";
import { useTray } from "@/components/NowPlaying/useTray";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Sidebar from "@/components/Sidebar.vue";
import GlobalSearchBar from "@/components/GlobalSearchBar.vue";
import SearchView from "@/components/SearchView.vue";
import NeteaseView from "@/components/NeteaseView.vue";
import QueueView from "@/components/QueueView.vue";
import LibraryView from "@/components/LibraryView.vue";
import RecommendView from "@/components/RecommendView.vue";
import CloudDiskView from "@/components/CloudDiskView.vue";
import ProfileView from "@/components/ProfileView.vue";
import SongCommentsView from "@/components/SongCommentsView.vue";
import MessageView from "@/components/MessageView.vue";
import NotificationView from "@/components/NotificationView.vue";
import PlayerBar from "@/components/PlayerBar.vue";
// 全屏播放器异步加载：歌词/封面控制/队列/可视化等重组件拆分到独立 chunk，
// 首次打开播放界面时才下载解析（Transition 淡入掩盖本地 chunk 加载）
const NowPlayingView = defineAsyncComponent(() => import("@/components/NowPlayingView.vue"));
import { useSettings } from "@/composables/useSettings";
import HomeSettingsPanel from "@/components/HomeSettingsPanel.vue";
import WindowControls from "@/components/WindowControls.vue";
import ToastContainer from "@/components/ToastContainer.vue";
import Icon from "@/components/Icon.vue";

const store = usePlayerStore();
const appToast = useToast();
const { settings } = useSettings();
const { settings: homeSettings } = useHomeSettings();

// 网易云登录逻辑（高内聚：登录相关状态+操作集中在一个 composable）
const {
  neLoggedIn, neUser, showLoginDropdown,
  qrCodeImg, qrStatus, qrMessage,
  showLoginModal, loginTab, loginLoading, loginError,
  phoneForm, phoneLoginMode, showPhonePassword, captchaSentFlag, captchaCountdown, captchaSending,
  emailForm, showEmailPassword,
  countryLoading, showCountryPicker, countrySearch, manualCountryCode,
  phoneValid, emailValid, canSendCaptcha, canSubmitPhone, canSubmitEmail,
  countryCodeLabel, selectedCountryName, filteredCountryGroups,
  phoneValidationMessage, emailValidationMessage,
  checkNeLogin, startNeLogin, doNeLogout,
  closeDropdown, openLoginModal, closeLoginModal, setLoginTab,
  doPhoneLogin, doSendCaptcha, doEmailLogin,
  selectCountry, applyManualCountryCode, toggleCountryPicker,
  onPhoneInput, onCaptchaInput, onEmailBlur, clearError,
} = useNeteaseAuth();

// 网易云用户信息（VIP/等级/听歌时长）
const { neVipInfo, neListenTotal, neUserLevel } = useNeteaseUser();

// ===== 标题栏弹窗 VIP 图标（同 ProfileView 逻辑：动画图优先，失败回退常规图） =====
const neVipIconSrc = ref("");
const neVipDynamicFailed = ref(false);
function resetNeVipIcon() {
  neVipDynamicFailed.value = false;
  const v = neVipInfo.value;
  if (!v) { neVipIconSrc.value = ""; return; }
  if (v.dynamicIconUrl) neVipIconSrc.value = v.dynamicIconUrl;
  else if (v.iconUrl) neVipIconSrc.value = v.iconUrl;
  else neVipIconSrc.value = "";
}
function onNeVipIconError() {
  if (neVipDynamicFailed.value) return;
  neVipDynamicFailed.value = true;
  const fb = neVipInfo.value?.iconUrl || "";
  if (fb && neVipIconSrc.value !== fb) neVipIconSrc.value = fb;
}
// 每次打开弹窗时重置 VIP 图，触发动画图重新请求+播放
watch(showLoginDropdown, (open) => { if (open) resetNeVipIcon(); });

/** 用户卡片"个人资料"行的内联 SVG 图标（Icon.vue 暂未提供 calendar/user/mapPin） */
const SVG_CALENDAR = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 9h16M8 3v4M16 3v4"/></svg>`;
const SVG_USER = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/></svg>`;
const SVG_MAPPIN = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>`;

/** 用户卡片"个人资料"信息行（注册时间 / 性别 / 所在地），空值自动隐藏 */
const neProfileItems = computed(() => {
  const u = neUser.value;
  if (!u) return [];
  const items: { label: string; value: string; icon: string }[] = [];
  const created = formatCreateTime(u.createTime);
  if (created) items.push({ label: "注册时间", value: created, icon: SVG_CALENDAR });
  if (u.gender === 1 || u.gender === 2) items.push({ label: "性别", value: genderText(u.gender), icon: SVG_USER });
  const region = regionText(u.province, u.city);
  if (region) items.push({ label: "所在地", value: region, icon: SVG_MAPPIN });
  return items;
});

// 窗口控制（最小化/最大化/关闭）
const { minimizeWindow, toggleMaximize, closeWindow } = useWindowControls();

const audioRef = ref<HTMLAudioElement | null>(null);
const { preloadAudioData } = useAudioBinding(audioRef);
// 注入音频字节预加载函数给 player store，让 _preloadNextSong 在拿到下一首 URL 后触发预拉
setPreloadAudioDataFn(preloadAudioData);

/** 首页设置作为 main-view 视图显示（不覆盖侧边栏和音乐栏） */
function openHomeSettings() { store.setView("settings"); }
function closeHomeSettings() { store.setView("recommend"); }
const showNowPlaying = computed(() => store.currentView === "nowplaying");

/** 主视图组件映射。配合 KeepAlive 缓存组件实例：
 *  切换页面时保留列表滚动位置、搜索结果、已加载数据，避免重复请求接口。
 *  SongCommentsView/HomeSettingsPanel 不在 include 列表中（每次进入时重新挂载）。
 *  注意：KeepAlive 的动态子组件必须始终渲染一个组件（不能 v-if 置空），
 *  否则切换时会触发 Vue 的 "parentComponent.ctx.deactivate is not a function"。 */
const VIEW_COMPONENTS: Record<Exclude<ViewKey, "nowplaying">, Component> = {
  search: SearchView,
  netease: NeteaseView,
  recommend: RecommendView,
  queue: QueueView,
  library: LibraryView,
  profile: ProfileView,
  clouddisk: CloudDiskView,
  songcomments: SongCommentsView,
  settings: HomeSettingsPanel,
  message: MessageView,
  notification: NotificationView,
};
/** 实际渲染的视图：nowplaying 全屏时保留上一个视图内容，避免动画期间透出空白 */
const effectiveView = computed<Exclude<ViewKey, "nowplaying">>(() => {
  const v = store.currentView === "nowplaying" ? (store.previousView || "recommend") : store.currentView;
  return (v === "nowplaying" ? "recommend" : v);
});
const activeViewComponent = computed(() => VIEW_COMPONENTS[effectiveView.value] || RecommendView);
/** 仅设置面板需要的透传 props */
const activeViewProps = computed(() => (effectiveView.value === "settings" ? { visible: true } : {}));

/** 主题切换（light / dark / auto） */
type ColorMode = "light" | "dark" | "auto";
function toggleColorMode() {
  const order: ColorMode[] = ["light", "dark", "auto"];
  const cur = (settings.colorMode as ColorMode) || "light";
  const next = order[(order.indexOf(cur) + 1) % order.length];
  settings.colorMode = next as any;
}

/** 是否启用壁纸背景（首页/搜索/歌单等所有界面，但播放界面有自己的背景层） */
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

function onNeteaseAuthExpired() {
  neLoggedIn.value = false;
  appToast.warning("登录已过期", "请重新登录后继续操作", 5000);
  if (!showLoginModal.value) openLoginModal();
}

// ===== 关闭行为（最小化到托盘 / 直接退出，由首页设置 exitAction 决定） =====
async function handleRequestClose() {
  if (homeSettings.exitAction === "quit") {
    try {
      store.saveSession();
      await Promise.allSettled([flushSession(), flushCookie(), flushPlayerStore()]);
      await invoke("quit_app");
    } catch (e) {
      log.error("app", "quit failed", { error: String(e) });
      // 兜底：直接销毁窗口，避免退出流程卡死
      try { await getCurrentWindow().destroy(); } catch { /* ignore */ }
    }
  } else {
    try {
      await getCurrentWindow().hide();
    } catch (e) {
      log.warn("app", "hide to tray failed", { error: String(e) });
    }
  }
}

onMounted(() => {
  window.addEventListener("netease-auth-expired", onNeteaseAuthExpired);
  log.init();
  log.info("app", "booted");
  // 持久化初始化链（顺序很重要）：
  //   1. get_app_data_dir  — Rust 端同步创建 data/、data/cookie/、data/playlist/ 目录
  //   2. initStores        — 加载 data/settings.json（首页设置等）到内存缓存
  //   3. reloadHomeSettings — 从 default store 刷新首页设置（壁纸/主题色/字体）到响应式状态
  //   4. initPlayerStore   — 加载 data/player_settings.json（播放器设置）到内存缓存
  //   5. reloadSettings    — 从 player store 刷新播放器设置到响应式状态
  //   6. initCookie        — 读取 data/cookie/cookies.txt（明文）到内存缓存
  //   7. initSessionCache  — 读取 data/playlist/playlist.json（退出前的歌单）到内存缓存
  //   8. restoreSession    — 将缓存应用到 store 状态
  //   9. restoreLastSong   — 恢复上次播放的歌曲（重新获取 URL/歌词）
  //  10. checkNeLogin      — cookie 就绪后再检查登录状态
  (async () => {
    try {
      await invoke<string>("get_app_data_dir");
    } catch (e) {
      log.warn("app", "get_app_data_dir failed", { error: String(e) });
    }
    await initStores();
    reloadHomeSettingsFromStore();
    log.info("app", "home settings reloaded from store");
    await initPlayerStore();
    reloadSettingsFromStore();
    log.info("app", "player settings loaded");
    // 初始化浏览器媒体控制（Media Session API）。
    // 必须在 player settings 加载完成后调用，让 settings.mediaSessionEnabled 默认值生效。
    // 单例 + 应用级 watcher：在后台自动同步 currentSong / isPlaying / currentTime 到系统媒体控件。
    initMediaSession();
    log.info("app", "media session initialized");
    // 系统托盘桥接（单例 composable）：同步托盘 tooltip + 向 tray-popup 弹窗推送播放状态，
    // 并监听弹窗发来的播放控制动作（上一首/播放暂停/下一首/退出）。
    useTray();
    log.info("app", "tray bridge initialized");
    await initCookie();
    log.info("app", "cookie loaded");
    await initSessionCache();
    const restored = store.restoreSession();
    log.info("app", "session restored", { hasSong: restored });
    restoreLastSong();
    checkNeLogin();
  })();
  // 窗口关闭前安全落盘：阻止默认关闭，等待 playlist/cookie/player-settings 写盘完成后再销毁窗口
  // try/catch：非 Tauri 环境（如浏览器中调试）getCurrentWindow 会同步抛错，
  // 不能让它中断 onMounted 后续逻辑（快捷键拦截、会话定时器等）
  try {
    getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      // 托盘/退出流程若已设置退出标记（consume_quit_flag），直接落盘后销毁，
      // 不再走"关闭到托盘"逻辑（防止退出被 hide 拦截导致无法真正退出）
      const quitting = await invoke<boolean>("consume_quit_flag").catch(() => false);
      if (quitting) {
        try {
          store.saveSession();
          await flushSession();
          await flushCookie();
          await flushPlayerStore();
          log.info("app", "flushed on quit, destroying");
        } catch (e) {
          log.warn("app", "flush on quit failed", { error: String(e) });
        }
        await getCurrentWindow().destroy();
        return;
      }
      // 普通关闭：按首页设置决定 隐藏到托盘 / 落盘退出
      await handleRequestClose();
    }).then((un) => { unlistenClose = un; }).catch(() => {});
  } catch (e) {
    log.warn("app", "onCloseRequested unavailable (browser env?)", { error: String(e) });
  }
  // 全局禁用原生右键菜单（返回、刷新、另存为、打印等）
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });
  // 屏蔽所有网页快捷键（Ctrl+R/F5 刷新、Ctrl+F 查找、F11 全屏、Ctrl+S 保存、Ctrl+P 打印、Ctrl+/- 缩放等）
  document.addEventListener("keydown", (e) => {
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    // F5 / Ctrl+R / Ctrl+Shift+R = 刷新
    if (k === "F5" || (ctrl && k.toLowerCase() === "r")) { e.preventDefault(); return; }
    // F11 = 全屏
    if (k === "F11") { e.preventDefault(); return; }
    // Ctrl+F = 查找
    if (ctrl && k.toLowerCase() === "f") { e.preventDefault(); return; }
    // Ctrl+S = 保存
    if (ctrl && k.toLowerCase() === "s") { e.preventDefault(); return; }
    // Ctrl+P = 打印
    if (ctrl && k.toLowerCase() === "p") { e.preventDefault(); return; }
    // Ctrl+O = 打开文件
    if (ctrl && k.toLowerCase() === "o") { e.preventDefault(); return; }
    // Ctrl+G = 查找下一个
    if (ctrl && k.toLowerCase() === "g") { e.preventDefault(); return; }
    // Ctrl+H = 历史
    if (ctrl && k.toLowerCase() === "h") { e.preventDefault(); return; }
    // Ctrl+J = 下载
    if (ctrl && k.toLowerCase() === "j") { e.preventDefault(); return; }
    // Ctrl+D = 收藏夹
    if (ctrl && k.toLowerCase() === "d") { e.preventDefault(); return; }
    // Ctrl+W = 关闭窗口（让 Tauri 自己处理）
    if (ctrl && k.toLowerCase() === "w") { e.preventDefault(); return; }
    // Ctrl+N = 新窗口
    if (ctrl && k.toLowerCase() === "n") { e.preventDefault(); return; }
    // Ctrl+T = 新标签页
    if (ctrl && k.toLowerCase() === "t") { e.preventDefault(); return; }
    // Ctrl+L = 地址栏
    if (ctrl && k.toLowerCase() === "l") { e.preventDefault(); return; }
    // Ctrl+U = 查看源码
    if (ctrl && k.toLowerCase() === "u") { e.preventDefault(); return; }
    // Ctrl+加号/减号/0 = 缩放
    if (ctrl && (k === "+" || k === "-" || k === "=" || k === "0")) { e.preventDefault(); return; }
    // F3 = 查找下一个
    if (k === "F3") { e.preventDefault(); return; }
    // F7 = 光标浏览
    if (k === "F7") { e.preventDefault(); return; }
    // Alt+方向键 = 后退/前进
    if (e.altKey && (k === "ArrowLeft" || k === "ArrowRight")) { e.preventDefault(); return; }
    // Ctrl+Shift+I / F12 = 开发者工具
    if ((ctrl && e.shiftKey && k.toLowerCase() === "i") || k === "F12") { e.preventDefault(); return; }
    // Ctrl+Shift+J = 控制台
    if (ctrl && e.shiftKey && k.toLowerCase() === "j") { e.preventDefault(); return; }
    // Ctrl+Shift+C = 元素检查
    if (ctrl && e.shiftKey && k.toLowerCase() === "c") { e.preventDefault(); return; }
    // Ctrl+Shift+Delete = 清除浏览数据
    if (ctrl && e.shiftKey && k.toLowerCase() === "delete") { e.preventDefault(); return; }
    // Ctrl+Tab / Ctrl+Shift+Tab = 切换标签（应用内无标签，禁用）
    if (ctrl && k === "Tab") { e.preventDefault(); return; }
  }, true);  // capture 阶段拦截，确保在其他 handler 之前
  // 点击外部关闭用户下拉框
  document.addEventListener("click", (e) => {
    if (showLoginDropdown.value) {
      const target = e.target as HTMLElement;
      if (target && !target.closest(".ne-auth")) {
        closeDropdown();
      }
    }
  });
  // 上次播放歌曲的恢复逻辑（提取为函数，供上方初始化链在 session 恢复后调用）
  function restoreLastSong() {
  // 恢复上次播放的歌曲：重新获取 URL 和歌词，获取成功后自动开始播放并恢复到上次进度
  const song = store.currentSong;
  const savedTime = store.currentTime;  // 保存上次播放位置，URL 获取过程中会被重置
  if (song) {
    log.info("app", "restoring last song", { name: song.name, hasUrl: !!song.url, hasLrc: !!song.lrc, savedTime });
    const shouldAutoPlay = homeSettings.autoPlayOnStartup;
    if (song.source === "netease" && song.neteaseId) {
      // 标记恢复播放和恢复进度，让 useAudioBinding 在 URL 加载完成后处理
      // 仅在设置开启自动播放时才标记 _restorePlaying
      (song as any)._restorePlaying = shouldAutoPlay;
      (song as any)._restoreTime = savedTime > 0 ? savedTime : 0;
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
        (store.queue[idx] as any)._restorePlaying = shouldAutoPlay;
        (store.queue[idx] as any)._restoreTime = (song as any)._restoreTime;
      }
      store.lyrics = [];
      // 并行获取 URL 和歌词
      const urlP = store._ensureNeteaseUrl(song);
      const lrcP = store._ensureNeteaseLyrics(song).then(() => {
        if (store.currentSong?.id === song.id) store.loadLyrics(song);
      });
      // 后台加载高潮点（与 PlayerBar/NowPlaying 共享同一份 chorusStart）
      void store.preloadChorus();
      // 后台预加载下一首（受 settings.preloadNextSong 开关控制）
      void store._preloadNextSong();
      // URL 获取失败时清理恢复标记（避免下次切歌误触发）
      urlP.then(() => {
        if (!song.url) {
          (song as any)._restorePlaying = false;
          (song as any)._restoreTime = 0;
          log.warn("app", "restore url failed - song will not auto-play", { name: song.name });
        }
      }).catch((e) => {
        (song as any)._restorePlaying = false;
        (song as any)._restoreTime = 0;
        log.warn("app", "restore url error", { error: String(e) });
      });
      void lrcP;
    } else {
      // 本地歌曲：URL 还在，直接恢复播放
      if (song.url) {
        if (song.lrc) store.loadLyrics(song);
        // 设置恢复进度（useAudioBinding 的 seek watch 会处理）
        if (savedTime > 0 && savedTime < (song.duration || Infinity)) {
          // 触发 audio.currentTime 设置
          store.currentTime = savedTime;
        }
        // 本地歌曲使用 Rodio，需要重新触发播放（rodio 在程序退出时已停止）
        // 通过设置 _restorePlaying 标记，并手动触发 rodio 重新加载
        (song as any)._restorePlaying = true;
        (song as any)._restoreTime = savedTime > 0 ? savedTime : 0;
        // 强制触发 url watch：先把 url 清空再恢复（hack 但有效）
        const savedUrl = song.url;
        song.url = "";
        // queue 同步
        const idx2 = store.queue.findIndex(s => s.id === song.id);
        if (idx2 >= 0) {
          store.queue[idx2].url = "";
          (store.queue[idx2] as any)._restorePlaying = true;
          (store.queue[idx2] as any)._restoreTime = (song as any)._restoreTime;
        }
        // 下一 tick 恢复 url，触发 watch
        setTimeout(() => {
          song.url = savedUrl;
          if (idx2 >= 0) store.queue[idx2].url = savedUrl;
        }, 50);
      }
    }
  }
  }
  sessionTimer = setInterval(() => store.saveSession(), 10000);
  window.addEventListener("beforeunload", () => store.saveSession());
});
let sessionTimer: ReturnType<typeof setInterval> | null = null;
let unlistenClose: (() => void) | null = null;
onUnmounted(() => {
  if (sessionTimer) clearInterval(sessionTimer);
  if (unlistenClose) unlistenClose();
  window.removeEventListener("netease-auth-expired", onNeteaseAuthExpired);
  store.saveSession();
});
</script>

<template>
  <div class="app-shell" :class="{ 'has-wallpaper': hasWallpaper, 'transparent-sidebar': hasSidebarTransparent }" :data-color-mode="settings.colorMode">
    <!-- Hidden audio element for online streaming (local files use Rodio) -->
    <audio ref="audioRef" preload="auto" />

    <!-- 全屏壁纸背景层（覆盖整个窗口，包括标题栏） -->
    <div v-if="hasWallpaper" class="wallpaper-bg">
      <img :src="homeSettings.bgImage" class="wallpaper-img" :style="{ filter: `blur(${homeSettings.bgBlur}px) brightness(${1 - homeSettings.bgDim / 100 * 0.7})`, objectFit: 'cover', transform: homeSettings.bgFit === 'contain' ? 'scale(1)' : 'scale(1.05)' }" @error="onWallpaperError" />
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
              <!-- Header: 头像 + 昵称 + VIP 徽章 + 个性签名 -->
              <div class="ne-card-header">
                <img v-if="neUser?.avatarUrl" :src="neUser.avatarUrl" class="ne-avatar-lg" referrerpolicy="no-referrer" />
                <div class="ne-header-text">
                  <div class="ne-header-name-row">
                    <span class="ne-logged-name">{{ neUser?.nickname }}</span>
                    <!-- VIP 图标：优先动画图(dynamicIconUrl)，失败回退常规图(iconUrl) -->
                    <img
                      v-if="neVipIconSrc"
                      :src="neVipIconSrc"
                      class="ne-vip-icon"
                      :class="{ 'is-dynamic': !neVipDynamicFailed }"
                      referrerpolicy="no-referrer"
                      :alt="neVipInfo?.isVip ? `黑胶VIP${neVipInfo.redVipLevel || ''}` : 'VIP'"
                      @error="onNeVipIconError"
                    />
                  </div>
                  <p v-if="neUser?.signature" class="ne-signature" :title="neUser.signature">{{ neUser.signature }}</p>
                  <p v-if="neVipInfo?.expireText" class="ne-vip-expire-line">VIP 到期: {{ neVipInfo.expireText }}</p>
                </div>
              </div>

              <!-- 个人资料: 注册时间 / 性别 / 所在地（空值自动隐藏） -->
              <div v-if="neProfileItems.length" class="ne-profile-grid">
                <div v-for="item in neProfileItems" :key="item.label" class="ne-profile-item">
                  <span class="ne-profile-icon" v-html="item.icon" />
                  <span class="ne-profile-label">{{ item.label }}</span>
                  <span class="ne-profile-value">{{ item.value }}</span>
                </div>
              </div>

              <!-- 总听歌时长 -->
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
        <button class="icon-btn theme-toggle" :title="`主题：${settings.colorMode}`" @click="toggleColorMode">
          <Icon :name="settings.colorMode === 'dark' ? 'moon' : 'sun'" :size="16" />
        </button>
        <button class="icon-btn" :class="{ active: store.currentView === 'settings' }" title="首页设置" @click="openHomeSettings">
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
        <!-- KeepAlive 缓存视图实例：切换页面保留数据与滚动位置，不重复请求接口 -->
        <KeepAlive include="SearchView,NeteaseView,RecommendView,QueueView,LibraryView,ProfileView,MessageView,NotificationView">
          <component
            :is="activeViewComponent"
            v-bind="activeViewProps"
            @close="closeHomeSettings"
            @request-login="openLoginModal"
          />
        </KeepAlive>
      </main>
    </div>

    <!-- Bottom mini player -->
    <PlayerBar />

    <!-- NowPlaying fullscreen overlay -->
    <Transition name="np-fade">
      <NowPlayingView v-if="showNowPlaying" />
    </Transition>

    <!-- 首页设置已移至 main-view 视图 -->

    <!-- 登录弹窗 -->
    <Transition name="login-modal">
      <div v-if="showLoginModal" class="login-modal-overlay" @click="closeLoginModal">
        <div
          class="login-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="login-modal-title"
          @click.stop
          @keydown.esc="closeLoginModal"
        >
          <button class="login-modal-close" type="button" title="关闭登录窗口" @click="closeLoginModal">
            <Icon name="close" :size="20" />
          </button>
          <!-- 头部品牌 -->
          <div class="login-modal-head">
            <img src="/favicon.svg" alt="Zephyr" class="login-logo" />
            <h2 id="login-modal-title" class="login-modal-title">登录网易云音乐</h2>
            <p class="login-modal-sub">登录后可同步歌单、评论互动与听歌记录</p>
          </div>

          <!-- 标签页切换 -->
          <div class="login-tabs" role="tablist" aria-label="登录方式">
            <button
              class="login-tab"
              type="button"
              role="tab"
              :aria-selected="loginTab === 'qr'"
              :class="{ active: loginTab === 'qr' }"
              @click="setLoginTab('qr')"
            >
              扫码登录
            </button>
            <button
              class="login-tab"
              type="button"
              role="tab"
              :aria-selected="loginTab === 'phone'"
              :class="{ active: loginTab === 'phone' }"
              @click="setLoginTab('phone')"
            >
              手机登录
            </button>
            <button
              class="login-tab"
              type="button"
              role="tab"
              :aria-selected="loginTab === 'email'"
              :class="{ active: loginTab === 'email' }"
              @click="setLoginTab('email')"
            >
              邮箱登录
            </button>
          </div>

          <!-- 扫码登录 -->
          <div v-if="loginTab === 'qr'" class="login-qr-content">
            <div v-if="qrStatus === 'loading'" class="qr-loading"><div class="spinner" /><span>正在生成...</span></div>
            <div v-else class="qr-show">
              <img v-if="qrCodeImg" :src="qrCodeImg" alt="二维码" class="qr-img" />
              <button v-if="qrStatus === 'expired'" type="button" class="qr-expired" @click="startNeLogin">
                <Icon name="repeat" :size="20" /><span>点击刷新</span>
              </button>
              <button v-else-if="qrStatus === 'idle'" type="button" class="qr-retry" @click="startNeLogin">
                重新生成二维码
              </button>
            </div>
            <p class="qr-msg">{{ qrMessage }}</p>
            <p class="login-method-tip">推荐使用扫码登录，无需在客户端输入账号密码</p>
          </div>

          <!-- 手机登录 -->
          <form v-if="loginTab === 'phone'" class="login-form" @submit.prevent="doPhoneLogin">
            <!-- 登录方式切换（验证码 / 密码） -->
            <div class="login-mode-switch">
              <button type="button" class="login-mode-btn" :class="{ active: phoneLoginMode === 'captcha' }" @click="phoneLoginMode = 'captcha'; clearError()">验证码登录</button>
              <button type="button" class="login-mode-btn" :class="{ active: phoneLoginMode === 'password' }" @click="phoneLoginMode = 'password'; clearError()">密码登录</button>
            </div>

            <!-- 手机号 + 国家码选择器 -->
            <div class="phone-row" :class="{ invalid: phoneForm.phone && !phoneValid }">
              <div class="country-select">
                <button type="button" class="country-btn" :title="selectedCountryName" @click="toggleCountryPicker">
                  <span class="country-btn-copy">
                    <strong>{{ countryCodeLabel }}</strong>
                    <small>{{ selectedCountryName }}</small>
                  </span>
                  <Icon name="chevronDown" :size="14" />
                </button>
                <!-- 点击空白关闭下拉 -->
                <div v-if="showCountryPicker" class="country-backdrop" @click="showCountryPicker = false" />
                <!-- 国家码下拉面板 -->
                <div v-if="showCountryPicker" class="country-panel" @click.stop>
                  <div class="country-search">
                    <Icon name="search" :size="14" />
                    <input v-model="countrySearch" placeholder="搜索国家、地区或区号" autocomplete="off" />
                  </div>
                  <div class="country-list nice-scroll">
                    <div v-if="countryLoading" class="country-loading">加载中...</div>
                    <template v-else v-for="group in filteredCountryGroups" :key="group.label">
                      <div class="country-group-label">{{ group.label }}</div>
                      <button
                        v-for="c in group.countryList" :key="c.locale + c.code"
                        type="button" class="country-item"
                        :class="{ active: c.code === phoneForm.countrycode }"
                        @click="selectCountry(c.code, c.zh)"
                      >
                        <span class="country-name">{{ c.zh }}</span>
                        <span class="country-code">+{{ c.code }}</span>
                      </button>
                    </template>
                    <div v-if="!countryLoading && !filteredCountryGroups.length" class="country-empty">无匹配结果</div>
                  </div>
                  <div class="country-manual">
                    <span>列表中没有？</span>
                    <label class="country-manual-input">
                      <span>+</span>
                      <input
                        v-model="manualCountryCode"
                        inputmode="numeric"
                        maxlength="4"
                        placeholder="国家码"
                        autocomplete="off"
                        @keydown.enter.prevent="applyManualCountryCode"
                      />
                    </label>
                    <button type="button" :disabled="!manualCountryCode.trim()" @click="applyManualCountryCode">使用</button>
                  </div>
                </div>
              </div>
              <input
                v-model="phoneForm.phone"
                class="phone-input"
                placeholder="请输入手机号"
                type="tel"
                inputmode="numeric"
                maxlength="18"
                autocomplete="tel-national"
                @input="onPhoneInput"
              />
            </div>
            <p v-if="phoneForm.phone && !phoneValid" class="field-hint">{{ phoneValidationMessage }}</p>

            <!-- 验证码登录 -->
            <div v-if="phoneLoginMode === 'captcha'" class="captcha-row">
              <input
                v-model="phoneForm.captcha"
                class="login-input captcha-input"
                placeholder="短信验证码"
                type="text"
                inputmode="numeric"
                maxlength="6"
                autocomplete="one-time-code"
                @input="onCaptchaInput"
              />
              <button type="button" class="captcha-btn" :disabled="!canSendCaptcha" @click="doSendCaptcha">
                {{ captchaSending ? "发送中..." : captchaCountdown > 0 ? `${captchaCountdown}s 后重试` : "获取验证码" }}
              </button>
            </div>
            <p v-if="captchaSentFlag && phoneLoginMode === 'captcha'" class="field-success">
              验证码已发送，请在 {{ captchaCountdown || 60 }} 秒内完成登录
            </p>

            <!-- 密码登录 -->
            <div v-if="phoneLoginMode === 'password'" class="password-row">
              <input
                v-model="phoneForm.password"
                class="login-input"
                placeholder="请输入密码"
                :type="showPhonePassword ? 'text' : 'password'"
                maxlength="128"
                autocomplete="current-password"
                @input="clearError"
              />
              <button type="button" class="pw-toggle" @click="showPhonePassword = !showPhonePassword" :title="showPhonePassword ? '隐藏密码' : '显示密码'">
                <Icon :name="showPhonePassword ? 'eyeOff' : 'eye'" :size="16" />
              </button>
            </div>

            <button type="submit" class="login-submit" :disabled="!canSubmitPhone">
              <span v-if="loginLoading" class="btn-spinner" /><span>{{ loginLoading ? "登录中..." : "登录" }}</span>
            </button>
            <p class="login-method-tip">可直接粘贴含 “+国家码” 的完整手机号，客户端会自动识别</p>
          </form>

          <!-- 邮箱登录 -->
          <form v-if="loginTab === 'email'" class="login-form" @submit.prevent="doEmailLogin">
            <div class="input-with-icon" :class="{ invalid: emailForm.email && !emailValid }">
              <Icon name="mail" :size="16" class="input-lead-icon" />
              <input
                v-model="emailForm.email"
                class="login-input has-lead"
                placeholder="请输入网易邮箱"
                type="email"
                maxlength="254"
                autocomplete="username"
                @input="clearError"
                @blur="onEmailBlur"
              />
            </div>
            <p v-if="emailForm.email && !emailValid" class="field-hint">{{ emailValidationMessage }}</p>
            <div class="password-row">
              <input
                v-model="emailForm.password"
                class="login-input"
                placeholder="请输入密码"
                :type="showEmailPassword ? 'text' : 'password'"
                maxlength="128"
                autocomplete="current-password"
                @input="clearError"
              />
              <button type="button" class="pw-toggle" @click="showEmailPassword = !showEmailPassword" :title="showEmailPassword ? '隐藏密码' : '显示密码'">
                <Icon :name="showEmailPassword ? 'eyeOff' : 'eye'" :size="16" />
              </button>
            </div>
            <button type="submit" class="login-submit" :disabled="!canSubmitEmail">
              <span v-if="loginLoading" class="btn-spinner" /><span>{{ loginLoading ? "登录中..." : "登录" }}</span>
            </button>
            <p class="login-method-tip">仅支持 163、126 与 yeah.net 网易邮箱，其他邮箱无法用于此接口</p>
          </form>

          <!-- 错误提示 -->
          <Transition name="login-err">
            <p v-if="loginError" class="login-error" role="alert" aria-live="polite">
              <Icon name="info" :size="14" /><span>{{ loginError }}</span>
            </p>
          </Transition>
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
/* 壁纸场景：PlayerBar 半透明玻璃效果 */
.app-shell.has-wallpaper :deep(.player-bar) {
  background: rgba(33, 31, 38, 0.55) !important;
  backdrop-filter: blur(20px) saturate(1.6) !important;
  -webkit-backdrop-filter: blur(20px) saturate(1.6) !important;
  border-top-color: rgba(255, 255, 255, 0.10) !important;
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
  background: rgba(40, 38, 46, 0.1);
  backdrop-filter: blur(2px) saturate(1);
  -webkit-backdrop-filter: blur(2px) saturate(1);
  border-color: rgba(255, 255, 255, 0.12);
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
  min-width: 260px;
  border: 1px solid var(--border-strong); border-radius: 12px;
  padding: 14px;
  text-align: left; display: flex; flex-direction: column; gap: 10px;
  backdrop-filter: blur(5px) saturate(1);  background: rgba(30, 30, 30, 0.55)
}
.qr-gen-btn { padding: 10px 20px; border-radius: 8px; background: var(--accent); color: #fff; font-size: 13px; }
.qr-gen-btn:hover { opacity: 0.9; }
.qr-loading { display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 12px; }
.spinner { width: 24px; height: 24px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
.qr-show { position: relative; display: flex; justify-content: center; }
.qr-img { width: 160px; height: 160px; border-radius: 8px; background: #fff; padding: 6px; }
.qr-expired { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.7); border-radius: 8px; color: #fff; font-size: 12px; cursor: pointer; }
.qr-msg { font-size: 11px; color: var(--text-tertiary); margin: 8px 0 0; }
/* Header: 头像 + 昵称 + VIP 徽章 + 个性签名 */
.ne-card-header { display: flex; align-items: flex-start; gap: 10px; }
.ne-avatar-lg { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.ne-header-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.ne-header-name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ne-logged-name { font-size: 14px; color: var(--text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ne-signature { margin: 0; font-size: 11px; color: var(--text-tertiary); font-style: italic; line-height: 1.4; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; }
.ne-vip-expire-line { margin: 0; font-size: 10px; color: var(--text-tertiary); opacity: 0.85; }
/* VIP 标识 */
/* VIP 图标（动画图/常规图） */
.ne-vip-icon {width: 70px; max-width: 90px; object-fit: contain; flex-shrink: 0; border-radius: 3px; }
.ne-vip-icon.is-dynamic { height: 26px; }
/* 个人资料: 注册时间 / 性别 / 所在地 */
.ne-profile-grid { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px;  }
.ne-profile-item { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 11px; }
.ne-profile-icon { display: inline-flex; align-items: center; color: var(--text-tertiary); opacity: 0.8; flex-shrink: 0; }
.ne-profile-icon :deep(svg) { display: block; }
.ne-profile-label { color: var(--text-tertiary); flex-shrink: 0; }
.ne-profile-value { color: var(--text-secondary); margin-left: auto; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
/* 总听歌时长 */
.ne-listen-total { display: flex; align-items: center; justify-content: center; gap: 5px; font-size: 11px; color: var(--text-tertiary); }
.ne-listen-total :deep(.icon-svg) { opacity: 0.7; }
.ne-logout-btn { padding: 6px 16px; border-radius: var(--radius-full); font-size: 12px; color: var(--text-tertiary); border: 1px solid var(--border); transition: all 0.15s; align-self: center; }
.ne-logout-btn:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
/* 用户等级 */
.ne-level-info { width: 100%; padding: 10px 12px;  background: rgba(30, 30, 30, 0.1); }
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
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.login-modal {
  position: relative;
  width: 430px; max-width: 100%;
  background: linear-gradient(155deg, var(--bg-elev-3), var(--bg-elev-2));
  border: 1px solid var(--border-strong);
  border-radius: 20px; box-shadow: 0 28px 80px rgba(0,0,0,0.58);
  padding: 28px 30px 24px; display: flex; flex-direction: column; align-items: center;
}
.login-modal::before {
  content: ""; position: absolute; top: 0; left: 54px; right: 54px; height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  opacity: 0.85;
}
.login-modal-close {
  position: absolute; top: 12px; right: 12px;
  width: 32px; height: 32px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); transition: all 0.15s; z-index: 2;
}
.login-modal-close:hover { color: var(--text); background: var(--bg-hover); }
/* 头部品牌 */
.login-modal-head { display: flex; flex-direction: column; align-items: center; gap: 6px; margin-bottom: 18px; }
.login-logo { width: 44px; height: 44px; border-radius: 12px; box-shadow: 0 6px 18px rgba(0,0,0,0.3); }
.login-modal-title { margin: 4px 0 0; font-size: 18px; font-weight: 700; }
.login-modal-sub { margin: 0; font-size: 12px; color: var(--text-tertiary); text-align: center; }
.login-tabs { display: flex; gap: 4px; width: 100%; margin-bottom: 18px; background: var(--bg-elev-1); padding: 3px; border-radius: 10px; }
.login-tab {
  flex: 1; padding: 8px 10px; border-radius: 8px; font-size: 13px; font-weight: 500;
  color: var(--text-secondary); transition: all 0.15s;
}
.login-tab:hover { color: var(--text); }
.login-tab.active { background: var(--accent); color: #fff; box-shadow: 0 2px 8px var(--accent-soft); }
/* 扫码 */
.login-qr-content { display: flex; flex-direction: column; align-items: center; gap: 8px; min-height: 200px; justify-content: center; }
.qr-expired { flex-direction: column; gap: 6px; }
.qr-retry {
  min-width: 160px; height: 44px; padding: 0 16px; border-radius: 10px;
  color: #fff; background: var(--accent); font-size: 12px; font-weight: 600;
}
/* 表单 */
.login-form { display: flex; flex-direction: column; gap: 12px; width: 100%; }
/* 登录方式切换 */
.login-mode-switch { display: flex; gap: 16px; padding: 0 2px 2px; }
.login-mode-btn {
  font-size: 13px; color: var(--text-tertiary); position: relative; padding-bottom: 4px;
  transition: color 0.15s;
}
.login-mode-btn:hover { color: var(--text-secondary); }
.login-mode-btn.active { color: var(--accent); font-weight: 600; }
.login-mode-btn.active::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px;
  border-radius: 2px; background: var(--accent);
}
.login-input {
  width: 100%; height: 42px; padding: 0 12px; border-radius: 10px;
  background: var(--bg-elev-1); border: 1px solid var(--border);
  color: var(--text); font-size: 13px; transition: border-color 0.15s, background 0.15s;
}
.login-input:focus { outline: none; border-color: var(--accent); background: var(--bg-elev-2); }
.login-input::placeholder { color: var(--text-tertiary); }
/* 手机号行：国家码 + 号码 */
.phone-row {
  display: flex; align-items: stretch; min-height: 48px;
  border-radius: 10px; background: var(--bg-elev-1); border: 1px solid var(--border);
  transition: border-color 0.15s;
}
.phone-row:focus-within { border-color: var(--accent); background: var(--bg-elev-2); }
.phone-row.invalid { border-color: #ff4d4f; }
.phone-input {
  flex: 1; min-width: 0; padding: 0 12px; background: transparent;
  color: var(--text); font-size: 13px; border: none; border-radius: 0 10px 10px 0;
}
.phone-input:focus { outline: none; }
.phone-input::placeholder { color: var(--text-tertiary); }
/* 国家码选择器 */
.country-select { position: relative; flex-shrink: 0; }
.country-btn {
  display: flex; align-items: center; gap: 5px; height: 100%; min-width: 102px; padding: 0 8px 0 12px;
  color: var(--text-secondary); font-size: 13px; border-right: 1px solid var(--border);
}
.country-btn:hover { color: var(--text); }
.country-btn-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; align-items: flex-start; line-height: 1.15; }
.country-btn-copy strong { font-size: 13px; font-weight: 650; color: var(--text); }
.country-btn-copy small { max-width: 70px; overflow: hidden; color: var(--text-tertiary); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.country-backdrop { position: fixed; inset: 0; z-index: 10; }
.country-panel {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 11;
  width: 290px; max-height: min(380px, 60vh); display: flex; flex-direction: column;
  background: var(--bg-elev-3); border: 1px solid var(--border-strong);
  border-radius: 12px; box-shadow: 0 16px 40px rgba(0,0,0,0.45); overflow: hidden;
}
.country-search {
  display: flex; align-items: center; gap: 6px; padding: 8px 10px;
  border-bottom: 1px solid var(--border); color: var(--text-tertiary); flex-shrink: 0;
}
.country-search input {
  flex: 1; min-width: 0; background: transparent; border: none; color: var(--text); font-size: 12px;
}
.country-search input:focus { outline: none; }
.country-list { min-height: 90px; overflow-y: auto; padding: 4px; }
.country-group-label {
  font-size: 10px; font-weight: 600; color: var(--text-tertiary);
  padding: 6px 8px 2px; letter-spacing: 0.5px;
}
.country-item {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; padding: 8px 10px; border-radius: 6px; font-size: 12px;
  color: var(--text-secondary); transition: background 0.12s;
}
.country-item:hover { background: var(--bg-hover); }
.country-item.active { background: var(--accent-soft); color: var(--accent); }
.country-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.country-code { color: var(--text-tertiary); flex-shrink: 0; margin-left: 8px; }
.country-item.active .country-code { color: var(--accent); }
.country-loading, .country-empty { padding: 18px; text-align: center; font-size: 12px; color: var(--text-tertiary); }
.country-manual {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 7px;
  padding: 9px 10px; border-top: 1px solid var(--border); color: var(--text-tertiary); font-size: 10px;
}
.country-manual-input {
  display: flex; align-items: center; gap: 2px; min-width: 0; height: 28px; padding: 0 7px;
  border: 1px solid var(--border); border-radius: 7px; background: var(--bg-elev-1);
}
.country-manual-input input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font-size: 11px; }
.country-manual > button { height: 28px; padding: 0 9px; border-radius: 7px; background: var(--accent); color: #fff; font-size: 10px; }
.country-manual > button:disabled { opacity: 0.4; cursor: not-allowed; }
/* 验证码行 */
.captcha-row { display: flex; gap: 8px; }
.captcha-input { flex: 1; }
.captcha-btn {
  padding: 0 14px; border-radius: 10px; font-size: 12px; min-width: 96px;
  background: var(--bg-elev-1); border: 1px solid var(--border);
  color: var(--text-secondary); transition: all 0.15s; white-space: nowrap;
}
.captcha-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
.captcha-btn:disabled { opacity: 0.45; cursor: not-allowed; }
/* 密码行（带显隐切换） */
.password-row { position: relative; display: flex; }
.password-row .login-input { padding-right: 42px; }
.pw-toggle {
  position: absolute; right: 4px; top: 0; bottom: 0; width: 36px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); transition: color 0.15s;
}
.pw-toggle:hover { color: var(--text); }
/* 带前置图标的输入 */
.input-with-icon { position: relative; display: flex; }
.input-lead-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); pointer-events: none; }
.login-input.has-lead { padding-left: 38px; }
.input-with-icon.invalid .login-input { border-color: #ff4d4f; }
.field-hint { margin: -6px 0 0 2px; font-size: 11px; color: #ff4d4f; }
.field-success { margin: -6px 0 0 2px; font-size: 11px; color: #32b16c; }
.login-method-tip { margin: -2px 0 0; color: var(--text-tertiary); font-size: 10px; line-height: 1.5; text-align: center; }
/* 提交按钮 */
.login-submit {
  margin-top: 4px; height: 44px; border-radius: 12px;
  background: var(--accent); color: #fff; font-size: 14px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: all 0.15s;
}
.login-submit:hover:not(:disabled) { opacity: 0.92; transform: translateY(-1px); }
.login-submit:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-spinner { width: 15px; height: 15px; border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; }
.login-error {
  display: flex; align-items: center; gap: 6px; justify-content: center;
  margin: 14px 0 0; padding: 8px 12px; width: 100%; box-sizing: border-box;
  font-size: 12px; color: #ff4d4f; text-align: center;
  background: rgba(255, 77, 79, 0.08); border-radius: 8px;
}
.login-err-enter-active, .login-err-leave-active { transition: opacity 0.2s, transform 0.2s; }
.login-err-enter-from, .login-err-leave-to { opacity: 0; transform: translateY(-4px); }
/* 弹窗动画 */
.login-modal-enter-active, .login-modal-leave-active { transition: opacity 0.2s; }
.login-modal-enter-from, .login-modal-leave-to { opacity: 0; }
.login-modal-enter-active .login-modal, .login-modal-leave-active .login-modal {
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.login-modal-enter-from .login-modal, .login-modal-leave-to .login-modal {
  transform: scale(0.92);
}
@media (max-width: 520px) {
  .login-modal-overlay { padding: 10px; }
  .login-modal { padding: 24px 18px 20px; }
  .country-panel { width: min(290px, calc(100vw - 56px)); }
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
  transition: transform 0.32s var(--ease-out);
}
/* Enter: 从底部向上滑入（从音乐栏方向滑入），不用 opacity 避免透出底层 */
.np-fade-enter-from {
  transform: translateY(100%);
}
/* Leave: 向下滑出（回到音乐栏方向） */
.np-fade-leave-to {
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
  background: rgba(255, 255, 255, 0.1) !important;
  backdrop-filter: blur(5px) saturate(1);
}
body.has-wallpaper .ne-user-btn:hover {
  background: rgba(0, 0, 0, 0.2) !important;
}
body.has-wallpaper .ne-login-btn:hover {
  background: rgba(0, 0, 0, 0.2) !important;
}
</style>
