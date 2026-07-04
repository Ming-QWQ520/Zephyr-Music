/**
 * 网易云音乐 API 统一出口
 *
 * 模块化拆分（高内聚低耦合）：
 *   - core.ts:     基础设施（apiGet、cookie、缓存状态）
 *   - auth.ts:     登录/认证
 *   - playlist.ts: 歌单相关
 *   - song.ts:     歌曲 URL/详情/打卡/记录
 *   - lyric.ts:    歌词
 *   - like.ts:     喜欢/收藏
 *   - user.ts:     用户信息/VIP/等级
 *   - comment.ts:  评论/收藏者
 *   - search.ts:   搜索
 *   - transform.ts: NeteaseSong → Song 转换
 *
 * 类型定义统一在 @/types/netease 中，这里重新导出以保持向后兼容。
 */
// 重新导出类型（向后兼容：原 netease.ts 直接导出类型）
export type {
  NeteasePlaylist, NeteaseSong, PlaylistComment, PlaylistSubscriber,
  AudioLevel, NeteaseUser, VipInfo, UserLevelInfo,
} from "@/types";

export * from "./auth";
export * from "./playlist";
export * from "./song";
export * from "./lyric";
export * from "./like";
export * from "./user";
export * from "./comment";
export * from "./search";
export * from "./transform";
