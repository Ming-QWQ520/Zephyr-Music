/** 歌曲数据模型 */
export interface Song {
  id: string;
  name: string;
  artist: string;
  url: string;
  pic: string;
  lrc: string;
  server?: string;
  source?: "netease" | "local" | "online";
  neteaseId?: number;
  duration?: number;
  /** yrc 逐字歌词原文（运行时附加，不持久化） */
  yrcText?: string;
  /** tlyric 翻译歌词原文（运行时附加，不持久化） */
  tlyricText?: string;
  /** 恢复会话时使用的播放进度（秒），由 saveSession 还原时设置，播放器启动后消费并清除 */
  _restoreTime?: number;
  /** 恢复会话时是否应自动开始播放（与 _restoreTime 配合使用） */
  _restorePlaying?: boolean;
}

/** 歌词行 */
export interface LyricLine {
  time: number;
  text: string;
  translation?: string;
}
