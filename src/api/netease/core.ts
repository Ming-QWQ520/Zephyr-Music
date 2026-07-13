/**
 * 网易云音乐 API 核心基础设施
 *
 * - API_BASE / COOKIE_KEY 常量
 * - cookie 读写
 * - apiGet/apiPost 通用请求（自动解包 api-enhanced 的 data 层）
 * - 共享缓存状态（_cachedUser / _cachedPlaylists）
 *
 * 本模块仅作为 netease/ 子模块的内部依赖，不直接对外暴露。
 */
import { ref } from "vue";
import { log } from "@/composables/logger";
import { truncateForLog } from "@/utils/format";
import type { NeteasePlaylist, NeteaseUser } from "@/types";
import { storeGetSync, storeSetSync } from "@/composables/useStore";

/** 网易云 API 基础地址（api-enhanced 服务） */
export const API_BASE = "https://musicapi.mingqwq.top";
/** store 中存储 cookie 的 key */
export const COOKIE_KEY = "netease-cookie";
/** 日志 tag */
export const TAG = "netease-api";

/** 读取本地保存的 cookie */
export function getCookie(): string {
  try { return storeGetSync(COOKIE_KEY) || ""; } catch { return ""; }
}
/** 保存 cookie 到本地 */
export function setCookie(cookie: string): void {
  try { storeSetSync(COOKIE_KEY, cookie); } catch { /* ignore */ }
}
/** 清除本地 cookie（退出登录） */
export function clearCookie(): void {
  try { storeSetSync(COOKIE_KEY, ""); } catch { /* ignore */ }
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
  log.info(TAG, `→ GET ${path}`, { params, hasCookie });
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
  if (json && typeof json === "object" && !Array.isArray(json) &&
      "data" in json && json.data !== null && typeof json.data === "object" && !Array.isArray(json.data)) {
    if (json.cookie && !(json.data as any).cookie) (json.data as any).cookie = json.cookie;
    log.info(TAG, `← ${path} ${ms}ms (unwrapped data)`, {
      code: json.code,
      topLevelKeys: Object.keys(json),
      dataKeys: Object.keys(json.data || {}),
      preview: truncateForLog(json.data, 400),
    });
    return json.data as T;
  }
  log.info(TAG, `← ${path} ${ms}ms (no unwrap)`, {
    code: json?.code,
    keys: json && typeof json === "object" ? Object.keys(json) : typeof json,
    preview: truncateForLog(json, 400),
  });
  return json as T;
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
  log.info(TAG, `→ POST ${path}`, { params, hasCookie });
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
  if (json && typeof json === "object" && !Array.isArray(json) &&
      "data" in json && json.data !== null && typeof json.data === "object" && !Array.isArray(json.data)) {
    if (json.cookie && !(json.data as any).cookie) (json.data as any).cookie = json.cookie;
    log.info(TAG, `← ${path} ${ms}ms (unwrapped data)`, {
      code: json.code,
      topLevelKeys: Object.keys(json),
      dataKeys: Object.keys(json.data || {}),
      preview: truncateForLog(json.data, 400),
    });
    return json.data as T;
  }
  log.info(TAG, `← ${path} ${ms}ms (no unwrap)`, {
    code: json?.code,
    keys: json && typeof json === "object" ? Object.keys(json) : typeof json,
    preview: truncateForLog(json, 400),
  });
  return json as T;
}

// ===== 共享缓存状态（避免重复请求导致风控）=====

/** 缓存的用户信息 */
export const _cachedUser = ref<NeteaseUser | null>(null);
/** 缓存的歌单列表 */
export const _cachedPlaylists = ref<NeteasePlaylist[]>([]);
/** 歌单是否正在加载 */
export const _playlistsLoading = ref(false);
