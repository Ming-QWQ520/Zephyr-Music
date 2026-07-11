/**
 * 首页设置（独立于播放界面 NowPlayingView 的设置）
 *
 * 两套设置完全独立，各自存储在 localStorage 不同 key 下：
 *   - 首页设置：home-settings（壁纸、主题色、字体缩放等，影响首页/侧边栏/标题栏）
 *   - 播放界面设置：rnp-settings（SettingsPanel.vue，影响全屏播放器）
 *
 * 首页设置目前包含：
 *   - 背景壁纸：自定义全屏图片 URL（覆盖标题栏），含模糊/变暗
 *   - 主题色：影响 --accent CSS 变量（首页用）
 *   - 字体缩放：首页内容缩放
 */
import { reactive, watch } from "vue";

export type HomeBgType = "none" | "image" | "gradient";

export interface HomeSettings {
  /** 背景类型 */
  bgType: HomeBgType;
  /** 自定义壁纸 URL（本地文件路径或网络 URL） */
  bgImage: string;
  /** 壁纸模糊（px） */
  bgBlur: number;
  /** 壁纸变暗（0..100） */
  bgDim: number;
  /** 壁纸缩放模式 */
  bgFit: "cover" | "contain";
  /** 主题色（首页用，与播放界面独立） */
  accentColor: string;
  /** 字体缩放（0.8..1.4） */
  fontScale: number;
  /** 侧边栏透明（壁纸可见时） */
  transparentSidebar: boolean;
  /** 启动后自动播放 */
  autoPlayOnStartup: boolean;
}

const STORAGE_KEY = "home-settings";

export const DEFAULT_HOME_SETTINGS: HomeSettings = {
  bgType: "none",
  bgImage: "",
  bgBlur: 0,
  bgDim: 0,
  bgFit: "cover",
  accentColor: "#fa233b",
  fontScale: 1,
  transparentSidebar: true,
  autoPlayOnStartup: false,
};

let cached: HomeSettings | null = null;

export function loadHomeSettings(): HomeSettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return (cached = { ...DEFAULT_HOME_SETTINGS });
    const parsed = JSON.parse(raw);
    cached = { ...DEFAULT_HOME_SETTINGS, ...parsed } as HomeSettings;
  } catch {
    cached = { ...DEFAULT_HOME_SETTINGS };
  }
  return cached!;
}

export function saveHomeSettings(s: HomeSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const _homeSettings = reactive<HomeSettings>(loadHomeSettings());

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

watch(
  _homeSettings,
  (v) => {
    cached = v;
    saveHomeSettings(v);
    if (typeof document !== "undefined") {
      // 首页主题色（仅当播放界面未打开时生效，NowPlayingView 会用 rnp-settings 的 accentColor）
      // 为避免冲突，首页主题色写入 --home-accent 变量，App.vue 根据当前视图决定用哪个
      document.documentElement.style.setProperty("--home-accent", v.accentColor);
      document.documentElement.style.setProperty(
        "--home-accent-soft",
        hexToRgba(v.accentColor, 0.16)
      );
      // 字体缩放
      document.documentElement.style.setProperty("--home-font-scale", String(v.fontScale));
    }
  },
  { deep: true, immediate: true }
);

export function useHomeSettings() {
  return { settings: _homeSettings, defaults: DEFAULT_HOME_SETTINGS };
}
