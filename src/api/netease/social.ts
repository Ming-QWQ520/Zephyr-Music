/**
 * 网易云音乐 社交相关 API
 *
 * 模块职责（高内聚）：
 *   - 私信（发送/列表/最近联系人）
 *   - 通知（评论通知/@我通知/系统通知）
 *   - 关注/取消关注用户
 *   - 用户动态（获取/转发/删除/分享）
 *   - 用户粉丝列表 / 关注列表
 *   - 热门话题 / 话题详情
 *
 * 依赖：core.ts（apiGet/apiPost/TAG）
 */
import { log } from "@/composables/logger";
import { apiGet, apiPost, TAG } from "./core";

// ===== 私信 =====

/** 发送私信（/send/text）
 *  user_ids: 用户 ID，多个用逗号隔开
 *  msg: 要发送的信息
 *  注意：不能发送私信给自己
 *  接口返回内容为历史私信，包含带歌单的私信信息 */
export async function sendText(user_ids: string, msg: string): Promise<{ code: number }> {
  log.info(TAG, "sendText()", { user_ids, msgLen: msg.length });
  const r = await apiPost("/send/text", { user_ids, msg });
  log.info(TAG, "sendText result", { code: r.code });
  return r;
}

/** 发送私信(带歌曲)（/send/song） */
export async function sendSong(userids: string, id: number, msg?: string): Promise<{ code: number }> {
  const p: Record<string, string | number | boolean> = { userids, id };
  if (msg) p.msg = msg;
  log.info(TAG, "sendSong()", { userids, id });
  const r = await apiPost("/send/song", p);
  log.info(TAG, "sendSong result", { code: r.code });
  return r;
}

/** 发送私信(带专辑)（/send/album） */
export async function sendAlbum(userids: string, id: number, msg?: string): Promise<{ code: number }> {
  const p: Record<string, string | number | boolean> = { userids, id };
  if (msg) p.msg = msg;
  log.info(TAG, "sendAlbum()", { userids, id });
  const r = await apiPost("/send/album", p);
  log.info(TAG, "sendAlbum result", { code: r.code });
  return r;
}

/** 发送私信(带歌单)（/send/playlist） */
export async function sendPlaylist(userids: string, id: number, msg?: string): Promise<{ code: number }> {
  const p: Record<string, string | number | boolean> = { userids, id };
  if (msg) p.msg = msg;
  log.info(TAG, "sendPlaylist()", { userids, id });
  const r = await apiPost("/send/playlist", p);
  log.info(TAG, "sendPlaylist result", { code: r.code });
  return r;
}

/** 私信列表（/msg/private）
 *  登录后调用此接口，可获取有私信对话的联系人列表（含最后消息预览）
 *  注意：必须使用此接口获取联系人，不要使用 msgRecentContact！
 *    msgRecentContact 返回的是关注列表联系人，不一定有私信记录
 *  normalizeResponse 会自动处理 data 层解包（有则解包，无则原样返回），返回结构为：
 *    msgs: 会话数组（每个含 fromUser, toUser, lastMsg, lastMsgTime, newMsgCount 等）
 *    more: 是否有更多
 *    newMsgCount: 新消息总数 */
export async function msgPrivate(limit = 30, offset = 0): Promise<{
  code: number;
  msgs?: any[];
  more?: boolean;
  newMsgCount?: number;
}> {
  const p: Record<string, string | number | boolean> = { limit };
  if (offset) p.offset = offset;
  log.info(TAG, "msgPrivate()", { limit, offset });
  const r = await apiGet("/msg/private", p);
  log.info(TAG, "msgPrivate result", { code: r.code, count: r.msgs?.length || 0 });
  return r;
}

/** 最近联系人（/msg/recentcontact）
 *  normalizeResponse 自动解包 data 层，返回结构为：
 *    follow: 联系人数组（每个含 userId, nickname, avatarUrl, py, mutual, onlined 等） */
export async function msgRecentContact(): Promise<{
  code: number;
  follow?: any[];
}> {
  log.info(TAG, "msgRecentContact()");
  const r = await apiGet("/msg/recentcontact");
  log.info(TAG, "msgRecentContact result", { code: r.code, count: r.follow?.length || 0 });
  return r;
}

/** 私信内容（/msg/private/history）
 *  uid: 用户 ID（必选）
 *  limit: 返回数量，默认 30
 *  before: 分页参数，取上一页最后一项的 time 获取下一页数据
 *  normalizeResponse 不解包（无 data 层），返回结构为：
 *    msgs: 消息数组（每个含 fromUser, toUser, msg, time, id 等）
 *    more: 是否有更多
 *    注意：msg 字段是 JSON 字符串，需 JSON.parse 提取实际文本 */
export async function msgPrivateHistory(uid: number, limit = 30, before?: number): Promise<{
  code: number;
  msgs?: any[];
  more?: boolean;
}> {
  const p: Record<string, string | number | boolean> = { uid, limit };
  if (before !== undefined) p.before = before;
  log.info(TAG, "msgPrivateHistory()", { uid, limit, before });
  const r = await apiGet("/msg/private/history", p);
  log.info(TAG, "msgPrivateHistory result", { code: r.code, count: r.msgs?.length || 0 });
  return r;
}

// ===== 通知 =====

/** 通知 - 评论（/msg/comments）
 *  uid: 用户 ID
 *  limit / offset */
export async function msgComments(uid: number, limit = 30, offset = 0): Promise<{
  code: number;
  comments?: any[];
  more?: boolean;
}> {
  log.info(TAG, "msgComments()", { uid, limit, offset });
  const r = await apiGet("/msg/comments", { uid, limit, offset });
  log.info(TAG, "msgComments result", { code: r.code, count: r.comments?.length || 0 });
  return r;
}

/** 通知 - @我（/msg/forwards）
 *  uid: 用户 ID
 *  limit / offset */
export async function msgForwards(uid: number, limit = 30, offset = 0): Promise<{
  code: number;
  forwards?: any[];
  more?: boolean;
}> {
  log.info(TAG, "msgForwards()", { uid, limit, offset });
  const r = await apiGet("/msg/forwards", { uid, limit, offset });
  log.info(TAG, "msgForwards result", { code: r.code, count: r.forwards?.length || 0 });
  return r;
}

/** 通知 - 通知（/msg/notices）
 *  limit / offset */
export async function msgNotices(limit = 30, offset = 0): Promise<{
  code: number;
  notices?: any[];
  more?: boolean;
}> {
  log.info(TAG, "msgNotices()", { limit, offset });
  const r = await apiGet("/msg/notices", { limit, offset });
  log.info(TAG, "msgNotices result", { code: r.code, count: r.notices?.length || 0 });
  return r;
}

// ===== 关注 / 粉丝 =====

/** 关注/取消关注用户（/user/follow）
 *  t: 1=关注, 0=取消关注
 *  id: 用户 ID */
export async function userFollow(id: number, t: 0 | 1): Promise<{ code: number }> {
  log.info(TAG, "userFollow()", { id, t });
  const r = await apiGet("/user/follow", { id, t });
  log.info(TAG, "userFollow result", { id, t, code: r.code });
  return r;
}

/** 获取用户关注列表（/user/follows）
 *  uid: 用户 ID
 *  limit / offset */
export async function userFollows(uid: number, limit = 30, offset = 0): Promise<{
  code: number;
  follow?: { userId: number; nickname: string; avatarUrl: string; signature?: string }[];
  more?: boolean;
}> {
  log.info(TAG, "userFollows()", { uid, limit, offset });
  const r = await apiGet("/user/follows", { uid, limit, offset });
  log.info(TAG, "userFollows result", { code: r.code, count: r.follow?.length || 0 });
  return r;
}

/** 获取用户粉丝列表（/user/followeds）
 *  uid: 用户 ID
 *  limit / offset */
export async function userFolloweds(uid: number, limit = 30, offset = 0): Promise<{
  code: number;
  followeds?: { userId: number; nickname: string; avatarUrl: string; signature?: string }[];
  more?: boolean;
}> {
  log.info(TAG, "userFolloweds()", { uid, limit, offset });
  const r = await apiGet("/user/followeds", { uid, limit, offset });
  log.info(TAG, "userFolloweds result", { code: r.code, count: r.followeds?.length || 0 });
  return r;
}

/** 用户是否互相关注（/user/followed/check）
 *  uid: 目标用户 ID */
export async function userFollowedCheck(uid: number): Promise<{
  code: number;
  followed?: boolean;
}> {
  log.info(TAG, "userFollowedCheck()", { uid });
  const r = await apiGet("/user/followed/check", { uid });
  log.info(TAG, "userFollowedCheck result", { code: r.code, followed: r.followed });
  return r;
}

// ===== 用户动态 =====

/** 获取用户动态（/user/event）
 *  uid: 用户 ID
 *  limit / lasttime: 上次返回的 lasttime */
export async function userEvent(uid: number, limit = 30, lasttime?: number): Promise<{
  code: number;
  events?: any[];
  lasttime?: number;
  more?: boolean;
}> {
  const p: Record<string, string | number | boolean> = { uid, limit };
  if (lasttime !== undefined) p.lasttime = lasttime;
  log.info(TAG, "userEvent()", { uid, limit });
  const r = await apiGet("/user/event", p);
  log.info(TAG, "userEvent result", { code: r.code, count: r.events?.length || 0 });
  return r;
}

/** 转发用户动态（/event/forward）
 *  id: 动态 ID
 *  uid: 用户 ID */
export async function eventForward(id: number, uid: number): Promise<{ code: number }> {
  log.info(TAG, "eventForward()", { id, uid });
  const r = await apiGet("/event/forward", { id, uid });
  log.info(TAG, "eventForward result", { code: r.code });
  return r;
}

/** 删除用户动态（/event/del）
 *  id: 动态 ID */
export async function eventDel(id: number): Promise<{ code: number }> {
  log.info(TAG, "eventDel()", { id });
  const r = await apiGet("/event/del", { id });
  log.info(TAG, "eventDel result", { code: r.code });
  return r;
}

/** 分享文本、歌曲、歌单、MV、电台到动态（/share/resource）
 *  id: 资源 ID
 *  type: song/playlist/mv/djradio/djprogram
 *  msg: 分享文字 */
export async function shareResource(id: number, type: string, msg?: string): Promise<{ code: number }> {
  const p: Record<string, string | number | boolean> = { id, type };
  if (msg) p.msg = msg;
  log.info(TAG, "shareResource()", { id, type });
  const r = await apiGet("/share/resource", p);
  log.info(TAG, "shareResource result", { code: r.code });
  return r;
}

/** 获取动态列表（/event/list） */
export async function eventList(limit = 30, lasttime?: number): Promise<{
  code: number;
  event?: any[];
  lasttime?: number;
  more?: boolean;
}> {
  const p: Record<string, string | number | boolean> = { limit };
  if (lasttime !== undefined) p.lasttime = lasttime;
  log.info(TAG, "eventList()", { limit });
  const r = await apiGet("/event/list", p);
  log.info(TAG, "eventList result", { code: r.code, count: r.event?.length || 0 });
  return r;
}

// ===== 热门话题 =====

/** 获取热门话题（/hot/topic）
 *  limit / offset */
export async function hotTopic(limit = 30, offset = 0): Promise<{
  code: number;
  hot?: any[];
}> {
  log.info(TAG, "hotTopic()", { limit, offset });
  const r = await apiGet("/hot/topic", { limit, offset });
  log.info(TAG, "hotTopic result", { code: r.code, count: r.hot?.length || 0 });
  return r;
}

/** 获取话题详情（/topic/detail）
 *  actid: 话题 ID */
export async function topicDetail(actid: number): Promise<{
  code: number;
  act?: any;
}> {
  log.info(TAG, "topicDetail()", { actid });
  const r = await apiGet("/topic/detail", { actid });
  log.info(TAG, "topicDetail result", { code: r.code, hasAct: !!r.act });
  return r;
}

/** 获取话题详情热门动态（/topic/detail/event/hot）
 *  actid: 话题 ID */
export async function topicDetailEventHot(actid: number, limit = 20): Promise<{
  code: number;
  events?: any[];
  more?: boolean;
}> {
  log.info(TAG, "topicDetailEventHot()", { actid });
  const r = await apiGet("/topic/detail/event/hot", { actid, limit });
  log.info(TAG, "topicDetailEventHot result", { code: r.code, count: r.events?.length || 0 });
  return r;
}
