/**
 * 网易云音乐 API 统一出口
 *
 * 模块化拆分（高内聚低耦合）：
 *   - core.ts:         基础设施（apiGet、cookie、缓存状态）
 *   - auth.ts:         登录/认证
 *   - playlist.ts:     歌单查询/详情/缓存/推荐
 *   - playlistCrud.ts: 歌单 CRUD 操作（新建/删除/更新/分类/精品）
 *   - song.ts:         歌曲 URL/详情/打卡/记录
 *   - lyric.ts:        歌词
 *   - like.ts:         喜欢/收藏
 *   - user.ts:         用户信息/VIP/等级
 *   - comment.ts:      评论/收藏者
 *   - search.ts:       搜索/搜索建议/多重匹配
 *   - transform.ts:    NeteaseSong → Song 转换
 *   - clouddisk.ts:    云盘/上传/下载
 *   - discover.ts:     首页发现/新歌/热搜/歌手/专辑/榜单/MV/相似推荐
 *   - radio.ts:        电台/DJ/节目/排行榜/订阅
 *   - video.ts:        视频/MV 详情/地址/收藏/点赞
 *   - social.ts:       私信/通知/关注/动态/话题
 *   - genre.ts:        曲风/音乐风格
 *   - signin.ts:       签到/云贝/任务/乐签/VIP 成长值
 *   - digital.ts:      数字专辑/音乐日历/歌手收藏/推荐节目/心动模式
 *
 * 类型定义统一在 @/types/netease 中，这里重新导出以保持向后兼容。
 */
// 重新导出类型（向后兼容：原 netease.ts 直接导出类型）
export type {
  NeteasePlaylist, NeteaseSong, NeteaseSongQuality, NeteaseSongPrivilege,
  PlaylistComment, PlaylistSubscriber,
  AudioLevel, NeteaseUser, VipInfo, UserLevelInfo,
} from "@/types";

export * from "./auth";
export * from "./playlist";
export * from "./playlistCrud";
export * from "./song";
export * from "./lyric";
export * from "./like";
export * from "./user";
export * from "./comment";
export * from "./search";
export * from "./transform";
export * from "./clouddisk";
export * from "./discover";
export * from "./radio";
export * from "./video";
export * from "./social";
export * from "./genre";
export * from "./signin";
export * from "./digital";
