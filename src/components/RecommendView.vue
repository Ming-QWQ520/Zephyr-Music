<script setup lang="ts">
import { ref, onMounted } from "vue";
import { usePlayerStore } from "@/stores/player";
import { recommendResource, playlistDetail, neteaseSongToSong, getCookie, type NeteasePlaylist } from "@/api/netease";
import { log } from "@/composables/logger";
import Icon from "@/components/Icon.vue";
import type { Song } from "@/types";

const store = usePlayerStore();

const recommendPlaylists = ref<NeteasePlaylist[]>([]);
const loading = ref(true);

// 榜单精选
const rankings = ref<{ id: number; name: string; coverImgUrl: string; songs: Song[]; loading: boolean }[]>([
  { id: 19723756, name: "飙升榜", coverImgUrl: "", songs: [], loading: true },
  { id: 3779629, name: "新歌榜", coverImgUrl: "", songs: [], loading: true },
  { id: 3778678, name: "热歌榜", coverImgUrl: "", songs: [], loading: true },
  { id: 2250011882, name: "抖音排行榜", coverImgUrl: "", songs: [], loading: true },
]);

async function loadData() {
  loading.value = true;
  // 加载推荐歌单
  if (getCookie()) {
    try {
      const res = await recommendResource();
      recommendPlaylists.value = (res.recommend || res.data || []).slice(0, 10);
      log.info("recommend-view", "recommend playlists loaded", { count: recommendPlaylists.value.length });
    } catch (e) { log.warn("recommend-view", "load recommend failed", { error: String(e) }); }
  }
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

onMounted(() => { loadData(); });
</script>

<template>
  <section class="recommend-view nice-scroll">
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
              @click="playSong(song)">
              <span class="ranking-idx">{{ idx + 1 }}</span>
              <span class="ranking-song-name truncate">{{ song.name }}</span>
              <span class="ranking-artist truncate">{{ song.artist }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.recommend-view { height: 100%; overflow-y: auto; padding: 24px 28px; display: flex; flex-direction: column; gap: 32px; }
.section { display: flex; flex-direction: column; gap: 16px; }
.section-title { margin: 0; font-size: 20px; font-weight: 700; color: var(--text); }
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
</style>
