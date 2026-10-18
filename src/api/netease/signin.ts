/**
 * 网易云音乐 签到 / 云贝 / 任务 相关 API
 *
 * 模块职责（高内聚）：
 *   - 每日签到 / 签到进度
 *   - 乐签信息
 *   - 云贝签到 / 账户 / 任务 / 收入支出
 *   - 云贝推歌 / 推歌历史
 *   - 黑胶乐签打卡 / 乐签详情
 *   - 音乐人签到
 *   - VIP 成长值 / VIP 任务
 *
 * 依赖：core.ts（apiGet/apiPost/TAG）
 */
import { log } from "@/composables/logger";
import { apiGet, apiPost, TAG } from "./core";

// ===== 每日签到 =====

/** 签到（/daily_signin）POST
 *  type: 0=安卓, 1=PC（默认 0，安卓端签到可获得 3 点经验）
 *  安卓端签到可获得 3 点经验，web/PC 端签到可获得 2 点经验 */
export async function dailySignin(type = 0): Promise<{ code: number; point?: number }> {
  log.info(TAG, "dailySignin()", { type });
  const r = await apiPost("/daily_signin", { type });
  log.info(TAG, "dailySignin result", { code: r.code, point: r.point });
  return r;
}

/** 签到进度（/signin/progress）
 *  可选参数 moduleId: 模块 id，默认为 '1207signin-1207signin' */
export async function signinProgress(moduleId = "1207signin-1207signin"): Promise<{
  code: number;
  data?: any;
}> {
  log.info(TAG, "signinProgress()", { moduleId });
  const r = await apiGet("/signin/progress", { moduleId });
  log.info(TAG, "signinProgress result", { code: r.code });
  return r;
}

// ===== 乐签 =====

/** 乐签信息（/sign/happy/info）
 *  获取乐签信息 */
export async function signHappyInfo(): Promise<{
  code: number;
  data?: any;
}> {
  log.info(TAG, "signHappyInfo()");
  const r = await apiGet("/sign/happy/info");
  log.info(TAG, "signHappyInfo result", { code: r.code });
  return r;
}

// ===== 云贝 =====

/** 云贝签到信息（/yunbei）
 *  获取连续签到天数、第二天全部可获得的云贝 */
export async function yunbeiSignInfo(): Promise<{
  code: number;
  data?: any;
}> {
  log.info(TAG, "yunbeiSignInfo()");
  const r = await apiGet("/yunbei");
  log.info(TAG, "yunbeiSignInfo result", { code: r.code });
  return r;
}

/** 云贝今日签到信息（/yunbei/today）
 *  获取今日签到获取的云贝数 */
export async function yunbeiToday(): Promise<{
  code: number;
  data?: any;
}> {
  log.info(TAG, "yunbeiToday()");
  const r = await apiGet("/yunbei/today");
  log.info(TAG, "yunbeiToday result", { code: r.code });
  return r;
}

/** 云贝签到（/yunbei/sign）POST
 *  登录后调用此接口可进行云贝签到 */
export async function yunbeiSign(): Promise<{ code: number }> {
  log.info(TAG, "yunbeiSign()");
  const r = await apiPost("/yunbei/sign");
  log.info(TAG, "yunbeiSign result", { code: r.code });
  return r;
}

/** 云贝账户信息（/yunbei/info）
 *  登录后调用此接口可获取云贝账户信息
 *  响应结构：
 *    - userPoint.balance: 云贝总数
 *    - mobileSign: 安卓端是否已签到
 *    - pcSign: PC端是否已签到
 *    - level: 云贝等级
 *    - viptype: VIP 类型
 *    - expiretime: VIP 过期时间
 */
export async function yunbeiAccount(): Promise<{
  code: number;
  level?: number;
  userPoint?: {
    balance?: number;
    blockBalance?: number;
    status?: number;
    updateTime?: number;
    userId?: number;
    version?: number;
  };
  mobileSign?: boolean;
  pcSign?: boolean;
  viptype?: number;
  expiretime?: number;
  [key: string]: any;
}> {
  log.info(TAG, "yunbeiAccount()");
  const r = await apiPost("/yunbei/info");
  log.info(TAG, "yunbeiAccount result", { code: r.code, balance: r.userPoint?.balance, mobileSign: r.mobileSign, pcSign: r.pcSign });
  return r;
}

/** 云贝所有任务（/yunbei/tasks） */
export async function yunbeiTasks(): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "yunbeiTasks()");
  const r = await apiGet("/yunbei/tasks");
  log.info(TAG, "yunbeiTasks result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 云贝 todo 任务（/yunbei/tasks/todo） */
export async function yunbeiTasksTodo(): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "yunbeiTasksTodo()");
  const r = await apiGet("/yunbei/tasks/todo");
  log.info(TAG, "yunbeiTasksTodo result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 云贝完成任务（/yunbei/task/finish）
 *  userTaskId: 任务 ID（必选）
 *  depositCode: 任务 depositCode（可选） */
export async function yunbeiTaskFinish(userTaskId: number, depositCode?: string): Promise<{ code: number }> {
  log.info(TAG, "yunbeiTaskFinish()", { userTaskId, depositCode });
  const r = await apiGet("/yunbei/task/finish", { userTaskId, ...(depositCode ? { depositCode } : {}) });
  log.info(TAG, "yunbeiTaskFinish result", { userTaskId, code: r.code });
  return r;
}

/** 云贝收入（/yunbei/tasks/receipt）
 *  limit: 取出数量，默认为 10
 *  offset: 偏移数量，用于分页 */
export async function yunbeiReceipt(limit = 10, offset = 0): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "yunbeiReceipt()", { limit, offset });
  const r = await apiGet("/yunbei/tasks/receipt", { limit, offset });
  log.info(TAG, "yunbeiReceipt result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 云贝支出（/yunbei/tasks/expense）
 *  limit: 取出数量，默认为 10
 *  offset: 偏移数量，用于分页 */
export async function yunbeiExpense(limit = 10, offset = 0): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "yunbeiExpense()", { limit, offset });
  const r = await apiGet("/yunbei/tasks/expense", { limit, offset });
  log.info(TAG, "yunbeiExpense result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

// ===== 云贝推歌 =====

/** 云贝推歌（/yunbei/rcmd/song）
 *  id: 歌曲 ID（必选）
 *  reason: 推歌理由（可选）
 *  yunbeiNum: 云贝数量，默认 10（可选） */
export async function yunbeiRcmdSong(id: number, reason?: string, yunbeiNum?: number): Promise<{ code: number }> {
  log.info(TAG, "yunbeiRcmdSong()", { id, reason, yunbeiNum });
  const r = await apiGet("/yunbei/rcmd/song", { id, ...(reason ? { reason } : {}), ...(yunbeiNum ? { yunbeiNum } : {}) });
  log.info(TAG, "yunbeiRcmdSong result", { id, code: r.code });
  return r;
}

/** 云贝推歌历史记录（/yunbei/rcmd/song/history）
 *  size: 返回数量，默认为 20
 *  cursor: 返回数据的 cursor，传入上一次返回结果的 cursor 可翻页 */
export async function yunbeiRcmdSongHistory(size = 20, cursor = ""): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "yunbeiRcmdSongHistory()", { size, cursor });
  const r = await apiGet("/yunbei/rcmd/song/history", { size, cursor });
  log.info(TAG, "yunbeiRcmdSongHistory result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

// ===== 音乐人签到 =====

/** 音乐人签到（/musician/sign）
 *  音乐人登录后调用此接口，可以完成"登录音乐人中心"任务
 *  然后通过 /musician/cloudbean/obtain 接口可以领取相应的云豆 */
export async function musicianSign(): Promise<{ code: number }> {
  log.info(TAG, "musicianSign()");
  const r = await apiPost("/musician/sign");
  log.info(TAG, "musicianSign result", { code: r.code });
  return r;
}

// ===== 黑胶乐签 =====

/** 黑胶乐签打卡（/vip/sign）
 *  登录后调用此接口，进行黑胶乐签打卡 */
export async function vipSign(): Promise<{ code: number }> {
  log.info(TAG, "vipSign()");
  const r = await apiPost("/vip/sign");
  log.info(TAG, "vipSign result", { code: r.code });
  return r;
}

/** 黑胶乐签未来打卡信息（/vip/sign/info）
 *  获取黑胶乐签打卡信息 */
export async function vipSignInfo(): Promise<{
  code: number;
  data?: any;
}> {
  log.info(TAG, "vipSignInfo()");
  const r = await apiGet("/vip/sign/info");
  log.info(TAG, "vipSignInfo result", { code: r.code });
  return r;
}

/** 黑胶乐签详情（/vip/sign/detail）
 *  timestamp: 时间戳（毫秒），不传入会出现随机的乐签详情 */
export async function vipSignDetail(timestamp?: number): Promise<{
  code: number;
  data?: any;
}> {
  log.info(TAG, "vipSignDetail()", { timestamp });
  const r = await apiGet("/vip/sign/detail", { ...(timestamp ? { timestamp } : {}) });
  log.info(TAG, "vipSignDetail result", { code: r.code });
  return r;
}

/** 黑胶乐签历史（/vip/sign/history） */
export async function vipSignHistory(): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "vipSignHistory()");
  const r = await apiGet("/vip/sign/history");
  log.info(TAG, "vipSignHistory result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

// ===== 用户贡献 / 积分 / 云贝 =====

/** 用户贡献条目、积分、云贝数量（/ugc/user/devote）
 *  登录后调用此接口可获取当前登录用户贡献条目、积分、云贝数量 */
export async function ugcUserDevote(): Promise<{
  code: number;
  data?: any;
}> {
  log.info(TAG, "ugcUserDevote()");
  const r = await apiGet("/ugc/user/devote");
  log.info(TAG, "ugcUserDevote result", { code: r.code });
  return r;
}

// ===== VIP 成长值 =====

/** VIP 成长值（/vip/growthpoint）
 *  登录后调用此接口，可获取当前会员成长值
 *  normalizeResponse 会自动解包 data 层，返回结构为：
 *    userLevel.growthPoint — 当前成长值
 *    userLevel.level       — VIP 等级
 *    userLevel.levelName   — 等级名称，如 "黑胶·叁"
 *    levelCard             — 等级卡片信息
 */
export async function vipGrowthpoint(): Promise<{
  code: number;
  userLevel?: {
    growthPoint?: number;
    level?: number;
    levelName?: string;
    [key: string]: any;
  };
  levelCard?: any;
  [key: string]: any;
}> {
  log.info(TAG, "vipGrowthpoint()");
  const r = await apiGet("/vip/growthpoint");
  log.info(TAG, "vipGrowthpoint result", { code: r.code, growthPoint: r.userLevel?.growthPoint, level: r.userLevel?.level });
  return r;
}

/** VIP 成长值获取记录（/vip/growthpoint/details）
 *  limit: 取出数量，默认为 20
 *  offset: 偏移数量，用于分页 */
export async function vipGrowthpointDetails(limit = 20, offset = 0): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "vipGrowthpointDetails()", { limit, offset });
  const r = await apiGet("/vip/growthpoint/details", { limit, offset });
  log.info(TAG, "vipGrowthpointDetails result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** VIP 任务（/vip/tasks）
 *  登录后调用此接口，可获取会员任务
 *  返回的 unGetIds 可用于 /vip/growthpoint/get 领取成长值
 *  normalizeResponse 会自动解包 data 层，unGetIds 可能在顶层或 data 中 */
export async function vipTasks(): Promise<{
  code: number;
  data?: any;
  unGetIds?: string[] | string;
  [key: string]: any;
}> {
  log.info(TAG, "vipTasks()");
  const r = await apiGet("/vip/tasks");
  log.info(TAG, "vipTasks result", { code: r.code, unGetIds: r.unGetIds || r.data?.unGetIds });
  return r;
}

/** 领取 VIP 成长值（/vip/growthpoint/get）
 *  登录后调用此接口，可获取已完成的会员任务的成长值奖励
 *  ids: 通过 /vip/tasks 获取到的 unGetIds，多个用逗号分隔 */
export async function vipGrowthpointGet(ids: string): Promise<{ code: number }> {
  log.info(TAG, "vipGrowthpointGet()", { ids });
  const r = await apiPost("/vip/growthpoint/get", { ids });
  log.info(TAG, "vipGrowthpointGet result", { code: r.code });
  return r;
}
