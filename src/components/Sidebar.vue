<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { usePlayerStore } from "@/stores/player";
import Icon from "@/components/Icon.vue";
import type { ViewKey } from "@/types";
import { getCachedPlaylists, _cachedUser, type NeteasePlaylist } from "@/api/netease";

const store = usePlayerStore();

// user 图标不在 Icon.vue 的 ICONS 中，使用内联 SVG（24x24 viewBox / stroke 1.8 / currentColor，与 Icon.vue 风格一致）
const SVG_USER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/></svg>`;

const recommendItems: { key: ViewKey; label: string; icon: string }[] = [
  { key: "recommend", label: "推荐", icon: "sparkles" },
];

function selectView(v: ViewKey) { store.setView(v); }

// ===== 网易云歌单（从缓存读取，不重复请求）=====
// 底部大容器内分两组：「我的歌单」（我创建的）与「收藏的歌单」（我收藏的），
// 通过 creator.userId 与当前登录用户比对区分（/user/playlist 原始响应携带 userId）。
const neteasePlaylists = ref<NeteasePlaylist[]>([]);
const favPlaylist = ref<NeteasePlaylist | null>(null);

/** 当前登录用户 id（未登录为 null） */
const myUserId = computed<number | null>(() => _cachedUser.value?.userId ?? null);

/** 我创建的歌单（creator.userId 与当前用户一致；无 userId 数据时归入此组保持旧行为） */
const createdPlaylists = computed<NeteasePlaylist[]>(() => {
  const rest = neteasePlaylists.value.slice(1);
  const uid = myUserId.value;
  if (uid == null) return rest;
  return rest.filter(pl => pl.creator?.userId == null || pl.creator.userId === uid);
});

/** 我收藏的歌单（creator.userId 存在且不等于当前用户） */
const collectedPlaylists = computed<NeteasePlaylist[]>(() => {
  const uid = myUserId.value;
  if (uid == null) return [];
  return neteasePlaylists.value.slice(1).filter(pl => pl.creator?.userId != null && pl.creator.userId !== uid);
});

// 折叠状态：「我的歌单」默认展开，「收藏的歌单」默认收起（低配机器首屏更少 DOM）。
// 列表首次展开才挂载 DOM（everOpened），之后用 v-show 切换，避免反复创建/销毁节点。
const createdOpen = ref(true);
const collectedOpen = ref(false);
const createdEverOpened = ref(true);
const collectedEverOpened = ref(false);

function toggleCreated() {
  createdOpen.value = !createdOpen.value;
  if (createdOpen.value) createdEverOpened.value = true;
}
function toggleCollected() {
  collectedOpen.value = !collectedOpen.value;
  if (collectedOpen.value) collectedEverOpened.value = true;
}

/** 侧边栏封面缩略图：28px 显示位用 64px 小图降低解码内存；已有 query 的 URL 不重复追加 */
function coverThumb(url: string): string {
  if (!url) return url;
  return url.includes("?") ? url : `${url}?param=64y64`;
}

async function loadPlaylists() {
  const pls = await getCachedPlaylists();
  neteasePlaylists.value = pls;
  favPlaylist.value = pls[0] || null;
}

/** 点击歌单：跳转到网易云页面并选中该歌单（不直接播放）*/
function openPlaylist(pl: NeteasePlaylist) {
  store.pendingPlaylistId = pl.id;
  store.setView("netease");
}

function openFav() {
  if (favPlaylist.value) openPlaylist(favPlaylist.value);
}

/** 打开听歌排行：设置特殊 pendingPlaylistId = -2 */
function openRecord() {
  store.pendingPlaylistId = -2;
  store.setView("netease");
}

/** 当前选中的侧边栏项标识，用于高亮显示 */
const activeItem = computed<string>(() => {
  if (store.currentView === "library") return "library";
  if (store.currentView === "netease") {
    // 听歌排行 = -2
    if (store.pendingPlaylistId === -2 || store.sourcePlaylistId === -2) return "record";
    // 我喜欢的音乐 = favPlaylist.id
    if (favPlaylist.value && (store.pendingPlaylistId === favPlaylist.value.id || store.sourcePlaylistId === favPlaylist.value.id)) return "fav";
    // 检查 pendingPlaylistId 或 sourcePlaylistId（sourcePlaylistId 在选中后保留）
    const pid = store.pendingPlaylistId ?? store.sourcePlaylistId;
    if (pid !== null && pid > 0) return `pl-${pid}`;
    return "";
  }
  return "";
});

onMounted(() => { loadPlaylists(); });

// 监听用户登录状态变化，登录后及时获取歌单
watch(() => _cachedUser.value, (user) => {
  if (user && neteasePlaylists.value.length === 0) {
    loadPlaylists();
  }
}, { immediate: true });
</script>

<template>
  <aside class="sidebar">
    <!-- 推荐 -->
    <div class="sb-section">
      <div class="sb-section-title">推荐</div>
      <button v-for="item in recommendItems" :key="item.key"
        class="sb-item" :class="{ active: store.currentView === item.key }"
        @click="selectView(item.key)">
        <Icon :name="item.icon" :size="16" />
        <span>{{ item.label }}</span>
      </button>
    </div>

    <!-- 我的 -->
    <div class="sb-section">
      <div class="sb-section-title">我的</div>
      <button class="sb-item" :class="{ active: store.currentView === 'profile' }" @click="selectView('profile')">
        <span class="sb-item-icon" v-html="SVG_USER" />
        <span>个人主页</span>
      </button>
      <button v-if="favPlaylist" class="sb-item" :class="{ active: activeItem === 'fav' }" @click="openFav">
        <Icon name="heart" :size="16" />
        <span>我喜欢的音乐</span>
      </button>
      <button class="sb-item" :class="{ active: activeItem === 'record' }" @click="openRecord">
        <Icon name="history" :size="16" />
        <span>听歌排行</span>
      </button>
      <button class="sb-item" :class="{ active: activeItem === 'library' }"
        @click="selectView('library')">
        <Icon name="clock" :size="16" />
        <span>最近播放</span>
      </button>
      <button class="sb-item" :class="{ active: store.currentView === 'clouddisk' }" @click="selectView('clouddisk')">
        <Icon name="folder" :size="16" />
        <span>音乐云盘</span>
      </button>
      <button class="sb-item" :class="{ active: store.currentView === 'message' }" @click="selectView('message')">
        <Icon name="mail" :size="16" />
        <span>私信</span>
      </button>
      <button class="sb-item" :class="{ active: store.currentView === 'notification' }" @click="selectView('notification')">
        <Icon name="bell" :size="16" />
        <span>通知中心</span>
      </button>
    </div>

    <!-- 歌单（大容器：我的歌单 + 收藏的歌单 两组分离显示，整块共用一个滚动区） -->
    <div v-if="createdPlaylists.length || collectedPlaylists.length" class="sb-playlists nice-scroll">
      <!-- 我的歌单（我创建的） -->
      <div v-if="createdPlaylists.length" class="sb-pl-group">
        <button class="sb-pl-header" @click="toggleCreated">
          <Icon :name="createdOpen ? 'chevronDown' : 'chevronRight'" :size="12" />
          <span>我的歌单</span>
          <span class="count">{{ createdPlaylists.length }}</span>
        </button>
        <!-- 首次展开才挂载列表 DOM，之后 v-show 切换（性能：避免反复创建/销毁） -->
        <div v-if="createdEverOpened" v-show="createdOpen" class="sb-pl-list">
          <button
            v-for="pl in createdPlaylists"
            :key="pl.id"
            class="sb-pl-item"
            :class="{ active: activeItem === `pl-${pl.id}` }"
            @click="openPlaylist(pl)"
          >
            <div class="pl-cover">
              <img
                v-if="pl.coverImgUrl"
                :src="coverThumb(pl.coverImgUrl)"
                :alt="pl.name"
                referrerpolicy="no-referrer"
                loading="lazy"
                decoding="async"
              />
              <Icon v-else name="music" :size="12" />
            </div>
            <span class="pl-name truncate">{{ pl.name }}</span>
          </button>
        </div>
      </div>
      <!-- 收藏的歌单（默认收起，首次展开才挂载 DOM） -->
      <div v-if="collectedPlaylists.length" class="sb-pl-group">
        <button class="sb-pl-header" @click="toggleCollected">
          <Icon :name="collectedOpen ? 'chevronDown' : 'chevronRight'" :size="12" />
          <span>收藏的歌单</span>
          <span class="count">{{ collectedPlaylists.length }}</span>
        </button>
        <div v-if="collectedEverOpened" v-show="collectedOpen" class="sb-pl-list">
          <button
            v-for="pl in collectedPlaylists"
            :key="pl.id"
            class="sb-pl-item"
            :class="{ active: activeItem === `pl-${pl.id}` }"
            @click="openPlaylist(pl)"
          >
            <div class="pl-cover">
              <img
                v-if="pl.coverImgUrl"
                :src="coverThumb(pl.coverImgUrl)"
                :alt="pl.name"
                referrerpolicy="no-referrer"
                loading="lazy"
                decoding="async"
              />
              <Icon v-else name="music" :size="12" />
            </div>
            <span class="pl-name truncate">{{ pl.name }}</span>
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  position: relative; width: var(--sidebar-w); flex-shrink: 0;
  display: flex; flex-direction: column; gap: 4px;
  padding: 12px 12px; background: var(--bg-elev-1);
  border-right: 1px solid var(--border); overflow: hidden;
}
.sb-section { display: flex; flex-direction: column; gap: 2px; }
.sb-section-title {
  padding: 8px 10px 4px; font-size: 11px; font-weight: 600;
  color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;
}
.sb-item {
  display: flex; align-items: center; gap: 12px;
  height: 44px; padding: 0 16px; border-radius: var(--radius-sm);
  color: var(--text-secondary); font-size: 14px; font-weight: 500;
  transition: color 0.2s var(--ease-out), background 0.2s var(--ease-out); white-space: nowrap;
  position: relative;
}
.sb-item:hover { color: var(--text); background: var(--bg-hover); }
.sb-item.active { color: var(--accent); background: var(--accent-soft); }
.sb-item-icon { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.sb-item-icon :deep(svg) { width: 16px; height: 16px; display: block; }
/* 歌单大容器：整块作为唯一滚动区（两组共用，滚动成本低于多个独立滚动区），标题吸顶 */
.sb-playlists {
  flex: 1; min-height: 0; margin-top: 4px;
  display: flex; flex-direction: column; gap: 2px;
  overflow-y: auto; padding-right: 2px;
}
.sb-pl-group { display: flex; flex-direction: column; }
.sb-pl-header {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px 4px; font-size: 11px; font-weight: 600;
  color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;
  position: sticky; top: 0; z-index: 1;
  background: var(--bg-elev-1);
}
.sb-pl-header .count { margin-left: auto; }
.sb-pl-list { display: flex; flex-direction: column; gap: 1px; padding-bottom: 2px; }
.sb-pl-item {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 12px; border-radius: var(--radius-sm); transition: background 0.2s var(--ease-out);
  text-align: left; width: 100%; position: relative;
}
.sb-pl-item:hover { background: var(--bg-hover); }
.sb-pl-item.active { background: var(--accent-soft); }
.sb-pl-item.active .pl-name { color: var(--accent); }
.sb-pl-item.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 20px;
  background: var(--accent);
  border-radius: 0 2px 2px 0;
}
.pl-cover {
  width: 28px; height: 28px; border-radius: 5px; flex-shrink: 0;
  background: var(--bg-elev-3); overflow: hidden;
  display: flex; align-items: center; justify-content: center; color: var(--text-tertiary);
}
.pl-cover img { width: 100%; height: 100%; object-fit: cover; }
.pl-name { font-size: 12px; color: var(--text-secondary); }
</style>
