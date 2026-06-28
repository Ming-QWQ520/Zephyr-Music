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

import { log } from "@/composables/logger";

// 请填写实际的网易云音乐 API 地址（自建或部署的 api-enhanced 服务）
const API_BASE = "https://musicapi.mingqwq.top";
const COOKIE_KEY = "netease-cookie";
const TAG = "netease-api";

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

/** 安全地截断长字符串用于日志输出 */
function truncateForLog(obj: any, maxLen = 500): string {
  try {
    const s = typeof obj === "string" ? obj : JSON.stringify(obj);
    if (!s) return String(s);
    return s.length > maxLen ? s.slice(0, maxLen) + `...(truncated, total ${s.length} chars)` : s;
  } catch { return String(obj); }
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
  // 解包：如果顶层有 data 字段，且 data 是纯对象（非数组、非 null），就返回 data。
  // 把顶层的 cookie 带到解包结果里（qr/check 不走这里，但以防万一）。
  let unwrapped = false;
  if (json && typeof json === "object" && !Array.isArray(json) &&
      "data" in json && json.data !== null && typeof json.data === "object" && !Array.isArray(json.data)) {
    if (json.cookie && !(json.data as any).cookie) (json.data as any).cookie = json.cookie;
    unwrapped = true;
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

// ===== 登录相关 =====

/** 生成二维码 key */
export async function qrKey(): Promise<{ code: number; unikey: string }> {
  log.info(TAG, "qrKey()");
  const r = await apiGet("/login/qr/key");
  log.info(TAG, "qrKey result", { code: r.code, hasUnikey: !!r.unikey });
  return r;
}

/** 生成二维码图片（base64） */
export async function qrCreate(key: string): Promise<{
  code: number;
  qrimg: string;
  qrurl?: string;
  qrcode?: string;
}> {
  log.info(TAG, "qrCreate()", { key });
  const r = await apiGet("/login/qr/create", { key, qrimg: "true" });
  log.info(TAG, "qrCreate result", { code: r.code, hasQrimg: !!r.qrimg });
  return r;
}

/** 检测二维码扫码状态
 *  800=过期 801=等待扫码 802=待确认 803=授权成功(返回cookie) */
export async function qrCheck(key: string): Promise<{
  code: number;
  message: string;
  cookie?: string;
}> {
  const r = await apiGet("/login/qr/check", { key });
  log.info(TAG, "qrCheck", { key, code: r.code, message: r.message, hasCookie: !!r.cookie });
  return r;
}

/** 登录状态 — 返回 profile（已登录）或 null（未登录） */
export async function loginStatus(): Promise<{
  code: number;
  account: any;
  profile: any;
}> {
  log.info(TAG, "loginStatus()");
  const r = await apiGet("/login/status");
  log.info(TAG, "loginStatus result", {
    code: r.code,
    hasProfile: !!r.profile,
    userId: r.profile?.userId,
    nickname: r.profile?.nickname,
  });
  return r;
}

/** 账号信息（获取 uid） */
export async function userAccount(): Promise<{
  code: number;
  account?: any;
  profile?: { userId: number; nickname: string; avatarUrl: string };
}> {
  log.info(TAG, "userAccount()");
  const r = await apiGet("/user/account");
  log.info(TAG, "userAccount result", { code: r.code, userId: r.profile?.userId });
  return r;
}

/** 退出登录 */
export async function logout(): Promise<{ code: number }> {
  log.info(TAG, "logout()");
  const r = await apiGet("/logout");
  clearCookie();
  // 清除缓存的用户信息
  _cachedUser.value = null;
  _cachedPlaylists.value = [];
  _playlistsLoading.value = false;
  clearLikeCache();
  log.info(TAG, "logout done, cookie cleared");
  return r;
}

// ===== 共享状态（缓存，避免重复请求导致风控）=====
import { ref } from "vue";

/** 缓存的用户信息（loginStatus 结果中的 profile + account） */
export const _cachedUser = ref<{ userId: number; nickname: string; avatarUrl: string } | null>(null);
/** 缓存的歌单列表 */
export const _cachedPlaylists = ref<NeteasePlaylist[]>([]);
/** 歌单是否正在加载 */
export const _playlistsLoading = ref(false);

/**
 * 获取用户信息（带缓存）。登录后调用一次，后续直接返回缓存。
 * 避免频繁调用 loginStatus 导致风控。
 */
export async function getCachedUser(): Promise<{ userId: number; nickname: string; avatarUrl: string } | null> {
  if (_cachedUser.value) {
    log.info(TAG, "getCachedUser (cache hit)", { userId: _cachedUser.value.userId });
    return _cachedUser.value;
  }
  if (!getCookie()) {
    log.info(TAG, "getCachedUser: no cookie, returning null");
    return null;
  }
  try {
    const res = await loginStatus();
    if (res.profile) {
      _cachedUser.value = {
        userId: res.profile.userId || (res.account?.id as number),
        nickname: res.profile.nickname || "网易云用户",
        avatarUrl: res.profile.avatarUrl || "",
      };
      log.info(TAG, "getCachedUser (fetched)", { userId: _cachedUser.value.userId, nickname: _cachedUser.value.nickname });
      return _cachedUser.value;
    }
    log.warn(TAG, "getCachedUser: no profile in response", { code: res.code });
  } catch (e) {
    log.warn(TAG, "getCachedUser error", { error: String(e) });
  }
  return null;
}

/**
 * 获取用户歌单（带缓存）。登录后调用一次，后续直接返回缓存。
 * 避免频繁调用 userPlaylist 导致风控（503/460）。
 */
export async function getCachedPlaylists(): Promise<NeteasePlaylist[]> {
  if (_cachedPlaylists.value.length > 0) {
    log.info(TAG, "getCachedPlaylists (cache hit)", { count: _cachedPlaylists.value.length });
    return _cachedPlaylists.value;
  }
  if (_playlistsLoading.value) {
    // 等待正在进行的请求完成
    log.info(TAG, "getCachedPlaylists: waiting for in-flight request");
    while (_playlistsLoading.value) await new Promise(r => setTimeout(r, 100));
    return _cachedPlaylists.value;
  }
  const user = await getCachedUser();
  if (!user) {
    log.info(TAG, "getCachedPlaylists: no user, returning []");
    return [];
  }
  _playlistsLoading.value = true;
  try {
    const res = await userPlaylist(user.userId);
    _cachedPlaylists.value = res.playlist || [];
    log.info(TAG, "getCachedPlaylists (fetched)", { count: _cachedPlaylists.value.length });
  } catch (e) {
    log.warn(TAG, "getCachedPlaylists error", { error: String(e) });
    _cachedPlaylists.value = [];
  }
  _playlistsLoading.value = false;
  return _cachedPlaylists.value;
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
  log.info(TAG, "userPlaylist()", { uid, limit });
  const r = await apiGet("/user/playlist", { uid, limit });
  log.info(TAG, "userPlaylist result", { code: r.code, count: r.playlist?.length || 0 });
  return r;
}

/** 歌单全部歌曲 */
export async function playlistTrackAll(playlistId: number, limit = 300, offset = 0): Promise<{
  code: number;
  songs: NeteaseSong[];
}> {
  log.info(TAG, "playlistTrackAll()", { playlistId, limit, offset });
  const r = await apiGet("/playlist/track/all", { id: playlistId, limit, offset });
  log.info(TAG, "playlistTrackAll result", { code: r.code, count: r.songs?.length || 0 });
  return r;
}

/** 添加/删除歌曲到歌单
 *  op: "add" 添加 / "del" 删除
 *  pid: 歌单 ID
 *  tracks: 歌曲 ID（多个用逗号分隔）
 */
export async function playlistTracks(op: "add" | "del", pid: number, tracks: number | string): Promise<{
  code: number;
  status?: number;
  body?: { code?: number };
}> {
  log.info(TAG, "playlistTracks()", { op, pid, tracks });
  const r = await apiGet("/playlist/tracks", { op, pid, tracks });
  log.info(TAG, "playlistTracks result", { op, pid, code: r.code });
  return r;
}

/** 每日推荐歌曲（需登录） */
export async function recommendSongs(): Promise<{
  code: number;
  data: { dailySongs: NeteaseSong[] };
}> {
  log.info(TAG, "recommendSongs()");
  // recommend/songs 的返回格式特殊：data 里有 dailySongs
  // apiGet 会解包一层 data，但 dailySongs 还在 data 里
  const r = await apiGet<{ code: number; data?: { dailySongs: NeteaseSong[] }; dailySongs?: NeteaseSong[] }>("/recommend/songs");
  // 兼容两种格式
  if (r.dailySongs) {
    log.info(TAG, "recommendSongs result (top-level dailySongs)", { code: r.code, count: r.dailySongs.length });
    return { code: r.code, data: { dailySongs: r.dailySongs } };
  }
  if (r.data?.dailySongs) {
    log.info(TAG, "recommendSongs result (nested data.dailySongs)", { code: r.code, count: r.data.dailySongs.length });
    return { code: r.code, data: { dailySongs: r.data.dailySongs } };
  }
  log.warn(TAG, "recommendSongs: no dailySongs found", { code: r.code, keys: Object.keys(r) });
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
  log.info(TAG, "songUrl()", { id });
  const r = await apiGet("/song/url", { id });
  log.info(TAG, "songUrl result", { code: r.code, count: r.data?.length || 0, hasUrl: !!r.data?.[0]?.url });
  return r;
}

/** 获取音乐 URL v1（指定音质，api-enhanced 支持 unblock 解锁灰色歌曲）
 *  level 音质等级：
 *    standard 标准 / higher 较高 / exhigh 极高 / lossless 无损 / hires Hi-Res
 *    jyeffect 高清环绕声 / sky 沉浸环绕声 / dolby 杜比全景声 / jymaster 超清母带
 *  注：杜比全景声需要传入 os=pc 才能返回正常码率 url
 */
export async function songUrlV1(id: number, level = "exhigh"): Promise<{
  code: number;
  data: { id: number; url: string; br: number; size: number }[];
}> {
  const params: Record<string, string | number | boolean> = { id, level, unblock: "true" };
  // 杜比全景声需要 os=pc
  if (level === "dolby") params.os = "pc";
  log.info(TAG, "songUrlV1()", { id, level });
  const r = await apiGet("/song/url/v1", params);
  log.info(TAG, "songUrlV1 result", {
    code: r.code, count: r.data?.length || 0,
    hasUrl: !!r.data?.[0]?.url,
    br: r.data?.[0]?.br,
  });
  return r;
}

/** 歌曲详情 */
export async function songDetail(ids: number[]): Promise<{
  code: number;
  songs: NeteaseSong[];
}> {
  log.info(TAG, "songDetail()", { ids });
  const r = await apiGet("/song/detail", { ids: ids.join(",") });
  log.info(TAG, "songDetail result", { code: r.code, count: r.songs?.length || 0 });
  return r;
}

/** 获取歌词 */
export async function lyric(id: number): Promise<{
  code: number;
  lrc?: { lyric: string };
  tlyric?: { lyric: string };
}> {
  log.info(TAG, "lyric()", { id });
  const r = await apiGet("/lyric", { id });
  log.info(TAG, "lyric result", {
    code: r.code, hasLrc: !!r.lrc?.lyric, hasTlyric: !!r.tlyric?.lyric,
    lrcLen: r.lrc?.lyric?.length || 0, tlyricLen: r.tlyric?.lyric?.length || 0,
  });
  return r;
}

/** 获取逐字歌词（/lyric/new）
 *  返回的 yrc 字段为逐字歌词格式，romalrc 为罗马音歌词
 */
export async function lyricNew(id: number): Promise<{
  code: number;
  lrc?: { lyric: string };
  tlyric?: { lyric: string };
  yrc?: { lyric: string; version?: string };
  romalrc?: { lyric: string };
}> {
  log.info(TAG, "lyricNew()", { id });
  const r = await apiGet("/lyric/new", { id });
  log.info(TAG, "lyricNew result", {
    code: r.code,
    hasLrc: !!r.lrc?.lyric, hasTlyric: !!r.tlyric?.lyric,
    hasYrc: !!r.yrc?.lyric, hasRomalrc: !!r.romalrc?.lyric,
    lrcLen: r.lrc?.lyric?.length || 0, tlyricLen: r.tlyric?.lyric?.length || 0,
    yrcLen: r.yrc?.lyric?.length || 0,
  });
  return r;
}

/** 解析逐字歌词 yrc 格式为 LyricLine[]
 *  yrc 格式: [行开始ms,行总时长ms](字开始ms,字时长ms,0)字(字开始ms,字时长ms,0)字...
 *  我们将其转换为标准的 { time, text } 格式（每行一个条目）
 */
export function parseYrc(yrcText: string): import("@/types").LyricLine[] {
  const lines: import("@/types").LyricLine[] = [];
  for (const raw of yrcText.split("\n")) {
    const m = raw.match(/^\[(\d+),(\d+)\]/);
    if (!m) continue;
    const startTime = parseInt(m[1]) / 1000; // ms → s
    // 提取文字内容：移除 [时间] 和 (时间) 标记
    const text = raw.replace(/^\[\d+,\d+\]/, "").replace(/\(\d+,\d+,\d+\)/g, "").trim();
    if (!text) continue;
    lines.push({ time: startTime, text });
  }
  return lines.sort((a, b) => a.time - b.time);
}

// ===== 听歌打卡 =====

/** 听歌打卡（/scrobble 接口）
 *  id: 歌曲 ID（必选）
 *  sourceid: 歌单或专辑 ID（必选）
 *  time: 歌曲播放时间，单位为秒（可选）
 *  调用例子: /scrobble?id=518066366&sourceid=36780169&time=291
 */
export async function scrobble(
  id: number, sourceid: number, time?: number
): Promise<{ code: number }> {
  const params: Record<string, string | number> = { id, sourceid };
  if (time !== undefined && time >= 0) params.time = time;
  log.info(TAG, "scrobble()", { id, sourceid, time });
  const r = await apiGet("/scrobble", params);
  log.info(TAG, "scrobble result", { id, sourceid, code: r.code });
  return r;
}

/** 获取用户播放记录（最近播放-歌曲，/record/recent/song）
 *  limit: 返回数量，默认 300，最大 300
 */
export async function recordRecentSong(limit = 300): Promise<{
  code: number;
  data?: { playCount: number; song: NeteaseSong }[];
  list?: { playCount: number; song: NeteaseSong }[];
}> {
  log.info(TAG, "recordRecentSong()", { limit });
  const r = await apiGet("/record/recent/song", { limit });
  const records = r.data || r.list || [];
  log.info(TAG, "recordRecentSong result", {
    code: r.code, count: records.length,
    field: r.data ? "data" : r.list ? "list" : "none",
  });
  return r;
}

/** 获取用户播放记录（旧版 /user/record，保留作为回退）
 *  type=1: weekData (本周), type=0: allData (全部)
 */
export async function userRecord(uid: number, type: 0 | 1 = 1): Promise<{
  code: number;
  weekData?: { playCount: number; song: NeteaseSong }[];
  allData?: { playCount: number; song: NeteaseSong }[];
}> {
  log.info(TAG, "userRecord()", { uid, type });
  const r = await apiGet("/user/record", { uid, type });
  log.info(TAG, "userRecord result", {
    code: r.code,
    weekDataCount: r.weekData?.length || 0,
    allDataCount: r.allData?.length || 0,
    keys: typeof r === "object" && r ? Object.keys(r) : typeof r,
    weekDataFirst: r.weekData?.[0] ? { playCount: r.weekData[0].playCount, songId: r.weekData[0].song?.id, songName: r.weekData[0].song?.name } : null,
    preview: truncateForLog(r, 600),
  });
  return r;
}

/** 歌单更新播放量 */
export async function playlistUpdatePlaycount(id: number): Promise<{ code: number }> {
  return apiGet("/playlist/update/playcount", { id });
}

/** 音质等级
 *  standard 标准 / higher 较高 / exhigh 极高 / lossless 无损 / hires Hi-Res
 *  jyeffect 高清环绕声 / sky 沉浸环绕声 / dolby 杜比全景声 / jymaster 超清母带
 */
export type AudioLevel = "standard" | "higher" | "exhigh" | "lossless" | "hires" | "jyeffect" | "sky" | "dolby" | "jymaster";

// ===== 搜索 =====

/** 搜索歌曲（网易云 API）
 *  keywords: 关键词, limit: 返回数量, offset: 偏移
 */
export async function searchSongs(keywords: string, limit = 30, offset = 0): Promise<{
  code: number;
  result?: { songs: NeteaseSong[]; songCount: number };
}> {
  log.info(TAG, "searchSongs()", { keywords, limit, offset });
  const r = await apiGet("/search", { keywords, limit, offset });
  log.info(TAG, "searchSongs result", {
    code: r.code, count: r.result?.songs?.length || 0, songCount: r.result?.songCount,
  });
  return r;
}

// ===== 喜欢/收藏 =====

/** 喜欢歌曲（旧版 /like）
 *  id: 歌曲 ID, like: true 喜欢 / false 取消喜欢
 */
export async function likeSong(id: number, like = true): Promise<{ code: number }> {
  log.info(TAG, "likeSong()", { id, like });
  const r = await apiGet("/like", { id, like: like ? "true" : "false" });
  log.info(TAG, "likeSong result", { id, like, code: r.code });
  return r;
}

/** 喜欢歌曲 - 新版（/song/like）
 *  id: 歌曲 ID, uid: 用户 ID, like: true/false
 */
export async function songLike(id: number, uid: number, like = true): Promise<{ code: number }> {
  log.info(TAG, "songLike()", { id, uid, like });
  const r = await apiGet("/song/like", { id, uid, like: like ? "true" : "false" });
  log.info(TAG, "songLike result", { id, uid, like, code: r.code });
  return r;
}

/** 获取喜欢音乐列表（ID 数组） */
export async function likeList(uid: number): Promise<{ code: number; ids: number[] }> {
  log.info(TAG, "likeList()", { uid });
  const r = await apiGet("/likelist", { uid });
  log.info(TAG, "likeList result", { uid, code: r.code, count: r.ids?.length || 0 });
  return r;
}

// ===== 喜欢列表缓存 =====
/** 缓存的喜欢歌曲 ID 集合（Set 方便 O(1) 查询） */
const _cachedLikeSet = ref<Set<number> | null>(null);
/** 喜欢列表是否正在加载 */
const _likeListLoading = ref(false);

/** 刷新喜欢列表缓存（从服务器拉取最新） */
export async function refreshLikeList(uid: number): Promise<Set<number>> {
  if (_likeListLoading.value) {
    log.info(TAG, "refreshLikeList: waiting for in-flight request", { uid });
    while (_likeListLoading.value) await new Promise(r => setTimeout(r, 100));
    return _cachedLikeSet.value || new Set();
  }
  _likeListLoading.value = true;
  try {
    const res = await likeList(uid);
    _cachedLikeSet.value = new Set(res.ids || []);
    log.info(TAG, "refreshLikeList done", { uid, count: _cachedLikeSet.value.size });
  } catch (e) {
    log.warn(TAG, "refreshLikeList error", { uid, error: String(e) });
    _cachedLikeSet.value = new Set();
  }
  _likeListLoading.value = false;
  return _cachedLikeSet.value;
}

/** 获取缓存的喜欢列表（如果未缓存则自动加载） */
export async function getCachedLikeList(): Promise<Set<number>> {
  if (_cachedLikeSet.value) {
    log.info(TAG, "getCachedLikeList (cache hit)", { count: _cachedLikeSet.value.size });
    return _cachedLikeSet.value;
  }
  const user = await getCachedUser();
  if (!user) {
    log.info(TAG, "getCachedLikeList: no user, returning empty set");
    return new Set();
  }
  return refreshLikeList(user.userId);
}

/** 添加到喜欢缓存（喜欢歌曲后调用） */
export function addLikeCache(songId: number): void {
  if (_cachedLikeSet.value) {
    _cachedLikeSet.value.add(songId);
    log.info(TAG, "addLikeCache", { songId, total: _cachedLikeSet.value.size });
  }
}

/** 从喜欢缓存移除（取消喜欢后调用） */
export function removeLikeCache(songId: number): void {
  if (_cachedLikeSet.value) {
    _cachedLikeSet.value.delete(songId);
    log.info(TAG, "removeLikeCache", { songId, total: _cachedLikeSet.value.size });
  }
}

/** 清除喜欢缓存（退出登录时调用） */
export function clearLikeCache(): void {
  _cachedLikeSet.value = null;
  log.info(TAG, "clearLikeCache");
}

/** 检查歌曲是否已喜欢（/song/like/check）
 *  ids: 歌曲 ID 数组
 */
export async function songLikeCheck(ids: number[]): Promise<{
  code: number;
  data?: { songId: number; like: boolean }[];
}> {
  log.info(TAG, "songLikeCheck()", { ids });
  const r = await apiGet("/song/like/check", { ids: JSON.stringify(ids) });
  log.info(TAG, "songLikeCheck result", { code: r.code, count: r.data?.length || 0 });
  return r;
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
