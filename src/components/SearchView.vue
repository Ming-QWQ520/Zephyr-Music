<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { usePlayerStore } from "@/stores/player";
import { searchSongs, neteaseSongToSong, songDetail, songLike, getCachedLikeList, addLikeCache, removeLikeCache, getCachedUser, playlistTracks, type NeteasePlaylist } from "@/api/netease";
import { pickLocalAudioFiles } from "@/api/localMusic";
import { log } from "@/composables/logger";
import { useToast } from "@/composables/useToast";
import Icon from "@/components/Icon.vue";
import type { Song } from "@/types";

const store = usePlayerStore();
const toast = useToast();

const results = ref<Song[]>([]);
const loading = ref(false);
const errorMsg = ref("");
const localOpen = ref(false);
/** 当前列表歌曲的喜欢状态集合（neteaseId → liked） */
const songLikedSet = ref<Set<number>>(new Set());
/** 搜索类型：1=单曲 */
const searchType = ref(1);
const searchTypes = [
  { value: 1, label: "单曲" },
  { value: 10, label: "专辑" },
  { value: 100, label: "歌手" },
  { value: 1000, label: "歌单" },
  { value: 1002, label: "用户" },
  { value: 1004, label: "MV" },
  { value: 1006, label: "歌词" },
  { value: 1018, label: "综合" },
];

// 右键菜单（与歌单内样式一致）
const contextMenu = ref<{ visible: boolean; x: number; y: number; song: Song | null }>({ visible: false, x: 0, y: 0, song: null });
const ctxSongLiked = ref(false);
const showPlayNextSub = ref(false);

function onContextMenu(e: MouseEvent, song: Song) {
  e.preventDefault();
  e.stopPropagation();
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, song };
  showPlayNextSub.value = false;
  if (song.source === "netease" && song.neteaseId) {
    getCachedLikeList().then(set => { ctxSongLiked.value = set.has(song.neteaseId!); }).catch(() => {});
  } else { ctxSongLiked.value = false; }
}
function closeContextMenu() { contextMenu.value.visible = false; showPlayNextSub.value = false; }
function ctxPlay() { if (contextMenu.value.song) store.playNow(contextMenu.value.song); closeContextMenu(); }
function ctxPlayNext() { if (contextMenu.value.song) store.playNext(contextMenu.value.song); closeContextMenu(); }
function ctxPlayLast() { if (contextMenu.value.song) store.addToQueue(contextMenu.value.song); closeContextMenu(); }
async function ctxToggleLike() {
  const song = contextMenu.value.song;
  if (!song || song.source !== "netease" || !song.neteaseId) return;
  const user = await getCachedUser();
  if (!user) { toast.error("请先登录"); closeContextMenu(); return; }
  try {
    const newLike = !ctxSongLiked.value;
    await songLike(song.neteaseId, user.userId, newLike);
    ctxSongLiked.value = newLike;
    if (newLike) addLikeCache(song.neteaseId); else removeLikeCache(song.neteaseId);
  } catch { /* ignore */ }
  closeContextMenu();
}

// 添加到歌单对话框
const addToPlaylistDialog = ref<{ visible: boolean; song: Song | null }>({ visible: false, song: null });
const playlists = ref<NeteasePlaylist[]>([]);
function ctxOpenAddToPlaylistDialog() {
  const song = contextMenu.value.song;
  if (!song || song.source !== "netease") return;
  closeContextMenu();
  addToPlaylistDialog.value = { visible: true, song };
  // 加载歌单列表
  import("@/api/netease").then(m => m.getCachedPlaylists()).then(pls => { playlists.value = pls; });
}
function closeAddToPlaylistDialog() { addToPlaylistDialog.value.visible = false; }
function confirmAddToPlaylist(pl: NeteasePlaylist) {
  const song = addToPlaylistDialog.value.song;
  if (!song || !song.neteaseId) return;
  closeAddToPlaylistDialog();
  playlistTracks("add", pl.id, song.neteaseId).then(() => {
    toast.success("添加成功", `已添加到「${pl.name}」`);
  }).catch(() => { toast.error("添加失败", "请稍后重试"); });
}

function onDocClick() { closeContextMenu(); }
onMounted(() => {
  document.addEventListener("click", onDocClick);
  if (store.searchKeyword) runSearch(store.searchKeyword);
});
onUnmounted(() => { document.removeEventListener("click", onDocClick); });

async function runSearch(kw: string) {
  const trimmed = kw.trim();
  if (!trimmed) {
    results.value = [];
    errorMsg.value = "";
    return;
  }
  loading.value = true;
  errorMsg.value = "";
  try {
    // 使用 /search 接口（返回更多结果，含 artists/album/duration）
    const res = await searchSongs(trimmed, 50, 0, searchType.value);
    const songs = res.result?.songs || [];
    if (songs.length === 0) {
      results.value = [];
      errorMsg.value = "没有找到结果，换个关键词试试";
    } else {
      results.value = songs.map(neteaseSongToSong);
      log.info("searchview", "search done", { kw: trimmed, count: results.value.length, hasPic: results.value.filter(s => s.pic).length });
      // 后台加载喜欢状态
      loadSongLikedStatus();
      // /search 返回的 album 没有 picUrl，用 songDetail 批量补充封面
      const needCover = results.value.filter(s => !s.pic && s.neteaseId);
      if (needCover.length > 0) {
        log.info("searchview", "fetching covers via songDetail", { count: needCover.length });
        try {
          const detailRes = await songDetail(needCover.map(s => s.neteaseId!));
          const detailMap = new Map<number, string>();
          for (const ds of (detailRes.songs || [])) {
            let picUrl = ds.al?.picUrl || ds.album?.picUrl || "";
            if (picUrl && !picUrl.includes("?param=")) picUrl += "?param=200x200";
            if (picUrl && ds.id) detailMap.set(ds.id, picUrl);
          }
          for (const s of results.value) {
            if (!s.pic && s.neteaseId && detailMap.has(s.neteaseId)) {
              s.pic = detailMap.get(s.neteaseId)!;
            }
          }
          log.info("searchview", "covers fetched", { got: detailMap.size });
        } catch (e) {
          log.warn("searchview", "fetch covers failed", { error: String(e) });
        }
      }
    }
  } catch (e) {
    results.value = [];
    errorMsg.value = String(e instanceof Error ? e.message : e);
    log.error("searchview", "search failed", { error: String(e) });
  } finally {
    loading.value = false;
  }
}

async function pickLocal() {
  localOpen.value = true;
  try {
    const songs = await pickLocalAudioFiles();
    if (songs.length) {
      results.value = songs;
      store.setSearchKeyword(songs[0]?.name || "本地音乐");
      log.info("searchview", "local loaded", { count: songs.length });
    }
  } catch (e) {
    log.error("searchview", "local pick failed", { error: String(e) });
  } finally {
    localOpen.value = false;
  }
}

function play(song: Song, index: number) {
  store.playList(results.value, index);
}

function add(song: Song) {
  store.addToQueue(song);
}

function playNext(song: Song) {
  store.playNext(song);
}

/** 加载当前列表歌曲的喜欢状态 */
async function loadSongLikedStatus() {
  if (results.value.length === 0) return;
  try {
    const likeSet = await getCachedLikeList();
    const liked = new Set<number>();
    for (const s of results.value) {
      if (s.neteaseId && likeSet.has(s.neteaseId)) liked.add(s.neteaseId);
    }
    songLikedSet.value = liked;
  } catch { /* ignore */ }
}

/** 切换单首歌曲喜欢状态（行内按钮） */
async function toggleSongLike(song: Song) {
  if (song.source !== "netease" || !song.neteaseId) return;
  const liked = songLikedSet.value.has(song.neteaseId);
  try {
    await songLike(song.neteaseId, 0, !liked);  // userId=0 由后端从 cookie 推断
    if (!liked) { songLikedSet.value.add(song.neteaseId); addLikeCache(song.neteaseId); }
    else { songLikedSet.value.delete(song.neteaseId); removeLikeCache(song.neteaseId); }
    // 触发响应式更新
    songLikedSet.value = new Set(songLikedSet.value);
    toast.success(liked ? "已取消喜欢" : "已喜欢", song.name);
  } catch (e) {
    log.warn("searchview", "toggle song like failed", { error: String(e) });
    toast.error("操作失败", "请稍后重试");
  }
}

/** 行内"添加到歌单"按钮 - 复用右键菜单的对话框 */
function openAddToPlaylistDialogForRow(song: Song) {
  if (song.source !== "netease") return;
  // 复用已有的 addToPlaylistDialog（与右键菜单共用）
  addToPlaylistDialog.value = { visible: true, song };
  import("@/api/netease").then(m => m.getCachedPlaylists()).then(pls => { playlists.value = pls; });
}

onMounted(() => {
  if (store.searchKeyword) runSearch(store.searchKeyword);
});

watch(
  () => store.searchKeyword,
  (kw) => {
    if (kw) runSearch(kw);
  }
);
</script>

<template>
  <section class="search-view">
    <header class="view-header">
      <div class="title-block">
        <h1>搜索结果</h1>
        <p v-if="store.searchKeyword" class="sub">
          关键词：<span class="kw">{{ store.searchKeyword }}</span>
          <span v-if="results.length" class="count">· {{ results.length }} 首</span>
        </p>
      </div>
      <button class="local-pick" :class="{ loading: localOpen }" @click="pickLocal">
        <Icon name="folder" :size="16" />
        <span>{{ localOpen ? "选择中..." : "打开本地文件" }}</span>
      </button>
    </header>

    <!-- 搜索类型筛选 -->
    <div class="search-types">
      <button
        v-for="t in searchTypes"
        :key="t.value"
        class="search-type-btn"
        :class="{ active: searchType === t.value }"
        @click="searchType = t.value; if (store.searchKeyword) runSearch(store.searchKeyword)"
      >{{ t.label }}</button>
    </div>

    <div class="results nice-scroll">
      <div v-if="loading" class="state">
        <span class="spinner" />
        <p>正在搜索...</p>
      </div>
      <div v-else-if="errorMsg && !results.length" class="state empty-state">
        <Icon name="search" :size="42" />
        <p>{{ errorMsg }}</p>
        <p class="hint">在顶部搜索栏输入歌曲名或歌手名，或点击右上角"打开本地文件"。</p>
      </div>

      <table v-else-if="results.length" class="song-table">
        <thead>
          <tr>
            <th class="col-idx">#</th>
            <th class="col-title">标题</th>
            <th class="col-actions-inline"></th>
            <th class="col-artist">歌手</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(song, idx) in results"
            :key="song.id"
            class="row"
            :class="{ active: store.currentSong?.id === song.id }"
            @dblclick="play(song, idx)"
            @contextmenu="onContextMenu($event, song)"
          >
            <td class="col-idx">
              <button class="play-cell" @click="play(song, idx)">
                <span class="idx">{{ idx + 1 }}</span>
                <Icon class="play-icon" name="play" :size="14" />
              </button>
            </td>
            <td class="col-title">
              <div class="cover">
                <img v-if="song.pic" :src="song.pic" :alt="song.name" referrerpolicy="no-referrer" />
                <Icon v-else name="music" :size="14" />
              </div>
              <div class="title-wrap">
                <div class="title truncate">{{ song.name }}</div>
                <div class="mobile-artist truncate">{{ song.artist }}</div>
              </div>
            </td>
            <!-- 统一音乐卡片操作按钮：喜欢 / 添加至歌单 / 下一首播放（=加入队列，放在标题和艺术家之间） -->
            <td class="col-actions-inline">
              <div class="nmn-row-actions" :class="{ 'has-liked': song.neteaseId && songLikedSet.has(song.neteaseId) }">
                <button v-if="song.source === 'netease'" class="nmn-action-btn nmn-action-like"
                  :class="{ liked: song.neteaseId && songLikedSet.has(song.neteaseId) }"
                  :title="song.neteaseId && songLikedSet.has(song.neteaseId) ? '取消喜欢' : '喜欢'"
                  @click.stop="toggleSongLike(song)">
                  <img v-if="song.neteaseId && songLikedSet.has(song.neteaseId)" src="/icons/like.svg" alt="liked" class="nmn-action-icon" />
                  <img v-else src="/icons/not_like.svg" alt="not liked" class="nmn-action-icon" />
                </button>
                <button v-if="song.source === 'netease'" class="nmn-action-btn nmn-action-playlist" title="添加到歌单"
                  @click.stop="openAddToPlaylistDialogForRow(song)">
                  <img src="/icons/add_playlist.svg" alt="add to playlist" class="nmn-action-icon" />
                </button>
                <button class="nmn-action-btn nmn-action-next" title="下一首播放" @click.stop="add(song)">
                  <Icon name="next" :size="15" />
                </button>
              </div>
            </td>
            <td class="col-artist">
              <span class="truncate">{{ song.artist }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 右键菜单（与歌单内样式一致） -->
    <Transition name="ctx-fade">
      <div v-if="contextMenu.visible && contextMenu.song"
        class="ctx-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @click.stop>
        <button class="ctx-item" @click="ctxPlay"><Icon name="play" :size="14" /><span>播放</span></button>
        <div class="ctx-item-wrapper" @mouseenter="showPlayNextSub = true" @mouseleave="showPlayNextSub = false">
          <button class="ctx-item" @click="ctxPlayNext">
            <Icon name="next" :size="14" /><span>下一首播放</span><Icon name="chevronRight" :size="12" class="ctx-arrow" />
          </button>
          <div v-if="showPlayNextSub" class="ctx-flyout" @click.stop>
            <button class="ctx-flyout-item" @click="ctxPlayNext"><Icon name="next" :size="14" /><span>下一首播放</span></button>
            <button class="ctx-flyout-item" @click="ctxPlayLast"><Icon name="list" :size="14" /><span>最后一首播放</span></button>
          </div>
        </div>
        <div class="ctx-divider" />
        <button v-if="contextMenu.song.source === 'netease'" class="ctx-item" @click="ctxToggleLike">
          <img v-if="ctxSongLiked" src="/icons/like.svg" alt="liked" class="ctx-like-icon" />
          <img v-else src="/icons/not_like.svg" alt="not liked" class="ctx-like-icon" />
          <span>{{ ctxSongLiked ? '取消喜欢' : '喜欢' }}</span>
        </button>
        <button v-if="contextMenu.song.source === 'netease'" class="ctx-item" @click="ctxOpenAddToPlaylistDialog">
          <Icon name="folder" :size="14" /><span>添加到歌单</span>
        </button>
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
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.search-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px 28px 16px;
  gap: 16px;
}
.view-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}
.title-block h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.3px;
}
.sub {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}
.sub .kw {
  color: var(--text);
}
.sub .count {
  margin-left: 6px;
  color: var(--text-tertiary);
}
.local-pick {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 13px;
  color: var(--text-secondary);
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.local-pick:hover {
  color: var(--text);
  border-color: var(--border-strong);
  background: var(--bg-elev-3);
}
.local-pick.loading {
  opacity: 0.7;
  pointer-events: none;
}

/* 搜索类型筛选 */
.search-types {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.search-type-btn {
  padding: 5px 14px;
  border-radius: 16px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-elev-3);
  transition: all 0.15s;
}
.search-type-btn:hover { color: var(--text); }
.search-type-btn.active { background: var(--accent); color: #fff; font-weight: 600; }

.results {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  color: var(--text-tertiary);
}
.empty-state .hint {
  font-size: 12px;
  color: var(--text-tertiary);
  max-width: 420px;
  text-align: center;
}
.spinner {
  display: inline-block;
  width: 24px;
  height: 24px;
  border: 2px solid var(--text-tertiary);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.song-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.song-table thead th {
  position: sticky;
  top: 0;
  background: var(--bg);
  text-align: left;
  font-size: 11px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--text-tertiary);
  font-weight: 600;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  z-index: 1;
}
.col-idx { width: 56px; text-align: center; }
.col-title { width: auto; }
.col-actions-inline { width: 120px; text-align: left; }
.col-artist { width: 30%; }
.song-table tbody tr.row {
  border-radius: 8px;
  transition: background 0.12s;
  cursor: default;
}
.song-table tbody tr.row:hover {
  background: var(--bg-hover);
}
.song-table tbody tr.row.active {
  background: var(--bg-active);
}
.song-table td {
  padding: 6px 12px;
  vertical-align: middle;
  font-size: 13px;
  color: var(--text-secondary);
}
.col-idx { text-align: center; }
.play-cell {
  position: relative;
  width: 32px;
  height: 28px;
  border-radius: 6px;
  color: var(--text-tertiary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.row:hover .play-cell,
.row.active .play-cell {
  color: var(--accent);
}
.play-cell .idx {
  font-variant-numeric: tabular-nums;
  transition: opacity 0.15s;
}
.play-cell .play-icon {
  position: absolute;
  opacity: 0;
  transition: opacity 0.15s;
}
.row:hover .play-cell .idx {
  opacity: 0;
}
.row:hover .play-cell .play-icon {
  opacity: 1;
}
.col-title {
  display: flex !important;
  align-items: center;
  gap: 12px;
}
.cover {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 6px;
  background: var(--bg-elev-3);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.title-wrap {
  flex: 1;
  min-width: 0;
}
.title-wrap .title {
  color: var(--text);
  font-weight: 500;
}
.row.active .title {
  color: var(--accent);
}
.mobile-artist {
  display: none;
  font-size: 11px;
  color: var(--text-tertiary);
}
.col-actions {
  text-align: right;
}
.row-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: var(--text-tertiary);
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, background 0.15s;
}
.row:hover .row-action {
  opacity: 1;
}
.row-action:hover {
  color: var(--accent);
  background: var(--accent-soft);
}

@media (max-width: 720px) {
  .search-view { padding: 16px; }
  .col-artist { display: none; }
  .mobile-artist { display: block; }
  .col-actions { width: 60px; }
  .row-action { opacity: 1; }
}
/* 右键菜单（与歌单内样式一致） */
.ctx-menu { position: fixed; z-index: 500; min-width: 180px; background: var(--bg-elev-3); border: 1px solid var(--border-strong); border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,0.4); padding: 4px; }
.ctx-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; border-radius: 6px; font-size: 13px; color: var(--text); text-align: left; transition: background 0.1s; }
.ctx-item:hover { background: var(--bg-hover); color: var(--accent); }
.ctx-item .ctx-arrow { margin-left: auto; opacity: 0.5; }
.ctx-like-icon { width: 14px; height: 14px; flex-shrink: 0; }
.ctx-divider { height: 1px; background: var(--border); margin: 4px 8px; }
.ctx-item-wrapper { position: relative; }
.ctx-flyout { position: absolute; left: 100%; top: 0; min-width: 150px; background: var(--bg-elev-3); border: 1px solid var(--border-strong); border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,0.4); padding: 4px; margin-left: 4px; }
.ctx-flyout-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; border-radius: 6px; font-size: 13px; color: var(--text); text-align: left; transition: background 0.1s; }
.ctx-flyout-item:hover { background: var(--bg-hover); color: var(--accent); }
.ctx-fade-enter-active, .ctx-fade-leave-active { transition: opacity 0.12s, transform 0.12s; }
.ctx-fade-enter-from, .ctx-fade-leave-to { opacity: 0; transform: scale(0.95); }

/* 添加到歌单对话框 */
.pl-dialog-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; }
.pl-dialog { width: 380px; max-width: 90vw; max-height: 70vh; background: var(--bg-elev-3); border: 1px solid var(--border-strong); border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); display: flex; flex-direction: column; overflow: hidden; }
.pl-dialog-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); }
.pl-dialog-header h3 { margin: 0; font-size: 16px; font-weight: 700; }
.pl-dialog-close { color: var(--text-tertiary); transition: color 0.15s; }
.pl-dialog-close:hover { color: var(--text); }
.pl-dialog-list { flex: 1; overflow-y: auto; padding: 8px; }
.pl-dialog-item { display: flex; align-items: center; gap: 12px; width: 100%; padding: 8px 12px; border-radius: 8px; text-align: left; transition: background 0.15s; }
.pl-dialog-item:hover { background: var(--bg-hover); }
.pl-dialog-cover { width: 40px; height: 40px; border-radius: 8px; flex-shrink: 0; background: var(--bg-elev-1); overflow: hidden; display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); }
.pl-dialog-cover img { width: 100%; height: 100%; object-fit: cover; }
.pl-dialog-info { flex: 1; min-width: 0; }
.pl-dialog-name { font-size: 13px; color: var(--text); font-weight: 500; }
.pl-dialog-count { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }
.pl-dialog-fade-enter-active, .pl-dialog-fade-leave-active { transition: opacity 0.15s; }
.pl-dialog-fade-enter-from, .pl-dialog-fade-leave-to { opacity: 0; }
</style>
