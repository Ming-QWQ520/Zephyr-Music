/**
 * 网易云音乐 API 封装（适配 api-enhanced）
 *
 * api-enhanced 的返回格式与原版不同：
 *   原版:  { code: 200, playlist: [...] }
 *   enhanced: { code: 200, data: { code: 200, playlist: [...] } }
 *
 * 本模块的 apiGet 会自动解包 data 层，让上层代码不用关心差异。
 * Cookie 持久化到 localStorage，登录后所有请求自动带上 cookie。
 */

const API_BASE = "";
const COOKIE_KEY = "netease-cookie";

/** 读取本地保存的 cookie */
export function getCookie(): string {
  try { return localStorage.getItem(COOKIE_KEY) || ""; } catch { return ""; }
}
/** 保存 cookie 到本地 */
export function setCookie(cookie: string): void {
  try { localStorage.setItem(COOKIE_KEY, cookie); } catch { /* ignore */ }
}
/** 清除本地 cookie（退出登录） */
export function clearCookie(): void {
  try { localStorage.removeItem(COOKIE_KEY); } catch { /* ignore */ }
}
function encodeCookie(): string {
  // URLSearchParams.set() already URL-encodes the value, so we must NOT
  // pre-encode with encodeURIComponent — that would cause double encoding
  // (e.g. = → %3D → %253D).
  return getCookie();
}

/**
 * 通用请求。自动拼接 cookie/timestamp/randomCNIP。
 * 自动解包 api-enhanced 的 data 层：
 *   api-enhanced 大部分接口返回 { code, data: {...} }，
 *   其中 data 是对象（非数组）时就解包返回 data。
 *   qr/check 返回 { code, message, cookie }（无 data），song/url 返回
 *   { code, data: [...] }（data 是数组），这两种不解包。
 */
async function apiGet<T = any>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const cookie = encodeCookie();
  if (cookie) qs.set("cookie", cookie);
  qs.set("timestamp", String(Date.now()));
  qs.set("randomCNIP", "true");
  const url = `${API_BASE}${path}?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${path} HTTP ${res.status}`);
  const json = await res.json();
  // 解包：如果顶层有 data 字段，且 data 是纯对象（非数组、非 null），就返回 data。
  // 把顶层的 cookie 带到解包结果里（qr/check 不走这里，但以防万一）。
  if (json && typeof json === "object" && !Array.isArray(json) &&
      "data" in json && json.data !== null && typeof json.data === "object" && !Array.isArray(json.data)) {
    if (json.cookie && !(json.data as any).cookie) (json.data as any).cookie = json.cookie;
    return json.data as T;
  }
  return json as T;
}

// ===== 登录相关 =====

/** 生成二维码 key */
export async function qrKey(): Promise<{ code: number; unikey: string }> {
  return apiGet("/login/qr/key");
}

/** 生成二维码图片（base64） */
export async function qrCreate(key: string): Promise<{
  code: number;
  qrimg: string;
  qrurl?: string;
  qrcode?: string;
}> {
  return apiGet("/login/qr/create", { key, qrimg: "true" });
}

/** 检测二维码扫码状态
 *  800=过期 801=等待扫码 802=待确认 803=授权成功(返回cookie) */
export async function qrCheck(key: string): Promise<{
  code: number;
  message: string;
  cookie?: string;
}> {
  return apiGet("/login/qr/check", { key });
}

/** 登录状态 — 返回 profile（已登录）或 null（未登录） */
export async function loginStatus(): Promise<{
  code: number;
  account: any;
  profile: any;
}> {
  return apiGet("/login/status");
}

/** 账号信息（获取 uid） */
export async function userAccount(): Promise<{
  code: number;
  account?: any;
  profile?: { userId: number; nickname: string; avatarUrl: string };
}> {
  return apiGet("/user/account");
}

/** 退出登录 */
export async function logout(): Promise<{ code: number }> {
  const r = await apiGet("/logout");
  clearCookie();
  return r;
}

// ===== 歌单相关 =====

export interface NeteasePlaylist {
  id: number;
  name: string;
  coverImgUrl: string;
  trackCount: number;
  playCount?: number;
  creator?: { nickname: string };
}

/** 用户歌单列表 */
export async function userPlaylist(uid: number, limit = 100): Promise<{
  code: number;
  playlist: NeteasePlaylist[];
}> {
  return apiGet("/user/playlist", { uid, limit });
}

/** 歌单全部歌曲 */
export async function playlistTrackAll(playlistId: number, limit = 300, offset = 0): Promise<{
  code: number;
  songs: NeteaseSong[];
}> {
  return apiGet("/playlist/track/all", { id: playlistId, limit, offset });
}

/** 每日推荐歌曲（需登录） */
export async function recommendSongs(): Promise<{
  code: number;
  data: { dailySongs: NeteaseSong[] };
}> {
  // recommend/songs 的返回格式特殊：data 里有 dailySongs
  // apiGet 会解包一层 data，但 dailySongs 还在 data 里
  const r = await apiGet<{ code: number; data?: { dailySongs: NeteaseSong[] }; dailySongs?: NeteaseSong[] }>("/recommend/songs");
  // 兼容两种格式
  if (r.dailySongs) return { code: r.code, data: { dailySongs: r.dailySongs } };
  if (r.data?.dailySongs) return { code: r.code, data: { dailySongs: r.data.dailySongs } };
  return { code: r.code, data: { dailySongs: [] } };
}

// ===== 歌曲相关 =====

export interface NeteaseSong {
  id: number;
  name: string;
  ar?: { id: number; name: string }[];
  artists?: { id: number; name: string }[];
  al?: { id: number; name: string; picUrl: string };
  album?: { id: number; name: string; picUrl: string };
  dt?: number;
  duration?: number;
}

/** 获取音乐 URL */
export async function songUrl(id: number): Promise<{
  code: number;
  data: { id: number; url: string; br: number; size: number }[];
}> {
  return apiGet("/song/url", { id });
}

/** 获取音乐 URL v1（指定音质，api-enhanced 支持 unblock 解锁灰色歌曲） */
export async function songUrlV1(id: number, level = "exhigh"): Promise<{
  code: number;
  data: { id: number; url: string; br: number; size: number }[];
}> {
  return apiGet("/song/url/v1", { id, level, unblock: "true" });
}

/** 歌曲详情 */
export async function songDetail(ids: number[]): Promise<{
  code: number;
  songs: NeteaseSong[];
}> {
  return apiGet("/song/detail", { ids: ids.join(",") });
}

/** 获取歌词 */
export async function lyric(id: number): Promise<{
  code: number;
  lrc?: { lyric: string };
  tlyric?: { lyric: string };
}> {
  return apiGet("/lyric", { id });
}

// ===== 工具函数 =====

/** 把网易云歌曲对象转成播放器内部的 Song 格式 */
export function neteaseSongToSong(s: NeteaseSong): import("@/types").Song {
  const artists = s.ar || s.artists || [];
  const album = s.al || s.album;
  const durationSec = ((s.dt || s.duration || 0) / 1000);
  return {
    id: `ne_${s.id}`,
    name: s.name,
    artist: artists.map((a) => a.name).join(", ") || "未知艺术家",
    pic: album?.picUrl || "",
    url: "",
    lrc: "",
    duration: durationSec,
    source: "netease",
    neteaseId: s.id,
  } as any;
}
