import { open } from "@tauri-apps/plugin-dialog";
import { log } from "@/composables/logger";
import type { Song } from "@/types";
import { searchSongs, fetchLyrics, parseLrc } from "@/api/music";

const API_BASE = "https://api.qijieya.cn/meting/";

/**
 * Build the localaudio:/// URL that the Rodio backend understands.
 * The path is encodeURIComponent'd so spaces / unicode survive transport.
 */
export function buildLocalUrl(filePath: string): string {
  return "localaudio:///" + encodeURIComponent(filePath);
}

interface LocalMeta {
  title?: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
  lrcUrl?: string;
}

/**
 * Try to look up cover art + lyrics for a local file by querying the
 * online search API with the file name. Returns whatever it can find.
 */
async function fetchLocalMeta(fileName: string): Promise<LocalMeta> {
  const base = stripExt(fileName).trim();
  if (!base) return {};
  try {
    const results = await searchSongs(base, 5);
    if (!results.length) return {};
    // Heuristic: pick the first result whose name appears in the file name,
    // otherwise just the first one.
    const lower = base.toLowerCase();
    const pick =
      results.find((r) => lower.includes(r.name.toLowerCase())) || results[0];
    return { coverUrl: pick.pic || undefined, lrcUrl: pick.lrc || undefined };
  } catch (e) {
    log.warn("localMusic", "meta lookup failed", { error: String(e) });
    return {};
  }
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(0, i) : name;
}

function baseName(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

/**
 * Open a native file picker (multi-select) for audio files, then turn each
 * chosen file into a Song with a `localaudio:///` url. Cover art + lyrics are
 * fetched from the online API when possible.
 */
export async function pickLocalAudioFiles(): Promise<Song[]> {
  const selected = await open({
    multiple: true,
    filters: [{ name: "Audio", extensions: ["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus"] }],
  });
  if (!selected) return [];
  const paths = Array.isArray(selected) ? selected : [selected];
  const out: Song[] = [];
  for (const p of paths) {
    const fname = baseName(p);
    const url = buildLocalUrl(p);
    const id = `local:${encodeURIComponent(p)}`;
    const meta = await fetchLocalMeta(fname);
    const song: Song = {
      id,
      name: meta.title || stripExt(fname),
      artist: meta.artist || "本地音乐",
      url,
      pic: meta.coverUrl || "",
      lrc: meta.lrcUrl || "",
      server: "local",
    };
    out.push(song);
    log.info("localMusic", "added local file", { name: song.name, url: url.slice(0, 80) });
  }
  return out;
}

/**
 * Fetch lyrics for a local song that has no lrc url yet. Will look up by
 * name + artist via the search API and parse the first matching lrc.
 */
export async function fetchLocalLyrics(song: Song): Promise<{ time: number; text: string }[]> {
  if (song.lrc) {
    try {
      return await fetchLyrics(song.lrc);
    } catch {
      /* fall through */
    }
  }
  const kw = `${song.name} ${song.artist}`.trim();
  if (!kw) return [];
  try {
    const results = await searchSongs(kw, 3);
    for (const r of results) {
      if (!r.lrc) continue;
      const lyrics = await fetchLyrics(r.lrc);
      if (lyrics.length) return lyrics;
    }
  } catch (e) {
    log.warn("localMusic", "lyric lookup failed", { error: String(e) });
  }
  return [];
}

export { parseLrc };
export { searchSongs, fetchLyrics } from "@/api/music";
