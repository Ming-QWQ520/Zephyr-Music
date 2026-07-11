<script setup lang="ts">
/**
 * 音频可视化（Canvas）
 *
 * 纯程序化模拟，不触碰 <audio> 元素，避免 Web Audio API 在 AudioContext
 * 挂起时导致"暂停后无声音"的 bug。
 *
 * Canvas 作为底部 flex item（不是 absolute 覆盖层），不参与 cover/lyrics
 * 的垂直居中布局。
 *
 * 从 useAudioVisualizer 取模拟频谱数据；从 useSettings 取样式/颜色/强度
 * 等设置；监听 store.isPlaying 重启 rAF 循环。
 */
import { ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import { useAudioVisualizer } from "@/composables/useAudioVisualizer";
import { useNowPlaying } from "./useNowPlaying";

const { store, settings } = useNowPlaying();
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
  const w = c.clientWidth || window.innerWidth;
  const h = c.clientHeight || 200;
  ctx.clearRect(0, 0, w, h);

  const style = settings.visualizerStyle;
  if (style === "off") return;

  // Ensure buffer size matches the user's bar count setting (capped at 32).
  const wantBins = Math.max(8, Math.min(32, Math.round(settings.visualizerBarCount)));
  if (vizBuffer.length !== wantBins) vizBuffer = new Uint8Array(wantBins);

  // fillFrequency returns false when paused AND fully settled → stop the loop.
  const keepAnimating = visualizer.fillFrequency(vizBuffer);
  if (!keepAnimating) {
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
    const maxH = h * 0.88;
    for (let i = 0; i < n; i++) {
      const v = (vizBuffer[i] / 255) * intensity;
      const bh = Math.max(2, v * maxH);
      const x = i * (barW + gap);
      const y = h - bh;
      const grad = ctx.createLinearGradient(0, y, 0, h);
      const col = colorForBin(i, n, opacity);
      const colTop = colorForBin(i, n, Math.max(0, opacity * 0.15));
      grad.addColorStop(0, colTop);
      grad.addColorStop(0.4, col);
      grad.addColorStop(1, col);
      ctx.fillStyle = grad;
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
    const maxAmp = h * 0.7;
    const baseline = h; // wave sits ON the bottom edge
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
  if (vizFrameSkip) {
    vizFrameSkip = false;
  } else {
    vizFrameSkip = true;
    drawVisualizer();
  }
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
  vizRO = new ResizeObserver(() => resizeVizCanvas());
  if (vizCanvasRef.value) vizRO.observe(vizCanvasRef.value);
  resizeVizCanvas();
  if (settings.visualizerStyle !== "off") startVizLoop();
});
onUnmounted(() => {
  if (vizRAF) cancelAnimationFrame(vizRAF); vizRAF = 0;
  vizRO?.disconnect();
});
</script>

<template>
  <!-- Audio-reactive visualizer (bottom strip, flex item — doesn't overlap content) -->
  <canvas
    v-show="settings.visualizerStyle !== 'off'"
    ref="vizCanvasRef"
    class="viz-canvas"
    aria-hidden="true"
  ></canvas>
</template>

<style scoped>
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
</style>
