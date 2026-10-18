/**
 * 网易云音乐 API 核心基础设施
 *
 * - API_BASE 常量
 * - cookie 读写（明文持久化）
 * - apiGet/apiPost 通用请求（自动解包 api-enhanced 的 data 层）
 * - 共享缓存状态（_cachedUser / _cachedPlaylists）
 *
 * 本模块仅作为 netease/ 子模块的内部依赖，不直接对外暴露。
 */
import { ref } from "vue";
import { log } from "@/composables/logger";
import type { NeteasePlaylist, NeteaseUser } from "@/types";
import { getStoredCookie, setStoredCookie, clearStoredCookie } from "@/composables/useCookie";

/** 网易云 API 基础地址（api-enhanced 服务） */
export const API_BASE = "https://musicapi.mingqwq.top";
/** 日志 tag */
export const TAG = "netease-api";

/**
 * Cookie 持久化：明文存储于 exe 所在目录 data/cookie/cookies.txt
 * （见 composables/useCookie.ts）。启动时由 App.vue 调用 initCookie() 载入到内存缓存。
 */

/** 读取本地保存的 cookie（同步，从内存缓存读取） */
export function getCookie(): string {
  return getStoredCookie();
}
/** 保存 cookie 到本地（同步更新缓存 + 异步落盘） */
export function setCookie(cookie: string): void {
  setStoredCookie(cookie);
}
/** 清除本地 cookie（退出登录） */
export function clearCookie(): void {
  clearStoredCookie();
}

/**
 * 基本参数清洗：去除 ASCII 控制字符（0x00-0x1F、0x7F）。
 * 防止参数值中出现换行/控制符导致请求头注入或 URL 异常。
 * 保留所有可见字符（含中文、空格等）。
 */
export function sanitizeParam(v: string): string {
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\x00-\x1F\x7F]/g, "");
}

/** 日志中隐藏凭据、验证码和用户输入内容，避免密码/Cookie 落盘。 */
function safeLogParams(params: Record<string, string | number | boolean>) {
  const sensitiveKeys = new Set(["password", "md5_password", "captcha", "cookie"]);
  return Object.fromEntries(Object.entries(params).map(([key, value]) => {
    if (sensitiveKeys.has(key)) return [key, "<redacted>"];
    if (key === "content") return [key, `<${String(value).length} chars>`];
    if (key === "phone" || key === "email") return [key, "<account>"];
    return [key, value];
  }));
}

/**
 * api-enhanced 常把业务数据包在 data 对象中。解包时保留顶层 code/message/cookie，
 * 否则调用方会把成功响应误判为失败（评论写操作尤其明显）。
 */
function normalizeResponse<T>(json: any, path: string, ms: number): T {
  handleAuthExpired(json);
  if (json && typeof json === "object" && !Array.isArray(json) &&
      "data" in json && json.data !== null && typeof json.data === "object" && !Array.isArray(json.data)) {
    const data = { ...json.data };
    for (const key of ["code", "cookie", "message", "msg", "dialog"]) {
      if (json[key] !== undefined && data[key] === undefined) data[key] = json[key];
    }
    log.info(TAG, `← ${path} ${ms}ms (unwrapped data)`, {
      code: data.code,
      topLevelKeys: Object.keys(json),
      dataKeys: Object.keys(data),
    });
    return data as T;
  }
  log.info(TAG, `← ${path} ${ms}ms (no unwrap)`, {
    code: json?.code,
    keys: json && typeof json === "object" ? Object.keys(json) : typeof json,
  });
  return json as T;
}

/**
 * 通用请求。自动拼接 cookie/timestamp/randomCNIP。
 * 自动解包 api-enhanced 的 data 层：
 *   api-enhanced 大部分接口返回 { code, data: {...} }，
 *   其中 data 是对象（非数组）时就解包返回 data。
 *   qr/check 返回 { code, message, cookie }（无 data），song/url 返回
 *   { code, data: [...] }（data 是数组），这两种不解包。
 */
export async function apiGet<T = any>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, sanitizeParam(String(v)));
  const cookie = getCookie();
  if (cookie) qs.set("cookie", sanitizeParam(cookie));
  qs.set("timestamp", String(Date.now()));
  qs.set("randomCNIP", "true");
  const url = `${API_BASE}${path}?${qs.toString()}`;
  const hasCookie = !!cookie;
  log.info(TAG, `→ GET ${path}`, { params: safeLogParams(params), hasCookie });
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    log.error(TAG, `✗ ${path} fetch failed`, { error: String(e) });
    throw e;
  }
  const ms = Date.now() - t0;
  if (!res.ok) {
    log.error(TAG, `✗ ${path} HTTP ${res.status}`, { ms });
    throw new Error(`API ${path} HTTP ${res.status}`);
  }
  const json = await res.json();
  return normalizeResponse<T>(json, path, ms);
}

/**
 * POST 请求（用于发送/删除评论等写操作）。
 * 参数放在请求体（form-urlencoded），cookie/timestamp 自动拼接。
 */
export async function apiPost<T = any>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.set(k, sanitizeParam(String(v)));
  const cookie = getCookie();
  if (cookie) body.set("cookie", sanitizeParam(cookie));
  body.set("timestamp", String(Date.now()));
  body.set("randomCNIP", "true");
  const url = `${API_BASE}${path}`;
  const hasCookie = !!cookie;
  log.info(TAG, `→ POST ${path}`, { params: safeLogParams(params), hasCookie });
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (e) {
    log.error(TAG, `✗ ${path} fetch failed`, { error: String(e) });
    throw e;
  }
  const ms = Date.now() - t0;
  if (!res.ok) {
    log.error(TAG, `✗ ${path} HTTP ${res.status}`, { ms });
    throw new Error(`API ${path} HTTP ${res.status}`);
  }
  const json = await res.json();
  return normalizeResponse<T>(json, path, ms);
}

// ===== 共享缓存状态（避免重复请求导致风控）=====

/** 缓存的用户信息 */
export const _cachedUser = ref<NeteaseUser | null>(null);
/** 缓存的歌单列表 */
export const _cachedPlaylists = ref<NeteasePlaylist[]>([]);
/** 歌单是否正在加载 */
export const _playlistsLoading = ref(false);

let lastAuthExpiredAt = 0;

/** 有 Cookie 却收到未登录业务码时，立即清理失效会话并通知 UI 重新登录。 */
function handleAuthExpired(json: any) {
  const codes = [Number(json?.code), Number(json?.data?.code)];
  if (!codes.some(code => code === 301 || code === 302) || !getCookie()) return;
  clearCookie();
  _cachedUser.value = null;
  _cachedPlaylists.value = [];
  _playlistsLoading.value = false;
  const now = Date.now();
  if (now - lastAuthExpiredAt < 1500) return;
  lastAuthExpiredAt = now;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("netease-auth-expired"));
}
