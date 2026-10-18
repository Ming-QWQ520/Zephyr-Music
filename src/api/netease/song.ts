/** 网易云歌曲 URL / 详情 / 打卡 / 听歌记录 API */
import { log } from "@/composables/logger";
import { apiGet, TAG } from "./core";
import { truncateForLog } from "@/utils/format";
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
  log.info(TAG, "scrobble", { id, sourceid, time });
  const r = await apiGet<{ code: number }>("/scrobble", params);
  log.info(TAG, "scrobble result", { id, sourceid, time, code: r.code });
  return r;
}

/** 听歌打卡 V2（/scrobble/v1，NCBL 加密版）
 *  id: 歌曲 ID，time: 播放时长（秒）
 *  sourceid: 来源列表 ID，sourceName: 来源名称（默认 list）
 *  song: 歌曲名，artist: 艺术家，bitrate: 码率（默认 320），level: 音质（默认 exhigh）
 *  total: 歌曲总时长（秒）
 *
 *  ★ 始终使用远程 api-enhanced /scrobble/v1（Node.js NCBL 参考实现），
 *    不再调用本地 Rust netease_report_playback。
 *    原因：Rust NCBL 加密重实现可能有细微差异，导致网易云接受上传(code:200)
 *    但不计入听歌时长。Node.js 实现是 api-enhanced 官方参考实现，更可靠。
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
    isAutoNext?: boolean;
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
  log.info(TAG, "scrobbleV1(remote ncbl)", { id, time, ...options });
  const r = await apiGet<{ code: number }>("/scrobble/v1", params);
  log.info(TAG, "scrobbleV1 result", { id, time, code: r.code });
  return r;
}

/** 私人漫游 / 私人FM（/personal_fm）
 *  每次返回 1~3 首个性化推荐歌曲（老格式：artists/album/duration 字段）。
 *  网易云 PC 端漫游即基于此接口：播放中快到队尾时再次调用追加歌曲。 */
export async function personalFm(): Promise<{ code: number; data: NeteaseSong[] }> {
  log.info(TAG, "→ personalFm()");
  const r = await apiGet("/personal_fm");
  log.info(TAG, "← personalFm result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 漫游不感兴趣（/fm_trash）：把歌曲丢进 FM 垃圾桶，之后不再推荐 */
export async function fmTrash(id: number): Promise<{ code: number }> {
  log.info(TAG, "→ fmTrash()", { id });
  const r = await apiGet("/fm_trash", { id });
  log.info(TAG, "← fmTrash result", { id, code: r.code });
  return r;
}

/** 获取用户播放记录（最近播放-歌曲，/record/recent/song） */
export async function recordRecentSong(limit = 300): Promise<{
  code: number;
  data?: {
    total?: number;
    list?: { resourceId?: string; playTime?: number; data?: NeteaseSong; song?: NeteaseSong }[];
  } | { playCount: number; song: NeteaseSong }[];
  list?: { playCount: number; song: NeteaseSong }[];
}> {
  log.info(TAG, "recordRecentSong()", { limit });
  const r = await apiGet("/record/recent/song", { limit });
  const records = Array.isArray(r.data) ? r.data : (r.data as any)?.list || r.list || [];
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

/** 副歌时间 / 高潮点（/song/chorus）
 *  返回 chorus[] 与 data[]（两者结构相同），每项含 startTime / endTime（毫秒）。
 *  startTime 转换为 m:ss 即歌曲的高潮点。 */
export interface SongChorus {
  id: number;
  startTime: number; // 毫秒
  endTime: number;   // 毫秒
  ugcLocked?: number;
}
export async function songChorus(id: number): Promise<{
  code: number;
  chorus?: SongChorus[];
  data?: SongChorus[];
}> {
  log.info(TAG, "→ songChorus()", { id });
  const r = await apiGet<{ code: number; chorus?: SongChorus[]; data?: SongChorus[] }>(
    "/song/chorus",
    { id }
  );
  const list = r.chorus || r.data || [];
  log.info(TAG, "← songChorus result", {
    code: r.code, count: list.length,
    first: list[0] ? { start: list[0].startTime, end: list[0].endTime } : null,
  });
  return r;
}

/** ===== 歌曲百科（/song/wiki/summary，需登录）=====
 *  返回结构：{ code, data: { blocks: Block[] } }
 *  blocks 包含 4 块（按 position 排序）：
 *   - 回忆坐标（MUSIC_MEMORY_MULTI_TWO_GRID）：首次听歌时间 / 听歌次数超越百分比
 *   - 音乐百科（SONG_PLAY_ABOUT_TAB_SONG_BASIC）：曲风/推荐标签/语种/BPM/乐谱
 *   - 相似歌曲（LIST_SONG）：20 首相似歌曲
 *   - 相关歌单（PLAYLIST_MULTI_THREE_GRID）：20 个相关歌单
 */
export interface WikiUIElement {
  mainTitle?: { title: string; action?: any } | null;
  subTitles?: { title: string; action?: any }[] | null;
  images?: { imageUrl?: string; title?: string; width?: number; height?: number }[] | null;
  textLinks?: { text: string | null; url?: string | null }[] | null;
  descriptions?: { description?: string }[] | null;
  buttons?: { text?: string; imageUrl?: string | null; action?: { clickAction?: { action?: number; targetUrl?: string } } | null }[] | null;
}

export interface WikiResource {
  resourceType: string;
  resourceId: string | null;
  uiElement: WikiUIElement | null;
  resourceExt?: {
    playCount?: number;
    musicFirstListenDto?: { timestamp?: string; season?: string; period?: string; date?: string; desc?: string } | null;
    musicTotalPlayDto?: { playCount?: number; duration?: number; text?: string; desc?: string } | null;
  } | null;
  action?: { clickAction?: { action?: number; targetUrl?: string } } | null;
}

export interface WikiCreative {
  creativeType?: string | null;
  uiElement: WikiUIElement | null;
  resources: WikiResource[];
}

export interface WikiBlock {
  showType: string;
  channel: string;
  position: string;
  uiElement: WikiUIElement | null;
  creatives: WikiCreative[];
}

export interface SongWikiSummary {
  code: number;
  data?: { cursor?: string; blocks?: WikiBlock[] };
  /** api-enhanced 解包后顶层就是 { cursor, blocks } */
  cursor?: string;
  blocks?: WikiBlock[];
}

export async function songWikiSummary(id: number): Promise<SongWikiSummary> {
  log.info(TAG, "→ songWikiSummary()", { id });
  const r = await apiGet<SongWikiSummary>("/song/wiki/summary", { id });
  const blocks = r.blocks || r.data?.blocks || [];
  log.info(TAG, "← songWikiSummary result", {
    code: r.code, blocksCount: blocks.length,
    blockTitles: blocks.map(b => b?.uiElement?.mainTitle?.title || "").filter(Boolean),
  });
  return r;
}
