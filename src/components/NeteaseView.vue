<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { usePlayerStore } from "@/stores/player";
import {
  playlistTrackAll, recommendSongs, recommendResource, userRecord,
  getCachedUser, getCachedPlaylists,
  neteaseSongToSong, getCookie, _cachedUser,
  likeSong, playlistTracks, getCachedLikeList, addLikeCache, removeLikeCache,
  playlistDetail, playlistDetailDynamic, commentPlaylist, playlistSubscribers, commentNew, type NewComment,
  type NeteasePlaylist, type PlaylistComment, type PlaylistSubscriber,
} from "@/api/netease";
import { log } from "@/composables/logger";
import { useToast } from "@/composables/useToast";
const toast = useToast();
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
/** 当前列表歌曲的喜欢状态集合（neteaseId → liked） */
const songLikedSet = ref<Set<number>>(new Set());
/** 是否已启动任何加载（防止 onMounted 的 loadData 与 watch 的 pendingPlaylistId 竞争导致闪烁） */
const loadInitiated = ref(false);

/** 加载当前列表歌曲的喜欢状态 */
async function loadSongLikedStatus() {
  if (currentPlaylistSongs.value.length === 0) return;
  try {
    const likeSet = await getCachedLikeList();
    const liked = new Set<number>();
    for (const s of currentPlaylistSongs.value) {
      if (s.neteaseId && likeSet.has(s.neteaseId)) liked.add(s.neteaseId);
    }
    songLikedSet.value = liked;
  } catch { /* ignore */ }
}

/** 切换单首歌曲喜欢状态（列表内按钮） */
async function toggleSongLike(song: Song) {
  if (song.source !== "netease" || !song.neteaseId) return;
  const liked = songLikedSet.value.has(song.neteaseId);
  try {
    await likeSong(song.neteaseId, !liked);
    if (!liked) { songLikedSet.value.add(song.neteaseId); addLikeCache(song.neteaseId); }
    else { songLikedSet.value.delete(song.neteaseId); removeLikeCache(song.neteaseId); }
    // 触发响应式更新
    songLikedSet.value = new Set(songLikedSet.value);
    toast.success(liked ? "已取消喜欢" : "已喜欢", song.name);
  } catch (e) {
    log.warn("netease-view", "toggle song like failed", { error: String(e) });
    toast.error("操作失败", "请稍后重试");
  }
}

async function loadData() {
  if (!getCookie()) return;
  const user = await getCachedUser();
  if (!user) return;
  loggedIn.value = true;
  const pls = await getCachedPlaylists();
  playlists.value = pls;
  // 只有在未启动任何加载时才自动加载第一个歌单
  // （watch(pendingPlaylistId, immediate) 已在 setup 阶段处理过榜单等场景）
  if (!loadInitiated.value && playlists.value.length > 0) {
    await selectPlaylist(playlists.value[0]);
  }
}

async function selectPlaylist(pl: NeteasePlaylist) {
  if (selectedPlaylistId.value === pl.id && currentPlaylistSongs.value.length > 0) return;
  loadInitiated.value = true;
  isRecordView.value = false;
  playCountMap.value = new Map();
  songLikedSet.value = new Set();
  selectedPlaylistId.value = pl.id;
  store.setSourcePlaylistId(pl.id);
  selectedPlaylistName.value = pl.name;
  selectedPlaylistCover.value = pl.coverImgUrl || "";
  // 清空详情数据
  playlistDesc.value = "";
  playlistDynamic.value = null;
  playlistComments.value = [];
  playlistSubs.value = [];
  commentPageNo.value = 1;
  commentCursor.value = undefined;
  commentHasMore.value = false;
  subsOffset.value = 0;
  activeDetailTab.value = "songs";
  loadingSongs.value = true;
  try {
    const res = await playlistTrackAll(pl.id);
    currentPlaylistSongs.value = (res.songs || []).map(neteaseSongToSong);
    loadSongLikedStatus(); // 后台加载喜欢状态
  } catch { currentPlaylistSongs.value = []; }
  loadingSongs.value = false;
  // 后台加载歌单详情（动态、评论、收藏者）
  loadPlaylistExtra(pl.id);
  // 描述需要 playlistDetail 获取（NeteasePlaylist 类型不含 description）
  playlistDetail(pl.id, 0).then(res => {
    if (res.playlist?.description) playlistDesc.value = res.playlist.description;
    else if (pl.creator?.nickname) playlistDesc.value = `by ${pl.creator.nickname}`;
  }).catch(() => {});
}

async function loadDailyRecommend() {
  if (selectedPlaylistId.value === -1 && currentPlaylistSongs.value.length > 0) return;
  loadInitiated.value = true;
  isRecordView.value = false;
  playCountMap.value = new Map();
  songLikedSet.value = new Set();
  selectedPlaylistId.value = -1;
  store.setSourcePlaylistId(-1);
  selectedPlaylistName.value = "每日推荐";
  selectedPlaylistCover.value = "";
  loadingSongs.value = true;
  try {
    const res = await recommendSongs();
    currentPlaylistSongs.value = (res.data?.dailySongs || []).map(neteaseSongToSong);
    loadSongLikedStatus();
  } catch { currentPlaylistSongs.value = []; }
  loadingSongs.value = false;
}

/** 加载私人漫游（推荐资源） - /recommend/resource 返回推荐歌曲列表 */
async function loadPersonalRoam() {
  if (selectedPlaylistId.value === -3 && currentPlaylistSongs.value.length > 0) return;
  loadInitiated.value = true;
  isRecordView.value = false;
  playCountMap.value = new Map();
  songLikedSet.value = new Set();
  selectedPlaylistId.value = -3;
  store.setSourcePlaylistId(-3);
  selectedPlaylistName.value = "私人漫游";
  selectedPlaylistCover.value = "";
  // 清空详情数据（私人漫游没有评论/收藏者）
  playlistDesc.value = "";
  playlistDynamic.value = null;
  playlistComments.value = [];
  playlistSubs.value = [];
  commentPageNo.value = 1;
  commentCursor.value = undefined;
  commentHasMore.value = false;
  subsOffset.value = 0;
  activeDetailTab.value = "songs";
  loadingSongs.value = true;
  try {
    const res = await recommendResource();
    const recList = res.recommend || res.data || [];
    currentPlaylistSongs.value = recList.slice(0, 30).map((s: any) => neteaseSongToSong({
      id: s.id,
      name: s.name,
      ar: s.artists || s.ar,
      al: s.album || s.al,
      dt: s.duration || s.dt,
      picUrl: s.picUrl,
    } as any));
    loadSongLikedStatus();
    log.info("netease-view", "personal roam loaded", { count: currentPlaylistSongs.value.length });
  } catch (e) {
    log.warn("netease-view", "load personal roam failed", { error: String(e) });
    currentPlaylistSongs.value = [];
  }
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
  loadInitiated.value = true;
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
  store.setSourcePlaylistId(-2);
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
    loadSongLikedStatus();
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

/** 通过 playlistDetail 加载歌单/榜单（不在用户歌单列表中的） */
async function loadPlaylistById(id: number) {
  loadInitiated.value = true;
  loggedIn.value = true; // 榜单等公开歌单即使未登录也能查看
  isRecordView.value = false;
  playCountMap.value = new Map();
  songLikedSet.value = new Set();
  selectedPlaylistId.value = id;
  store.setSourcePlaylistId(id);
  loadingSongs.value = true;
  // 清空详情数据
  playlistDesc.value = "";
  playlistDynamic.value = null;
  playlistComments.value = [];
  playlistSubs.value = [];
  commentPageNo.value = 1;
  commentCursor.value = undefined;
  commentHasMore.value = false;
  subsOffset.value = 0;
  activeDetailTab.value = "songs";
  try {
    const res = await playlistDetail(id, 0);
    const pl = res.playlist;
    if (pl) {
      selectedPlaylistName.value = pl.name || "歌单";
      selectedPlaylistCover.value = pl.coverImgUrl || "";
      playlistDesc.value = pl.description || ((pl.creator as any)?.nickname ? `by ${pl.creator?.nickname}` : "");
      // playlistDetail 的 tracks 只有前10首，用 playlistTrackAll 获取全部
      const trackRes = await playlistTrackAll(id);
      currentPlaylistSongs.value = (trackRes.songs || []).map(neteaseSongToSong);
      loadSongLikedStatus();
      log.info("netease-view", "loadPlaylistById done", { id, name: pl.name, count: currentPlaylistSongs.value.length });
      // 后台加载详情动态、评论、收藏者
      loadPlaylistExtra(id);
    }
  } catch (e) {
    log.warn("netease-view", "loadPlaylistById failed", { error: String(e) });
    currentPlaylistSongs.value = [];
  }
  loadingSongs.value = false;
}

/** 歌单详情数据 */
const playlistDesc = ref("");
const playlistDynamic = ref<{ commentCount: number; playCount: number; bookedCount: number; shareCount: number } | null>(null);
const playlistComments = ref<NewComment[]>([]);
const playlistSubs = ref<PlaylistSubscriber[]>([]);
const activeDetailTab = ref<"songs" | "comments" | "subscribers">("songs");
const commentPageNo = ref(1);
const commentCursor = ref<number | undefined>(undefined);
const commentSortType = ref<1 | 2 | 3>(1); // 默认按推荐排序
const commentHasMore = ref(false);
const subsOffset = ref(0);
const loadingComments = ref(false);
const loadingSubs = ref(false);
/** 评论总数 */
const commentTotal = ref(0);
/** 收藏者总数 */
const subsTotal = ref(0);
/** 评论排序标签 */
const SORT_LABELS: Record<1 | 2 | 3, string> = { 1: "推荐", 2: "热度", 3: "时间" };

/** 后台加载歌单详情动态、评论、收藏者 */
async function loadPlaylistExtra(id: number) {
  // 动态
  playlistDetailDynamic(id).then(res => {
    const d = (res as any).data || res;
    if (d) {
      playlistDynamic.value = {
        commentCount: d.commentCount || 0,
        playCount: d.playCount || 0,
        bookedCount: d.bookedCount || 0,
        shareCount: d.shareCount || 0,
      };
    }
  }).catch(() => {});
  // 评论（第一页 + 热门评论）
  loadComments(id, true);
  // 收藏者
  loadSubscribers(id, true);
}

async function loadComments(id: number, reset = false) {
  // 私人漫游(-3)/每日推荐(-1)/听歌排行(-2) 等非真实歌单没有评论
  if (id <= 0) {
    playlistComments.value = [];
    commentTotal.value = 0;
    commentHasMore.value = false;
    commentCursor.value = undefined;
    commentPageNo.value = 1;
    return;
  }
  if (loadingComments.value) return;
  if (reset) {
    commentPageNo.value = 1; playlistComments.value = []; commentTotal.value = 0;
    commentCursor.value = undefined; commentHasMore.value = false;
  }
  loadingComments.value = true;
  try {
    const res = await commentNew(id, 2, commentSortType.value, commentPageNo.value, 20, commentCursor.value);
    if (reset) playlistComments.value = res.comments || [];
    else playlistComments.value.push(...(res.comments || []));
    commentTotal.value = res.totalCount || 0;
    commentHasMore.value = !!res.hasMore;
    commentCursor.value = res.cursor;
    if (commentHasMore.value) commentPageNo.value += 1;
  } catch { /* ignore */ }
  loadingComments.value = false;
}

/** 切换评论排序方式 */
async function switchCommentSort(sort: 1 | 2 | 3) {
  if (commentSortType.value === sort) return;
  commentSortType.value = sort;
  if (selectedPlaylistId.value) await loadComments(selectedPlaylistId.value, true);
}

async function loadSubscribers(id: number, reset = false) {
  // 私人漫游(-3)/每日推荐(-1)/听歌排行(-2) 等非真实歌单没有收藏者
  if (id <= 0) {
    playlistSubs.value = [];
    subsTotal.value = 0;
    subsOffset.value = 0;
    return;
  }
  if (loadingSubs.value) return;
  if (reset) { subsOffset.value = 0; playlistSubs.value = []; subsTotal.value = 0; }
  loadingSubs.value = true;
  try {
    const res = await playlistSubscribers(id, 20, subsOffset.value);
    if (reset) playlistSubs.value = res.subscribers || [];
    else playlistSubs.value.push(...(res.subscribers || []));
    subsOffset.value += 20;
    if (res.total) subsTotal.value = res.total;
  } catch { /* ignore */ }
  loadingSubs.value = false;
}

/** 滚动到底部加载更多评论/收藏者 */
function onDetailScroll(e: Event) {
  const el = e.target as HTMLElement;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
    if (activeDetailTab.value === "comments") {
      loadComments(selectedPlaylistId.value!, false);
    } else if (activeDetailTab.value === "subscribers") {
      loadSubscribers(selectedPlaylistId.value!, false);
    }
  }
}

function formatCount(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + "亿";
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  return String(n);
}

/** 返回上一页 */
function goBack() {
  store.goBackView();
}

/** 是否显示返回按钮（榜单等非用户歌单时显示） */
const showBackBtn = computed(() => {
  const pid = selectedPlaylistId.value;
  // 每日推荐(-1)、听歌排行(-2)、私人漫游(-3)不显示返回
  if (pid === -1 || pid === -2 || pid === -3) return false;
  // 用户歌单列表中的不显示返回
  if (playlists.value.some(p => p.id === pid)) return false;
  return true;
});

/** 是否显示详情标签页（歌曲/评论/收藏者）
 *  所有真实歌单（id > 0）和私人漫游(-3)都显示，每日推荐(-1)和听歌排行(-2)不显示 */
const showDetailTabs = computed(() => {
  if (isRecordView.value) return false;
  const pid = selectedPlaylistId.value;
  return pid !== null && (pid > 0 || pid === -3);
});

/** 是否显示评论/收藏者标签（仅真实歌单 id > 0 才显示） */
const showExtraTabs = computed(() => {
  const pid = selectedPlaylistId.value;
  return pid !== null && pid > 0;
});

// 右键菜单
const contextMenu = ref<{ visible: boolean; x: number; y: number; song: Song | null }>({ visible: false, x: 0, y: 0, song: null });
const ctxSongLiked = ref(false);  // 当前右键歌曲是否已喜欢
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
  showPlayNextSub.value = false;
  // 查询喜欢状态
  if (song.source === "netease" && song.neteaseId) {
    getCachedLikeList().then(set => { ctxSongLiked.value = set.has(song.neteaseId!); }).catch(() => {});
  } else {
    ctxSongLiked.value = false;
  }
}
function closeContextMenu() { contextMenu.value.visible = false; showPlayNextSub.value = false; }
function ctxPlay() { if (contextMenu.value.song) store.playNow(contextMenu.value.song); closeContextMenu(); }
function ctxPlayNext() { if (contextMenu.value.song) store.playNext(contextMenu.value.song); closeContextMenu(); }
function ctxPlayLast() { if (contextMenu.value.song) store.addToQueue(contextMenu.value.song); closeContextMenu(); }
function ctxAddToQueue() { if (contextMenu.value.song) store.addToQueue(contextMenu.value.song); closeContextMenu(); }

// 从当前歌单删除歌曲（弹出确认框）
function ctxRemoveFromPlaylist() {
  const song = contextMenu.value.song;
  const pid = selectedPlaylistId.value;
  if (!song || song.source !== "netease" || !song.neteaseId || !pid || pid <= 0) return;
  closeContextMenu();
  // 弹出确认框
  confirmDialog.value = {
    visible: true,
    title: "移除歌曲",
    message: `是否从歌单移除「${song.name}」？`,
    song,
    pid,
  };
}

// 确认删除对话框
const confirmDialog = ref<{ visible: boolean; title: string; message: string; song: Song | null; pid: number | null }>({
  visible: false, title: "", message: "", song: null, pid: null,
});
function closeConfirmDialog() { confirmDialog.value.visible = false; }
async function confirmRemoveFromPlaylist() {
  const song = confirmDialog.value.song;
  const pid = confirmDialog.value.pid;
  if (!song || !song.neteaseId || !pid) { closeConfirmDialog(); return; }
  closeConfirmDialog();
  // 后台执行删除
  try {
    await playlistTracks("del", pid, song.neteaseId);
    log.info("netease-view", "removed from playlist", { songId: song.neteaseId, playlistId: pid });
    // 从当前列表移除
    const idx = currentPlaylistSongs.value.findIndex(s => s.id === song.id);
    if (idx >= 0) currentPlaylistSongs.value.splice(idx, 1);
    // 右下角提示
    toast.success("已从歌单移除", song.name);
  } catch (e) {
    log.warn("netease-view", "remove from playlist failed", { error: String(e) });
    toast.error("移除失败", "请稍后重试");
  }
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

// 添加到歌单：右键菜单点击后弹出对话框
function ctxOpenAddToPlaylistDialog() {
  const song = contextMenu.value.song;
  if (!song || song.source !== "netease") return;
  closeContextMenu();
  openAddToPlaylistDialog(song);
}

// 添加到歌单对话框
const addToPlaylistDialog = ref<{ visible: boolean; song: Song | null }>({
  visible: false, song: null,
});
function openAddToPlaylistDialog(song: Song) {
  if (song.source !== "netease" || !song.neteaseId) return;
  addToPlaylistDialog.value = { visible: true, song };
}
function closeAddToPlaylistDialog() {
  addToPlaylistDialog.value.visible = false;
}
// 点击歌单后：关闭对话框，后台添加，完成后 toast 提示
function confirmAddToPlaylist(pl: NeteasePlaylist) {
  const song = addToPlaylistDialog.value.song;
  if (!song || !song.neteaseId) return;
  closeAddToPlaylistDialog();
  // 后台执行添加
  playlistTracks("add", pl.id, song.neteaseId).then(() => {
    log.info("netease-view", "added to playlist", { songId: song.neteaseId, playlistId: pl.id, playlistName: pl.name });
    toast.success("添加成功", `已添加到「${pl.name}」`, 2000);
  }).catch((e) => {
    log.warn("netease-view", "add to playlist failed", { error: String(e) });
    toast.error("添加失败", "请稍后重试");
  });
}
function onDocClick() { closeContextMenu(); }

onMounted(() => {
  document.addEventListener("click", onDocClick);
  // watch(pendingPlaylistId, immediate) 已在 setup 阶段执行
  // 若已启动加载（从推荐页榜单进入），只加载侧边栏歌单列表，避免与 loadData 竞争导致闪烁
  if (loadInitiated.value) {
    loadPlaylistsOnly();
  } else {
    loadData();
  }
});

/** 只加载歌单列表，不自动选中第一个 */
async function loadPlaylistsOnly() {
  if (!getCookie()) return;
  const user = await getCachedUser();
  if (!user) return;
  loggedIn.value = true;
  const pls = await getCachedPlaylists();
  playlists.value = pls;
}

// 监听用户登录状态变化，登录后及时获取歌单
watch(() => _cachedUser.value, (user) => {
  if (user && !loggedIn.value) {
    log.info("netease-view", "user logged in, reloading data");
    // 登录后加载数据：若已有 pending 加载则只补侧边栏，否则自动选中第一个歌单
    loadData();
  }
}, { immediate: true });

watch(() => store.pendingPlaylistId, (id) => {
  if (id !== null) {
    if (id === -1) { loadDailyRecommend(); }
    else if (id === -2) { loadRecord(recordType.value); }
    else if (id === -3) { loadPersonalRoam(); }
    else {
      // 先从缓存的歌单列表找
      const pl = playlists.value.find(p => p.id === id);
      if (pl) selectPlaylist(pl);
      else {
        // 榜单等不在用户歌单列表中的，用 playlistDetail 加载
        loadPlaylistById(id);
      }
    }
    store.pendingPlaylistId = null;
  }
}, { immediate: true });

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
        <button v-if="showBackBtn" class="back-btn" @click="goBack" title="返回">
          <Icon name="chevronLeft" :size="22" />
        </button>
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
            <span v-else class="songs-count">
              {{ currentPlaylistSongs.length }} 首
              <span v-if="playlistDynamic" class="dynamic-info">
                · {{ formatCount(playlistDynamic.playCount) }}次播放
                · {{ formatCount(playlistDynamic.bookedCount) }}人收藏
              </span>
            </span>
          </div>
          <!-- 歌单描述 -->
          <div v-if="playlistDesc && !isRecordView" class="playlist-desc line-clamp-2">{{ playlistDesc }}</div>
        </div>
        <button class="play-all-btn" @click="playAll" :disabled="!currentPlaylistSongs.length">
          <Icon name="play" :size="14" /><span>播放全部</span>
        </button>
      </header>

      <!-- 详情标签页（所有真实歌单都显示：歌曲/评论/收藏者） -->
      <div v-if="showDetailTabs" class="detail-tabs">
        <button class="detail-tab" :class="{ active: activeDetailTab === 'songs' }" @click="activeDetailTab = 'songs'">歌曲</button>
        <button v-if="showExtraTabs" class="detail-tab" :class="{ active: activeDetailTab === 'comments' }" @click="activeDetailTab = 'comments'">
          评论<span v-if="commentTotal"> ({{ formatCount(commentTotal) }})</span>
        </button>
        <button v-if="showExtraTabs" class="detail-tab" :class="{ active: activeDetailTab === 'subscribers' }" @click="activeDetailTab = 'subscribers'">
          收藏者<span v-if="subsTotal"> ({{ formatCount(subsTotal) }})</span>
        </button>
      </div>

      <div class="songs-body nice-scroll" @scroll="onDetailScroll">
        <!-- 歌曲列表 -->
        <div v-if="loadingSongs && !currentPlaylistSongs.length" class="songs-loading">加载中...</div>
        <div v-else-if="!currentPlaylistSongs.length && activeDetailTab === 'songs'" class="songs-empty">
          <Icon name="music" :size="42" /><p>选择左侧歌单查看歌曲</p>
        </div>
        <!-- 评论列表 -->
        <div v-else-if="activeDetailTab === 'comments'" class="comments-list">
          <div v-if="commentTotal" class="list-total-header">
            <span>共 {{ formatCount(commentTotal) }} 条评论</span>
            <div class="comment-sort-bar">
              <button v-for="s in ([1,2,3] as const)" :key="s"
                class="comment-sort-btn" :class="{ active: commentSortType === s }"
                @click="switchCommentSort(s)">{{ SORT_LABELS[s] }}</button>
            </div>
          </div>
          <div v-if="loadingComments && !playlistComments.length" class="songs-loading">加载评论中...</div>
          <div v-else-if="!playlistComments.length" class="songs-empty"><p>暂无评论</p></div>
          <div v-for="c in playlistComments" :key="c.commentId" class="comment-item">
            <img v-if="c.user.avatarUrl" :src="c.user.avatarUrl + '?param=50x50'" class="comment-avatar" referrerpolicy="no-referrer" loading="lazy" />
            <div class="comment-body">
              <div class="comment-header">
                <span class="comment-user">{{ c.user.nickname }}</span>
                <span v-if="c.ipLocation" class="comment-loc">{{ c.ipLocation }}</span>
                <span v-if="c.likedCount > 0" class="comment-likes">👍 {{ c.likedCount }}</span>
              </div>
              <div class="comment-content">{{ c.content }}</div>
            </div>
          </div>
          <div v-if="loadingComments && playlistComments.length" class="songs-loading">加载中...</div>
        </div>
        <!-- 收藏者列表 -->
        <div v-else-if="activeDetailTab === 'subscribers'" class="subs-list">
          <div v-if="subsTotal" class="list-total-header">共 {{ formatCount(subsTotal) }} 人收藏</div>
          <div v-if="loadingSubs && !playlistSubs.length" class="songs-loading">加载收藏者中...</div>
          <div v-else-if="!playlistSubs.length" class="songs-empty"><p>暂无收藏者</p></div>
          <div v-for="s in playlistSubs" :key="s.userId" class="sub-item">
            <img v-if="s.avatarUrl" :src="s.avatarUrl + '?param=50x50'" class="sub-avatar" referrerpolicy="no-referrer" loading="lazy" />
            <div class="sub-info">
              <div class="sub-name truncate">{{ s.nickname }}</div>
              <div v-if="s.signature" class="sub-sig truncate">{{ s.signature }}</div>
            </div>
          </div>
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
            <span class="col-artist">
              <span class="artist-text truncate">{{ song.artist }}</span>
              <!-- 统一音乐卡片操作按钮：喜欢 / 添加至歌单 / 下一首播放（hover 显示，艺术家左侧） -->
              <div v-if="song.source === 'netease'" class="nmn-row-actions" :class="{ 'has-liked': songLikedSet.has(song.neteaseId!) }">
                <button class="nmn-action-btn row-like-btn" :class="{ liked: songLikedSet.has(song.neteaseId!) }" :title="songLikedSet.has(song.neteaseId!) ? '取消喜欢' : '喜欢'" @click.stop="toggleSongLike(song)">
                  <img v-if="songLikedSet.has(song.neteaseId!)" src="/icons/like.svg" alt="liked" class="nmn-action-icon" />
                  <img v-else src="/icons/not_like.svg" alt="not liked" class="nmn-action-icon" />
                </button>
                <button class="nmn-action-btn row-add-pl-btn" title="添加到歌单" @click.stop="openAddToPlaylistDialog(song)">
                  <img src="/icons/add_playlist.svg" alt="add to playlist" class="nmn-action-icon" />
                </button>
                <button class="nmn-action-btn nmn-action-next" title="下一首播放" @click.stop="store.addToQueue(song)">
                  <Icon name="next" :size="15" />
                </button>
              </div>
            </span>
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
        <!-- 添加到歌单（弹出对话框） -->
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

    <!-- 确认删除对话框 -->
    <Transition name="pl-dialog-fade">
      <div v-if="confirmDialog.visible" class="pl-dialog-overlay" @click="closeConfirmDialog">
        <div class="confirm-dialog" @click.stop>
          <div class="confirm-dialog-icon"><Icon name="info" :size="24" /></div>
          <h3 class="confirm-dialog-title">{{ confirmDialog.title }}</h3>
          <p class="confirm-dialog-message">{{ confirmDialog.message }}</p>
          <div class="confirm-dialog-actions">
            <button class="confirm-btn-cancel" @click="closeConfirmDialog">取消</button>
            <button class="confirm-btn-ok" @click="confirmRemoveFromPlaylist">移除</button>
          </div>
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
.back-btn { width: 40px; height: 40px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; color: var(--text-secondary); transition: color 0.2s, background 0.2s; flex-shrink: 0; }
.back-btn:hover { color: var(--text); background: var(--bg-hover); }
.songs-header.no-cover { gap: 0; }
.songs-header-cover { width: 64px; height: 64px; border-radius: 10px; flex-shrink: 0; background: var(--bg-elev-3); overflow: hidden; display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); }
.songs-header-cover img { width: 100%; height: 100%; object-fit: cover; }
.songs-header-info { flex: 1; min-width: 0; }
.songs-header-info h2 { margin: 0; font-size: 20px; font-weight: 700; }
.songs-count { font-size: 12px; color: var(--text-tertiary); }
.dynamic-info { font-size: 11px; opacity: 0.7; }
.playlist-desc { font-size: 12px; color: var(--text-tertiary); margin-top: 6px; line-height: 1.5; max-width: 500px; }
/* 详情标签页 */
.detail-tabs { display: flex; gap: 4px; padding: 0 24px; border-bottom: 1px solid var(--border); min-height: 40px; align-items: stretch; flex-shrink: 0; }
.detail-tab { padding: 10px 16px; font-size: 14px; font-weight: 500; color: var(--text-secondary); border-bottom: 2px solid transparent; transition: color 0.15s, border-color 0.15s; margin-bottom: -1px; }
.detail-tab:hover { color: var(--text); }
.detail-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
/* 评论 */
.comments-list { padding: 16px 24px; display: flex; flex-direction: column; gap: 16px; }
.list-total-header { font-size: 12px; color: var(--text-tertiary); padding-bottom: 8px; border-bottom: 1px solid var(--border); margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between; }
.comment-sort-bar { display: flex; gap: 4px; }
.comment-sort-btn { padding: 3px 10px; border-radius: 12px; font-size: 11px; color: var(--text-tertiary); background: var(--bg-elev-1); transition: all 0.15s; }
.comment-sort-btn:hover { color: var(--text); }
.comment-sort-btn.active { background: var(--accent); color: #fff; font-weight: 600; }
.comment-item { display: flex; gap: 12px; }
.comment-avatar { width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; object-fit: cover; }
.comment-body { flex: 1; min-width: 0; }
.comment-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.comment-user { font-size: 13px; font-weight: 600; color: var(--text); }
.comment-loc { font-size: 10px; color: var(--text-tertiary); margin-left: auto; }
.comment-likes { font-size: 11px; color: var(--text-tertiary); }
.comment-content { font-size: 13px; color: var(--text-secondary); line-height: 1.5; word-break: break-word; }
/* 收藏者 */
.subs-list { padding: 16px 24px; display: flex; flex-direction: column; gap: 8px; }
.sub-item { display: flex; align-items: center; gap: 12px; padding: 6px 8px; border-radius: var(--radius-sm); transition: background 0.15s; }
.sub-item:hover { background: var(--bg-hover); }
.sub-avatar { width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; object-fit: cover; }
.sub-info { flex: 1; min-width: 0; }
.sub-name { font-size: 13px; color: var(--text); font-weight: 500; }
.sub-sig { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }
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

/* 歌曲行操作按钮（喜欢 + 添加到歌单，艺术家右侧） */
.col-artist { display: flex; align-items: center; gap: 6px; min-width: 0; }
.artist-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); }
.row-actions { display: flex; align-items: center; gap: 2px; opacity: 0; transition: opacity 0.15s; flex-shrink: 0; }
.song-trow:hover .row-actions { opacity: 1; }
/* 已喜欢的歌曲始终显示喜欢图标 */
.row-like-btn.liked { opacity: 1 !important; }
.row-like-btn.liked .row-action-icon { filter: none; }
.row-like-btn, .row-add-pl-btn {
  width: 26px; height: 26px; border-radius: 5px;
  display: inline-flex; align-items: center; justify-content: center;
  opacity: 0.5; transition: opacity 0.15s, background 0.15s;
}
.song-trow:hover .row-like-btn, .song-trow:hover .row-add-pl-btn { opacity: 0.7; }
.row-like-btn:hover, .row-add-pl-btn:hover { opacity: 1 !important; background: var(--bg-hover); }
.row-like-btn.liked { opacity: 1; }
.row-action-icon { width: 15px; height: 15px; pointer-events: none; }

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
.pl-dialog-song { display: none; }
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

/* 确认删除对话框 */
.confirm-dialog {
  width: 340px; max-width: 90vw;
  background: var(--bg-elev-3); border: 1px solid var(--border-strong);
  border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  padding: 24px; text-align: center;
}
.confirm-dialog-icon { color: #faad14; margin-bottom: 12px; display: flex; justify-content: center; }
.confirm-dialog-title { margin: 0 0 8px; font-size: 16px; font-weight: 700; }
.confirm-dialog-message { margin: 0 0 20px; font-size: 13px; color: var(--text-secondary); line-height: 1.5; }
.confirm-dialog-actions { display: flex; gap: 10px; justify-content: center; }
.confirm-btn-cancel {
  padding: 8px 20px; border-radius: 8px; font-size: 13px;
  color: var(--text-secondary); border: 1px solid var(--border);
  transition: all 0.15s;
}
.confirm-btn-cancel:hover { color: var(--text); background: var(--bg-hover); }
.confirm-btn-ok {
  padding: 8px 20px; border-radius: 8px; font-size: 13px;
  color: #fff; background: #ff4d4f; transition: all 0.15s;
}
.confirm-btn-ok:hover { background: #ff7875; }
</style>
