/**
 * 网易云音乐 视频 / MV 相关 API
 *
 * 模块职责（高内聚）：
 *   - 视频标签 / 分类 / 列表
 *   - 视频详情 / 播放地址
 *   - 视频点赞 / 转发 / 评论数据
 *   - MV 详情 / 地址 / 排行 / 收藏
 *   - 推荐视频 / 相关视频
 *
 * 依赖：core.ts（apiGet/apiPost/TAG）
 * 注：MV 排行/详情/地址已在 discover.ts 中定义，此处补充视频相关
 */
import { log } from "@/composables/logger";
import { apiGet, apiPost, TAG } from "./core";

// ===== 视频标签 / 分类 =====

/** 获取视频标签列表（/video/group/list） */
export async function videoGroupList(): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "videoGroupList()");
  const r = await apiGet("/video/group/list");
  log.info(TAG, "videoGroupList result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 获取视频分类列表（/video/category/list） */
export async function videoCategoryList(): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "videoCategoryList()");
  const r = await apiGet("/video/category/list");
  log.info(TAG, "videoCategoryList result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 获取视频标签/分类下的视频（/video/group）
 *  id: 标签/分组 ID
 *  offset / limit */
export async function videoGroup(id: number, offset = 0, limit = 30): Promise<{
  code: number;
  datas?: any[];
  hasmore?: boolean;
}> {
  log.info(TAG, "videoGroup()", { id, offset, limit });
  const r = await apiGet("/video/group", { id, offset, limit });
  log.info(TAG, "videoGroup result", { code: r.code, count: r.datas?.length || 0 });
  return r;
}

// ===== 视频列表 / 详情 =====

/** 获取全部视频列表（/video/timeline/all）
 *  offset / limit */
export async function videoTimelineAll(offset = 0, limit = 30): Promise<{
  code: number;
  datas?: any[];
  hasmore?: boolean;
}> {
  log.info(TAG, "videoTimelineAll()", { offset, limit });
  const r = await apiGet("/video/timeline/all", { offset, limit });
  log.info(TAG, "videoTimelineAll result", { code: r.code, count: r.datas?.length || 0 });
  return r;
}

/** 获取推荐视频（/video/timeline/recommend）
 *  offset / limit */
export async function videoTimelineRecommend(offset = 0, limit = 30): Promise<{
  code: number;
  datas?: any[];
  hasmore?: boolean;
}> {
  log.info(TAG, "videoTimelineRecommend()", { offset, limit });
  const r = await apiGet("/video/timeline/recommend", { offset, limit });
  log.info(TAG, "videoTimelineRecommend result", { code: r.code, count: r.datas?.length || 0 });
  return r;
}

/** 视频详情（/video/detail）
 *  id: 视频 ID */
export async function videoDetail(id: number): Promise<{
  code: number;
  data?: {
    vid: string;
    title?: string;
    coverUrl?: string;
    duration?: number;
    playTime?: number;
    praisedCount?: number;
    commentCount?: number;
    shareCount?: number;
    creator?: { userId: number; nickname: string; avatarUrl: string };
    [key: string]: any;
  };
}> {
  log.info(TAG, "videoDetail()", { id });
  const r = await apiGet("/video/detail", { id });
  log.info(TAG, "videoDetail result", { code: r.code, title: r.data?.title });
  return r;
}

/** 视频播放地址（/video/url）
 *  id: 视频 ID
 *  r: 分辨率，默认 1080 */
export async function videoUrl(id: number, r = 1080): Promise<{
  code: number;
  urls?: { url: string; r: number; size?: number }[];
}> {
  log.info(TAG, "videoUrl()", { id, r });
  const res = await apiGet("/video/url", { id, r });
  log.info(TAG, "videoUrl result", { code: res.code, hasUrl: !!res.urls?.[0]?.url });
  return res;
}

/** 相关视频（/related/allvideo） */
export async function relatedAllvideo(id: number, limit = 20): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "relatedAllvideo()", { id });
  const r = await apiGet("/related/allvideo", { id, limit });
  log.info(TAG, "relatedAllvideo result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 获取视频点赞转发评论数数据（/video/detail/info） */
export async function videoDetailInfo(vid: number): Promise<{
  code: number;
  likedCount?: number;
  shareCount?: number;
  commentCount?: number;
  liked?: boolean;
}> {
  log.info(TAG, "videoDetailInfo()", { vid });
  const r = await apiGet("/video/detail/info", { vid });
  log.info(TAG, "videoDetailInfo result", { code: r.code, likedCount: r.likedCount });
  return r;
}

// ===== 视频收藏 =====

/** 收藏/取消收藏视频（/video/sub）
 *  t: 1=收藏, 0=取消收藏
 *  id: 视频 ID */
export async function videoSub(id: number, t: 0 | 1): Promise<{ code: number }> {
  log.info(TAG, "videoSub()", { id, t });
  const r = await apiGet("/video/sub", { id, t });
  log.info(TAG, "videoSub result", { id, t, code: r.code });
  return r;
}

/** 收藏视频到视频歌单（/playlist/track/add）— 此处用 video/sub 更语义化 */
export async function collectVideo(id: number): Promise<{ code: number }> {
  return videoSub(id, 1);
}

/** 最近播放的视频（/video/recent） */
export async function videoRecent(limit = 30, offset = 0): Promise<{
  code: number;
  data?: any[];
  hasmore?: boolean;
}> {
  log.info(TAG, "videoRecent()", { limit, offset });
  const r = await apiGet("/video/recent", { limit, offset });
  log.info(TAG, "videoRecent result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

// ===== MV 收藏 =====

/** 收藏/取消收藏 MV（/mv/sub）
 *  t: 1=收藏, 0=取消收藏
 *  mvid: MV ID */
export async function mvSub(mvid: number, t: 0 | 1): Promise<{ code: number }> {
  log.info(TAG, "mvSub()", { mvid, t });
  const r = await apiGet("/mv/sub", { mvid, t });
  log.info(TAG, "mvSub result", { mvid, t, code: r.code });
  return r;
}

/** 收藏的 MV 列表（/mv/sublist） */
export async function mvSublist(limit = 25, offset = 0): Promise<{
  code: number;
  data?: any[];
  count?: number;
  hasMore?: boolean;
}> {
  log.info(TAG, "mvSublist()", { limit, offset });
  const r = await apiGet("/mv/sublist", { limit, offset });
  log.info(TAG, "mvSublist result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 获取 MV 点赞转发评论数（/mv/detail/info） */
export async function mvDetailInfo(mvid: number): Promise<{
  code: number;
  likedCount?: number;
  shareCount?: number;
  commentCount?: number;
  liked?: boolean;
}> {
  log.info(TAG, "mvDetailInfo()", { mvid });
  const r = await apiGet("/mv/detail/info", { mvid });
  log.info(TAG, "mvDetailInfo result", { code: r.code, likedCount: r.likedCount });
  return r;
}

// ===== 全部 MV / 最新 MV / 网易出品 MV =====

/** 全部 MV（/mv/all）
 *  area: ''=全部, 内地=内地, 港台=港台, 欧美=欧美, 日本=日本, 韩国=韩国
 *  type: ''=全部, 官方版=官方版, 原生=原生, 现场版=现场版, 网易出品=网易出品
 *  order: 上升最快=上升最快, 最热=最热, 最新=最新
 *  limit / offset */
export async function mvAll(params: {
  area?: string;
  type?: string;
  order?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  code: number;
  data?: any[];
  count?: number;
  hasMore?: boolean;
}> {
  const p: Record<string, string | number | boolean> = {};
  if (params.area) p.area = params.area;
  if (params.type) p.type = params.type;
  if (params.order) p.order = params.order;
  if (params.limit !== undefined) p.limit = params.limit;
  if (params.offset !== undefined) p.offset = params.offset;
  log.info(TAG, "mvAll()", p);
  const r = await apiGet("/mv/all", p);
  log.info(TAG, "mvAll result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 最新 MV（/mv/first）
 *  area: ''=全部, 内地=内地, 港台=港台, 欧美=欧美, 日本=日本, 韩国=韩国
 *  limit: 返回数量，默认 30 */
export async function mvFirst(area = "", limit = 30): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "mvFirst()", { area, limit });
  const r = await apiGet("/mv/first", { area, limit });
  log.info(TAG, "mvFirst result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 网易出品 MV（/mv/exclusive/recommend）
 *  limit: 返回数量，默认 30 */
export async function mvExclusiveRecommend(limit = 30): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "mvExclusiveRecommend()", { limit });
  const r = await apiGet("/mv/exclusive/recommend", { limit });
  log.info(TAG, "mvExclusiveRecommend result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

// ===== 视频点赞 =====

/** 资源点赞（/resource/like）
 *  t: 1=点赞, 0=取消点赞
 *  type: 1=mv, 4=电台, 5=视频, 6=动态
 *  id: 资源 ID */
export async function resourceLike(id: number, t: 0 | 1, type: number): Promise<{ code: number }> {
  log.info(TAG, "resourceLike()", { id, t, type });
  const r = await apiPost("/resource/like", { id, t, type });
  log.info(TAG, "resourceLike result", { id, t, type, code: r.code });
  return r;
}

/** 获取点赞过的视频（/playlist/mylike/video） */
export async function playlistMylikeVideo(limit = 30, offset = 0): Promise<{
  code: number;
  data?: any[];
  count?: number;
  hasMore?: boolean;
}> {
  log.info(TAG, "playlistMylikeVideo()", { limit, offset });
  const r = await apiGet("/playlist/mylike/video", { limit, offset });
  log.info(TAG, "playlistMylikeVideo result", { code: r.code, count: r.data?.length || 0 });
  return r;
}
