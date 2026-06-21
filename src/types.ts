export interface Song {
  id: string;
  name: string;
  artist: string;
  url: string;
  pic: string;
  lrc: string;
  server?: string;
}
export interface LyricLine { time: number; text: string; }
export type ViewKey = "search" | "nowplaying" | "queue" | "library";
export type RepeatMode = "off" | "all" | "one";
