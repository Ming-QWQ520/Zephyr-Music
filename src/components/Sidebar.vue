<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { usePlayerStore } from "@/stores/player";
import Icon from "@/components/Icon.vue";
import type { ViewKey, Song } from "@/types";
import { getCookie, userAccount, userPlaylist, playlistTrackAll, neteaseSongToSong, type NeteasePlaylist } from "@/api/netease";

const store = usePlayerStore();
const collapsed = defineModel<boolean>("collapsed", { default: false });

// ===== 推荐区 =====
const recommendItems = [
  { key: "search" as ViewKey, label: "搜索", icon: "search" },
  { key: "netease" as ViewKey, label: "网易云", icon: "music" },
];

// ===== 我的区 =====
const myItems = [
  { key: "nowplaying" as ViewKey, label: "正在播放", icon: "music" },
  { key: "queue" as ViewKey, label: "播放队列", icon: "list" },
  { key: "library" as ViewKey, label: "最近播放", icon: "history" },
];

const history = computed(() => store.history.slice(0, 20));

function selectView(v: ViewKey) { store.setView(v); }
function playHistorySong(id: string) {
  const s = store.history.find((x) => x.id === id);
  if (s) store.playNow(s);
}

// ===== 网易云歌单 =====
const neteasePlaylists = ref<NeteasePlaylist[]>([]);
const showPlaylists = ref(true);

async function loadNeteasePlaylists() {
  if (!getCookie()) return;
  try {
    const accRes = await userAccount();
    if (accRes.profile?.userId) {
      const plRes = await userPlaylist(accRes.profile.userId);
      neteasePlaylists.value = plRes.playlist || [];
    }
  } catch { /* ignore */ }
}

async function playNeteasePlaylist(pl: NeteasePlaylist) {
  try {
    const res = await playlistTrackAll(pl.id);
    const songs: Song[] = (res.songs || []).map(neteaseSongToSong);
    if (songs.length > 0) await store.playList(songs, 0);
  } catch { /* ignore */ }
}

onMounted(() => { loadNeteasePlaylists(); });
watch(() => store.currentView, (v) => { if (v === "netease") loadNeteasePlaylists(); });
</script>

<template>
  <aside class="sidebar" :class="{ collapsed }">
    <!-- 推荐区 -->
    <div class="sb-section" v-if="!collapsed">
      <div class="sb-section-title">推荐</div>
      <button v-for="item in recommendItems" :key="item.key"
        class="sb-item" :class="{ active: store.currentView === item.key }"
        @click="selectView(item.key)">
        <Icon :name="item.icon" :size="16" />
        <span>{{ item.label }}</span>
      </button>
    </div>

    <!-- 推荐区（折叠模式：只显示图标）-->
    <div class="sb-section" v-if="collapsed">
      <button v-for="item in recommendItems" :key="item.key"
        class="sb-item icon-only" :class="{ active: store.currentView === item.key }"
        :title="item.label" @click="selectView(item.key)">
        <Icon :name="item.icon" :size="18" />
      </button>
    </div>

    <!-- 我的区 -->
    <div class="sb-section" v-if="!collapsed">
      <div class="sb-section-title">我的</div>
      <button v-for="item in myItems" :key="item.key"
        class="sb-item" :class="{ active: store.currentView === item.key }"
        @click="selectView(item.key)">
        <Icon :name="item.icon" :size="16" />
        <span>{{ item.label }}</span>
      </button>
    </div>

    <!-- 我的区（折叠）-->
    <div class="sb-section" v-if="collapsed">
      <button v-for="item in myItems" :key="item.key"
        class="sb-item icon-only" :class="{ active: store.currentView === item.key }"
        :title="item.label" @click="selectView(item.key)">
        <Icon :name="item.icon" :size="18" />
      </button>
    </div>

    <!-- 创建的歌单列表 -->
    <div v-if="!collapsed && neteasePlaylists.length > 0" class="sb-playlists">
      <button class="sb-playlist-header" @click="showPlaylists = !showPlaylists">
        <Icon :name="showPlaylists ? 'chevronDown' : 'chevronRight'" :size="12" />
        <span>创建的歌单</span>
        <span class="count">{{ neteasePlaylists.length }}</span>
      </button>
      <Transition name="pl-slide">
        <div v-show="showPlaylists" class="sb-playlist-list nice-scroll">
          <button v-for="pl in neteasePlaylists" :key="pl.id"
            class="sb-playlist-item" @click="playNeteasePlaylist(pl)">
            <div class="pl-cover">
              <img v-if="pl.coverImgUrl" :src="pl.coverImgUrl" :alt="pl.name" referrerpolicy="no-referrer" />
              <Icon v-else name="music" :size="12" />
            </div>
            <span class="pl-name truncate">{{ pl.name }}</span>
          </button>
        </div>
      </Transition>
    </div>

    <!-- 最近播放（无歌单时）-->
    <div v-if="!collapsed && neteasePlaylists.length === 0" class="sb-history">
      <div class="sb-section-title">最近播放</div>
      <div class="sb-history-list nice-scroll">
        <button v-for="song in history" :key="song.id"
          class="sb-history-item" :class="{ active: store.currentSong?.id === song.id }"
          @click="playHistorySong(song.id)">
          <div class="cover">
            <img v-if="song.pic" :src="song.pic" :alt="song.name" referrerpolicy="no-referrer" />
            <Icon v-else name="music" :size="12" />
          </div>
          <div class="meta">
            <div class="title truncate">{{ song.name }}</div>
            <div class="artist truncate">{{ song.artist }}</div>
          </div>
        </button>
        <div v-if="!history.length" class="empty">还没有播放记录</div>
      </div>
    </div>

    <button class="collapse-btn" :title="collapsed ? '展开' : '折叠'"
      @click="collapsed = !collapsed">
      <Icon :name="collapsed ? 'chevronRight' : 'chevronLeft'" :size="14" />
    </button>
  </aside>
</template>

<style scoped>
.sidebar {
  position: relative; width: var(--sidebar-w); flex-shrink: 0;
  display: flex; flex-direction: column; gap: 4px;
  padding: 12px 8px; background: var(--bg-elev-1);
  border-right: 1px solid var(--border);
  transition: width 0.28s var(--ease-out); overflow: hidden;
}
.sidebar.collapsed { width: 56px; padding: 12px 6px; }

.sb-section { display: flex; flex-direction: column; gap: 2px; }
.sb-section-title {
  padding: 8px 10px 4px; font-size: 11px; font-weight: 600;
  color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;
}
.sb-item {
  display: flex; align-items: center; gap: 10px;
  height: 34px; padding: 0 10px; border-radius: 8px;
  color: var(--text-secondary); font-size: 13px; font-weight: 500;
  transition: all 0.15s; white-space: nowrap;
}
.sb-item:hover { color: var(--text); background: var(--bg-hover); }
.sb-item.active { color: var(--accent); background: var(--accent-soft); }
.sb-item.icon-only { justify-content: center; height: 38px; }

/* 歌单列表 */
.sb-playlists, .sb-history { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.sb-playlist-header {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px 4px; font-size: 11px; font-weight: 600;
  color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;
}
.sb-playlist-header .count { margin-left: auto; }
.sb-playlist-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; padding-right: 2px; }
.sb-playlist-item {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px; border-radius: 6px; transition: background 0.15s;
  text-align: left; width: 100%;
}
.sb-playlist-item:hover { background: var(--bg-hover); }
.pl-cover {
  width: 28px; height: 28px; border-radius: 5px; flex-shrink: 0;
  background: var(--bg-elev-3); overflow: hidden;
  display: flex; align-items: center; justify-content: center; color: var(--text-tertiary);
}
.pl-cover img { width: 100%; height: 100%; object-fit: cover; }
.pl-name { font-size: 12px; color: var(--text-secondary); }

/* 最近播放 */
.sb-history-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding-right: 2px; }
.sb-history-item {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px; border-radius: 6px; transition: background 0.15s;
  text-align: left; width: 100%;
}
.sb-history-item:hover { background: var(--bg-hover); }
.sb-history-item.active { background: var(--bg-active); }
.sb-history-item .cover {
  width: 32px; height: 32px; border-radius: 5px; flex-shrink: 0;
  background: var(--bg-elev-3); overflow: hidden;
  display: flex; align-items: center; justify-content: center; color: var(--text-tertiary);
}
.sb-history-item .cover img { width: 100%; height: 100%; object-fit: cover; }
.sb-history-item .meta { flex: 1; min-width: 0; }
.sb-history-item .title { font-size: 12px; color: var(--text); }
.sb-history-item .artist { font-size: 10px; color: var(--text-tertiary); }
.empty { padding: 12px; color: var(--text-tertiary); font-size: 11px; text-align: center; }

.collapse-btn {
  position: absolute; top: 50%; right: -10px; transform: translateY(-50%);
  width: 20px; height: 32px; border-radius: 0 6px 6px 0;
  background: var(--bg-elev-2); border: 1px solid var(--border); border-left: none;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-secondary); z-index: 5; transition: all 0.15s;
}
.collapse-btn:hover { color: var(--text); background: var(--bg-elev-3); }

.pl-slide-enter-active, .pl-slide-leave-active { transition: all 0.2s; }
.pl-slide-enter-from, .pl-slide-leave-to { opacity: 0; max-height: 0; }
</style>
