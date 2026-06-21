const API_BASE = "https://api.qijieya.cn/meting/";
import type { Song, LyricLine } from "@/types";

export async function searchSongs(keyword: string, limit = 30): Promise<Song[]> {
  const kw = keyword.trim();
  if (!kw) return [];
  const url = `${API_BASE}?type=search&id=${encodeURIComponent(kw)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`搜索失败 (${res.status})`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : data?.data ?? [];
  return list.map((raw: any) => normalizeSong(raw)).filter((s: Song | null): s is Song => s !== null);
}

function normalizeSong(raw: any): Song | null {
  if (!raw) return null;
  const name = raw.name || raw.title || "未知歌曲";
  const artist = raw.artist || raw.author || "未知歌手";
  const url = raw.url;
  if (!url) return null;
  const id = (url.match(/[?&]id=([^&]+)/) || [,`${name}-${artist}`])[1];
  return { id, name: String(name), artist: String(artist), url: String(url), pic: raw.pic ? String(raw.pic) : "", lrc: raw.lrc ? String(raw.lrc) : "", server: raw.server };
}

export async function fetchLyrics(lrcUrl: string): Promise<LyricLine[]> {
  if (!lrcUrl) return [];
  try {
    const res = await fetch(lrcUrl);
    if (!res.ok) return [];
    return parseLrc(await res.text());
  } catch { return []; }
}

export function parseLrc(text: string): LyricLine[] {
  const lines = text.split(/\r?\n/);
  const out: LyricLine[] = [];
  const tagRe = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;
  for (const line of lines) {
    const matches = [...line.matchAll(tagRe)];
    if (!matches.length) continue;
    const content = line.replace(tagRe, "").trim();
    for (const m of matches) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const ms = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) : 0;
      out.push({ time: min * 60 + sec + ms / 1000, text: content });
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}
