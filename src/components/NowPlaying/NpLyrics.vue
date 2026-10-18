<script setup lang="ts">
/**
 * 右侧歌词区（right-pane） — 最大最复杂的子组件
 *
 * 内部维护歌词渲染引擎：
 *  - 歌词解析数据 parsedLyrics / yrcLines / activeIndex 从 useNowPlaying 取（跨组件共享）
 *  - 歌词滚动（userScroll / measureLineHeights / lineRO）
 *  - 歌词变换（computeAllTransforms / lineStyle）— RNP 风格的逐行绝对定位 + 旋转/缩放/模糊
 *  - yrc 逐字擦除动画（wordProgress / wipePercent / activeWords / updateWipe）
 *  - 歌词选择模式交互（右键/长按进入，点击勾选，复制）— 选择模式状态本身在 useNowPlaying
 *  - 翻译/罗马音显示开关由 useSettings 控制
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick, type CSSProperties } from "vue";
import Icon from "@/components/Icon.vue";
import Slider from "@/components/Slider.vue";
import { useNowPlaying, PLAY_MODE_LABEL, PLAY_MODE_ICON } from "./useNowPlaying";
import { useWindowActivity } from "@/composables/useWindowActivity";
import { formatTime } from "@/composables/utils";

const {
  store,
  settings,
  parsedLyrics,
  yrcLines,
  activeIndex,
  lyricSelectMode,
  selectedLyricLines,
  enterLyricSelectMode,
  toggleLyricLineSelection,
  // 百科翻转时显示在歌词顶部的歌曲信息条
  showWiki,
  song,
  coverUrl,
  playMode,
  cyclePlayMode,
  showQueue,
  toggleQueue,
  getLyricAtTime,
} = useNowPlaying();

const playModeLabel = computed(() => PLAY_MODE_LABEL[playMode.value]);
const playModeIcon = computed(() => PLAY_MODE_ICON[playMode.value]);

// 信息栏进度条 seek
function onInfoBarSeek(f: number) { store.seekByFraction(f); }

// ----- Refs -----
const lyricWrapRef = ref<HTMLDivElement | null>(null);
const lineRefs = ref<(HTMLDivElement | null)[]>([]);

// 用户滚轮滚动偏移（px），2秒无操作后归零自动跟随
const userScrollY = ref(0);
let userScrollTimer: ReturnType<typeof setTimeout> | null = null;
// 旋转模式下的歌词行偏移（滚轮滑动让弧形旋转，而非上下平移）
const rotateScrollOffset = ref(0);
let rotateScrollTimer: ReturnType<typeof setTimeout> | null = null;

function onLyricWheel(e: WheelEvent) {
  e.preventDefault();
  // 歌词选择模式下：标准上下滚动浏览
  if (lyricSelectMode.value) {
    userScrollY.value -= e.deltaY;
    return;
  }
  // 旋转模式：滚轮滑动 → 弧形旋转（改变 activeLyricIndex 偏移，非 translateY）
  if (settings.lyricRotate) {
    rotateScrollOffset.value += e.deltaY;
    if (rotateScrollTimer) clearTimeout(rotateScrollTimer);
    rotateScrollTimer = setTimeout(() => {
      rotateScrollOffset.value = 0;
      rotateScrollTimer = null;
    }, 2000);
    return;
  }
  // 非旋转模式：标准上下滚动偏移
  userScrollY.value -= e.deltaY;
  if (userScrollTimer) clearTimeout(userScrollTimer);
  userScrollTimer = setTimeout(() => {
    userScrollY.value = 0;
    userScrollTimer = null;
  }, 2000);
}

// 选择模式进入/退出时重置用户滚动偏移（原 enterLyricSelectMode / exitLyricSelectMode 中的逻辑）
watch(lyricSelectMode, () => {
  userScrollY.value = 0;
  if (userScrollTimer) { clearTimeout(userScrollTimer); userScrollTimer = null; }
});

// ----- Line heights measurement -----
// Measured line heights (updated via ResizeObserver + on lyrics change)
const measuredHeights = ref<number[]>([]);
let lineHeightRAF = 0;

function setLineRef(el: any, idx: number) {
  lineRefs.value[idx] = el as HTMLDivElement;
}

function measureLineHeights() {
  if (lineHeightRAF) return;
  lineHeightRAF = requestAnimationFrame(() => {
    lineHeightRAF = 0;
    const heights: number[] = [];
    for (let i = 0; i < lineRefs.value.length; i++) {
      const el = lineRefs.value[i];
      heights.push(el ? el.offsetHeight : 0);
    }
    // Only update if changed (avoid reactive loops)
    const changed = heights.length !== measuredHeights.value.length ||
      heights.some((h, i) => Math.abs(h - measuredHeights.value[i]) > 1);
    if (changed) measuredHeights.value = heights;
  });
}

// Watch lyrics and settings to re-measure.
// NOTE: we intentionally do NOT re-measure on active index changes.
// Font size is uniform across active/inactive (differentiation is done via
// CSS scale only), so measured heights stay stable when the active line
// changes. This prevents reactive feedback loops.
watch([
  () => store.lyrics,
  () => settings.lyricFontSize,
  () => settings.lyricLineGap,
  () => settings.rotateLyricFontSize,
  () => settings.rotateLyricLineGap,
  () => settings.fontScale,
  () => settings.fontFamily,
  () => settings.showTranslation,
  () => settings.showRomaji,
  () => settings.lyricRotate,
  () => settings.rotateCurvature,
], () => {
  nextTick(() => measureLineHeights());
}, { immediate: true });

// ResizeObserver on the wrap
let lineRO: ResizeObserver | null = null;
onMounted(() => {
  lineRO = new ResizeObserver(() => measureLineHeights());
  if (lyricWrapRef.value) lineRO.observe(lyricWrapRef.value);
  measureLineHeights();
  // 窗口大小变化时重新测量歌词高度（响应式字体大小变化导致高度变化）
  window.addEventListener("resize", onWindowResize);
});
onUnmounted(() => {
  lineRO?.disconnect();
  if (lineHeightRAF) cancelAnimationFrame(lineHeightRAF);
  if (userScrollTimer) clearTimeout(userScrollTimer);
  window.removeEventListener("resize", onWindowResize);
});

// 窗口大小变化时重新测量歌词高度 + 强制 allTransforms 重新计算
let resizeTick = ref(0);
function onWindowResize() {
  measureLineHeights();
  resizeTick.value++; // 触发 allTransforms 重新计算
}

// ----- Lyric transform engine (RNP-style) -----
interface LineTransform {
  top: number;
  scale: number;
  opacity: number;
  blur: number;
  delay: number;
  rotate: number;
  extraTop: number;
  left: number;
  outOfRange: boolean;
}

const previousActive = ref(-1);
watch(() => store.activeLyricIndex, (idx) => {
  if (idx >= 0) {
    nextTick(() => window.setTimeout(() => { previousActive.value = idx; }, 600));
  }
});

function computeAllTransforms(): LineTransform[] {
  const lyrics = parsedLyrics.value;
  if (!lyrics.length) return [];
  // 旋转模式下：rotateScrollOffset 改变视觉上的"当前行"，让弧形旋转
  // 把像素偏移转换为行数偏移（每行约 60px）
  const rotateLineOffset = settings.lyricRotate ? Math.round(rotateScrollOffset.value / 60) : 0;
  void resizeTick.value; // 窗口大小变化时触发重新计算
  const cur = Math.max(0, Math.min(activeIndex.value + rotateLineOffset, lyrics.length - 1));
  // When lyricRotate is on, use left align (semicircle effect)
  const alignPct = settings.lyricRotate ? 50 :
    settings.currentLyricAlign === "center" ? 50 : 50;
  const containerH = lyricWrapRef.value?.clientHeight || window.innerHeight || 600;
  // Container width — used to clamp the horizontal `left` offset of rotated
  // lyric lines so they don't get pushed past the right edge (or pulled past
  // the left edge) and get clipped by overflow:hidden.
  const containerW = lyricWrapRef.value?.clientWidth || window.innerWidth || 800;

  let gap = settings.lyricRotate ? settings.rotateLyricLineGap : settings.lyricLineGap;
  if (settings.lyricRotate) {
    gap += settings.rotateCurvature * 0.6;
  }
  const space = gap;
  const fontSize = settings.lyricFontSize;

  // Scale function (RNP scaleByOffset)
  function scaleByOffset(offset: number): number {
    const a = Math.abs(offset);
    const v = Math.max(1 - a * 0.15, 0);
    const base = v * v * v * 0.2 + 0.8;
    return base / Math.max(0.5, settings.lyricZoom);
  }
  // Opacity (RNP opacityByOffset) — lyricFade 控制非活跃行淡出强度
  function opacityByOffset(offset: number): number {
    const a = Math.abs(offset);
    if (a <= 1) return 1;
    const base = Math.max(1 - 0.25 * (a - 1), 0.3);
    return 1 - (1 - base) * settings.lyricFade;
  }
  // Blur (RNP blurByOffset) — lyricBlur 控制非活跃行模糊强度
  function blurByOffset(offset: number): number {
    const a = Math.abs(offset);
    if (a === 0) return 0;
    return Math.min(0.2 + 0.3 * a, 1.2) * settings.lyricBlur;
  }
  // Delay (RNP delayByOffset)
  function delayByOffset(offset: number): number {
    if (!settings.lyricStagger) return 0;
    if (activeIndex.value === previousActive.value) return 0;
    const sign = activeIndex.value > previousActive.value ? 1 : -1;
    const clamped = Math.max(-3, Math.min(3, offset)) * sign + 3;
    return clamped * 30;
  }

  // Fixed line height (fallback when measured heights aren't available yet)
  const fallbackLineHeight = fontSize * 1.4;
  // Use measured heights when available
  const heightFor = (i: number): number => {
    const m = measuredHeights.value[i];
    return m && m > 0 ? m : fallbackLineHeight;
  };

  const transforms: LineTransform[] = lyrics.map(() => ({
    top: 0, scale: 1, opacity: 1, blur: 0, delay: 0,
    rotate: 0, extraTop: 0, left: 0, outOfRange: false,
  }));

  // Active line: positioned at alignPct of container height, vertically centered.
  const activeScale = settings.lyricZoom;
  const activeH = heightFor(cur) * activeScale;
  transforms[cur].top = containerH * (alignPct / 100) - activeH / 2;
  transforms[cur].scale = activeScale;
  transforms[cur].opacity = 1;
  transforms[cur].blur = 0;
  transforms[cur].delay = delayByOffset(0);

  // Lines before current (going up) — IMPORTANT: visual-edge stacking math
  // (see the long comment in the original source).
  for (let i = cur - 1; i >= 0; i--) {
    const off = cur - i;
    transforms[i].scale = scaleByOffset(off);
    transforms[i].blur = blurByOffset(i - cur);
    transforms[i].opacity = opacityByOffset(i - cur);
    const s = transforms[i].scale;
    const h = heightFor(i);
    const sNext = transforms[i + 1].scale;
    const hNext = heightFor(i + 1);
    const visualTopNext = transforms[i + 1].top + hNext * (1 - sNext) / 2;
    transforms[i].top = visualTopNext - space - h * (1 + s) / 2;
    transforms[i].delay = delayByOffset(i - cur);

    if (settings.lyricRotate) {
      const yOffset = transforms[cur].top - transforms[i].top;
      const h2 = heightFor(i) * transforms[i].scale;
      const vh = window.innerHeight || 1;
      const curvature = settings.rotateCurvature;
      const origin = [-120 + (curvature - 25), -(yOffset + h2 / 2)];
      const len = Math.sqrt(origin[0] * origin[0] + origin[1] * origin[1]);
      transforms[i].rotate = Math.min((yOffset / vh) * -curvature, 90);
      const deg = transforms[i].rotate + (Math.atan2(origin[1], origin[0]) * 180) / Math.PI;
      transforms[i].extraTop = Math.sin((deg * Math.PI) / 180) * len - origin[1];
      let leftVal = Math.cos((deg * Math.PI) / 180) * len - origin[0];
      leftVal = Math.max(-containerW * 0.35, Math.min(containerW * 0.35, leftVal));
      transforms[i].left = leftVal;
      // 圆滑度：用更平缓的曲线衰减 opacity，让更多歌词可见且过渡更圆润
      const rotOp = 1 - Math.pow(Math.abs((yOffset * 2) / vh), 1.8) * 0.9;
      transforms[i].opacity = Math.max(rotOp, 0);
      if (rotOp <= 0.02) transforms[i].outOfRange = true;
    }
  }

  // Lines after current (going down)
  for (let i = cur + 1; i < lyrics.length; i++) {
    const off = i - cur;
    transforms[i].scale = scaleByOffset(off);
    transforms[i].blur = blurByOffset(off);
    transforms[i].opacity = opacityByOffset(off);
    const s = transforms[i].scale;
    const h = heightFor(i);
    const sPrev = transforms[i - 1].scale;
    const hPrev = heightFor(i - 1);
    const visualBottomPrev = transforms[i - 1].top + hPrev * (1 + sPrev) / 2;
    transforms[i].top = visualBottomPrev + space - h * (1 - s) / 2;
    transforms[i].delay = delayByOffset(off);

    if (settings.lyricRotate) {
      const yOffset = transforms[cur].top - transforms[i].top;
      const h2 = heightFor(i) * transforms[i].scale;
      const vh = window.innerHeight || 1;
      const curvature = settings.rotateCurvature;
      const origin = [-120 + (curvature - 25), -(yOffset + h2 / 2)];
      const len = Math.sqrt(origin[0] * origin[0] + origin[1] * origin[1]);
      transforms[i].rotate = Math.min((yOffset / vh) * -curvature, 90);
      const deg = transforms[i].rotate + (Math.atan2(origin[1], origin[0]) * 180) / Math.PI;
      transforms[i].extraTop = Math.sin((deg * Math.PI) / 180) * len - origin[1];
      let leftVal = Math.cos((deg * Math.PI) / 180) * len - origin[0];
      leftVal = Math.max(-containerW * 0.35, Math.min(containerW * 0.35, leftVal));
      transforms[i].left = leftVal;
      // 圆滑度：用更平缓的曲线衰减 opacity，让更多歌词可见且过渡更圆润
      const rotOp = 1 - Math.pow(Math.abs((yOffset * 2) / vh), 1.8) * 0.9;
      transforms[i].opacity = Math.max(rotOp, 0);
      if (rotOp <= 0.02) transforms[i].outOfRange = true;
    }
  }

  return transforms;
}

const allTransforms = computed(() => computeAllTransforms());

// ----- Lyric hover state (RNP-style) -----
const hoveredLine = ref(-1);
function onLyricEnter(idx: number) { hoveredLine.value = idx; }
function onLyricLeave() { hoveredLine.value = -1; }

function lineStyle(idx: number): CSSProperties {
  const t = allTransforms.value[idx];
  if (!t) return {};
  const isActive = idx === activeIndex.value;
  const inSelectMode = lyricSelectMode.value;
  // Uniform font size across active/inactive lines.
  // 响应式：字体大小随窗口宽度缩放（窗口越大字体越大，但有上下限）
  const baseFontSize = settings.lyricRotate ? settings.rotateLyricFontSize : settings.lyricFontSize;
  const fontSize = baseFontSize * settings.fontScale * Math.max(0.85, Math.min(1.5, window.innerWidth / 1180));
  const fontWeight = isActive ? (settings.boldFirstLine && idx === 0 ? 800 : 700) : 500;
  // When lyricRotate is on, force left align so line starts form a semicircle
  const align: "left" | "center" =
    settings.lyricRotate ? "left" :
    settings.currentLyricAlign === "center" ? "center" : "left";
  const interlude = parsedLyrics.value[idx]?.isInterlude;

  // Hover: no scale change (avoids transform reflow → better performance).
  // 歌词选择模式下：所有行 scale=1（不再缩小），方便阅读和点击
  const finalScale = inSelectMode ? 1 : t.scale;

  // 歌词选择模式下：扩大歌词间距（每行额外加 16px 间距）
  const extraSpacing = inSelectMode ? 16 : 0;

  // Transform: RNP order = translateX(left) translateY(top+extraTop+spacing) scale rotate
  const parts: string[] = [];
  if (t.left && !inSelectMode) parts.push(`translateX(${t.left}px)`);
  parts.push(`translateY(${t.top + t.extraTop + extraSpacing}px)`);
  parts.push(`scale(${finalScale})`);
  if (t.rotate && !inSelectMode) parts.push(`rotate(${t.rotate}deg)`);
  const transform = parts.join(" ");

  // 歌词选择模式下：取消模糊效果，所有行 opacity=1
  const finalOpacity = inSelectMode ? 1 : t.opacity;
  const finalBlur = inSelectMode ? 0 : t.blur;

  const height = interlude ? "0" : "auto";

  const style: CSSProperties = {
    transform,
    opacity: finalOpacity,
    filter: finalBlur > 0 ? `blur(${finalBlur}px)` : "none",
    fontSize: `${fontSize}px`,
    fontWeight,
    textAlign: align,
    maxWidth: "100%",
    height,
    visibility: t.outOfRange || interlude ? "hidden" : "visible",
    // 选择模式下禁用过渡和延迟
    transition: inSelectMode ? "none" : undefined,
    transitionDelay: inSelectMode ? "0ms" : `${t.delay}ms`,
  };
  return style;
}

const transitionTiming = computed(() => {
  const t = settings.animationTiming;
  if (t === "swift") return "0.32s cubic-bezier(0.4, 0, 0.2, 1)";
  if (t === "bouncy") return "0.55s cubic-bezier(0.34, 1.56, 0.64, 1)";
  if (t === "soft") return "0.7s cubic-bezier(0.16, 1, 0.3, 1)";
  if (t === "spring") return "0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
  return "0.5s cubic-bezier(0.16, 1, 0.3, 1)";
});

const lyricFontStack = computed(() => {
  switch (settings.fontFamily) {
    case "serif": return '"Songti SC", "Noto Serif SC", serif';
    case "rounded": return '"PingFang SC", "SF Pro Rounded", sans-serif';
    case "mono": return 'ui-monospace, "JetBrains Mono", monospace';
    case "song": return '"STSong", "SimSun", serif';
    default: return "var(--font-lyric)";
  }
});

const lyricContainerStyle = computed(() => ({
  "--lyric-font": lyricFontStack.value,
  "--timing": transitionTiming.value,
  // 用户滚轮偏移：非旋转模式整体上下移动歌词容器；旋转模式偏移在 lineStyle 中逐行应用
  transform: settings.lyricRotate ? "none" : `translateY(${userScrollY.value}px)`,
  // 歌词选择模式下禁用过渡（防止自动滚动动画）
  // 平滑滚动：开启时滚动有过渡效果（默认关闭，即时响应）
  // 自动回正时始终有过渡（0.4s ease-out）
  transition: lyricSelectMode.value
    ? "none"
    : (settings.smoothLyricScroll
      ? "transform 0.12s ease-out"
      : (userScrollTimer ? "none" : "transform 0.25s ease-out")),
} as Record<string, string>));

// ----- YRC wipe animation（纯 CSS 动画驱动，逐帧零 JS / 零 Vue 参与）-----
// 性能重构（低配机型）：旧实现每个 rAF 帧都重算各 word 进度并写入响应式数组，
// 导致整个歌词组件每帧重新渲染（所有行 lineStyle 重求值 + 每字 style patch），是卡顿主因。
// 现在：行激活时一次性写入每个字的时长/延迟（负延迟 = 已唱部分），
// 之后由浏览器动画系统逐帧推进；JS 仅在换行/seek 时介入，暂停用 animation-play-state 冻结。

/** audio 元素缓存（isConnected 防陈旧引用，避免每帧 querySelector） */
let cachedAudio: HTMLAudioElement | null = null;
function getAudioTime(): number {
  if (!cachedAudio || !cachedAudio.isConnected) {
    cachedAudio = document.querySelector("audio");
  }
  if (cachedAudio && isFinite(cachedAudio.currentTime)) return cachedAudio.currentTime;
  return store.currentTime;
}

/** 当前活动行的逐字动画参数（行激活时一次性生成）：dur=字时长 ms，delay=起始延迟 ms（负 = 已唱） */
const activeWords = ref<{ text: string; dur: number; delay: number }[]>([]);
/** 换行/seek 时递增，强制以新 key 重建 word spans（新元素才能重启 CSS 动画） */
const wipeEpoch = ref(0);

function buildActiveWords() {
  const idx = activeIndex.value;
  const line = (idx >= 0) ? parsedLyrics.value[idx] : null;
  if (!line || !line.words || line.words.length === 0) {
    activeWords.value = [];
    return;
  }
  const now = getAudioTime();
  activeWords.value = line.words.map(w => ({
    text: w.text,
    dur: Math.max(0, w.duration) * 1000,
    // 负延迟：动画从播放进度中段开始（fill-mode both 保证前后状态正确）
    delay: -(now - w.start) * 1000,
  }));
}

watch([activeIndex, parsedLyrics, () => store.seekVersion], () => {
  buildActiveWords();
  wipeEpoch.value++;
}, { immediate: true });

// ----- rAF 只保留活动行索引检测（无响应式写入、无数组分配，每帧近乎零成本）-----
let wipeRAF = 0;
function updateActiveLine() {
  const t = getAudioTime();
  // 逐帧更新 activeLyricIndex（比 onTimeUpdate 的 ~250ms 更频繁，快歌不会跳行）
  // 仅当索引变化时写入 store（其余帧零响应式触发）
  const yrcLinesArr = yrcLines.value;
  if (yrcLinesArr.length > 0) {
    let idx = -1;
    for (let i = 0; i < yrcLinesArr.length; i++) {
      if (yrcLinesArr[i].startTime <= t) idx = i; else break;
    }
    if (store.activeLyricIndex !== idx) {
      store.activeLyricIndex = idx;
    }
  }
  wipeRAF = requestAnimationFrame(updateActiveLine);
}
// 挂载时已处于闲置态（如未聚焦时进入播放页）则不启动 rAF，恢复时由 lyricsIdle watch 接管
onMounted(() => { if (!lyricsIdle.value) wipeRAF = requestAnimationFrame(updateActiveLine); });
onUnmounted(() => { if (wipeRAF) cancelAnimationFrame(wipeRAF); });

// ----- 未聚焦/未置顶优化（unfocusedRender="pause"，默认开启）-----
// 窗口未聚焦且未置顶（或被隐藏，如关闭到托盘）时：
//   - 停掉 rAF（activeLyricIndex 不再更新，JS 占用归零）
//   - 歌词容器 visibility:hidden（浏览器完全跳过歌词绘制）
//   - yrc 逐字动画冻结（animation-play-state: paused）
// 恢复聚焦/置顶时：重建逐字动画参数（与当前音频进度重新对齐）并重启 rAF。
const { windowActive } = useWindowActivity();
const lyricsIdle = computed(() => settings.unfocusedRender === "pause" && !windowActive.value);

watch(lyricsIdle, (idle) => {
  if (idle) {
    if (wipeRAF) { cancelAnimationFrame(wipeRAF); wipeRAF = 0; }
  } else {
    buildActiveWords();
    wipeEpoch.value++; // 强制重建 word spans，动画从当前音频进度重新起步
    if (!wipeRAF) wipeRAF = requestAnimationFrame(updateActiveLine);
  }
});

// ----- Lyric interactions -----
function seekToLyric(idx: number) {
  // 歌词选择模式下：左键点击切换勾选
  if (lyricSelectMode.value) {
    toggleLyricLineSelection(idx);
    return;
  }
  const l = parsedLyrics.value[idx];
  if (l) store.seek(l.time);
}

let longPressTimer: ReturnType<typeof setTimeout> | null = null;

/** 右键歌词进入选择模式 */
function onLyricContextMenu(_idx: number, e: MouseEvent) {
  if (lyricSelectMode.value) return;
  e.preventDefault();
  e.stopPropagation();
  enterLyricSelectMode();
}

/** 移动端：长按歌词 500ms 进入选择模式 */
function onLyricTouchStart(_idx: number, e: TouchEvent | MouseEvent) {
  if (lyricSelectMode.value) return;
  if (e instanceof MouseEvent) return;
  longPressTimer = setTimeout(() => {
    enterLyricSelectMode();
  }, 500);
}
function onLyricTouchEnd() {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
}
function onLyricTouchMove() {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
}

onUnmounted(() => {
  if (longPressTimer) clearTimeout(longPressTimer);
});
</script>

<template>
  <section
    class="right-pane"
    :class="[
      `lyric-align-${settings.lyricRotate ? 'left' : settings.currentLyricAlign}`,
      {
        'lyric-rotate-on': settings.lyricRotate,
        'has-wiki-info-bar': showWiki,
        'lyrics-idle': lyricsIdle,
      },
    ]"
    :style="{
      '--lyric-active-color': settings.lyricActiveColor,
      '--lyric-inactive-color': settings.lyricInactiveColor,
      '--yrc-played-color': settings.yrcPlayedColor,
      '--yrc-unplayed-color': settings.yrcUnplayedColor,
    }"
  >
    <!-- 百科翻转时显示在歌词顶部的歌曲信息条（封面 + 名 + 艺术家 + 紧凑播放控件） -->
    <Transition name="wiki-info-bar-fade">
      <header v-if="showWiki" class="wiki-info-bar" :class="`info-bar-pos-${settings.wikiInfoBarPosition}`">
        <div class="info-bar-cover">
          <img v-if="coverUrl" :src="coverUrl" :alt="song?.name" referrerpolicy="no-referrer" />
          <Icon v-else name="music" :size="20" />
        </div>
        <div class="info-bar-meta">
          <div class="info-bar-title truncate">{{ song?.name || "—" }}</div>
          <div class="info-bar-artist truncate">{{ song?.artist || "—" }}</div>
          <!-- 进度条（默认开启）— 使用 Slider 支持拖拽 seek + hover 歌词预览 -->
          <div v-if="settings.wikiInfoBarShowProgress" class="info-bar-progress">
            <span class="info-bar-time">{{ formatTime(store.currentTime) }}</span>
            <Slider class="info-bar-slider"
              :model-value="store.progress"
              :always-show-on-hover="true"
              :format="(v) => settings.progressPreview ? getLyricAtTime(v * store.duration) : formatTime(v * store.duration)"
              @change="onInfoBarSeek"
            />
            <span class="info-bar-time">{{ formatTime(store.duration) }}</span>
          </div>
        </div>
        <div class="info-bar-controls">
          <button v-if="settings.wikiInfoBarShowPlayMode" class="info-bar-btn" :title="playModeLabel" @click.stop="cyclePlayMode">
            <Icon :name="playModeIcon" :size="16" />
          </button>
          <button class="info-bar-btn" :disabled="!store.hasPrev" title="上一首" @click.stop="store.prev()">
            <Icon name="prev" :size="16" />
          </button>
          <button class="info-bar-btn info-bar-play" :disabled="!song" :title="store.isPlaying ? '暂停' : '播放'" @click.stop="store.togglePlay()">
            <Icon :name="store.isPlaying ? 'pause' : 'play'" :size="18" />
          </button>
          <button class="info-bar-btn" :disabled="!store.hasNext" title="下一首" @click.stop="store.next()">
            <Icon name="next" :size="16" />
          </button>
          <button v-if="settings.wikiInfoBarShowQueue" class="info-bar-btn" :class="{ active: showQueue }" title="播放列表" @click.stop="toggleQueue">
            <Icon name="list" :size="16" />
          </button>
        </div>
      </header>
    </Transition>

    <div v-if="!parsedLyrics.length" class="no-lyrics">
      <Icon name="lyrics" :size="42" />
      <p>暂无歌词</p>
    </div>
    <div
      v-else
      ref="lyricWrapRef"
      class="lyric-wrap nice-scroll"
      :class="{ 'yrc-paused': !store.isPlaying }"
      @wheel="onLyricWheel"
    >
      <div
        ref="lyricContainerRef"
        class="lyric-container"
        :style="lyricContainerStyle"
      >
        <div
          v-for="(line, idx) in parsedLyrics"
          :key="idx"
          :ref="(el) => setLineRef(el, idx)"
          class="lyric-line"
          :class="{
            active: idx === activeIndex,
            passed: idx < activeIndex,
            interlude: line.isInterlude,
            'has-translation': !!line.translation && settings.showTranslation,
            hovered: idx === hoveredLine,
            'lyric-selected': lyricSelectMode && selectedLyricLines.has(idx),
            'lyric-select-mode': lyricSelectMode,
          }"
          :style="lineStyle(idx)"
          @click="seekToLyric(idx)"
          @contextmenu="onLyricContextMenu(idx, $event)"
          @touchstart="onLyricTouchStart(idx, $event)"
          @touchend="onLyricTouchEnd()"
          @touchmove="onLyricTouchMove()"
          @mouseenter="onLyricEnter(idx)"
          @mouseleave="onLyricLeave()"
        >
          <span
            class="lyric-text"
            :class="{
              'text-shadow': settings.textShadow,
              'text-glow': settings.textGlow,
              'yrc-wipe': line.words && line.words.length > 0 && idx === activeIndex,
            }"
          >
            <template v-if="line.words && line.words.length > 0 && idx === activeIndex">
              <!-- 逐字擦除：每个字一次性写入动画时长/延迟，之后纯 CSS 驱动（零逐帧 JS）。
                   key 含 wipeEpoch：换行/seek 时重建元素以重启动画。 -->
              <span
                v-for="(w, wi) in activeWords"
                :key="`${wipeEpoch}-${wi}`"
                class="yrc-word"
                :style="{ '--yrc-word-dur': w.dur + 'ms', '--yrc-word-delay': w.delay + 'ms' }"
              >{{ w.text }}</span>
            </template>
            <template v-else>{{ line.text }}</template>
          </span>
          <span v-if="line.subText" class="lyric-subtext">
            {{ line.subText }}
          </span>
          <span v-if="line.translation && settings.showTranslation" class="lyric-translation">
            {{ line.translation }}
          </span>
          <span v-if="line.romaji && settings.showRomaji" class="lyric-romaji">
            {{ line.romaji }}
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* ----- Right pane (lyrics) ----- */
.right-pane {
  /* 设 position: relative 让 wiki-info-bar 绝对定位覆盖在歌词上方，不挤压歌词布局 */
  position: relative;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: visible;
}

/* ===== 百科翻转时显示在歌词顶部的歌曲信息条（绝对定位，覆盖歌词不挤压）===== */
.wiki-info-bar {
  position: absolute;
  left: 12px;
  right: 12px;
  z-index: 20;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 20px;
  margin: 0;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(1px) saturate(1);
}
/* 位置：顶部（默认 top:15px）/ 底部（top:600px） */
.wiki-info-bar.info-bar-pos-top { top: 15px; }
.wiki-info-bar.info-bar-pos-bottom { top: 590px; }
.info-bar-cover {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.4);
}
.info-bar-cover img { width: 100%; height: 100%; object-fit: cover; }
.info-bar-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.info-bar-title {
  font-size: 17px; /* 再放大一点 */
  font-weight: 700;
  color: rgba(255, 255, 255, 0.95);
  line-height: 1.3;
}
.info-bar-artist {
  font-size: 13px; /* 再放大一点 */
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.2;
}
/* 信息栏进度条（使用 Slider 组件） */
.info-bar-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}
.info-bar-time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  min-width: 32px;
}
.info-bar-time:first-child { text-align: left; }
.info-bar-time:last-child { text-align: right; }
.info-bar-slider { flex: 1; min-width: 0; }
.info-bar-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.info-bar-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    color: rgba(255, 255, 255, 0.78);
    transition: color 0.15s, background 0.15s, transform 0.12s;
}
.info-bar-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.12); }
.info-bar-btn:active { transform: scale(0.92); }
.info-bar-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.info-bar-btn.info-bar-play {
  width: 42px;
  height: 42px;
  background: transparent;
  color: rgba(255, 255, 255, 0.95);
}
.info-bar-btn.info-bar-play:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

/* 信息条过渡 */
.wiki-info-bar-fade-enter-active,
.wiki-info-bar-fade-leave-active {
  transition: opacity 0.3s var(--ease-out, ease), transform 0.3s var(--ease-out, ease);
}
.wiki-info-bar-fade-enter-from,
.wiki-info-bar-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.right-pane.lyric-align-center .lyric-wrap { text-align: center; }
.right-pane.lyric-align-right .lyric-wrap { text-align: right; }
.right-pane.lyric-align-left .lyric-wrap { text-align: left; }
.no-lyrics {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: rgba(255, 255, 255, 0.4);
}
.lyric-wrap {
  flex: 1;
  overflow: visible;
  position: relative;
  /* mask 只遮罩上下边缘，左右不限制（允许歌词旋转溢出到左侧） */
  mask-image: linear-gradient(180deg, transparent 0%, #000 18%, #000 82%, transparent 100%);
  -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 18%, #000 82%, transparent 100%);
  /* 旋转模式下移除 mask 限制，允许歌词自由溢出 */
}
/* 歌词旋转模式：移除 mask 限制，允许歌词溢出到左侧（非旋转模式保留 mask 渐变淡出） */
.right-pane.lyric-rotate-on .lyric-wrap {
  mask-image: none;
  -webkit-mask-image: none;
}
.lyric-container {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  width: 100%;
  height: 100%;
  font-family: var(--font-lyric, var(--font-sans));
  pointer-events: none;
}
.lyric-line {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  transform-origin: left center;
  transition: transform var(--timing), opacity var(--timing), filter var(--timing), color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
  cursor: pointer;
  pointer-events: auto;
  padding: 6px 16px;
  border-radius: 10px;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.right-pane.lyric-align-center .lyric-line { align-items: center; }
.right-pane.lyric-align-right .lyric-line { align-items: flex-end; }
.right-pane.lyric-align-left .lyric-line { align-items: flex-start; }
.lyric-line.active {
  color: var(--lyric-active-color, #fff);
}
.lyric-line.passed { color: var(--lyric-inactive-color, rgba(255, 255, 255, 0.42)); opacity: 0.78; }
.lyric-line:not(.active) { color: var(--lyric-inactive-color, rgba(255, 255, 255, 0.55)); }
/* Hover: brighter background, no text highlight change. */
.lyric-line.hovered:not(.active) {
  background: rgba(255, 255, 255, 0.15);
}
.lyric-line.interlude {
  pointer-events: none;
}
.lyric-text {
  display: block;
  line-height: 1.35;
  font-weight: inherit;
  text-align: inherit;
}
/* 逐字歌词擦除效果：纯 CSS 动画驱动（背景位移从「未唱」滑到「已唱」），
   每个字的时长/延迟由行激活时一次性写入 --yrc-word-dur / --yrc-word-delay。
   用长写属性而非 animation 简写：避免简写隐式重置 play-state 导致暂停失效。 */
.lyric-text.yrc-wipe {
  color: transparent;
  -webkit-text-fill-color: transparent;
  text-shadow: none;
  filter: drop-shadow(0 0 12px rgba(255, 255, 255, 0.3));
}
.lyric-text.yrc-wipe .yrc-word {
  background-image: linear-gradient(
    to right,
    var(--yrc-played-color, #fff) 0 50%,
    var(--yrc-unplayed-color, rgba(255, 255, 255, 0.3)) 50% 100%
  );
  background-size: 200% 100%;
  background-repeat: no-repeat;
  /* 100% = 右半（未唱）；动画线性推进到 0% = 左半（已唱） */
  background-position: 100% 0;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  animation-name: yrc-word-wipe;
  animation-duration: var(--yrc-word-dur, 0ms);
  animation-timing-function: linear;
  animation-delay: var(--yrc-word-delay, 0ms);
  animation-fill-mode: both;
}
@keyframes yrc-word-wipe {
  from { background-position: 100% 0; }
  to { background-position: 0% 0; }
}
/* 暂停时冻结逐字动画（与音频进度保持一致）；选择模式下彻底停用动画 */
.lyric-wrap.yrc-paused .lyric-text.yrc-wipe .yrc-word { animation-play-state: paused; }
/* ===== 未聚焦/未置顶优化（unfocusedRender="pause"）=====
   歌词容器 visibility:hidden 完全跳过绘制；逐字动画冻结；rAF 已停。
   恢复聚焦/置顶时由 JS 重建逐字动画并与音频进度重新对齐。 */
.right-pane.lyrics-idle .lyric-container { visibility: hidden; }
.right-pane.lyrics-idle .yrc-word { animation-play-state: paused; }
/* 非 YRC 行的普通歌词保持原有颜色 */
.lyric-text.text-shadow { text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5); }
.lyric-text.text-glow {
  text-shadow: 0 0 18px rgba(255, 255, 255, 0.35), 0 0 4px rgba(255, 255, 255, 0.55);
}
.lyric-line.active .lyric-text.text-glow {
  text-shadow: 0 0 24px var(--accent), 0 0 8px rgba(255, 255, 255, 0.6);
}
.lyric-translation {
  display: block;
  font-size: 0.62em;
  color: rgba(255, 255, 255, 0.6);
  font-weight: 400;
  line-height: 1.35;
  text-align: inherit;
}
.lyric-subtext {
  display: block;
  font-size: 0.75em;
  color: rgba(255, 255, 255, 0.5);
  font-weight: 400;
  line-height: 1.35;
  text-align: inherit;
  margin-top: 2px;
}
.lyric-romaji {
  display: block;
  font-size: 0.55em;
  color: rgba(255, 255, 255, 0.4);
  font-style: italic;
  font-weight: 400;
  text-align: inherit;
}

/* ===== 歌词选择模式 ===== */
.lyric-line.lyric-select-mode {
  cursor: pointer !important;
}
.lyric-line.lyric-selected {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.15);
}
.lyric-line.lyric-select-mode:hover:not(.lyric-selected) {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}
/* 选择模式下取消 yrc 擦除效果（让文字可读，同时停掉动画省性能） */
.lyric-line.lyric-select-mode .lyric-text.yrc-wipe,
.lyric-line.lyric-select-mode .lyric-text.yrc-wipe .yrc-word {
  -webkit-text-fill-color: rgba(255, 255, 255, 0.85) !important;
  color: rgba(255, 255, 255, 0.85) !important;
  background-image: none !important;
  animation: none !important;
}
</style>
