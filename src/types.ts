/**
 * 类型定义统一出口（barrel）
 *
 * 实际类型按领域拆分在 src/types/ 目录下：
 *   - song.ts:     Song, LyricLine
 *   - view.ts:     ViewKey, RepeatMode
 *   - netease.ts:  NeteasePlaylist, NeteaseSong, PlaylistComment, ...
 *   - settings.ts: DisplayMode, ColorMode, BgType, HomeBgType, ...
 *
 * 为保持向后兼容，src/types.ts 仍作为入口可用。
 */
export * from "./types/song";
export * from "./types/view";
export * from "./types/netease";
export * from "./types/settings";
