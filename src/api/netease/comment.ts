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
export interface NewComment {
  commentId: number;
  content: string;
  time: number;
  likedCount: number;
  /** 评论者所在地（从 ipLocation.location 提取的纯字符串） */
  ipLocation?: string;
  user: { userId: number; nickname: string; avatarUrl: string };
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
  const comments: NewComment[] = (r.comments || []).map((c: any) => ({
    commentId: c.commentId,
    content: c.content,
    time: c.time,
    likedCount: c.likedCount || 0,
    ipLocation: c.ipLocation?.location || c.user?.locationInfo?.location || "",
    user: {
      userId: c.user?.userId || 0,
      nickname: c.user?.nickname || "未知用户",
      avatarUrl: c.user?.avatarUrl || "",
    },
  }));
  log.info(TAG, "commentNew result", {
    code: r.code,
    totalCount: r.totalCount,
    count: comments.length,
    hasMore: r.hasMore,
  });
  return { code: r.code, totalCount: r.totalCount, comments, hasMore: r.hasMore, cursor: r.cursor };
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
export async function commentAction(
  t: 0 | 1 | 2,
  type: number,
  id: number,
  content?: string,
  commentId?: number
): Promise<{ code: number; commentId?: number; msg?: string; message?: string }> {
  const params: Record<string, string | number> = { t, type, id };
  if (content) params.content = content;
  if (commentId !== undefined) params.commentId = commentId;
  // 添加 os=android 模拟移动端，绕过"请切换至移动端"风控
  params.os = "android";
  log.info(TAG, "commentAction()", { t, type, id, hasContent: !!content, commentId });
  // 发送/回复/删除评论使用 POST 请求
  const r = await apiPost<{ code: number; commentId?: number; msg?: string; message?: string; dialog?: { title?: string; subtitle?: string } }>("/comment", params);
  log.info(TAG, "commentAction result", { code: r.code, commentId: r.commentId, msg: r.msg, dialog: r.dialog?.subtitle });
  return r;
}
