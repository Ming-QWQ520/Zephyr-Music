<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { usePlayerStore } from "@/stores/player";
import {
  playlistTrackAll, recommendSongs, userRecord,
  getCachedUser, getCachedPlaylists,
  neteaseSongToSong, getCookie, _cachedUser,
  likeSong, playlistTracks, getCachedLikeList, addLikeCache, removeLikeCache,
  type NeteasePlaylist,
} from "@/api/netease";
import { log } from "@/composables/logger";
import type { Song } from "@/types";
import Icon from "@/components/Icon.vue";
import { formatTime } from "@/composables/utils";

const store = usePlayerStore();

const playlists = ref<NeteasePlaylist[]>([]);
const selectedPlaylistId = ref<number | null>(null);
const selectedPlaylistName = ref("");
const selectedPlaylistCover = ref("");
const currentPlaylistSongs = ref<Song[]>([]);
const loadingSongs = ref(false);
const loggedIn = ref(false);
/** 听歌排行类型：1=最近一周, 0=所有时间 */
const recordType = ref<0 | 1>(1);
/** 当前是否在听歌排行视图 */
const isRecordView = ref(false);
/** 听歌排行播放次数映射（songId → playCount） */
const playCountMap = ref<Map<string, number>>(new Map());

async function loadData() {
  if (!getCookie()) return;
  const user = await getCachedUser();
  if (!user) return;
  loggedIn.value = true;
  const pls = await getCachedPlaylists();
  playlists.value = pls;
  if (playlists.value.length > 0) await selectPlaylist(playlists.value[0]);
}

async function selectPlaylist(pl: NeteasePlaylist) {
  if (selectedPlaylistId.value === pl.id && currentPlaylistSongs.value.length > 0) return;
  isRecordView.value = false;
  playCountMap.value = new Map();
  selectedPlaylistId.value = pl.id;
  selectedPlaylistName.value = pl.name;
  selectedPlaylistCover.value = pl.coverImgUrl || "";
  loadingSongs.value = true;
  try {
    const res = await playlistTrackAll(pl.id);
    currentPlaylistSongs.value = (res.songs || []).map(neteaseSongToSong);
  } catch { currentPlaylistSongs.value = []; }
  loadingSongs.value = false;
}

async function loadDailyRecommend() {
  if (selectedPlaylistId.value === -1 && currentPlaylistSongs.value.length > 0) return;
  isRecordView.value = false;
  playCountMap.value = new Map();
  selectedPlaylistId.value = -1;
  selectedPlaylistName.value = "每日推荐";
  selectedPlaylistCover.value = "";
  loadingSongs.value = true;
  try {
    const res = await recommendSongs();
    currentPlaylistSongs.value = (res.data?.dailySongs || []).map(neteaseSongToSong);
  } catch { currentPlaylistSongs.value = []; }
  loadingSongs.value = false;
}

function playAll() {
  if (currentPlaylistSongs.value.length > 0) {
    playSong(0);
  }
}

/** 播放歌单中指定位置的歌曲（设置 sourceid 后播放） */
function playSong(idx: number) {
  if (currentPlaylistSongs.value.length === 0) return;
  // 设置听歌打卡的 sourceid（歌单 ID；每日推荐/播放记录等特殊 ID 不作为 sourceid）
  const sid = selectedPlaylistId.value;
  store.setSourcePlaylistId(sid && sid > 0 ? sid : null);
  store.playList(currentPlaylistSongs.value, idx);
}

/** 加载听歌排行（/user/record）
 *  type=1: weekData (最近一周), type=0: allData (所有时间)
 *  截取前 300 首，同时记录每首歌的播放次数用于显示
 */
async function loadRecord(type: 0 | 1 = 1) {
  // 如果已经在听歌排行视图且类型相同且已有数据，不重复加载
  if (isRecordView.value && recordType.value === type && currentPlaylistSongs.value.length > 0) return;
  log.info("netease-view", "loadRecord() start", { type });
  const user = await getCachedUser();
  if (!user) {
    log.warn("netease-view", "loadRecord: no user, abort");
    return;
  }
  log.info("netease-view", "loadRecord: got user", { uid: user.userId });
  recordType.value = type;
  isRecordView.value = true;
  selectedPlaylistId.value = -2;
  selectedPlaylistName.value = "听歌排行";
  selectedPlaylistCover.value = "";
  loadingSongs.value = true;
  playCountMap.value = new Map();
  try {
    const res = await userRecord(user.userId, type);
    log.info("netease-view", "loadRecord: API returned", {
      type,
      code: res.code,
      weekDataLen: res.weekData?.length || 0,
      allDataLen: res.allData?.length || 0,
      keys: typeof res === "object" && res ? Object.keys(res) : typeof res,
    });
    const records = (type === 1 ? (res.weekData || []) : (res.allData || [])).slice(0, 300);
    log.info("netease-view", "loadRecord: records sliced", { count: records.length });
    currentPlaylistSongs.value = records.map(r => {
      const song = neteaseSongToSong(r.song);
      if (r.playCount) playCountMap.value.set(song.id, r.playCount);
      return song;
    });
    log.info("netease-view", "loadRecord: songs mapped", { count: currentPlaylistSongs.value.length, playCountEntries: playCountMap.value.size });
  } catch (e) {
    log.warn("netease-view", "loadRecord error", { error: String(e) });
    currentPlaylistSongs.value = [];
  }
  loadingSongs.value = false;
}

/** 切换听歌排行的类型（最近一周/所有时间） */
function switchRecordType(type: 0 | 1) {
  if (recordType.value === type && currentPlaylistSongs.value.length > 0) return;
  loadRecord(type);
}

/** 获取歌曲的播放次数（听歌排行视图用） */
function getPlayCount(songId: string): number {
  return playCountMap.value.get(songId) || 0;
}

// 右键菜单
const contextMenu = ref<{ visible: boolean; x: number; y: number; song: Song | null }>({ visible: false, x: 0, y: 0, song: null });
const ctxSongLiked = ref(false);  // 当前右键歌曲是否已喜欢
const showPlaylistPicker = ref(false);  // 是否显示收藏到歌单子菜单
const showPlayNextSub = ref(false);  // 是否显示下一首播放子菜单
/** 当前右键的歌曲是否在歌单/喜欢音乐视图中（可删除） */
const ctxCanRemoveFromPlaylist = computed(() => {
  if (!contextMenu.value.song || contextMenu.value.song.source !== "netease") return false;
  const pid = selectedPlaylistId.value;
  // 每日推荐(-1)和听歌排行(-2)不可删除；歌单和喜欢音乐(>0)可删除
  return pid !== null && pid > 0;
});
function onContextMenu(e: MouseEvent, song: Song) {
  e.preventDefault();
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, song };
  showPlaylistPicker.value = false;
  showPlayNextSub.value = false;
  // 查询喜欢状态
  if (song.source === "netease" && song.neteaseId) {
    getCachedLikeList().then(set => { ctxSongLiked.value = set.has(song.neteaseId!); }).catch(() => {});
  } else {
    ctxSongLiked.value = false;
  }
}
function closeContextMenu() { contextMenu.value.visible = false; showPlaylistPicker.value = false; showPlayNextSub.value = false; }
function ctxPlay() { if (contextMenu.value.song) store.playNow(contextMenu.value.song); closeContextMenu(); }
function ctxPlayNext() { if (contextMenu.value.song) store.playNext(contextMenu.value.song); closeContextMenu(); }
function ctxPlayLast() { if (contextMenu.value.song) store.addToQueue(contextMenu.value.song); closeContextMenu(); }
function ctxAddToQueue() { if (contextMenu.value.song) store.addToQueue(contextMenu.value.song); closeContextMenu(); }

// 从当前歌单删除歌曲
async function ctxRemoveFromPlaylist() {
  const song = contextMenu.value.song;
  const pid = selectedPlaylistId.value;
  if (!song || song.source !== "netease" || !song.neteaseId || !pid || pid <= 0) return;
  try {
    await playlistTracks("del", pid, song.neteaseId);
    log.info("netease-view", "removed from playlist", { songId: song.neteaseId, playlistId: pid });
    // 从当前列表移除
    const idx = currentPlaylistSongs.value.findIndex(s => s.id === song.id);
    if (idx >= 0) currentPlaylistSongs.value.splice(idx, 1);
  } catch (e) {
    log.warn("netease-view", "remove from playlist failed", { error: String(e) });
  }
  closeContextMenu();
}

// 喜欢/取消喜欢
async function ctxToggleLike() {
  const song = contextMenu.value.song;
  if (!song || song.source !== "netease" || !song.neteaseId) return;
  try {
    const newLike = !ctxSongLiked.value;
    await likeSong(song.neteaseId, newLike);
    ctxSongLiked.value = newLike;
    if (newLike) addLikeCache(song.neteaseId);
    else removeLikeCache(song.neteaseId);
    log.info("netease-view", "ctx like toggled", { songId: song.neteaseId, liked: newLike });
  } catch (e) {
    log.warn("netease-view", "ctx like failed", { error: String(e) });
  }
  closeContextMenu();
}

// 收藏到歌单
function ctxShowPlaylistPicker() { showPlaylistPicker.value = true; }
async function ctxAddToPlaylist(pl: NeteasePlaylist) {
  const song = contextMenu.value.song;
  if (!song || song.source !== "netease" || !song.neteaseId) return;
  try {
    await playlistTracks("add", pl.id, song.neteaseId);
    log.info("netease-view", "added to playlist", { songId: song.neteaseId, playlistId: pl.id, playlistName: pl.name });
  } catch (e) {
    log.warn("netease-view", "add to playlist failed", { error: String(e) });
  }
  closeContextMenu();
}

// 添加到歌单对话框
const addToPlaylistDialog = ref<{ visible: boolean; song: Song | null; adding: boolean; addedPid: number | null }>({
  visible: false, song: null, adding: false, addedPid: null,
});
function openAddToPlaylistDialog(song: Song) {
  if (song.source !== "netease" || !song.neteaseId) return;
  addToPlaylistDialog.value = { visible: true, song, adding: false, addedPid: null };
}
function closeAddToPlaylistDialog() {
  addToPlaylistDialog.value.visible = false;
}
async function confirmAddToPlaylist(pl: NeteasePlaylist) {
  const song = addToPlaylistDialog.value.song;
  if (!song || !song.neteaseId || addToPlaylistDialog.value.adding) return;
  addToPlaylistDialog.value.adding = true;
  addToPlaylistDialog.value.addedPid = null;
  try {
    await playlistTracks("add", pl.id, song.neteaseId);
    addToPlaylistDialog.value.addedPid = pl.id;
    log.info("netease-view", "added to playlist (dialog)", { songId: song.neteaseId, playlistId: pl.id, playlistName: pl.name });
    // 1.2 秒后关闭对话框
    setTimeout(() => { closeAddToPlaylistDialog(); }, 1200);
  } catch (e) {
    log.warn("netease-view", "add to playlist failed (dialog)", { error: String(e) });
    addToPlaylistDialog.value.adding = false;
  }
}
function onDocClick() { closeContextMenu(); }

onMounted(() => { document.addEventListener("click", onDocClick); loadData(); });

// 监听用户登录状态变化，登录后及时获取歌单
watch(() => _cachedUser.value, (user) => {
  if (user && !loggedIn.value) {
    log.info("netease-view", "user logged in, reloading data");
    loadData();
  }
}, { immediate: true });

watch(() => store.pendingPlaylistId, (id) => {
  if (id !== null) {
    if (id === -1) { loadDailyRecommend(); }
    else if (id === -2) { loadRecord(recordType.value); }
    else if (playlists.value.length > 0) {
      const pl = playlists.value.find(p => p.id === id);
      if (pl) selectPlaylist(pl);
    }
    store.pendingPlaylistId = null;
  }
});

onUnmounted(() => { document.removeEventListener("click", onDocClick); });
</script>

<template>
  <div class="netease-view">
    <!-- 未登录 -->
    <div v-if="!loggedIn" class="ne-empty">
      <Icon name="music" :size="42" />
      <p>请点击标题栏「登录」按钮登录网易云音乐</p>
    </div>

    <!-- 已登录：只显示歌曲表格（歌单列表在侧边栏）-->
    <div v-else class="ne-songs">
      <header class="songs-header" :class="{ 'no-cover': isRecordView }">
        <div v-if="!isRecordView" class="songs-header-cover">
          <img v-if="selectedPlaylistCover" :src="selectedPlaylistCover" alt="" referrerpolicy="no-referrer" />
          <Icon v-else name="music" :size="32" />
        </div>
        <div class="songs-header-info">
          <h2>{{ selectedPlaylistName || '请选择歌单' }}</h2>
          <div class="songs-header-meta">
            <!-- 听歌排行：最近一周/所有时间 切换标签 -->
            <div v-if="isRecordView" class="record-tabs">
              <button class="record-tab" :class="{ active: recordType === 1 }" @click="switchRecordType(1)">最近一周</button>
              <span class="record-tab-sep">|</span>
              <button class="record-tab" :class="{ active: recordType === 0 }" @click="switchRecordType(0)">所有时间</button>
            </div>
            <span v-else class="songs-count">{{ currentPlaylistSongs.length }} 首</span>
          </div>
        </div>
        <button class="play-all-btn" @click="playAll" :disabled="!currentPlaylistSongs.length">
          <Icon name="play" :size="14" /><span>播放全部</span>
        </button>
      </header>

      <div class="songs-body nice-scroll">
        <div v-if="loadingSongs && !currentPlaylistSongs.length" class="songs-loading">加载中...</div>
        <div v-else-if="!currentPlaylistSongs.length" class="songs-empty">
          <Icon name="music" :size="42" /><p>选择左侧歌单查看歌曲</p>
        </div>
        <template v-else>
          <div class="song-thead" :class="{ 'record-thead': isRecordView }">
            <span class="col-idx">#</span><span class="col-title">标题</span>
            <span class="col-artist">艺术家</span>
            <span v-if="isRecordView" class="col-playcount">播放次数</span>
            <span v-else class="col-dur">时长</span>
          </div>
          <div v-for="(song, idx) in currentPlaylistSongs" :key="song.id"
            class="song-trow" :class="{ active: song.id === store.currentSong?.id, 'record-row': isRecordView }"
            @dblclick="playSong(idx)"
            @contextmenu="onContextMenu($event, song)">
            <span class="col-idx">{{ idx + 1 }}</span>
            <span class="col-title">
              <div class="song-cover" v-if="song.pic"><img :src="song.pic" alt="" referrerpolicy="no-referrer" /></div>
              <div class="song-cover-placeholder" v-else><Icon name="music" :size="10" /></div>
              <span class="song-title-text truncate">{{ song.name }}</span>
            </span>
            <span class="col-artist truncate">{{ song.artist }}</span>
            <span v-if="isRecordView" class="col-playcount">{{ getPlayCount(song.id) }} 次</span>
            <span v-else class="col-dur">
              {{ song.duration ? formatTime(song.duration) : '--:--' }}
              <!-- 添加到歌单图标（hover 显示，仅网易云歌曲） -->
              <button v-if="song.source === 'netease'" class="row-add-pl-btn" title="添加到歌单" @click.stop="openAddToPlaylistDialog(song)">
                <img src="/icons/add_playlist.svg" alt="add to playlist" class="row-add-pl-icon" />
              </button>
            </span>
          </div>
        </template>
      </div>
    </div>

    <!-- 右键菜单 -->
    <Transition name="ctx-fade">
      <div v-if="contextMenu.visible && contextMenu.song"
        class="context-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @click.stop>
        <button class="ctx-item" @click="ctxPlay"><Icon name="play" :size="14" /><span>播放</span></button>
        <!-- 下一首播放：hover 展开子菜单 -->
        <div class="ctx-item-wrapper" @mouseenter="showPlayNextSub = true" @mouseleave="showPlayNextSub = false">
          <button class="ctx-item" @click="ctxPlayNext">
            <Icon name="next" :size="14" /><span>下一首播放</span><Icon name="chevronRight" :size="12" class="ctx-arrow" />
          </button>
          <div v-if="showPlayNextSub" class="ctx-flyout" @click.stop>
            <button class="ctx-flyout-item" @click="ctxPlayNext">
              <Icon name="next" :size="14" /><span>下一首播放</span>
            </button>
            <button class="ctx-flyout-item" @click="ctxPlayLast">
              <Icon name="list" :size="14" /><span>最后一首播放</span>
            </button>
          </div>
        </div>
        <div class="ctx-divider" />
        <!-- 从此歌单删除（仅在歌单/喜欢音乐视图中显示） -->
        <button v-if="ctxCanRemoveFromPlaylist" class="ctx-item ctx-danger" @click="ctxRemoveFromPlaylist">
          <Icon name="trash" :size="14" /><span>从此歌单删除</span>
        </button>
        <!-- 喜欢按钮 -->
        <button v-if="contextMenu.song.source === 'netease'" class="ctx-item" @click="ctxToggleLike">
          <img v-if="ctxSongLiked" src="/icons/like.svg" alt="liked" class="ctx-like-icon" />
          <img v-else src="/icons/not_like.svg" alt="not liked" class="ctx-like-icon" />
          <span>{{ ctxSongLiked ? '取消喜欢' : '喜欢' }}</span>
        </button>
        <!-- 收藏到歌单 -->
        <button v-if="contextMenu.song.source === 'netease'" class="ctx-item" @click="ctxShowPlaylistPicker">
          <Icon name="folder" :size="14" /><span>添加到歌单</span><Icon name="chevronRight" :size="12" class="ctx-arrow" />
        </button>
        <!-- 歌单子菜单 -->
        <div v-if="showPlaylistPicker" class="ctx-submenu" @click.stop>
          <div class="ctx-submenu-title">选择歌单</div>
          <div class="ctx-submenu-list nice-scroll">
            <button v-for="pl in playlists.filter(p => p.creator?.nickname || p.id > 0)" :key="pl.id"
              class="ctx-submenu-item" @click="ctxAddToPlaylist(pl)">
              <div class="ctx-pl-cover">
                <img v-if="pl.coverImgUrl" :src="pl.coverImgUrl" :alt="pl.name" referrerpolicy="no-referrer" />
                <Icon v-else name="music" :size="12" />
              </div>
              <span class="truncate">{{ pl.name }}</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 添加到歌单对话框 -->
    <Transition name="pl-dialog-fade">
      <div v-if="addToPlaylistDialog.visible" class="pl-dialog-overlay" @click="closeAddToPlaylistDialog">
        <div class="pl-dialog" @click.stop>
          <div class="pl-dialog-header">
            <h3>添加到歌单</h3>
            <button class="pl-dialog-close" @click="closeAddToPlaylistDialog"><Icon name="close" :size="18" /></button>
          </div>
          <div class="pl-dialog-song truncate">「{{ addToPlaylistDialog.song?.name || '' }}」</div>
          <div class="pl-dialog-list nice-scroll">
            <button v-for="pl in playlists" :key="pl.id"
              class="pl-dialog-item" @click="confirmAddToPlaylist(pl)">
              <div class="pl-dialog-cover">
                <img v-if="pl.coverImgUrl" :src="pl.coverImgUrl" :alt="pl.name" referrerpolicy="no-referrer" />
                <Icon v-else name="music" :size="16" />
              </div>
              <div class="pl-dialog-info">
                <div class="pl-dialog-name truncate">{{ pl.name }}</div>
                <div class="pl-dialog-count">{{ pl.trackCount }} 首</div>
              </div>
              <Icon v-if="addToPlaylistDialog.addedPid === pl.id" name="check" :size="16" class="pl-dialog-added" />
            </button>
          </div>
          <div v-if="addToPlaylistDialog.adding" class="pl-dialog-loading">添加中...</div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.netease-view { height: 100%; display: flex; flex-direction: column; }
.ne-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--text-tertiary); }

.ne-songs { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.songs-header { display: flex; align-items: center; gap: 16px; padding: 20px 24px; border-bottom: 1px solid var(--border); }
.songs-header.no-cover { gap: 0; }
.songs-header-cover { width: 64px; height: 64px; border-radius: 10px; flex-shrink: 0; background: var(--bg-elev-3); overflow: hidden; display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); }
.songs-header-cover img { width: 100%; height: 100%; object-fit: cover; }
.songs-header-info { flex: 1; min-width: 0; }
.songs-header-info h2 { margin: 0; font-size: 20px; font-weight: 700; }
.songs-count { font-size: 12px; color: var(--text-tertiary); }
.songs-header-meta { margin-top: 2px; }
/* 听歌排行切换标签 */
.record-tabs { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.record-tab { color: var(--text-tertiary); font-size: 12px; transition: color 0.15s; padding: 2px 0; }
.record-tab:hover { color: var(--text-secondary); }
.record-tab.active { color: var(--accent); font-weight: 600; }
.record-tab-sep { color: var(--text-tertiary); opacity: 0.5; }
.play-all-btn { display: flex; align-items: center; gap: 6px; padding: 8px 18px; border-radius: 18px; background: var(--accent); color: #fff; font-size: 13px; font-weight: 500; transition: all 0.15s; }
.play-all-btn:hover { transform: scale(1.05); }
.play-all-btn:disabled { opacity: 0.4; pointer-events: none; }

.songs-body { flex: 1; overflow-y: auto; padding: 0 24px 24px; }
.songs-loading { padding: 24px; text-align: center; color: var(--text-tertiary); font-size: 13px; }
.songs-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--text-tertiary); padding: 48px; }
.song-thead, .song-trow { display: grid; grid-template-columns: 40px 1fr 180px 56px; gap: 12px; padding: 7px 12px; align-items: center; }
/* 听歌排行视图：用播放次数列替换时长列 */
.song-thead.record-thead, .song-trow.record-row { grid-template-columns: 40px 1fr 180px 80px; }
.song-thead { position: sticky; top: 0; z-index: 1; background: var(--bg-elev-1); border-bottom: 1px solid var(--border); font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; }
.song-trow { font-size: 13px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.03); transition: background 0.1s; user-select: none; }
.song-trow:hover { background: var(--bg-hover); }
.song-trow.active { color: var(--accent); }
.song-trow.active .col-idx { color: var(--accent); }
.col-idx { color: var(--text-tertiary); text-align: center; font-variant-numeric: tabular-nums; }
.col-title { display: flex; align-items: center; gap: 10px; }
.song-cover, .song-cover-placeholder { width: 30px; height: 30px; border-radius: 5px; flex-shrink: 0; overflow: hidden; background: var(--bg-elev-3); display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); }
.song-cover img { width: 100%; height: 100%; object-fit: cover; }
.song-title-text { color: var(--text); }
.col-artist { color: var(--text-secondary); }
.col-dur { color: var(--text-tertiary); text-align: right; font-variant-numeric: tabular-nums; }
.col-playcount { color: var(--text-tertiary); text-align: right; font-variant-numeric: tabular-nums; font-size: 12px; }

.context-menu { position: fixed; z-index: 500; min-width: 180px; background: var(--bg-elev-3); border: 1px solid var(--border-strong); border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,0.4); padding: 4px; }
.ctx-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; border-radius: 6px; font-size: 13px; color: var(--text); text-align: left; transition: background 0.1s; }
.ctx-item:hover { background: var(--bg-hover); color: var(--accent); }
.ctx-item .ctx-arrow { margin-left: auto; opacity: 0.5; }
.ctx-like-icon { width: 14px; height: 14px; flex-shrink: 0; }
.ctx-divider { height: 1px; background: var(--border); margin: 4px 8px; }
/* 下一首播放 hover 子菜单 */
.ctx-item-wrapper { position: relative; }
.ctx-flyout {
  position: absolute;
  left: 100%;
  top: 0;
  min-width: 150px;
  background: var(--bg-elev-3);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.4);
  padding: 4px;
  margin-left: 4px;
}
.ctx-flyout-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; border-radius: 6px; font-size: 13px; color: var(--text); text-align: left; transition: background 0.1s; }
.ctx-flyout-item:hover { background: var(--bg-hover); color: var(--accent); }
/* 危险操作（删除） */
.ctx-danger { color: var(--text-secondary); }
.ctx-danger:hover { color: #ff4d4f; background: rgba(255, 77, 79, 0.1); }
/* 歌单子菜单 */
.ctx-submenu { margin-top: 4px; border-top: 1px solid var(--border); padding-top: 4px; }
.ctx-submenu-title { padding: 4px 12px; font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; }
.ctx-submenu-list { max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; }
.ctx-submenu-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 12px; border-radius: 6px; font-size: 12px; color: var(--text-secondary); text-align: left; transition: background 0.1s; }
.ctx-submenu-item:hover { background: var(--bg-hover); color: var(--accent); }
.ctx-pl-cover { width: 22px; height: 22px; border-radius: 4px; flex-shrink: 0; background: var(--bg-elev-1); overflow: hidden; display: flex; align-items: center; justify-content: center; }
.ctx-pl-cover img { width: 100%; height: 100%; object-fit: cover; }
.ctx-fade-enter-active, .ctx-fade-leave-active { transition: opacity 0.12s, transform 0.12s; }
.ctx-fade-enter-from, .ctx-fade-leave-to { opacity: 0; transform: scale(0.95); }

/* 歌曲行添加到歌单按钮 */
.col-dur { position: relative; display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.row-add-pl-btn {
  width: 24px; height: 24px; border-radius: 5px;
  display: inline-flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity 0.15s, background 0.15s;
}
.song-trow:hover .row-add-pl-btn { opacity: 0.6; }
.row-add-pl-btn:hover { opacity: 1 !important; background: var(--bg-hover); }
.row-add-pl-icon { width: 14px; height: 14px; pointer-events: none; }

/* 添加到歌单对话框 */
.pl-dialog-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}
.pl-dialog {
  width: 380px; max-width: 90vw; max-height: 70vh;
  background: var(--bg-elev-3); border: 1px solid var(--border-strong);
  border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  display: flex; flex-direction: column; overflow: hidden;
}
.pl-dialog-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--border);
}
.pl-dialog-header h3 { margin: 0; font-size: 16px; font-weight: 700; }
.pl-dialog-close { color: var(--text-tertiary); transition: color 0.15s; }
.pl-dialog-close:hover { color: var(--text); }
.pl-dialog-song { padding: 10px 20px; font-size: 13px; color: var(--text-secondary); border-bottom: 1px solid var(--border); }
.pl-dialog-list { flex: 1; overflow-y: auto; padding: 8px; }
.pl-dialog-item {
  display: flex; align-items: center; gap: 12px;
  width: 100%; padding: 8px 12px; border-radius: 8px;
  text-align: left; transition: background 0.15s;
}
.pl-dialog-item:hover { background: var(--bg-hover); }
.pl-dialog-cover {
  width: 40px; height: 40px; border-radius: 8px; flex-shrink: 0;
  background: var(--bg-elev-1); overflow: hidden;
  display: flex; align-items: center; justify-content: center; color: var(--text-tertiary);
}
.pl-dialog-cover img { width: 100%; height: 100%; object-fit: cover; }
.pl-dialog-info { flex: 1; min-width: 0; }
.pl-dialog-name { font-size: 13px; color: var(--text); font-weight: 500; }
.pl-dialog-count { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }
.pl-dialog-added { color: var(--accent); flex-shrink: 0; }
.pl-dialog-loading { padding: 12px 20px; text-align: center; font-size: 12px; color: var(--text-tertiary); border-top: 1px solid var(--border); }
.pl-dialog-fade-enter-active, .pl-dialog-fade-leave-active { transition: opacity 0.15s; }
.pl-dialog-fade-enter-from, .pl-dialog-fade-leave-to { opacity: 0; }
</style>
