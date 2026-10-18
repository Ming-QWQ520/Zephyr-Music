/**
 * 网易云音乐 歌单 CRUD 操作 API
 *
 * 模块职责（高内聚）：
 *   - 新建歌单 / 删除歌单
 *   - 更新歌单名 / 描述 / 标签
 *   - 歌单封面上传
 *   - 调整歌单顺序 / 歌曲顺序
 *   - 歌单分类 / 热门歌单分类
 *   - 精品歌单标签 / 精品歌单
 *   - 相关歌单 / 收藏/取消收藏歌单
 *
 * 注：歌单查询/详情/缓存 仍在 playlist.ts 中，此处仅放写操作和分类浏览
 *
 * 依赖：core.ts（apiGet/apiPost/TAG）
 */
import { log } from "@/composables/logger";
import { apiGet, apiPost, TAG } from "./core";

// ===== 歌单 CRUD =====

/** 新建歌单（/playlist/create）
 *  name: 歌单名
 *  privacy: 10=隐私, 0=公开（默认） */
export async function playlistCreate(name: string, privacy: 0 | 10 = 0): Promise<{
  code: number;
  id?: number;
  playlist?: any;
}> {
  log.info(TAG, "playlistCreate()", { name, privacy });
  const r = await apiPost("/playlist/create", { name, privacy });
  log.info(TAG, "playlistCreate result", { code: r.code, id: r.id });
  return r;
}

/** 删除歌单（/playlist/delete）
 *  id: 歌单 ID，可多个用逗号分隔 */
export async function playlistDelete(id: number | string): Promise<{ code: number }> {
  log.info(TAG, "playlistDelete()", { id });
  const r = await apiGet("/playlist/delete", { id });
  log.info(TAG, "playlistDelete result", { id, code: r.code });
  return r;
}

/** 更新歌单名（/playlist/name/update）
 *  id: 歌单 ID
 *  name: 新歌单名 */
export async function playlistNameUpdate(id: number, name: string): Promise<{ code: number }> {
  log.info(TAG, "playlistNameUpdate()", { id, name });
  const r = await apiGet("/playlist/name/update", { id, name });
  log.info(TAG, "playlistNameUpdate result", { id, code: r.code });
  return r;
}

/** 更新歌单描述（/playlist/desc/update）
 *  id: 歌单 ID
 *  desc: 新描述 */
export async function playlistDescUpdate(id: number, desc: string): Promise<{ code: number }> {
  log.info(TAG, "playlistDescUpdate()", { id, descLen: desc.length });
  const r = await apiGet("/playlist/desc/update", { id, desc });
  log.info(TAG, "playlistDescUpdate result", { id, code: r.code });
  return r;
}

/** 更新歌单标签（/playlist/tags/update）
 *  id: 歌单 ID
 *  tags: 标签，逗号分隔（如 "华语,流行"） */
export async function playlistTagsUpdate(id: number, tags: string): Promise<{ code: number }> {
  log.info(TAG, "playlistTagsUpdate()", { id, tags });
  const r = await apiGet("/playlist/tags/update", { id, tags });
  log.info(TAG, "playlistTagsUpdate result", { id, code: r.code });
  return r;
}

/** 歌单封面上传（/playlist/cover/update）
 *  id: 歌单 ID
 *  imgSize: 图片尺寸
 *  imgX / imgY: 裁剪偏移 */
export async function playlistCoverUpdate(id: number, imgSize: number, imgX = 0, imgY = 0): Promise<{ code: number }> {
  log.info(TAG, "playlistCoverUpdate()", { id, imgSize });
  const r = await apiGet("/playlist/cover/update", { id, imgSize, imgX, imgY });
  log.info(TAG, "playlistCoverUpdate result", { id, code: r.code });
  return r;
}

/** 调整歌单顺序（/playlist/order/update）
 *  ids: 歌单 ID 列表，逗号分隔（按顺序排列） */
export async function playlistOrderUpdate(ids: string): Promise<{ code: number }> {
  log.info(TAG, "playlistOrderUpdate()", { ids });
  const r = await apiGet("/playlist/order/update", { ids });
  log.info(TAG, "playlistOrderUpdate result", { code: r.code });
  return r;
}

/** 调整歌曲顺序（/playlist/track/move）
 *  pid: 歌单 ID
 *  sid: 歌曲 ID
 *  from: 原位置
 *  to: 目标位置 */
export async function playlistTrackMove(pid: number, sid: number, from: number, to: number): Promise<{ code: number }> {
  log.info(TAG, "playlistTrackMove()", { pid, sid, from, to });
  const r = await apiGet("/playlist/track/move", { pid, sid, from, to });
  log.info(TAG, "playlistTrackMove result", { code: r.code });
  return r;
}

// ===== 歌单收藏 =====

/** 收藏/取消收藏歌单（/playlist/subscribe）
 *  t: 1=收藏, 0=取消收藏
 *  id: 歌单 ID */
export async function playlistSubscribe(id: number, t: 0 | 1): Promise<{ code: number }> {
  log.info(TAG, "playlistSubscribe()", { id, t });
  const r = await apiGet("/playlist/subscribe", { id, t });
  log.info(TAG, "playlistSubscribe result", { id, t, code: r.code });
  return r;
}

// ===== 歌单分类 / 热门分类 =====

/** 歌单分类（/playlist/catlist） */
export async function playlistCatlist(): Promise<{
  code: number;
  sub?: { id: number; name: string; category: number; hot?: boolean }[];
  categories?: Record<number, string>;
  all?: { id: number; name: string };
}> {
  log.info(TAG, "playlistCatlist()");
  const r = await apiGet("/playlist/catlist");
  log.info(TAG, "playlistCatlist result", { code: r.code, subCount: r.sub?.length || 0 });
  return r;
}

/** 热门歌单分类（/playlist/hot） */
export async function playlistHot(): Promise<{
  code: number;
  tags?: { id: number; name: string; category?: number; hot?: boolean }[];
}> {
  log.info(TAG, "playlistHot()");
  const r = await apiGet("/playlist/hot");
  log.info(TAG, "playlistHot result", { code: r.code, count: r.tags?.length || 0 });
  return r;
}

// ===== 精品歌单 =====

/** 精品歌单标签列表（/playlist/highquality/tags） */
export async function playlistHighqualityTags(): Promise<{
  code: number;
  tags?: { id: number; name: string; category?: number }[];
}> {
  log.info(TAG, "playlistHighqualityTags()");
  const r = await apiGet("/playlist/highquality/tags");
  log.info(TAG, "playlistHighqualityTags result", { code: r.code, count: r.tags?.length || 0 });
  return r;
}

/** 获取精品歌单（/top/playlist/highquality）
 *  cat: 分类标签，默认 "全部"
 *  limit / offset
 *  before: 分页参数，取上一页最后一个歌单的 update_time */
export async function topPlaylistHighquality(cat = "全部", limit = 30, offset = 0, before?: number): Promise<{
  code: number;
  playlists?: any[];
  total?: number;
  more?: boolean;
  lasttime?: number;
}> {
  const p: Record<string, string | number | boolean> = { cat, limit, offset };
  if (before !== undefined) p.before = before;
  log.info(TAG, "topPlaylistHighquality()", { cat, limit, offset });
  const r = await apiGet("/top/playlist/highquality", p);
  log.info(TAG, "topPlaylistHighquality result", { code: r.code, count: r.playlists?.length || 0 });
  return r;
}

// ===== 歌单列表 / 相关歌单 =====

/** 歌单 (网友精选碟)（/top/playlist）
 *  cat: 分类标签，默认 "全部"
 *  order: hot=最热, new=最新
 *  limit / offset */
export async function topPlaylist(cat = "全部", order = "hot", limit = 30, offset = 0): Promise<{
  code: number;
  playlists?: any[];
  total?: number;
  more?: boolean;
}> {
  log.info(TAG, "topPlaylist()", { cat, order, limit, offset });
  const r = await apiGet("/top/playlist", { cat, order, limit, offset });
  log.info(TAG, "topPlaylist result", { code: r.code, count: r.playlists?.length || 0 });
  return r;
}

/** 相关歌单（/related/playlist） */
export async function relatedPlaylist(id: number): Promise<{
  code: number;
  playlists?: any[];
}> {
  log.info(TAG, "relatedPlaylist()", { id });
  const r = await apiGet("/related/playlist", { id });
  log.info(TAG, "relatedPlaylist result", { code: r.code, count: r.playlists?.length || 0 });
  return r;
}

/** 歌单更新播放量（已在 playlist.ts 中有 playlistUpdatePlaycount，此处不再重复） */
