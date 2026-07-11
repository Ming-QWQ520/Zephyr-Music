/** 网易云喜欢/收藏 API + 喜欢列表缓存 */
import { ref } from "vue";
import { log } from "@/composables/logger";
import { apiGet, TAG } from "./core";

/** 缓存的喜欢歌曲 ID 集合（Set 方便 O(1) 查询） */
const _cachedLikeSet = ref<Set<number> | null>(null);
/** 喜欢列表是否正在加载 */
const _likeListLoading = ref(false);

/** 喜欢歌曲（旧版 /like） */
export async function likeSong(id: number, like = true): Promise<{ code: number }> {
  log.info(TAG, "likeSong()", { id, like });
  const r = await apiGet("/like", { id, like: like ? "true" : "false" });
  log.info(TAG, "likeSong result", { id, like, code: r.code });
  return r;
}

/** 喜欢歌曲 - 新版（/song/like） */
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

/** 检查歌曲是否已喜欢（/song/like/check） */
export async function songLikeCheck(ids: number[]): Promise<{
  code: number; data?: { songId: number; like: boolean }[];
}> {
  log.info(TAG, "songLikeCheck()", { ids });
  const r = await apiGet("/song/like/check", { ids: JSON.stringify(ids) });
  log.info(TAG, "songLikeCheck result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

// ===== 喜欢列表缓存（延迟导入 getCachedUser 避免循环依赖）=====

/** 喜欢列表请求的共享 Promise（替代 while 轮询） */
let _likeListPromise: Promise<Set<number>> | null = null;

/** 刷新喜欢列表缓存（从服务器拉取最新）。
 *  使用 Promise 共享：并发调用时只有一个真实请求在飞。 */
export async function refreshLikeList(uid: number): Promise<Set<number>> {
  if (_likeListPromise) {
    log.info(TAG, "refreshLikeList: sharing in-flight request", { uid });
    return _likeListPromise;
  }
  _likeListPromise = (async () => {
    _likeListLoading.value = true;
    try {
      const res = await likeList(uid);
      _cachedLikeSet.value = new Set(res.ids || []);
      log.info(TAG, "refreshLikeList done", { uid, count: _cachedLikeSet.value.size });
      return _cachedLikeSet.value;
    } catch (e) {
      log.warn(TAG, "refreshLikeList error", { uid, error: String(e) });
      _cachedLikeSet.value = new Set();
      return _cachedLikeSet.value;
    } finally {
      _likeListLoading.value = false;
      _likeListPromise = null;
    }
  })();
  return _likeListPromise;
}

/** 获取缓存的喜欢列表（如果未缓存则自动加载） */
export async function getCachedLikeList(): Promise<Set<number>> {
  if (_cachedLikeSet.value) {
    log.info(TAG, "getCachedLikeList (cache hit)", { count: _cachedLikeSet.value.size });
    return _cachedLikeSet.value;
  }
  // 延迟导入避免循环依赖
  const { getCachedUser } = await import("./playlist");
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
