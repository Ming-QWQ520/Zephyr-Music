/** 网易云歌单相关 API */
import { log } from "@/composables/logger";
import { apiGet, TAG, _cachedUser, _cachedPlaylists, _playlistsLoading } from "./core";
import { loginStatus } from "./auth";
import { getCookie } from "./core";
import type { NeteasePlaylist, NeteaseSong, NeteaseUser } from "@/types";

/** 用户歌单列表 */
export async function userPlaylist(uid: number, limit = 100): Promise<{
  code: number; playlist: NeteasePlaylist[];
}> {
  log.info(TAG, "userPlaylist()", { uid, limit });
  const r = await apiGet("/user/playlist", { uid, limit });
  log.info(TAG, "userPlaylist result", { code: r.code, count: r.playlist?.length || 0 });
  return r;
}

/** 歌单全部歌曲 */
export async function playlistTrackAll(playlistId: number, limit = 300, offset = 0): Promise<{
  code: number; songs: NeteaseSong[];
}> {
  log.info(TAG, "playlistTrackAll()", { playlistId, limit, offset });
  const r = await apiGet("/playlist/track/all", { id: playlistId, limit, offset });
  log.info(TAG, "playlistTrackAll result", { code: r.code, count: r.songs?.length || 0 });
  return r;
}

/** 添加/删除歌曲到歌单 */
export async function playlistTracks(op: "add" | "del", pid: number, tracks: number | string): Promise<{
  code: number; status?: number; body?: { code?: number };
}> {
  log.info(TAG, "playlistTracks()", { op, pid, tracks });
  const r = await apiGet("/playlist/tracks", { op, pid, tracks, timestamp: Date.now() });
  log.info(TAG, "playlistTracks result", { op, pid, code: r.code, status: r.status, bodyCode: r.body?.code });
  return r;
}

/** 每日推荐歌曲（需登录） */
export async function recommendSongs(): Promise<{
  code: number; data: { dailySongs: NeteaseSong[] };
}> {
  log.info(TAG, "recommendSongs()");
  const r = await apiGet<{ code: number; data?: { dailySongs: NeteaseSong[] }; dailySongs?: NeteaseSong[] }>("/recommend/songs");
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

/** 每日推荐歌单（/recommend/resource，需要登录） */
export async function recommendResource(): Promise<{
  code: number; recommend?: NeteasePlaylist[]; data?: NeteasePlaylist[];
}> {
  log.info(TAG, "recommendResource()");
  const r = await apiGet("/recommend/resource");
  const list = r.recommend || r.data || [];
  log.info(TAG, "recommendResource result", { code: r.code, count: list.length });
  return r;
}

/** 歌单详情（/playlist/detail） */
export async function playlistDetail(id: number, s = 8): Promise<{
  code: number;
  playlist?: NeteasePlaylist & {
    trackCount?: number; playCount?: number; tracks?: NeteaseSong[];
    trackIds?: { id: number }[]; creator?: { nickname: string };
    description?: string; tags?: string[];
  };
  privileges?: any[];
}> {
  log.info(TAG, "playlistDetail()", { id, s });
  const r = await apiGet("/playlist/detail", { id, s });
  log.info(TAG, "playlistDetail result", { code: r.code, playlistName: r.playlist?.name, trackCount: r.playlist?.trackCount });
  return r;
}

/** 歌单详情动态（/playlist/detail/dynamic） */
export async function playlistDetailDynamic(id: number): Promise<{
  code: number; commentCount?: number; shareCount?: number; playCount?: number; bookedCount?: number; subscribed?: boolean;
}> {
  log.info(TAG, "playlistDetailDynamic()", { id });
  const r = await apiGet("/playlist/detail/dynamic", { id });
  log.info(TAG, "playlistDetailDynamic result", { code: r.code, commentCount: r.commentCount, playCount: r.playCount });
  return r;
}

/** 歌单更新播放量 */
export async function playlistUpdatePlaycount(id: number): Promise<{ code: number }> {
  return apiGet("/playlist/update/playcount", { id });
}

// ===== 带缓存的用户/歌单获取（避免风控）=====

/** 歌单请求的共享 Promise（用于避免并发重复请求，替代 while 轮询） */
let _playlistsPromise: Promise<NeteasePlaylist[]> | null = null;

/** 获取用户信息（带缓存） */
export async function getCachedUser(): Promise<NeteaseUser | null> {
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
      const p = res.profile;
      _cachedUser.value = {
        userId: p.userId || (res.account?.id as number),
        nickname: p.nickname || "网易云用户",
        avatarUrl: p.avatarUrl || "",
        // 直接从 loginStatus 的 profile 提取完整资料，避免等 userDetail 补全
        signature: p.signature || "",
        createTime: p.createTime,
        gender: p.gender,
        city: p.city,
        province: p.province,
        backgroundUrl: p.backgroundUrl || "",
      };
      log.info(TAG, "getCachedUser (fetched)", { userId: _cachedUser.value.userId, nickname: _cachedUser.value.nickname, hasBg: !!_cachedUser.value.backgroundUrl });
      return _cachedUser.value;
    }
    log.warn(TAG, "getCachedUser: no profile in response", { code: res.code });
  } catch (e) {
    log.warn(TAG, "getCachedUser error", { error: String(e) });
  }
  return null;
}

/** 获取用户歌单（带缓存）。
 *  使用 Promise 共享：并发调用时只有一个真实请求在飞，所有调用者拿到同一个 Promise。 */
export async function getCachedPlaylists(): Promise<NeteasePlaylist[]> {
  if (_cachedPlaylists.value.length > 0) {
    log.info(TAG, "getCachedPlaylists (cache hit)", { count: _cachedPlaylists.value.length });
    return _cachedPlaylists.value;
  }
  // 已有请求在飞：直接复用，不再 polling
  if (_playlistsPromise) {
    log.info(TAG, "getCachedPlaylists: sharing in-flight request");
    return _playlistsPromise;
  }
  _playlistsPromise = (async () => {
    _playlistsLoading.value = true;
    try {
      const user = await getCachedUser();
      if (!user) {
        log.info(TAG, "getCachedPlaylists: no user, returning []");
        return [];
      }
      const res = await userPlaylist(user.userId);
      _cachedPlaylists.value = res.playlist || [];
      log.info(TAG, "getCachedPlaylists (fetched)", { count: _cachedPlaylists.value.length });
      return _cachedPlaylists.value;
    } catch (e) {
      log.warn(TAG, "getCachedPlaylists error", { error: String(e) });
      _cachedPlaylists.value = [];
      return _cachedPlaylists.value;
    } finally {
      _playlistsLoading.value = false;
      _playlistsPromise = null;
    }
  })();
  return _playlistsPromise;
}

export { _cachedUser, _cachedPlaylists } from "./core";
