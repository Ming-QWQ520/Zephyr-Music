/**
 * 播放器设置 composable
 *
 * 类型别名（DisplayMode / ColorMode / ...）已在 @/types/settings 中定义，
 * 这里重新导出以保持向后兼容（原 SettingsPanel.vue 中导出过它们）。
 *
 * 本模块负责：
 *   - DEFAULT_SETTINGS 默认值
 *   - loadSettings / saveSettings 持久化（localStorage key: rnp-settings）
 *   - 单例响应式 _settings + watch（同步 CSS 变量、GPU 加速类、低延迟模式）
 *   - useSettings() 返回 { settings, defaults }
 */
import { reactive, watch } from "vue";
import type {
  DisplayMode, ColorMode, HAlign, VAlign, BgType,
  VisualizerStyle, VisualizerColor, LyricAlign,
  AnimationTiming, FontFamily,
} from "@/types";

// 重新导出类型别名，保持与原 SettingsPanel.vue 一致的对外 API
export type {
  DisplayMode, ColorMode, HAlign, VAlign, BgType,
  VisualizerStyle, VisualizerColor, LyricAlign,
  AnimationTiming, FontFamily,
};

export interface PlayerSettings {
  // Appearance
  displayMode: DisplayMode;
  colorMode: ColorMode;
  accentColor: string;
  textShadow: boolean;
  textGlow: boolean;
  progressPreview: boolean;

  // Cover
  coverHAlign: HAlign;
  coverVAlign: VAlign;
  rectangleCover: boolean;
  coverQuality: number; // 200/300/400/500
  coverShadow: boolean;

  // Background
  bgType: BgType;
  bgBlur: number; // px
  bgDim: number; // 0..100

  // Audio visualizer (background bars/lines that bounce with the audio)
  visualizerStyle: VisualizerStyle;
  visualizerColor: VisualizerColor;
  visualizerIntensity: number; // 0..1 — overall amplitude multiplier
  visualizerOpacity: number; // 0..1 — background layer opacity
  visualizerBarCount: number; // 24..96 — number of bars/segments

  // Lyrics
  boldFirstLine: boolean;
  lyricFontSize: number; // px
  lyricLineGap: number; // px
  showRomaji: boolean;
  showTranslation: boolean;
  lyricZoom: number; // multiplier around current line
  lyricBlur: number; // px for inactive lines
  lyricFade: number; // 0..1 opacity falloff
  lyricRotate: boolean;
  rotateCurvature: number; // 0..50
  currentLyricAlign: LyricAlign;
  lyricStagger: number; // 0..1 stagger amount
  animationTiming: AnimationTiming;

  // Audio
  audioLevel: string; // standard/higher/exhigh/lossless/hires/jyeffect/sky/dolby/jymaster

  // Misc
  hidePlayerControls: boolean;
  autoHideMiniInfo: boolean;
  smoothLyricScroll: boolean; // 歌词平滑滚动（滚轮滑动时有过渡效果）
  coverRotation: boolean; // 首页封面旋转（播放时旋转）

  // Experimental
  gpuAcceleration: boolean;
  debugLog: boolean;
  skipMetadata: boolean;
  lowLatency: boolean;

  // Font
  fontFamily: FontFamily;
  fontScale: number; // 0.8..1.4
}

const STORAGE_KEY = "rnp-settings";

export const DEFAULT_SETTINGS: PlayerSettings = {
  displayMode: "both",
  colorMode: "light",
  accentColor: "#fa233b",
  textShadow: true,
  textGlow: false,
  progressPreview: true,

  coverHAlign: "left",
  coverVAlign: "center",
  rectangleCover: false,
  coverQuality: 300,
  coverShadow: true,

  bgType: "blur",
  bgBlur: 10,
  bgDim: 30,

  visualizerStyle: "off",
  visualizerColor: "accent",
  visualizerIntensity: 0.7,
  visualizerOpacity: 0.55,
  visualizerBarCount: 48,

  boldFirstLine: true,
  lyricFontSize: 28,
  lyricLineGap: 18,
  showRomaji: false,
  showTranslation: true,
  lyricZoom: 1.18,
  lyricBlur: 6,
  lyricFade: 0.32,
  lyricRotate: false,
  rotateCurvature: 18,
  currentLyricAlign: "left",
  lyricStagger: 0.4,
  animationTiming: "smooth",

  audioLevel: "exhigh",

  hidePlayerControls: false,
  autoHideMiniInfo: true,
  smoothLyricScroll: false,
  coverRotation: false,

  gpuAcceleration: true,
  debugLog: false,
  skipMetadata: false,
  lowLatency: false,

  fontFamily: "system",
  fontScale: 1,
};

let cached: PlayerSettings | null = null;

export function loadSettings(): PlayerSettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return (cached = { ...DEFAULT_SETTINGS });
    const parsed = JSON.parse(raw);
    // Migrate legacy "karaokeAnimation" setting → new visualizer settings.
    // Old: karaokeAnimation: "off" | "wave" | "scale" | "color"
    // New: visualizerStyle: "off" | "bars" | "lines" | "wave"
    if (parsed && "karaokeAnimation" in parsed && !("visualizerStyle" in parsed)) {
      const old = parsed.karaokeAnimation;
      parsed.visualizerStyle =
        old === "off" ? "off" :
        old === "wave" ? "wave" :
        old === "scale" ? "bars" :
        old === "color" ? "bars" : "bars";
      delete parsed.karaokeAnimation;
    }
    cached = { ...DEFAULT_SETTINGS, ...parsed } as PlayerSettings;
  } catch {
    cached = { ...DEFAULT_SETTINGS };
  }
  return cached!;
}

export function saveSettings(s: PlayerSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota errors */
  }
}

function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return `rgba(250,35,59,${alpha})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

const _settings = reactive<PlayerSettings>(loadSettings());

watch(
  _settings,
  (v) => {
    cached = v;
    saveSettings(v);
    // Reflect accent on the CSS variable
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--accent", v.accentColor);
      document.documentElement.style.setProperty(
        "--accent-soft",
        hexToRgba(v.accentColor, 0.16)
      );
      document.documentElement.dataset.colorMode = v.colorMode;
      // GPU acceleration: add/remove a class on <html> that forces translateZ(0) on all animated elements
      if (v.gpuAcceleration) {
        document.documentElement.classList.add("gpu-accel");
        document.documentElement.classList.remove("no-gpu");
      } else {
        document.documentElement.classList.add("no-gpu");
        document.documentElement.classList.remove("gpu-accel");
      }
      // Low latency: reduce animation durations
      if (v.lowLatency) {
        document.documentElement.style.setProperty("--timing-mult", "0.5");
      } else {
        document.documentElement.style.setProperty("--timing-mult", "1");
      }
    }
  },
  { deep: true, immediate: true }
);

export function useSettings() {
  return { settings: _settings, defaults: DEFAULT_SETTINGS };
}
