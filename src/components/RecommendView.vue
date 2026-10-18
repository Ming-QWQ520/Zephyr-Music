<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { usePlayerStore } from "@/stores/player";
import {
  recommendResource, recommendSongs, playlistDetail, playlistTrackAll, neteaseSongToSong, getCookie,
  getCachedLikeList, addLikeCache, removeLikeCache, songLike, getCachedUser,
  playlistTracks, getCachedPlaylists, personalizedPlaylists, songDetail, _cachedUser,
  personalizedNewSong, homepageBlockPage,
  type NeteasePlaylist,
} from "@/api/netease";
import { apiGet } from "@/api/netease/core";
import { log } from "@/composables/logger";
import { useToast } from "@/composables/useToast";
import { storeGetSync, storeSetSync } from "@/composables/useStore";
import { formatCount } from "@/utils/format";
const toast = useToast();
import Icon from "@/components/Icon.vue";
import SongBadge from "@/components/SongBadge.vue";
import type { Song } from "@/types";

const store = usePlayerStore();

const recommendPlaylists = ref<NeteasePlaylist[]>([]);
const loading = ref(true);

// 新歌速递
const newSongs = ref<Song[]>([]);
const newSongsLoading = ref(false);

// 热搜列表
interface HotSearchItem { searchWord: string; score: number; content?: string; iconType?: number; iconUrl?: string; url?: string; alg?: string }
const hotSearchList = ref<HotSearchItem[]>([]);
const hotSearchLoading = ref(false);

/** 区块懒加载：滚动到距视口 400px 内时触发一次加载回调（IntersectionObserver）。
 *  环境不支持时直接同步触发。KeepAlive 缓存下 observer 只在首次挂载时建立。 */
function useLazySection(load: () => void) {
  const el = ref<HTMLElement | null>(null);
  let ob: IntersectionObserver | null = null;
  onMounted(() => {
    if (typeof IntersectionObserver === "undefined") { load(); return; }
    ob = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) {
        ob?.disconnect();
        ob = null;
        load();
      }
    }, { rootMargin: "400px 0px" });
    if (el.value) ob.observe(el.value);
    else load();
  });
  onUnmounted(() => { ob?.disconnect(); ob = null; });
  return el;
}

// 推荐新音乐（/personalized/newsong）
const newMusicSongs = ref<Song[]>([]);
const newMusicLoading = ref(false);

const recommendPlaylistsRowRef = ref<HTMLElement | null>(null);
const newMusicRowRef = ref<HTMLElement | null>(null);

/** 鼠标滚轮上下滚动时，横向平滑滑动横排列表（与个人主页“我的歌单”一致） */
function wheelToHorizontal(e: WheelEvent, el: HTMLElement | null) {
  if (!el) return;
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    e.preventDefault();
    // 速度倍数：滚轮 delta × 1.8，滚动更顺滑
    const delta = e.deltaY * 1.8;
    el.scrollTo({ left: el.scrollLeft + delta, behavior: "smooth" });
  }
}
function onRecommendPlaylistsWheel(e: WheelEvent) { wheelToHorizontal(e, recommendPlaylistsRowRef.value); }
function onNewMusicWheel(e: WheelEvent) { wheelToHorizontal(e, newMusicRowRef.value); }

// 顶部入口卡片
// 每日推荐 = /recommend/songs（每日推荐歌曲，播放+不感兴趣）
const dailyRecommendSongs = ref<Song[]>([]);
// 私人漫游 = /personal_fm 流式推荐（点击即开始漫游，无需预加载）
const roamStarting = ref(false);
// 私人雷达 = 固定歌单 ID 3136952023
const personalRadarCover = ref("");
const personalRadarName = ref("");
const personalRadarFirstSong = ref("");

/** 是否已登录（漫游/每日推荐需要登录） */
const isLoggedIn = computed(() => !!_cachedUser.value || !!getCookie());

const dailyFirstSong = computed(() => dailyRecommendSongs.value[0] || null);
const dailyCoverUrl = computed(() => dailyFirstSong.value?.pic || "");
const radarSubText = computed(() => {
  const name = personalRadarFirstSong.value;
  return name ? `从[${name}]听起` : (personalRadarName.value || '为你打造的歌单');
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

/** 加载推荐新音乐（/personalized/newsong，懒加载区块） */
async function loadNewMusic() {
  if (newMusicSongs.value.length || newMusicLoading.value) return;
  newMusicLoading.value = true;
  try {
    const res = await personalizedNewSong(12);
    const songs = (res.result || []).map((item: any) => {
      const s = neteaseSongToSong(item.song || item);
      if (!s.pic && item.picUrl) s.pic = item.picUrl;
      return s;
    });
    newMusicSongs.value = songs;
    log.info("recommend-view", "new music loaded", { count: songs.length });
    enrichSongBadges(songs);
  } catch (e) {
    log.warn("recommend-view", "load new music failed", { error: String(e) });
  } finally {
    newMusicLoading.value = false;
  }
}

/** 加载新歌速递（/top/song?type=0，懒加载区块） */
async function loadNewSongs() {
  if (newSongs.value.length || newSongsLoading.value) return;
  newSongsLoading.value = true;
  try {
    const res = await apiGet<{ code: number; data?: any[]; result?: any[] }>('/top/song', { type: 0 });
    const list = res.data || res.result || [];
    newSongs.value = list.slice(0, 12).map((s: any) => neteaseSongToSong(s));
    log.info('recommend-view', 'new songs loaded', { count: newSongs.value.length });
    enrichSongBadges(newSongs.value);
  } catch (e) {
    log.warn('recommend-view', 'load new songs failed', { error: String(e) });
  } finally {
    newSongsLoading.value = false;
  }
}

/** 用 /song/detail 批量补充歌曲标识信息（fee/mark/音质）
 *  列表 API 可能返回 mark=0（默认值），需通过 songDetail 重新获取。 */
async function enrichSongBadges(songs: Song[]) {
  const needBadge = songs.filter(s => (s.fee === undefined || s.mark === undefined || s.mark === 0) && s.neteaseId);
  if (needBadge.length === 0) return;
  try {
    const batchSize = 500;
    for (let i = 0; i < needBadge.length; i += batchSize) {
      const batch = needBadge.slice(i, i + batchSize);
      const detailRes = await songDetail(batch.map(s => s.neteaseId!));
      for (const ds of (detailRes.songs || [])) {
        const song = songs.find(s => s.neteaseId === ds.id);
        if (song) {
          if (ds.fee !== undefined) song.fee = ds.fee;
          if (ds.mark !== undefined) song.mark = ds.mark;
          if (ds.hr) song.hasHires = true;
          if (ds.sq) song.hasSq = true;
          if ((ds as any).privilege?.maxBrLevel) song.maxBrLevel = (ds as any).privilege.maxBrLevel;
        }
      }
    }
    log.info("recommend-view", "song badges enriched", { count: needBadge.length });
  } catch (e) {
    log.warn("recommend-view", "enrich song badges failed", { error: String(e) });
  }
}

/** 加载热搜列表（/search/hot/detail） */
async function loadHotSearch() {
  hotSearchLoading.value = true;
  try {
    const res = await apiGet<{ code: number; data?: HotSearchItem[]; result?: { hots?: HotSearchItem[] } }>('/search/hot/detail');
    const list = res.data || res.result?.hots || [];
    hotSearchList.value = list.slice(0, 20);
    log.info('recommend-view', 'hot search loaded', { count: hotSearchList.value.length });
  } catch (e) {
    log.warn('recommend-view', 'load hot search failed', { error: String(e) });
  } finally {
    hotSearchLoading.value = false;
  }
}

/** 点击热搜项 → 跳转搜索 */
function searchHotWord(word: string) {
  store.searchKeyword = word;
  store.setView('search');
}

// ===== 雷达歌单卡片（/homepage/block/page 的 MGC 雷达歌单第一个，如“时光雷达”，随账号个性化） =====
const radarPlaylistCard = ref<{ id: number; cover: string } | null>(null);
const radarCardLoading = ref(false);
const entryCardsRowRef = ref<HTMLElement | null>(null);

function onEntryCardsWheel(e: WheelEvent) { wheelToHorizontal(e, entryCardsRowRef.value); }

/** 只取雷达歌单 block 的第一张卡（时光雷达等），作为顶部“雷达歌单”入口 */
async function loadRadarPlaylistCard() {
  try {
    const r = await homepageBlockPage();
    const mgc = (r.blocks || []).find(b => b?.blockCode === "HOMEPAGE_BLOCK_MGC_PLAYLIST");
    const res = ((mgc?.creatives || [])[0]?.resources || [])[0];
    const id = Number(res?.resourceId || 0);
    const cover = String(res?.uiElement?.image?.imageUrl || "").replace(/^http:/, "https:");
    radarPlaylistCard.value = id && cover ? { id, cover } : null;
    log.info("recommend-view", "radar playlist card loaded", { id });
  } catch (e) {
    log.warn("recommend-view", "radar playlist card failed", { error: String(e) });
  }
}

/** 播放雷达歌单（整表播放，与私人雷达同链路：trackIds → /playlist/track/all 前 100 首） */
async function playRadarPlaylistCard() {
  const card = radarPlaylistCard.value;
  if (!card || radarCardLoading.value) return;
  radarCardLoading.value = true;
  try {
    const res = await playlistDetail(card.id, 0);
    const trackIds = res.playlist?.trackIds || [];
    if (!trackIds.length) { toast.error("播放失败", "歌单为空"); return; }
    const ids = trackIds.slice(0, 100).map(t => t.id);
    const detail = await playlistTrackAll(card.id, 0, ids.length);
    const songs = (detail.songs || []).map(neteaseSongToSong);
    if (songs.length) {
      store.setSourcePlaylistId(card.id);
      store.playList(songs, 0);
      toast.success("雷达歌单", `开始播放 ${songs.length} 首歌曲`);
    }
  } catch (e) {
    log.warn("recommend-view", "play radar playlist card failed", { error: String(e) });
    toast.error("播放失败", "请稍后重试");
  } finally {
    radarCardLoading.value = false;
  }
}

// ===== 心动模式 / 相似歌曲（官方 /playmode/intelligence/list 优先，服务端异常时本地构建队列） =====
const heartbeatStarting = ref(false);
const simiStarting = ref(false);

/** “我喜欢的音乐”歌单 id（pid），兜底用 userId */
async function getLikePlaylistPid(userId: number | undefined): Promise<number> {
  try {
    const pls = await getCachedPlaylists();
    const mine = pls.find(pl => pl.creator?.userId != null && pl.creator.userId === userId) || pls[0];
    if (mine) return mine.id;
  } catch { /* 兜底 pid = userId */ }
  return userId ?? 0;
}

/**
 * 智能推荐队列：优先官方智能播放接口（服务端修复后自动恢复最优体验）。
 * api-enhanced 的 /playmode/intelligence/list 当前返回 HTTP 500（实测各参数组合均如此），
 * 此时降级为本地构建：最近红心前 15 首 + 每日推荐前 20 首，去重后 seed 置顶、其余洗牌。
 */
async function buildSmartQueue(seedSongId: number, pid: number): Promise<Song[]> {
  try {
    const res = await apiGet<{ code: number; data?: any[] }>("/playmode/intelligence/list", { songId: seedSongId, pid });
    const songs = (res.data || [])
      .map((d: any) => (d.songInfo ? neteaseSongToSong(d.songInfo) : null))
      .filter((s: Song | null): s is Song => !!s);
    if (songs.length >= 5) return songs;
    log.warn("recommend-view", "intelligence list returned too few songs, fallback", { count: songs.length });
  } catch (e) {
    log.warn("recommend-view", "intelligence list failed, fallback to local queue", { error: String(e) });
  }
  const parts: Song[] = [];
  // 最近红心前 15 首（喜欢列表最新在前，第一首即 seed）
  try {
    const likeSet = await getCachedLikeList();
    const ids = [...likeSet].slice(0, 15);
    if (ids.length) {
      const detail = await songDetail(ids);
      parts.push(...(detail.songs || []).map(neteaseSongToSong));
    }
  } catch (e) { log.warn("recommend-view", "like songs for smart queue failed", { error: String(e) }); }
  // 每日推荐前 20 首补充（同口味个性化相似推荐）
  try {
    const rec = await recommendSongs();
    parts.push(...(rec.data?.dailySongs || []).slice(0, 20).map(neteaseSongToSong));
  } catch (e) { log.warn("recommend-view", "daily songs for smart queue failed", { error: String(e) }); }
  // seed 置顶 + neteaseId 去重 + 其余洗牌
  const seen = new Set<number>();
  const head: Song[] = [], tail: Song[] = [];
  for (const sg of parts) {
    const nid = sg.neteaseId;
    if (nid == null || seen.has(nid)) continue;
    seen.add(nid);
    (head.length === 0 ? head : tail).push(sg);
  }
  for (let i = tail.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tail[i], tail[j]] = [tail[j], tail[i]];
  }
  return [...head, ...tail];
}

async function playHeartbeatMode() {
  if (!isLoggedIn.value) { toast.error("请先登录", "心动模式需要登录网易云账号"); return; }
  if (heartbeatStarting.value) return;
  heartbeatStarting.value = true;
  try {
    const user = _cachedUser.value ?? await getCachedUser();
    const pid = await getLikePlaylistPid(user?.userId);
    const likeSet = await getCachedLikeList();
    const seedSongId = likeSet.values().next().value as number | undefined;
    if (!seedSongId) { toast.info("暂无喜欢的歌曲", "先喜欢几首歌，再开启心动模式"); return; }
    const songs = await buildSmartQueue(seedSongId, pid);
    if (!songs.length) { toast.error("心动模式开启失败", "未获取到推荐歌曲，请稍后重试"); return; }
    store.setSourcePlaylistId(null);
    store.playList(songs, 0);
    log.info("recommend-view", "heartbeat mode started", { count: songs.length, seedSongId, pid });
    toast.success("心动模式", `红心歌曲和相似推荐（${songs.length} 首）`);
  } catch (e) {
    log.warn("recommend-view", "heartbeat mode failed", { error: String(e) });
    toast.error("心动模式开启失败", "请稍后重试");
  } finally {
    heartbeatStarting.value = false;
  }
}

/** 相似歌曲：从最近喜欢的歌开始智能推荐（与心动模式共用智能队列） */
async function playSimilarSongs() {
  if (!isLoggedIn.value) { toast.error("请先登录", "相似歌曲需要登录网易云账号"); return; }
  if (simiStarting.value) return;
  simiStarting.value = true;
  try {
    const user = _cachedUser.value ?? await getCachedUser();
    const pid = await getLikePlaylistPid(user?.userId);
    const likeSet = await getCachedLikeList();
    const seedSongId = likeSet.values().next().value as number | undefined;
    if (!seedSongId) { toast.info("暂无喜欢的歌曲", "先喜欢几首歌，再听相似歌曲"); return; }
    const songs = await buildSmartQueue(seedSongId, pid);
    if (!songs.length) { toast.error("相似歌曲播放失败", "未获取到推荐歌曲，请稍后重试"); return; }
    store.setSourcePlaylistId(null);
    store.playList(songs, 0);
    log.info("recommend-view", "similar songs started", { count: songs.length, seedSongId, pid });
    toast.success("相似歌曲", `从你喜欢的歌听起（${songs.length} 首）`);
  } catch (e) {
    log.warn("recommend-view", "similar songs failed", { error: String(e) });
    toast.error("相似歌曲播放失败", "请稍后重试");
  } finally {
    simiStarting.value = false;
  }
}

/** 加载登录相关的个性化数据（每日推荐歌曲 + 推荐歌单）。
 *  登录状态变化时可单独重载，不必重复请求榜单/雷达。 */
async function loadPersonalizedData() {
  loading.value = true;
  if (getCookie()) {
    // 每日推荐歌曲（/recommend/songs）
    try {
      const sres = await recommendSongs();
      const dailySongs = sres.data?.dailySongs || [];
      dailyRecommendSongs.value = dailySongs.slice(0, 30).map(neteaseSongToSong);
      log.info("recommend-view", "daily songs loaded", { count: dailyRecommendSongs.value.length });
      enrichSongBadges(dailyRecommendSongs.value);
    } catch (e) { log.warn("recommend-view", "load daily songs failed", { error: String(e) }); }

    // 推荐歌单（/recommend/resource，每日更新的个性化推荐歌单）
    try {
      const res = await recommendResource();
      recommendPlaylists.value = res.recommend || res.data || [];
      log.info("recommend-view", "recommend playlists loaded", { count: recommendPlaylists.value.length });
    } catch (e) { log.warn("recommend-view", "load recommend resource failed", { error: String(e) }); }
  }

  // 未登录或个性化推荐为空：回退到 /personalized（无需登录的推荐歌单）
  if (recommendPlaylists.value.length === 0) {
    try {
      recommendPlaylists.value = await personalizedPlaylists(12);
      log.info("recommend-view", "personalized playlists loaded (fallback)", { count: recommendPlaylists.value.length });
    } catch (e) { log.warn("recommend-view", "load personalized failed", { error: String(e) }); }
  }
  loading.value = false;
}

/** 播放每日推荐歌曲 */
function playDailyRecommend() {
  if (dailyRecommendSongs.value.length > 0) {
    store.setSourcePlaylistId(null);
    store.playList(dailyRecommendSongs.value, 0);
    toast.success("每日推荐", `开始播放 ${dailyRecommendSongs.value.length} 首推荐歌曲`);
  }
}

/** 开始私人漫游（/personal_fm 流式推荐，同网易云 PC 端漫游）
 *  点击后拉取第一批推荐并播放，之后快到队尾会自动补充新歌。 */
async function playPersonalRoam() {
  if (!isLoggedIn.value) { toast.error("请先登录", "私人漫游需要登录网易云账号"); return; }
  if (roamStarting.value) return;
  roamStarting.value = true;
  try {
    const ok = await store.startPersonalRoam();
    if (ok) toast.success("私人漫游", "已开启，根据你的口味无限推荐");
    else toast.error("漫游开启失败", "获取推荐失败，请稍后重试");
  } finally {
    roamStarting.value = false;
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

/** 私人漫游没有"歌单详情页"（流式推荐），点击卡片即开始漫游 */
function openPersonalRoam() {
  playPersonalRoam();
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
  // 自适应弹出位置：rAF 后测量实际菜单尺寸并调整，确保不溢出屏幕
  requestAnimationFrame(() => {
    const els = document.querySelectorAll(".ctx-menu");
    const el = els[els.length - 1] as HTMLElement | null;
    if (!el) return;
    const mw = el.offsetWidth, mh = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let x = e.clientX, y = e.clientY;
    if (x + mw > vw - 8) x = vw - mw - 8;
    if (y + mh > vh - 8) y = vh - mh - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    contextMenu.value = { visible: true, x, y, song };
  });
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

// ===== 懒加载区块（IntersectionObserver，滚动到附近才发请求，降低启动时并发与内存占用） =====
// 首屏立即加载：入口卡片 + 顶部个性化推荐歌单卡片 + 个性推荐歌单 + 每日推荐数据（loadData）
// 懒加载：推荐新音乐 / 新歌速递 / 热搜榜 / 榜单精选（6 个 playlistDetail 重请求）
const newMusicSection = useLazySection(() => { void loadNewMusic(); });
const newSongsSection = useLazySection(() => { void loadNewSongs(); });
const hotSearchSection = useLazySection(() => { void loadHotSearch(); });
const rankingsSection = useLazySection(() => {
  for (const r of rankings.value) loadRankingData(r);
});

async function loadData() {
  const personalizedP = loadPersonalizedData();

  // 私人雷达封面（固定歌单 ID 3136952023，首屏入口卡片需要）
  playlistDetail(3136952023, 1).then(res => {
    personalRadarCover.value = res.playlist?.coverImgUrl || "";
    personalRadarName.value = res.playlist?.name || "";
  }).catch(e => { log.warn("recommend-view", "personal radar failed", { error: String(e) }); });
  // 第一首歌名：/playlist/detail 的 tracks 顺序不可靠（动态歌单下尤其明显），
  // 改用 /playlist/track/all 精确取第一首，与歌单页展示顺序一致
  playlistTrackAll(3136952023, 1, 0).then(detail => {
    personalRadarFirstSong.value = detail.songs?.[0]?.name || "";
  }).catch(e => { log.warn("recommend-view", "radar first song failed", { error: String(e) }); });

  // 雷达歌单卡片（/homepage/block/page 雷达歌单第一个，fire-and-forget）
  loadRadarPlaylistCard();

  // 其余区块（推荐新音乐/新歌速递/热搜榜/榜单精选）由懒加载触发，不再在此并发请求
  await personalizedP;
}

onMounted(() => {
  document.addEventListener("click", onDocClick);
  if (!hasLoaded) {
    loadData();
    hasLoaded = true;
  }
});
onUnmounted(() => {
  document.removeEventListener("click", onDocClick);
});

// 登录状态变化时重新加载个性化内容（登录前进入首页会缓存"未登录"的空数据）
watch(() => _cachedUser.value?.userId, (uid, oldUid) => {
  if (uid !== oldUid && hasLoaded) {
    log.info("recommend-view", "login state changed, reloading personalized data", { uid });
    dailyRecommendSongs.value = [];
    recommendPlaylists.value = [];
    radarPlaylistCard.value = null;
    loadRadarPlaylistCard();
    loadPersonalizedData();
  }
});
</script>

<template>
  <section class="recommend-view nice-scroll">
    <!-- 顶部入口卡片（仿手机端样式）：每日推荐 / 私人漫游 / 私人雷达 / 心动模式 / 雷达歌单 / 相似歌曲 -->
    <div class="top-area">
      <div ref="entryCardsRowRef" class="entry-cards" @wheel="onEntryCardsWheel">
        <!-- 每日推荐 = /recommend/songs 每日推荐歌曲 -->
        <div class="entry-card" :class="{ disabled: !dailyRecommendSongs.length }">
          <div class="entry-cover daily-cover" @click="openDailyRecommend">
            <img v-if="dailyCoverUrl" :src="dailyCoverUrl" alt="每日推荐" referrerpolicy="no-referrer" loading="lazy" />
            <div v-else class="entry-date">{{ new Date().getDate() }}</div>
            <div class="entry-shade" />
            <div class="entry-overlay">
              <div class="entry-name">每日推荐</div>
              <div class="entry-sub">今日限定好歌推荐</div>
            </div>
            <button class="entry-play-btn" title="播放每日推荐" @click.stop="playDailyRecommend" :disabled="!dailyRecommendSongs.length">
              <Icon name="play" :size="20" />
            </button>
          </div>
        </div>

        <!-- 私人漫游 = /personal_fm 流式推荐（同网易云 PC 端漫游） -->
        <div class="entry-card" :class="{ disabled: !isLoggedIn }">
          <div class="entry-cover roam-cover" @click="openPersonalRoam">
            <Icon name="shuffle" :size="28" />
            <div class="entry-shade" />
            <div class="entry-overlay">
              <div class="entry-name">私人漫游</div>
              <div class="entry-sub">{{ store.isPersonalRoam ? '漫游中 · 无限畅听' : '多样频道无限畅听' }}</div>
            </div>
            <button class="entry-play-btn" title="开始私人漫游" @click.stop="playPersonalRoam" :disabled="!isLoggedIn || roamStarting">
              <div v-if="roamStarting" class="spinner-sm roam-spinner" />
              <Icon v-else name="play" :size="20" />
            </button>
          </div>
        </div>

        <!-- 私人雷达 = 固定歌单 ID 3136952023 -->
        <div class="entry-card">
          <div class="entry-cover radar-cover" @click="openPersonalRadar">
            <img v-if="personalRadarCover" :src="personalRadarCover + '?param=340x340'" alt="私人雷达" referrerpolicy="no-referrer" loading="lazy" />
            <Icon v-else name="radio" :size="28" />
            <div class="entry-shade" />
            <div class="entry-overlay">
              <div class="entry-name">私人雷达</div>
              <div class="entry-sub">{{ radarSubText }}</div>
            </div>
            <button class="entry-play-btn" title="播放私人雷达" @click.stop="playPersonalRadarPlaylist">
              <Icon name="play" :size="20" />
            </button>
          </div>
        </div>

        <!-- 心动模式 = 红心歌曲智能推荐（官方接口异常时本地构建队列） -->
        <div class="entry-card" :class="{ disabled: !isLoggedIn }">
          <div class="entry-cover heartbeat-cover" @click="playHeartbeatMode">
            <Icon name="heartFilled" :size="28" />
            <div class="entry-shade" />
            <div class="entry-overlay">
              <div class="entry-name">心动模式</div>
              <div class="entry-sub">红心歌曲和相似推荐</div>
            </div>
            <button class="entry-play-btn" title="开启心动模式" @click.stop="playHeartbeatMode" :disabled="!isLoggedIn || heartbeatStarting">
              <div v-if="heartbeatStarting" class="spinner-sm roam-spinner" />
              <Icon v-else name="play" :size="20" />
            </button>
          </div>
        </div>

        <!-- 雷达歌单 = /homepage/block/page 雷达歌单第一个（时光雷达等，随账号个性化） -->
        <div v-if="radarPlaylistCard" class="entry-card">
          <div class="entry-cover radarlist-cover" @click="playRadarPlaylistCard">
            <img :src="radarPlaylistCard.cover + '?param=340x340'" alt="雷达歌单" referrerpolicy="no-referrer" loading="lazy" decoding="async" />
            <div class="entry-shade" />
            <div class="entry-overlay">
              <div class="entry-name">雷达歌单</div>
              <div class="entry-sub">反复聆听你爱的歌</div>
            </div>
            <button class="entry-play-btn" title="播放雷达歌单" @click.stop="playRadarPlaylistCard" :disabled="radarCardLoading">
              <div v-if="radarCardLoading" class="spinner-sm roam-spinner" />
              <Icon v-else name="play" :size="20" />
            </button>
          </div>
        </div>

        <!-- 相似歌曲 = 从最近喜欢的歌开始智能推荐 -->
        <div class="entry-card" :class="{ disabled: !isLoggedIn }">
          <div class="entry-cover simi-cover" @click="playSimilarSongs">
            <Icon name="sparkles" :size="28" />
            <div class="entry-shade" />
            <div class="entry-overlay">
              <div class="entry-name">相似歌曲</div>
              <div class="entry-sub">从你喜欢的歌听起</div>
            </div>
            <button class="entry-play-btn" title="播放相似歌曲" @click.stop="playSimilarSongs" :disabled="!isLoggedIn || simiStarting">
              <div v-if="simiStarting" class="spinner-sm roam-spinner" />
              <Icon v-else name="play" :size="20" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 个性推荐歌单（/recommend/resource + /personalized，从下方上移至顶部） -->
    <div class="section">
      <h2 class="section-title">个性推荐歌单</h2>
      <div v-if="loading" class="loading-state"><div class="spinner" /><span>加载中...</span></div>
      <div v-else-if="recommendPlaylists.length === 0" class="loading-state">
        <Icon name="music" :size="20" />
        <span>{{ isLoggedIn ? '暂无推荐歌单，请稍后重试' : '登录后查看个性化推荐歌单' }}</span>
      </div>
      <div v-else ref="recommendPlaylistsRowRef" class="recommend-playlists-row" @wheel="onRecommendPlaylistsWheel">
        <button
          v-for="pl in recommendPlaylists"
          :key="pl.id"
          class="rp-pl-item"
          @click="openPlaylist(pl)"
        >
          <div class="rp-pl-cover">
            <img
              v-if="pl.coverImgUrl"
              :src="pl.coverImgUrl + '?param=168x168'"
              :alt="pl.name"
              referrerpolicy="no-referrer"
              loading="lazy"
              decoding="async"
            />
            <div v-else class="rp-pl-cover-fallback"><Icon name="music" :size="24" /></div>
          </div>
          <div class="rp-pl-name" :title="pl.name">{{ pl.name }}</div>
          <div v-if="pl.playCount" class="rp-pl-count">{{ formatCount(pl.playCount) }}</div>
        </button>
      </div>
    </div>

    <!-- 推荐新音乐（/personalized/newsong，懒加载区块；滚轮横滑与个性推荐歌单一致） -->
    <div ref="newMusicSection" class="section">
      <h2 class="section-title">推荐新音乐</h2>
      <div v-if="newMusicLoading" class="loading-state"><div class="spinner" /><span>加载中...</span></div>
      <div v-else-if="newMusicSongs.length === 0" class="loading-state"><Icon name="music" :size="20" /><span>暂无推荐</span></div>
      <div v-else ref="newMusicRowRef" class="music-row" @wheel="onNewMusicWheel">
        <button
          v-for="song in newMusicSongs"
          :key="song.id"
          class="music-card"
          :class="{ active: song.id === store.currentSong?.id }"
          @click="playSong(song)"
        >
          <div class="music-card-cover">
            <img v-if="song.pic" :src="song.pic + '?param=240x240'" :alt="song.name" referrerpolicy="no-referrer" loading="lazy" decoding="async" />
            <Icon v-else name="music" :size="24" />
            <span class="music-card-play"><Icon :name="store.currentSong?.id === song.id && store.isPlaying ? 'pause' : 'play'" :size="16" /></span>
          </div>
          <div class="music-card-name truncate" :title="song.name">{{ song.name }}</div>
          <div class="music-card-artist truncate" :title="song.artist">{{ song.artist }}</div>
        </button>
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
        <div v-for="(song, idx) in dailyRecommendSongs.slice(0, 6)" :key="song.id"
          class="roam-item" :class="{ active: song.id === store.currentSong?.id }"
          @click="playSong(song)">
          <span class="roam-idx">{{ idx + 1 }}</span>
          <div class="roam-cover-sm" v-if="song.pic"><img :src="song.pic" alt="" referrerpolicy="no-referrer" /></div>
          <div class="roam-meta">
            <div class="roam-name-line">
              <div class="roam-name truncate">{{ song.name }}</div>
              <SongBadge :song="song" size="sm" />
            </div>
            <div class="roam-artist truncate">{{ song.artist }}</div>
          </div>
          <button class="roam-dislike" title="不感兴趣" @click.stop="dislikeSong(song)">
            <img src="/icons/dislike.svg" alt="dislike" class="roam-dislike-icon" />
          </button>
        </div>
      </div>
    </div>

    <!-- 新歌速递（/top/song，懒加载区块） -->
    <div ref="newSongsSection" class="section">
      <h2 class="section-title">新歌速递</h2>
      <div v-if="newSongsLoading" class="loading-state"><div class="spinner" /><span>加载中...</span></div>
      <div v-else-if="newSongs.length === 0" class="loading-state"><Icon name="music" :size="20" /><span>暂无新歌</span></div>
      <div v-else class="new-songs-grid">
        <button
          v-for="song in newSongs.slice(0, 6)"
          :key="song.id"
          class="new-song-item"
          :class="{ active: song.id === store.currentSong?.id }"
          @click="playSong(song)"
        >
          <div class="new-song-cover">
            <img v-if="song.pic" :src="song.pic" :alt="song.name" referrerpolicy="no-referrer" loading="lazy" />
            <Icon v-else name="music" :size="18" />
          </div>
          <div class="new-song-meta">
            <div class="new-song-name-line">
              <div class="new-song-name truncate">{{ song.name }}</div>
              <SongBadge :song="song" size="sm" />
            </div>
            <div class="new-song-artist truncate">{{ song.artist }}</div>
          </div>
          <div class="new-song-play">
            <Icon :name="store.currentSong?.id === song.id && store.isPlaying ? 'pause' : 'play'" :size="14" />
          </div>
        </button>
      </div>
    </div>

    <!-- 热搜榜（/search/hot/detail，懒加载区块） -->
    <div ref="hotSearchSection" class="section">
      <h2 class="section-title">热搜榜</h2>
      <div v-if="hotSearchLoading" class="loading-state"><div class="spinner" /><span>加载中...</span></div>
      <div v-else-if="hotSearchList.length === 0" class="loading-state"><Icon name="music" :size="20" /><span>暂无热搜数据</span></div>
      <div v-else class="hot-search-grid">
        <button
          v-for="(item, idx) in hotSearchList.slice(0, 12)"
          :key="item.searchWord"
          class="hot-search-item"
          @click="searchHotWord(item.searchWord)"
        >
          <span class="hot-idx" :class="{ 'hot-top': idx < 3 }">{{ idx + 1 }}</span>
          <span class="hot-word truncate">{{ item.searchWord }}</span>
          <span v-if="item.iconType === 1" class="hot-badge hot">HOT</span>
          <span v-if="item.iconType === 2" class="hot-badge new">NEW</span>
          <span v-if="item.iconType === 3" class="hot-badge recommend">荐</span>
          <span v-if="item.score" class="hot-score">{{ formatCount(item.score) }}</span>
        </button>
      </div>
    </div>

    <!-- 榜单精选（懒加载区块：滚动到附近才逐个请求榜单数据） -->
    <div ref="rankingsSection" class="section">
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

/* 顶部入口卡片（仿手机端样式）：封面背景 + 左下标题/副标题 + 右下播放键
   六张卡片：每日推荐 / 私人漫游 / 私人雷达 / 心动模式 / 雷达歌单 / 相似歌曲；
   窗口变窄时横向滚动（滚轮横滑），滚动条隐藏 */
.entry-cards {
  display: flex; gap: 16px;
  min-width: 0; max-width: 100%;
  overflow-x: auto; overflow-y: hidden;
  padding: 3px 2px 6px;
  scroll-behavior: smooth;
  scrollbar-width: none; -ms-overflow-style: none;
}
.entry-cards::-webkit-scrollbar { display: none; }
.entry-card { flex: 0 0 170px; transition: transform 0.2s var(--ease-out); cursor: pointer; }
.entry-card:hover { transform: scale(1.02); }
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
.entry-shade {
  position: absolute; inset: 0; z-index: 1; pointer-events: none;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0) 42%, rgba(0, 0, 0, 0.62) 100%);
}
.entry-overlay {
  position: absolute; left: 10px; right: 10px; bottom: 9px; z-index: 2;
  display: flex; flex-direction: column; gap: 2px; min-width: 0;
  pointer-events: none;
}
.entry-name {
  font-size: 15px; font-weight: 700; color: #fff;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.entry-sub {
  font-size: 11px; color: rgba(255, 255, 255, 0.85);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.entry-play-btn {
  position: absolute; bottom: 8px; right: 8px;
  width: 36px; height: 36px; border-radius: 50%;
  background: rgba(0, 0, 0, 0.2); color: #fff;
  display: flex; align-items: center; justify-content: center;
  transition: transform 0.2s var(--ease-out), background 0.2s var(--ease-out);
  backdrop-filter: blur(3px) saturate(1); z-index: 3; cursor: pointer;
}
.entry-play-btn:hover { transform: scale(1.05); background: rgba(0, 0, 0, 0.3); }
.entry-play-btn:active { transform: scale(0.95); }
.entry-play-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.entry-play-btn :deep(.icon-svg) { margin-left: 2px; pointer-events: none; }
.daily-cover { background: linear-gradient(135deg, #ff6b35, #fa233b); color: #fff; }
.roam-cover { background: linear-gradient(135deg, #6750A4, #9d4edd); color: #fff; }
.radar-cover { background: linear-gradient(135deg, #06d6a0, #118ab2); color: #fff; }
.heartbeat-cover { background: linear-gradient(135deg, #ff5f6d, #d72684); color: #fff; }
.radarlist-cover { background: linear-gradient(135deg, #f973a3, #ec4899); color: #fff; }
.simi-cover { background: linear-gradient(135deg, #f59e0b, #ef4444); color: #fff; }
.entry-date {
  position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%);
  font-size: 42px; font-weight: 800; color: #fff; text-shadow: 0 2px 8px rgba(0,0,0,0.3);
  pointer-events: none;
}

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
.roam-name-line { display: flex; align-items: center; gap: 2px; min-width: 0; overflow: hidden; }
.roam-name-line .roam-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.roam-name { font-size: 13px; color: var(--text); }
.roam-artist { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }
.roam-dislike { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.15s, background 0.15s; flex-shrink: 0; }
.roam-item:hover .roam-dislike { opacity: 0.6; }
.roam-dislike:hover { opacity: 1 !important; background: var(--bg-hover); }
.roam-dislike-icon { width: 16px; height: 16px; pointer-events: none; }
.loading-state { display: flex; align-items: center; gap: 8px; color: var(--text-tertiary); font-size: 13px; padding: 24px; }
.spinner { width: 24px; height: 24px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
.spinner-sm { width: 16px; height: 16px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 12px auto; }
.roam-spinner { margin: 0; border-color: rgba(255,255,255,0.35); border-top-color: #fff; }

/* 推荐新音乐卡片横排（懒加载区块；滚轮横滑/hover 与个性推荐歌单一致） */
.music-row {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 3px 2px 6px;
  scroll-behavior: smooth;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.music-row::-webkit-scrollbar { display: none; }
.music-card {
  flex: 0 0 132px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  cursor: pointer;
}
.music-card-cover {
  position: relative;
  width: 132px;
  aspect-ratio: 1;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--bg-elev-3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  box-shadow: var(--shadow-sm);
  transition: transform 0.18s var(--ease-out), box-shadow 0.18s var(--ease-out);
}
.music-card:hover .music-card-cover { transform: scale(1.03); box-shadow: var(--shadow-md); }
.music-card-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.music-card-play {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.18s var(--ease-out), transform 0.18s var(--ease-out);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  z-index: 2;
}
.music-card:hover .music-card-play { opacity: 1; transform: translateY(0); }
.music-card.active .music-card-name { color: var(--accent); }
.music-card-name { font-size: 12px; font-weight: 600; color: var(--text); line-height: 1.3; padding: 0 2px; }
.music-card-artist { font-size: 11px; color: var(--text-tertiary); padding: 0 2px; }

/* 推荐歌单 - 横向滚动（与个人主页"我的歌单"风格一致：隐藏滚动条 + 鼠标滚轮横向滑动）
   尺寸为个人主页的 0.8 倍（210→168px） */
.recommend-playlists-row {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 3px 2px 6px;
  scroll-behavior: smooth;
  /* 隐藏滚动条 */
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.recommend-playlists-row::-webkit-scrollbar { display: none; }
.rp-pl-item {
  flex: 0 0 168px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  cursor: pointer;
  transition: transform 0.18s var(--ease-out);
}
.rp-pl-item:hover .rp-pl-cover { transform: scale(1.03); box-shadow: var(--shadow-md); }
.rp-pl-cover {
  aspect-ratio: 1;
  width: 168px;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--bg-elev-3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  box-shadow: var(--shadow-sm);
  transition: transform 0.18s var(--ease-out), box-shadow 0.18s var(--ease-out);
}
.rp-pl-cover img { width: 100%; height: 100%; object-fit: cover; }
.rp-pl-cover-fallback { color: var(--text-tertiary); }
.rp-pl-name {
  font-size: 12px;
  color: var(--text);
  font-weight: 600;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  padding: 0 2px;
}
.rp-pl-count {
  font-size: 10px;
  color: var(--text-tertiary);
  line-height: 1.2;
  padding: 0 2px;
}

/* 新歌速递 */
.new-songs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 8px;
}
.new-song-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  text-align: left;
  transition: background 0.15s;
  cursor: pointer;
}
.new-song-item:hover {
  background: var(--bg-hover);
}
.new-song-item.active {
  color: var(--accent);
  background: var(--accent-soft);
}
.new-song-cover {
  width: 42px;
  height: 42px;
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--bg-elev-3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
}
.new-song-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.new-song-meta {
  flex: 1;
  min-width: 0;
}
.new-song-name {
  font-size: 13px;
  color: var(--text);
  font-weight: 500;
}
.new-song-name-line {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  overflow: hidden;
}
.new-song-name-line .new-song-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.new-song-item.active .new-song-name {
  color: var(--accent);
}
.new-song-artist {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}
.new-song-play {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
  flex-shrink: 0;
}
.new-song-item:hover .new-song-play {
  opacity: 0.7;
}
.new-song-item.active .new-song-play {
  opacity: 1;
  color: var(--accent);
}

/* 热搜榜 */
.hot-search-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 4px;
}
.hot-search-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  text-align: left;
  transition: background 0.15s;
  cursor: pointer;
}
.hot-search-item:hover {
  background: var(--bg-hover);
}
.hot-idx {
  width: 20px;
  text-align: center;
  font-size: 13px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  font-weight: 500;
}
.hot-idx.hot-top {
  color: var(--accent);
  font-weight: 700;
}
.hot-word {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text);
  font-weight: 500;
}
.hot-badge {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  font-weight: 700;
  flex-shrink: 0;
  letter-spacing: 0.3px;
}
.hot-badge.hot {
  color: #ff4d4f;
  background: rgba(255, 77, 79, 0.1);
}
.hot-badge.new {
  color: #52c41a;
  background: rgba(82, 196, 26, 0.1);
}
.hot-badge.recommend {
  color: var(--accent);
  background: var(--accent-soft);
}
.hot-score {
  font-size: 10px;
  color: var(--text-tertiary);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

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
.ranking-song-name { min-width: 0; flex: 1; font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
body.has-wallpaper .rp-pl-cover {
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
