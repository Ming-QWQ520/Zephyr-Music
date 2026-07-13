<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { usePlayerStore } from "@/stores/player";
import {
  recommendResource, recommendSongs, playlistDetail, neteaseSongToSong, getCookie,
  getCachedLikeList, addLikeCache, removeLikeCache, songLike, getCachedUser,
  playlistTracks, getCachedPlaylists, type NeteasePlaylist,
} from "@/api/netease";
import { log } from "@/composables/logger";
import { useToast } from "@/composables/useToast";
import { storeGetSync, storeSetSync } from "@/composables/useStore";
const toast = useToast();
import Icon from "@/components/Icon.vue";
import type { Song } from "@/types";

const store = usePlayerStore();

const recommendPlaylists = ref<NeteasePlaylist[]>([]);
const loading = ref(true);

// 顶部入口卡片
// 每日推荐 = /recommend/songs（每日推荐歌曲，播放+不感兴趣）
const dailyRecommendSongs = ref<Song[]>([]);
// 私人漫游 = /recommend/resource（推荐资源/歌曲）
const personalRoamSongs = ref<Song[]>([]);
// 私人雷达 = 固定歌单 ID 3136952023
const personalRadarCover = ref("");
const personalRadarName = ref("");
const personalRadarFirstSong = ref("");

const dailyFirstSong = computed(() => dailyRecommendSongs.value[0] || null);
const dailyCoverUrl = computed(() => dailyFirstSong.value?.pic || "");
const dailySubText = computed(() => {
  const name = dailyFirstSong.value?.name;
  return name ? `每日推荐 | 从[${name}]听起` : `${dailyRecommendSongs.value.length} 首推荐歌曲`;
});
const radarSubText = computed(() => {
  const name = personalRadarFirstSong.value;
  return name ? `私人雷达 | 从[${name}]听起` : (personalRadarName.value || '为你打造的歌单');
});

// 榜单精选 - 支持用户自定义（持久化到 tauri-plugin-store）
interface RankingItem { id: number; name: string; coverImgUrl: string; songs: Song[]; loading: boolean; }

/** 预设榜单池（用户可从中选择添加） */
const RANKING_PRESETS: { id: number; name: string }[] = [
  { id: 19723756, name: "飙升榜" },
  { id: 3779629, name: "新歌榜" },
  { id: 3778678, name: "热歌榜" },
  { id: 2250011882, name: "抖音排行榜" },
  { id: 14028249541, name: "全球说唱榜" },
  { id: 2809513713, name: "欧美热歌榜" },
  { id: 71384707, name: "古典榜" },
  { id: 1978921795, name: "电音榜" },
  { id: 991319590, name: "中文说唱榜" },
  { id: 13372522766, name: "潮流风向榜" },
  { id: 12911403728, name: "音乐合伙人推荐榜" },
  { id: 12911589513, name: "音乐合伙人热歌榜" },
  { id: 12911619970, name: "音乐合伙人留名榜" },
  { id: 12911379734, name: "音乐合伙人高分新歌榜" },
  { id: 12768855486, name: "音乐合伙人高分榜" },
  { id: 5453912201, name: "黑胶VIP爱听榜" },
  { id: 71385702, name: "ACG榜" },
  { id: 745956260, name: "韩语榜" },
];

/** 默认榜单（首次启动时使用） */
const DEFAULT_RANKINGS: { id: number; name: string }[] = [
  { id: 19723756, name: "飙升榜" },
  { id: 3779629, name: "新歌榜" },
  { id: 3778678, name: "热歌榜" },
  { id: 2250011882, name: "抖音排行榜" },
  { id: 14028249541, name: "全球说唱榜" },
  { id: 2809513713, name: "欧美热歌榜" },
];

/** 最大榜单数量 */
const MAX_RANKINGS = 6;
const RANKINGS_STORAGE_KEY = "zephyr-rankings";

/** 从 store 加载用户自定义榜单 */
function loadCustomRankings(): { id: number; name: string }[] {
  try {
    const raw = storeGetSync(RANKINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_RANKINGS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.filter((r: any) => typeof r.id === "number" && typeof r.name === "string");
    }
    return DEFAULT_RANKINGS;
  } catch { return DEFAULT_RANKINGS; }
}

/** 保存榜单到 store */
function saveCustomRankings(items: { id: number; name: string }[]) {
  try { storeSetSync(RANKINGS_STORAGE_KEY, JSON.stringify(items)); } catch { /* ignore */ }
}

const rankings = ref<RankingItem[]>(
  loadCustomRankings().map(r => ({ ...r, coverImgUrl: "", songs: [], loading: true }))
);

/** 添加榜单弹窗状态 */
const showAddRankingDialog = ref(false);
/** 编辑模式（显示删除按钮） */
const editMode = ref(false);
/** 自定义 ID 输入 */
const customRankingIdInput = ref("");
const customRankingNameInput = ref("");

/** 已添加的榜单 ID 集合（用于过滤预设池） */
const addedRankingIds = computed(() => new Set(rankings.value.map(r => r.id)));

/** 可添加的预设（未添加的） */
const availablePresets = computed(() =>
  RANKING_PRESETS.filter(p => !addedRankingIds.value.has(p.id))
);

/** 添加榜单 */
async function addRanking(id: number, name?: string) {
  if (rankings.value.length >= MAX_RANKINGS) {
    toast.error("已达上限", `最多只能有 ${MAX_RANKINGS} 个榜单`);
    return;
  }
  if (addedRankingIds.value.has(id)) {
    toast.error("已存在", "该榜单已添加");
    return;
  }
  // 从预设池取名字，否则用传入的 name
  const preset = RANKING_PRESETS.find(p => p.id === id);
  const finalName = name || preset?.name || `榜单 ${id}`;
  rankings.value.push({ id, name: finalName, coverImgUrl: "", songs: [], loading: true });
  saveCustomRankings(rankings.value.map(r => ({ id: r.id, name: r.name })));
  showAddRankingDialog.value = false;
  customRankingIdInput.value = "";
  customRankingNameInput.value = "";
  // 加载榜单数据
  loadRankingData(rankings.value[rankings.value.length - 1]);
  toast.success("已添加", finalName);
}

/** 通过自定义 ID 添加榜单 - 直接使用 API 返回的歌单名称 */
async function addCustomRankingById() {
  const idStr = customRankingIdInput.value.trim();
  if (!idStr) { toast.error("请输入歌单 ID"); return; }
  const id = parseInt(idStr);
  if (!id || id <= 0) { toast.error("无效的 ID", "请输入数字"); return; }
  if (addedRankingIds.value.has(id)) { toast.error("已存在", "该榜单已添加"); return; }
  if (rankings.value.length >= MAX_RANKINGS) {
    toast.error("已达上限", `最多只能有 ${MAX_RANKINGS} 个榜单`);
    return;
  }
  // 先添加占位（loading 状态），然后通过 API 获取真实名字
  const placeholderName = `加载中...`;
  rankings.value.push({ id, name: placeholderName, coverImgUrl: "", songs: [], loading: true });
  const newItem = rankings.value[rankings.value.length - 1];
  showAddRankingDialog.value = false;
  customRankingIdInput.value = "";
  customRankingNameInput.value = "";
  // 加载榜单数据，使用 API 返回的真实歌单名称
  try {
    const res = await playlistDetail(id, 0);
    if (res.playlist?.name) {
      newItem.name = res.playlist.name;  // 直接用 API 返回的歌单原名
    } else {
      // API 没返回名字，删除该项
      const idx = rankings.value.findIndex(r => r.id === id);
      if (idx >= 0) rankings.value.splice(idx, 1);
      toast.error("加载失败", "未找到该歌单");
      return;
    }
    saveCustomRankings(rankings.value.map(r => ({ id: r.id, name: r.name })));
    newItem.coverImgUrl = res.playlist?.coverImgUrl || "";
    const tracks = (res.playlist?.tracks || []).slice(0, 5);
    newItem.songs = tracks.map(neteaseSongToSong);
    newItem.loading = false;
    loadRankingLiked(newItem.songs);
    toast.success("已添加", newItem.name);
  } catch (e) {
    log.warn("recommend-view", `custom ranking ${id} failed`, { error: String(e) });
    // 加载失败，删除占位项
    const idx = rankings.value.findIndex(r => r.id === id);
    if (idx >= 0) rankings.value.splice(idx, 1);
    toast.error("加载失败", "请检查歌单 ID 是否正确");
  }
}

/** 删除榜单（在编辑模式下使用） */
function removeRanking(idx: number) {
  const removed = rankings.value[idx];
  rankings.value.splice(idx, 1);
  saveCustomRankings(rankings.value.map(r => ({ id: r.id, name: r.name })));
  toast.success("已删除", removed.name);
}

/** 加载单个榜单数据 - 始终使用 API 返回的歌单名称 */
async function loadRankingData(r: RankingItem) {
  try {
    const res = await playlistDetail(r.id, 0);
    // 始终用 API 返回的真实歌单名称覆盖（用户不可自定义重命名）
    if (res.playlist?.name) {
      r.name = res.playlist.name;
      saveCustomRankings(rankings.value.map(rr => ({ id: rr.id, name: rr.name })));
    }
    r.coverImgUrl = res.playlist?.coverImgUrl || "";
    const tracks = (res.playlist?.tracks || []).slice(0, 5);
    r.songs = tracks.map(neteaseSongToSong);
    r.loading = false;
    log.info("recommend-view", `ranking ${r.name} loaded`, { count: r.songs.length });
    loadRankingLiked(r.songs);
  } catch (e) {
    log.warn("recommend-view", `ranking ${r.name} failed`, { error: String(e) });
    r.loading = false;
  }
}

async function loadData() {
  loading.value = true;
  if (getCookie()) {
    // 每日推荐歌曲（/recommend/songs）
    try {
      const sres = await recommendSongs();
      const dailySongs = sres.data?.dailySongs || [];
      dailyRecommendSongs.value = dailySongs.slice(0, 30).map(neteaseSongToSong);
      log.info("recommend-view", "daily songs loaded", { count: dailyRecommendSongs.value.length });
    } catch (e) { log.warn("recommend-view", "load daily songs failed", { error: String(e) }); }

    // 推荐资源（/recommend/resource）—— 返回推荐歌单列表
    // 私人漫游：从第一个推荐歌单获取歌曲
    try {
      const res = await recommendResource();
      const recPlaylists = res.recommend || res.data || [];
      log.info("recommend-view", "recommend resource loaded", { count: recPlaylists.length, firstPl: recPlaylists[0]?.name });
      if (recPlaylists.length > 0 && recPlaylists[0].id) {
        const firstPl = recPlaylists[0];
        const { playlistTrackAll } = await import("@/api/netease");
        const detail = await playlistTrackAll(firstPl.id, 0, 30);
        personalRoamSongs.value = (detail.songs || []).map(neteaseSongToSong);
        log.info("recommend-view", "personal roam songs loaded from first playlist", { plName: firstPl.name, count: personalRoamSongs.value.length });
      }
    } catch (e) { log.warn("recommend-view", "load recommend resource failed", { error: String(e) }); }
  }

  // 私人雷达封面（固定歌单 ID 3136952023）
  playlistDetail(3136952023, 1).then(res => {
    personalRadarCover.value = res.playlist?.coverImgUrl || "";
    personalRadarName.value = res.playlist?.name || "";
    const firstTrack = res.playlist?.tracks?.[0];
    personalRadarFirstSong.value = firstTrack?.name || "";
  }).catch(e => { log.warn("recommend-view", "personal radar failed", { error: String(e) }); });

  loading.value = false;
  // 并行加载榜单（使用新的 loadRankingData 函数）
  for (const r of rankings.value) {
    loadRankingData(r);
  }
}

/** 播放每日推荐歌曲 */
function playDailyRecommend() {
  if (dailyRecommendSongs.value.length > 0) {
    store.setSourcePlaylistId(null);
    store.playList(dailyRecommendSongs.value, 0);
    toast.success("每日推荐", `开始播放 ${dailyRecommendSongs.value.length} 首推荐歌曲`);
  }
}

/** 播放私人漫游歌曲（单首播放，不感兴趣换歌） */
function playPersonalRoam() {
  if (personalRoamSongs.value.length > 0) {
    store.setSourcePlaylistId(null);
    store.isPersonalRoam = true;
    // 私人漫游只播放第一首
    store.queue = [personalRoamSongs.value[0]];
    store.currentIndex = 0;
    store.isPlaying = true;
    // 加载歌词和URL
    const s = store.currentSong;
    if (s && s.source === "netease" && s.neteaseId) {
      store._ensureNeteaseUrl(s);
      store._ensureNeteaseLyrics(s).then(() => {
        if (store.currentSong?.id === s.id) store.loadLyrics(s);
      });
    }
    toast.success("私人漫游", "开始播放推荐歌曲");
  }
}

/** 不感兴趣（/recommend/songs/dislike） */
async function dislikeSong(song: Song) {
  if (!song.neteaseId) return;
  try {
    const { apiGet } = await import("@/api/netease/core");
    const res = await apiGet<{ code: number; data?: any }>("/recommend/songs/dislike", { id: song.neteaseId });
    if (res.code === 200) {
      // 从每日推荐列表移除
      dailyRecommendSongs.value = dailyRecommendSongs.value.filter(s => s.id !== song.id);
      // 如果返回新歌曲，添加到列表末尾
      if (res.data?.id) {
        const newSong = neteaseSongToSong(res.data as any);
        dailyRecommendSongs.value.push(newSong);
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

/** 打开每日推荐详情页（不直接播放） */
function openDailyRecommend() {
  if (!dailyRecommendSongs.value.length) return;
  store.pendingPlaylistId = -1;
  store.setView("netease");
}

/** 打开私人漫游详情页（不直接播放） */
function openPersonalRoam() {
  if (!personalRoamSongs.value.length) return;
  store.pendingPlaylistId = -3;
  store.setView("netease");
}

/** 播放私人雷达歌单（点击封面播放按钮时调用） */
async function playPersonalRadarPlaylist() {
  try {
    const res = await playlistDetail(3136952023, 0);
    const trackIds = res.playlist?.trackIds || [];
    if (!trackIds.length) { toast.error("播放失败", "私人雷达歌单为空"); return; }
    const ids = trackIds.slice(0, 100).map(t => t.id);
    const { playlistTrackAll } = await import("@/api/netease");
    const detail = await playlistTrackAll(3136952023, 0, ids.length);
    const songs = (detail.songs || []).map(neteaseSongToSong);
    if (songs.length) {
      store.setSourcePlaylistId(3136952023);
      store.playList(songs, 0);
      toast.success("私人雷达", `开始播放 ${songs.length} 首歌曲`);
    }
  } catch (e) {
    log.warn("recommend-view", "play personal radar failed", { error: String(e) });
    toast.error("播放失败", "请稍后重试");
  }
}

function playSong(song: Song) {
  store.playNow(song);
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

/** 行内按钮：喜欢状态集合（neteaseId → liked） */
const songLikedSet = ref<Set<number>>(new Set());

/** 加载喜欢状态（用于榜单歌曲） */
async function loadRankingLiked(songs: Song[]) {
  if (songs.length === 0) return;
  try {
    const likeSet = await getCachedLikeList();
    const liked = new Set<number>();
    for (const s of songs) {
      if (s.neteaseId && likeSet.has(s.neteaseId)) liked.add(s.neteaseId);
    }
    // 合并到现有集合
    const merged = new Set(songLikedSet.value);
    for (const id of liked) merged.add(id);
    songLikedSet.value = merged;
  } catch { /* ignore */ }
}

/** 行内：切换单首歌曲喜欢状态 */
async function toggleSongLike(song: Song) {
  if (song.source !== "netease" || !song.neteaseId) return;
  const liked = songLikedSet.value.has(song.neteaseId);
  try {
    await songLike(song.neteaseId, 0, !liked);
    if (!liked) { songLikedSet.value.add(song.neteaseId); addLikeCache(song.neteaseId); }
    else { songLikedSet.value.delete(song.neteaseId); removeLikeCache(song.neteaseId); }
    songLikedSet.value = new Set(songLikedSet.value);
    toast.success(liked ? "已取消喜欢" : "已喜欢", song.name);
  } catch (e) {
    log.warn("recommend", "toggle song like failed", { error: String(e) });
    toast.error("操作失败", "请稍后重试");
  }
}

/** 行内：打开添加到歌单对话框（复用右键菜单的对话框） */
function openAddToPlaylistDialogForRow(song: Song) {
  if (song.source !== "netease") return;
  addToPlaylistDialog.value = { visible: true, song };
  getCachedPlaylists().then(pls => { playlists.value = pls; });
}

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

// 程序启动时加载一次，之后切换页面不再刷新（退出程序重新进入才刷新）
let hasLoaded = false;

onMounted(() => {
  document.addEventListener("click", onDocClick);
  if (!hasLoaded) {
    loadData();
    hasLoaded = true;
  }
});
onUnmounted(() => { document.removeEventListener("click", onDocClick); });
</script>

<template>
  <section class="recommend-view nice-scroll">
    <!-- 顶部入口卡片：每日推荐 / 私人漫游 / 私人雷达 -->
    <div class="entry-cards">
      <!-- 每日推荐 = /recommend/songs 每日推荐歌曲 -->
      <div class="entry-card" :class="{ disabled: !dailyRecommendSongs.length }">
        <div class="entry-cover daily-cover" @click="openDailyRecommend">
          <img v-if="dailyCoverUrl" :src="dailyCoverUrl" alt="每日推荐" referrerpolicy="no-referrer" loading="lazy" />
          <div v-else class="entry-date">{{ new Date().getDate() }}</div>
          <button class="entry-play-btn" title="播放每日推荐" @click.stop="playDailyRecommend" :disabled="!dailyRecommendSongs.length">
            <Icon name="play" :size="20" />
          </button>
        </div>
        <div class="entry-name" @click="openDailyRecommend">每日推荐</div>
        <div class="entry-sub" @click="openDailyRecommend">{{ dailySubText }}</div>
      </div>

      <!-- 私人漫游 = /recommend/resource 推荐歌曲 -->
      <div class="entry-card" :class="{ disabled: !personalRoamSongs.length }">
        <div class="entry-cover roam-cover" @click="openPersonalRoam">
          <Icon name="shuffle" :size="28" />
          <button class="entry-play-btn" title="播放私人漫游" @click.stop="playPersonalRoam" :disabled="!personalRoamSongs.length">
            <Icon name="play" :size="20" />
          </button>
        </div>
        <div class="entry-name" @click="openPersonalRoam">私人漫游</div>
        <div class="entry-sub" @click="openPersonalRoam">{{ personalRoamSongs.length }} 首推荐歌曲</div>
      </div>

      <!-- 私人雷达 = 固定歌单 ID 3136952023 -->
      <div class="entry-card">
        <div class="entry-cover radar-cover" @click="openPersonalRadar">
          <img v-if="personalRadarCover" :src="personalRadarCover + '?param=200x200'" alt="私人雷达" referrerpolicy="no-referrer" loading="lazy" />
          <Icon v-else name="radio" :size="28" />
          <button class="entry-play-btn" title="播放私人雷达" @click.stop="playPersonalRadarPlaylist">
            <Icon name="play" :size="20" />
          </button>
        </div>
        <div class="entry-name" @click="openPersonalRadar">私人雷达</div>
        <div class="entry-sub" @click="openPersonalRadar">{{ radarSubText }}</div>
      </div>
    </div>

    <!-- 每日推荐歌曲列表（带不感兴趣按钮） -->
    <div v-if="dailyRecommendSongs.length" class="section">
      <div class="roam-header">
        <h2 class="section-title">每日推荐</h2>
        <button class="roam-play-all" @click="playDailyRecommend">
          <Icon name="play" :size="14" /><span>播放全部</span>
        </button>
      </div>
      <div class="roam-list">
        <div v-for="(song, idx) in dailyRecommendSongs.slice(0, 10)" :key="song.id"
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
      <div class="ranking-section-header">
        <h2 class="section-title">榜单精选</h2>
        <span class="ranking-count-hint">{{ rankings.length }} / {{ MAX_RANKINGS }}</span>
        <!-- 编辑图标按钮（点击进入/退出编辑模式） -->
        <button class="ranking-edit-toggle" :class="{ active: editMode }" :title="editMode ? '完成编辑' : '编辑榜单'" @click="editMode = !editMode">
          <img src="/icons/edit.svg" alt="edit" class="ranking-edit-icon" />
        </button>
      </div>
      <div class="ranking-grid">
        <div v-for="(r, ridx) in rankings" :key="r.id" class="ranking-card" :class="{ 'ranking-card-editing': editMode }">
          <div class="ranking-header" @click="!editMode && openRanking(r.id)" :style="{ cursor: editMode ? 'default' : 'pointer' }">
            <div class="ranking-cover">
              <img v-if="r.coverImgUrl" :src="r.coverImgUrl + '?param=100x100'" :alt="r.name" referrerpolicy="no-referrer" loading="lazy" />
              <Icon v-else name="music" :size="20" />
            </div>
            <div class="ranking-name truncate">{{ r.name }}</div>
            <Icon v-if="!editMode" name="chevronRight" :size="16" class="ranking-arrow" />
            <!-- 编辑模式下显示删除按钮 -->
            <button v-if="editMode" class="ranking-delete-btn" title="删除榜单" @click.stop="removeRanking(ridx)">
              <Icon name="trash" :size="16" />
            </button>
          </div>
          <div v-if="r.loading" class="ranking-loading"><div class="spinner-sm" /></div>
          <div v-else class="ranking-songs">
            <div v-for="(song, idx) in r.songs" :key="song.id"
              class="ranking-song" :class="{ active: song.id === store.currentSong?.id }"
              @click="playSong(song)"
              @contextmenu="onContextMenu($event, song)">
              <span class="ranking-idx">{{ idx + 1 }}</span>
              <span class="ranking-song-name truncate">{{ song.name }}</span>
              <span class="ranking-artist truncate">{{ song.artist }}</span>
              <div v-if="song.source === 'netease'" class="nmn-row-actions ranking-actions" :class="{ 'has-liked': song.neteaseId && songLikedSet.has(song.neteaseId) }">
                <button class="nmn-action-btn nmn-action-like"
                  :class="{ liked: song.neteaseId && songLikedSet.has(song.neteaseId) }"
                  :title="song.neteaseId && songLikedSet.has(song.neteaseId) ? '取消喜欢' : '喜欢'"
                  @click.stop="toggleSongLike(song)">
                  <img v-if="song.neteaseId && songLikedSet.has(song.neteaseId)" src="/icons/like.svg" alt="liked" class="nmn-action-icon" />
                  <img v-else src="/icons/not_like.svg" alt="not liked" class="nmn-action-icon" />
                </button>
                <button class="nmn-action-btn nmn-action-playlist" title="添加至歌单" @click.stop="openAddToPlaylistDialogForRow(song)">
                  <img src="/icons/add_playlist.svg" alt="add to playlist" class="nmn-action-icon" />
                </button>
                <button class="nmn-action-btn nmn-action-next" title="下一首播放" @click.stop="store.playNext(song)">
                  <Icon name="next" :size="15" />
                </button>
              </div>
            </div>
          </div>
        </div>
        <!-- 添加榜单卡片（+号，仅在编辑模式且未达上限时显示） -->
        <button v-if="editMode && rankings.length < MAX_RANKINGS" class="ranking-add-card" @click="showAddRankingDialog = true">
          <Icon name="plus" :size="32" />
          <span>添加榜单</span>
        </button>
      </div>
    </div>

    <!-- 添加榜单对话框（只能用右上角 close 图标关闭，不能点击背景关闭） -->
    <Transition name="pl-dialog-fade">
      <div v-if="showAddRankingDialog" class="pl-dialog-overlay">
        <div class="add-ranking-dialog">
          <div class="pl-dialog-header">
            <h3>添加榜单</h3>
            <button class="pl-dialog-close" title="关闭" @click="showAddRankingDialog = false">
              <img src="/icons/close.svg" alt="close" class="pl-dialog-close-icon" />
            </button>
          </div>
          <div class="add-ranking-body nice-scroll">
            <!-- 预设榜单 -->
            <div v-if="availablePresets.length > 0" class="add-ranking-section">
              <div class="add-ranking-section-title">预设榜单</div>
              <div class="add-ranking-presets">
                <button v-for="p in availablePresets" :key="p.id"
                  class="add-ranking-preset-item"
                  @click="addRanking(p.id)">
                  <Icon name="plus" :size="12" />
                  <span class="truncate">{{ p.name }}</span>
                </button>
              </div>
            </div>
            <!-- 自定义 ID 添加 -->
            <div class="add-ranking-section">
              <div class="add-ranking-section-title">自定义歌单 ID</div>
              <div class="add-ranking-custom">
                <input class="add-ranking-input" v-model="customRankingIdInput" placeholder="输入网易云歌单 ID（数字）" type="text" @keyup.enter="addCustomRankingById" />
                <button class="add-ranking-submit" @click="addCustomRankingById">
                  <Icon name="plus" :size="14" /><span>添加</span>
                </button>
              </div>
              <p class="add-ranking-hint">歌单名称将自动从网易云获取。歌单 ID 可在网易云网页版歌单 URL 中找到，如 https://music.163.com/#/playlist?id=<strong>19723756</strong></p>
            </div>
          </div>
        </div>
      </div>
    </Transition>

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
  cursor: pointer;
}
.entry-card:hover { transform: translateY(-3px); }
.entry-card.disabled { opacity: 0.5; cursor: not-allowed; }
.entry-card.disabled:hover { transform: none; }
.entry-cover {
  position: relative; aspect-ratio: 1; border-radius: var(--radius);
  overflow: hidden; background: var(--bg-elev-3);
  display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); box-shadow: var(--shadow-sm);
  cursor: pointer;
}
.entry-cover img { width: 100%; height: 100%; object-fit: cover; }
.entry-play-btn {
  position: absolute; bottom: 8px; right: 8px;
  width: 36px; height: 36px; border-radius: 50%;
  background: rgba(0, 0, 0, 0.6); color: #fff;
  display: flex; align-items: center; justify-content: center;
  transition: transform 0.2s var(--ease-out), background 0.2s var(--ease-out);
  backdrop-filter: blur(4px); z-index: 3; cursor: pointer;
}
.entry-play-btn:hover { transform: scale(1.12); background: rgba(0, 0, 0, 0.8); }
.entry-play-btn:active { transform: scale(0.95); }
.entry-play-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.entry-play-btn :deep(.icon-svg) { margin-left: 2px; pointer-events: none; }
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
.ranking-section-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.ranking-count-hint { font-size: 12px; color: var(--text-tertiary); font-weight: 500; }
/* 编辑图标按钮（标题右侧） */
.ranking-edit-toggle {
  margin-left: auto;
  width: 28px; height: 28px;
  border-radius: var(--radius-sm);
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.15s;
  padding: 0;
}
.ranking-edit-toggle:hover { color: var(--accent); background: var(--bg-hover); }
.ranking-edit-toggle.active { color: var(--accent); background: var(--accent-soft); }
.ranking-edit-icon { width: 16px; height: 16px; pointer-events: none; display: block; }
.ranking-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.ranking-card { background: var(--bg-elev-1); border-radius: var(--radius); padding: 16px; border: 1px solid var(--border); transition: border-color 0.15s; }
.ranking-card-editing { border-color: var(--accent); }
.ranking-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; position: relative; }
.ranking-cover { width: 48px; height: 48px; border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; background: var(--bg-elev-3); display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); }
.ranking-cover img { width: 100%; height: 100%; object-fit: cover; }
.ranking-name { font-size: 16px; font-weight: 700; color: var(--text); flex: 1; min-width: 0; }
.ranking-arrow { color: var(--text-tertiary); flex-shrink: 0; }
/* 编辑模式下的删除按钮 */
.ranking-delete-btn {
  width: 28px; height: 28px;
  border-radius: var(--radius-sm);
  display: inline-flex; align-items: center; justify-content: center;
  color: #ff4d4f;
  background: rgba(255,77,79,0.1);
  border: 1px solid rgba(255,77,79,0.3);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}
.ranking-delete-btn:hover {
  background: #ff4d4f;
  color: #fff;
  border-color: #ff4d4f;
}

/* 添加榜单卡片（+号） */
.ranking-add-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 200px;
  background: transparent;
  border: 2px dashed var(--border-strong);
  border-radius: var(--radius);
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s var(--ease-out);
  padding: 24px;
}
.ranking-add-card:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}
.ranking-add-card .icon-svg { width: 32px; height: 32px; }

/* 添加榜单对话框 */
.add-ranking-dialog {
  width: 480px; max-width: 92vw; max-height: 70vh;
  background: var(--bg-elev-3); border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-lg);
  display: flex; flex-direction: column; overflow: hidden;
}
.add-ranking-body { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 20px; }
.add-ranking-section { display: flex; flex-direction: column; gap: 10px; }
.add-ranking-section-title {
  font-size: 12px; font-weight: 600; color: var(--text-tertiary);
  text-transform: uppercase; letter-spacing: 0.4px;
}
.add-ranking-presets {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px;
}
.add-ranking-preset-item {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px;
  background: var(--bg-elev-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px; color: var(--text-secondary);
  transition: all 0.15s;
  text-align: left;
  cursor: pointer;
}
.add-ranking-preset-item:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.add-ranking-preset-item .icon-svg { width: 12px; height: 12px; flex-shrink: 0; }
.add-ranking-custom { display: flex; flex-direction: column; gap: 8px; }
.add-ranking-input {
  width: 100%; height: 38px; padding: 0 12px;
  background: var(--bg-elev-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px; color: var(--text);
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.add-ranking-input:focus { border-color: var(--accent); }
.add-ranking-input::placeholder { color: var(--text-tertiary); }
.add-ranking-submit {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 38px;
  background: var(--accent); color: #fff;
  border-radius: var(--radius-sm);
  font-size: 13px; font-weight: 600;
  border: none; cursor: pointer;
  transition: opacity 0.15s;
}
.add-ranking-submit:hover { opacity: 0.9; }
.add-ranking-hint {
  margin: 0; font-size: 11px; color: var(--text-tertiary); line-height: 1.5;
}
.add-ranking-hint strong { color: var(--accent); font-weight: 600; }
.ranking-header:hover .ranking-arrow { color: var(--accent); }
.ranking-loading { display: flex; justify-content: center; padding: 12px; }
.ranking-songs { display: flex; flex-direction: column; gap: 2px; }
.ranking-song { position: relative; display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--radius-sm); text-align: left; transition: background 0.15s; }
.ranking-song:hover { background: var(--bg-hover); }
.ranking-song.active { color: var(--accent); background: var(--accent-soft); }
.ranking-idx { width: 20px; text-align: center; font-size: 13px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.ranking-song.active .ranking-idx { color: var(--accent); }
.ranking-song-name { flex: 1; min-width: 0; font-size: 13px; color: var(--text); }
.ranking-artist { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; max-width: 100px; }
/* 操作按钮层：仅 hover 时显示，无独立背景（与行 hover 背景融为一体，无割裂） */
.ranking-actions {
  position: absolute; right: 0; top: 0; bottom: 0;
  display: none !important;
  align-items: center; gap: 2px;
  background: transparent !important;
  padding: 0 6px 0 8px;
  z-index: 2;
}
.ranking-song .ranking-actions .nmn-action-btn {
  opacity: 0 !important;
}
.ranking-song:hover .ranking-actions {
  display: flex !important;
}
.ranking-song:hover .ranking-actions .nmn-action-btn {
  opacity: 0.7 !important;
}
.ranking-song:hover .ranking-actions .nmn-action-btn.liked {
  opacity: 1 !important;
}
/* hover 时隐藏歌手名，避免与按钮层重叠 */
.ranking-song:hover .ranking-artist { opacity: 0 !important; }

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
.pl-dialog-close {
  width: 32px; height: 32px;
  border-radius: var(--radius-sm);
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.15s;
  padding: 0;
}
.pl-dialog-close:hover { color: var(--text); background: var(--bg-hover); }
.pl-dialog-close-icon { width: 18px; height: 18px; pointer-events: none; display: block; }
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
body.has-wallpaper .ranking-song .ranking-actions {
  display: none !important;
}
body.has-wallpaper .ranking-song:hover .ranking-actions {
  display: flex !important;
}
body.has-wallpaper .ranking-song .ranking-actions .nmn-action-btn {
  opacity: 0 !important;
}
body.has-wallpaper .ranking-song:hover .ranking-actions .nmn-action-btn {
  opacity: 0.7 !important;
}
body.has-wallpaper .ranking-song:hover .ranking-actions .nmn-action-btn.liked {
  opacity: 1 !important;
}
</style>
