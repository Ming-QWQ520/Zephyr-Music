<script setup lang="ts">
/**
 * 左侧封面 + 控制区（left-pane）—— 3D 翻转卡片版
 *
 * 当点击百科按钮时，整个左侧面板沿 Y 轴 3D 翻转一次：
 *   - 正面 (front)：封面 + 歌名 + 艺术家 + 控件（播放/上一首/下一首/进度/音量）
 *   - 背面 (back)：歌曲百科内容（含顶部紧凑歌曲信息条 + 4 个 block + 底部 close 按钮）
 *
 * 从 useNowPlaying 取：playMode/volumeFrac/progressFrac/song/coverUrl/wikiSummary 等。
 */
import Icon from "@/components/Icon.vue";
import Slider from "@/components/Slider.vue";
import { formatTime } from "@/composables/utils";
import { useNowPlaying, PLAY_MODE_LABEL, PLAY_MODE_ICON } from "./useNowPlaying";
import { usePlayerStore } from "@/stores/player";
import { neteaseSongToSong, getCachedLikeList, getCachedUser, songLike, addLikeCache, removeLikeCache, getCachedPlaylists, playlistTracks, type NeteasePlaylist } from "@/api/netease";
import type { Song } from "@/types";
import { computed, ref, onMounted, onUnmounted } from "vue";
import type { WikiBlock, WikiCreative } from "@/api/netease";
import { useToast } from "@/composables/useToast";

const toast = useToast();

const {
  store,
  settings,
  song,
  coverUrl,
  liked,
  likeLoading,
  toggleLike,
  playMode,
  cyclePlayMode,
  showQueue,
  toggleQueue,
  volumeFrac,
  onVolume,
  toggleMute,
  onVolWheel,
  progressFrac,
  onSeek,
  cycleAudioLevel,
  currentLevelLabel,
  getLyricAtTime,
  chorusMarkFrac,
  jumpToChorus,
  showWiki,
  toggleWiki,
  closeWiki,
  wikiSummary,
  wikiLoading,
} = useNowPlaying();

const player = usePlayerStore();

// ===== 百科数据派生 =====
const wikiBlocks = computed<WikiBlock[]>(() => {
  const list = wikiSummary.value?.blocks || wikiSummary.value?.data?.blocks || [];
  return [...list].sort((a, b) => parseInt(a.position) - parseInt(b.position));
});
const blockByShowType = (st: string): WikiBlock | undefined =>
  wikiBlocks.value.find(b => b.showType === st);
const memoryBlock = computed(() => blockByShowType("MUSIC_MEMORY_MULTI_TWO_GRID"));
const basicBlock = computed(() => blockByShowType("SONG_PLAY_ABOUT_TAB_SONG_BASIC"));
const similarSongsBlock = computed(() => blockByShowType("LIST_SONG"));
const relatedPlaylistsBlock = computed(() => blockByShowType("PLAYLIST_MULTI_THREE_GRID"));

const memoryItems = computed(() => {
  const cr = memoryBlock.value?.creatives?.[0];
  if (!cr) return [];
  return (cr.resources || []).map(r => {
    const ext = r.resourceExt || {};
    if (ext.musicFirstListenDto) {
      const d = ext.musicFirstListenDto;
      return { kind: "first" as const, title: "首次聆听", date: d.date || "", season: d.season || "", period: d.period || "" };
    }
    if (ext.musicTotalPlayDto) {
      const d = ext.musicTotalPlayDto;
      return { kind: "total" as const, title: "累计播放", playCount: d.playCount ?? 0, text: d.text || "" };
    }
    return null;
  }).filter(Boolean) as any[];
});

/** 音乐百科块每项渲染数据（曲风/标签/语种/BPM/影视节目等 tag 形式） */
interface BasicItem { label: string; values: string[]; }
const basicItems = computed<BasicItem[]>(() => {
  const crs: WikiCreative[] = basicBlock.value?.creatives || [];
  // 排除 sheet（乐谱单独渲染）和 songComment（乐评单独渲染）
  return crs.filter(cr => cr.creativeType !== "sheet" && cr.creativeType !== "songComment").map(cr => {
    const label = cr.uiElement?.mainTitle?.title || "";
    const values: string[] = [];
    for (const tl of cr.uiElement?.textLinks || []) if (tl.text) values.push(tl.text);
    for (const r of cr.resources || []) {
      const t = r.uiElement?.mainTitle?.title;
      if (t) values.push(t);
    }
    return { label, values };
  }).filter(it => it.values.length > 0);
});

/** 乐评（songComment creative）— 显示评论者 + 评论内容 + 点赞按钮 */
interface SongCommentItem { author: string; text: string; }
const songComment = computed<SongCommentItem | null>(() => {
  const crs: WikiCreative[] = basicBlock.value?.creatives || [];
  const cr = crs.find(c => c.creativeType === "songComment");
  if (!cr) return null;
  const r = cr.resources?.[0];
  if (!r) return null;
  const title = r.uiElement?.mainTitle?.title || "";  // "乐评来自 小悦同学_yy"
  const author = title.replace(/^乐评来自\s*/, "").trim();
  const text = r.uiElement?.descriptions?.[0]?.description || "";
  if (!author && !text) return null;
  return { author, text };
});

/** 乐评点赞状态（本地切换，无 commentId 无法调 API，仅视觉反馈） */
const commentLiked = ref(false);
function toggleCommentLike() {
  commentLiked.value = !commentLiked.value;
}

/** 乐谱（sheet creative）— 缩略图列表 + 数量按钮 */
interface SheetItem { id: number; title: string; img: string; }
const sheets = computed<{ items: SheetItem[]; countText: string }>(() => {
  const crs: WikiCreative[] = basicBlock.value?.creatives || [];
  const cr = crs.find(c => c.creativeType === "sheet");
  if (!cr) return { items: [], countText: "" };
  // 数量按钮（如 "8个"）
  const countText = cr.uiElement?.buttons?.[0]?.text || "";
  // 乐谱缩略图（每张对应一个 musicSheetId）
  const items: SheetItem[] = [];
  for (const r of cr.resources || []) {
    const img = r.uiElement?.images?.[0]?.imageUrl || "";
    const title = r.uiElement?.images?.[0]?.title || "";
    // 从 action.targetUrl 提取 musicSheetId
    const m = (r.action?.clickAction?.targetUrl || "").match(/musicSheetId=(\d+)/);
    const id = m ? parseInt(m[1]) : 0;
    if (img && id > 0) items.push({ id, title, img });
  }
  return { items, countText };
});

/** 乐谱详情查看（点击缩略图弹出大图查看） */
const sheetViewer = ref<{ visible: boolean; img: string; title: string }>({ visible: false, img: "", title: "" });
function openSheet(s: SheetItem) {
  sheetViewer.value = { visible: true, img: s.img, title: s.title };
}
function closeSheetViewer() {
  sheetViewer.value.visible = false;
}

const similarSongs = computed(() => {
  const cr = similarSongsBlock.value?.creatives?.[0];
  if (!cr) return [];
  return (cr.resources || []).slice(0, 8).map(r => {
    const itu = r.uiElement || {};
    const title = itu.mainTitle?.title || "";
    const sub = itu.subTitles?.[0]?.title || "";
    const img = itu.images?.[0]?.imageUrl || "";
    const desc = itu.descriptions?.[0]?.description || "";
    const id = parseInt(r.resourceId || "0");
    return { id, title, sub, img, desc };
  }).filter(s => s.id > 0);
});

const relatedPlaylists = computed(() => {
  const crs = relatedPlaylistsBlock.value?.creatives || [];
  const list: any[] = [];
  for (const cr of crs) {
    for (const r of cr.resources || []) {
      const itu = r.uiElement || {};
      const title = itu.mainTitle?.title || "";
      const img = itu.images?.[0]?.imageUrl || "";
      const id = parseInt(r.resourceId || "0");
      const playCount = r.resourceExt?.playCount || 0;
      if (id > 0) list.push({ id, title, img, playCount });
      if (list.length >= 6) return list;
    }
  }
  return list;
});

function formatCount(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + "亿";
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  return String(n);
}

async function playSimilarSong(s: { id: number; title: string; sub: string; img: string }) {
  if (!s.id) return;
  const newSong = neteaseSongToSong({
    id: s.id, name: s.title,
    ar: s.sub.split("/").map(n => ({ id: 0, name: n.trim() })),
    al: { id: 0, name: "", picUrl: s.img }, dt: 0,
  });
  if (s.img) newSong.pic = s.img.includes("?param=") ? s.img : s.img + "?param=200x200";
  await player.playNow(newSong);
}

function openRelatedPlaylist(p: { id: number }) {
  if (!p.id) return;
  player.pendingPlaylistId = p.id;
  player.setView("netease");
}

const hasAnyContent = computed(() =>
  memoryItems.value.length > 0 || basicItems.value.length > 0
  || similarSongs.value.length > 0 || relatedPlaylists.value.length > 0
  || songComment.value !== null || sheets.value.items.length > 0
);

// ===== 右键菜单（百科中相似歌曲）=====
const contextMenu = ref<{ visible: boolean; x: number; y: number; song: Song | null }>({ visible: false, x: 0, y: 0, song: null });
const ctxSongLiked = ref(false);
const showPlayNextSub = ref(false);

function onSongContextMenu(e: MouseEvent, s: { id: number; title: string; sub: string; img: string }) {
  e.preventDefault();
  e.stopPropagation();
  if (!s.id) return;
  const newSong = neteaseSongToSong({
    id: s.id, name: s.title,
    ar: s.sub.split("/").map(n => ({ id: 0, name: n.trim() })),
    al: { id: 0, name: "", picUrl: s.img }, dt: 0,
  });
  if (s.img) newSong.pic = s.img.includes("?param=") ? s.img : s.img + "?param=200x200";
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, song: newSong };
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
    contextMenu.value = { visible: true, x, y, song: newSong };
  });
  if (newSong.neteaseId) {
    getCachedLikeList().then(set => { ctxSongLiked.value = set.has(newSong.neteaseId!); }).catch(() => {});
  } else { ctxSongLiked.value = false; }
}
function closeContextMenu() { contextMenu.value.visible = false; showPlayNextSub.value = false; }
function ctxPlay() { if (contextMenu.value.song) player.playNow(contextMenu.value.song); closeContextMenu(); }
function ctxPlayNext() { if (contextMenu.value.song) player.playNext(contextMenu.value.song); closeContextMenu(); }
function ctxPlayLast() { if (contextMenu.value.song) player.addToQueue(contextMenu.value.song); closeContextMenu(); }
async function ctxToggleLike() {
  const s = contextMenu.value.song;
  if (!s || s.source !== "netease" || !s.neteaseId) return;
  const user = await getCachedUser();
  if (!user) { toast.error("请先登录"); closeContextMenu(); return; }
  try {
    const newLike = !ctxSongLiked.value;
    await songLike(s.neteaseId, user.userId, newLike);
    ctxSongLiked.value = newLike;
    if (newLike) addLikeCache(s.neteaseId); else removeLikeCache(s.neteaseId);
    toast.success(newLike ? "已喜欢" : "已取消喜欢", s.name);
  } catch { /* ignore */ }
  closeContextMenu();
}

// 添加到歌单对话框
const addToPlaylistDialog = ref<{ visible: boolean; song: Song | null }>({ visible: false, song: null });
const playlists = ref<NeteasePlaylist[]>([]);
function ctxOpenAddToPlaylistDialog() {
  const s = contextMenu.value.song;
  if (!s || s.source !== "netease") return;
  closeContextMenu();
  addToPlaylistDialog.value = { visible: true, song: s };
  getCachedPlaylists().then(pls => { playlists.value = pls; });
}
function closeAddToPlaylistDialog() { addToPlaylistDialog.value.visible = false; }
function confirmAddToPlaylist(pl: NeteasePlaylist) {
  const s = addToPlaylistDialog.value.song;
  if (!s || !s.neteaseId) return;
  closeAddToPlaylistDialog();
  playlistTracks("add", pl.id, s.neteaseId).then(() => {
    toast.success("添加成功", `已添加到「${pl.name}」`);
  }).catch(() => { toast.error("添加失败", "请稍后重试"); });
}

function onDocClick() { closeContextMenu(); }
onMounted(() => { document.addEventListener("click", onDocClick); });
onUnmounted(() => { document.removeEventListener("click", onDocClick); });
</script>

<template>
  <section class="left-pane-flip" :class="{ flipped: showWiki }" :style="{ '--perspective': '1400px' }">
    <!-- ===== 正面：封面 + 控件 ===== -->
    <div class="flip-face flip-front" :class="[
      `halign-${settings.hidePlayerControls ? 'center' : settings.coverHAlign}`,
      `valign-${settings.coverVAlign}`,
      { 'hide-controls': settings.hidePlayerControls }
    ]">
      <div class="cover-wrap" :class="{ rectangle: settings.rectangleCover, 'force-square': settings.forceSquareCover }">
        <div class="cover-shadow" v-if="settings.coverShadow" />
        <div class="cover">
          <img v-if="coverUrl" :src="coverUrl" :alt="song?.name" referrerpolicy="no-referrer" />
          <div v-else class="cover-placeholder"><Icon name="music" :size="64" /></div>
        </div>
        <button v-if="song?.source === 'netease'" class="cover-like-btn" :class="{ liked }" :disabled="likeLoading" :title="liked ? '取消喜欢' : '喜欢'" @click.stop="toggleLike">
          <img v-if="liked" src="/icons/like.svg" alt="liked" class="cover-like-icon" />
          <img v-else src="/icons/not_like.svg" alt="not liked" class="cover-like-icon" />
        </button>
      </div>

      <div class="song-meta">
        <div class="title">{{ song?.name || "—" }}</div>
        <div class="artist">{{ song?.artist || "—" }}</div>
      </div>

      <div class="controls-block" :class="{ hidden: settings.hidePlayerControls }">
        <div class="progress-row">
          <span class="time">{{ formatTime(store.currentTime) }}</span>
          <div class="progress-wrap">
            <div v-if="chorusMarkFrac !== null" class="chorus-dot" :style="{ left: (chorusMarkFrac * 100) + '%' }" @click.stop="jumpToChorus"></div>
            <Slider class="progress" :model-value="progressFrac" :always-show-on-hover="true" :format="(v) => settings.progressPreview ? getLyricAtTime(v * store.duration) : formatTime(v * store.duration)" @change="onSeek" />
          </div>
          <span class="time">{{ formatTime(store.duration) }}</span>
        </div>
        <div class="level-row">
          <button class="level-pill" :class="{ 'level-hires': settings.audioLevel === 'hires', 'level-lossless': settings.audioLevel === 'lossless' || settings.audioLevel === 'jymaster' || settings.audioLevel === 'jyeffect' || settings.audioLevel === 'sky' || settings.audioLevel === 'dolby' }" @click="cycleAudioLevel">{{ currentLevelLabel }}</button>
        </div>
        <div class="controls">
          <button class="ctrl-btn" :class="{ active: playMode !== 'sequence' }" :title="PLAY_MODE_LABEL[playMode]" @click="cyclePlayMode"><Icon :name="PLAY_MODE_ICON[playMode]" :size="20" /></button>
          <button class="ctrl-btn" :disabled="!store.hasPrev" title="上一首" @click="store.prev()"><Icon name="prev" :size="22" /></button>
          <button class="ctrl-btn play" :disabled="!song" :title="store.isPlaying ? '暂停' : '播放'" @click="store.togglePlay()"><Icon :name="store.isPlaying ? 'pause' : 'play'" :size="24" /></button>
          <button class="ctrl-btn" :disabled="!store.hasNext" title="下一首" @click="store.next()"><Icon name="next" :size="22" /></button>
          <button class="ctrl-btn" :class="{ active: showQueue }" title="播放列表" @click="toggleQueue"><Icon name="list" :size="20" /></button>
        </div>
        <div class="vol-row" @wheel="onVolWheel">
          <button class="ctrl-btn vol-icon" :title="store.muted || store.volume === 0 ? '取消静音' : '静音'" @click="toggleMute"><Icon :name="store.muted || store.volume === 0 ? 'volumeMute' : store.volume < 0.4 ? 'volumeLow' : 'volume'" :size="18" /></button>
          <Slider class="volume" :model-value="volumeFrac" :format="() => ''" :always-show-on-hover="false" :height="3" @change="onVolume" />
        </div>
      </div>

      <!-- 底部百科按钮（absolute 定位，不占布局空间，与百科界面的 close 按钮位置一致） -->
      <button v-if="song?.source === 'netease' && song?.neteaseId" class="wiki-btn" :class="{ active: showWiki }" title="歌曲百科" @click.stop="toggleWiki">
        <img src="/icons/summary.svg" alt="wiki" class="wiki-icon" />
      </button>
    </div>

    <!-- ===== 背面：歌曲百科（3D 翻转后显示）=====
         顶部歌曲信息条已移至 NpLyrics 歌词上方，这里只显示百科内容 + 底部关闭按钮 -->
    <div class="flip-face flip-back">
      <!-- 百科内容 -->
      <div class="wiki-body nice-scroll">
        <div v-if="wikiLoading" class="wiki-loading"><div class="spinner" /><span>加载中...</span></div>
        <div v-else-if="!hasAnyContent" class="wiki-empty"><Icon name="music" :size="32" /><span>暂无百科数据</span></div>
        <template v-else>
          <section v-if="memoryItems.length" class="wiki-block">
            <h3 class="block-title">{{ memoryBlock?.uiElement?.mainTitle?.title || "回忆坐标" }}</h3>
            <div class="memory-grid">
              <div v-for="(item, i) in memoryItems" :key="i" class="memory-card">
                <template v-if="item.kind === 'first'">
                  <div class="memory-label">{{ item.title }}</div>
                  <div class="memory-main">{{ item.date }}</div>
                  <div class="memory-sub">{{ item.season }} · {{ item.period }}</div>
                </template>
                <template v-else-if="item.kind === 'total'">
                  <div class="memory-label">{{ item.title }}</div>
                  <div class="memory-main">{{ formatCount(item.playCount) }}<span class="unit">次</span></div>
                  <div class="memory-sub" v-if="item.text">{{ item.text }}</div>
                </template>
              </div>
            </div>
          </section>

          <section v-if="basicItems.length" class="wiki-block">
            <h3 class="block-title">{{ basicBlock?.uiElement?.mainTitle?.title || "音乐百科" }}</h3>
            <div class="basic-list">
              <div v-for="(it, i) in basicItems" :key="i" class="basic-row">
                <div class="basic-label">{{ it.label }}</div>
                <div class="basic-values">
                  <span v-for="(v, j) in it.values" :key="j" class="basic-tag">{{ v }}</span>
                </div>
              </div>
            </div>
          </section>

          <!-- 乐谱（sheet creative，仅当返回 json 含 sheet 时显示） -->
          <section v-if="sheets.items.length" class="wiki-block">
            <h3 class="block-title">
              乐谱
              <span v-if="sheets.countText" class="sheet-count-badge">{{ sheets.countText }}</span>
            </h3>
            <div class="sheet-grid">
              <button v-for="s in sheets.items" :key="s.id" class="sheet-card" :title="`查看乐谱 · ${s.title || '乐谱'}`" @click.stop="openSheet(s)">
                <div class="sheet-thumb">
                  <img :src="s.img" :alt="s.title || '乐谱'" loading="lazy" referrerpolicy="no-referrer" />
                  <div class="sheet-thumb-overlay"><Icon name="play" :size="20" /></div>
                </div>
                <div v-if="s.title" class="sheet-title truncate">{{ s.title }}</div>
              </button>
            </div>
          </section>

          <!-- 乐评（songComment creative，仅当返回 json 含 songComment 时显示） -->
          <section v-if="songComment" class="wiki-block">
            <h3 class="block-title">乐评</h3>
            <div class="comment-card">
              <div class="comment-head">
                <div class="comment-author">
                  <img src="/icons/comment.svg" alt="comment" class="comment-icon" />
                  <span>{{ songComment.author }}</span>
                </div>
                <button class="comment-like-btn" :class="{ liked: commentLiked }" :title="commentLiked ? '取消点赞' : '点赞'" @click.stop="toggleCommentLike">
                  <img v-if="commentLiked" src="/icons/like.svg" alt="liked" class="comment-like-icon" />
                  <img v-else src="/icons/not_like.svg" alt="not liked" class="comment-like-icon" />
                </button>
              </div>
              <p class="comment-text">{{ songComment.text }}</p>
            </div>
          </section>

          <section v-if="similarSongs.length" class="wiki-block">
            <h3 class="block-title">{{ similarSongsBlock?.uiElement?.mainTitle?.title || "相似歌曲" }}</h3>
            <div class="songs-grid">
              <button v-for="s in similarSongs" :key="s.id" class="song-card" @click="playSimilarSong(s)" @contextmenu.prevent="onSongContextMenu($event, s)">
                <div class="song-cover">
                  <img v-if="s.img" :src="s.img + '?param=120x120'" :alt="s.title" loading="lazy" referrerpolicy="no-referrer" />
                  <Icon v-else name="music" :size="20" />
                </div>
                <div class="song-info">
                  <div class="song-name truncate">{{ s.title }}</div>
                  <div class="song-artist truncate">{{ s.sub }}</div>
                </div>
              </button>
            </div>
          </section>

          <section v-if="relatedPlaylists.length" class="wiki-block">
            <h3 class="block-title">{{ relatedPlaylistsBlock?.uiElement?.mainTitle?.title || "相关歌单" }}</h3>
            <div class="pl-grid">
              <button v-for="p in relatedPlaylists" :key="p.id" class="pl-card" @click="openRelatedPlaylist(p)">
                <div class="pl-cover">
                  <img v-if="p.img" :src="p.img + '?param=160x160'" :alt="p.title" loading="lazy" referrerpolicy="no-referrer" />
                  <Icon v-else name="music" :size="20" />
                </div>
                <div class="pl-name truncate" :title="p.title">{{ p.title }}</div>
                <div class="pl-count">{{ formatCount(p.playCount) }}次播放</div>
              </button>
            </div>
          </section>
        </template>
      </div>

      <!-- 底部关闭按钮（点击 3D 翻转回正面） -->
      <button class="wiki-close" title="关闭百科" @click.stop="closeWiki">
        <img src="/icons/close.svg" alt="close" class="wiki-close-icon" />
      </button>

      <!-- 乐谱详情查看（点击乐谱缩略图弹出大图） -->
      <Transition name="sheet-viewer-fade">
        <div v-if="sheetViewer.visible" class="sheet-viewer-overlay" @click.stop="closeSheetViewer">
          <div class="sheet-viewer-panel" @click.stop>
            <header class="sheet-viewer-header">
              <span class="sheet-viewer-title truncate">{{ sheetViewer.title || '乐谱' }}</span>
              <button class="sheet-viewer-close" title="关闭" @click.stop="closeSheetViewer">
                <img src="/icons/close.svg" alt="close" class="sheet-viewer-close-icon" />
              </button>
            </header>
            <div class="sheet-viewer-body nice-scroll">
              <img :src="sheetViewer.img" :alt="sheetViewer.title || '乐谱'" class="sheet-viewer-img" referrerpolicy="no-referrer" @click.stop="closeSheetViewer" />
            </div>
          </div>
        </div>
      </Transition>
    </div>

    <!-- 右键菜单（Teleport 到 body，避免 3D transform 上下文导致 position:fixed 失效） -->
    <Teleport to="body">
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
    </Teleport>

    <!-- 添加到歌单对话框（Teleport 到 body） -->
    <Teleport to="body">
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
    </Teleport>
  </section>
</template>

<style scoped>
/* ===== 3D 翻转卡片容器 ===== */
.left-pane-flip {
  /* perspective 让子元素 3D 翻转有立体感 */
  perspective: var(--perspective, 1400px);
  perspective-origin: center center;
  /* 占满 grid 列；高度由父级 np-main 控制 */
  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
}
.flip-face {
  /* 两个面叠在同一位置：absolute 占满父级 */
  position: absolute;
  inset: 0;
  /* 3D 翻转：preserve-3d 让 rotateY 起作用；backface-visibility 让背面隐藏 */
  transform-style: preserve-3d;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  /* 翻转动画 */
  transition: transform 0.7s cubic-bezier(0.4, 0.0, 0.2, 1);
  will-change: transform;
}
.flip-front {
  /* 正面默认朝前 */
  transform: rotateY(0deg);
}
.flip-back {
  /* 背面默认翻转 180°（背朝前，看不见） */
  transform: rotateY(180deg);
  /* 背景黑色透明度 0.3 */
  background: rgba(0, 0, 0, 0.3);
  /* 背面是百科面板布局（垂直 header + body + footer） */
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
}
/* 翻转后：正面朝后（看不见），背面朝前（看见） */
.left-pane-flip.flipped .flip-front {
  transform: rotateY(-180deg);
}
.left-pane-flip.flipped .flip-back {
  transform: rotateY(0deg);
}
/* 翻转后隐藏正面上的百科按钮（backface-visibility 已隐藏整个面板，
   但 absolute 定位的按钮可能穿透，额外用 visibility 兜底）。
   visibility 延迟 0.35s 显示（翻转动画 0.7s 的一半），避免翻转中途按钮闪现。 */
.left-pane-flip.flipped .wiki-btn {
  visibility: hidden;
}

/* ===== 正面（封面 + 控件）沿用原 .left-pane 样式 ===== */
.flip-front {
  /* 不设 position: relative（已 absolute），避免创建 stacking context 导致歌词溢出被遮挡 */
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 20px;
  min-height: 0;
  padding: 0;
  /* 不让内容溢出（hide-controls 时仍能撑开高度） */
  background: transparent;
}
.flip-front.halign-center { align-items: center; }
.flip-front.halign-right { align-items: flex-end; }
.flip-front.valign-top { justify-content: flex-start; padding-top: 24px; }
.flip-front.valign-bottom { justify-content: flex-end; padding-bottom: 24px; }

.cover-wrap {
  position: relative;
  width: clamp(260px, 26vw, 460px);
  aspect-ratio: 1 / 1;
  flex-shrink: 0;
}
.cover-wrap.rectangle { aspect-ratio: 1 / 1; border-radius: 12px; }
.cover-wrap.rectangle .cover { border-radius: 12px; }
/* 强制 1:1 正方形封面：用 padding-top: 100% 替代 aspect-ratio，兼容性更好 */
.cover-wrap.force-square {
  aspect-ratio: auto;
  height: auto;
  /* padding-top: 100% 创造一个正方形容器（宽=高） */
  padding-top: 0;
}
.cover-wrap.force-square .cover {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 12px;
}
.cover-wrap.force-square .cover img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}
/* 用一个伪元素撑出正方形高度（比 aspect-ratio 兼容性更好） */
.cover-wrap.force-square::before {
  content: "";
  display: block;
  padding-top: 100%; /* 宽:高 = 1:1 */
}
/* 封面右下角喜欢按钮 */
.cover-like-btn {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 10; /* 喜欢按钮在歌词之上 */
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(2px);
  transition: background 0.2s, transform 0.12s;
  z-index: 5;
}
.cover-like-btn:hover {
  background: rgba(0, 0, 0, 0.25);
  transform: scale(1.08);
}
.cover-like-btn:active { transform: scale(0.95); }
.cover-like-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.cover-like-icon { width: 20px; height: 20px; display: inline-block; pointer-events: none; }
.cover-shadow {
  position: absolute;
  inset: 0;
  border-radius: 12px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55), 0 12px 32px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}
.cover {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-elev-3);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  background: linear-gradient(135deg, #2a2a30 0%, #0d0d0f 100%);
}

.song-meta {
  max-width: 100%;
  width: clamp(260px, 26vw, 460px);
  transition: opacity 0.3s var(--ease-out);
}
.song-meta .title {
  font-size: clamp(20px, 2vw, 32px);
  font-weight: 700;
  letter-spacing: -0.3px;
  color: var(--text);
  flex: 1;
  min-width: 0;
}
/* 百科按钮：absolute 定位在正面底部居中，不占布局空间（不会撑高面板） */
.wiki-btn {
  position: absolute;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.65);
  transition: background 0.15s, color 0.15s, visibility 0s linear 0.35s;
  padding: 0;
  z-index: 10;
}
.wiki-btn:hover {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}
.wiki-btn:active { transform: translateX(-50%) scale(0.92); }
.wiki-btn.active {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}
.wiki-icon {
  width: 18px;
  height: 18px;
  pointer-events: none;
  filter: brightness(0) invert(1) opacity(var(--icon-opacity, 0.85));
  transition: filter 0.15s;
}
.wiki-btn:hover .wiki-icon,
.wiki-btn.active .wiki-icon {
  filter: brightness(0) invert(1) opacity(1);
}
.song-meta .artist {
  font-size: clamp(12px, 1.2vw, 18px);
  color: var(--text-secondary);
  margin-top: 4px;
}

.controls-block {
  width: clamp(260px, 26vw, 460px);
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 10; /* 控件在歌词之上（歌词 z-index 5）*/
  gap: 8px;
  transition: opacity 0.3s var(--ease-out), max-height 0.3s var(--ease-out), margin 0.3s var(--ease-out);
  max-height: 320px;
  overflow: visible; /* allow tooltip to show above progress bar */
}
/* 音质选择 pill */
.level-row { display: flex; justify-content: center; }
.level-pill {
  padding: 3px 12px; border-radius: 12px;
  background: var(--bg-elev-3); color: var(--text-secondary);
  font-size: 11px; font-weight: 500; transition: all 0.15s;
}
.level-pill:hover { color: var(--accent); background: var(--accent-soft); }
/* Hi-Res 金色 - 标志性 Hi-Res Audio 金色 */
.level-pill.level-hires {
  background: linear-gradient(135deg, #FFD700, #FFA500);
  color: #1a1a1a;
  font-weight: 700;
  border: 1px solid #FFD700;
  box-shadow: 0 0 12px rgba(255, 215, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
}
.level-pill.level-hires:hover {
  background: linear-gradient(135deg, #FFE55C, #FFB733);
  box-shadow: 0 0 18px rgba(255, 215, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.5);
}
/* 无损/超清母带等高品质音质 - 银白色微光 */
.level-pill.level-lossless {
  background: linear-gradient(135deg, #E8E8E8, #B0B0B0);
  color: #1a1a1a;
  font-weight: 600;
  border: 1px solid #C0C0C0;
  box-shadow: 0 0 8px rgba(192, 192, 192, 0.4);
}
.level-pill.level-lossless:hover {
  background: linear-gradient(135deg, #F5F5F5, #C8C8C8);
}
/* When hidePlayerControls is on, ALL playback controls collapse to zero height */
.controls-block.hidden {
  opacity: 0;
  pointer-events: none;
  max-height: 0;
  margin-top: -20px; /* negate the left-pane gap so cover stays centered */
}
.progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.progress-wrap { position: relative; flex: 1; display: flex; align-items: center; }
.progress-row .progress { flex: 1; }
.time {
  font-size: 11px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  min-width: 38px;
  text-align: center;
}
/* ===== 高潮点标记：进度条上的白圆点（点击跳转） ===== */
.chorus-dot {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.55), 0 0 4px rgba(255, 255, 255, 0.6);
  pointer-events: auto;
  cursor: pointer;
  z-index: 2;
  /* Force GPU compositing for sub-pixel anti-aliasing (消除锯齿) */
  will-change: transform;
  backface-visibility: hidden;
  transition: width 0.15s var(--ease-out), height 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
}
/* 随进度条 hover 变粗而变大（默认 4px → hover 8px，匹配 track 3px → 7px） */
.progress-wrap:hover .chorus-dot,
.chorus-dot:hover {
  width: 8px;
  height: 8px;
  box-shadow: 0 0 3px rgba(0, 0, 0, 0.55), 0 0 6px rgba(255, 255, 255, 0.85);
}
.controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.ctrl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.78);
  transition: color 0.15s, background 0.15s, transform 0.12s;
}
.ctrl-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}
.ctrl-btn:active { transform: scale(0.92); }
.ctrl-btn.active { color: #ffffff; }
.ctrl-btn[disabled] { opacity: 0.35; cursor: not-allowed; pointer-events: none; }
/* 播放按钮：无圆形白色背景，与其他按钮一致 */
.ctrl-btn.play {
  width: 44px;
  height: 44px;
  color: var(--text);
}
.ctrl-btn.play:hover {
  color: #fff;
  transform: scale(1.06);
}
.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.vol-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  /* 起始位置与进度滑块对齐（progress-row 左 time+gap = 48px，vol-row button+gap = 44px，差 4px）；
   * 末端对齐到进度行右侧"总时长文字"的一半：
   *   progress-row 右侧 dur 文字单元格占 38px（text-align center），中点在 row_w - 19；
   *   vol-row content area = row_w - 4 - 19 = row_w - 23，slider 占 row_w - 23 - 36 - 8 = row_w - 67，
   *   slider 右端 = 4 + 36 + 8 + (row_w - 67) = row_w - 19 ✓ 正好落在 dur 文字中点。 */
  padding-left: 4px;
  padding-right: 19px;
  box-sizing: border-box;
}
.vol-row .volume { flex: 1; }

/* ===== 背面百科面板样式 ===== */
/* 百科主体（顶部歌曲信息条已移至 NpLyrics 歌词上方） */
.wiki-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden; /* 防止 pl-grid 等内容横向溢出导致底部出现横向滚动条 */
  padding: 20px 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
  /* 子元素最小宽度 0，避免 grid item 强制撑开 */
  min-width: 0;
}

/* 加载/空态 */
.wiki-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
}
.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-top-color: rgba(255, 255, 255, 0.85);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.wiki-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 13px;
}

/* Block */
.wiki-block { display: flex; flex-direction: column; }
.block-title {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.block-title::before {
  content: "";
  display: inline-block;
  width: 3px;
  height: 12px;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 2px;
}

/* 回忆坐标 */
.memory-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.memory-card {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.memory-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.55);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.memory-main {
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  line-height: 1.3;
}
.memory-main .unit {
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.65);
  margin-left: 2px;
}
.memory-sub {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.55);
}

/* 音乐百科 */
.basic-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.basic-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
}
.basic-label {
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.55);
  min-width: 48px;
  flex-shrink: 0;
  padding-top: 3px;
}
.basic-values {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.basic-tag {
  font-size: 11px;
  padding: 2px 9px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
}

/* 相似歌曲 — 单列列表布局，封面+文字清晰不拥挤 */
.songs-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.song-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
  border: none;
  color: inherit;
  min-width: 0;
}
.song-card:hover { background: rgba(255, 255, 255, 0.1); }
.song-cover {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.4);
}
.song-cover img { width: 100%; height: 100%; object-fit: cover; }
.song-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.song-name {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  line-height: 1.3;
}
.song-artist {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.2;
}

/* 相关歌单 — 2 列 grid，封面大文字清晰 */
.pl-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  /* 防止子元素过宽撑破 grid 导致横向滚动条 */
  min-width: 0;
}
.pl-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
  transition: transform 0.15s;
  text-align: left;
  border: none;
  background: transparent;
  padding: 0;
  color: inherit;
  /* grid item 最小宽度 0，允许内容收缩 */
  min-width: 0;
}
.pl-card:hover { transform: translateY(-2px); }
.pl-cover {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.4);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}
.pl-cover img { width: 100%; height: 100%; object-fit: cover; }
.pl-name {
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.3;
  margin-top: 2px;
  /* truncate 配合 min-width:0 在 grid item 内生效 */
  min-width: 0;
  max-width: 100%;
}
.pl-count {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
}

/* 底部关闭按钮 */
.wiki-close {
  flex-shrink: 0;
  align-self: center;
  width: 36px;
  height: 36px;
  margin: 8px auto 8px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.65);
  transition: all 0.15s;
  padding: 0;
}
.wiki-close:hover {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  transform: scale(1.08);
}
.wiki-close:active { transform: scale(0.92); }
.wiki-close-icon {
  width: 18px;
  height: 18px;
  pointer-events: none;
  filter: brightness(0) invert(1) opacity(0.85);
}
.wiki-close:hover .wiki-close-icon {
  filter: brightness(0) invert(1) opacity(1);
}

/* ===== 乐谱块 ===== */
.sheet-count-badge {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  text-transform: none;
  letter-spacing: 0;
}
.sheet-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  min-width: 0;
}
.sheet-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  cursor: pointer;
  border: none;
  background: transparent;
  padding: 0;
  color: inherit;
  text-align: left;
  min-width: 0;
  transition: transform 0.15s;
}
.sheet-card:hover { transform: translateY(-2px); }
.sheet-thumb {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.3);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}
.sheet-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.sheet-thumb-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  opacity: 0;
  transition: opacity 0.15s;
  color: #fff;
}
.sheet-card:hover .sheet-thumb-overlay { opacity: 1; }
.sheet-title {
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.3;
  text-align: center;
  min-width: 0;
  max-width: 100%;
}

/* ===== 乐评块 ===== */
.comment-card {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.comment-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.comment-author {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  flex: 1;
  min-width: 0;
}
.comment-icon {
  width: 14px;
  height: 14px;
  pointer-events: none;
  filter: brightness(0) invert(1) opacity(0.85);
  flex-shrink: 0;
}
/* 乐评点赞按钮 */
.comment-like-btn {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.55);
  transition: all 0.15s;
  padding: 0;
}
.comment-like-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  transform: scale(1.08);
}
.comment-like-btn:active { transform: scale(0.92); }
.comment-like-btn.liked { color: #fa233b; }
.comment-like-icon {
  width: 16px;
  height: 16px;
  pointer-events: none;
  /* 默认空心（not_like.svg #fff fill）→ 灰白；点赞时实心（like.svg）→ 红色 */
  filter: brightness(0) invert(1) opacity(0.65);
  transition: filter 0.15s;
}
.comment-like-btn:hover .comment-like-icon {
  filter: brightness(0) invert(1) opacity(1);
}
.comment-like-btn.liked .comment-like-icon {
  /* 已点赞：用 accent 红色填充（去除 invert 滤镜，直接显示原色但需着色）
   * not_like/like SVG 是白色 fill，已点赞态用 hue-rotate 转红 */
  filter: brightness(0) invert(1) sepia(1) saturate(15) hue-rotate(-25deg) brightness(1.1);
}
.comment-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.7);
  /* 保留换行 */
  white-space: pre-wrap;
  word-break: break-word;
}

/* ===== 乐谱详情查看（大图弹窗）===== */
.sheet-viewer-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.sheet-viewer-panel {
  position: relative;
  max-width: 90%;
  max-height: 90%;
  background: rgba(20, 18, 24, 0.95);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.sheet-viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}
.sheet-viewer-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
}
.sheet-viewer-close {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.65);
  transition: all 0.15s;
  padding: 0;
}
.sheet-viewer-close:hover { color: #fff; background: rgba(255, 255, 255, 0.12); }
.sheet-viewer-close-icon {
  width: 16px;
  height: 16px;
  pointer-events: none;
  filter: brightness(0) invert(1) opacity(0.85);
}
.sheet-viewer-close:hover .sheet-viewer-close-icon { filter: brightness(0) invert(1) opacity(1); }
.sheet-viewer-body {
  flex: 1;
  overflow: auto;
  padding: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  max-height: 70vh;
}
.sheet-viewer-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 6px;
  cursor: zoom-out;
}
/* 弹窗过渡 */
.sheet-viewer-fade-enter-active,
.sheet-viewer-fade-leave-active {
  transition: opacity 0.2s var(--ease-out, ease);
}
.sheet-viewer-fade-enter-active .sheet-viewer-panel,
.sheet-viewer-fade-leave-active .sheet-viewer-panel {
  transition: transform 0.25s var(--ease-out, cubic-bezier(0.2, 0.8, 0.2, 1));
}
.sheet-viewer-fade-enter-from,
.sheet-viewer-fade-leave-to { opacity: 0; }
.sheet-viewer-fade-enter-from .sheet-viewer-panel,
.sheet-viewer-fade-leave-to .sheet-viewer-panel { transform: scale(0.92); }

/* ===== 右键菜单 + 添加到歌单对话框（Teleport 到 body，需要非 scoped 样式）===== */
/* 由于 Teleport 到 body 外，scoped 样式不生效，用 :global 包裹 */
:global(.ctx-menu) { position: fixed; z-index: 500; min-width: 180px; background: rgba(30, 28, 34, 0.96); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,0.5); padding: 4px; }
:global(.ctx-item) { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; border-radius: 6px; font-size: 13px; color: rgba(255,255,255,0.9); text-align: left; transition: background 0.1s; background: transparent; border: none; cursor: pointer; }
:global(.ctx-item:hover) { background: rgba(255,255,255,0.1); color: #fff; }
:global(.ctx-item .ctx-arrow) { margin-left: auto; opacity: 0.5; }
:global(.ctx-like-icon) { width: 14px; height: 14px; filter: brightness(0) invert(1) opacity(0.85); }
:global(.ctx-divider) { height: 1px; background: rgba(255,255,255,0.1); margin: 4px 8px; }
:global(.ctx-item-wrapper) { position: relative; }
:global(.ctx-flyout) { position: absolute; left: 100%; top: 0; min-width: 150px; background: rgba(30, 28, 34, 0.96); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,0.5); padding: 4px; margin-left: 4px; }
:global(.ctx-flyout-item) { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; border-radius: 6px; font-size: 13px; color: rgba(255,255,255,0.9); text-align: left; transition: background 0.1s; background: transparent; border: none; cursor: pointer; }
:global(.ctx-flyout-item:hover) { background: rgba(255,255,255,0.1); color: #fff; }
:global(.ctx-fade-enter-active), :global(.ctx-fade-leave-active) { transition: opacity 0.12s, transform 0.12s; }
:global(.ctx-fade-enter-from), :global(.ctx-fade-leave-to) { opacity: 0; transform: scale(0.95); }

:global(.pl-dialog-overlay) { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; }
:global(.pl-dialog) { width: 380px; max-width: 90vw; max-height: 70vh; background: rgba(30, 28, 34, 0.96); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); display: flex; flex-direction: column; overflow: hidden; }
:global(.pl-dialog-header) { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.08); }
:global(.pl-dialog-header h3) { margin: 0; font-size: 16px; font-weight: 700; color: #fff; }
:global(.pl-dialog-close) { width: 32px; height: 32px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.65); background: transparent; border: none; cursor: pointer; transition: all 0.15s; padding: 0; }
:global(.pl-dialog-close:hover) { color: #fff; background: rgba(255,255,255,0.1); }
:global(.pl-dialog-list) { flex: 1; overflow-y: auto; padding: 8px; }
:global(.pl-dialog-item) { display: flex; align-items: center; gap: 12px; width: 100%; padding: 8px 12px; border-radius: 8px; text-align: left; transition: background 0.15s; background: transparent; border: none; cursor: pointer; color: inherit; }
:global(.pl-dialog-item:hover) { background: rgba(255,255,255,0.08); }
:global(.pl-dialog-cover) { width: 40px; height: 40px; border-radius: 8px; flex-shrink: 0; background: rgba(0,0,0,0.3); overflow: hidden; display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.4); }
:global(.pl-dialog-cover img) { width: 100%; height: 100%; object-fit: cover; }
:global(.pl-dialog-info) { flex: 1; min-width: 0; }
:global(.pl-dialog-name) { font-size: 13px; color: #fff; font-weight: 500; }
:global(.pl-dialog-count) { font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 1px; }
:global(.pl-dialog-fade-enter-active), :global(.pl-dialog-fade-leave-active) { transition: opacity 0.15s; }
:global(.pl-dialog-fade-enter-from), :global(.pl-dialog-fade-leave-to) { opacity: 0; }

@keyframes spin { to { transform: rotate(360deg); } }
</style>
