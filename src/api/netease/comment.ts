/** 网易云评论 / 收藏者 API */
import { log } from "@/composables/logger";
import { apiGet, TAG } from "./core";
import type { PlaylistComment, PlaylistSubscriber } from "@/types";

/** 歌单评论（/comment/playlist） */
export async function commentPlaylist(id: number, limit = 20, offset = 0): Promise<{
  code: number; total?: number; hotComments?: PlaylistComment[]; comments?: PlaylistComment[]; more?: boolean; moreHot?: boolean;
}> {
  const params: Record<string, string | number> = { id, limit, offset };
  log.info(TAG, "commentPlaylist()", { id, limit, offset });
  const r = await apiGet("/comment/playlist", params);
  log.info(TAG, "commentPlaylist result", { code: r.code, total: r.total, count: r.comments?.length || 0 });
  return r;
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
