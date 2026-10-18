/**
 * useStore — 自定义持久化方案（基于 Rust 命令，非 plugin-store）
 *
 * 所有数据存储在 exe 同级 `data/` 目录，便携迁移。
 *
 * 文件布局（exe 同目录）：
 *   data/
 *   ├── settings.json              ← default store（home-settings、云盘记录等）
 *   ├── player_settings.json       ← player store（rnp-settings 播放器设置）
 *   ├── playlist/playlist.json     ← 退出前的歌单数据
 *   ├── cookie/cookies.txt         ← 明文 cookie
 *   └── wallpaper/                 ← 持久化壁纸图片
 *
 * 工作原理：
 *   - 模块加载时立即从内存缓存读取（首次为空，返回 null）
 *   - 应用启动时调用 initStores() / initPlayerStore() 异步从 Rust 加载到缓存
 *   - 写入时同步更新缓存 + 异步调用 Rust 命令落盘（不阻塞 UI）
 *
 * 竞态保护（关键）：
 *   - `loaded` 标志位标记 store 是否已从磁盘加载完成
 *   - `storeSetSync` / `playerSetSync` 在 `loaded=false` 时只更新缓存，不落盘
 *   - 这样可避免模块加载时 watch immediate 触发的默认值写入覆盖磁盘上的真实值
 *   - `initStores` 完成后 `loaded=true`，后续写入正常落盘
 */
import { invoke } from "@tauri-apps/api/core";

// 注意：不导入 logger（logger 反向导入 useStore 的 playerGetSync，会形成循环依赖）
// 用 console.log/warn 代替，日志同时会被 logger 的 write_log 收集

/** 单个 store 的运行时状态 */
interface StoreEntry {
  cache: Map<string, string>;
  initPromise: Promise<void> | null;
  loaded: boolean;
  pendingSave: Promise<void>;
  loadCmd: string;
  saveCmd: string;
  name: string;
}

const stores = new Map<string, StoreEntry>();

function entry(name: string): StoreEntry {
  let e = stores.get(name);
  if (!e) {
    if (name === "default") {
      e = { cache: new Map(), initPromise: null, loaded: false, pendingSave: Promise.resolve(),
            loadCmd: "load_settings_json", saveCmd: "save_settings_json", name };
    } else if (name === "player") {
      e = { cache: new Map(), initPromise: null, loaded: false, pendingSave: Promise.resolve(),
            loadCmd: "load_player_settings_json", saveCmd: "save_player_settings_json", name };
    } else {
      throw new Error(`Unknown store: ${name}`);
    }
    stores.set(name, e);
  }
  return e;
}

function serializeCache(e: StoreEntry): string {
  const obj: Record<string, string> = {};
  for (const [k, v] of e.cache.entries()) obj[k] = v;
  return JSON.stringify(obj);
}

function deserializeToCache(e: StoreEntry, raw: string): void {
  e.cache.clear();
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") {
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === "string") {
          e.cache.set(key, value);
        } else {
          e.cache.set(key, JSON.stringify(value));
        }
      }
    }
  } catch { /* JSON 解析失败：保持空缓存 */ }
}

/** 异步保存整个缓存到磁盘。loaded=false 时不写入，避免覆盖磁盘真实值。 */
async function persistStore(e: StoreEntry): Promise<void> {
  if (!e.loaded) {
    console.log("store", `persistStore(${e.name}) skipped: not loaded yet`);
    return;
  }
  const json = serializeCache(e);
  try {
    await invoke(e.saveCmd, { json });
    console.log("store", `persistStore(${e.name}) ok, ${json.length} bytes`);
  } catch (err) {
    console.warn("store", `persistStore(${e.name}) failed`, { error: String(err) });
  }
}

// ===== default store（data/settings.json）=====

export async function initStores(): Promise<void> {
  const e = entry("default");
  if (e.initPromise) return e.initPromise;
  e.initPromise = (async () => {
    try {
      const raw = await invoke<string | null>(e.loadCmd);
      if (raw) {
        deserializeToCache(e, raw);
        console.log("store", `initStores(default) loaded ${e.cache.size} keys from disk`);
      } else {
        console.log("store", "initStores(default): settings.json not found, using defaults");
      }
      e.loaded = true;
    } catch (err) {
      console.warn("store", "initStores(default) failed, memory-only", { error: String(err) });
      e.loaded = true;
    }
  })();
  return e.initPromise;
}

export function storeGetSync(key: string): string | null {
  return entry("default").cache.get(key) ?? null;
}

export async function storeSet(key: string, value: string): Promise<void> {
  const e = entry("default");
  e.cache.set(key, value);
  e.pendingSave = persistStore(e);
  await e.pendingSave;
}

export function storeSetSync(key: string, value: string): void {
  const e = entry("default");
  e.cache.set(key, value);
  // 链式等待：确保多次快速写入不会并发覆盖
  // loaded=false 时 persistStore 内部会跳过，只更新缓存
  e.pendingSave = e.pendingSave.then(() => persistStore(e)).catch(() => {});
}

export async function storeDelete(key: string): Promise<void> {
  const e = entry("default");
  e.cache.delete(key);
  e.pendingSave = persistStore(e);
  await e.pendingSave;
}

export function isStoreLoaded(): boolean {
  return entry("default").loaded;
}

export function flushDefaultStore(): Promise<void> {
  return entry("default").pendingSave;
}

export const store = {
  getItem: (key: string): string | null => storeGetSync(key),
  setItem: (key: string, value: string): void => storeSetSync(key, value),
  removeItem: (key: string): void => {
    const e = entry("default");
    e.cache.delete(key);
    e.pendingSave = e.pendingSave.then(() => persistStore(e)).catch(() => {});
  },
};

// ===== player store（data/player_settings.json）=====

export async function initPlayerStore(): Promise<void> {
  const e = entry("player");
  if (e.initPromise) return e.initPromise;
  e.initPromise = (async () => {
    try {
      const raw = await invoke<string | null>(e.loadCmd);
      if (raw) {
        deserializeToCache(e, raw);
        console.log("store", `initPlayerStore loaded ${e.cache.size} keys from disk`);
      } else {
        console.log("store", "initPlayerStore: player_settings.json not found, using defaults");
      }
      e.loaded = true;
    } catch (err) {
      console.warn("store", "initPlayerStore failed, memory-only", { error: String(err) });
      e.loaded = true;
    }
  })();
  return e.initPromise;
}

export function playerGetSync(key: string): string | null {
  return entry("player").cache.get(key) ?? null;
}

export async function playerSet(key: string, value: string): Promise<void> {
  const e = entry("player");
  e.cache.set(key, value);
  e.pendingSave = persistStore(e);
  await e.pendingSave;
}

export function playerSetSync(key: string, value: string): void {
  const e = entry("player");
  e.cache.set(key, value);
  e.pendingSave = e.pendingSave.then(() => persistStore(e)).catch(() => {});
}

export function flushPlayerStore(): Promise<void> {
  return entry("player").pendingSave;
}

export function isPlayerStoreLoaded(): boolean {
  return entry("player").loaded;
}
