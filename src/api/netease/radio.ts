/**
 * 网易云音乐 电台 / DJ 相关 API
 *
 * 模块职责（高内聚）：
 *   - 电台 Banner / 分类 / 推荐 / 订阅
 *   - 电台详情 / 节目列表 / 节目详情
 *   - 电台排行榜（节目榜 / 主播榜 / 电台榜）
 *   - 付费精品 / 24小时榜单
 *
 * 依赖：core.ts（apiGet/apiPost/TAG）
 */
import { log } from "@/composables/logger";
import { apiGet, TAG } from "./core";

// ===== 电台 Banner / 个性推荐 =====

/** 电台 Banner（/dj/banner） */
export async function djBanner(): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "djBanner()");
  const r = await apiGet("/dj/banner");
  log.info(TAG, "djBanner result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 电台个性推荐（/dj/personalize/recommend） */
export async function djPersonalizeRecommend(): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "djPersonalizeRecommend()");
  const r = await apiGet("/dj/personalize/recommend");
  log.info(TAG, "djPersonalizeRecommend result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

// ===== 电台分类 =====

/** 电台分类（/dj/catelist） */
export async function djCatelist(): Promise<{
  code: number;
  categories?: Record<number, { id: number; name: string }>;
}> {
  log.info(TAG, "djCatelist()");
  const r = await apiGet("/dj/catelist");
  log.info(TAG, "djCatelist result", { code: r.code });
  return r;
}

/** 电台分类推荐（/dj/category/recommend） */
export async function djCategoryRecommend(): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "djCategoryRecommend()");
  const r = await apiGet("/dj/category/recommend");
  log.info(TAG, "djCategoryRecommend result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 电台非热门类型（/dj/category/exclude/hot） */
export async function djCategoryExcludeHot(): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "djCategoryExcludeHot()");
  const r = await apiGet("/dj/category/exclude/hot");
  log.info(TAG, "djCategoryExcludeHot result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 电台推荐类型（/dj/category/recommend） */
export async function djRecommendType(): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "djRecommendType()");
  const r = await apiGet("/dj/category/recommend");
  log.info(TAG, "djRecommendType result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

// ===== 电台详情 / 节目 =====

/** 电台详情（/dj/detail） */
export async function djDetail(rid: number): Promise<{
  code: number;
  djRadio?: {
    id: number;
    name: string;
    picUrl?: string;
    desc?: string;
    category?: string;
    subCount?: number;
    programCount?: number;
    playCount?: number;
    lastProgramId?: number;
    dj?: { userId: number; nickname: string; avatarUrl: string; brand?: string };
    [key: string]: any;
  };
}> {
  log.info(TAG, "djDetail()", { rid });
  const r = await apiGet("/dj/detail", { rid });
  log.info(TAG, "djDetail result", { code: r.code, name: r.djRadio?.name });
  return r;
}

/** 电台节目列表（/dj/program）
 *  rid: 电台 ID
 *  limit / offset
 *  asc: 排序方式，默认 false（新到旧），true 为旧到新 */
export async function djProgram(rid: number, limit = 30, offset = 0, asc = false): Promise<{
  code: number;
  programs?: any[];
  count?: number;
  more?: boolean;
}> {
  log.info(TAG, "djProgram()", { rid, limit, offset, asc });
  const r = await apiGet("/dj/program", { rid, limit, offset, asc });
  log.info(TAG, "djProgram result", { code: r.code, count: r.programs?.length || 0 });
  return r;
}

/** 电台节目详情（/dj/program/detail） */
export async function djProgramDetail(id: number): Promise<{
  code: number;
  program?: {
    id: number;
    name: string;
    djRadioId?: number;
    djBrand?: string;
    coverUrl?: string;
    description?: string;
    duration?: number;
    listenerCount?: number;
    serialNum?: number;
    createTime?: number;
    mainSong?: { id: number; name: string; duration?: number };
    [key: string]: any;
  };
}> {
  log.info(TAG, "djProgramDetail()", { id });
  const r = await apiGet("/dj/program/detail", { id });
  log.info(TAG, "djProgramDetail result", { code: r.code, name: r.program?.name });
  return r;
}

/** 电台今日优选（/dj/today/perfered） */
export async function djTodayPerfered(): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "djTodayPerfered()");
  const r = await apiGet("/dj/today/perfered");
  log.info(TAG, "djTodayPerfered result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 电台推荐（/dj/recommend） */
export async function djRecommend(): Promise<{
  code: number;
  djRadios?: any[];
  data?: any[];
}> {
  log.info(TAG, "djRecommend()");
  const r = await apiGet("/dj/recommend");
  log.info(TAG, "djRecommend result", { code: r.code, count: r.djRadios?.length || r.data?.length || 0 });
  return r;
}

// ===== 电台订阅 =====

/** 订阅/取消订阅电台（/dj/sub）
 *  t: 1=订阅, 0=取消订阅
 *  rid: 电台 ID */
export async function djSub(rid: number, t: 0 | 1): Promise<{ code: number }> {
  log.info(TAG, "djSub()", { rid, t });
  const r = await apiGet("/dj/sub", { rid, t });
  log.info(TAG, "djSub result", { rid, t, code: r.code });
  return r;
}

/** 电台订阅者列表（/dj/subscriber） */
export async function djSubscriber(rid: number, limit = 20, offset = 0): Promise<{
  code: number;
  subscribers?: any[];
  count?: number;
  more?: boolean;
}> {
  log.info(TAG, "djSubscriber()", { rid, limit, offset });
  const r = await apiGet("/dj/subscriber", { rid, limit, offset });
  log.info(TAG, "djSubscriber result", { code: r.code, count: r.subscribers?.length || 0 });
  return r;
}

/** 用户电台（/user/dj） */
export async function userDj(uid: number, limit = 30, offset = 0): Promise<{
  code: number;
  djRadios?: any[];
  count?: number;
  more?: boolean;
}> {
  log.info(TAG, "userDj()", { uid, limit, offset });
  const r = await apiGet("/user/dj", { uid, limit, offset });
  log.info(TAG, "userDj result", { code: r.code, count: r.djRadios?.length || 0 });
  return r;
}

// ===== 电台排行榜 =====

/** 电台 - 节目榜（/dj/program/toplist） */
export async function djProgramToplist(limit = 100, offset = 0): Promise<{
  code: number;
  list?: any[];
  count?: number;
  more?: boolean;
}> {
  log.info(TAG, "djProgramToplist()", { limit, offset });
  const r = await apiGet("/dj/program/toplist", { limit, offset });
  log.info(TAG, "djProgramToplist result", { code: r.code, count: r.list?.length || 0 });
  return r;
}

/** 电台 - 付费精品（/dj/toplist/pay） */
export async function djToplistPay(limit = 100, offset = 0): Promise<{
  code: number;
  list?: any[];
  count?: number;
  more?: boolean;
}> {
  log.info(TAG, "djToplistPay()", { limit, offset });
  const r = await apiGet("/dj/toplist/pay", { limit, offset });
  log.info(TAG, "djToplistPay result", { code: r.code, count: r.list?.length || 0 });
  return r;
}

/** 电台 - 24小时节目榜（/dj/program/toplist/hours） */
export async function djProgramToplistHours(limit = 100): Promise<{
  code: number;
  data?: { list?: any[]; total?: number };
}> {
  log.info(TAG, "djProgramToplistHours()", { limit });
  const r = await apiGet("/dj/program/toplist/hours", { limit });
  log.info(TAG, "djProgramToplistHours result", { code: r.code, count: r.data?.list?.length || 0 });
  return r;
}

/** 电台 - 24小时主播榜（/dj/toplist/hours） */
export async function djToplistHours(limit = 100): Promise<{
  code: number;
  data?: { list?: any[]; total?: number };
}> {
  log.info(TAG, "djToplistHours()", { limit });
  const r = await apiGet("/dj/toplist/hours", { limit });
  log.info(TAG, "djToplistHours result", { code: r.code, count: r.data?.list?.length || 0 });
  return r;
}

/** 电台 - 主播新人榜（/dj/toplist/newcomer） */
export async function djToplistNewcomer(limit = 100): Promise<{
  code: number;
  data?: { list?: any[]; total?: number };
}> {
  log.info(TAG, "djToplistNewcomer()", { limit });
  const r = await apiGet("/dj/toplist/newcomer", { limit });
  log.info(TAG, "djToplistNewcomer result", { code: r.code, count: r.data?.list?.length || 0 });
  return r;
}

/** 电台 - 最热主播榜（/dj/toplist/popular） */
export async function djToplistPopular(limit = 100): Promise<{
  code: number;
  data?: { list?: any[]; total?: number };
}> {
  log.info(TAG, "djToplistPopular()", { limit });
  const r = await apiGet("/dj/toplist/popular", { limit });
  log.info(TAG, "djToplistPopular result", { code: r.code, count: r.data?.list?.length || 0 });
  return r;
}

/** 电台 - 新晋电台榜/热门电台榜（/dj/toplist）
 *  type: new=新晋, hot=热门 */
export async function djToplist(type: "new" | "hot" = "hot", limit = 100, offset = 0): Promise<{
  code: number;
  topList?: any[];
  count?: number;
  more?: boolean;
}> {
  log.info(TAG, "djToplist()", { type, limit, offset });
  const r = await apiGet("/dj/toplist", { type, limit, offset });
  log.info(TAG, "djToplist result", { code: r.code, count: r.topList?.length || 0 });
  return r;
}

/** 电台 - 类别热门电台（/dj/radio/hot）
 *  cateId: 分类 ID
 *  limit / offset */
export async function djRadioHot(cateId: number, limit = 30, offset = 0): Promise<{
  code: number;
  djRadios?: any[];
  count?: number;
  more?: boolean;
}> {
  log.info(TAG, "djRadioHot()", { cateId, limit, offset });
  const r = await apiGet("/dj/radio/hot", { cateId, limit, offset });
  log.info(TAG, "djRadioHot result", { code: r.code, count: r.djRadios?.length || 0 });
  return r;
}

/** 热门电台（/dj/hot） */
export async function djHot(limit = 30, offset = 0): Promise<{
  code: number;
  djRadios?: any[];
  count?: number;
  more?: boolean;
}> {
  log.info(TAG, "djHot()", { limit, offset });
  const r = await apiGet("/dj/hot", { limit, offset });
  log.info(TAG, "djHot result", { code: r.code, count: r.djRadios?.length || 0 });
  return r;
}

/** 电台 - 付费精选（/dj/toplist/paygift） */
export async function djToplistPaygift(limit = 30, offset = 0): Promise<{
  code: number;
  list?: any[];
  count?: number;
  more?: boolean;
}> {
  log.info(TAG, "djToplistPaygift()", { limit, offset });
  const r = await apiGet("/dj/toplist/paygift", { limit, offset });
  log.info(TAG, "djToplistPaygift result", { code: r.code, count: r.list?.length || 0 });
  return r;
}
