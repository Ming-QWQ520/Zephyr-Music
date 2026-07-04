<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { usePlayerStore } from "@/stores/player";
import { useSettings } from "@/components/SettingsPanel.vue";
import { formatTime } from "@/composables/utils";
import { likeSong, getCachedLikeList, refreshLikeList, addLikeCache, removeLikeCache, _cachedUser } from "@/api/netease";
import type { Song } from "@/types";
import { log } from "@/composables/logger";
import Icon from "@/components/Icon.vue";
import Slider from "@/components/Slider.vue";

const store = usePlayerStore();
const { settings } = useSettings();

// 喜欢歌曲
const liked = ref(false);
const likeLoading = ref(false);

async function toggleLike() {
  const song = store.currentSong;
  if (!song || song.source !== "netease" || !song.neteaseId) return;
  likeLoading.value = true;
  try {
    const newLike = !liked.value;
    await likeSong(song.neteaseId, newLike);
    liked.value = newLike;
    // 更新本地喜欢列表缓存
    if (newLike) addLikeCache(song.neteaseId);
    else removeLikeCache(song.neteaseId);
    log.info("player", "like toggled", { songId: song.neteaseId, liked: newLike });
  } catch (e) {
    log.warn("player", "like failed", { error: String(e) });
  }
  likeLoading.value = false;
}

// 歌曲变化时查询喜欢状态（使用缓存的喜欢列表）
watch(() => store.currentSong, async (song) => {
  liked.value = false;
  if (!song || song.source !== "netease" || !song.neteaseId) return;
  try {
    const likeSet = await getCachedLikeList();
    liked.value = likeSet.has(song.neteaseId);
  } catch { /* ignore */ }
}, { immediate: true });

// 登录后预加载喜欢列表
watch(() => _cachedUser.value, async (user) => {
  if (user) {
    try { await refreshLikeList(user.userId); } catch { /* ignore */ }
  }
}, { immediate: true });

type PlayMode = "sequence" | "list" | "single" | "shuffle";

const playMode = computed<PlayMode>(() => {
  if (store.shuffle) return "shuffle";
  if (store.repeat === "one") return "single";
  if (store.repeat === "all") return "list";
  return "sequence";
});

const PLAY_MODE_ORDER: PlayMode[] = ["sequence", "list", "single", "shuffle"];
const PLAY_MODE_LABEL: Record<PlayMode, string> = {
  sequence: "顺序播放", list: "列表循环", single: "单曲循环", shuffle: "随机播放",
};
const PLAY_MODE_ICON: Record<PlayMode, string> = {
  sequence: "sequence", list: "repeat", single: "repeatOne", shuffle: "shuffle",
};

function cyclePlayMode() {
  const idx = PLAY_MODE_ORDER.indexOf(playMode.value);
  const next = PLAY_MODE_ORDER[(idx + 1) % PLAY_MODE_ORDER.length];
  store.shuffle = false;
  if (store.repeat !== "off") store.repeat = "off";
  if (next === "list") store.repeat = "all";
  else if (next === "single") store.repeat = "one";
  else if (next === "shuffle") store.shuffle = true;
}

const progressFrac = computed(() => store.progress);
function onSeek(f: number) { store.seekByFraction(f); }
const progressText = computed(() => formatTime(store.currentTime));
const durationText = computed(() => formatTime(store.duration));
const volumeFrac = computed(() => (store.muted ? 0 : store.volume));
function onVolume(f: number) { store.setVolume(f); }
function toggleMute() { store.toggleMute(); }
function openFullscreen() { store.openFullscreenPlayer(); }

// 音质
const audioLevels = [
  { key: "standard", label: "标准" },
  { key: "higher", label: "较高" },
  { key: "exhigh", label: "极高" },
  { key: "lossless", label: "无损" },
  { key: "hires", label: "Hi-Res" },
  { key: "jyeffect", label: "高清环绕" },
  { key: "sky", label: "沉浸环绕" },
  { key: "dolby", label: "杜比全景" },
  { key: "jymaster", label: "超清母带" },
];
const levelPopupOpen = ref(false);
function toggleLevelPopup() { levelPopupOpen.value = !levelPopupOpen.value; }
function selectLevel(key: string) {
  settings.audioLevel = key;
  levelPopupOpen.value = false;
}
const currentLevelLabel = computed(() => {
  const l = audioLevels.find(l => l.key === settings.audioLevel);
  return l ? l.label : "标准";
});

// 切换音质后立即刷新当前歌曲 URL，从之前播放处继续
watch(() => settings.audioLevel, async () => {
  const song = store.currentSong;
  if (song && song.source === "netease" && song.neteaseId) {
    // 保存当前播放进度
    const savedTime = store.currentTime;
    const wasPlaying = store.isPlaying;
    // 清除缓存 URL，强制重新获取
    song.url = "";
    const idx = store.queue.findIndex(s => s.id === song.id);
    if (idx >= 0) store.queue[idx].url = "";
    // 重新获取 URL
    await store._ensureNeteaseUrl(song);
    // 恢复播放进度
    store.currentTime = savedTime;
    // 恢复播放状态
    if (wasPlaying) {
      store.isPlaying = false;
      await nextTick();
      store.isPlaying = true;
    }
  }
});

// 音量 hover
const volHover = ref(false);

// 播放队列弹窗
const showQueuePopup = ref(false);
const queueList = computed(() => store.queue);
const queueLoading = ref(false);

/** 打开播放队列弹窗（先转圈1秒） */
function toggleQueuePopup() {
  if (showQueuePopup.value) {
    showQueuePopup.value = false;
    return;
  }
  // 先显示转圈
  queueLoading.value = true;
  showQueuePopup.value = true;
  // 1秒后显示列表
  setTimeout(() => { queueLoading.value = false; }, 1000);
}

// 播放队列右键菜单
const queueCtxMenu = ref<{ visible: boolean; x: number; y: number; song: Song | null; idx: number }>({ visible: false, x: 0, y: 0, song: null, idx: -1 });
function onQueueContextMenu(e: MouseEvent, song: Song, idx: number) {
  queueCtxMenu.value = { visible: true, x: e.clientX, y: e.clientY, song, idx };
}
function closeQueueCtxMenu() { queueCtxMenu.value.visible = false; }
function queueCtxPlay() {
  const { song, idx } = queueCtxMenu.value;
  if (song && idx >= 0) { store.currentIndex = idx; store.setPlaying(true); store.loadLyrics(song); }
  closeQueueCtxMenu();
}
function queueCtxPlayNext() {
  const { song } = queueCtxMenu.value;
  if (song) store.playNext(song);
  closeQueueCtxMenu();
}
function queueCtxRemove() {
  const { idx } = queueCtxMenu.value;
  if (idx >= 0) store.removeFromQueue(idx);
  closeQueueCtxMenu();
}

// 鼠标滚轮调节音量：向上增大，向下减小
function onVolWheel(e: WheelEvent) {
  e.preventDefault();
  const step = 0.05; // 每次滚动 5%
  // deltaY < 0（向上滚）→ 增大音量；deltaY > 0（向下滚）→ 减小音量
  const delta = e.deltaY < 0 ? step : -step;
  const newVol = Math.max(0, Math.min(1, store.volume + delta));
  store.setVolume(newVol);
  // 滚轮时显示音量弹框
  volHover.value = true;
}

// 点击外部关闭音质弹窗、播放队列弹窗和右键菜单
function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (levelPopupOpen.value && target && !target.closest(".level-wrap")) {
    levelPopupOpen.value = false;
  }
  if (showQueuePopup.value && target && !target.closest(".center-block") && !target.closest(".queue-popup")) {
    showQueuePopup.value = false;
  }
  if (queueCtxMenu.value.visible && target && !target.closest(".ctx-menu")) {
    closeQueueCtxMenu();
  }
}
onMounted(() => { document.addEventListener("click", onDocClick); });
onUnmounted(() => { document.removeEventListener("click", onDocClick); });
</script>

<template>
  <footer class="player-bar" :class="{ 'has-song': store.currentSong }" @click="openFullscreen">
    <!-- Left: vinyl cover + meta -->
    <div class="left-block">
      <div class="vinyl" :class="{ spinning: store.isPlaying && settings.coverRotation }">
        <div class="cover">
          <img v-if="store.currentSong?.pic" :src="store.currentSong.pic" :alt="store.currentSong.name" referrerpolicy="no-referrer" />
          <Icon v-else name="music" :size="22" />
        </div>
        <div class="grooves" />
      </div>
      <div class="meta">
        <div class="title truncate">{{ store.currentSong?.name || "未在播放" }}</div>
        <div class="artist truncate">{{ store.currentSong?.artist || "—" }}</div>
      </div>
      <!-- 喜欢按钮 -->
      <button
        v-if="store.currentSong?.source === 'netease'"
        class="ctrl-btn like-btn"
        :class="{ liked }"
        :disabled="likeLoading"
        :title="liked ? '取消喜欢' : '喜欢'"
        @click.stop="toggleLike"
      >
        <img v-if="liked" src="/icons/like.svg" alt="liked" class="like-icon" />
        <img v-else src="/icons/not_like.svg" alt="not liked" class="like-icon" />
      </button>
    </div>

    <!-- Center: controls + progress -->
    <div class="center-block">
      <div class="controls">
        <button class="ctrl-btn mode" :class="{ active: playMode !== 'sequence' }" :title="PLAY_MODE_LABEL[playMode]" @click.stop="cyclePlayMode">
          <Icon :name="PLAY_MODE_ICON[playMode]" :size="18" />
        </button>
        <button class="ctrl-btn" :disabled="!store.hasPrev" title="上一首" @click.stop="store.prev()">
          <Icon name="prev" :size="20" />
        </button>
        <button class="ctrl-btn play" :disabled="!store.currentSong" :title="store.isPlaying ? '暂停' : '播放'" @click.stop="store.togglePlay()">
          <Icon :name="store.isPlaying ? 'pause' : 'play'" :size="22" />
        </button>
        <button class="ctrl-btn" :disabled="!store.hasNext" title="下一首" @click.stop="store.next()">
          <Icon name="next" :size="20" />
        </button>
        <button class="ctrl-btn" :class="{ active: showQueuePopup }" title="播放队列" @click.stop="toggleQueuePopup">
          <Icon name="list" :size="18" />
        </button>
      </div>
      <div class="progress-row">
        <span class="time cur">{{ progressText }}</span>
        <Slider class="progress" :model-value="progressFrac" :format="(v) => formatTime(v * store.duration)" @change="onSeek" />
        <span class="time dur">{{ durationText }}</span>
      </div>
    </div>

    <!-- Right: audio level + volume (hover above) -->
    <div class="right-block">
      <!-- 音质选择（点击弹出音质列表） -->
      <div class="level-wrap">
        <button class="ctrl-btn level-btn" :title="`音质: ${currentLevelLabel}`" @click.stop="toggleLevelPopup">
          <span class="level-text">{{ currentLevelLabel }}</span>
        </button>
        <Transition name="lvl-drop">
          <div v-show="levelPopupOpen" class="level-popup">
            <button
              v-for="l in audioLevels"
              :key="l.key"
              class="level-option"
              :class="{ active: l.key === settings.audioLevel }"
              @click.stop="selectLevel(l.key)"
            >{{ l.label }}</button>
          </div>
        </Transition>
      </div>
      <!-- 音量区域（hover 时弹出滑块，滚轮调节） -->
      <div class="vol-wrap" @mouseenter="volHover = true" @mouseleave="volHover = false" @wheel="onVolWheel">
        <!-- 音量图标（始终显示） -->
        <button class="ctrl-btn vol-icon" :title="store.muted || store.volume === 0 ? '取消静音' : '静音'" @click.stop="toggleMute">
          <Icon :name="store.muted || store.volume === 0 ? 'volumeMute' : store.volume < 0.4 ? 'volumeLow' : 'volume'" :size="18" />
        </button>
        <!-- 音量滑块（hover 时从上方竖向弹出） -->
        <Transition name="vol-drop">
          <div v-show="volHover" class="vol-popup">
            <Slider class="volume" :model-value="volumeFrac" :format="() => ''" :always-show-on-hover="false" :height="4" vertical @change="onVolume" />
          </div>
        </Transition>
      </div>
    </div>
  </footer>

  <!-- 播放队列弹窗（从右侧弹出） -->
  <Transition name="queue-slide">
    <aside v-if="showQueuePopup" class="queue-popup" @click.stop>
      <header class="qp-head">
        <h3>播放队列</h3>
        <span class="qp-count">{{ queueList.length }} 首</span>
        <button class="icon-btn" title="关闭" @click="showQueuePopup = false">
          <Icon name="close" :size="18" />
        </button>
      </header>
      <!-- 加载中转圈 -->
      <div v-if="queueLoading" class="qp-loading">
        <div class="spinner" />
      </div>
      <div v-else class="qp-list nice-scroll">
        <button
          v-for="(s, idx) in queueList"
          :key="s.id"
          class="qp-item"
          :class="{ active: s.id === store.currentSong?.id }"
          @click="() => { store.currentIndex = idx; store.setPlaying(true); const song = store.queue[idx]; if (song) store.loadLyrics(song); }"
          @contextmenu.prevent="onQueueContextMenu($event, s, idx)"
        >
          <div class="qp-cover">
            <img v-if="s.pic" :src="s.pic" :alt="s.name" referrerpolicy="no-referrer" loading="lazy" />
            <Icon v-else name="music" :size="14" />
          </div>
          <div class="qp-meta">
            <div class="qp-title truncate">{{ s.name }}</div>
            <div class="qp-artist truncate">{{ s.artist }}</div>
          </div>
          <Icon v-if="s.id === store.currentSong?.id && store.isPlaying" name="volume" :size="14" class="qp-now" />
        </button>
      </div>
    </aside>
  </Transition>

  <!-- 播放队列右键菜单 -->
  <Transition name="ctx-fade">
    <div v-if="queueCtxMenu.visible && queueCtxMenu.song"
      class="ctx-menu" :style="{ left: queueCtxMenu.x + 'px', top: queueCtxMenu.y + 'px' }" @click.stop>
      <button class="ctx-item" @click="queueCtxPlay"><Icon name="play" :size="14" /><span>播放</span></button>
      <button class="ctx-item" @click="queueCtxPlayNext"><Icon name="next" :size="14" /><span>下一首播放</span></button>
      <div class="ctx-divider" />
      <button class="ctx-item ctx-danger" @click="queueCtxRemove"><Icon name="trash" :size="14" /><span>从列表中移除</span></button>
    </div>
  </Transition>
</template>

<style scoped>
.player-bar {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(360px, 2fr) minmax(140px, 1fr);
  align-items: center;
  gap: 18px;
  height: var(--playerbar-h);
  padding: 0 16px;
  background: var(--bg-glass);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-top: 1px solid var(--border);
}
.left-block { display: flex; align-items: center; gap: 12px; min-width: 0; cursor: pointer; }
.vinyl { position: relative; width: 52px; height: 52px; flex-shrink: 0; border-radius: 50%; background: #0a0a0a; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
.vinyl.spinning .cover { animation: vinyl-spin 6s linear infinite; }
.cover { width: 38px; height: 38px; border-radius: 50%; background: var(--bg-elev-3); overflow: hidden; display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); }
.cover img { width: 100%; height: 100%; object-fit: cover; }
.grooves::before, .grooves::after { content: ""; position: absolute; inset: 0; border-radius: 50%; border: 1px solid rgba(255,255,255,0.04); pointer-events: none; }
.grooves::before { inset: 4px; } .grooves::after { inset: 8px; }
.meta { min-width: 0; flex: 1; }
.meta .title { font-size: 13px; font-weight: 600; color: var(--text); }
.meta .artist { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }
.like-btn { width: 28px; height: 28px; color: var(--text-tertiary); flex-shrink: 0; }
.like-btn:hover { color: var(--accent); }
.like-btn.liked { color: var(--accent); }
.like-btn:disabled { opacity: 0.4; }
.like-icon { width: 18px; height: 18px; display: inline-block; flex-shrink: 0; pointer-events: none; }

.center-block { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; }
.controls { display: flex; align-items: center; gap: 4px; }
.ctrl-btn { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: var(--radius-sm); color: var(--text-secondary); transition: color 0.2s var(--ease-out), background 0.2s var(--ease-out); }
.ctrl-btn:hover { color: var(--text); background: var(--bg-hover); }
.ctrl-btn:active { background: var(--bg-active); }
.ctrl-btn.active { color: var(--accent); background: var(--accent-soft); }
.ctrl-btn[disabled] { opacity: 0.38; cursor: not-allowed; pointer-events: none; }
/* MD3 FAB-style play button */
.ctrl-btn.play { width: 48px; height: 48px; color: var(--on-accent); background: var(--accent); margin: 0 4px; }
.ctrl-btn.play:hover { color: var(--on-accent); background: var(--accent-strong); transform: scale(1.05); }
.ctrl-btn.play:active { transform: scale(0.95); }

.progress-row { display: flex; align-items: center; gap: 8px; width: 100%; max-width: 520px; }
.progress { flex: 1; }
.time { font-size: 11px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; min-width: 38px; text-align: center; }

.right-block { display: flex; align-items: center; gap: 6px; justify-content: flex-end; position: relative; }
.level-wrap { position: relative; }
.level-btn { width: auto; padding: 0 8px; font-size: 11px; font-weight: 500; }
.level-text { white-space: nowrap; }
/* 音质弹出框 */
.level-popup {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  background: var(--bg-elev-3);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  z-index: 60;
  min-width: 96px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.level-option {
  display: block;
  width: 100%;
  padding: 7px 12px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: left;
  transition: color 0.15s, background 0.15s;
  white-space: nowrap;
}
.level-option:hover { color: var(--text); background: var(--bg-hover); }
.level-option.active { color: var(--accent); background: var(--bg-hover); }
.lvl-drop-enter-active, .lvl-drop-leave-active { transition: opacity 0.15s, transform 0.15s; }
.lvl-drop-enter-from, .lvl-drop-leave-to { opacity: 0; transform: translateY(8px); }

/* 音量区域 */
.vol-wrap { position: relative; display: flex; align-items: center; }
/* 音量滑块从上方竖向弹出 */
.vol-popup {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 50%;
  transform: translateX(50%);
  background: var(--bg-elev-3);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  padding: 12px 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 124px;
}
.volume { width: 14px; height: 100px; flex-shrink: 0; }
.vol-icon { width: 28px; height: 28px; }
.vol-drop-enter-active, .vol-drop-leave-active { transition: opacity 0.15s, transform 0.15s; }
.vol-drop-enter-from, .vol-drop-leave-to { opacity: 0; transform: translateX(50%) translateY(8px); }

@media (max-width: 900px) {
  .player-bar { grid-template-columns: 1fr auto; grid-template-rows: auto auto; height: auto; padding: 10px 12px; gap: 8px 12px; }
  .center-block { grid-column: 1 / -1; grid-row: 2; }
  .right-block { justify-content: flex-end; }
  .progress-row .time { display: none; }
  .controls { gap: 8px; }
  .volume { width: 14px; height: 80px; }
}
@media (max-width: 560px) {
  .meta .artist { display: none; }
  .volume { display: none; }
  .vol-icon { display: none; }
  .level-btn { display: none; }
}
@keyframes vinyl-spin { to { transform: rotate(360deg); } }

/* 播放队列弹窗 */
.queue-popup {
  position: fixed;
  right: 0;
  bottom: var(--playerbar-h);
  width: 340px;
  max-width: 90vw;
  height: 420px;
  max-height: 60vh;
  background: var(--bg-elev-3);
  border: 1px solid var(--border-strong);
  border-right: none;
  border-radius: 12px 0 0 12px;
  box-shadow: -8px 0 32px rgba(0,0,0,0.4);
  z-index: 200;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.qp-head {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 16px 10px; border-bottom: 1px solid var(--border);
}
.qp-head h3 { margin: 0; font-size: 15px; font-weight: 700; }
.qp-count { font-size: 11px; color: var(--text-tertiary); }
.qp-head .icon-btn { margin-left: auto; width: 28px; height: 28px; color: var(--text-tertiary); }
.qp-head .icon-btn:hover { color: var(--text); }
.qp-list { flex: 1; overflow-y: auto; padding: 4px; }
.qp-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 7px 10px; border-radius: 8px;
  text-align: left; transition: background 0.1s;
}
.qp-item:hover { background: var(--bg-hover); }
.qp-item.active { background: var(--accent-soft); }
.qp-item.active .qp-title { color: var(--accent); }
.qp-cover {
  width: 36px; height: 36px; border-radius: 6px; flex-shrink: 0;
  background: var(--bg-elev-1); overflow: hidden;
  display: flex; align-items: center; justify-content: center; color: var(--text-tertiary);
}
.qp-cover img { width: 100%; height: 100%; object-fit: cover; }
.qp-meta { flex: 1; min-width: 0; }
.qp-title { font-size: 13px; color: var(--text); font-weight: 500; }
.qp-artist { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }
.qp-now { color: var(--accent); flex-shrink: 0; }
/* 从右侧滑入动画 */
.queue-slide-enter-active, .queue-slide-leave-active { transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s; }
.queue-slide-enter-from, .queue-slide-leave-to { transform: translateX(100%); opacity: 0; }

/* 队列加载转圈 */
.qp-loading { flex: 1; display: flex; align-items: center; justify-content: center; }
.qp-loading .spinner { width: 28px; height: 28px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }

/* 右键菜单 */
.ctx-menu { position: fixed; z-index: 500; min-width: 170px; background: var(--bg-elev-3); border: 1px solid var(--border-strong); border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,0.4); padding: 4px; }
.ctx-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; border-radius: 6px; font-size: 13px; color: var(--text); text-align: left; transition: background 0.1s; }
.ctx-item:hover { background: var(--bg-hover); color: var(--accent); }
.ctx-danger { color: var(--text-secondary); }
.ctx-danger:hover { color: #ff4d4f; background: rgba(255,77,79,0.1); }
.ctx-divider { height: 1px; background: var(--border); margin: 4px 8px; }
.ctx-fade-enter-active, .ctx-fade-leave-active { transition: opacity 0.12s, transform 0.12s; }
.ctx-fade-enter-from, .ctx-fade-leave-to { opacity: 0; transform: scale(0.95); }
</style>
