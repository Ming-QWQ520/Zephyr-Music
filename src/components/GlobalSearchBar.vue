<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { usePlayerStore } from "@/stores/player";
import { pickLocalAudioFiles } from "@/api/localMusic";
import { log } from "@/composables/logger";
import Icon from "@/components/Icon.vue";

const store = usePlayerStore();

const keyword = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

function goBack() {
  store.goBackView();
}

function onKeydown(ev: KeyboardEvent) {
  if (ev.key === "Enter") {
    ev.preventDefault();
    commitSearch();
  } else if (ev.key === "Escape") {
    inputRef.value?.blur();
  }
}

function commitSearch() {
  if (!keyword.value.trim()) return;
  store.setSearchKeyword(keyword.value.trim());
  store.setView("search");
  inputRef.value?.blur();
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
}

onMounted(() => {
  // 快捷键 Ctrl/Cmd+K 聚焦搜索
  document.addEventListener("keydown", onGlobalKeydown);
});
onUnmounted(() => {
  document.removeEventListener("keydown", onGlobalKeydown);
});
function onGlobalKeydown(ev: KeyboardEvent) {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === "k") {
    ev.preventDefault();
    inputRef.value?.focus();
    inputRef.value?.select();
  }
}
</script>

<template>
  <div class="search-bar">
    <button class="back-btn" @click="goBack" title="返回" :disabled="!store.canGoBack">
      <Icon name="chevronLeft" :size="18" />
    </button>
    <Icon name="search" :size="16" class="search-icon" />
    <input
      ref="inputRef"
      v-model="keyword"
      class="search-input"
      type="text"
      placeholder="搜索歌曲、歌手，按回车搜索"
      @keydown="onKeydown"
    />
    <button class="local-btn" title="打开本地音乐文件" @click="handleLocalFiles">
      <Icon name="folder" :size="15" />
    </button>
  </div>
</template>

<style scoped>
.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 420px;
  height: 32px;
  padding: 0 10px;
  background: var(--bg-elev-3);
  border-radius: 18px;
  border: 1px solid var(--border);
  transition: border-color 0.15s;
}
.search-bar:focus-within { border-color: var(--accent); }
.search-icon { color: var(--text-tertiary); flex-shrink: 0; }
.back-btn { width: 28px; height: 28px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; color: var(--text-secondary); transition: color 0.15s, background 0.15s; flex-shrink: 0; }
.back-btn:hover { color: var(--text); background: var(--bg-hover); }
.back-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.back-btn:disabled:hover { color: var(--text-secondary); background: transparent; }
.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font-size: 13px;
}
.search-input::placeholder { color: var(--text-tertiary); }
.local-btn {
  width: 26px; height: 26px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); transition: color 0.15s, background 0.15s;
  flex-shrink: 0;
}
.local-btn:hover { color: var(--text); background: var(--bg-hover); }
</style>
