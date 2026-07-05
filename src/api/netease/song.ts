/** 网易云歌曲 URL / 详情 / 打卡 / 听歌记录 API */
import { log } from "@/composables/logger";
import { apiGet, TAG } from "./core";
import type { NeteaseSong } from "@/types";

/** 获取音乐 URL */
export async function songUrl(id: number): Promise<{
  code: number; data: { id: number; url: string; br: number; size: number }[];
}> {
  log.info("netease-api-music", "→ songUrl()", { id });
  const r = await apiGet("/song/url", { id });
  log.info("netease-api-music", "← songUrl result", { code: r.code, count: r.data?.length || 0, hasUrl: !!r.data?.[0]?.url });
  return r;
}

/** 获取音乐 URL v1（指定音质） */
export async function songUrlV1(id: number, level = "exhigh"): Promise<{
  code: number;
  data: { id: number; url: string; br: number; size: number; freeTrialInfo?: { start: number; end: number } | null }[];
}> {
  const params: Record<string, string | number | boolean> = { id, level };
  if (level === "dolby") params.os = "pc";
  log.info("netease-api-music", "→ songUrlV1()", { id, level });
  const r = await apiGet("/song/url/v1", params);
  const d = r.data?.[0];
  const rawTrial = d?.freeTrialInfo;
  const isTrial = rawTrial !== null && rawTrial !== undefined && rawTrial !== "null" && typeof rawTrial === "object";
  log.info("netease-api-music", "← songUrlV1 result", {
    code: r.code, count: r.data?.length || 0, hasUrl: !!d?.url, br: d?.br,
    urlPreview: d?.url ? d.url.slice(0, 80) : "", freeTrialInfo: rawTrial, isTrial,
    allKeys: d ? Object.keys(d) : [],
  });
  return r;
}

/** 歌曲详情 */
export async function songDetail(ids: number[]): Promise<{
  code: number; songs: NeteaseSong[];
}> {
  log.info("netease-api-music", "→ songDetail()", { ids });
  const r = await apiGet("/song/detail", { ids: ids.join(",") });
  log.info("netease-api-music", "← songDetail result", { code: r.code, count: r.songs?.length || 0 });
  return r;
}

/** 听歌打卡（/scrobble，非加密版）
 *  id: 歌曲 ID，sourceid: 歌单或专辑 ID，time: 播放时长（秒）
 */
export async function scrobble(id: number, sourceid: number, time?: number): Promise<{ code: number }> {
  const params: Record<string, string | number> = { id, sourceid };
  if (time !== undefined && time >= 0) params.time = time;
  log.info(TAG, "scrobble()", { id, sourceid, time });
  const r = await apiGet("/scrobble", params);
  log.info(TAG, "scrobble result", { id, sourceid, code: r.code });
  return r;
}

/** 听歌打卡 V2（/scrobble/v1，NCBL 加密版）
 *  id: 歌曲 ID，time: 播放时长（秒）
 *  sourceid: 来源列表 ID，sourceName: 来源名称（默认 list）
 *  song: 歌曲名，artist: 艺术家，bitrate: 码率（默认 320），level: 音质（默认 exhigh）
 *  total: 歌曲总时长（秒）
 */
export async function scrobbleV1(
  id: number,
  time: number,
  options?: {
    sourceid?: number;
    sourceName?: string;
    song?: string;
    artist?: string;
    bitrate?: number;
    level?: string;
    total?: number;
  }
): Promise<{ code: number }> {
  const params: Record<string, string | number> = { id, time };
  if (options?.sourceid) params.sourceid = options.sourceid;
  if (options?.sourceName) params.sourceName = options.sourceName;
  if (options?.song) params.song = options.song;
  if (options?.artist) params.artist = options.artist;
  if (options?.bitrate) params.bitrate = options.bitrate;
  if (options?.level) params.level = options.level;
  if (options?.total) params.total = options.total;
  log.info(TAG, "scrobbleV1()", { id, time, ...options });
  const r = await apiGet<{ code: number }>("/scrobble/v1", params);
  log.info(TAG, "scrobbleV1 result", { id, time, code: r.code });
  return r;
}

/** 获取用户播放记录（最近播放-歌曲，/record/recent/song） */
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

/** 获取用户播放记录（旧版 /user/record）
 *  type=1: weekData (本周), type=0: allData (全部) */
export async function userRecord(uid: number, type: 0 | 1 = 1): Promise<{
  code: number;
  weekData?: { playCount: number; song: NeteaseSong }[];
  allData?: { playCount: number; song: NeteaseSong }[];
}> {
  log.info(TAG, "userRecord()", { uid, type });
  const r = await apiGet("/user/record", { uid, type });
  function truncateForLog(obj: any, maxLen = 500): string {
    try {
      const s = typeof obj === "string" ? obj : JSON.stringify(obj);
      if (!s) return String(s);
      return s.length > maxLen ? s.slice(0, maxLen) + `...(truncated, total ${s.length} chars)` : s;
    } catch { return String(obj); }
  }
  log.info(TAG, "userRecord result", {
    code: r.code, weekDataCount: r.weekData?.length || 0, allDataCount: r.allData?.length || 0,
    weekDataFirst: r.weekData?.[0] ? { playCount: r.weekData[0].playCount, songId: r.weekData[0].song?.id, songName: r.weekData[0].song?.name } : null,
    preview: truncateForLog(r, 600),
  });
  return r;
}

/** 最近听歌列表（/recent/listen/list） */
export async function recentListenList(): Promise<{
  code: number;
  data?: { song: NeteaseSong; playTime?: number }[];
  list?: { song: NeteaseSong; playTime?: number }[];
}> {
  log.info("netease-api-music", "→ recentListenList()");
  const r = await apiGet("/recent/listen/list");
  const list = r.data || r.list || [];
  log.info("netease-api-music", "← recentListenList result", {
    code: r.code, count: list.length, field: r.data ? "data" : r.list ? "list" : "none",
  });
  return r;
}
