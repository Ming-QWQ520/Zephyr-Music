<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { usePlayerStore } from "@/stores/player";
import {
  qrKey, qrCreate, qrCheck, loginStatus, userAccount,
  userPlaylist, playlistTrackAll, recommendSongs, logout,
  neteaseSongToSong, getCookie, setCookie,
  type NeteasePlaylist,
} from "@/api/netease";
import type { Song } from "@/types";
import Icon from "@/components/Icon.vue";
import { formatTime } from "@/composables/utils";

const store = usePlayerStore();

// ===== 登录状态 =====
const loggedIn = ref(false);
const userProfile = ref<{ userId: number; nickname: string; avatarUrl: string } | null>(null);

// 二维码登录
const qrCodeImg = ref("");
const qrStatus = ref<"idle" | "loading" | "waiting" | "scanned" | "expired" | "success">("idle");
const qrMessage = ref("");
let qrCheckTimer: ReturnType<typeof setInterval> | null = null;
let qrKeyVal = "";

async function checkLoginStatus() {
  try {
    const res = await loginStatus();
    if (res.profile) {
      loggedIn.value = true;
      userProfile.value = {
        userId: res.profile.userId || (res.account?.id as number),
        nickname: res.profile.nickname || "网易云用户",
        avatarUrl: res.profile.avatarUrl || "",
      };
      await loadPlaylists();
    } else {
      loggedIn.value = false;
      userProfile.value = null;
    }
  } catch { loggedIn.value = false; }
}

async function startQrLogin() {
  qrStatus.value = "loading";
  qrMessage.value = "正在生成二维码...";
  qrCodeImg.value = "";
  try {
    const keyRes = await qrKey();
    if (!keyRes.unikey) { qrMessage.value = "生成二维码 key 失败"; qrStatus.value = "idle"; return; }
    qrKeyVal = keyRes.unikey;
    const createRes = await qrCreate(qrKeyVal);
    if (!createRes.qrimg) { qrMessage.value = "生成二维码失败"; qrStatus.value = "idle"; return; }
    qrCodeImg.value = createRes.qrimg;
    qrStatus.value = "waiting";
    qrMessage.value = "请用网易云音乐 App 扫码登录";
    startQrCheck();
  } catch (e) { qrMessage.value = "二维码生成出错: " + String(e); qrStatus.value = "idle"; }
}

function startQrCheck() {
  stopQrCheck();
  qrCheckTimer = setInterval(async () => {
    try {
      const res = await qrCheck(qrKeyVal);
      if (res.code === 800) { qrStatus.value = "expired"; qrMessage.value = "二维码已过期"; stopQrCheck(); }
      else if (res.code === 802) { qrStatus.value = "scanned"; qrMessage.value = "已扫码，请确认"; }
      else if (res.code === 803) {
        qrStatus.value = "success"; qrMessage.value = "登录成功！";
        if (res.cookie) setCookie(res.cookie);
        stopQrCheck();
        await checkLoginStatus();
      }
    } catch { /* ignore */ }
  }, 2000);
}
function stopQrCheck() { if (qrCheckTimer) { clearInterval(qrCheckTimer); qrCheckTimer = null; } }

async function doLogout() {
  try { await logout(); } catch { /* ignore */ }
  loggedIn.value = false; userProfile.value = null;
  playlists.value = []; currentPlaylistSongs.value = []; selectedPlaylistId.value = null;
  qrStatus.value = "idle"; qrCodeImg.value = "";
}

// ===== 歌单 =====
const playlists = ref<NeteasePlaylist[]>([]);
const selectedPlaylistId = ref<number | null>(null);
const selectedPlaylistName = ref("");
const selectedPlaylistCover = ref("");
const currentPlaylistSongs = ref<Song[]>([]);
const loadingPlaylists = ref(false);
const loadingSongs = ref(false);

async function loadPlaylists() {
  if (!userProfile.value) return;
  loadingPlaylists.value = true;
  try { const res = await userPlaylist(userProfile.value.userId); playlists.value = res.playlist || []; }
  catch { playlists.value = []; }
  loadingPlaylists.value = false;
}

async function selectPlaylist(pl: NeteasePlaylist) {
  selectedPlaylistId.value = pl.id;
  selectedPlaylistName.value = pl.name;
  selectedPlaylistCover.value = pl.coverImgUrl || "";
  loadingSongs.value = true; currentPlaylistSongs.value = [];
  try { const res = await playlistTrackAll(pl.id); currentPlaylistSongs.value = (res.songs || []).map(neteaseSongToSong); }
  catch { currentPlaylistSongs.value = []; }
  loadingSongs.value = false;
}

async function loadDailyRecommend() {
  selectedPlaylistId.value = -1;
  selectedPlaylistName.value = "每日推荐";
  selectedPlaylistCover.value = "";
  loadingSongs.value = true; currentPlaylistSongs.value = [];
  try { const res = await recommendSongs(); currentPlaylistSongs.value = (res.data?.dailySongs || []).map(neteaseSongToSong); }
  catch { currentPlaylistSongs.value = []; }
  loadingSongs.value = false;
}

function playAll() {
  if (currentPlaylistSongs.value.length > 0) store.playList(currentPlaylistSongs.value, 0);
}

// ===== 右键菜单 =====
const contextMenu = ref<{ visible: boolean; x: number; y: number; song: Song | null }>({ visible: false, x: 0, y: 0, song: null });
function onContextMenu(e: MouseEvent, song: Song) { e.preventDefault(); contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, song }; }
function closeContextMenu() { contextMenu.value.visible = false; }
function ctxPlay() { if (contextMenu.value.song) store.playNow(contextMenu.value.song); closeContextMenu(); }
function ctxPlayNext() { if (contextMenu.value.song) store.playNextSong(contextMenu.value.song); closeContextMenu(); }
function ctxAddToQueue() { if (contextMenu.value.song) store.addToQueue(contextMenu.value.song); closeContextMenu(); }
function onDocClick() { closeContextMenu(); }

onMounted(async () => {
  document.addEventListener("click", onDocClick);
  if (getCookie()) await checkLoginStatus();
});
onUnmounted(() => { document.removeEventListener("click", onDocClick); stopQrCheck(); });
</script>

<template>
  <div class="netease-view">
    <!-- 未登录 -->
    <div v-if="!loggedIn" class="login-section">
      <div class="login-card">
        <h2>网易云音乐登录</h2>
        <p class="login-desc">登录后可同步你的歌单、每日推荐</p>
        <div class="qr-area">
          <div v-if="qrStatus === 'idle'" class="qr-placeholder">
            <button class="qr-start-btn" @click="startQrLogin">
              <Icon name="music" :size="32" />
              <span>生成登录二维码</span>
            </button>
          </div>
          <div v-else-if="qrStatus === 'loading'" class="qr-loading">
            <div class="spinner" /><span>正在生成...</span>
          </div>
          <div v-else class="qr-display">
            <img v-if="qrCodeImg" :src="qrCodeImg" alt="二维码" class="qr-img" />
            <div v-if="qrStatus === 'expired'" class="qr-expired-overlay">
              <button class="qr-refresh-btn" @click="startQrLogin">刷新</button>
            </div>
          </div>
        </div>
        <p class="qr-status" :class="qrStatus">{{ qrMessage }}</p>
        <p class="login-hint">请在 <code>netease.ts</code> 中配置 API_BASE</p>
      </div>
    </div>

    <!-- 已登录 -->
    <div v-else class="ne-content">
      <!-- 歌单列表视图 -->
      <div v-if="selectedPlaylistId === null" class="ne-playlists-view">
        <header class="ne-header">
          <div class="ne-user">
            <img v-if="userProfile?.avatarUrl" :src="userProfile.avatarUrl" class="user-avatar" referrerpolicy="no-referrer" />
            <div>
              <div class="user-name">{{ userProfile?.nickname }}</div>
              <button class="logout-btn" @click="doLogout">退出登录</button>
            </div>
          </div>
        </header>

        <div class="ne-cards">
          <button class="ne-card daily" @click="loadDailyRecommend">
            <Icon name="music" :size="28" />
            <span>每日推荐</span>
          </button>
          <button v-for="pl in playlists" :key="pl.id" class="ne-card" @click="selectPlaylist(pl)">
            <div class="ne-card-cover">
              <img v-if="pl.coverImgUrl" :src="pl.coverImgUrl" :alt="pl.name" referrerpolicy="no-referrer" />
              <Icon v-else name="music" :size="24" />
            </div>
            <div class="ne-card-name truncate">{{ pl.name }}</div>
            <div class="ne-card-count">{{ pl.trackCount }} 首</div>
          </button>
        </div>
      </div>

      <!-- 歌曲列表视图 -->
      <div v-else class="ne-songs-view">
        <!-- 歌单头部 -->
        <header class="pl-header">
          <button class="back-btn" @click="selectedPlaylistId = null">
            <Icon name="chevronLeft" :size="20" />
          </button>
          <div class="pl-header-cover">
            <img v-if="selectedPlaylistCover" :src="selectedPlaylistCover" alt="" referrerpolicy="no-referrer" />
            <Icon v-else name="music" :size="32" />
          </div>
          <div class="pl-header-info">
            <h2 class="pl-header-name">{{ selectedPlaylistName }}</h2>
            <div class="pl-header-meta">{{ currentPlaylistSongs.length }} 首</div>
          </div>
          <button class="play-all-btn" @click="playAll" :disabled="!currentPlaylistSongs.length">
            <Icon name="play" :size="14" />
            <span>播放全部</span>
          </button>
        </header>

        <!-- 歌曲表格 -->
        <div v-if="loadingSongs" class="loading-row">加载中...</div>
        <div v-else-if="currentPlaylistSongs.length === 0" class="empty-songs">
          <Icon name="music" :size="42" /><p>暂无歌曲</p>
        </div>
        <div v-else class="song-table nice-scroll">
          <div class="song-thead">
            <span class="col-idx">#</span>
            <span class="col-title">标题</span>
            <span class="col-artist">艺术家</span>
            <span class="col-dur">时长</span>
          </div>
          <div v-for="(song, idx) in currentPlaylistSongs" :key="song.id"
            class="song-trow" :class="{ active: song.id === store.currentSong?.id }"
            @dblclick="store.playList(currentPlaylistSongs, idx)"
            @contextmenu="onContextMenu($event, song)">
            <span class="col-idx">{{ idx + 1 }}</span>
            <span class="col-title truncate">
              <div class="song-cover" v-if="song.pic">
                <img :src="song.pic" alt="" referrerpolicy="no-referrer" />
              </div>
              <div class="song-cover-placeholder" v-else><Icon name="music" :size="10" /></div>
              <div class="song-title-text truncate">{{ song.name }}</div>
            </span>
            <span class="col-artist truncate">{{ song.artist }}</span>
            <span class="col-dur">{{ song.duration ? formatTime(song.duration) : '--:--' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 右键菜单 -->
    <Transition name="ctx-fade">
      <div v-if="contextMenu.visible && contextMenu.song"
        class="context-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @click.stop>
        <button class="ctx-item" @click="ctxPlay"><Icon name="play" :size="14" /><span>播放</span></button>
        <button class="ctx-item" @click="ctxPlayNext"><Icon name="next" :size="14" /><span>下一首播放</span></button>
        <button class="ctx-item" @click="ctxAddToQueue"><Icon name="plus" :size="14" /><span>加入队列</span></button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.netease-view { height: 100%; display: flex; flex-direction: column; }

/* ===== 登录页 ===== */
.login-section { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; }
.login-card { max-width: 360px; width: 100%; background: var(--bg-elev-2); border: 1px solid var(--border); border-radius: 16px; padding: 32px 28px; text-align: center; }
.login-card h2 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
.login-desc { margin: 0 0 24px; font-size: 13px; color: var(--text-secondary); }
.qr-area { min-height: 220px; display: flex; align-items: center; justify-content: center; margin-bottom: 16px; }
.qr-placeholder { width: 100%; }
.qr-start-btn { width: 100%; padding: 32px 16px; display: flex; flex-direction: column; align-items: center; gap: 12px; background: var(--bg-elev-3); border: 1px dashed var(--border-strong); border-radius: 12px; color: var(--text-secondary); transition: all 0.2s; }
.qr-start-btn:hover { color: var(--accent); border-color: var(--accent); }
.qr-loading { display: flex; flex-direction: column; align-items: center; gap: 12px; color: var(--text-secondary); }
.spinner { width: 28px; height: 28px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
.qr-display { position: relative; }
.qr-img { width: 180px; height: 180px; border-radius: 12px; background: #fff; padding: 8px; }
.qr-expired-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.7); border-radius: 12px; }
.qr-refresh-btn { padding: 8px 16px; background: var(--accent); color: #fff; border-radius: 8px; font-size: 13px; }
.qr-status { font-size: 13px; min-height: 20px; margin: 0 0 8px; color: var(--text-secondary); }
.qr-status.success { color: #06d6a0; }
.qr-status.expired { color: var(--accent); }
.login-hint { font-size: 11px; color: var(--text-tertiary); margin: 0; }
.login-hint code { background: var(--bg-elev-3); padding: 1px 4px; border-radius: 3px; }

/* ===== 已登录 ===== */
.ne-content { flex: 1; display: flex; flex-direction: column; min-height: 0; }

/* 歌单卡片视图 */
.ne-playlists-view { flex: 1; overflow-y: auto; padding: 24px; }
.ne-header { display: flex; align-items: center; margin-bottom: 24px; }
.ne-user { display: flex; align-items: center; gap: 12px; }
.user-avatar { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; }
.user-name { font-size: 18px; font-weight: 600; }
.logout-btn { font-size: 11px; color: var(--text-tertiary); background: none; padding: 0; margin-top: 2px; }
.logout-btn:hover { color: var(--accent); }
.ne-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; }
.ne-card { display: flex; flex-direction: column; gap: 8px; text-align: left; transition: transform 0.15s; }
.ne-card:hover { transform: translateY(-2px); }
.ne-card.daily { height: 120px; border-radius: 12px; background: linear-gradient(135deg, var(--accent), #c11a2e); color: #fff; align-items: center; justify-content: center; flex-direction: column; gap: 10px; font-size: 14px; font-weight: 600; }
.ne-card-cover { width: 100%; aspect-ratio: 1; border-radius: 10px; overflow: hidden; background: var(--bg-elev-3); display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); }
.ne-card-cover img { width: 100%; height: 100%; object-fit: cover; }
.ne-card-name { font-size: 13px; color: var(--text); }
.ne-card-count { font-size: 11px; color: var(--text-tertiary); }

/* 歌曲列表视图 */
.ne-songs-view { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.pl-header { display: flex; align-items: center; gap: 16px; padding: 20px 24px; border-bottom: 1px solid var(--border); }
.back-btn { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); transition: all 0.15s; }
.back-btn:hover { color: var(--text); background: var(--bg-hover); }
.pl-header-cover { width: 80px; height: 80px; border-radius: 10px; overflow: hidden; background: var(--bg-elev-3); display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); flex-shrink: 0; }
.pl-header-cover img { width: 100%; height: 100%; object-fit: cover; }
.pl-header-info { flex: 1; min-width: 0; }
.pl-header-name { margin: 0; font-size: 22px; font-weight: 700; }
.pl-header-meta { font-size: 12px; color: var(--text-tertiary); margin-top: 4px; }
.play-all-btn { display: flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 20px; background: var(--accent); color: #fff; font-size: 13px; font-weight: 500; transition: all 0.15s; }
.play-all-btn:hover { transform: scale(1.05); }
.play-all-btn:disabled { opacity: 0.4; pointer-events: none; }

.loading-row { padding: 24px; text-align: center; color: var(--text-tertiary); }
.empty-songs { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--text-tertiary); }
.song-table { flex: 1; overflow-y: auto; padding: 0 24px; }
.song-thead, .song-trow { display: grid; grid-template-columns: 40px 1fr 200px 60px; gap: 12px; padding: 8px 12px; align-items: center; }
.song-thead { position: sticky; top: 0; z-index: 1; background: var(--bg-elev-1); border-bottom: 1px solid var(--border); font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; }
.song-trow { font-size: 13px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.04); transition: background 0.1s; user-select: none; }
.song-trow:hover { background: var(--bg-hover); }
.song-trow.active { color: var(--accent); }
.song-trow.active .col-idx { color: var(--accent); }
.col-idx { color: var(--text-tertiary); text-align: center; font-variant-numeric: tabular-nums; }
.col-title { display: flex; align-items: center; gap: 10px; }
.song-cover, .song-cover-placeholder { width: 32px; height: 32px; border-radius: 5px; flex-shrink: 0; overflow: hidden; background: var(--bg-elev-3); display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); }
.song-cover img { width: 100%; height: 100%; object-fit: cover; }
.song-title-text { color: var(--text); }
.col-artist { color: var(--text-secondary); }
.col-dur { color: var(--text-tertiary); text-align: right; font-variant-numeric: tabular-nums; }

/* 右键菜单 */
.context-menu { position: fixed; z-index: 500; min-width: 160px; background: var(--bg-elev-3); border: 1px solid var(--border-strong); border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,0.4); padding: 4px; }
.ctx-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; border-radius: 6px; font-size: 13px; color: var(--text); text-align: left; transition: background 0.1s; }
.ctx-item:hover { background: var(--bg-hover); color: var(--accent); }
.ctx-fade-enter-active, .ctx-fade-leave-active { transition: opacity 0.12s, transform 0.12s; }
.ctx-fade-enter-from, .ctx-fade-leave-to { opacity: 0; transform: scale(0.95); }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
