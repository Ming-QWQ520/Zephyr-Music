<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { usePlayerStore } from "@/stores/player";
import {
  playlistTrackAll, recommendSongs, userRecord,
  getCachedUser, getCachedPlaylists,
  neteaseSongToSong, getCookie, _cachedUser,
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
function onContextMenu(e: MouseEvent, song: Song) { e.preventDefault(); contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, song }; }
function closeContextMenu() { contextMenu.value.visible = false; }
function ctxPlay() { if (contextMenu.value.song) store.playNow(contextMenu.value.song); closeContextMenu(); }
function ctxPlayNext() { if (contextMenu.value.song) store.playNextSong(contextMenu.value.song); closeContextMenu(); }
function ctxAddToQueue() { if (contextMenu.value.song) store.addToQueue(contextMenu.value.song); closeContextMenu(); }
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
            <span v-else class="col-dur">{{ song.duration ? formatTime(song.duration) : '--:--' }}</span>
          </div>
        </template>
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

.context-menu { position: fixed; z-index: 500; min-width: 160px; background: var(--bg-elev-3); border: 1px solid var(--border-strong); border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,0.4); padding: 4px; }
.ctx-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; border-radius: 6px; font-size: 13px; color: var(--text); text-align: left; transition: background 0.1s; }
.ctx-item:hover { background: var(--bg-hover); color: var(--accent); }
.ctx-fade-enter-active, .ctx-fade-leave-active { transition: opacity 0.12s, transform 0.12s; }
.ctx-fade-enter-from, .ctx-fade-leave-to { opacity: 0; transform: scale(0.95); }
</style>
