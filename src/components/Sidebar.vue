<script setup lang="ts">
import { computed } from "vue";
import { usePlayerStore } from "@/stores/player";
import Icon from "@/components/Icon.vue";
import type { ViewKey } from "@/types";

const store = usePlayerStore();

interface NavItem {
  key: ViewKey;
  label: string;
  icon: string;
}

const navItems: NavItem[] = [
  { key: "search", label: "搜索", icon: "search" },
  { key: "nowplaying", label: "正在播放", icon: "music" },
  { key: "queue", label: "播放队列", icon: "list" },
  { key: "library", label: "最近播放", icon: "history" },
];

const collapsed = defineModel<boolean>("collapsed", { default: false });

const history = computed(() => store.history.slice(0, 20));

function selectView(v: ViewKey) {
  store.setView(v);
}

function playHistorySong(id: string) {
  const s = store.history.find((x) => x.id === id);
  if (s) store.playNow(s);
}
</script>

<template>
  <aside class="sidebar" :class="{ collapsed }">
    <div class="nav-list">
      <button
        v-for="item in navItems"
        :key="item.key"
        class="nav-item"
        :class="{ active: store.currentView === item.key }"
        :title="item.label"
        @click="selectView(item.key)"
      >
        <Icon :name="item.icon" :size="18" />
        <span v-if="!collapsed" class="label">{{ item.label }}</span>
      </button>
    </div>

    <div v-if="!collapsed" class="history-section">
      <div class="section-title">
        <span>最近播放</span>
        <span class="count">{{ history.length }}</span>
      </div>
      <div class="history-list nice-scroll">
        <button
          v-for="song in history"
          :key="song.id"
          class="history-item"
          :class="{ active: store.currentSong?.id === song.id }"
          @click="playHistorySong(song.id)"
        >
          <div class="cover">
            <img v-if="song.pic" :src="song.pic" :alt="song.name" referrerpolicy="no-referrer" />
            <Icon v-else name="music" :size="14" />
          </div>
          <div class="meta">
            <div class="title truncate">{{ song.name }}</div>
            <div class="artist truncate">{{ song.artist }}</div>
          </div>
        </button>
        <div v-if="!history.length" class="empty">还没有播放记录</div>
      </div>
    </div>

    <button
      class="collapse-btn"
      :title="collapsed ? '展开侧栏' : '折叠侧栏'"
      @click="collapsed = !collapsed"
    >
      <Icon :name="collapsed ? 'chevronRight' : 'chevronLeft'" :size="16" />
    </button>
  </aside>
</template>

<style scoped>
.sidebar {
  position: relative;
  width: var(--sidebar-w);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px 10px 12px 12px;
  background: var(--bg-elev-1);
  border-right: 1px solid var(--border);
  transition: width 0.28s var(--ease-out);
  overflow: hidden;
}
.sidebar.collapsed {
  width: 64px;
}
.nav-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 38px;
  padding: 0 10px;
  border-radius: 10px;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  transition: color 0.15s, background 0.15s;
  white-space: nowrap;
}
.nav-item:hover {
  color: var(--text);
  background: var(--bg-hover);
}
.nav-item.active {
  color: var(--accent);
  background: var(--accent-soft);
}
.nav-item .label {
  flex: 1;
  text-align: left;
}

.history-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 6px;
  font-size: 11px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--text-tertiary);
}
.section-title .count {
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.history-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-right: 4px;
}
.history-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px;
  border-radius: 8px;
  transition: background 0.15s;
  text-align: left;
  width: 100%;
}
.history-item:hover {
  background: var(--bg-hover);
}
.history-item.active {
  background: var(--bg-active);
}
.cover {
  position: relative;
  width: 36px;
  height: 36px;
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
.meta {
  flex: 1;
  min-width: 0;
}
.meta .title {
  font-size: 13px;
  color: var(--text);
  font-weight: 500;
}
.meta .artist {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 1px;
}
.empty {
  padding: 16px 12px;
  color: var(--text-tertiary);
  font-size: 12px;
  text-align: center;
}

.collapse-btn {
  position: absolute;
  top: 50%;
  right: -12px;
  transform: translateY(-50%);
  width: 22px;
  height: 36px;
  border-radius: 0 8px 8px 0;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-left: none;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  z-index: 5;
  transition: color 0.15s, background 0.15s;
}
.collapse-btn:hover {
  color: var(--text);
  background: var(--bg-elev-3);
}
</style>
