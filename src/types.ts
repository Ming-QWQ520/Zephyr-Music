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
}
export interface LyricLine { time: number; text: string; }
export type ViewKey = "search" | "nowplaying" | "queue" | "library" | "netease";
export type RepeatMode = "off" | "all" | "one";
