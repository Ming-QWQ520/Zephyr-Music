/**
 * useSecureCookie — 加密 cookie 持久化
 *
 * 设计（与项目安全方案一致）：
 *   - cookie 存于 exe 所在目录的 data/cookie/cookies.dat，AES-256-GCM 加密。
 *   - 加密密钥为 32 字节随机数，存于系统凭据管理器（Windows Credential Manager
 *     / macOS Keychain / Linux Secret Service），由 Rust 端 keyring 管理。
 *   - 密钥不进入前端代码或磁盘明文，只有应用本身能取回。
 *   - 即使 cookies.dat 被复制到其他机器/账户，没有系统凭据也无法解密。
 *
 * 工作方式：
 *   - 启动时 initSecureCookie() 触发 Rust 生成/读取密钥，并解密加载历史 cookie 到内存缓存。
 *   - getSecureCookie() 同步读取内存缓存（供 apiGet/apiPost 拼接请求使用）。
 *   - setSecureCookie() 同步更新缓存 + 异步调用 Rust 加密落盘（不阻塞 UI）。
 *
 * 注意：tauri-plugin-store v2.4.3 的 StoreOptions 无 encrypt 选项，因此加密由
 * Rust 端 aes-gcm crate 直接完成，前端仅通过 invoke 调用，密钥不经前端中转。
 */
import { invoke } from "@tauri-apps/api/core";

/** 内存缓存：当前 cookie 字符串（登录后为网易云 cookie 串，未登录为空） */
let cookieCache = "";
/** 初始化 Promise（防止重复初始化） */
let initPromise: Promise<void> | null = null;
/** 是否正在执行落盘（用于关闭前 flush 等待） */
let pendingSave: Promise<void> = Promise.resolve();

/**
 * 启动时调用：准备系统凭据库密钥，并解密加载已保存的 cookie 到内存缓存。
 * 必须在发起任何网易云请求之前完成（否则 cookie 为空，请求按未登录处理）。
 */
export function initSecureCookie(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      // 触发 keyring 密钥生成/读取（Rust 端首次会生成并保存到系统凭据库）
      await invoke<string>("get_store_password");
      // 解密读取历史 cookie
      const json = await invoke<string | null>("load_cookies_decrypted");
      if (json) cookieCache = json;
    } catch (e) {
      // 非关键失败：降级为空 cookie（未登录态）
      console.warn("[secure-cookie] init failed:", e);
    }
  })();
  return initPromise;
}

/** 同步读取内存中的 cookie（供 apiGet/apiPost 拼接请求头使用）。 */
export function getSecureCookie(): string {
  return cookieCache;
}

/**
 * 更新 cookie：同步刷新内存缓存 + 异步加密落盘。
 * @param cookie 完整的 cookie 字符串（登录成功时由 API 返回）
 */
export function setSecureCookie(cookie: string): void {
  cookieCache = cookie;
  pendingSave = invoke("save_cookies_encrypted", { cookiesJson: cookie })
    .catch((e) => console.warn("[secure-cookie] save failed:", e))
    .then(() => undefined);
}

/** 清除 cookie（退出登录）：清空缓存 + 删除加密文件。 */
export function clearSecureCookie(): void {
  cookieCache = "";
  pendingSave = invoke("save_cookies_encrypted", { cookiesJson: "" })
    .catch((e) => console.warn("[secure-cookie] clear failed:", e))
    .then(() => undefined);
}

/**
 * 等待所有挂起的 cookie 落盘完成。
 * 用于窗口关闭前确保加密写入已完成（onCloseRequested 中调用）。
 */
export function flushSecureCookie(): Promise<void> {
  return pendingSave;
}
