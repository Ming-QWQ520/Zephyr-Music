<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { usePlayerStore } from "@/stores/player";
import { useAudioBinding } from "@/composables/useAudioBinding";
import { log } from "@/composables/logger";
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
import ToastContainer from "@/components/ToastContainer.vue";
import Icon from "@/components/Icon.vue";
import { getCookie, getCachedUser, logout, setCookie, qrKey, qrCreate, qrCheck, _cachedUser, listenDataTotal, vipInfo, userLevel, loginCellphone, loginEmail, captchaSent } from "@/api/netease";

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

// VIP 信息和总听歌时长
const neVipInfo = ref<{ isVip: boolean; redVipLevel: number; expireText: string } | null>(null);
const neListenTotal = ref<string>("");
const neUserLevel = ref<{ level: number; nowLoginCount: number; nextLoginCount: number; nowPlayCount: number; nextPlayCount: number; progress: number; needLogin: number; needPlay: number } | null>(null);

// 登录弹窗
const showLoginModal = ref(false);
const loginTab = ref<"qr" | "phone" | "email">("qr");
const loginLoading = ref(false);
const loginError = ref("");
// 手机登录表单
const phoneForm = ref({ phone: "", password: "", captcha: "", countrycode: "" });
const captchaSentFlag = ref(false);
// 邮箱登录表单
const emailForm = ref({ email: "", password: "" });

/** 格式化总听歌时长（秒 → x小时y分钟） */
function formatListenTime(seconds: number): string {
  if (!seconds || seconds <= 0) return "0分钟";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}小时${m}分钟`;
  return `${m}分钟`;
}

/** 加载 VIP 信息、总听歌时长和用户等级 */
async function loadVipAndListenData() {
  const user = _cachedUser.value;
  if (!user) return;
  // 并行获取 VIP 信息、总听歌时长和用户等级
  const [vipRes, listenRes, levelRes] = await Promise.allSettled([
    vipInfo(user.userId),
    listenDataTotal(),
    userLevel(),
  ]);
  try {
    if (vipRes.status === "fulfilled") {
      const d = vipRes.value.data || vipRes.value as any;
      if (d) {
        const isVip = d.isVip ?? (d.associator?.vipLevel ?? 0) > 0;
        const level = d.redVipLevel || 0;
        const expire = d.associator?.expireTime || d.musicPackage?.expireTime;
        const expireText = expire ? new Date(expire).toLocaleDateString("zh-CN") : "";
        neVipInfo.value = { isVip, redVipLevel: level, expireText };
        log.info("app", "VIP info loaded", { isVip, level, expireText });
      }
    }
  } catch (e) { log.warn("app", "load vip failed", { error: String(e) }); }
  if (listenRes.status === "fulfilled") {
    const time = listenRes.value.data?.totalDuration || listenRes.value.totalDuration || listenRes.value.data?.time || listenRes.value.time || 0;
    neListenTotal.value = formatListenTime(time);
    log.info("app", "listen total loaded", { time, formatted: neListenTotal.value });
  }
  if (levelRes.status === "fulfilled") {
    // apiGet 可能已解包 data，也可能没有
    const d = levelRes.value.data || levelRes.value as any;
    if (d && d.level != null) {
      const progress = Math.round((d.progress || 0) * 100);
      neUserLevel.value = {
        level: d.level,
        nowLoginCount: d.nowLoginCount || 0,
        nextLoginCount: d.nextLoginCount || 0,
        nowPlayCount: d.nowPlayCount || 0,
        nextPlayCount: d.nextPlayCount || 0,
        progress,
        needLogin: Math.max(0, (d.nextLoginCount || 0) - (d.nowLoginCount || 0)),
        needPlay: Math.max(0, (d.nextPlayCount || 0) - (d.nowPlayCount || 0)),
      };
      log.info("app", "user level loaded", { level: d.level, progress, needLogin: neUserLevel.value.needLogin, needPlay: neUserLevel.value.needPlay });
    }
  }
}

async function checkNeLogin() {
  if (!getCookie()) return;
  const user = await getCachedUser();
  if (user) {
    neLoggedIn.value = true;
    neUser.value = { nickname: user.nickname, avatarUrl: user.avatarUrl };
    // 登录后加载 VIP 信息和总听歌时长
    loadVipAndListenData();
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
  neVipInfo.value = null; neListenTotal.value = ""; neUserLevel.value = null;
  showLoginDropdown.value = false;
  qrStatus.value = "idle"; qrCodeImg.value = "";
}

/** 关闭用户下拉框（点击外部时调用） */
function closeDropdown() { showLoginDropdown.value = false; }

/** 打开登录弹窗 */
function openLoginModal() {
  showLoginModal.value = true;
  loginError.value = "";
  if (qrStatus.value === "idle") startNeLogin();
}

/** 关闭登录弹窗 */
function closeLoginModal() {
  showLoginModal.value = false;
  stopNeQrCheck();
  loginError.value = "";
}

/** 手机登录 */
async function doPhoneLogin() {
  if (!phoneForm.value.phone) { loginError.value = "请输入手机号"; return; }
  if (!phoneForm.value.password && !phoneForm.value.captcha) { loginError.value = "请输入密码或验证码"; return; }
  loginLoading.value = true;
  loginError.value = "";
  try {
    const res = await loginCellphone({
      phone: phoneForm.value.phone,
      password: phoneForm.value.captcha ? undefined : phoneForm.value.password,
      countrycode: phoneForm.value.countrycode || undefined,
      captcha: phoneForm.value.captcha || undefined,
    });
    if (res.code === 200 && res.cookie) {
      setCookie(res.cookie);
      await checkNeLogin();
      closeLoginModal();
    } else {
      loginError.value = `登录失败 (code: ${res.code})`;
    }
  } catch (e) {
    loginError.value = String(e instanceof Error ? e.message : e);
  } finally {
    loginLoading.value = false;
  }
}

/** 发送手机验证码 */
async function doSendCaptcha() {
  if (!phoneForm.value.phone) { loginError.value = "请输入手机号"; return; }
  try {
    await captchaSent(phoneForm.value.phone, phoneForm.value.countrycode || undefined);
    captchaSentFlag.value = true;
    loginError.value = "验证码已发送";
  } catch (e) {
    loginError.value = String(e instanceof Error ? e.message : e);
  }
}

/** 邮箱登录 */
async function doEmailLogin() {
  if (!emailForm.value.email) { loginError.value = "请输入邮箱"; return; }
  if (!emailForm.value.password) { loginError.value = "请输入密码"; return; }
  loginLoading.value = true;
  loginError.value = "";
  try {
    const res = await loginEmail(emailForm.value.email, emailForm.value.password);
    if (res.code === 200 && res.cookie) {
      setCookie(res.cookie);
      await checkNeLogin();
      closeLoginModal();
    } else {
      loginError.value = `登录失败 (code: ${res.code})`;
    }
  } catch (e) {
    loginError.value = String(e instanceof Error ? e.message : e);
  } finally {
    loginLoading.value = false;
  }
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
    <header class="titlebar" data-tauri-drag-region>
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
        <button class="icon-btn" title="设置" @click="showSettings = true">
          <img src="/icons/settings.svg" alt="settings" class="settings-icon" />
        </button>
        <div class="win-ctrls">
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

    <!-- Settings (modal/fullscreen on home page) -->
    <SettingsPanel :visible="showSettings" mode="modal" @close="showSettings = false" />

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
