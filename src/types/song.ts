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
}

/** 歌词行 */
export interface LyricLine {
  time: number;
  text: string;
  translation?: string;
}
