/**
 * useCookie — 本地 cookie 持久化（明文）
 *
 * 设计：
 *   - cookie 明文存于 exe 所在目录的 data/cookie/cookies.txt，随 exe 便携迁移。
 *   - 早期版本使用 AES-256-GCM 加密 + 系统凭据库存密钥，但该方案把 cookie 绑定到
 *     当前系统账户：换机 / 凭据丢失后无法解密、需要重新登录，且缺少 Secret Service
 *     的 Linux 环境会失败。现已移除加密，改为明文存储（Rust 端首次加载会自动清理
 *     遗留的 cookies.dat 加密文件）。
 *
 * 工作方式：
 *   - 启动时 initCookie() 读取历史 cookie 到内存缓存。
 *   - getStoredCookie() 同步读取内存缓存（供 apiGet/apiPost 拼接请求使用）。
 *   - setStoredCookie() 同步更新缓存 + 异步落盘（不阻塞 UI）。
 */
import { invoke } from "@tauri-apps/api/core";

/** 内存缓存：当前 cookie 字符串（登录后为网易云 cookie 串，未登录为空） */
let cookieCache = "";
/** 初始化 Promise（防止重复初始化） */
let initPromise: Promise<void> | null = null;
/** 是否正在执行落盘（用于关闭前 flush 等待） */
let pendingSave: Promise<void> = Promise.resolve();
/** 防止初始化慢请求覆盖登录期间刚写入的新 Cookie。 */
let cookieRevision = 0;

function queueSave(cookies: string, action: "save" | "clear") {
  pendingSave = pendingSave
    .catch(() => undefined)
    .then(() => invoke("save_cookies", { cookies }))
    .catch((error) => console.warn(`[cookie] ${action} failed:`, error))
    .then(() => undefined);
}

/**
 * 启动时调用：读取已保存的 cookie 到内存缓存。
 * 必须在发起任何网易云请求之前完成（否则 cookie 为空，请求按未登录处理）。
 */
export function initCookie(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const revisionAtStart = cookieRevision;
    try {
      const saved = await invoke<string | null>("load_cookies");
      if (saved && cookieRevision === revisionAtStart) cookieCache = saved;
    } catch (e) {
      // 非关键失败：降级为空 cookie（未登录态）
      console.warn("[cookie] init failed:", e);
    }
  })();
  return initPromise;
}

/** 同步读取内存中的 cookie（供 apiGet/apiPost 拼接请求头使用）。 */
export function getStoredCookie(): string {
  return cookieCache;
}

/**
 * 更新 cookie：同步刷新内存缓存 + 异步落盘。
 * @param cookie 完整的 cookie 字符串（登录成功时由 API 返回）
 */
export function setStoredCookie(cookie: string): void {
  cookieCache = cookie;
  cookieRevision += 1;
  queueSave(cookie, "save");
}

/** 清除 cookie（退出登录）：清空缓存 + 删除本地文件。 */
export function clearStoredCookie(): void {
  cookieCache = "";
  cookieRevision += 1;
  queueSave("", "clear");
}

/**
 * 等待所有挂起的 cookie 落盘完成。
 * 用于窗口关闭前确保写入已完成（onCloseRequested 中调用）。
 */
export function flushCookie(): Promise<void> {
  return pendingSave;
}
