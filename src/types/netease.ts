/** 网易云音乐相关类型定义 */

/** 网易云歌单 */
export interface NeteasePlaylist {
  id: number;
  name: string;
  coverImgUrl: string;
  trackCount: number;
  playCount?: number;
  creator?: { nickname: string };
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
