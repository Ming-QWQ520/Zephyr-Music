/**
 * 网易云音乐 曲风 / 音乐风格 相关 API
 *
 * 模块职责（高内聚）：
 *   - 曲风列表 / 曲风偏好
 *   - 曲风详情
 *   - 曲风下歌曲 / 专辑 / 歌单 / 歌手
 *
 * 依赖：core.ts（apiGet/TAG）
 */
import { log } from "@/composables/logger";
import { apiGet, TAG } from "./core";

// ===== 曲风列表 / 偏好 =====

/** 曲风列表（/style/list） */
export async function styleList(): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "styleList()");
  const r = await apiGet("/style/list");
  log.info(TAG, "styleList result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 曲风偏好（/style/preference） */
export async function stylePreference(): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "stylePreference()");
  const r = await apiGet("/style/preference");
  log.info(TAG, "stylePreference result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

// ===== 曲风详情 =====

/** 曲风详情（/style/detail）
 *  id: 曲风 ID */
export async function styleDetail(id: number): Promise<{
  code: number;
  data?: {
    id: number;
    name: string;
    coverUrl?: string;
    description?: string;
    [key: string]: any;
  };
}> {
  log.info(TAG, "styleDetail()", { id });
  const r = await apiGet("/style/detail", { id });
  log.info(TAG, "styleDetail result", { code: r.code, name: r.data?.name });
  return r;
}

// ===== 曲风下资源 =====

/** 曲风 - 歌曲（/style/song）
 *  id: 曲风 ID
 *  limit / offset
 *  sort: 0=按热度, 1=按时间 */
export async function styleSong(id: number, limit = 30, offset = 0, sort = 0): Promise<{
  code: number;
  data?: { songs?: any[]; total?: number; more?: boolean };
  songs?: any[];
  total?: number;
  more?: boolean;
}> {
  log.info(TAG, "styleSong()", { id, limit, offset, sort });
  const r = await apiGet("/style/song", { id, limit, offset, sort });
  log.info(TAG, "styleSong result", { code: r.code, count: r.data?.songs?.length || r.songs?.length || 0 });
  return r;
}

/** 曲风 - 专辑（/style/album）
 *  id: 曲风 ID
 *  limit / offset */
export async function styleAlbum(id: number, limit = 30, offset = 0): Promise<{
  code: number;
  data?: { albums?: any[]; total?: number; more?: boolean };
  albums?: any[];
  total?: number;
  more?: boolean;
}> {
  log.info(TAG, "styleAlbum()", { id, limit, offset });
  const r = await apiGet("/style/album", { id, limit, offset });
  log.info(TAG, "styleAlbum result", { code: r.code, count: r.data?.albums?.length || r.albums?.length || 0 });
  return r;
}

/** 曲风 - 歌单（/style/playlist）
 *  id: 曲风 ID
 *  limit / offset */
export async function stylePlaylist(id: number, limit = 30, offset = 0): Promise<{
  code: number;
  data?: { playlists?: any[]; total?: number; more?: boolean };
  playlists?: any[];
  total?: number;
  more?: boolean;
}> {
  log.info(TAG, "stylePlaylist()", { id, limit, offset });
  const r = await apiGet("/style/playlist", { id, limit, offset });
  log.info(TAG, "stylePlaylist result", { code: r.code, count: r.data?.playlists?.length || r.playlists?.length || 0 });
  return r;
}

/** 曲风 - 歌手（/style/artist）
 *  id: 曲风 ID
 *  limit / offset */
export async function styleArtist(id: number, limit = 30, offset = 0): Promise<{
  code: number;
  data?: { artists?: any[]; total?: number; more?: boolean };
  artists?: any[];
  total?: number;
  more?: boolean;
}> {
  log.info(TAG, "styleArtist()", { id, limit, offset });
  const r = await apiGet("/style/artist", { id, limit, offset });
  log.info(TAG, "styleArtist result", { code: r.code, count: r.data?.artists?.length || r.artists?.length || 0 });
  return r;
}
