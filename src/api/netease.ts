/**
 * 网易云音乐 API 封装（barrel 入口）
 *
 * 实际实现按领域拆分在 src/api/netease/ 目录下，本文件仅做重新导出，
 * 保持 @/api/netease 入口向后兼容。
 *
 * 模块拆分（高内聚低耦合）：
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
 */
export * from "./netease/index";
