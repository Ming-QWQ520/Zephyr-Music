<script setup lang="ts">
import { ref, onActivated } from "vue";
import { usePlayerStore } from "@/stores/player";
import { recordRecentSong, recentListenList, neteaseSongToSong, songDetail, getCookie } from "@/api/netease";
import { log } from "@/composables/logger";
import Icon from "@/components/Icon.vue";
import SongBadge from "@/components/SongBadge.vue";
import type { NeteaseSong, Song } from "@/types";

const store = usePlayerStore();

const recentSongs = ref<Song[]>([]);
const loading = ref(false);

/** 布局模式：grid = 宫格，list = 列表，默认宫格 */
const layoutMode = ref<"grid" | "list">("grid");

/** layoutMode ref is used in template binding */

function pickRecentSong(item: any): NeteaseSong | null {
  return item?.song || item?.data || item?.resource || null;
}

function extractRecentList(response: any): any[] {
  if (Array.isArray(response?.data?.list)) return response.data.list;
  if (Array.isArray(response?.list)) return response.list;
  if (Array.isArray(response?.data)) return response.data;
  return [];
}

async function loadRecent() {
  if (!getCookie()) return;
  if (loading.value) return;
  loading.value = true;
  try {
    const res = await recordRecentSong(300);
    let list = extractRecentList(res);
    // 部分 api-enhanced 部署未实现 record/recent/song，使用文档中的 recent/listen/list 兜底。
    if (!list.length) {
      try {
        list = extractRecentList(await recentListenList());
      } catch { /* 主接口为空时，兜底失败仍按空记录展示 */ }
    }
    recentSongs.value = (list as any[])
      .map(pickRecentSong)
      .filter((song: NeteaseSong | null): song is NeteaseSong => !!song?.id)
      .map((song: NeteaseSong) => neteaseSongToSong(song));
    log.info("library-view", "recent listen loaded", { count: recentSongs.value.length });
    enrichSongBadges(recentSongs.value);
  } catch (e) {
    log.warn("library-view", "load recent failed", { error: String(e) });
    recentSongs.value = [];
  } finally {
    loading.value = false;
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
    log.info("library-view", "song badges enriched", { count: needBadge.length });
  } catch (e) {
    log.warn("library-view", "enrich song badges failed", { error: String(e) });
  }
}

function play(_song: Song, idx: number) {
  store.playList(recentSongs.value, idx);
}

// KeepAlive 缓存下每次进入视图都刷新最近播放（onActivated 在首次挂载时也会触发）
onActivated(() => { loadRecent(); });
</script>

<template>
  <section class="library-view">
    <header class="view-header">
      <div class="title-block">
        <h1>最近播放</h1>
        <p class="sub">
          共 <span class="count">{{ recentSongs.length }}</span> 首
        </p>
      </div>
      <!-- 布局切换按钮 -->
      <div class="layout-toggle">
        <button
          class="layout-btn"
          :class="{ active: layoutMode === 'grid' }"
          title="宫格布局"
          @click="layoutMode = 'grid'"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
            <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
            <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
            <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
          </svg>
        </button>
        <button
          class="layout-btn"
          :class="{ active: layoutMode === 'list' }"
          title="列表布局"
          @click="layoutMode = 'list'"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="2" y1="4" x2="14" y2="4" />
            <line x1="2" y1="8" x2="14" y2="8" />
            <line x1="2" y1="12" x2="14" y2="12" />
          </svg>
        </button>
      </div>
    </header>

    <div v-if="loading" class="empty">
      <div class="spinner" />
      <p>加载中...</p>
    </div>

    <div v-else-if="!recentSongs.length" class="empty">
      <Icon name="history" :size="42" />
      <p>暂无播放记录</p>
      <p class="hint">播放过的歌曲会出现在这里，方便快速回看。</p>
    </div>

    <!-- 宫格布局 -->
    <div v-else-if="layoutMode === 'grid'" class="grid nice-scroll">
      <button
        v-for="(song, idx) in recentSongs"
        :key="song.id"
        class="card"
        :class="{ active: store.currentSong?.id === song.id }"
        @click="play(song, idx)"
      >
        <div class="cover">
          <img v-if="song.pic" :src="song.pic" :alt="song.name" referrerpolicy="no-referrer" />
          <Icon v-else name="music" :size="28" />
          <div class="overlay">
            <div class="play-circle">
              <Icon :name="store.currentSong?.id === song.id && store.isPlaying ? 'pause' : 'play'" :size="20" />
            </div>
          </div>
        </div>
        <div class="meta">
          <div class="title-line">
            <div class="title truncate">{{ song.name }}</div>
            <SongBadge :song="song" size="sm" />
          </div>
          <div class="artist truncate">{{ song.artist }}</div>
        </div>
      </button>
    </div>

    <!-- 列表布局 -->
    <div v-else class="list nice-scroll">
      <button
        v-for="(song, idx) in recentSongs"
        :key="song.id"
        class="list-item"
        :class="{ active: store.currentSong?.id === song.id }"
        @click="play(song, idx)"
      >
        <span class="list-idx">{{ idx + 1 }}</span>
        <div class="list-cover" v-if="song.pic">
          <img :src="song.pic" :alt="song.name" referrerpolicy="no-referrer" />
        </div>
        <Icon v-else name="music" :size="18" class="list-cover-fallback" />
        <div class="list-meta">
          <div class="list-name-line">
            <div class="list-name truncate">{{ song.name }}</div>
            <SongBadge :song="song" size="sm" />
          </div>
          <div class="list-artist truncate">{{ song.artist }}</div>
        </div>
        <div class="list-play-icon">
          <Icon :name="store.currentSong?.id === song.id && store.isPlaying ? 'pause' : 'play'" :size="16" />
        </div>
      </button>
    </div>
  </section>
</template>

<style scoped>
.library-view {
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
.sub .count {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

/* 布局切换按钮 */
.layout-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-elev-2);
  border-radius: 8px;
  padding: 3px;
  margin-bottom: 4px;
}
.layout-btn {
  width: 32px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
  padding: 0;
}
.layout-btn:hover {
  color: var(--text-secondary);
  background: var(--bg-hover);
}
.layout-btn.active {
  color: var(--accent);
  background: var(--bg-elev-1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-tertiary);
}
.empty .hint {
  font-size: 12px;
  max-width: 320px;
  text-align: center;
}
.spinner {
  width: 28px; height: 28px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* 宫格布局 */
.grid {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 18px;
  padding-right: 4px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
  transition: transform 0.18s var(--ease-out);
}
.card:hover {
  transform: translateY(-3px);
}
.card:hover .cover {
  box-shadow: var(--shadow-md);
}
.card.active .title {
  color: var(--accent);
}
.cover {
  position: relative;
  aspect-ratio: 1 / 1;
  width: 100%;
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-elev-3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  box-shadow: var(--shadow-sm);
  transition: box-shadow 0.18s var(--ease-out);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 10px;
  opacity: 0;
  transition: opacity 0.18s var(--ease-out);
}
.card:hover .overlay {
  opacity: 1;
}
.play-circle {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(2px) saturate(1);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}
.meta .title {
  font-size: 13px;
  color: var(--text);
  font-weight: 500;
}
.title-line {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  overflow: hidden;
}
.title-line .title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta .artist {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 1px;
}

/* 列表布局 */
.list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-right: 4px;
}
.list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  text-align: left;
  transition: background 0.15s;
  cursor: pointer;
}
.list-item:hover {
  background: var(--bg-hover);
}
.list-item.active {
  color: var(--accent);
  background: var(--accent-soft);
}
.list-idx {
  width: 28px;
  text-align: center;
  font-size: 13px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.list-item.active .list-idx {
  color: var(--accent);
}
.list-cover {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--bg-elev-3);
}
.list-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.list-cover-fallback {
  color: var(--text-tertiary);
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.list-meta {
  flex: 1;
  min-width: 0;
}
.list-name {
  font-size: 13px;
  color: var(--text);
  font-weight: 500;
}
.list-name-line {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  overflow: hidden;
}
.list-name-line .list-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.list-item.active .list-name {
  color: var(--accent);
}
.list-artist {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}
.list-play-icon {
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
.list-item:hover .list-play-icon {
  opacity: 0.7;
}
.list-item.active .list-play-icon {
  opacity: 1;
  color: var(--accent);
}
.list-item:hover .list-play-icon:hover {
  opacity: 1;
  color: var(--accent);
}

@media (max-width: 720px) {
  .library-view { padding: 16px; }
  .grid {
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 14px;
  }
}
</style>
