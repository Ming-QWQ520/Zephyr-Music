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
  AnimationTiming, FontFamily, Scene3D,
} from "@/types";
import { storeSetSync, storeGetSync, initStores } from "@/composables/useStore";

// 重新导出类型别名，保持与原 SettingsPanel.vue 一致的对外 API
export type {
  DisplayMode, ColorMode, HAlign, VAlign, BgType,
  VisualizerStyle, VisualizerColor, LyricAlign,
  AnimationTiming, FontFamily, Scene3D,
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

  // 3D playback scene (ported from Mineradio particle visualizer)
  scene3D: Scene3D;

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
  rotateCurvature: number; // 0..90
  rotateLyricFontSize: number; // 旋转模式专用歌词字体大小 px
  rotateLyricLineGap: number; // 旋转模式专用歌词间距 px
  currentLyricAlign: LyricAlign;
  lyricStagger: number; // 0..1 stagger amount
  animationTiming: AnimationTiming;
  // 歌词颜色（CSS 颜色字符串，支持 hex / rgba）
  lyricActiveColor: string; // 逐行已播放颜色（当前行）
  lyricInactiveColor: string; // 逐行未播放颜色（非当前行）
  yrcPlayedColor: string; // 逐字已播放颜色（同时用作擦除边缘高亮）
  yrcUnplayedColor: string; // 逐字未播放颜色

  // Audio
  audioLevel: string; // standard/higher/exhigh/lossless/hires/jyeffect/sky/dolby/jymaster

  // Misc
  hidePlayerControls: boolean;
  autoHideMiniInfo: boolean;
  smoothLyricScroll: boolean; // 歌词平滑滚动（滚轮滑动时有过渡效果）
  coverRotation: boolean; // 首页封面旋转（播放时旋转）
  autoPlayOnStartup: boolean; // 进入程序后自动播放

  // Experimental
  gpuAcceleration: boolean;
  debugLog: boolean;
  skipMetadata: boolean;
  lowLatency: boolean;

  // Font
  fontFamily: FontFamily;
  fontScale: number; // 0.8..1.4

  /** 设置版本号（用于迁移，不直接显示在 UI 中） */
  _v?: number;
}

const STORAGE_KEY = "rnp-settings";
/** 设置版本：递增以强制迁移新默认值（覆盖旧版本中可能存在的旧默认值） */
const SETTINGS_VERSION = 4;

export const DEFAULT_SETTINGS: PlayerSettings = {
  displayMode: "both",
  colorMode: "dark",
  accentColor: "#fa233b",
  textShadow: true,
  textGlow: false,
  progressPreview: true,

  coverHAlign: "center",
  coverVAlign: "center",
  rectangleCover: false,
  coverQuality: 300,
  coverShadow: false,

  bgType: "blur",
  bgBlur: 2,
  bgDim: 50,

  scene3D: "off",

  visualizerStyle: "off",
  visualizerColor: "accent",
  visualizerIntensity: 0.7,
  visualizerOpacity: 0.55,
  visualizerBarCount: 48,

  boldFirstLine: true,
  lyricFontSize: 35,
  lyricLineGap: 15,
  showRomaji: false,
  showTranslation: true,
  lyricZoom: 1.05,
  lyricBlur: 2,
  lyricFade: 1,
  lyricRotate: false,
  rotateCurvature: 50,
  rotateLyricFontSize: 35,
  rotateLyricLineGap: 5,
  currentLyricAlign: "left",
  lyricStagger: 0,
  animationTiming: "smooth",
  // 歌词颜色默认值
  lyricActiveColor: "#ffffff",
  lyricInactiveColor: "rgba(255, 255, 255, 0.45)",
  yrcPlayedColor: "#ffffff",
  yrcUnplayedColor: "rgba(255, 255, 255, 0.3)",

  audioLevel: "standard",

  hidePlayerControls: false,
  autoHideMiniInfo: false,
  smoothLyricScroll: true,
  coverRotation: false,
  autoPlayOnStartup: false,

  gpuAcceleration: true,
  debugLog: false,
  skipMetadata: false,
  lowLatency: false,

  fontFamily: "system",
  fontScale: 1,

  _v: 4,
};

let cached: PlayerSettings | null = null;

export function loadSettings(): PlayerSettings {
  if (cached) return cached;
  try {
    const raw = storeGetSync(STORAGE_KEY);
    if (!raw) return (cached = { ...DEFAULT_SETTINGS });
    const parsed = JSON.parse(raw);
    // Migrate legacy "karaokeAnimation" setting → new visualizer settings.
    if (parsed && "karaokeAnimation" in parsed && !("visualizerStyle" in parsed)) {
      const old = parsed.karaokeAnimation;
      parsed.visualizerStyle =
        old === "off" ? "off" :
        old === "wave" ? "wave" :
        old === "scale" ? "bars" :
        old === "color" ? "bars" : "bars";
      delete parsed.karaokeAnimation;
    }
    // 版本迁移：当设置版本不匹配时，直接用新默认值覆盖所有被修改的字段。
    // 这样即使旧 store 残留，也能确保新默认值生效。
    if (!parsed._v || parsed._v !== SETTINGS_VERSION) {
      const migrateFields: (keyof PlayerSettings)[] = [
        "colorMode",
        "coverHAlign", "coverVAlign", "coverShadow", "coverQuality", "rectangleCover",
        "bgType", "bgBlur", "bgDim",
        "lyricFontSize", "lyricLineGap", "lyricZoom", "lyricStagger",
        "lyricBlur", "lyricFade", "boldFirstLine", "showTranslation", "showRomaji",
        "lyricRotate", "rotateCurvature", "rotateLyricFontSize", "rotateLyricLineGap",
        "currentLyricAlign", "animationTiming",
        "audioLevel", "smoothLyricScroll",
        "hidePlayerControls", "autoHideMiniInfo", "coverRotation", "autoPlayOnStartup",
        "scene3D",
        "lyricActiveColor", "lyricInactiveColor", "yrcPlayedColor", "yrcUnplayedColor",
        "textShadow", "textGlow", "progressPreview",
        "fontFamily", "fontScale",
      ];
      for (const key of migrateFields) {
        (parsed as any)[key] = DEFAULT_SETTINGS[key];
      }
      parsed._v = SETTINGS_VERSION;
    }
    cached = { ...DEFAULT_SETTINGS, ...parsed } as PlayerSettings;
    // 立即保存迁移后的设置到 store
    saveSettings(cached);
  } catch {
    cached = { ...DEFAULT_SETTINGS };
  }
  return cached!;
}

export function saveSettings(s: PlayerSettings) {
  try {
    storeSetSync(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore errors */
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

/**
 * 异步重新加载设置：从 store 读取最新值并更新响应式 settings。
 * 在 initStores() 完成后调用，确保 store 数据加载到内存缓存后再读取。
 * 这样首次启动时能正确读取持久化数据（store 是异步加载的）。
 */
export async function reloadSettingsFromStore() {
  await initStores();
  const fresh = loadSettingsFromStore();
  // 用 store 中的值更新响应式 settings（保留 watch 不会触发的字段）
  for (const key of Object.keys(fresh)) {
    (_settings as any)[key] = (fresh as any)[key];
  }
}

/** 从 store 重新读取（不走 cached，强制刷新） */
function loadSettingsFromStore(): PlayerSettings {
  try {
    const raw = storeGetSync(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    if (!parsed._v || parsed._v !== SETTINGS_VERSION) {
      // 版本不匹配：用默认值
      return { ...DEFAULT_SETTINGS };
    }
    return { ...DEFAULT_SETTINGS, ...parsed } as PlayerSettings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
