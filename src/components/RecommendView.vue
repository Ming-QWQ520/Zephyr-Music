<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { usePlayerStore } from "@/stores/player";
import {
  recommendResource, recommendSongs, playlistDetail, neteaseSongToSong, getCookie,
  getCachedLikeList, addLikeCache, removeLikeCache, songLike, getCachedUser,
  playlistTracks, getCachedPlaylists, type NeteasePlaylist,
} from "@/api/netease";
import { log } from "@/composables/logger";
import { useToast } from "@/composables/useToast";
const toast = useToast();
import Icon from "@/components/Icon.vue";
import type { Song } from "@/types";

const store = usePlayerStore();

const recommendPlaylists = ref<NeteasePlaylist[]>([]);
const loading = ref(true);

// 顶部入口卡片
// 每日推荐 = /recommend/resource（推荐歌单，打开歌单详情）
const dailyRecommendPl = ref<NeteasePlaylist | null>(null);
const dailyRecommendCover = ref("");
// 私人漫游 = /recommend/songs（每日推荐歌曲，播放歌曲 + 不感兴趣）
const personalRoamSongs = ref<Song[]>([]);
// 私人雷达 = 固定歌单 ID 3136952023
const personalRadarCover = ref("");

// 榜单精选
const rankings = ref<{ id: number; name: string; coverImgUrl: string; songs: Song[]; loading: boolean }[]>([
  { id: 19723756, name: "飙升榜", coverImgUrl: "", songs: [], loading: true },
  { id: 3779629, name: "新歌榜", coverImgUrl: "", songs: [], loading: true },
  { id: 3778678, name: "热歌榜", coverImgUrl: "", songs: [], loading: true },
  { id: 2250011882, name: "抖音排行榜", coverImgUrl: "", songs: [], loading: true },
]);

async function loadData() {
  loading.value = true;
  if (getCookie()) {
    // 每日推荐歌单（/recommend/resource）—— 第一个推荐歌单作为"每日推荐"入口
    try {
      const res = await recommendResource();
      recommendPlaylists.value = (res.recommend || res.data || []).slice(0, 10);
      const first = recommendPlaylists.value[0];
      if (first) {
        dailyRecommendPl.value = first;
        dailyRecommendCover.value = first.coverImgUrl || "";
      }
      log.info("recommend-view", "recommend playlists loaded", { count: recommendPlaylists.value.length });
    } catch (e) { log.warn("recommend-view", "load recommend failed", { error: String(e) }); }

    // 私人漫游歌曲（/recommend/songs）—— 每日推荐歌曲
    try {
      const sres = await recommendSongs();
      const dailySongs = sres.data?.dailySongs || [];
      personalRoamSongs.value = dailySongs.slice(0, 30).map(neteaseSongToSong);
      log.info("recommend-view", "daily songs loaded", { count: personalRoamSongs.value.length });
    } catch (e) { log.warn("recommend-view", "load daily songs failed", { error: String(e) }); }
  }

  // 私人雷达封面（固定歌单 ID 3136952023）
  playlistDetail(3136952023, 0).then(res => {
    personalRadarCover.value = res.playlist?.coverImgUrl || "";
  }).catch(e => { log.warn("recommend-view", "personal radar failed", { error: String(e) }); });

  loading.value = false;
  // 并行加载榜单
  for (const r of rankings.value) {
    playlistDetail(r.id, 0).then(res => {
      r.coverImgUrl = res.playlist?.coverImgUrl || "";
      const tracks = (res.playlist?.tracks || []).slice(0, 5);
      r.songs = tracks.map(neteaseSongToSong);
      r.loading = false;
      log.info("recommend-view", `ranking ${r.name} loaded`, { count: r.songs.length });
    }).catch(e => {
      log.warn("recommend-view", `ranking ${r.name} failed`, { error: String(e) });
      r.loading = false;
    });
  }
}

/** 打开每日推荐歌单 */
function openDailyRecommend() {
  if (dailyRecommendPl.value) openPlaylist(dailyRecommendPl.value);
}

/** 播放私人漫游歌曲 */
function playPersonalRoam() {
  if (personalRoamSongs.value.length > 0) {
    store.setSourcePlaylistId(null);
    store.playList(personalRoamSongs.value, 0);
    toast.success("私人漫游", `开始播放 ${personalRoamSongs.value.length} 首推荐歌曲`);
  }
}

/** 不感兴趣（/recommend/songs/dislike） */
async function dislikeSong(song: Song) {
  if (!song.neteaseId) return;
  try {
    const { apiGet } = await import("@/api/netease/core");
    const res = await apiGet<{ code: number; data?: any }>("/recommend/songs/dislike", { id: song.neteaseId });
    if (res.code === 200) {
      // 从列表移除
      personalRoamSongs.value = personalRoamSongs.value.filter(s => s.id !== song.id);
      // 如果返回新歌曲，添加到列表末尾
      if (res.data?.id) {
        const newSong = neteaseSongToSong(res.data as any);
        personalRoamSongs.value.push(newSong);
      }
      toast.success("已标记不感兴趣", song.name);
    }
  } catch (e) {
    log.warn("recommend-view", "dislike failed", { error: String(e) });
    toast.error("操作失败", "请稍后重试");
  }
}

/** 打开私人雷达歌单 */
function openPersonalRadar() {
  store.pendingPlaylistId = 3136952023;
  store.setView("netease");
}

function playSong(song: Song) {
  store.playNow(song);
}

function playAll(songs: Song[], idx = 0) {
  if (songs.length > 0) store.playList(songs, idx);
}

function openPlaylist(pl: NeteasePlaylist) {
  store.pendingPlaylistId = pl.id;
  store.setView("netease");
}

function openRanking(id: number) {
  store.pendingPlaylistId = id;
  store.setView("netease");
}

// 右键菜单（与搜索界面样式一致）
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
    toast.success(newLike ? "已喜欢" : "已取消喜欢", song.name);
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
  getCachedPlaylists().then(pls => { playlists.value = pls; });
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
  loadData();
});
onUnmounted(() => { document.removeEventListener("click", onDocClick); });
</script>

<template>
  <section class="recommend-view nice-scroll">
    <!-- 顶部入口卡片：每日推荐 / 私人漫游 / 私人雷达 -->
    <div class="entry-cards">
      <!-- 每日推荐 = /recommend/resource 推荐歌单 -->
      <button class="entry-card" @click="openDailyRecommend" :disabled="!dailyRecommendPl">
        <div class="entry-cover daily-cover">
          <img v-if="dailyRecommendCover" :src="dailyRecommendCover + '?param=200x200'" alt="每日推荐" referrerpolicy="no-referrer" loading="lazy" />
          <Icon v-else name="music" :size="28" />
          <div class="entry-date">{{ new Date().getDate() }}</div>
        </div>
        <div class="entry-name">每日推荐</div>
        <div class="entry-sub">每日推荐歌单</div>
      </button>

      <!-- 私人漫游 = /recommend/songs 每日推荐歌曲 -->
      <button class="entry-card" @click="playPersonalRoam" :disabled="!personalRoamSongs.length">
        <div class="entry-cover roam-cover">
          <Icon name="shuffle" :size="28" />
        </div>
        <div class="entry-name">私人漫游</div>
        <div class="entry-sub">{{ personalRoamSongs.length }} 首推荐歌曲</div>
      </button>

      <!-- 私人雷达 = 固定歌单 ID 3136952023 -->
      <button class="entry-card" @click="openPersonalRadar">
        <div class="entry-cover radar-cover">
          <img v-if="personalRadarCover" :src="personalRadarCover + '?param=200x200'" alt="私人雷达" referrerpolicy="no-referrer" loading="lazy" />
          <Icon v-else name="radio" :size="28" />
        </div>
        <div class="entry-name">私人雷达</div>
        <div class="entry-sub">为你打造的歌单</div>
      </button>
    </div>

    <!-- 私人漫游歌曲列表（带不感兴趣按钮） -->
    <div v-if="personalRoamSongs.length" class="section">
      <div class="roam-header">
        <h2 class="section-title">私人漫游</h2>
        <button class="roam-play-all" @click="playPersonalRoam">
          <Icon name="play" :size="14" /><span>播放全部</span>
        </button>
      </div>
      <div class="roam-list">
        <div v-for="(song, idx) in personalRoamSongs.slice(0, 10)" :key="song.id"
          class="roam-item" :class="{ active: song.id === store.currentSong?.id }"
          @click="playSong(song)">
          <span class="roam-idx">{{ idx + 1 }}</span>
          <div class="roam-cover-sm" v-if="song.pic"><img :src="song.pic" alt="" referrerpolicy="no-referrer" /></div>
          <div class="roam-meta">
            <div class="roam-name truncate">{{ song.name }}</div>
            <div class="roam-artist truncate">{{ song.artist }}</div>
          </div>
          <button class="roam-dislike" title="不感兴趣" @click.stop="dislikeSong(song)">
            <img src="/icons/dislike.svg" alt="dislike" class="roam-dislike-icon" />
          </button>
        </div>
      </div>
    </div>

    <!-- 推荐歌单 -->
    <div class="section">
      <h2 class="section-title">推荐歌单</h2>
      <div v-if="loading" class="loading-state"><div class="spinner" /><span>加载中...</span></div>
      <div v-else class="playlist-grid">
        <button v-for="pl in recommendPlaylists" :key="pl.id" class="playlist-card" @click="openPlaylist(pl)">
          <div class="card-cover">
            <img v-if="pl.coverImgUrl" :src="pl.coverImgUrl + '?param=200x200'" :alt="pl.name" referrerpolicy="no-referrer" loading="lazy" />
            <Icon v-else name="music" :size="28" />
          </div>
          <div class="card-name truncate">{{ pl.name }}</div>
        </button>
      </div>
    </div>

    <!-- 榜单精选 -->
    <div class="section">
      <h2 class="section-title">榜单精选</h2>
      <div class="ranking-grid">
        <div v-for="r in rankings" :key="r.id" class="ranking-card">
          <div class="ranking-header" @click="openRanking(r.id)" style="cursor: pointer;">
            <div class="ranking-cover">
              <img v-if="r.coverImgUrl" :src="r.coverImgUrl + '?param=100x100'" :alt="r.name" referrerpolicy="no-referrer" loading="lazy" />
              <Icon v-else name="music" :size="20" />
            </div>
            <div class="ranking-name">{{ r.name }}</div>
            <Icon name="chevronRight" :size="16" class="ranking-arrow" />
          </div>
          <div v-if="r.loading" class="ranking-loading"><div class="spinner-sm" /></div>
          <div v-else class="ranking-songs">
            <button v-for="(song, idx) in r.songs" :key="song.id"
              class="ranking-song" :class="{ active: song.id === store.currentSong?.id }"
              @click="playSong(song)"
              @contextmenu="onContextMenu($event, song)">
              <span class="ranking-idx">{{ idx + 1 }}</span>
              <span class="ranking-song-name truncate">{{ song.name }}</span>
              <span class="ranking-artist truncate">{{ song.artist }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 右键菜单（与搜索界面样式一致） -->
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
.recommend-view { height: 100%; overflow-y: auto; padding: 24px 28px; display: flex; flex-direction: column; gap: 32px; }
.section { display: flex; flex-direction: column; gap: 16px; }
.section-title { margin: 0; font-size: 20px; font-weight: 700; color: var(--text); }

/* 顶部入口卡片 */
.entry-cards { display: flex; gap: 16px; flex-shrink: 0; }
.entry-card {
  display: flex; flex-direction: column; gap: 8px; text-align: left;
  flex: 0 0 140px; transition: transform 0.2s var(--ease-out);
}
.entry-card:hover:not(:disabled) { transform: translateY(-3px); }
.entry-card:disabled { opacity: 0.5; cursor: not-allowed; }
.entry-cover {
  position: relative; aspect-ratio: 1; border-radius: var(--radius);
  overflow: hidden; background: var(--bg-elev-3);
  display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); box-shadow: var(--shadow-sm);
}
.entry-cover img { width: 100%; height: 100%; object-fit: cover; }
.daily-cover { background: linear-gradient(135deg, #ff6b35, #fa233b); color: #fff; }
.roam-cover { background: linear-gradient(135deg, #6750A4, #9d4edd); color: #fff; }
.radar-cover { background: linear-gradient(135deg, #06d6a0, #118ab2); color: #fff; }
.entry-date {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-size: 42px; font-weight: 800; color: #fff; text-shadow: 0 2px 8px rgba(0,0,0,0.3);
  pointer-events: none;
}
.entry-name { font-size: 14px; color: var(--text); font-weight: 600; }
.entry-sub { font-size: 11px; color: var(--text-tertiary); }

/* 私人漫游歌曲列表 */
.roam-header { display: flex; align-items: center; justify-content: space-between; }
.roam-play-all { display: flex; align-items: center; gap: 6px; padding: 6px 16px; border-radius: 16px; background: var(--accent); color: #fff; font-size: 12px; font-weight: 500; transition: all 0.15s; }
.roam-play-all:hover { transform: scale(1.05); }
.roam-list { display: flex; flex-direction: column; gap: 2px; }
.roam-item { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: var(--radius-sm); cursor: pointer; transition: background 0.15s; }
.roam-item:hover { background: var(--bg-hover); }
.roam-item.active { color: var(--accent); background: var(--accent-soft); }
.roam-idx { width: 24px; text-align: center; font-size: 13px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.roam-item.active .roam-idx { color: var(--accent); }
.roam-cover-sm { width: 36px; height: 36px; border-radius: 6px; overflow: hidden; flex-shrink: 0; }
.roam-cover-sm img { width: 100%; height: 100%; object-fit: cover; }
.roam-meta { flex: 1; min-width: 0; }
.roam-name { font-size: 13px; color: var(--text); }
.roam-artist { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }
.roam-dislike { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.15s, background 0.15s; flex-shrink: 0; }
.roam-item:hover .roam-dislike { opacity: 0.6; }
.roam-dislike:hover { opacity: 1 !important; background: var(--bg-hover); }
.roam-dislike-icon { width: 16px; height: 16px; pointer-events: none; }
.loading-state { display: flex; align-items: center; gap: 8px; color: var(--text-tertiary); font-size: 13px; padding: 24px; }
.spinner { width: 24px; height: 24px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
.spinner-sm { width: 16px; height: 16px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 12px auto; }

/* 推荐歌单网格 */
.playlist-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px; }
.playlist-card { display: flex; flex-direction: column; gap: 8px; text-align: left; transition: transform 0.2s var(--ease-out); }
.playlist-card:hover { transform: translateY(-3px); }
.card-cover { aspect-ratio: 1; border-radius: var(--radius); overflow: hidden; background: var(--bg-elev-3); display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); box-shadow: var(--shadow-sm); }
.card-cover img { width: 100%; height: 100%; object-fit: cover; }
.card-name { font-size: 13px; color: var(--text); font-weight: 500; line-height: 1.3; }

/* 榜单精选 */
.ranking-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.ranking-card { background: var(--bg-elev-1); border-radius: var(--radius); padding: 16px; border: 1px solid var(--border); }
.ranking-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.ranking-cover { width: 48px; height: 48px; border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; background: var(--bg-elev-3); display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); }
.ranking-cover img { width: 100%; height: 100%; object-fit: cover; }
.ranking-name { font-size: 16px; font-weight: 700; color: var(--text); flex: 1; }
.ranking-arrow { color: var(--text-tertiary); flex-shrink: 0; }
.ranking-header:hover .ranking-arrow { color: var(--accent); }
.ranking-loading { display: flex; justify-content: center; padding: 12px; }
.ranking-songs { display: flex; flex-direction: column; gap: 2px; }
.ranking-song { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--radius-sm); text-align: left; transition: background 0.15s; }
.ranking-song:hover { background: var(--bg-hover); }
.ranking-song.active { color: var(--accent); background: var(--accent-soft); }
.ranking-idx { width: 20px; text-align: center; font-size: 13px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.ranking-song.active .ranking-idx { color: var(--accent); }
.ranking-song-name { flex: 1; min-width: 0; font-size: 13px; color: var(--text); }
.ranking-artist { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; max-width: 100px; }

/* 右键菜单（与搜索界面样式一致） */
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

<!-- 非 scoped 样式：有壁纸时卡片毛玻璃半透明（:global 在 scoped 中无法正确编译复合选择器） -->
<style>
body.has-wallpaper .ranking-card {
  background: rgba(33, 31, 38, 0.55);
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  border-color: rgba(255, 255, 255, 0.10);
  box-shadow: 0 4px 20px rgba(0,0,0,0.3);
}
body.has-wallpaper .ranking-song:hover {
  background: rgba(255, 255, 255, 0.08);
}
body.has-wallpaper .ranking-song.active {
  background: rgba(250, 35, 59, 0.18);
}
body.has-wallpaper .card-cover {
  box-shadow: 0 4px 16px rgba(0,0,0,0.35);
}
</style>
