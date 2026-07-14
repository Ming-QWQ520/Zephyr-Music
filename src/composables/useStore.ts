/**
 * useStore — tauri-plugin-store 封装（支持多 store 实例）
 *
 * 提供同步读取 + 异步写入的持久化方案，替代 localStorage。
 *
 * 工作原理：
 *   - 模块加载时立即从内存缓存读取（首次为空，返回 null）
 *   - 应用启动时调用 initStores() / initPlayerStore() 异步从 store 加载到缓存
 *   - 写入时同步更新缓存 + 异步写入 store（不阻塞 UI）
 *
 * 多 store 架构：
 *   - "default" store → data/settings.json（首页设置、排行榜缓存等通用数据）
 *   - "player"  store → data/player/settings.json（播放器设置：rnp-settings）
 *   - 每个 store 拥有独立的缓存、实例、初始化 Promise、落盘队列
 *
 * 文件布局（exe 同目录）：
 *   data/
 *   ├── settings.json          ← default store（home-settings 等）
 *   ├── player/settings.json   ← player store（rnp-settings 播放器设置）
 *   ├── playlist.json          ← 退出前的歌单数据
 *   └── cookie/cookies.dat     ← 加密 cookie
 *
 *   注意：data/ 与 data/player/ 目录由 Rust get_app_data_dir 命令创建。
 */
import { load, type Store } from "@tauri-apps/plugin-store";
import { join, executableDir } from "@tauri-apps/api/path";

/** 单个 store 的运行时状态 */
interface StoreEntry {
  /** 内存缓存：key → JSON 字符串 */
  cache: Map<string, string>;
  /** plugin-store 实例（懒加载） */
  instance: Store | null;
  /** 初始化 Promise（防止重复初始化） */
  initPromise: Promise<void> | null;
  /** 是否已加载完成 */
  loaded: boolean;
  /** 挂起的落盘 Promise（供 flush 等待） */
  pendingSave: Promise<void>;
}

/** 所有已注册的 store，按名称索引 */
const stores = new Map<string, StoreEntry>();

/** 获取或创建一个 store 条目 */
function entry(name: string): StoreEntry {
  let e = stores.get(name);
  if (!e) {
    e = { cache: new Map(), instance: null, initPromise: null, loaded: false, pendingSave: Promise.resolve() };
    stores.set(name, e);
  }
  return e;
}

// ===== default store（data/settings.json）=====

/**
 * 初始化 default store：加载 data/settings.json 到内存缓存。
 * 必须在应用启动时调用。
 */
export async function initStores(): Promise<void> {
  const e = entry("default");
  if (e.initPromise) return e.initPromise;
  e.initPromise = (async () => {
    try {
      const exeDir = await executableDir();
      const storePath = await join(exeDir, "data", "settings.json");
      e.instance = await load(storePath, { defaults: {}, autoSave: false });
      const entries = await e.instance.entries();
      for (const [key, value] of entries) {
        if (typeof value === "string") {
          e.cache.set(String(key), value);
        } else {
          e.cache.set(String(key), JSON.stringify(value));
        }
      }
      e.loaded = true;
    } catch (err) {
      console.warn("[store:default] init failed, falling back to memory-only:", err);
      e.loaded = true;
    }
  })();
  return e.initPromise;
}

/** 同步读取 default store 缓存。首次（initStores 完成前）返回 null。 */
export function storeGetSync(key: string): string | null {
  return entry("default").cache.get(key) ?? null;
}

/** 异步写入 default store：更新缓存 + 落盘。 */
export async function storeSet(key: string, value: string): Promise<void> {
  const e = entry("default");
  e.cache.set(key, value);
  if (e.instance) {
    try {
      await e.instance.set(key, value);
      await e.instance.save();
    } catch (err) {
      console.warn(`[store:default] set("${key}") failed:`, err);
    }
  }
}

/** 同步写入 default store（仅缓存，异步落盘）。用于 watch 回调。 */
export function storeSetSync(key: string, value: string): void {
  const e = entry("default");
  e.cache.set(key, value);
  e.pendingSave = storeSet(key, value).catch(() => {}).then(() => undefined);
}

/** 删除 default store 中的键 */
export async function storeDelete(key: string): Promise<void> {
  const e = entry("default");
  e.cache.delete(key);
  if (e.instance) {
    try {
      await e.instance.delete(key);
      await e.instance.save();
    } catch (err) {
      console.warn(`[store:default] delete("${key}") failed:`, err);
    }
  }
}

/** default store 是否已加载完成 */
export function isStoreLoaded(): boolean {
  return entry("default").loaded;
}

/**
 * 兼容 localStorage 的同步接口（default store）。
 * 用于无法改为异步的旧代码（如 logger.ts）。
 */
export const store = {
  getItem: (key: string): string | null => storeGetSync(key),
  setItem: (key: string, value: string): void => storeSetSync(key, value),
  removeItem: (key: string): void => { entry("default").cache.delete(key); storeDelete(key).catch(() => {}); },
};

// ===== player store（data/player/settings.json）=====

/**
 * 初始化 player store：加载 data/player/settings.json 到内存缓存。
 * 必须在 reloadSettingsFromStore() 之前调用。
 */
export async function initPlayerStore(): Promise<void> {
  const e = entry("player");
  if (e.initPromise) return e.initPromise;
  e.initPromise = (async () => {
    try {
      const exeDir = await executableDir();
      const storePath = await join(exeDir, "data", "player", "settings.json");
      e.instance = await load(storePath, { defaults: {}, autoSave: false });
      const entries = await e.instance.entries();
      for (const [key, value] of entries) {
        if (typeof value === "string") {
          e.cache.set(String(key), value);
        } else {
          e.cache.set(String(key), JSON.stringify(value));
        }
      }
      e.loaded = true;
    } catch (err) {
      console.warn("[store:player] init failed, falling back to memory-only:", err);
      e.loaded = true;
    }
  })();
  return e.initPromise;
}

/** 同步读取 player store 缓存。 */
export function playerGetSync(key: string): string | null {
  return entry("player").cache.get(key) ?? null;
}

/** 异步写入 player store：更新缓存 + 落盘。 */
export async function playerSet(key: string, value: string): Promise<void> {
  const e = entry("player");
  e.cache.set(key, value);
  if (e.instance) {
    try {
      await e.instance.set(key, value);
      await e.instance.save();
    } catch (err) {
      console.warn(`[store:player] set("${key}") failed:`, err);
    }
  }
}

/** 同步写入 player store（仅缓存，异步落盘）。用于 watch 回调。 */
export function playerSetSync(key: string, value: string): void {
  const e = entry("player");
  e.cache.set(key, value);
  e.pendingSave = playerSet(key, value).catch(() => {}).then(() => undefined);
}

/** 等待 player store 所有挂起的落盘完成（供窗口关闭前调用）。 */
export function flushPlayerStore(): Promise<void> {
  return entry("player").pendingSave;
}

/** player store 是否已加载完成 */
export function isPlayerStoreLoaded(): boolean {
  return entry("player").loaded;
}
