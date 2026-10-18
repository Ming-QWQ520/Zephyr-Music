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

  // ===== 歌曲标识（来自 /song/detail）=====
  /** 收费类型: 0=免费或无版权, 1=VIP, 4=购买专辑, 8=非会员免费低音质 */
  fee?: number;
  /** 歌曲属性位标记: 131072=纯音乐, 262144=杜比全景声, 1048576=脏标, 17179869184=Hi-Res */
  mark?: number;
  /** 最高可用音质等级（来自 privilege.maxBrLevel） */
  maxBrLevel?: string;
  /** 是否有 Hi-Res 音质 */
  hasHires?: boolean;
  /** 是否有无损音质 */
  hasSq?: boolean;
}

/** 歌词行 */
export interface LyricLine {
  time: number;
  text: string;
  translation?: string;
}
