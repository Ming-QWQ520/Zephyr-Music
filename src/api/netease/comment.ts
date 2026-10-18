/** 网易云评论 / 收藏者 API */
import { log } from "@/composables/logger";
import { apiGet, apiPost, TAG } from "./core";
import type { PlaylistComment, PlaylistSubscriber } from "@/types";

/** 歌单评论（/comment/playlist，旧版） */
export async function commentPlaylist(id: number, limit = 20, offset = 0): Promise<{
  code: number; total?: number; hotComments?: PlaylistComment[]; comments?: PlaylistComment[]; more?: boolean; moreHot?: boolean;
}> {
  const params: Record<string, string | number> = { id, limit, offset };
  log.info(TAG, "commentPlaylist()", { id, limit, offset });
  const r = await apiGet("/comment/playlist", params);
  log.info(TAG, "commentPlaylist result", { code: r.code, total: r.total, count: r.comments?.length || 0 });
  return r;
}

/** 新版评论接口（/comment/new）
 *  支持歌曲/MV/歌单/专辑/电台/视频等资源评论，支持排序方式
 *  type: 0=歌曲, 1=mv, 2=歌单, 3=专辑, 4=电台节目, 5=视频, 6=动态, 7=电台
 *  sortType: 1=按推荐排序, 2=按热度排序, 3=按时间排序
 *  cursor: sortType=3 且非第一页时需传入，值为上一条数据的 time
 *  pageNo: 页码，默认 1
 *  pageSize: 每页条数，默认 20
 */
export interface CommentUser {
  userId: number;
  nickname: string;
  avatarUrl: string;
}

export interface NewComment {
  commentId: number;
  content: string;
  time: number;
  likedCount: number;
  /** 当前登录用户是否已点赞该评论（由 API 返回，用于回显点赞态） */
  liked: boolean;
  /** 当前登录用户是否为该评论作者（用于控制删除按钮显示） */
  owner: boolean;
  /** 评论者所在地（从 ipLocation.location 提取的纯字符串） */
  ipLocation?: string;
  user: CommentUser;
  /** 接口随主评论返回的回复预览。 */
  beReplied: NewComment[];
  /** 楼层回复总数，用于决定是否展示“查看回复”。 */
  replyCount: number;
}

function mapComment(comment: any, includeReplies = true): NewComment {
  const replies = includeReplies && Array.isArray(comment?.beReplied)
    ? comment.beReplied.map((reply: any) => mapComment(reply, false))
    : [];
  return {
    commentId: Number(comment?.commentId) || 0,
    content: String(comment?.content || ""),
    time: Number(comment?.time) || 0,
    likedCount: Number(comment?.likedCount) || 0,
    liked: comment?.liked === true,
    owner: comment?.owner === true,
    ipLocation: comment?.ipLocation?.location || comment?.user?.locationInfo?.location || "",
    user: {
      userId: Number(comment?.user?.userId) || 0,
      nickname: String(comment?.user?.nickname || "未知用户"),
      avatarUrl: String(comment?.user?.avatarUrl || ""),
    },
    beReplied: replies,
    replyCount: Math.max(
      Number(comment?.showFloorComment?.replyCount) || 0,
      Number(comment?.replyCount) || 0,
      replies.length,
    ),
  };
}

export async function commentNew(
  id: number,
  type: number,
  sortType: 1 | 2 | 3 = 1,
  pageNo = 1,
  pageSize = 20,
  cursor?: number
): Promise<{
  code: number;
  totalCount?: number;
  comments?: NewComment[];
  hasMore?: boolean;
  sortType?: number;
  cursor?: number;
}> {
  const params: Record<string, string | number> = { id, type, sortType, pageNo, pageSize };
  if (cursor !== undefined && sortType === 3) params.cursor = cursor;
  log.info(TAG, "commentNew()", { id, type, sortType, pageNo, pageSize, cursor });
  const r = await apiGet<{
    code: number;
    totalCount?: number;
    comments?: any[];
    hasMore?: boolean;
    cursor?: number;
  }>("/comment/new", params);
  // 提取 ipLocation.location 字符串（API 返回的是 {ip, location, userId} 对象）
  // liked/owner 由 API 在登录态下返回，用于回显点赞状态和控制删除权限
  const comments: NewComment[] = (r.comments || []).map((comment: any) => mapComment(comment));
  log.info(TAG, "commentNew result", {
    code: r.code,
    totalCount: r.totalCount,
    count: comments.length,
    hasMore: r.hasMore,
  });
  return {
    code: r.code,
    totalCount: r.totalCount,
    comments,
    hasMore: r.hasMore,
    cursor: r.cursor ?? comments[comments.length - 1]?.time,
  };
}

export interface CommentFloorResult {
  code: number;
  totalCount: number;
  comments: NewComment[];
  hasMore: boolean;
  time?: number;
  ownerComment?: NewComment;
}

/**
 * 楼层评论（/comment/floor）。
 * time 为上一页最后一条回复的时间，用于继续分页。
 */
export async function commentFloor(
  id: number,
  parentCommentId: number,
  type: number,
  limit = 20,
  time?: number,
): Promise<CommentFloorResult> {
  const params: Record<string, string | number> = { id, parentCommentId, type, limit };
  if (time !== undefined) params.time = time;
  log.info(TAG, "commentFloor()", { id, parentCommentId, type, limit, time });
  const r = await apiGet<{
    code: number;
    totalCount?: number;
    comments?: any[];
    hasMore?: boolean;
    time?: number;
    ownerComment?: any;
  }>("/comment/floor", params);
  const comments = (r.comments || []).map(comment => mapComment(comment));
  return {
    code: r.code,
    totalCount: Number(r.totalCount) || comments.length,
    comments,
    hasMore: !!r.hasMore,
    time: r.time ?? comments[comments.length - 1]?.time,
    ownerComment: r.ownerComment ? mapComment(r.ownerComment) : undefined,
  };
}

/** 歌单收藏者（/playlist/subscribers） */
export async function playlistSubscribers(id: number, limit = 20, offset = 0): Promise<{
  code: number; total?: number; subscribers?: PlaylistSubscriber[]; more?: boolean;
}> {
  log.info(TAG, "playlistSubscribers()", { id, limit, offset });
  const r = await apiGet("/playlist/subscribers", { id, limit, offset });
  log.info(TAG, "playlistSubscribers result", { code: r.code, count: r.subscribers?.length || 0 });
  return r;
}

/** 发送/回复/删除评论（/comment）
 *  t: 1=发送, 2=回复, 0=删除
 *  type: 0=歌曲, 1=mv, 2=歌单, 3=专辑, 4=电台节目, 5=视频, 6=动态, 7=电台
 *  id: 资源 ID
 *  content: 发送/回复的内容（删除时不需要）
 *  commentId: 回复评论的 ID（回复时必填）或删除评论的 ID（删除时必填）
 *  注：网易云对评论接口有风控，code=250 表示需要切换到移动端
 *      通过添加 os=android 参数模拟移动端请求绕过风控
 */
export interface CommentActionResult {
  code: number;
  commentId?: number;
  comment?: NewComment;
  msg?: string;
  message?: string;
  dialog?: { title?: string; subtitle?: string };
}

export async function commentAction(
  t: 0 | 1 | 2,
  type: number,
  id: number,
  content?: string,
  commentId?: number
): Promise<CommentActionResult> {
  const params: Record<string, string | number> = { t, type, id };
  if (content) params.content = content;
  if (commentId !== undefined) params.commentId = commentId;
  // 添加 os=android 模拟移动端，绕过"请切换至移动端"风控
  params.os = "android";
  log.info(TAG, "commentAction()", { t, type, id, hasContent: !!content, commentId });
  // 发送/回复/删除评论使用 POST 请求
  const r = await apiPost<CommentActionResult & { comment?: any }>("/comment", params);
  if (r.comment) r.comment = mapComment(r.comment);
  log.info(TAG, "commentAction result", { code: r.code, commentId: r.commentId, msg: r.msg, dialog: r.dialog?.subtitle });
  return r;
}

export function isCommentRiskControlled(code: number): boolean {
  return code === 250 || code === -460 || code === -462 || code === 509;
}

/** 评论写操作错误码 → 用户可读文案（含风控识别） */
export function describeCommentError(res: { code: number; msg?: string; message?: string; dialog?: { title?: string; subtitle?: string } }): string {
  const { code } = res;
  if (code === 301 || code === 302) return "请先登录后再评论";
  // 风控相关：250 移动端限制，-460/-462 网络繁忙/需验证
  if (code === 250) return "网易云限制了第三方客户端评论，请稍后再试或改用官方 App";
  if (code === -460 || code === -462) return "操作需要安全验证，请稍后再试或改用官方 App";
  if (code === 509) return "操作过于频繁，请稍后再试";
  if (code === 400 || code === 408) return "评论内容不合规或含敏感词，请修改后重试";
  // 服务端返回的对话框/消息优先展示
  const dlg = res.dialog?.subtitle || res.dialog?.title;
  if (dlg) return dlg;
  if (res.msg) return res.msg;
  if (res.message) return res.message;
  return `操作失败 (code: ${code})`;
}

/** 给评论点赞（/comment/like）
 *  id: 资源 ID（歌曲 ID 等）
 *  cid: 评论 ID
 *  t: 1=点赞, 0=取消点赞
 *  type: 0=歌曲, 1=mv, 2=歌单, 3=专辑, 4=电台节目, 5=视频, 6=动态, 7=电台
 *  需要登录
 */
export async function commentLike(
  id: number,
  cid: number,
  t: 0 | 1,
  type: number = 0
): Promise<{ code: number; msg?: string; message?: string; dialog?: { title?: string; subtitle?: string } }> {
  const params: Record<string, string | number> = { id, cid, t, type, os: "android" };
  log.info(TAG, "commentLike()", { id, cid, t, type });
  const r = await apiPost<{ code: number; msg?: string; message?: string; dialog?: { title?: string; subtitle?: string } }>("/comment/like", params);
  log.info(TAG, "commentLike result", { code: r.code, msg: r.msg });
  return r;
}
