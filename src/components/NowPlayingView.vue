<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick, type CSSProperties } from "vue";
import { usePlayerStore } from "@/stores/player";
import { formatTime } from "@/composables/utils";
import { log } from "@/composables/logger";
import { useAudioVisualizer } from "@/composables/useAudioVisualizer";
import { likeSong, getCachedLikeList, addLikeCache, removeLikeCache } from "@/api/netease";
import Icon from "@/components/Icon.vue";
import Slider from "@/components/Slider.vue";
import SettingsPanel, { useSettings } from "@/components/SettingsPanel.vue";
import type { LyricLine } from "@/types";

const store = usePlayerStore();
const { settings } = useSettings();

// ===== 喜欢歌曲 =====
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
    if (newLike) addLikeCache(song.neteaseId);
    else removeLikeCache(song.neteaseId);
  } catch (e) {
    log.warn("nowplaying", "like failed", { error: String(e) });
  }
  likeLoading.value = false;
}

watch(() => store.currentSong, async (song) => {
  liked.value = false;
  if (!song || song.source !== "netease" || !song.neteaseId) return;
  try {
    const likeSet = await getCachedLikeList();
    liked.value = likeSet.has(song.neteaseId);
  } catch { /* ignore */ }
}, { immediate: true });

// ----- Audio visualizer -----
// Pure procedural simulation — never touches the <audio> element, so it
// cannot interfere with playback (no Web Audio API = no AudioContext
// suspension = no "no sound after pause" bug). The canvas is a flex item
// at the bottom of the screen (below the main content), not an absolute
// overlay, so it doesn't break the cover/lyrics layout.
const visualizer = useAudioVisualizer();
const vizCanvasRef = ref<HTMLCanvasElement | null>(null);
let vizRAF = 0;
// Throttle to ~30fps: skip every other rAF frame. Visually smooth, half the CPU.
let vizFrameSkip = false;
let vizBuffer: Uint8Array = new Uint8Array(32);

function resizeVizCanvas() {
  const c = vizCanvasRef.value;
  if (!c) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Use the canvas's OWN bounding rect (CSS sets it to a bottom strip),
  // NOT the parent's full dimensions.
  const rect = c.getBoundingClientRect();
  const w = rect.width || window.innerWidth;
  const h = rect.height || 200;
  c.width = Math.max(2, Math.floor(w * dpr));
  c.height = Math.max(2, Math.floor(h * dpr));
  const ctx = c.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Parse a CSS hex color to [r, g, b]. Falls back to accent red. */
function parseHex(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [250, 35, 59];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Pick a color for a given bin index based on the chosen visualizer color mode. */
function colorForBin(i: number, n: number, alpha: number): string {
  const mode = settings.visualizerColor;
  if (mode === "white") return `rgba(255,255,255,${alpha})`;
  if (mode === "rainbow") {
    const hue = (i / n) * 320 + 200; // start from blue-ish, sweep to red
    return `hsla(${hue % 360}, 80%, 62%, ${alpha})`;
  }
  if (mode === "album") {
    const [r, g, b] = parseHex(settings.accentColor);
    const tint = 0.7 + 0.3 * Math.sin(i * 0.4);
    return `rgba(${Math.round(r * tint)},${Math.round(g * tint)},${Math.round(b * tint)},${alpha})`;
  }
  // accent (default)
  const [r, g, b] = parseHex(settings.accentColor);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawVisualizer() {
  const c = vizCanvasRef.value;
  if (!c) return;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  // Use the canvas's OWN dimensions (the bottom strip), not the parent's.
  const w = c.clientWidth || window.innerWidth;
  const h = c.clientHeight || 200;
  ctx.clearRect(0, 0, w, h);

  const style = settings.visualizerStyle;
  if (style === "off") return;

  // Ensure buffer size matches the user's bar count setting (capped at 32 for
  // performance — more bars = more CPU, and 32 is visually dense enough).
  const wantBins = Math.max(8, Math.min(32, Math.round(settings.visualizerBarCount)));
  if (vizBuffer.length !== wantBins) vizBuffer = new Uint8Array(wantBins);

  // fillFrequency returns false when paused AND fully settled → stop the loop.
  const keepAnimating = visualizer.fillFrequency(vizBuffer);
  if (!keepAnimating) {
    // Output has decayed to ~0; clear and stop the loop.
    if (vizRAF) { cancelAnimationFrame(vizRAF); vizRAF = 0; }
    return;
  }

  const n = vizBuffer.length;
  const intensity = 0.4 + settings.visualizerIntensity * 1.6; // 0.4..2.0
  const opacity = settings.visualizerOpacity;

  if (style === "bars") {
    // Long rectangles anchored to the absolute bottom of the screen, growing up.
    const gap = Math.max(1, Math.floor(w / n * 0.18));
    const barW = (w - gap * (n - 1)) / n;
    const maxH = h * 0.88; // bars can fill most of the bottom strip
    for (let i = 0; i < n; i++) {
      const v = (vizBuffer[i] / 255) * intensity;
      const bh = Math.max(2, v * maxH);
      const x = i * (barW + gap);
      const y = h - bh;
      // Gradient: brighter at base, fades toward top
      const grad = ctx.createLinearGradient(0, y, 0, h);
      const col = colorForBin(i, n, opacity);
      const colTop = colorForBin(i, n, Math.max(0, opacity * 0.15));
      grad.addColorStop(0, colTop);
      grad.addColorStop(0.4, col);
      grad.addColorStop(1, col);
      ctx.fillStyle = grad;
      // Rounded top
      const r = Math.min(barW / 2, 6);
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.lineTo(x + barW - r, y);
      ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
      ctx.lineTo(x + barW, h);
      ctx.closePath();
      ctx.fill();
    }
  } else if (style === "lines") {
    // Thin vertical lines (strokes) anchored to absolute bottom of the screen
    const gap = Math.max(1, Math.floor(w / n * 0.5));
    const lineW = Math.max(1, (w - gap * (n - 1)) / n);
    const maxH = h * 0.8;
    ctx.lineWidth = lineW;
    ctx.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const v = (vizBuffer[i] / 255) * intensity;
      const lh = Math.max(2, v * maxH);
      const x = i * (lineW + gap) + lineW / 2;
      ctx.strokeStyle = colorForBin(i, n, opacity);
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x, h - lh);
      ctx.stroke();
    }
  } else if (style === "wave") {
    // Smooth waveform anchored to the ABSOLUTE BOTTOM (baseline = h, waves go UP).
    // Previously baseline was at h*0.6 which left empty space below the wave.
    const maxAmp = h * 0.7;
    const baseline = h; // wave sits ON the bottom edge
    // Fill path: from baseline up to the wave curve
    ctx.beginPath();
    ctx.moveTo(0, baseline);
    for (let i = 0; i < n; i++) {
      const v = (vizBuffer[i] / 255) * intensity;
      const x = (i / (n - 1)) * w;
      const y = baseline - v * maxAmp;
      if (i === 0) ctx.lineTo(x, y);
      else {
        const prevX = ((i - 1) / (n - 1)) * w;
        const prevY = baseline - ((vizBuffer[i - 1] / 255) * intensity) * maxAmp;
        const midX = (prevX + x) / 2;
        const midY = (prevY + y) / 2;
        ctx.quadraticCurveTo(prevX, prevY, midX, midY);
      }
    }
    ctx.lineTo(w, baseline);
    ctx.closePath();
    const [r, g, b] = parseHex(settings.accentColor);
    const fillGrad = ctx.createLinearGradient(0, baseline - maxAmp, 0, baseline);
    if (settings.visualizerColor === "white") {
      fillGrad.addColorStop(0, `rgba(255,255,255,${opacity * 0.05})`);
      fillGrad.addColorStop(1, `rgba(255,255,255,${opacity * 0.45})`);
    } else if (settings.visualizerColor === "rainbow") {
      fillGrad.addColorStop(0, `hsla(200, 80%, 62%, ${opacity * 0.05})`);
      fillGrad.addColorStop(1, `hsla(320, 80%, 62%, ${opacity * 0.45})`);
    } else {
      fillGrad.addColorStop(0, `rgba(${r},${g},${b},${opacity * 0.05})`);
      fillGrad.addColorStop(1, `rgba(${r},${g},${b},${opacity * 0.5})`);
    }
    ctx.fillStyle = fillGrad;
    ctx.fill();
    // Stroke the wave top edge
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const v = (vizBuffer[i] / 255) * intensity;
      const x = (i / (n - 1)) * w;
      const y = baseline - v * maxAmp;
      if (i === 0) ctx.moveTo(x, y);
      else {
        const prevX = ((i - 1) / (n - 1)) * w;
        const prevY = baseline - ((vizBuffer[i - 1] / 255) * intensity) * maxAmp;
        const midX = (prevX + x) / 2;
        const midY = (prevY + y) / 2;
        ctx.quadraticCurveTo(prevX, prevY, midX, midY);
      }
    }
    ctx.strokeStyle = settings.visualizerColor === "white"
      ? `rgba(255,255,255,${opacity})`
      : settings.visualizerColor === "rainbow"
        ? `hsla(200, 80%, 70%, ${opacity})`
        : `rgba(${r},${g},${b},${opacity})`;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
  }
}

function vizLoop() {
  // Throttle to ~30fps: skip every other frame. rAF runs at ~60fps; skipping
  // every other frame gives 30fps which is visually smooth for a visualizer
  // and halves CPU/GPU cost.
  if (vizFrameSkip) {
    vizFrameSkip = false;
  } else {
    vizFrameSkip = true;
    drawVisualizer();
  }
  // Only schedule next frame if still animating. drawVisualizer cancels the
  // loop when paused+settled; if it did, don't re-schedule.
  if (vizRAF) vizRAF = requestAnimationFrame(vizLoop);
}

function startVizLoop() {
  if (vizRAF) return;
  vizFrameSkip = false;
  vizRAF = requestAnimationFrame(vizLoop);
}

function stopVizLoop() {
  if (vizRAF) { cancelAnimationFrame(vizRAF); vizRAF = 0; }
  const c = vizCanvasRef.value; const ctx = c?.getContext("2d");
  if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
}

// Start/stop the visualizer loop based on visibility + style setting
watch(
  () => settings.visualizerStyle,
  (s) => {
    if (s !== "off") {
      nextTick(() => { resizeVizCanvas(); startVizLoop(); });
    } else {
      stopVizLoop();
    }
  },
  { immediate: true }
);

// Restart the loop when playback starts (in case it was stopped after pausing)
watch(() => store.isPlaying, (playing) => {
  if (playing && settings.visualizerStyle !== "off" && !vizRAF) {
    startVizLoop();
  }
});

let vizRO: ResizeObserver | null = null;
onMounted(() => {
  // Resize canvas when the canvas element itself resizes (e.g. viewport change)
  vizRO = new ResizeObserver(() => resizeVizCanvas());
  if (vizCanvasRef.value) vizRO.observe(vizCanvasRef.value);
  resizeVizCanvas();
  if (settings.visualizerStyle !== "off") startVizLoop();
});
onUnmounted(() => {
  if (vizRAF) cancelAnimationFrame(vizRAF); vizRAF = 0;
  vizRO?.disconnect();
});

// ----- Layout state -----
const showSettings = ref(false);
const showQueue = ref(false);
const topbarVisible = ref(false);
let hideTopbarTimer: ReturnType<typeof setTimeout> | null = null;

function onMouseMove(e: MouseEvent) {
  // Only show topbar when mouse is in the top ~60px strip
  if (e.clientY < 60) {
    topbarVisible.value = true;
    if (hideTopbarTimer) clearTimeout(hideTopbarTimer);
    hideTopbarTimer = setTimeout(() => {
      if (!showSettings.value && !showQueue.value) topbarVisible.value = false;
    }, 2000);
  } else {
    if (topbarVisible.value && !showSettings.value && !showQueue.value) {
      topbarVisible.value = false;
    }
  }
}

function close() { store.closeFullscreenPlayer(); }

async function toggleFullscreen() {
  try {
    const mod = await import("@tauri-apps/api/window");
    const w = mod.getCurrentWindow?.() ?? (mod as any).window?.();
    if (w) await w.toggleMaximize();
  } catch {}
}

// ----- Lyric parsing -----
interface ParsedLyric {
  time: number;
  text: string;
  translation?: string;
  romaji?: string;
  isInterlude?: boolean;
  /** 逐字数据：如果歌曲有 yrc，这里存储每个字的时间信息 */
  words?: { start: number; duration: number; text: string }[];
  /** 括号内的中文补充歌词（换行显示） */
  subText?: string;
}

/**
 * Parse a single raw lyric line. If the line ends with (xxx) or （xxx）
 * AND the content inside is primarily non-CJK (foreign text), treat it as
 * a translation. Chinese lyrics often use () for supplementary lyrics,
 * so we keep the brackets inline (no extraction) to avoid breaking the line.
 */
function parseLyricLine(raw: string): { text: string; translation?: string; subText?: string } {
  const t = raw.trim();
  const m = t.match(/^(.*?)[(（]([^)）]+)[)）]\s*$/);
  if (m) {
    const mainText = m[1].trim();
    const inside = m[2].trim();
    const cjkCount = (inside.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    if (cjkCount === 0) {
      // 完全无CJK → 翻译
      return { text: mainText, translation: inside };
    } else {
      // 含CJK → 中文歌曲的补充歌词，保持原样不拆分
      return { text: t };
    }
  }
  return { text: t };
}

/** 逐字歌词行：解析 yrc 格式的一行为 { words, startTime } */
interface YrcWord { start: number; duration: number; text: string; }
interface YrcLine { startTime: number; words: YrcWord[]; text: string; }

/** 解析完整 yrc 文本为结构化逐字行数组 */
function parseYrcLines(yrcText: string): YrcLine[] {
  const lines: YrcLine[] = [];
  for (const raw of yrcText.split("\n")) {
    const m = raw.match(/^\[(\d+),(\d+)\]/);
    if (!m) continue;
    const startTime = parseInt(m[1]) / 1000;
    const words: YrcWord[] = [];
    // 提取每个字：(startMs,durationMs,0)文字
    const wordRe = /\((\d+),(\d+),\d+\)([^(]+)/g;
    let wm;
    let fullText = "";
    while ((wm = wordRe.exec(raw)) !== null) {
      const wStart = parseInt(wm[1]) / 1000;
      const wDur = parseInt(wm[2]) / 1000;
      const wText = wm[3];
      words.push({ start: wStart, duration: wDur, text: wText });
      fullText += wText;
    }
    if (words.length > 0) {
      lines.push({ startTime, words, text: fullText.trim() });
    }
  }
  return lines;
}

/** 当前歌曲的逐字歌词数据 */
const yrcLines = ref<YrcLine[]>([]);

/** 当歌曲变化时，重新解析 yrc */
watch(() => store.currentSong, (song) => {
  const yrcText = (song as any)?.yrcText;
  if (yrcText) {
    yrcLines.value = parseYrcLines(yrcText);
  } else {
    yrcLines.value = [];
  }
}, { immediate: true });

/** 匹配 store.lyrics 中的行到 yrcLines，合并逐字数据 */
const parsedLyrics = computed<ParsedLyric[]>(() => {
  const src = store.lyrics;

  // 如果有逐字歌词，直接用 yrcLines 作为歌词源（避免时间戳转换误差）
  if (yrcLines.value.length > 0) {
    const out: ParsedLyric[] = [];
    // 翻译现在直接存储在 store.lyrics[i].translation 中（由 _parseLrc 匹配）
    // 按 yrc 行的时间戳查找最近的 store.lyrics 行，取其 translation
    const transMap = new Map<number, string>();
    for (const cur of src) {
      if ((cur as any).translation) {
        transMap.set(Math.round(cur.time * 100), (cur as any).translation);
      }
    }

    for (let i = 0; i < yrcLines.value.length; i++) {
      const yl = yrcLines.value[i];
      const next = yrcLines.value[i + 1];
      const gap = next ? next.startTime - yl.startTime : 0;
      const isInterlude = !yl.text || gap > 8;
      // 精确匹配 yrc 时间戳，回退到最近 3 秒内的行
      let translation = transMap.get(Math.round(yl.startTime * 100));
      if (!translation) {
        let bestDiff = 999;
        for (const cur of src) {
          if (!(cur as any).translation) continue;
          const diff = Math.abs(cur.time - yl.startTime);
          if (diff < bestDiff && diff < 3.0) {
            bestDiff = diff;
            translation = (cur as any).translation;
          }
        }
      }
      out.push({
        time: yl.startTime,
        text: yl.text || (gap > 8 ? "♪" : ""),
        translation,
        isInterlude: !yl.text,
        words: yl.words,
      });
    }
    return out;
  }

  // 无逐字歌词：普通处理
  const out: ParsedLyric[] = [];
  for (let i = 0; i < src.length; i++) {
    const cur = src[i];
    const next = src[i + 1];
    const parsed = parseLyricLine(cur.text);
    const gap = next ? next.time - cur.time : 0;
    const isInterlude = !parsed.text || gap > 8;
    out.push({
      time: cur.time,
      text: parsed.text || (gap > 8 ? "♪" : ""),
      // tlyric 翻译优先（网易云），回退到 parseLyricLine 提取的翻译（本地歌词）
      translation: (cur as any).translation || parsed.translation,
      subText: parsed.subText,
      isInterlude: !parsed.text,
    });
  }
  return out;
});

// Compute interlude gaps to collapse: each parsed lyric gets a "yOffset"
// that compresses large time gaps to a max visual gap.
const INTERLUDE_THRESHOLD = 6; // seconds
const MAX_INTERLUDE_PX = 0; // interludes collapse to 0 height

const activeIndex = computed(() => store.activeLyricIndex);

// 逐字歌词：计算当前活动行已唱到第几个字（只算一次，而非每字算一次）
const sungWordCount = computed(() => {
  const idx = activeIndex.value;
  if (idx < 0) return 0;
  const line = parsedLyrics.value[idx];
  if (!line || !line.words) return 0;
  const t = store.currentTime;
  let count = 0;
  for (const w of line.words) {
    if (t >= w.start) count++;
    else break;
  }
  return count;
});

// ----- Lyric engine: each line's absolute transform -----
const lyricWrapRef = ref<HTMLDivElement | null>(null);
const lyricContainerRef = ref<HTMLDivElement | null>(null);
const lineRefs = ref<(HTMLDivElement | null)[]>([]);

// 用户滚轮滚动偏移（px），2秒无操作后归零自动跟随
const userScrollY = ref(0);
let userScrollTimer: ReturnType<typeof setTimeout> | null = null;
function onLyricWheel(e: WheelEvent) {
  e.preventDefault();
  // 标准滚动方向：滚轮向下( deltaY>0 )→ 内容上移查看下方(偏移减小)
  //               滚轮向上( deltaY<0 )→ 内容下移查看上方(偏移增大)
  userScrollY.value -= e.deltaY;
  // 重置定时器：2秒后归零，自动滚动回当前播放歌词
  if (userScrollTimer) clearTimeout(userScrollTimer);
  userScrollTimer = setTimeout(() => {
    userScrollY.value = 0;
    userScrollTimer = null;
  }, 2000);
}

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
});
onUnmounted(() => { lineRO?.disconnect(); if (lineHeightRAF) cancelAnimationFrame(lineHeightRAF); if (userScrollTimer) clearTimeout(userScrollTimer); });

// Each line's distance (in number of lines) from active, with interlude gaps collapsed.
function lineDistance(idx: number): number {
  if (activeIndex.value < 0) return idx;
  return idx - activeIndex.value;
}

// RNP-style transform computation:
// Each line gets an absolute "top" position in px.
// The active line is positioned at: containerHeight * (alignPct/100) - lineHeight/2
// Lines before active: stacked upward using scaled heights
// Lines after active: stacked downward using scaled heights
// This matches RNP lyrics.js exactly.

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

function computeAllTransforms(): LineTransform[] {
  const lyrics = parsedLyrics.value;
  if (!lyrics.length) return [];
  const cur = Math.max(0, Math.min(activeIndex.value, lyrics.length - 1));
  // When lyricRotate is on, use left align (semicircle effect)
  const alignPct = settings.lyricRotate ? 50 :
    settings.currentLyricAlign === "center" ? 50 : 50;
  const containerH = lyricWrapRef.value?.clientHeight || window.innerHeight || 600;
  // Container width — used to clamp the horizontal `left` offset of rotated
  // lyric lines so they don't get pushed past the right edge (or pulled past
  // the left edge) and get clipped by overflow:hidden, which looked like the
  // lyrics were "occluded by the left cover area" at high curvature.
  const containerW = lyricWrapRef.value?.clientWidth || window.innerWidth || 800;

  let gap = settings.lyricLineGap;
  if (settings.lyricRotate) {
    gap += settings.rotateCurvature * 0.6;
  }
  const space = gap;
  const fontSize = settings.lyricFontSize;

  // Scale function (RNP scaleByOffset)
  function scaleByOffset(offset: number): number {
    const a = Math.abs(offset);
    const v = Math.max(1 - a * 0.15, 0);
    return v * v * v * 0.2 + 0.8;
  }
  // Opacity (RNP opacityByOffset)
  function opacityByOffset(offset: number): number {
    const a = Math.abs(offset);
    if (a <= 1) return 1;
    return Math.max(1 - 0.25 * (a - 1), 0.3);
  }
  // Blur (RNP blurByOffset)
  function blurByOffset(offset: number): number {
    const a = Math.abs(offset);
    if (a === 0) return 0;
    return Math.min(0.2 + 0.3 * a, 1.2);
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
  // Use measured heights when available — this is what fixes the overlap
  // for multi-line lyrics and lines with translation/romaji. When rotation
  // is OFF, lines stack directly using these real heights, so they never
  // overlap. When rotation is ON, the same heights feed the rotation math.
  const heightFor = (i: number): number => {
    const m = measuredHeights.value[i];
    return m && m > 0 ? m : fallbackLineHeight;
  };

  const transforms: LineTransform[] = lyrics.map(() => ({
    top: 0, scale: 1, opacity: 1, blur: 0, delay: 0,
    rotate: 0, extraTop: 0, left: 0, outOfRange: false,
  }));

  // Active line: positioned at alignPct of container height, vertically centered.
  // Note: the active line has scale=1, so its visual top == layout top.
  const activeH = heightFor(cur);
  transforms[cur].top = containerH * (alignPct / 100) - activeH / 2;
  transforms[cur].scale = 1;
  transforms[cur].opacity = 1;
  transforms[cur].blur = 0;
  transforms[cur].delay = delayByOffset(0);

  // IMPORTANT: lyric-line uses `transform-origin: left center`, which means
  // vertical scaling is anchored at the element's vertical center, NOT its
  // top edge. So when an inactive line is scaled to 0.8, it visually shrinks
  // toward its own center: its visual top is LOWER than its layout top by
  //   h*(1-s)/2
  // and its visual bottom is HIGHER than its layout bottom by the same amount.
  //
  // To prevent overlap we stack based on VISUAL edges, not layout edges:
  //   visualBottom(i) = top(i) + h(i) * (1+s(i)) / 2
  //   visualTop(i)    = top(i) + h(i) * (1-s(i)) / 2
  // Stacking upward:   visualBottom(i) + gap = visualTop(i+1)
  // Stacking downward: visualBottom(i-1) + gap = visualTop(i)

  // Lines before current (going up)
  for (let i = cur - 1; i >= 0; i--) {
    const off = cur - i;
    transforms[i].scale = scaleByOffset(off);
    transforms[i].blur = blurByOffset(i - cur);
    transforms[i].opacity = opacityByOffset(i - cur);
    const s = transforms[i].scale;
    const h = heightFor(i);
    const sNext = transforms[i + 1].scale;
    const hNext = heightFor(i + 1);
    // visualTop(i+1) = top(i+1) + hNext*(1-sNext)/2
    // visualBottom(i) = top(i) + h*(1+s)/2
    // top(i) = visualTop(i+1) - gap - h*(1+s)/2
    const visualTopNext = transforms[i + 1].top + hNext * (1 - sNext) / 2;
    transforms[i].top = visualTopNext - space - h * (1 + s) / 2;
    transforms[i].delay = delayByOffset(i - cur);

    // RNP setRotateTransform
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
      // Clamp horizontal offset so lyrics don't slide past the container
      // edges and get clipped (looked like "occluded by left cover area").
      leftVal = Math.max(-containerW * 0.35, Math.min(containerW * 0.35, leftVal));
      transforms[i].left = leftVal;
      const rotOp = 1 - Math.pow(Math.abs((yOffset * 2) / vh), 1.15) * 1.2;
      transforms[i].opacity = Math.max(rotOp, 0);
      // Hide lines whose opacity has decayed to near-zero. Previously the
      // threshold was rotOp <= -1.5, which left a band of fully-transparent
      // (but still visible/clickable) lines that obscured other lines at
      // high curvature. Hiding as soon as rotOp drops to ~0 fixes the
      // "played/upcoming lyrics are occluded at curvature 50" bug.
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
    // visualBottom(i-1) = top(i-1) + hPrev*(1+sPrev)/2
    // visualTop(i) = top(i) + h*(1-s)/2
    // top(i) = visualBottom(i-1) + gap - h*(1-s)/2
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
      const rotOp = 1 - Math.pow(Math.abs((yOffset * 2) / vh), 1.15) * 1.2;
      transforms[i].opacity = Math.max(rotOp, 0);
      if (rotOp <= 0.02) transforms[i].outOfRange = true;
    }
  }

  return transforms;
}

const allTransforms = computed(() => computeAllTransforms());

// ----- Lyric hover state (RNP-style: hovering a line scales it up + brightens) -----
const hoveredLine = ref(-1);
function onLyricEnter(idx: number) { hoveredLine.value = idx; }
function onLyricLeave() { hoveredLine.value = -1; }

const previousActive = ref(-1);
watch(() => store.activeLyricIndex, (idx) => {
  if (idx >= 0) {
    nextTick(() => window.setTimeout(() => { previousActive.value = idx; }, 600));
  }
});

function lineStyle(idx: number): CSSProperties {
  const t = allTransforms.value[idx];
  if (!t) return {};
  const isActive = idx === activeIndex.value;
  const isHovered = idx === hoveredLine.value;
  // Uniform font size across active/inactive lines. Visual differentiation
  // between active and inactive is done via the `scale` transform (active=1,
  // inactive≈0.8) plus color/opacity, NOT font size. This keeps measured
  // line heights stable when the active line changes, preventing reactive
  // feedback loops in the layout engine.
  const fontSize = settings.lyricFontSize * settings.fontScale;
  const fontWeight = isActive ? (settings.boldFirstLine && idx === 0 ? 800 : 700) : 500;
  // When lyricRotate is on, force left align so line starts form a semicircle
  const align: "left" | "center" =
    settings.lyricRotate ? "left" :
    settings.currentLyricAlign === "center" ? "center" : "left";
  const interlude = parsedLyrics.value[idx]?.isInterlude;

  // Hover: no scale change (avoids transform reflow → better performance).
  // The visual hover effect is done purely via CSS (color + opacity + translateX).
  const finalScale = t.scale;

  // Transform: RNP order = translateX(left) translateY(top+extraTop) scale rotate
  const parts: string[] = [];
  if (t.left) parts.push(`translateX(${t.left}px)`);
  parts.push(`translateY(${t.top + t.extraTop}px)`);
  parts.push(`scale(${finalScale})`);
  if (t.rotate) parts.push(`rotate(${t.rotate}deg)`);
  const transform = parts.join(" ");

  // Hover: no opacity/blur/scale change (just CSS background on hover).
  // This avoids transform reflow and keeps performance high.
  const finalOpacity = t.opacity;
  const finalBlur = t.blur;

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
    transitionDelay: `${t.delay}ms`,
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
  // 用户滚轮偏移：整体上下移动歌词容器
  transform: `translateY(${userScrollY.value}px)`,
  // 平滑滚动：开启时滚动有过渡效果（默认关闭，即时响应）
  // 自动回正时始终有过渡（0.4s ease-out）
  transition: settings.smoothLyricScroll
    ? "transform 0.15s ease-out"
    : (userScrollTimer ? "none" : "transform 0.4s ease-out"),
} as Record<string, string>));

// ----- Play mode (shared with PlayerBar) -----
type PlayMode = "sequence" | "list" | "single" | "shuffle";
const PLAY_MODE_ORDER: PlayMode[] = ["sequence", "list", "shuffle", "single"];
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
const playMode = computed<PlayMode>(() => {
  if (store.shuffle) return "shuffle";
  if (store.repeat === "one") return "single";
  if (store.repeat === "all") return "list";
  return "sequence";
});
function cyclePlayMode() {
  const idx = PLAY_MODE_ORDER.indexOf(playMode.value);
  const next = PLAY_MODE_ORDER[(idx + 1) % PLAY_MODE_ORDER.length];
  store.shuffle = false;
  if (store.repeat !== "off") store.repeat = "off";
  if (next === "list") store.repeat = "all";
  else if (next === "single") store.repeat = "one";
  else if (next === "shuffle") store.shuffle = true;
}

// ----- Volume -----
const volumeFrac = computed(() => (store.muted ? 0 : store.volume));
function onVolume(f: number) { store.setVolume(f); }
function toggleMute() { store.toggleMute(); }
// 鼠标滚轮调节音量：向上增大，向下减小
function onVolWheel(e: WheelEvent) {
  e.preventDefault();
  const step = 0.05;
  const delta = e.deltaY < 0 ? step : -step;
  const newVol = Math.max(0, Math.min(1, store.volume + delta));
  store.setVolume(newVol);
}

// ----- Progress -----
const progressFrac = computed(() => store.progress);
const bufferedFrac = computed(() => store.bufferedFrac);
function onSeek(f: number) { store.seekByFraction(f); }

// 音质选择
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
function cycleAudioLevel() {
  const idx = audioLevels.findIndex(l => l.key === settings.audioLevel);
  const next = audioLevels[(idx + 1) % audioLevels.length];
  settings.audioLevel = next.key;
}
const currentLevelLabel = computed(() => {
  const l = audioLevels.find(l => l.key === settings.audioLevel);
  return l ? l.label : "标准";
});

// 进度条悬停预览：返回对应时间点的歌词文本
function getLyricAtTime(t: number): string {
  if (!parsedLyrics.value.length) return formatTime(t);
  let found = "";
  for (const line of parsedLyrics.value) {
    if (line.time <= t && line.text && !line.isInterlude) {
      found = line.text.length > 30 ? line.text.slice(0, 30) + "..." : line.text;
    } else if (line.time > t) break;
  }
  return found || formatTime(t);
}

// ----- Song / cover -----
const song = computed(() => store.currentSong);
const coverUrl = computed(() => {
  const pic = song.value?.pic || "";
  if (!pic) return "";
  // 网易云封面支持 ?param=NxN 控制清晰度
  const q = settings.coverQuality || 300;
  if (pic.includes("music.126.net")) {
    return pic.replace(/\?param=\d+x\d+/g, "") + `?param=${q}x${q}`;
  }
  return pic;
});

// ----- Lyrics seek-on-click -----
function seekToLyric(idx: number) {
  const l = parsedLyrics.value[idx];
  if (l) store.seek(l.time);
}

// ----- Keyboard shortcuts -----
function onKey(ev: KeyboardEvent) {
  if (ev.key === "Escape") {
    if (showSettings.value) showSettings.value = false;
    else if (showQueue.value) showQueue.value = false;
    else close();
    return;
  }
  if (ev.code === "Space") { ev.preventDefault(); store.togglePlay(); }
  if (ev.key === "ArrowRight" && (ev.ctrlKey || ev.metaKey)) store.next();
  if (ev.key === "ArrowLeft" && (ev.ctrlKey || ev.metaKey)) store.prev();
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  log.info("nowplaying", "mounted");
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  if (hideTopbarTimer) clearTimeout(hideTopbarTimer);
});

const queueList = computed(() => store.queue);
</script>

<template>
  <div
    class="np-overlay"
    :class="[`bg-${settings.bgType}`, `mode-${settings.displayMode}`]"
    @mousemove="onMouseMove"
  >
    <!-- Background layers (RNP-style: type switches which layers show) -->
    <div class="rnp-bg" :class="`rnp-bg-${settings.bgType}`">
      <!-- Blur background: album cover as bg-image + backdrop-blur -->
      <div v-if="settings.bgType === 'blur'" class="rnp-bg-blur"
        :style="{ backgroundImage: coverUrl ? `url(${coverUrl})` : 'none' }">
      </div>
      <!-- Fluid background: album cover + slow pan animation -->
      <div v-if="settings.bgType === 'fluid'" class="rnp-bg-fluid"
        :style="{ backgroundImage: coverUrl ? `url(${coverUrl})` : 'none' }">
      </div>
      <!-- Gradient background: animated gradient from accent colors -->
      <div v-if="settings.bgType === 'gradient'" class="rnp-bg-gradient"></div>
      <!-- Solid background: plain dark -->
      <div v-if="settings.bgType === 'solid'" class="rnp-bg-solid"></div>
      <!-- Dim overlay (always present when type !== 'none') -->
      <div v-if="settings.bgType !== 'none'" class="rnp-bg-dim"
        :style="{ opacity: settings.bgDim / 100 }">
      </div>
      <!-- Blur overlay: backdrop-filter blur on top of bg image -->
      <div v-if="settings.bgType === 'blur' || settings.bgType === 'fluid'" class="rnp-bg-blur-overlay"
        :style="{ backdropFilter: `blur(${settings.bgBlur}px) saturate(1.4)`, WebkitBackdropFilter: `blur(${settings.bgBlur}px) saturate(1.4)` }">
      </div>
    </div>

    <!-- Topbar: center song info is ALWAYS visible; only side icons fade in/out -->
    <header class="topbar tauri-drag">
      <!-- Left icons (collapse, etc.) — hide when mouse leaves topbar -->
      <div class="topbar-side topbar-left" :class="{ visible: topbarVisible || showSettings || showQueue }">
        <button class="icon-btn tauri-no-drag" title="收起到迷你播放器" @click="close">
          <Icon name="chevronDown" :size="20" />
        </button>
      </div>
      <!-- Center song info — always visible -->
      <div class="topbar-title truncate">
        {{ song?.name || "未在播放" }}
        <span v-if="song" class="sep">—</span>
        <span v-if="song" class="artist truncate">{{ song.artist }}</span>
      </div>
      <!-- Right icons (fullscreen, settings) — hide when mouse leaves topbar -->
      <div class="topbar-side topbar-right tauri-no-drag" :class="{ visible: topbarVisible || showSettings || showQueue }">
        <button class="icon-btn" title="全屏" @click="toggleFullscreen">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
        </button>
        <button class="icon-btn" title="设置" @click="showSettings = true">
          <img src="/icons/settings.svg" alt="settings" class="settings-icon" />
        </button>
      </div>
    </header>

    <!-- Main content: cover (left) + lyrics (right) -->
    <main class="np-main">
      <!-- Left: cover + info + controls -->
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
            <button class="level-pill" @click="cycleAudioLevel">
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
              @click="showQueue = !showQueue"
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

      <!-- Right: lyrics -->
      <section class="right-pane" :class="`lyric-align-${settings.lyricRotate ? 'left' : settings.currentLyricAlign}`">
        <div v-if="!parsedLyrics.length" class="no-lyrics">
          <Icon name="lyrics" :size="42" />
          <p>暂无歌词</p>
        </div>
        <div v-else ref="lyricWrapRef" class="lyric-wrap nice-scroll" @wheel="onLyricWheel">
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
              }"
              :style="lineStyle(idx)"
              @click="seekToLyric(idx)"
              @mouseenter="onLyricEnter(idx)"
              @mouseleave="onLyricLeave()"
            >
              <span class="lyric-text" :class="{ 'text-shadow': settings.textShadow, 'text-glow': settings.textGlow }">
                <template v-if="line.words && line.words.length > 0">
                  <span
                    v-for="(word, wi) in line.words"
                    :key="wi"
                    class="lyric-word"
                    :class="{ sung: idx === activeIndex && wi < sungWordCount }"
                  >{{ word.text }}</span>
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
    </main>

    <!-- Audio-reactive visualizer (bottom strip, flex item — doesn't overlap content) -->
    <canvas
      v-show="settings.visualizerStyle !== 'off'"
      ref="vizCanvasRef"
      class="viz-canvas"
      aria-hidden="true"
    ></canvas>

    <!-- Queue panel (slides from right) -->
    <Transition name="queue-slide">
      <aside v-if="showQueue" class="queue-panel">
        <header class="qp-head">
          <h3>播放队列</h3>
          <span class="qp-count">{{ queueList.length }} 首</span>
          <button class="icon-btn" title="关闭" @click="showQueue = false">
            <Icon name="close" :size="18" />
          </button>
        </header>
        <div class="qp-list nice-scroll">
          <button
            v-for="(s, idx) in queueList"
            :key="s.id"
            class="qp-item"
            :class="{ active: s.id === song?.id }"
            @click="() => { store.currentIndex = idx; store.setPlaying(true); const song = store.queue[idx]; if (song) store.loadLyrics(song); }"
          >
            <div class="cover">
              <img v-if="s.pic" :src="s.pic" :alt="s.name" referrerpolicy="no-referrer" />
              <Icon v-else name="music" :size="14" />
            </div>
            <div class="meta">
              <div class="title truncate">{{ s.name }}</div>
              <div class="artist truncate">{{ s.artist }}</div>
            </div>
            <Icon v-if="s.id === song?.id && store.isPlaying" name="volume" :size="14" class="now-playing" />
          </button>
        </div>
      </aside>
    </Transition>

    <!-- Settings -->
    <SettingsPanel :visible="showSettings" mode="sidebar" @close="showSettings = false" />
  </div>
</template>

<style scoped>
.np-overlay {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #000;
  color: var(--text);
  animation: fade-in 0.32s var(--ease-out) both;
}

/* ----- Background layers (RNP-style) ----- */
.rnp-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}
.rnp-bg > div {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.rnp-bg-blur {
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  filter: saturate(1.5) brightness(0.6);
  transform: scale(1.1);
}
.rnp-bg-fluid {
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  filter: saturate(2) brightness(0.5) blur(2px);
  transform: scale(1.2);
  animation: fluid-pan 25s ease-in-out infinite alternate;
}
@keyframes fluid-pan {
  0% { transform: scale(1.2) translate(0, 0) rotate(0deg); }
  25% { transform: scale(1.25) translate(-3%, 2%) rotate(0.5deg); }
  50% { transform: scale(1.2) translate(2%, -2%) rotate(-0.5deg); }
  75% { transform: scale(1.25) translate(-1%, 3%) rotate(0.3deg); }
  100% { transform: scale(1.2) translate(3%, -1%) rotate(-0.3deg); }
}
.rnp-bg-gradient {
  background-size: 400% 400%;
  background-position: 50% 50%;
  animation: gradient-shift 18s ease infinite;
  background-image:
    radial-gradient(circle at 25% 30%, rgba(250, 35, 59, 0.3), transparent 50%),
    radial-gradient(circle at 80% 70%, rgba(70, 30, 90, 0.4), transparent 60%),
    linear-gradient(135deg, #1a0a14 0%, #050507 100%);
}
@keyframes gradient-shift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
.rnp-bg-solid { background: #0a0a0c; }
.rnp-bg-dim { background: #000; }
.rnp-bg-blur-overlay { pointer-events: none; }

/* ----- Audio visualizer canvas (absolute overlay at bottom — doesn't affect layout) -----
   The visualizer overlays the bottom of the screen. It does NOT take flex
   space, so the cover/lyrics stay vertically centered in the full viewport.
   The lyrics' own mask (fade top/bottom) keeps them readable above the
   visualizer strip. */
.viz-canvas {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  width: 100%;
  height: 26vh;
  z-index: 1;
  pointer-events: none;
  /* No mix-blend-mode: it made opacity changes invisible (screen blend
     clamps dark colors to the background, so lowering alpha had no visible
     effect). Normal alpha blending lets the opacity slider work as expected.
     GPU acceleration (translateZ/will-change) is toggled globally in
     style.css via html.gpu-accel / html.no-gpu. */
}

/* ----- Topbar -----
   The topbar itself is always visible. The center song title is always shown.
   Only the side icon groups (left: collapse; right: fullscreen/settings)
   fade in when the user moves the mouse to the top of the screen. */
.topbar {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--titlebar-h);
  padding: 0 16px;
}
.topbar-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  text-align: center;
  /* Always visible — the song info in the center is the persistent identity
     of the Now Playing screen. */
}
.topbar-title .sep { margin: 0 6px; opacity: 0.4; }
.topbar-title .artist { color: var(--text-tertiary); }
/* Side icon groups: fade out when mouse leaves the top strip. They take up
   fixed width so the center title stays centered whether they're visible
   or not. */
.topbar-side {
  display: flex;
  gap: 4px;
  min-width: 44px;
  opacity: 0;
  transition: opacity 0.25s var(--ease-out);
}
.topbar-side.visible { opacity: 1; }
.topbar-left { justify-content: flex-start; }
.topbar-right { justify-content: flex-end; }
.topbar .icon-btn {
  color: rgba(255, 255, 255, 0.7);
}
.topbar .icon-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}
.settings-icon { width: 18px; height: 18px; display: inline-block; pointer-events: none; }

/* ----- Main split: left 45% (cover+controls), right 55% (lyrics) ----- */
.np-main {
  position: relative;
  z-index: 2; /* above background (0) */
  flex: 1;
  display: grid;
  grid-template-columns: minmax(320px, 45%) 1fr;
  gap: clamp(20px, 3vw, 48px);
  padding: 0 clamp(24px, 4vw, 56px) clamp(20px, 3vh, 40px);
  min-height: 0;
}
/* mode-both: show both cover (left) and lyrics (right) — the default
   two-column layout. No overrides needed since .np-main's default
   grid-template-columns already handles this. */
.mode-both .np-main {
  grid-template-columns: minmax(320px, 45%) 1fr;
}

/* mode-cover: only show the cover (centered), hide lyrics pane */
.mode-cover .np-main {
  grid-template-columns: 1fr;
  text-align: center;
  justify-items: center;
}
.mode-cover .right-pane { display: none; }
.mode-cover .left-pane { align-items: center; }

/* mode-lyrics: only show lyrics, hide cover + controls */
.mode-lyrics .np-main {
  grid-template-columns: 1fr;
}
.mode-lyrics .left-pane { display: none; }
.mode-lyrics .right-pane { display: flex; }

/* ----- Left pane (cover + controls) ----- */
.left-pane {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 20px;
  min-height: 0;
  /* No background on left-pane itself — it's transparent so rotated
     lyrics from right-pane (z-index:5) can extend over it without
     being occluded. Only individual child elements (cover, controls)
     have their own backgrounds. */
}
.left-pane.halign-center { align-items: center; }
.left-pane.halign-right { align-items: flex-end; }
.left-pane.valign-top { justify-content: flex-start; padding-top: 24px; }
.left-pane.valign-bottom { justify-content: flex-end; padding-bottom: 24px; }

.cover-wrap {
  position: relative;
  width: min(340px, 28vw);
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
  width: min(340px, 28vw);
  transition: opacity 0.3s var(--ease-out);
}
.song-meta .title {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.3px;
  color: var(--text);
}
.song-meta .artist {
  font-size: 14px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.controls-block {
  width: min(340px, 28vw);
  display: flex;
  flex-direction: column;
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
/* When hidePlayerControls is on, ALL playback controls (progress bar, play/
 * prev/next/shuffle buttons, volume slider) collapse to zero height and
 * disappear entirely. Only the cover and song info remain, and the cover
 * becomes horizontally centered (via the halign-center class applied to
 * .left-pane when hidePlayerControls is active). */
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
.ctrl-btn.active { color: var(--accent); }
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

/* ----- Right pane (lyrics) ----- */
/* The lyrics pane sits ABOVE the left (cover) pane so that rotated lyric
   lines never get occluded by the cover art or its shadow. z-index here is
   relative to the .np-main stacking context (both panes are children of
   .np-main which has z-index:2). */
.right-pane {
  position: relative;
  z-index: 5; /* above left-pane (auto/default) within .np-main */
  min-height: 0;
  display: flex;
  flex-direction: column;
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
  /* overflow: visible so rotated lyric lines can extend over the left (cover)
     pane without being clipped. The right-pane has z-index:5 so lyrics
     render on top of the cover. The mask-image still fades the top/bottom
     edges for a smooth visual. */
  overflow: visible;
  position: relative;
  mask-image: linear-gradient(180deg, transparent 0%, #000 18%, #000 82%, transparent 100%);
  -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 18%, #000 82%, transparent 100%);
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
  color: #fff;
}
.lyric-line.passed { color: rgba(255, 255, 255, 0.42); }
.lyric-line:not(.active) { color: rgba(255, 255, 255, 0.55); }
/* Hover: brighter background, no text highlight change.
   No border, no scale — only background + transition, GPU-cheap. */
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
/* 逐字歌词：每个字一个 span */
.lyric-word {
  display: inline;
  transition: color 0.25s ease, opacity 0.25s ease;
  opacity: 0.5;
}
/* 已唱的字：高亮白色 */
.lyric-word.sung {
  color: #fff;
  opacity: 1;
}
/* 未唱的字（活动行内）：半透明 */
.lyric-line.active .lyric-word:not(.sung) {
  color: rgba(255, 255, 255, 0.4);
}
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
  /* Inherit text alignment from the .lyric-line's text-align (set by
     lyric-align-left/center/right). This ensures translations line up
     under the main lyric text. */
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

/* ----- Queue panel ----- */
.queue-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(360px, 32vw);
  z-index: 30;
  background: rgba(10, 10, 12, 0.85);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 12px;
  box-shadow: -16px 0 40px rgba(0, 0, 0, 0.4);
}
.queue-slide-enter-active,
.queue-slide-leave-active {
  transition: transform 0.32s var(--ease-out), opacity 0.32s var(--ease-out);
}
.queue-slide-enter-from,
.queue-slide-leave-to {
  transform: translateX(40px);
  opacity: 0;
}
.qp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px 12px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
}
.qp-head h3 { margin: 0; font-size: 16px; font-weight: 600; }
.qp-count {
  flex: 1;
  font-size: 12px;
  color: var(--text-tertiary);
}
.qp-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.qp-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px;
  border-radius: 8px;
  text-align: left;
  transition: background 0.15s;
}
.qp-item:hover { background: rgba(255, 255, 255, 0.06); }
.qp-item.active { background: rgba(255, 255, 255, 0.1); }
.qp-item .cover {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  background: var(--bg-elev-3);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.qp-item .cover img { width: 100%; height: 100%; object-fit: cover; }
.qp-item .meta { flex: 1; min-width: 0; }
.qp-item .title { font-size: 13px; color: var(--text); font-weight: 500; }
.qp-item.active .title { color: var(--accent); }
.qp-item .artist { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }
.now-playing { color: var(--accent); }

@media (max-width: 900px) {
  .np-main {
    grid-template-columns: 1fr;
    padding: 0 16px 24px;
    gap: 16px;
  }
  /* On narrow screens, force cover mode (hide lyrics) unless the user
     explicitly chose lyrics-only mode. */
  .mode-both .right-pane { display: none; }
  .mode-both .left-pane { align-items: center; }
  .mode-lyrics .np-main { grid-template-columns: 1fr; }
  .mode-lyrics .right-pane { display: flex; }
  .mode-lyrics .left-pane { display: none; }
  .mode-cover .right-pane { display: none; }
  .left-pane { align-items: center; }
  .cover-wrap { width: min(260px, 60vw); }
  .controls-block { width: 100%; max-width: 480px; }
  .vol-cluster { margin-left: 0; }
}
</style>
