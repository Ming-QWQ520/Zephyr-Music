<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick, type CSSProperties } from "vue";
import { usePlayerStore } from "@/stores/player";
import { formatTime } from "@/composables/utils";
import { log } from "@/composables/logger";
import { useAudioVisualizer } from "@/composables/useAudioVisualizer";
import Icon from "@/components/Icon.vue";
import Slider from "@/components/Slider.vue";
import SettingsPanel, { useSettings } from "@/components/SettingsPanel.vue";
import type { LyricLine } from "@/types";

const store = usePlayerStore();
const { settings } = useSettings();

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
}

/**
 * Parse a single raw lyric line that may be in the format:
 *   "original(translation)"
 * or
 *   "original（translation）"
 * Returns { text, translation }.
 */
function parseLyricLine(raw: string): { text: string; translation?: string } {
  const t = raw.trim();
  // Match trailing (...) or （...）
  const m = t.match(/^(.*?)[(（]([^)）]+)[)）]\s*$/);
  if (m) {
    return { text: m[1].trim(), translation: m[2].trim() };
  }
  return { text: t };
}

const parsedLyrics = computed<ParsedLyric[]>(() => {
  const out: ParsedLyric[] = [];
  const src = store.lyrics;
  for (let i = 0; i < src.length; i++) {
    const cur = src[i];
    const next = src[i + 1];
    const parsed = parseLyricLine(cur.text);
    // Interlude: long instrumental gap before this line, or empty text
    const gap = next ? next.time - cur.time : 0;
    const isInterlude = !parsed.text || gap > 8;
    out.push({
      time: cur.time,
      text: parsed.text || (gap > 8 ? "♪" : ""),
      translation: parsed.translation,
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

// ----- Lyric engine: each line's absolute transform -----
const lyricWrapRef = ref<HTMLDivElement | null>(null);
const lyricContainerRef = ref<HTMLDivElement | null>(null);
const lineRefs = ref<(HTMLDivElement | null)[]>([]);

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
onUnmounted(() => { lineRO?.disconnect(); if (lineHeightRAF) cancelAnimationFrame(lineHeightRAF); });

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
    settings.currentLyricAlign === "center" ? 50 :
    settings.currentLyricAlign === "right" ? 65 : 50;
  const containerH = lyricWrapRef.value?.clientHeight || window.innerHeight || 600;

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
      transforms[i].left = Math.cos((deg * Math.PI) / 180) * len - origin[0];
      const rotOp = 1 - Math.pow(Math.abs((yOffset * 2) / vh), 1.15) * 1.2;
      transforms[i].opacity = Math.max(rotOp, 0);
      if (rotOp <= -1.5) transforms[i].outOfRange = true;
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
      transforms[i].left = Math.cos((deg * Math.PI) / 180) * len - origin[0];
      const rotOp = 1 - Math.pow(Math.abs((yOffset * 2) / vh), 1.15) * 1.2;
      transforms[i].opacity = Math.max(rotOp, 0);
      if (rotOp <= -1.5) transforms[i].outOfRange = true;
    }
  }

  return transforms;
}

const allTransforms = computed(() => computeAllTransforms());

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
  // Uniform font size across active/inactive lines. Visual differentiation
  // between active and inactive is done via the `scale` transform (active=1,
  // inactive≈0.8) plus color/opacity, NOT font size. This keeps measured
  // line heights stable when the active line changes, preventing reactive
  // feedback loops in the layout engine.
  const fontSize = settings.lyricFontSize * settings.fontScale;
  const fontWeight = isActive ? (settings.boldFirstLine && idx === 0 ? 800 : 700) : 500;
  // When lyricRotate is on, force left align so line starts form a semicircle
  const align: "left" | "center" | "right" =
    settings.lyricRotate ? "left" :
    settings.currentLyricAlign === "center" ? "center" :
    settings.currentLyricAlign === "right" ? "right" : "left";
  const interlude = parsedLyrics.value[idx]?.isInterlude;

  // Transform: RNP order = translateX(left) translateY(top+extraTop) scale rotate
  const parts: string[] = [];
  if (t.left) parts.push(`translateX(${t.left}px)`);
  parts.push(`translateY(${t.top + t.extraTop}px)`);
  parts.push(`scale(${t.scale})`);
  if (t.rotate) parts.push(`rotate(${t.rotate}deg)`);
  const transform = parts.join(" ");

  const height = interlude ? "0" : "auto";

  const style: CSSProperties = {
    transform,
    opacity: t.opacity,
    filter: t.blur > 0 ? `blur(${t.blur}px)` : "none",
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

// ----- Progress -----
const progressFrac = computed(() => store.progress);
const bufferedFrac = computed(() => store.bufferedFrac);
function onSeek(f: number) { store.seekByFraction(f); }

// ----- Song / cover -----
const song = computed(() => store.currentSong);
const coverUrl = computed(() => song.value?.pic || "");

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

    <!-- Topbar -->
    <header class="topbar" :class="{ visible: topbarVisible || showSettings || showQueue }">
      <button class="icon-btn tauri-no-drag" title="收起到迷你播放器" @click="close">
        <Icon name="chevronDown" :size="20" />
      </button>
      <div class="topbar-title truncate">
        {{ song?.name || "未在播放" }}
        <span v-if="song" class="sep">—</span>
        <span v-if="song" class="artist truncate">{{ song.artist }}</span>
      </div>
      <div class="topbar-actions">
        <button class="icon-btn" title="全屏" @click="toggleFullscreen">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
        </button>
        <button class="icon-btn" title="设置" @click="showSettings = true">
          <Icon name="settings" :size="18" />
        </button>
      </div>
    </header>

    <!-- Main content: cover (left) + lyrics (right) -->
    <main class="np-main">
      <!-- Left: cover + info + controls -->
      <section class="left-pane" :class="[`halign-${settings.coverHAlign}`, `valign-${settings.coverVAlign}`]">
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
        </div>

        <div class="song-meta" :class="{ hidden: settings.autoHideMiniInfo && !topbarVisible }">
          <div class="title truncate">{{ song?.name || "—" }}</div>
          <div class="artist truncate">{{ song?.artist || "—" }}</div>
        </div>

        <!-- Controls -->
        <div class="controls-block" :class="{ hidden: settings.hidePlayerControls && !topbarVisible }">
          <div class="progress-row">
            <span class="time">{{ formatTime(store.currentTime) }}</span>
            <Slider
              class="progress"
              :model-value="progressFrac"
              :buffered="bufferedFrac"
              :format="(v) => formatTime(v * store.duration)"
              @change="onSeek"
            />
            <span class="time">{{ formatTime(store.duration) }}</span>
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
          <!-- Volume on its own row below controls -->
          <div class="vol-row">
            <button class="ctrl-btn vol-icon" :title="store.muted || store.volume === 0 ? '取消静音' : '静音'" @click="toggleMute">
              <Icon :name="store.muted || store.volume === 0 ? 'volumeMute' : store.volume < 0.4 ? 'volumeLow' : 'volume'" :size="18" />
            </button>
            <Slider
              class="volume"
              :model-value="volumeFrac"
              :format="(v) => `${Math.round(v * 100)}%`"
              :always-show-on-hover="false"
              :height="3"
              @change="onVolume"
            />
          </div>
        </div>
      </section>

      <!-- Right: lyrics -->
      <section class="right-pane" :class="{ 'center-lyric': settings.centerLyric }">
        <div v-if="!parsedLyrics.length" class="no-lyrics">
          <Icon name="lyrics" :size="42" />
          <p>暂无歌词</p>
        </div>
        <div v-else ref="lyricWrapRef" class="lyric-wrap nice-scroll">
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
              }"
              :style="lineStyle(idx)"
              @click="seekToLyric(idx)"
            >
              <span class="lyric-text" :class="{ 'text-shadow': settings.textShadow, 'text-glow': settings.textGlow }">
                {{ line.text }}
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
  filter: saturate(1.5) brightness(0.6);
  transform: scale(1.15);
  animation: fluid-pan 30s ease-in-out infinite alternate;
}
@keyframes fluid-pan {
  0% { transform: scale(1.15) translate(0, 0); }
  50% { transform: scale(1.2) translate(-2%, 1%); }
  100% { transform: scale(1.15) translate(2%, -1%); }
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

/* ----- Audio visualizer canvas (bottom flex item, not absolute) ----- */
.viz-canvas {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 26vh;
  flex-shrink: 0; /* don't let flex squeeze the visualizer */
  pointer-events: none;
  /* The canvas draws with its own opacity baked in (per-bar gradients);
     mix-blend-mode screen harmonizes it with album-art backgrounds.
     GPU acceleration (translateZ/will-change) is toggled globally in
     style.css via html.gpu-accel / html.no-gpu. */
  mix-blend-mode: screen;
}

/* ----- Topbar ----- */
.topbar {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--titlebar-h);
  padding: 0 16px;
  opacity: 0;
  transition: opacity 0.25s var(--ease-out);
}
.topbar.visible { opacity: 1; }
.topbar-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  text-align: center;
}
.topbar-title .sep { margin: 0 6px; opacity: 0.4; }
.topbar-title .artist { color: var(--text-tertiary); }
.topbar-actions {
  display: flex;
  gap: 4px;
}
.topbar .icon-btn {
  color: rgba(255, 255, 255, 0.7);
}
.topbar .icon-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}

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
.mode-compact .np-main {
  grid-template-columns: 1fr;
  text-align: center;
}
.mode-compact .right-pane { display: none; }

/* ----- Left pane (cover + controls) ----- */
.left-pane {
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
  width: min(340px, 28vw);
  aspect-ratio: 1 / 1;
  flex-shrink: 0;
}
.cover-wrap.rectangle { aspect-ratio: 1 / 1; border-radius: 12px; }
.cover-wrap.rectangle .cover { border-radius: 12px; }
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
.song-meta.hidden { opacity: 0; pointer-events: none; }
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
  gap: 12px;
  transition: opacity 0.3s var(--ease-out);
}
.controls-block.hidden { opacity: 0; pointer-events: none; }
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
.ctrl-btn.play {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #fff;
  color: #000;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}
.ctrl-btn.play:hover {
  background: #fff;
  color: #000;
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
.right-pane {
  position: relative;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.right-pane.center-lyric .lyric-wrap {
  text-align: center;
}
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
  overflow: hidden;
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
  transition: transform var(--timing), opacity var(--timing), filter var(--timing);
  cursor: pointer;
  pointer-events: auto;
  padding: 6px 16px;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.right-pane.center-lyric .lyric-line { align-items: center; }
.lyric-line.active {
  color: #fff;
}
.lyric-line.passed { color: rgba(255, 255, 255, 0.42); }
.lyric-line:not(.active) { color: rgba(255, 255, 255, 0.55); }
.lyric-line.interlude {
  pointer-events: none;
}
.lyric-text {
  display: inline-block;
  line-height: 1.35;
  font-weight: inherit;
}
.lyric-text.text-shadow { text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5); }
.lyric-text.text-glow {
  text-shadow: 0 0 18px rgba(255, 255, 255, 0.35), 0 0 4px rgba(255, 255, 255, 0.55);
}
.lyric-line.active .lyric-text.text-glow {
  text-shadow: 0 0 24px var(--accent), 0 0 8px rgba(255, 255, 255, 0.6);
}
.lyric-translation {
  font-size: 0.62em;
  color: rgba(255, 255, 255, 0.6);
  font-weight: 400;
  line-height: 1.35;
}
.lyric-romaji {
  font-size: 0.55em;
  color: rgba(255, 255, 255, 0.4);
  font-style: italic;
  font-weight: 400;
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
  .right-pane { display: none; }
  .left-pane { align-items: center; }
  .cover-wrap { width: min(260px, 60vw); }
  .controls-block { width: 100%; max-width: 480px; }
  .vol-cluster { margin-left: 0; }
}
</style>
