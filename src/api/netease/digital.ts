/**
 * 网易云音乐 数字专辑 / 音乐日历 / 新碟上架 / 推荐节目 相关 API
 *
 * 模块职责（高内聚）：
 *   - 数字专辑新碟 / 榜单 / 语种风格馆 / 详情
 *   - 我的数字专辑 / 购买数字专辑
 *   - 音乐日历
 *   - 推荐电台 / 推荐节目 / 独家放送
 *   - 歌手收藏 / 收藏的歌手列表
 *   - 收藏的专栏
 *   - 热门歌手
 *   - 心动模式 / 智能播放
 *   - 关注歌手新歌 / 新 MV
 *
 * 依赖：core.ts（apiGet/apiPost/TAG）
 */
import { log } from "@/composables/logger";
import { apiGet, TAG } from "./core";

// ===== 数字专辑 =====

/** 数字专辑-新碟上架（/album/list）
 *  area: ZH=华语, EA=欧美, KR=韩国, JP=日本
 *  type: normal=普通, deluxe=豪华, all=全部
 *  limit / offset */
export async function albumList(area = "ZH", type = "all", limit = 30, offset = 0): Promise<{
  code: number;
  products?: any[];
  more?: boolean;
}> {
  log.info(TAG, "albumList()", { area, type, limit, offset });
  const r = await apiGet("/album/list", { area, type, limit, offset });
  log.info(TAG, "albumList result", { code: r.code, count: r.products?.length || 0 });
  return r;
}

/** 数字专辑&数字单曲-榜单（/album/songsaleboard）
 *  type: daily=日榜, weekly=周榜, yearly=年榜, total=总榜
 *  albumType: 0=数字单曲, 1=数字专辑 */
export async function albumSongsaleboard(type = "daily", albumType = 0): Promise<{
  code: number;
  products?: any[];
}> {
  log.info(TAG, "albumSongsaleboard()", { type, albumType });
  const r = await apiGet("/album/songsaleboard", { type, albumType });
  log.info(TAG, "albumSongsaleboard result", { code: r.code, count: r.products?.length || 0 });
  return r;
}

/** 数字专辑-语种风格馆（/album/style/list） */
export async function albumStyleList(): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "albumStyleList()");
  const r = await apiGet("/album/style/list");
  log.info(TAG, "albumStyleList result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 数字专辑详情（/album/detail')
 *  id: 专辑 ID */
export async function albumDetail(id: number): Promise<{
  code: number;
  album?: any;
}> {
  log.info(TAG, "albumDetail()", { id });
  const r = await apiGet("/album/detail", { id });
  log.info(TAG, "albumDetail result", { code: r.code });
  return r;
}

/** 我的数字专辑（/digitalAlbum/purchased')
 *  limit / offset */
export async function digitalAlbumPurchased(limit = 30, offset = 0): Promise<{
  code: number;
  digitalAlbums?: any[];
  more?: boolean;
}> {
  log.info(TAG, "digitalAlbumPurchased()", { limit, offset });
  const r = await apiGet("/digitalAlbum/purchased", { limit, offset });
  log.info(TAG, "digitalAlbumPurchased result", { code: r.code, count: r.digitalAlbums?.length || 0 });
  return r;
}

// ===== 音乐日历 =====

/** 音乐日历（/calendar')
 *  startTime / endTime: 时间戳（毫秒） */
export async function musicCalendar(startTime: number, endTime: number): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "musicCalendar()", { startTime, endTime });
  const r = await apiGet("/calendar", { startTime, endTime });
  log.info(TAG, "musicCalendar result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

// ===== 推荐电台 / 推荐节目 / 独家放送 =====

/** 推荐电台（/program/recommend） */
export async function programRecommend(): Promise<{
  code: number;
  programs?: any[];
}> {
  log.info(TAG, "programRecommend()");
  const r = await apiGet("/program/recommend");
  log.info(TAG, "programRecommend result", { code: r.code, count: r.programs?.length || 0 });
  return r;
}

/** 独家放送(入口列表)（/personalized/privatecontent） */
export async function personalizedPrivatecontent(): Promise<{
  code: number;
  result?: any[];
}> {
  log.info(TAG, "personalizedPrivatecontent()");
  const r = await apiGet("/personalized/privatecontent");
  log.info(TAG, "personalizedPrivatecontent result", { code: r.code, count: r.result?.length || 0 });
  return r;
}

/** 独家放送列表（/personalized/privatecontent/list）
 *  limit / offset */
export async function personalizedPrivatecontentList(limit = 30, offset = 0): Promise<{
  code: number;
  result?: any[];
  more?: boolean;
}> {
  log.info(TAG, "personalizedPrivatecontentList()", { limit, offset });
  const r = await apiGet("/personalized/privatecontent/list", { limit, offset });
  log.info(TAG, "personalizedPrivatecontentList result", { code: r.code, count: r.result?.length || 0 });
  return r;
}

// ===== 歌手收藏 =====

/** 收藏/取消收藏歌手（/artist/sub）
 *  t: 1=收藏, 0=取消收藏
 *  id: 歌手 ID */
export async function artistSub(id: number, t: 0 | 1): Promise<{ code: number }> {
  log.info(TAG, "artistSub()", { id, t });
  const r = await apiGet("/artist/sub", { id, t });
  log.info(TAG, "artistSub result", { id, t, code: r.code });
  return r;
}

/** 收藏的歌手列表（/artist/sublist）
 *  limit / offset */
export async function artistSublist(limit = 30, offset = 0): Promise<{
  code: number;
  data?: any[];
  count?: number;
  hasMore?: boolean;
}> {
  log.info(TAG, "artistSublist()", { limit, offset });
  const r = await apiGet("/artist/sublist", { limit, offset });
  log.info(TAG, "artistSublist result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 收藏的专栏（/topic/sublist）
 *  limit / offset */
export async function topicSublist(limit = 30, offset = 0): Promise<{
  code: number;
  data?: any[];
  count?: number;
  hasMore?: boolean;
}> {
  log.info(TAG, "topicSublist()", { limit, offset });
  const r = await apiGet("/topic/sublist", { limit, offset });
  log.info(TAG, "topicSublist result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

// ===== 热门歌手 =====

/** 热门歌手（/top/artists）
 *  limit / offset */
export async function topArtists(limit = 30, offset = 0): Promise<{
  code: number;
  artists?: any[];
  more?: boolean;
}> {
  log.info(TAG, "topArtists()", { limit, offset });
  const r = await apiGet("/top/artists", { limit, offset });
  log.info(TAG, "topArtists result", { code: r.code, count: r.artists?.length || 0 });
  return r;
}

// ===== 歌手榜 =====

/** 歌手榜（/toplist/artist）
 *  type: 1=华语, 2=欧美, 3=韩国, 4=日本 */
export async function toplistArtist(type = 1): Promise<{
  code: number;
  list?: { artists?: any[]; coverUrl?: string; name?: string; updateFrequency?: string }[];
}> {
  log.info(TAG, "toplistArtist()", { type });
  const r = await apiGet("/toplist/artist", { type });
  log.info(TAG, "toplistArtist result", { code: r.code, count: r.list?.length || 0 });
  return r;
}

// ===== 心动模式 / 智能播放 =====

/** 心动模式/智能播放（/playmode/intelligence/list）
 *  id: 歌曲 ID
 *  pid: 歌单 ID
 *  sid: 要开始播放的歌曲 ID
 *  limit / offset */
export async function playmodeIntelligenceList(id: number, pid: number, sid: number, limit = 30, offset = 0): Promise<{
  code: number;
  data?: any[];
  more?: boolean;
}> {
  log.info(TAG, "playmodeIntelligenceList()", { id, pid, sid, limit });
  const r = await apiGet("/playmode/intelligence/list", { id, pid, sid, limit, offset });
  log.info(TAG, "playmodeIntelligenceList result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

// ===== 关注歌手新歌 / 新 MV =====

/** 关注歌手新歌（/artist/new/song） */
export async function artistNewSong(limit = 30, offset = 0): Promise<{
  code: number;
  data?: any[];
  more?: boolean;
}> {
  log.info(TAG, "artistNewSong()", { limit, offset });
  const r = await apiGet("/artist/new/song", { limit, offset });
  log.info(TAG, "artistNewSong result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 关注歌手新 MV（/artist/new/mv） */
export async function artistNewMv(limit = 30, offset = 0): Promise<{
  code: number;
  data?: any[];
  more?: boolean;
}> {
  log.info(TAG, "artistNewMv()", { limit, offset });
  const r = await apiGet("/artist/new/mv", { limit, offset });
  log.info(TAG, "artistNewMv result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

// ===== 每日推荐歌曲扩展 =====

/** 每日推荐歌曲-不感兴趣（/recommend/songs/dislike）
 *  id: 歌曲 ID */
export async function recommendSongsDislike(id: number): Promise<{ code: number }> {
  log.info(TAG, "recommendSongsDislike()", { id });
  const r = await apiGet("/recommend/songs/dislike", { id });
  log.info(TAG, "recommendSongsDislike result", { id, code: r.code });
  return r;
}

/** 获取历史日推可用日期列表（/history/recommend/songs') */
export async function historyRecommendSongs(): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "historyRecommendSongs()");
  const r = await apiGet("/history/recommend/songs");
  log.info(TAG, "historyRecommendSongs result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 获取历史日推详情数据（/history/recommend/songs/detail')
 *  date: 日期，如 '2024-01-01' */
export async function historyRecommendSongsDetail(date: string): Promise<{
  code: number;
  data?: { dailySongs?: any[] };
}> {
  log.info(TAG, "historyRecommendSongsDetail()", { date });
  const r = await apiGet("/history/recommend/songs/detail", { date });
  log.info(TAG, "historyRecommendSongsDetail result", { code: r.code, count: r.data?.dailySongs?.length || 0 });
  return r;
}

// ===== 歌手详情动态 =====

/** 歌手详情动态（/artist/detail/dynamic）
 *  id: 歌手 ID */
export async function artistDetailDynamic(id: number): Promise<{
  code: number;
  data?: {
    artist?: any;
    video?: any;
    follow?: boolean;
    [key: string]: any;
  };
}> {
  log.info(TAG, "artistDetailDynamic()", { id });
  const r = await apiGet("/artist/detail/dynamic", { id });
  log.info(TAG, "artistDetailDynamic result", { code: r.code, hasData: !!r.data });
  return r;
}

// ===== 歌曲相关 =====

/** 歌曲红心数量（/song/red/count')
 *  id: 歌曲 ID */
export async function songRedCount(id: number): Promise<{
  code: number;
  count?: number;
}> {
  log.info(TAG, "songRedCount()", { id });
  const r = await apiGet("/song/red/count", { id });
  log.info(TAG, "songRedCount result", { code: r.code, count: r.count });
  return r;
}

/** 歌曲创作者信息（/song/creator')
 *  id: 歌曲 ID */
export async function songCreator(id: number): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "songCreator()", { id });
  const r = await apiGet("/song/creator", { id });
  log.info(TAG, "songCreator result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 歌曲音质详情（/song/quality/detail')
 *  id: 歌曲 ID */
export async function songQualityDetail(id: number): Promise<{
  code: number;
  data?: any;
}> {
  log.info(TAG, "songQualityDetail()", { id });
  const r = await apiGet("/song/quality/detail", { id });
  log.info(TAG, "songQualityDetail result", { code: r.code });
  return r;
}

// ===== 用户信息扩展 =====

/** 获取用户绑定信息（/user/binding')
 *  uid: 用户 ID */
export async function userBinding(uid: number): Promise<{
  code: number;
  bindings?: any[];
}> {
  log.info(TAG, "userBinding()", { uid });
  const r = await apiGet("/user/binding", { uid });
  log.info(TAG, "userBinding result", { code: r.code, count: r.bindings?.length || 0 });
  return r;
}

/** 更新用户信息（/user/update） */
export async function userUpdate(params: {
  gender?: number;
  birthday?: string;
  nickname?: string;
  province?: number;
  city?: number;
  signature?: string;
}): Promise<{ code: number }> {
  const p: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) p[k] = v;
  }
  log.info(TAG, "userUpdate()", { keys: Object.keys(p) });
  const r = await apiGet("/user/update", p);
  log.info(TAG, "userUpdate result", { code: r.code });
  return r;
}

/** 更新头像（/avatar/upload') */
export async function avatarUpload(imgSize: number, imgX = 0, imgY = 0): Promise<{ code: number }> {
  log.info(TAG, "avatarUpload()", { imgSize });
  const r = await apiGet("/avatar/upload", { imgSize, imgX, imgY });
  log.info(TAG, "avatarUpload result", { code: r.code });
  return r;
}

/** 获取用户信息, 歌单，收藏，mv, dj 数量（/user/subcount') */
export async function userSubcount(): Promise<{
  code: number;
  programCount?: number;
  djRadioCount?: number;
  mvCount?: number;
  artistCount?: number;
  newPlayListCount?: number;
  createdPlayListCount?: number;
  subPlayListCount?: number;
}> {
  log.info(TAG, "userSubcount()");
  const r = await apiGet("/user/subcount");
  log.info(TAG, "userSubcount result", { code: r.code });
  return r;
}

// ===== 歌单导入 =====

/** 歌单导入 - 元数据/文字/链接导入（/playlist/import')
 *  type: 1=元数据, 2=文字, 3=链接
 *  data: 导入数据 */
export async function playlistImport(type: number, data: string): Promise<{ code: number }> {
  log.info(TAG, "playlistImport()", { type, dataLen: data.length });
  const r = await apiGet("/playlist/import", { type, data });
  log.info(TAG, "playlistImport result", { code: r.code });
  return r;
}

/** 歌单导入 - 任务状态（/playlist/import/status')
 *  id: 任务 ID */
export async function playlistImportStatus(id: number): Promise<{
  code: number;
  data?: any;
}> {
  log.info(TAG, "playlistImportStatus()", { id });
  const r = await apiGet("/playlist/import/status", { id });
  log.info(TAG, "playlistImportStatus result", { code: r.code });
  return r;
}
