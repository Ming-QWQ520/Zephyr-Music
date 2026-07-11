<script setup lang="ts">
/**
 * 左侧封面 + 控制区（left-pane）
 *
 * 包含：
 * - 封面展示（cover-wrap/cover/cover-shadow）
 * - 喜欢按钮（cover-like-btn）
 * - 控制按钮（播放顺序/上一首/播放/下一首/播放队列）
 * - 音质选择
 * - 音量调节
 * - 进度条
 *
 * 从 useNowPlaying 取：playMode/volumeFrac/progressFrac/song/coverUrl 等。
 */
import Icon from "@/components/Icon.vue";
import Slider from "@/components/Slider.vue";
import { formatTime } from "@/composables/utils";
import { useNowPlaying, PLAY_MODE_LABEL, PLAY_MODE_ICON } from "./useNowPlaying";

const {
  store,
  settings,
  song,
  coverUrl,
  liked,
  likeLoading,
  toggleLike,
  playMode,
  cyclePlayMode,
  showQueue,
  toggleQueue,
  volumeFrac,
  onVolume,
  toggleMute,
  onVolWheel,
  progressFrac,
  onSeek,
  cycleAudioLevel,
  currentLevelLabel,
  getLyricAtTime,
} = useNowPlaying();
</script>

<template>
  <section class="left-pane" :class="[
    `halign-${settings.hidePlayerControls ? 'center' : settings.coverHAlign}`,
    `valign-${settings.coverVAlign}`,
    { 'hide-controls': settings.hidePlayerControls }
  ]">
    <div class="cover-wrap" :class="{ rectangle: settings.rectangleCover }">
      <div class="cover-shadow" v-if="settings.coverShadow" />
      <div class="cover">
        <img
          v-if="coverUrl"
          :src="coverUrl"
          :alt="song?.name"
          referrerpolicy="no-referrer"
        />
        <div v-else class="cover-placeholder">
          <Icon name="music" :size="64" />
        </div>
      </div>
      <!-- 喜欢按钮：封面右下角，黑色 RGBA 0.1 透明背景 -->
      <button
        v-if="song?.source === 'netease'"
        class="cover-like-btn"
        :class="{ liked }"
        :disabled="likeLoading"
        :title="liked ? '取消喜欢' : '喜欢'"
        @click.stop="toggleLike"
      >
        <img v-if="liked" src="/icons/like.svg" alt="liked" class="cover-like-icon" />
        <img v-else src="/icons/not_like.svg" alt="not liked" class="cover-like-icon" />
      </button>
    </div>

    <div class="song-meta">
      <div class="title truncate">{{ song?.name || "—" }}</div>
      <div class="artist truncate">{{ song?.artist || "—" }}</div>
    </div>

    <!-- Controls (fully hidden when hidePlayerControls is on) -->
    <div class="controls-block" :class="{ hidden: settings.hidePlayerControls }">
      <div class="progress-row">
        <span class="time">{{ formatTime(store.currentTime) }}</span>
        <Slider
          class="progress"
          :model-value="progressFrac"
          :always-show-on-hover="true"
          :format="(v) => getLyricAtTime(v * store.duration)"
          @change="onSeek"
        />
        <span class="time">{{ formatTime(store.duration) }}</span>
      </div>
      <!-- 音质选择 -->
      <div class="level-row">
        <button
          class="level-pill"
          :class="{
            'level-hires': settings.audioLevel === 'hires',
            'level-lossless': settings.audioLevel === 'lossless' || settings.audioLevel === 'jymaster' || settings.audioLevel === 'jyeffect' || settings.audioLevel === 'sky' || settings.audioLevel === 'dolby',
          }"
          @click="cycleAudioLevel"
        >
          {{ currentLevelLabel }}
        </button>
      </div>
      <div class="controls">
        <button
          class="ctrl-btn"
          :class="{ active: playMode !== 'sequence' }"
          :title="PLAY_MODE_LABEL[playMode]"
          @click="cyclePlayMode"
        >
          <Icon :name="PLAY_MODE_ICON[playMode]" :size="20" />
        </button>
        <button class="ctrl-btn" :disabled="!store.hasPrev" title="上一首" @click="store.prev()">
          <Icon name="prev" :size="22" />
        </button>
        <button class="ctrl-btn play" :disabled="!song" :title="store.isPlaying ? '暂停' : '播放'" @click="store.togglePlay()">
          <Icon :name="store.isPlaying ? 'pause' : 'play'" :size="24" />
        </button>
        <button class="ctrl-btn" :disabled="!store.hasNext" title="下一首" @click="store.next()">
          <Icon name="next" :size="22" />
        </button>
        <button
          class="ctrl-btn"
          :class="{ active: showQueue }"
          title="播放列表"
          @click="toggleQueue"
        >
          <Icon name="list" :size="20" />
        </button>
      </div>
      <!-- Volume on its own row below controls (滚轮可调节) -->
      <div class="vol-row" @wheel="onVolWheel">
        <button class="ctrl-btn vol-icon" :title="store.muted || store.volume === 0 ? '取消静音' : '静音'" @click="toggleMute">
          <Icon :name="store.muted || store.volume === 0 ? 'volumeMute' : store.volume < 0.4 ? 'volumeLow' : 'volume'" :size="18" />
        </button>
        <Slider
          class="volume"
          :model-value="volumeFrac"
          :format="() => ''"
          :always-show-on-hover="false"
          :height="3"
          @change="onVolume"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
/* ----- Left pane (cover + controls) ----- */
.left-pane {
  /* 不设 position: relative，避免创建 stacking context 导致歌词溢出被遮挡 */
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 20px;
  min-height: 0;
}
.left-pane.halign-center { align-items: center; }
.left-pane.halign-right { align-items: flex-end; }
.left-pane.valign-top { justify-content: flex-start; padding-top: 24px; }
.left-pane.valign-bottom { justify-content: flex-end; padding-bottom: 24px; }

.cover-wrap {
  position: relative;
  width: clamp(260px, 26vw, 460px);
  aspect-ratio: 1 / 1;
  flex-shrink: 0;
}
.cover-wrap.rectangle { aspect-ratio: 1 / 1; border-radius: 12px; }
.cover-wrap.rectangle .cover { border-radius: 12px; }
/* 封面右下角喜欢按钮 */
.cover-like-btn {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 10; /* 喜欢按钮在歌词之上 */
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: background 0.2s, transform 0.12s;
  z-index: 5;
}
.cover-like-btn:hover {
  background: rgba(0, 0, 0, 0.25);
  transform: scale(1.08);
}
.cover-like-btn:active { transform: scale(0.95); }
.cover-like-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.cover-like-icon { width: 20px; height: 20px; display: inline-block; pointer-events: none; }
.cover-shadow {
  position: absolute;
  inset: 0;
  border-radius: 12px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55), 0 12px 32px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}
.cover {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-elev-3);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  background: linear-gradient(135deg, #2a2a30 0%, #0d0d0f 100%);
}

.song-meta {
  max-width: 100%;
  width: clamp(260px, 26vw, 460px);
  transition: opacity 0.3s var(--ease-out);
}
.song-meta .title {
  font-size: clamp(20px, 2vw, 32px);
  font-weight: 700;
  letter-spacing: -0.3px;
  color: var(--text);
}
.song-meta .artist {
  font-size: clamp(12px, 1.2vw, 18px);
  color: var(--text-secondary);
  margin-top: 4px;
}

.controls-block {
  width: clamp(260px, 26vw, 460px);
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 10; /* 控件在歌词之上（歌词 z-index 5）*/
  gap: 8px;
  transition: opacity 0.3s var(--ease-out), max-height 0.3s var(--ease-out), margin 0.3s var(--ease-out);
  max-height: 320px;
  overflow: visible; /* allow tooltip to show above progress bar */
}
/* 音质选择 pill */
.level-row { display: flex; justify-content: center; }
.level-pill {
  padding: 3px 12px; border-radius: 12px;
  background: var(--bg-elev-3); color: var(--text-secondary);
  font-size: 11px; font-weight: 500; transition: all 0.15s;
}
.level-pill:hover { color: var(--accent); background: var(--accent-soft); }
/* Hi-Res 金色 - 标志性 Hi-Res Audio 金色 */
.level-pill.level-hires {
  background: linear-gradient(135deg, #FFD700, #FFA500);
  color: #1a1a1a;
  font-weight: 700;
  border: 1px solid #FFD700;
  box-shadow: 0 0 12px rgba(255, 215, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
}
.level-pill.level-hires:hover {
  background: linear-gradient(135deg, #FFE55C, #FFB733);
  box-shadow: 0 0 18px rgba(255, 215, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.5);
}
/* 无损/超清母带等高品质音质 - 银白色微光 */
.level-pill.level-lossless {
  background: linear-gradient(135deg, #E8E8E8, #B0B0B0);
  color: #1a1a1a;
  font-weight: 600;
  border: 1px solid #C0C0C0;
  box-shadow: 0 0 8px rgba(192, 192, 192, 0.4);
}
.level-pill.level-lossless:hover {
  background: linear-gradient(135deg, #F5F5F5, #C8C8C8);
}
/* When hidePlayerControls is on, ALL playback controls collapse to zero height */
.controls-block.hidden {
  opacity: 0;
  pointer-events: none;
  max-height: 0;
  margin-top: -20px; /* negate the left-pane gap so cover stays centered */
}
.progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.progress-row .progress { flex: 1; }
.time {
  font-size: 11px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  min-width: 38px;
  text-align: center;
}
.controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.ctrl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.78);
  transition: color 0.15s, background 0.15s, transform 0.12s;
}
.ctrl-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}
.ctrl-btn:active { transform: scale(0.92); }
.ctrl-btn.active { color: #ffffff; }
.ctrl-btn[disabled] { opacity: 0.35; cursor: not-allowed; pointer-events: none; }
/* 播放按钮：无圆形白色背景，与其他按钮一致 */
.ctrl-btn.play {
  width: 44px;
  height: 44px;
  color: var(--text);
}
.ctrl-btn.play:hover {
  color: #fff;
  transform: scale(1.06);
}
.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.vol-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.vol-row .volume { flex: 1; }
</style>
