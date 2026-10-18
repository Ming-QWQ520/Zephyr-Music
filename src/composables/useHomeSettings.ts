/**
 * 首页设置（独立于播放界面 NowPlayingView 的设置）
 *
 * 两套设置完全独立，各自存储在不同 store key 下：
 *   - 首页设置：home-settings（壁纸、主题色、字体缩放等，影响首页/侧边栏/标题栏）
 *   - 播放界面设置：rnp-settings（SettingsPanel.vue，影响全屏播放器）
 *
 * 首页设置目前包含：
 *   - 背景壁纸：自定义全屏图片 URL（覆盖标题栏），含模糊/变暗
 *   - 主题色：影响 --accent CSS 变量（首页用）
 *   - 字体缩放：首页内容缩放
 *
 * 加载时序说明（重要）：
 *   1. 模块加载时调用 loadHomeSettings() → storeGetSync 此时缓存为空（initStores 未运行）
 *      → 返回默认值，响应式 _homeSettings 用默认值创建
 *   2. App.vue onMounted 中调用 initStores() → 从磁盘加载到缓存
 *   3. 调用 reloadHomeSettingsFromStore() → 强制从缓存重新读取，更新响应式 _homeSettings
 *   这样首启时能正确恢复上次保存的壁纸/主题色等设置。
 */
import { reactive, watch } from "vue";
import { storeSetSync, storeGetSync } from "@/composables/useStore";
// 注意：不导入 logger（logger 反向导入 useStore，可能形成循环依赖）
// 用 console.log 代替，日志会被 logger 的 write_log 收集

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
  /**
   * 点击窗口关闭按钮 / Alt+F4 时的行为：
   *  - "tray"：最小化到系统托盘（默认）—— 窗口隐藏而非退出，托盘图标保留
   *  - "quit"：直接退出应用 —— 窗口关闭时落盘后销毁进程 */
  exitAction: "tray" | "quit";
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
  exitAction: "tray",
};

let cached: HomeSettings | null = null;

export function loadHomeSettings(): HomeSettings {
  if (cached) return cached;
  try {
    const raw = storeGetSync(STORAGE_KEY);
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
    storeSetSync(STORAGE_KEY, JSON.stringify(s));
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

/**
 * 异步重新加载首页设置：从 default store 读取最新值并更新响应式 _homeSettings。
 * 必须在 initStores() 完成后调用，确保 store 数据已加载到内存缓存。
 *
 * 这一步是必须的，因为：
 *   - 模块加载时 _homeSettings = reactive(loadHomeSettings()) 已用默认值创建
 *   - initStores() 之后缓存才有数据，但响应式对象不会自动更新
 *   - 必须显式地把 store 中的值写回 _homeSettings，UI 才能反映持久化状态
 */
export function reloadHomeSettingsFromStore() {
  cached = null;
  const fresh = loadHomeSettings();
  const rawFromStore = storeGetSync(STORAGE_KEY);
  console.log("home-settings", "reloadHomeSettingsFromStore", {
    hasStoreValue: !!rawFromStore,
    storeValuePreview: rawFromStore ? rawFromStore.substring(0, 120) : null,
    bgType: fresh.bgType,
    bgImagePreview: fresh.bgImage ? fresh.bgImage.substring(0, 80) : null,
  });
  for (const key of Object.keys(fresh)) {
    (_homeSettings as any)[key] = (fresh as any)[key];
  }
}

export function useHomeSettings() {
  return { settings: _homeSettings, defaults: DEFAULT_HOME_SETTINGS };
}
