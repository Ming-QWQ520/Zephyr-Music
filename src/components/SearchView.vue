<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { usePlayerStore } from "@/stores/player";
import { searchSongs } from "@/api/music";
import { pickLocalAudioFiles } from "@/api/localMusic";
import { log } from "@/composables/logger";
import Icon from "@/components/Icon.vue";
import type { Song } from "@/types";

const store = usePlayerStore();

const results = ref<Song[]>([]);
const loading = ref(false);
const errorMsg = ref("");
const localOpen = ref(false);

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
    results.value = await searchSongs(trimmed, 50);
    if (!results.value.length) errorMsg.value = "没有找到结果，换个关键词试试";
  } catch (e) {
    results.value = [];
    errorMsg.value = String(e instanceof Error ? e.message : e);
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
            <th class="col-artist">歌手</th>
            <th class="col-actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(song, idx) in results"
            :key="song.id"
            class="row"
            :class="{ active: store.currentSong?.id === song.id }"
            @dblclick="play(song, idx)"
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
            <td class="col-artist">
              <span class="truncate">{{ song.artist }}</span>
            </td>
            <td class="col-actions">
              <button class="row-action" title="下一首播放" @click="playNext(song)">
                <Icon name="next" :size="16" />
              </button>
              <button class="row-action" title="加入队列" @click="add(song)">
                <Icon name="plus" :size="16" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
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
.col-artist { width: 30%; }
.col-actions { width: 96px; }
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
</style>
