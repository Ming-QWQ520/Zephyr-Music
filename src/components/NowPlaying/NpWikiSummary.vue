<script setup lang="ts">
/**
 * NpWikiSummary — 歌曲百科面板（从左侧滑入，不遮挡封面/控件/歌词）
 *
 * 布局：定位在 NowPlayingView 的左侧 45% 区域上方（覆盖左侧 cover+controls 容器），
 * 不覆盖右侧歌词。点击外部 / Esc / 关闭按钮关闭。
 * 内容：4 个 Block
 *   1) 回忆坐标 — 首次听歌时间 + 听歌次数超越百分比
 *   2) 音乐百科 — 曲风 / 推荐标签 / 语种 / BPM / 乐谱
 *   3) 相似歌曲 — 20 首，点击播放
 *   4) 相关歌单 — 20 个，点击打开
 *
 * 数据来自 useNowPlaying 的 wikiSummary / wikiLoading。
 */
import { computed } from "vue";
import { useNowPlaying } from "./useNowPlaying";
import { usePlayerStore } from "@/stores/player";
import { neteaseSongToSong } from "@/api/netease";
import type { WikiBlock, WikiCreative } from "@/api/netease";
import Icon from "@/components/Icon.vue";

const {
  showWiki,
  wikiSummary,
  wikiLoading,
  closeWiki,
} = useNowPlaying();

const player = usePlayerStore();

/** 取所有 blocks，按 position 升序 */
const blocks = computed<WikiBlock[]>(() => {
  const list = wikiSummary.value?.blocks || wikiSummary.value?.data?.blocks || [];
  return [...list].sort((a, b) => parseInt(a.position) - parseInt(b.position));
});

const blockByShowType = (st: string): WikiBlock | undefined =>
  blocks.value.find(b => b.showType === st);

const memoryBlock = computed(() => blockByShowType("MUSIC_MEMORY_MULTI_TWO_GRID"));
const basicBlock = computed(() => blockByShowType("SONG_PLAY_ABOUT_TAB_SONG_BASIC"));
const similarSongsBlock = computed(() => blockByShowType("LIST_SONG"));
const relatedPlaylistsBlock = computed(() => blockByShowType("PLAYLIST_MULTI_THREE_GRID"));

/** 提取回忆坐标两项的描述 */
const memoryItems = computed(() => {
  const cr = memoryBlock.value?.creatives?.[0];
  if (!cr) return [];
  return (cr.resources || []).map(r => {
    const ext = r.resourceExt || {};
    if (ext.musicFirstListenDto) {
      const d = ext.musicFirstListenDto;
      return {
        kind: "first" as const,
        title: "首次聆听",
        date: d.date || "",
        season: d.season || "",
        period: d.period || "",
      };
    }
    if (ext.musicTotalPlayDto) {
      const d = ext.musicTotalPlayDto;
      return {
        kind: "total" as const,
        title: "累计播放",
        playCount: d.playCount ?? 0,
        text: d.text || "",
      };
    }
    return null;
  }).filter(Boolean) as any[];
});

/** 提取音乐百科 5 个 creative */
const basicCreatives = computed<WikiCreative[]>(() => basicBlock.value?.creatives || []);

/** 音乐百科每项的渲染数据 */
interface BasicItem { label: string; values: string[]; }
const basicItems = computed<BasicItem[]>(() => {
  return basicCreatives.value.map(cr => {
    const label = cr.uiElement?.mainTitle?.title || "";
    const values: string[] = [];
    // textLinks（语种/BPM）
    const tls = cr.uiElement?.textLinks || [];
    for (const tl of tls) {
      if (tl.text) values.push(tl.text);
    }
    // resources（曲风/推荐标签）
    for (const r of cr.resources || []) {
      const t = r.uiElement?.mainTitle?.title;
      if (t) values.push(t);
    }
    return { label, values };
  }).filter(it => it.values.length > 0);
});

/** 提取相似歌曲（最多 12 首展示） */
const similarSongs = computed(() => {
  const cr = similarSongsBlock.value?.creatives?.[0];
  if (!cr) return [];
  return (cr.resources || []).slice(0, 12).map(r => {
    const itu = r.uiElement || {};
    const title = itu.mainTitle?.title || "";
    const sub = (itu.subTitles?.[0]?.title) || "";
    const img = (itu.images?.[0]?.imageUrl) || "";
    const desc = (itu.descriptions?.[0]?.description) || "";
    const id = parseInt(r.resourceId || "0");
    return { id, title, sub, img, desc };
  }).filter(s => s.id > 0);
});

/** 提取相关歌单（最多 12 个展示） */
const relatedPlaylists = computed(() => {
  const crs = relatedPlaylistsBlock.value?.creatives || [];
  const list: any[] = [];
  for (const cr of crs) {
    for (const r of cr.resources || []) {
      const itu = r.uiElement || {};
      const title = itu.mainTitle?.title || "";
      const img = (itu.images?.[0]?.imageUrl) || "";
      const id = parseInt(r.resourceId || "0");
      const playCount = r.resourceExt?.playCount || 0;
      if (id > 0) list.push({ id, title, img, playCount });
      if (list.length >= 12) return list;
    }
  }
  return list;
});

/** 格式化播放量（万/亿） */
function formatCount(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + "亿";
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  return String(n);
}

/** 播放相似歌曲：构造 Song 并 playNow */
async function playSimilarSong(s: { id: number; title: string; sub: string; img: string }) {
  if (!s.id) return;
  // 用 neteaseSongToSong 兼容结构构造一个最小 Song
  const newSong = neteaseSongToSong({
    id: s.id,
    name: s.title,
    ar: s.sub.split("/").map(n => ({ id: 0, name: n.trim() })),
    al: { id: 0, name: "", picUrl: s.img },
    dt: 0,
  });
  // 修正封面 URL（带 ?param=）
  if (s.img) {
    const q = "200x200";
    newSong.pic = s.img.includes("?param=") ? s.img : s.img + `?param=${q}x${q}`;
  }
  await player.playNow(newSong);
  closeWiki();
}

/** 打开相关歌单：复用现有 openPlaylist 逻辑（pendingPlaylistId + setView("netease")） */
function openRelatedPlaylist(p: { id: number; title: string }) {
  if (!p.id) return;
  player.pendingPlaylistId = p.id;
  player.setView("netease");
  closeWiki();
}

/** 点击背景关闭 */
function onOverlayClick(e: MouseEvent) {
  // 仅当点击在 .wiki-overlay 本身（不在 panel 上）才关闭
  if ((e.target as HTMLElement)?.classList?.contains("wiki-overlay")) {
    closeWiki();
  }
}

/** 是否有可显示的内容（避免空白面板） */
const hasAnyContent = computed(() => {
  return memoryItems.value.length > 0
    || basicItems.value.length > 0
    || similarSongs.value.length > 0
    || relatedPlaylists.value.length > 0;
});
</script>

<template>
  <Transition name="wiki-slide">
    <div v-if="showWiki" class="wiki-overlay" @click="onOverlayClick">
      <aside class="wiki-panel nice-scroll" @click.stop>
        <!-- Header -->
        <header class="wiki-header">
          <div class="wiki-header-title">
            <img src="/icons/summary.svg" alt="wiki" class="wiki-header-icon" />
            <span>歌曲百科</span>
          </div>
          <button class="wiki-close-btn" title="关闭" @click="closeWiki">
            <Icon name="close" :size="18" />
          </button>
        </header>

        <!-- Loading -->
        <div v-if="wikiLoading" class="wiki-loading">
          <div class="spinner" />
          <span>加载中...</span>
        </div>

        <!-- Empty -->
        <div v-else-if="!hasAnyContent" class="wiki-empty">
          <Icon name="music" :size="32" />
          <span>暂无百科数据</span>
        </div>

        <!-- Content -->
        <div v-else class="wiki-body nice-scroll">
          <!-- Block 1: 回忆坐标 -->
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

          <!-- Block 2: 音乐百科 -->
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

          <!-- Block 3: 相似歌曲 -->
          <section v-if="similarSongs.length" class="wiki-block">
            <h3 class="block-title">{{ similarSongsBlock?.uiElement?.mainTitle?.title || "相似歌曲" }}</h3>
            <div class="songs-grid">
              <button
                v-for="s in similarSongs"
                :key="s.id"
                class="song-card"
                @click="playSimilarSong(s)"
              >
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

          <!-- Block 4: 相关歌单 -->
          <section v-if="relatedPlaylists.length" class="wiki-block">
            <h3 class="block-title">{{ relatedPlaylistsBlock?.uiElement?.mainTitle?.title || "相关歌单" }}</h3>
            <div class="pl-grid">
              <button
                v-for="p in relatedPlaylists"
                :key="p.id"
                class="pl-card"
                @click="openRelatedPlaylist(p)"
              >
                <div class="pl-cover">
                  <img v-if="p.img" :src="p.img + '?param=160x160'" :alt="p.title" loading="lazy" referrerpolicy="no-referrer" />
                  <Icon v-else name="music" :size="20" />
                </div>
                <div class="pl-name truncate" :title="p.title">{{ p.title }}</div>
                <div class="pl-count">{{ formatCount(p.playCount) }}次播放</div>
              </button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.wiki-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  display: flex;
  align-items: stretch;
}

/* Header */
.wiki-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}
.wiki-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  color: #fff;
}
.wiki-header-icon {
  width: 18px;
  height: 18px;
  filter: brightness(0) invert(1) opacity(0.9);
  pointer-events: none;
}
.wiki-close-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
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
.wiki-close-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}

/* Loading */
.wiki-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
}
.spinner {
  width: 28px;
  height: 28px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-top-color: rgba(255, 255, 255, 0.85);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* Empty */
.wiki-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 13px;
}

/* Block title */
.block-title {
  margin: 0 0 12px;
  font-size: 13px;
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
  height: 14px;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 2px;
}

/* Block: 回忆坐标 */
.memory-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.memory-card {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.memory-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.memory-main {
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  line-height: 1.3;
}
.memory-main .unit {
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.65);
  margin-left: 2px;
}
.memory-sub {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
}

/* Block: 音乐百科 */
.basic-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.basic-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
}
.basic-label {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.55);
  min-width: 56px;
  flex-shrink: 0;
  padding-top: 3px;
}
.basic-values {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.basic-tag {
  font-size: 12px;
  padding: 3px 10px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
}

/* Block: 相似歌曲 */
.songs-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.song-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
  border: none;
  color: inherit;
}
.song-card:hover {
  background: rgba(255, 255, 255, 0.1);
}
.song-cover {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.4);
}
.song-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.song-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.song-name {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  line-height: 1.3;
}
.song-artist {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.2;
}

/* Block: 相关歌单 */
.pl-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
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
}
.pl-card:hover {
  transform: translateY(-2px);
}
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
.pl-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.pl-name {
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.3;
  margin-top: 2px;
}
.pl-count {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
}

/* Transitions */
.wiki-slide-enter-active,
.wiki-slide-leave-active {
  transition: opacity 0.2s var(--ease-out, ease);
}
.wiki-slide-enter-active .wiki-panel,
.wiki-slide-leave-active .wiki-panel {
  transition: transform 0.25s var(--ease-out, cubic-bezier(0.2, 0.8, 0.2, 1));
}
.wiki-slide-enter-from,
.wiki-slide-leave-to {
  opacity: 0;
}
.wiki-slide-enter-from .wiki-panel,
.wiki-slide-leave-to .wiki-panel {
  transform: translateX(-100%);
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
