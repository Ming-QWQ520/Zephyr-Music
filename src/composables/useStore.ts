/**
 * useStore — tauri-plugin-store 封装
 *
 * 提供同步读取 + 异步写入的持久化方案，替代 localStorage。
 *
 * 工作原理：
 *   - 模块加载时立即从内存缓存读取（首次为空，返回 null）
 *   - 应用启动时调用 initStores() 异步从 store 加载到缓存
 *   - 写入时同步更新缓存 + 异步写入 store（不阻塞 UI）
 *
 * Store 文件位置：exe 所在目录下的 settings.json
 *   - 通过 Tauri 的 executableDir() 获取 exe 目录，拼接绝对路径
 *   - 这样所有数据（设置、cookie、会话）都跟随 exe 移动，便于便携使用
 */
import { load, type Store } from "@tauri-apps/plugin-store";
import { join, executableDir } from "@tauri-apps/api/path";

/** 缓存：store 加载后的内存镜像（key → JSON 字符串） */
const cache = new Map<string, string>();
/** Store 实例（懒加载） */
let storeInstance: Store | null = null;
/** 初始化 Promise（防止重复初始化） */
let initPromise: Promise<void> | null = null;

/** 已加载标记（供 useSettings 等同步代码判断是否需要等加载） */
let loaded = false;

/**
 * 初始化 store：加载持久化文件到内存缓存。
 * 必须在应用启动时（App.vue onMounted 之前）调用。
 *
 * store 文件路径 = exe 所在目录 + "settings.json"
 * 例如 Windows: C:\path\to\zephyr-music.exe → C:\path\to\settings.json
 */
export async function initStores(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      // 获取 exe 所在目录，拼接 settings.json 的绝对路径
      const exeDir = await executableDir();
      const storePath = await join(exeDir, "settings.json");
      storeInstance = await load(storePath, { autoSave: false });
      const entries = await storeInstance.entries();
      for (const [key, value] of entries) {
        if (typeof value === "string") {
          cache.set(String(key), value);
        } else {
          cache.set(String(key), JSON.stringify(value));
        }
      }
      loaded = true;
    } catch (e) {
      // store 不可用时（如非 Tauri 环境），静默降级
      console.warn("[store] init failed, falling back to memory-only:", e);
      loaded = true;
    }
  })();
  return initPromise;
}

/**
 * 同步读取：从内存缓存读取值。
 * 首次调用（initStores 完成前）返回 null。
 */
export function storeGetSync(key: string): string | null {
  return cache.get(key) ?? null;
}

/**
 * 异步写入：更新缓存 + 写入 store（不阻塞 UI）。
 */
export async function storeSet(key: string, value: string): Promise<void> {
  cache.set(key, value);
  if (storeInstance) {
    try {
      await storeInstance.set(key, value);
      await storeInstance.save();
    } catch (e) {
      console.warn(`[store] set("${key}") failed:`, e);
    }
  }
}

/**
 * 同步写入（仅缓存）：立即更新内存，异步落盘。
 * 用于 watch 回调中不能 await 的场景。
 */
export function storeSetSync(key: string, value: string): void {
  cache.set(key, value);
  // 异步写入 store（不阻塞）
  storeSet(key, value).catch(() => {});
}

/** 删除键 */
export async function storeDelete(key: string): Promise<void> {
  cache.delete(key);
  if (storeInstance) {
    try {
      await storeInstance.delete(key);
      await storeInstance.save();
    } catch (e) {
      console.warn(`[store] delete("${key}") failed:`, e);
    }
  }
}

/** store 是否已加载完成 */
export function isStoreLoaded(): boolean {
  return loaded;
}

/**
 * 兼容 localStorage 的同步 getItem（从缓存读取）。
 * 用于无法改为异步的旧代码（如 logger.ts）。
 */
export const store = {
  getItem: (key: string): string | null => storeGetSync(key),
  setItem: (key: string, value: string): void => storeSetSync(key, value),
  removeItem: (key: string): void => { cache.delete(key); storeDelete(key).catch(() => {}); },
};
