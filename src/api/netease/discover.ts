/**
 * 网易云音乐 首页发现 / 新歌 / 热搜 / 歌手 / 专辑 API
 *
 * 基于 API 文档 https://musicapi.mingqwq.top/docs 补充的接口，
 * 原项目中未覆盖的首页发现、歌手分类、专辑内容、新歌速递等常用功能。
 */
import { log } from "@/composables/logger";
import { apiGet, TAG } from "./core";
import type { NeteaseSong } from "@/types";

// ===== 首页发现 =====

/** 首页 Banner（/banner）
 *  type: 0=pc, 1=android, 2=iphone, 3=ipad
 *  返回 banners[] 包含 imageUrl, targetId, targetType 等 */
export interface BannerItem {
  imageUrl: string;
  targetId: number;
  targetType: number;
  titleColor: string;
  typeTitle: string;
  url?: string;
  alg?: string;
  encodeId?: string;
  song?: NeteaseSong;
}

export async function banner(type = 0): Promise<{
  code: number;
  banners?: BannerItem[];
}> {
  log.info(TAG, "banner()", { type });
  const r = await apiGet("/banner", { type });
  log.info(TAG, "banner result", { code: r.code, count: r.banners?.length || 0 });
  return r;
}

/** 首页-发现（/homepage/block/page）
 *  返回首页模块化数据，包含推荐歌单、雷达歌单、歌曲定制等 blocks。
 *  个性化内容需要登录 cookie（apiGet 自动附加，未登录返回通用内容）。
 *  注意：normalizeResponse 已解包 { code, data } 外层，返回的即 data 本身 */
export async function homepageBlockPage(): Promise<{
  code: number;
  blocks?: any[];
  cursor?: string;
  hasMore?: boolean;
}> {
  log.info(TAG, "homepageBlockPage()");
  const r = await apiGet("/homepage/block/page");
  log.info(TAG, "homepageBlockPage result", { code: r.code, blocksCount: r.blocks?.length || 0 });
  return r;
}

/** 首页-发现-圆形图标入口列表（/homepage/dragon/ball） */
export async function homepageDragonBall(): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "homepageDragonBall()");
  const r = await apiGet("/homepage/dragon/ball");
  log.info(TAG, "homepageDragonBall result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

// ===== 新歌速递 =====

/** 新歌速递（/top/song）
 *  type: 0=全部, 7=华语, 96=欧美, 8=日本, 16=韩国 */
export async function topSong(type = 0): Promise<{
  code: number;
  data?: NeteaseSong[];
  result?: NeteaseSong[];
}> {
  log.info(TAG, "topSong()", { type });
  const r = await apiGet("/top/song", { type });
  const list = r.data || r.result || [];
  log.info(TAG, "topSong result", { code: r.code, count: list.length });
  return r;
}

// ===== 热搜 =====

/** 热搜列表-简略（/search/hot） */
export async function searchHot(): Promise<{
  code: number;
  result?: { hots?: { first: string }[] };
}> {
  log.info(TAG, "searchHot()");
  const r = await apiGet("/search/hot");
  log.info(TAG, "searchHot result", { code: r.code, count: r.result?.hots?.length || 0 });
  return r;
}

/** 热搜列表-详细（/search/hot/detail）
 *  返回 data[] 包含 searchWord, score, content, iconType, iconUrl 等 */
export interface HotDetailItem {
  searchWord: string;
  score: number;
  content?: string;
  iconType?: number;
  iconUrl?: string;
  url?: string;
  alg?: string;
}

export async function searchHotDetail(): Promise<{
  code: number;
  data?: HotDetailItem[];
}> {
  log.info(TAG, "searchHotDetail()");
  const r = await apiGet("/search/hot/detail");
  log.info(TAG, "searchHotDetail result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 默认搜索关键词（/search/default） */
export async function searchDefault(): Promise<{
  code: number;
  data?: { searchWord: string; realkeyword?: string; showKeyword?: string };
}> {
  log.info(TAG, "searchDefault()");
  const r = await apiGet("/search/default");
  log.info(TAG, "searchDefault result", { code: r.code, searchWord: r.data?.searchWord });
  return r;
}

// ===== 歌手 =====

/** 歌手分类列表（/artist/list）
 *  type: -1=全部, 1=男, 2=女, 3=乐队
 *  area: -1=全部, 7=华语, 96=欧美, 8=日本, 16=韩国, 0=其他
 *  initial: 按首字母筛选(a-z)
 *  limit / offset */
export interface ArtistItem {
  id: number;
  name: string;
  picUrl?: string;
  img1v1Url?: string;
  alias?: string[];
  albumSize?: number;
  mvSize?: number;
  trans?: string;
  briefDesc?: string;
}

export async function artistList(params: {
  type?: number;
  area?: number;
  initial?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  code: number;
  more?: boolean;
  artists?: ArtistItem[];
}> {
  const p: Record<string, string | number | boolean> = {};
  if (params.type !== undefined) p.type = params.type;
  if (params.area !== undefined) p.area = params.area;
  if (params.initial) p.initial = params.initial;
  if (params.limit !== undefined) p.limit = params.limit;
  if (params.offset !== undefined) p.offset = params.offset;
  log.info(TAG, "artistList()", p);
  const r = await apiGet("/artist/list", p);
  log.info(TAG, "artistList result", { code: r.code, count: r.artists?.length || 0 });
  return r;
}

/** 歌手热门 50 首歌曲（/artist/top/song） */
export async function artistTopSong(id: number): Promise<{
  code: number;
  songs?: NeteaseSong[];
  more?: boolean;
}> {
  log.info(TAG, "artistTopSong()", { id });
  const r = await apiGet("/artist/top/song", { id });
  log.info(TAG, "artistTopSong result", { code: r.code, count: r.songs?.length || 0 });
  return r;
}

/** 歌手全部歌曲（/artist/songs）
 *  order: hot=按热度, time=按时间
 *  limit / offset */
export async function artistSongs(id: number, order = "hot", limit = 50, offset = 0): Promise<{
  code: number;
  songs?: NeteaseSong[];
  more?: boolean;
  total?: number;
}> {
  log.info(TAG, "artistSongs()", { id, order, limit, offset });
  const r = await apiGet("/artist/songs", { id, order, limit, offset });
  log.info(TAG, "artistSongs result", { code: r.code, count: r.songs?.length || 0, total: r.total });
  return r;
}

/** 歌手专辑（/artist/album）
 *  limit / offset */
export async function artistAlbum(id: number, limit = 30, offset = 0): Promise<{
  code: number;
  hotAlbums?: any[];
  more?: boolean;
  artist?: any;
}> {
  log.info(TAG, "artistAlbum()", { id, limit, offset });
  const r = await apiGet("/artist/album", { id, limit, offset });
  log.info(TAG, "artistAlbum result", { code: r.code, count: r.hotAlbums?.length || 0 });
  return r;
}

/** 歌手描述（/artist/desc） */
export async function artistDesc(id: number): Promise<{
  code: number;
  briefDesc?: string;
  introduction?: { ti: string; txt: string }[];
  topicData?: any;
}> {
  log.info(TAG, "artistDesc()", { id });
  const r = await apiGet("/artist/desc", { id });
  log.info(TAG, "artistDesc result", { code: r.code, hasBrief: !!r.briefDesc });
  return r;
}

/** 歌手详情（/artist/detail） */
export async function artistDetail(id: number): Promise<{
  code: number;
  data?: {
    artist: {
      id: number;
      name: string;
      cover?: string;
      avatar?: string;
      identify?: string;
      briefDesc?: string;
      musicSize?: number;
      albumSize?: number;
      mvSize?: number;
    };
    video?: any;
    prompt?: string;
  };
}> {
  log.info(TAG, "artistDetail()", { id });
  const r = await apiGet("/artist/detail", { id });
  log.info(TAG, "artistDetail result", { code: r.code, hasData: !!r.data });
  return r;
}

/** 相似歌手（/simi/artist） */
export async function simiArtist(id: number): Promise<{
  code: number;
  artists?: ArtistItem[];
}> {
  log.info(TAG, "simiArtist()", { id });
  const r = await apiGet("/simi/artist", { id });
  log.info(TAG, "simiArtist result", { code: r.code, count: r.artists?.length || 0 });
  return r;
}

// ===== 专辑 =====

/** 获取专辑内容（/album） */
export async function album(id: number): Promise<{
  code: number;
  album?: {
    id: number;
    name: string;
    picUrl?: string;
    artist?: { id: number; name: string; picUrl?: string };
    artists?: { id: number; name: string }[];
    publishTime?: number;
    size?: number;
    description?: string;
    tags?: string[];
    company?: string;
    subType?: string;
  };
  songs?: NeteaseSong[];
}> {
  log.info(TAG, "album()", { id });
  const r = await apiGet("/album", { id });
  log.info(TAG, "album result", { code: r.code, albumName: r.album?.name, songCount: r.songs?.length || 0 });
  return r;
}

/** 专辑动态信息（/album/detail/dynamic） */
export async function albumDetailDynamic(id: number): Promise<{
  code: number;
  commentCount?: number;
  shareCount?: number;
  likedCount?: number;
  isSub?: boolean;
}> {
  log.info(TAG, "albumDetailDynamic()", { id });
  const r = await apiGet("/album/detail/dynamic", { id });
  log.info(TAG, "albumDetailDynamic result", { code: r.code, commentCount: r.commentCount });
  return r;
}

/** 收藏/取消收藏专辑（/album/sub）
 *  t: 1=收藏, 0=取消收藏 */
export async function albumSub(id: number, t: 0 | 1): Promise<{ code: number }> {
  log.info(TAG, "albumSub()", { id, t });
  const r = await apiGet("/album/sub", { id, t, timestamp: Date.now() });
  log.info(TAG, "albumSub result", { id, t, code: r.code });
  return r;
}

/** 获取已收藏专辑列表（/album/sublist） */
export async function albumSublist(limit = 25, offset = 0): Promise<{
  code: number;
  data?: any[];
  count?: number;
  hasMore?: boolean;
}> {
  log.info(TAG, "albumSublist()", { limit, offset });
  const r = await apiGet("/album/sublist", { limit, offset });
  log.info(TAG, "albumSublist result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 新碟上架（/album/new）
 *  area: ALL=全部, ZH=华语, EA=欧美, KR=韩国, JP=日本
 *  limit / offset */
export async function albumNew(area = "ALL", limit = 30, offset = 0): Promise<{
  code: number;
  albums?: any[];
  total?: number;
  more?: boolean;
}> {
  log.info(TAG, "albumNew()", { area, limit, offset });
  const r = await apiGet("/album/new", { area, limit, offset });
  log.info(TAG, "albumNew result", { code: r.code, count: r.albums?.length || 0 });
  return r;
}

// ===== 榜单 =====

/** 所有榜单（/toplist） */
export async function toplist(): Promise<{
  code: number;
  list?: { id: number; name: string; coverImgUrl: string; description?: string; updateFrequency?: string; tracks?: { first: string; second: string }[] }[];
}> {
  log.info(TAG, "toplist()");
  const r = await apiGet("/toplist");
  log.info(TAG, "toplist result", { code: r.code, count: r.list?.length || 0 });
  return r;
}

/** 所有榜单内容摘要（/toplist/detail） */
export async function toplistDetail(): Promise<{
  code: number;
  list?: any[];
}> {
  log.info(TAG, "toplistDetail()");
  const r = await apiGet("/toplist/detail");
  log.info(TAG, "toplistDetail result", { code: r.code, count: r.list?.length || 0 });
  return r;
}

// ===== 相似推荐 =====

/** 相似歌单（/simi/playlist） */
export async function simiPlaylist(id: number, limit = 20, offset = 0): Promise<{
  code: number;
  playlists?: any[];
  more?: boolean;
}> {
  log.info(TAG, "simiPlaylist()", { id });
  const r = await apiGet("/simi/playlist", { id, limit, offset });
  log.info(TAG, "simiPlaylist result", { code: r.code, count: r.playlists?.length || 0 });
  return r;
}

/** 相似歌曲（/simi/song） */
export async function simiSong(id: number, limit = 30, offset = 0): Promise<{
  code: number;
  songs?: NeteaseSong[];
  more?: boolean;
}> {
  log.info(TAG, "simiSong()", { id });
  const r = await apiGet("/simi/song", { id, limit, offset });
  log.info(TAG, "simiSong result", { code: r.code, count: r.songs?.length || 0 });
  return r;
}

// ===== 推荐新音乐 =====

/** 推荐新音乐（/personalized/newsong） */
export async function personalizedNewSong(limit = 10): Promise<{
  code: number;
  result?: any[];
}> {
  log.info(TAG, "personalizedNewSong()", { limit });
  const r = await apiGet("/personalized/newsong", { limit });
  log.info(TAG, "personalizedNewSong result", { code: r.code, count: r.result?.length || 0 });
  return r;
}

// ===== MV =====

/** MV 排行（/top/mv） */
export async function topMv(limit = 30, offset = 0): Promise<{
  code: number;
  data?: any[];
  hasMore?: boolean;
}> {
  log.info(TAG, "topMv()", { limit, offset });
  const r = await apiGet("/top/mv", { limit, offset });
  log.info(TAG, "topMv result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 获取 MV 数据（/mv/detail） */
export async function mvDetail(mvid: number): Promise<{
  code: number;
  data?: any;
}> {
  log.info(TAG, "mvDetail()", { mvid });
  const r = await apiGet("/mv/detail", { mvid });
  log.info(TAG, "mvDetail result", { code: r.code });
  return r;
}

/** MV 地址（/mv/url） */
export async function mvUrl(id: number, r = 1080): Promise<{
  code: number;
  data?: { url: string; r: number; size?: number };
}> {
  log.info(TAG, "mvUrl()", { id, r });
  const res = await apiGet("/mv/url", { id, r });
  log.info(TAG, "mvUrl result", { code: res.code, hasUrl: !!res.data?.url });
  return res;
}

// ===== 歌曲相关 =====

/** 获取最近 5 个听了这首歌的用户（/song/user/history） */
export async function songUserHistory(id: number): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "songUserHistory()", { id });
  const r = await apiGet("/song/user/history", { id });
  log.info(TAG, "songUserHistory result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 歌曲是否可用（/check/music） */
export async function checkMusic(id: number): Promise<{
  code: number;
  success?: boolean;
  message?: string;
}> {
  log.info(TAG, "checkMusic()", { id });
  const r = await apiGet("/check/music", { id });
  log.info(TAG, "checkMusic result", { code: r.code, success: r.success });
  return r;
}

/** 灰色歌曲的其他版本推荐（/song/other/version） */
export async function songOtherVersion(id: number): Promise<{
  code: number;
  data?: any[];
}> {
  log.info(TAG, "songOtherVersion()", { id });
  const r = await apiGet("/song/other/version", { id });
  log.info(TAG, "songOtherVersion result", { code: r.code, count: r.data?.length || 0 });
  return r;
}
