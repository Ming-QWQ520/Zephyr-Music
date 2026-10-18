<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { usePlayerStore } from "@/stores/player";
import { pickLocalAudioFiles } from "@/api/localMusic";
import { searchSuggest, searchHotDetail } from "@/api/netease";
import { storeGetSync, storeSetSync } from "@/composables/useStore";
import { log } from "@/composables/logger";
import { debounce } from "@/composables/useDebounce";
import Icon from "@/components/Icon.vue";

const store = usePlayerStore();

const keyword = ref("");
const inputRef = ref<HTMLInputElement | null>(null);
const rootRef = ref<HTMLElement | null>(null);
const suggestions = ref<string[]>([]);
const suggestionsLoading = ref(false);
const suggestionsOpen = ref(false);
const activeSuggestion = ref(-1);
let suggestionRequestId = 0;

// ===== 搜索历史（tauri-plugin-store 持久化，最多 12 条，最新在前） =====
const HISTORY_KEY = "zephyr-search-history";
const HISTORY_MAX = 12;
const searchHistory = ref<string[]>([]);

function loadHistory(): string[] {
  try {
    const raw = storeGetSync(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((w): w is string => typeof w === "string" && w.trim().length > 0)
      .slice(0, HISTORY_MAX);
  } catch { return []; }
}

function saveHistory() {
  try { storeSetSync(HISTORY_KEY, JSON.stringify(searchHistory.value)); } catch { /* ignore */ }
}

/** 新搜索置顶，去重，限长 */
function addHistory(word: string) {
  const w = word.trim();
  if (!w) return;
  searchHistory.value = [w, ...searchHistory.value.filter(h => h !== w)].slice(0, HISTORY_MAX);
  saveHistory();
}

function removeHistory(idx: number) {
  searchHistory.value = searchHistory.value.filter((_, i) => i !== idx);
  saveHistory();
  if (!searchHistory.value.length && !hotWords.value.length) suggestionsOpen.value = false;
}

function clearHistory() {
  searchHistory.value = [];
  saveHistory();
  if (!hotWords.value.length) suggestionsOpen.value = false;
}

// ===== 热搜榜（空输入时展示；聚焦后懒请求一次，会话内缓存） =====
interface HotWordItem { searchWord: string; score?: number; iconType?: number; }
const hotWords = ref<HotWordItem[]>([]);
const hotWordsLoading = ref(false);
let hotWordsRequested = false;

async function loadHotWords() {
  if (hotWordsRequested) return;
  hotWordsRequested = true;
  hotWordsLoading.value = true;
  try {
    const res = await searchHotDetail();
    hotWords.value = (res.data || []).slice(0, 8).map(h => ({
      searchWord: h.searchWord,
      score: h.score,
      iconType: h.iconType,
    }));
    log.info("searchbar", "hot words loaded", { count: hotWords.value.length });
  } catch (e) {
    log.warn("searchbar", "load hot words failed", { error: String(e) });
  } finally {
    hotWordsLoading.value = false;
  }
}

/** 空输入面板：搜索历史 + 热搜榜 */
function openEmptyPanel() {
  suggestions.value = [];
  suggestionsLoading.value = false;
  suggestionRequestId += 1;
  if (searchHistory.value.length || hotWords.value.length || !hotWordsRequested) {
    suggestionsOpen.value = true;
    void loadHotWords();
  }
}

function goBack() {
  store.goBackView();
}

function onKeydown(ev: KeyboardEvent) {
  if (ev.isComposing) return;
  if (ev.key === "ArrowDown" && suggestions.value.length) {
    ev.preventDefault();
    suggestionsOpen.value = true;
    activeSuggestion.value = (activeSuggestion.value + 1) % suggestions.value.length;
  } else if (ev.key === "ArrowUp" && suggestions.value.length) {
    ev.preventDefault();
    suggestionsOpen.value = true;
    activeSuggestion.value = activeSuggestion.value <= 0
      ? suggestions.value.length - 1
      : activeSuggestion.value - 1;
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    commitSearch(activeSuggestion.value >= 0 ? suggestions.value[activeSuggestion.value] : undefined);
  } else if (ev.key === "Escape") {
    suggestionsOpen.value = false;
    activeSuggestion.value = -1;
  }
}

function commitSearch(value?: string) {
  const next = (value ?? keyword.value).trim();
  if (!next) return;
  addHistory(next);
  suggestionRequestId += 1;
  keyword.value = next;
  debouncedLoadSuggestions.cancel();
  suggestionsLoading.value = false;
  suggestionsOpen.value = false;
  activeSuggestion.value = -1;
  store.setSearchKeyword(next);
  store.setView("search");
  inputRef.value?.blur();
}

/** 输入阶段仅请求轻量搜索建议；按 Enter 或点击建议后才执行完整搜索，避免连续触发风控。 */
const debouncedLoadSuggestions = debounce((value: string) => {
  loadSuggestions(value);
}, 250);

watch(keyword, (kw) => {
  activeSuggestion.value = -1;
  const trimmed = kw.trim();
  if (document.activeElement !== inputRef.value) {
    suggestionsOpen.value = false;
    return;
  }
  if (!trimmed) {
    openEmptyPanel();
    return;
  }
  if (trimmed.length < 2) {
    debouncedLoadSuggestions.cancel();
    suggestionRequestId += 1;
    suggestions.value = [];
    suggestionsLoading.value = false;
    suggestionsOpen.value = false;
    return;
  }
  suggestionsOpen.value = true;
  debouncedLoadSuggestions(trimmed);
});

async function loadSuggestions(value: string) {
  const requestId = ++suggestionRequestId;
  suggestionsLoading.value = true;
  try {
    const response = await searchSuggest(value, "mobile");
    if (requestId !== suggestionRequestId ||
        keyword.value.trim() !== value ||
        document.activeElement !== inputRef.value) return;
    const values = (response.result?.allMatch || [])
      .map(item => item.keyword?.trim())
      .filter((item): item is string => !!item);
    suggestions.value = [...new Set(values)].slice(0, 8);
    suggestionsOpen.value = true;
  } catch (error) {
    if (requestId !== suggestionRequestId) return;
    suggestions.value = [];
    log.warn("searchbar", "load suggestions failed", { error: String(error) });
  } finally {
    if (requestId === suggestionRequestId) suggestionsLoading.value = false;
  }
}

function clearKeyword() {
  keyword.value = "";
  suggestions.value = [];
  activeSuggestion.value = -1;
  inputRef.value?.focus();
}

function onFocus() {
  const trimmed = keyword.value.trim();
  if (trimmed.length >= 2) {
    suggestionsOpen.value = true;
    if (!suggestions.value.length) debouncedLoadSuggestions(trimmed);
  } else if (!trimmed) {
    openEmptyPanel();
  }
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
  keyword.value = store.searchKeyword;
  searchHistory.value = loadHistory();
  // 快捷键 Ctrl/Cmd+K 聚焦搜索
  document.addEventListener("keydown", onGlobalKeydown);
  document.addEventListener("pointerdown", onDocumentPointerDown);
});
onUnmounted(() => {
  document.removeEventListener("keydown", onGlobalKeydown);
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  debouncedLoadSuggestions.cancel();
  suggestionRequestId += 1;
});

function onDocumentPointerDown(event: PointerEvent) {
  if (!rootRef.value?.contains(event.target as Node)) suggestionsOpen.value = false;
}

function onGlobalKeydown(ev: KeyboardEvent) {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === "k") {
    ev.preventDefault();
    inputRef.value?.focus();
    inputRef.value?.select();
  }
}
</script>

<template>
  <div ref="rootRef" class="search-bar-wrap">
    <div class="search-bar">
      <button class="back-btn" @click="goBack" title="返回" :disabled="!store.canGoBack">
        <Icon name="chevronLeft" :size="18" />
      </button>
      <Icon name="search" :size="16" class="search-icon" />
      <input
        ref="inputRef"
        v-model="keyword"
        class="search-input"
        type="search"
        placeholder="搜索歌曲、歌手，按回车搜索"
        autocomplete="off"
        aria-label="搜索网易云音乐"
        :aria-expanded="suggestionsOpen"
        @focus="onFocus"
        @keydown="onKeydown"
      />
      <button v-if="keyword" class="clear-btn" type="button" title="清空搜索" @click="clearKeyword">
        <Icon name="close" :size="13" />
      </button>
      <button class="local-btn" title="打开本地音乐文件" @click="handleLocalFiles">
        <Icon name="folder" :size="15" />
      </button>
    </div>
    <Transition name="suggest">
      <div v-if="suggestionsOpen" class="search-suggestions">
        <!-- 空输入：搜索历史 + 热搜榜 -->
        <template v-if="!keyword.trim()">
          <div v-if="searchHistory.length" class="suggest-header">
            <Icon name="history" :size="12" />
            <span>搜索历史</span>
            <button type="button" class="suggest-header-btn" @mousedown.prevent="clearHistory">清空</button>
          </div>
          <div v-for="(item, idx) in searchHistory" :key="item" class="history-row">
            <button type="button" class="history-main" :title="item" @mousedown.prevent="commitSearch(item)">
              <Icon name="clock" :size="13" />
              <span>{{ item }}</span>
            </button>
            <button type="button" class="history-del" title="删除该条记录" @mousedown.prevent="removeHistory(idx)">
              <Icon name="close" :size="11" />
            </button>
          </div>
          <div class="suggest-header">
            <Icon name="sparkles" :size="12" />
            <span>热搜榜</span>
          </div>
          <div v-if="hotWordsLoading && !hotWords.length" class="suggest-state">正在获取热搜榜...</div>
          <template v-else>
            <button
              v-for="(item, idx) in hotWords"
              :key="item.searchWord"
              type="button"
              class="suggest-item hot-item"
              @mousedown.prevent="commitSearch(item.searchWord)"
            >
              <span class="hot-no" :class="{ top: idx < 3 }">{{ idx + 1 }}</span>
              <span>{{ item.searchWord }}</span>
              <small v-if="item.iconType === 1" class="hot-badge">HOT</small>
              <small v-else-if="item.iconType === 2" class="hot-badge new">NEW</small>
            </button>
            <div v-if="!hotWords.length && !searchHistory.length" class="suggest-state">暂无搜索历史，输入关键词开始搜索</div>
          </template>
        </template>
        <!-- 有输入：搜索建议（现有逻辑） -->
        <template v-else>
          <div v-if="suggestionsLoading && !suggestions.length" class="suggest-state">正在获取搜索建议...</div>
          <button
            v-for="(item, index) in suggestions"
            :key="item"
            type="button"
            class="suggest-item"
            :class="{ active: activeSuggestion === index }"
            @mouseenter="activeSuggestion = index"
            @mousedown.prevent="commitSearch(item)"
          >
            <Icon name="search" :size="13" />
            <span>{{ item }}</span>
            <small>搜索</small>
          </button>
          <button
            v-if="!suggestionsLoading && !suggestions.length && keyword.trim().length >= 2"
            type="button"
            class="suggest-item direct"
            @mousedown.prevent="commitSearch()"
          >
            <Icon name="search" :size="13" />
            <span>搜索“{{ keyword.trim() }}”</span>
          </button>
        </template>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.search-bar-wrap {
  position: relative;
  width: 100%;
  max-width: 420px;
}
.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
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
.search-input::-webkit-search-cancel-button { display: none; }
.search-input::placeholder { color: var(--text-tertiary); }
.clear-btn {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; flex-shrink: 0; border-radius: 50%;
  color: var(--text-tertiary);
}
.clear-btn:hover { color: var(--text); background: var(--bg-hover); }
.local-btn {
  width: 26px; height: 26px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); transition: color 0.15s, background 0.15s;
  flex-shrink: 0;
}
.local-btn:hover { color: var(--text); background: var(--bg-hover); }
.search-suggestions {
  position: absolute; top: calc(100% + 7px); left: 34px; right: 0; z-index: 120;
  max-height: 420px; overflow-y: auto;
  padding: 5px; border: 1px solid var(--border-strong); border-radius: 12px;
  background: var(--bg-elev-3); box-shadow: 0 14px 38px rgba(0,0,0,0.35);
}
.suggest-state { padding: 12px; color: var(--text-tertiary); font-size: 11px; text-align: center; }
.suggest-header {
  display: flex; align-items: center; gap: 5px;
  padding: 7px 10px 4px; color: var(--text-tertiary); font-size: 10px;
}
.suggest-header span { flex: 1; }
.suggest-header-btn { color: var(--text-tertiary); font-size: 10px; padding: 2px 7px; border-radius: 6px; }
.suggest-header-btn:hover { color: var(--text); background: var(--bg-hover); }
.history-row {
  display: flex; align-items: center; border-radius: 8px;
}
.history-row:hover { background: var(--bg-hover); }
.history-main {
  flex: 1; min-width: 0;
  display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: center;
  gap: 6px; padding: 7px 0 7px 10px;
  color: var(--text-secondary); font-size: 12px; text-align: left;
}
.history-row:hover .history-main { color: var(--text); }
.history-main span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-del {
  width: 24px; height: 24px; margin-right: 8px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); opacity: 0; flex-shrink: 0;
  transition: opacity 0.12s, background 0.12s, color 0.12s;
}
.history-row:hover .history-del { opacity: 1; }
.history-del:hover { color: var(--text); background: var(--bg-hover); }
.hot-item .hot-no {
  font-size: 11px; font-style: italic; font-weight: 700; color: var(--text-tertiary);
  font-variant-numeric: tabular-nums; text-align: center;
}
.hot-item .hot-no.top { color: #fa233b; }
.hot-badge {
  font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 4px;
  color: #fff; background: #fa233b; font-style: normal;
}
.hot-badge.new { background: #06d6a0; }
.suggest-item {
  display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center;
  gap: 6px; width: 100%; padding: 8px 10px; border-radius: 8px;
  color: var(--text-secondary); font-size: 12px; text-align: left;
}
.suggest-item:hover, .suggest-item.active { color: var(--text); background: var(--bg-hover); }
.suggest-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.suggest-item small { color: var(--text-tertiary); font-size: 9px; }
.suggest-item.direct { grid-template-columns: 18px minmax(0, 1fr); }
.suggest-enter-active, .suggest-leave-active { transition: opacity 0.14s, transform 0.14s; }
.suggest-enter-from, .suggest-leave-to { opacity: 0; transform: translateY(-5px); }
</style>
