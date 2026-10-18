/** 网易云音乐相关类型定义 */

/** 网易云歌单 */
export interface NeteasePlaylist {
  id: number;
  name: string;
  coverImgUrl: string;
  trackCount: number;
  playCount?: number;
  /** userId 用于区分「我创建的歌单」与「我收藏的歌单」（/user/playlist 原始响应携带） */
  creator?: { nickname: string; userId?: number };
}

/** 网易云歌曲音质信息 */
export interface NeteaseSongQuality {
  br?: number;
  fid?: number;
  size?: number;
  vd?: number;
  sr?: number;
}

/** 网易云歌曲权限信息 */
export interface NeteaseSongPrivilege {
  /** 是否为云盘歌曲 */
  cs?: boolean;
  /** 小于0时为灰色歌曲 */
  st?: number;
  /** 是否「由于版权保护，您所在的地区暂时无法使用。」 */
  toast?: boolean;
  /** 免费用户的该歌曲播放音质 */
  flLevel?: string;
  /** 当前用户的该歌曲最高试听音质 */
  plLevel?: string;
  /** 当前用户的该歌曲最高下载音质 */
  dlLevel?: string;
  /** 歌曲最高音质 */
  maxBrLevel?: string;
}

/** 网易云歌曲（API 返回的原始结构） */
export interface NeteaseSong {
  id: number;
  name: string;
  ar?: { id: number; name: string }[];
  artists?: { id: number; name: string }[];
  al?: { id: number; name: string; picUrl: string };
  album?: { id: number; name: string; picUrl: string };
  dt?: number;
  duration?: number;
  song?: NeteaseSong;
  picUrl?: string;
  /** 歌曲收费类型: 0=免费或无版权, 1=VIP, 4=购买专辑, 8=非会员免费低音质 */
  fee?: number;
  /** 歌曲属性位标记，按位与操作获取: 131072=纯音乐, 262144=杜比全景声, 1048576=脏标, 17179869184=Hi-Res */
  mark?: number;
  /** Hi-Res 质量文件信息 */
  hr?: NeteaseSongQuality;
  /** 无损质量文件信息 */
  sq?: NeteaseSongQuality;
  /** 高质量文件信息 */
  h?: NeteaseSongQuality;
  /** 中质量文件信息 */
  m?: NeteaseSongQuality;
  /** 低质量文件信息 */
  l?: NeteaseSongQuality;
  /** 歌曲热度 [0.0, 100.0] */
  pop?: number;
  /** MV ID，非零表示有MV */
  mv?: number;
  /** 歌曲权限信息 */
  privilege?: NeteaseSongPrivilege;
  /** 歌曲类型: 0=一般, 1=云盘上传(无公开对应), 2=云盘上传(有公开对应) */
  t?: number;
  /** 专辑中第几张CD */
  cd?: string;
  /** CD中第几曲 */
  no?: number;
  /** 发行时间（毫秒时间戳） */
  publishTime?: number;
  /** 翻唱类型: 0=未知, 1=原曲, 2=翻唱 */
  originCoverType?: number;
  /** 无版权信息 */
  noCopyrightRcmd?: any;
}

/** 歌单评论 */
export interface PlaylistComment {
  commentId: number;
  content: string;
  time: number;
  likedCount: number;
  user: { userId: number; nickname: string; avatarUrl: string };
}

/** 歌单收藏者 */
export interface PlaylistSubscriber {
  userId: number;
  nickname: string;
  avatarUrl: string;
  signature?: string;
}

/** 音质等级
 *  standard 标准 / higher 较高 / exhigh 极高 / lossless 无损 / hires Hi-Res
 *  jyeffect 高清环绕声 / sky 沉浸环绕声 / dolby 杜比全景声 / jymaster 超清母带
 */
export type AudioLevel = "standard" | "higher" | "exhigh" | "lossless" | "hires" | "jyeffect" | "sky" | "dolby" | "jymaster";

/** 用户信息（缓存用） */
export interface NeteaseUser {
  userId: number;
  nickname: string;
  avatarUrl: string;
  /** 个性签名 */
  signature?: string;
  /** 账号创建时间戳（ms） */
  createTime?: number;
  /** 性别：0=保密, 1=男, 2=女 */
  gender?: number;
  /** 所在城市（行政区划代码，如 110100） */
  city?: number;
  /** 省份（行政区划代码） */
  province?: number;
  /** 个人主页背景图直链 */
  backgroundUrl?: string;
}

/** VIP 信息 */
export interface VipInfo {
  isVip: boolean;
  redVipLevel: number;
  expireText: string;
  /** 黑胶 VIP 动画图（webp/gif），每次进入个人主页播放一次 */
  dynamicIconUrl?: string;
  /** 黑胶 VIP 常规图标（动画图加载失败时回退） */
  iconUrl?: string;
}

/** 用户等级信息 */
export interface UserLevelInfo {
  level: number;
  nowLoginCount: number;
  nextLoginCount: number;
  nowPlayCount: number;
  nextPlayCount: number;
  progress: number;
  needLogin: number;
  needPlay: number;
}
