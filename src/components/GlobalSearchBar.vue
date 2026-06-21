<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { usePlayerStore } from "@/stores/player";
import { searchSongs } from "@/api/music";
import { pickLocalAudioFiles } from "@/api/localMusic";
import { log } from "@/composables/logger";
import Icon from "@/components/Icon.vue";
import type { Song } from "@/types";

const store = usePlayerStore();

const keyword = ref("");
const results = ref<Song[]>([]);
const loading = ref(false);
const showDropdown = ref(false);
const errorMsg = ref("");
const inputRef = ref<HTMLInputElement | null>(null);
const rootRef = ref<HTMLDivElement | null>(null);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE = 260;

async function doSearch(kw: string) {
  const trimmed = kw.trim();
  if (!trimmed) {
    results.value = [];
    errorMsg.value = "";
    return;
  }
  loading.value = true;
  errorMsg.value = "";
  try {
    const list = await searchSongs(trimmed, 12);
    results.value = list;
    if (!list.length) errorMsg.value = "没有找到结果";
  } catch (e) {
    results.value = [];
    errorMsg.value = String(e instanceof Error ? e.message : e);
  } finally {
    loading.value = false;
  }
}

function onInput() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => doSearch(keyword.value), DEBOUNCE);
}

function focusInput() {
  showDropdown.value = true;
  nextTick(() => inputRef.value?.select());
}

function onKeydown(ev: KeyboardEvent) {
  if (ev.key === "Enter") {
    ev.preventDefault();
    commitSearch();
  } else if (ev.key === "Escape") {
    showDropdown.value = false;
    inputRef.value?.blur();
  }
}

function commitSearch() {
  if (!keyword.value.trim()) return;
  store.setSearchKeyword(keyword.value.trim());
  store.setView("search");
  showDropdown.value = false;
  inputRef.value?.blur();
}

function playFromDropdown(song: Song) {
  store.playNow(song);
  showDropdown.value = false;
}

function addToQueue(song: Song) {
  store.addToQueue(song);
  showDropdown.value = false;
}

function handleLocalFiles() {
  pickLocalAudioFiles()
    .then((songs) => {
      if (songs.length) {
        store.playList(songs, 0);
        log.info("searchbar", "loaded local files", { count: songs.length });
      }
    })
    .catch((e) => log.error("searchbar", "pick local failed", { error: String(e) }));
  showDropdown.value = false;
}

function onBlur() {
  // give click handlers on dropdown a tick before closing
  setTimeout(() => {
    if (!rootRef.value?.contains(document.activeElement)) showDropdown.value = false;
  }, 160);
}

function onDocClick(ev: MouseEvent) {
  if (!rootRef.value) return;
  if (!rootRef.value.contains(ev.target as Node)) showDropdown.value = false;
}

onMounted(() => document.addEventListener("mousedown", onDocClick));
onUnmounted(() => {
  document.removeEventListener("mousedown", onDocClick);
  if (debounceTimer) clearTimeout(debounceTimer);
});

watch(
  () => store.searchKeyword,
  (kw) => {
    if (kw && keyword.value !== kw) keyword.value = kw;
  }
);

const dropdownVisible = computed(() => showDropdown.value && (loading.value || results.value.length > 0 || !!errorMsg.value || keyword.value.trim()));
</script>

<template>
  <div ref="rootRef" class="search-bar" :class="{ focused: showDropdown }">
    <Icon name="search" :size="16" class="lead-icon" />
    <input
      ref="inputRef"
      v-model="keyword"
      class="search-input"
      type="text"
      placeholder="搜索歌曲、歌手..."
      spellcheck="false"
      @input="onInput"
      @focus="focusInput"
      @keydown="onKeydown"
      @blur="onBlur"
    />
    <button v-if="keyword" class="clear-btn" title="清空" @click="keyword = ''; results = []">
      <Icon name="close" :size="14" />
    </button>
    <div class="divider" />
    <button class="local-btn" title="打开本地文件" @click="handleLocalFiles">
      <Icon name="folder" :size="16" />
    </button>

    <Transition name="dropdown">
      <div v-if="dropdownVisible" class="dropdown nice-scroll">
        <div v-if="loading" class="state-line">
          <span class="spinner" /> 正在搜索 "{{ keyword }}"...
        </div>
        <div v-else-if="errorMsg" class="state-line">{{ errorMsg }}</div>
        <button
          v-for="song in results"
          :key="song.id"
          class="result-item"
          @click="playFromDropdown(song)"
        >
          <div class="cover">
            <img v-if="song.pic" :src="song.pic" :alt="song.name" referrerpolicy="no-referrer" />
            <Icon v-else name="music" :size="14" />
          </div>
          <div class="meta">
            <div class="title truncate">{{ song.name }}</div>
            <div class="artist truncate">{{ song.artist }}</div>
          </div>
          <button class="add-btn" title="加入队列" @click.stop="addToQueue(song)">
            <Icon name="plus" :size="14" />
          </button>
        </button>
        <div v-if="!loading && results.length" class="more" @click="commitSearch">
          查看全部结果 <Icon name="chevronRight" :size="12" />
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.search-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.10);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  width: 100%;
  max-width: 460px;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.search-bar.focused {
  border-color: var(--accent);
  background: rgba(255, 255, 255, 0.14);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.lead-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  font-size: 13px;
  color: var(--text);
}
.search-input::placeholder {
  color: var(--text-tertiary);
}
.clear-btn,
.local-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: var(--text-tertiary);
  transition: color 0.15s, background 0.15s;
}
.clear-btn:hover,
.local-btn:hover {
  color: var(--text);
  background: var(--bg-hover);
}
.divider {
  width: 1px;
  height: 16px;
  background: var(--border);
}

.dropdown {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  min-width: 360px;
  max-height: 420px;
  overflow-y: auto;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  padding: 6px;
  z-index: 100;
}
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.18s var(--ease-out), transform 0.18s var(--ease-out);
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
.state-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  color: var(--text-tertiary);
  font-size: 12px;
}
.spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 1.5px solid var(--text-tertiary);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.result-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 8px;
  border-radius: 8px;
  text-align: left;
  transition: background 0.15s;
}
.result-item:hover {
  background: var(--bg-hover);
}
.cover {
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
.add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--text-tertiary);
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, background 0.15s;
}
.result-item:hover .add-btn {
  opacity: 1;
}
.add-btn:hover {
  color: var(--accent);
  background: var(--accent-soft);
}
.more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 8px;
  margin-top: 4px;
}
.more:hover {
  color: var(--accent);
  background: var(--accent-soft);
}
</style>
