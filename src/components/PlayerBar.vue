<script setup lang="ts">
import { computed } from "vue";
import { usePlayerStore } from "@/stores/player";
import { formatTime } from "@/composables/utils";
import Icon from "@/components/Icon.vue";
import Slider from "@/components/Slider.vue";

const store = usePlayerStore();

type PlayMode = "sequence" | "list" | "single" | "shuffle";

const playMode = computed<PlayMode>(() => {
  if (store.shuffle) return "shuffle";
  if (store.repeat === "one") return "single";
  if (store.repeat === "all") return "list";
  return "sequence";
});

const PLAY_MODE_ORDER: PlayMode[] = ["sequence", "list", "single", "shuffle"];
const PLAY_MODE_LABEL: Record<PlayMode, string> = {
  sequence: "顺序播放",
  list: "列表循环",
  single: "单曲循环",
  shuffle: "随机播放",
};
const PLAY_MODE_ICON: Record<PlayMode, string> = {
  sequence: "sequence",
  list: "repeat",
  single: "repeatOne",
  shuffle: "shuffle",
};

function cyclePlayMode() {
  const idx = PLAY_MODE_ORDER.indexOf(playMode.value);
  const next = PLAY_MODE_ORDER[(idx + 1) % PLAY_MODE_ORDER.length];
  // Reset both then set the appropriate one
  store.shuffle = false;
  if (store.repeat !== "off") store.repeat = "off";
  if (next === "list") store.repeat = "all";
  else if (next === "single") store.repeat = "one";
  else if (next === "shuffle") store.shuffle = true;
}

const progressFrac = computed(() => store.progress);
const bufferedFrac = computed(() => store.bufferedFrac);

function onSeek(f: number) {
  store.seekByFraction(f);
}

const progressText = computed(() => formatTime(store.currentTime));
const durationText = computed(() => formatTime(store.duration));

const volumeFrac = computed(() => (store.muted ? 0 : store.volume));

function onVolume(f: number) {
  store.setVolume(f);
}

function onVolumeEnd() {
  /* nothing */
}

function toggleMute() {
  store.toggleMute();
}

function openFullscreen() {
  store.openFullscreenPlayer();
}
</script>

<template>
  <footer class="player-bar" :class="{ 'has-song': store.currentSong }">
    <!-- Left: vinyl cover + meta -->
    <div class="left-block" @click="openFullscreen">
      <div class="vinyl" :class="{ spinning: store.isPlaying }">
        <div class="cover">
          <img
            v-if="store.currentSong?.pic"
            :src="store.currentSong.pic"
            :alt="store.currentSong.name"
            referrerpolicy="no-referrer"
          />
          <Icon v-else name="music" :size="22" />
        </div>
        <div class="grooves" />
      </div>
      <div class="meta">
        <div class="title truncate">{{ store.currentSong?.name || "未在播放" }}</div>
        <div class="artist truncate">{{ store.currentSong?.artist || "—" }}</div>
      </div>
    </div>

    <!-- Center: controls + progress -->
    <div class="center-block">
      <div class="controls">
        <button
          class="ctrl-btn mode"
          :class="{ active: playMode !== 'sequence' }"
          :title="PLAY_MODE_LABEL[playMode]"
          @click.stop="cyclePlayMode"
        >
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
        <button
          class="ctrl-btn"
          :class="{ active: store.currentView === 'queue' }"
          title="播放队列"
          @click.stop="store.setView(store.currentView === 'queue' ? 'search' : 'queue')"
        >
          <Icon name="list" :size="18" />
        </button>
      </div>
      <div class="progress-row">
        <span class="time cur">{{ progressText }}</span>
        <Slider
          class="progress"
          :model-value="progressFrac"
          :buffered="bufferedFrac"
          :format="(v) => formatTime(v * store.duration)"
          @change="onSeek"
        />
        <span class="time dur">{{ durationText }}</span>
      </div>
    </div>

    <!-- Right: volume + actions -->
    <div class="right-block">
      <button class="ctrl-btn vol-icon" :title="store.muted || store.volume === 0 ? '取消静音' : '静音'" @click.stop="toggleMute">
        <Icon :name="store.muted || store.volume === 0 ? 'volumeMute' : store.volume < 0.4 ? 'volumeLow' : 'volume'" :size="18" />
      </button>
      <Slider
        class="volume"
        :model-value="volumeFrac"
        :format="(v) => `${Math.round(v * 100)}%`"
        :always-show-on-hover="false"
        :height="3"
        @change="onVolume"
        @dragend="onVolumeEnd"
      />
    </div>
  </footer>
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

.left-block {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  cursor: pointer;
}
.vinyl {
  position: relative;
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #0a0a0a;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}
.vinyl.spinning .cover {
  animation: vinyl-spin 6s linear infinite;
}
.cover {
  width: 38px;
  height: 38px;
  border-radius: 50%;
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
.grooves::before,
.grooves::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.04);
  pointer-events: none;
}
.grooves::before { inset: 4px; }
.grooves::after { inset: 8px; }

.meta {
  min-width: 0;
  flex: 1;
}
.meta .title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.meta .artist {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 1px;
}

.center-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.controls {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ctrl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  color: var(--text-secondary);
  transition: color 0.15s, background 0.15s, transform 0.12s;
}
.ctrl-btn:hover {
  color: var(--text);
  background: var(--bg-hover);
}
.ctrl-btn:active { transform: scale(0.92); }
.ctrl-btn.active {
  color: var(--accent);
}
.ctrl-btn[disabled] {
  opacity: 0.35;
  cursor: not-allowed;
  pointer-events: none;
}
.ctrl-btn.play {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--text);
  color: #000;
  margin: 0 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}
.ctrl-btn.play:hover {
  background: #fff;
  color: #000;
  transform: scale(1.05);
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 520px;
}
.progress {
  flex: 1;
}
.time {
  font-size: 11px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  min-width: 38px;
  text-align: center;
}

.right-block {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}
.volume {
  width: 100px;
}
.vol-icon {
  width: 28px;
  height: 28px;
}

@media (max-width: 900px) {
  .player-bar {
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    height: auto;
    padding: 10px 12px;
    gap: 8px 12px;
  }
  .center-block {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .right-block {
    justify-content: flex-end;
  }
  .progress-row .time { display: none; }
  .controls { gap: 8px; }
  .volume { width: 70px; }
}

@media (max-width: 560px) {
  .meta .artist { display: none; }
  .volume { display: none; }
  .vol-icon { display: none; }
}
</style>
