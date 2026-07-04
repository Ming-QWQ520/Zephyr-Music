/** 网易云歌曲对象转播放器内部 Song 格式 */
import type { NeteaseSong, Song } from "@/types";

/** 把网易云歌曲对象转成播放器内部的 Song 格式
 *  兼容不同接口返回的字段差异：
 *  - playlistTrackAll / recommendSongs: ar, al, dt
 *  - search/suggest (type=mobile): 可能嵌套在 song 字段中，或直接返回
 *  - songDetail: ar, al, dt
 */
export function neteaseSongToSong(s: NeteaseSong): Song {
  const raw = (s.song && s.song.id) ? s.song : s;
  const artists = raw.ar || raw.artists || [];
  const album = raw.al || raw.album;
  const durationSec = ((raw.dt || raw.duration || 0) / 1000);
  let picUrl = album?.picUrl || raw.picUrl || "";
  if (picUrl && !picUrl.includes("?param=")) picUrl += "?param=200x200";
  return {
    id: `ne_${raw.id}`,
    name: raw.name,
    artist: artists.map((a) => a.name).join(", ") || "未知艺术家",
    pic: picUrl,
    url: "",
    lrc: "",
    duration: durationSec,
    source: "netease",
    neteaseId: raw.id,
  };
}
