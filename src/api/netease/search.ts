/** 网易云搜索 API
 *
 * 模块职责（高内聚）：
 *   - 搜索（单曲/专辑/歌手/歌单/用户/MV/歌词/综合）
 *   - 搜索建议（PC端 / 移动端）
 *   - 搜索多重匹配
 *
 * 依赖：core.ts（apiGet/TAG）
 */
import { log } from "@/composables/logger";
import { apiGet, TAG } from "./core";
import type { NeteaseSong } from "@/types";

/** 搜索（网易云 API /search）
 *  type: 1=单曲, 10=专辑, 100=歌手, 1000=歌单, 1002=用户, 1004=MV, 1006=歌词, 1018=综合 */
export async function searchSongs(keywords: string, limit = 30, offset = 0, type = 1): Promise<{
  code: number;
  result?: { songs: NeteaseSong[]; songCount: number; [key: string]: any };
}> {
  log.info("netease-api-search", "→ searchSongs()", { keywords, limit, offset, type });
  const r = await apiGet("/search", { keywords, limit, offset, type });
  log.info("netease-api-search", "← searchSongs result", {
    code: r.code,
    resultKeys: r.result ? Object.keys(r.result) : [],
    songsCount: r.result?.songs?.length || 0,
    songCount: r.result?.songCount,
  });
  return r;
}

/** 搜索建议（/search/suggest）
 *  type=pc 返回完整歌曲列表（含 songs 数组）
 *  type=mobile 只返回 allMatch（匹配建议，无实际歌曲） */
export async function searchSuggest(keywords: string, type: "mobile" | "pc" = "pc"): Promise<{
  code: number;
  result?: {
    songs?: NeteaseSong[];
    artists?: { id: number; name: string }[];
    playlists?: { id: number; name: string }[];
    album?: { id: number; name: string }[];
    albums?: { id: number; name: string }[];
    allMatch?: { keyword: string; type: number }[];
    order?: string[];
  };
}> {
  log.info("netease-api-search", "→ searchSuggest()", { keywords, type });
  const r = await apiGet("/search/suggest", { keywords, type });
  const resultKeys = r.result ? Object.keys(r.result) : [];
  const firstSong = r.result?.songs?.[0];
  log.info("netease-api-search", "← searchSuggest result", {
    code: r.code,
    resultKeys,
    order: r.result?.order,
    songsCount: r.result?.songs?.length || 0,
    artistsCount: r.result?.artists?.length || 0,
    playlistsCount: r.result?.playlists?.length || 0,
    allMatchCount: r.result?.allMatch?.length || 0,
    firstSongKeys: firstSong ? Object.keys(firstSong) : [],
    firstSongPreview: firstSong ? {
      id: firstSong.id, name: firstSong.name,
      hasAr: !!firstSong.ar, hasArtists: !!firstSong.artists,
      hasAl: !!firstSong.al, hasAlbum: !!firstSong.album,
      alPicUrl: firstSong.al?.picUrl || firstSong.album?.picUrl,
      dt: firstSong.dt, duration: firstSong.duration,
    } : null,
  });
  return r;
}

/** 搜索多重匹配（/search/multimatch）
 *  返回多种类型的匹配结果（歌曲/歌手/歌单/MV 等） */
export async function searchMultimatch(keywords: string): Promise<{
  code: number;
  result?: {
    song?: NeteaseSong[];
    artist?: { id: number; name: string; picUrl?: string; alias?: string[] }[];
    album?: { id: number; name: string; artist?: { name: string } }[];
    playlist?: { id: number; name: string; coverImgUrl?: string }[];
    mv?: { id: number; name: string; cover?: string; artistName?: string }[];
    order?: string[];
  };
}> {
  log.info(TAG, "searchMultimatch()", { keywords });
  const r = await apiGet("/search/multimatch", { keywords });
  log.info(TAG, "searchMultimatch result", {
    code: r.code,
    order: r.result?.order,
    songCount: r.result?.song?.length || 0,
    artistCount: r.result?.artist?.length || 0,
    albumCount: r.result?.album?.length || 0,
    playlistCount: r.result?.playlist?.length || 0,
    mvCount: r.result?.mv?.length || 0,
  });
  return r;
}
