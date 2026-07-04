/** 网易云歌词相关 API */
import { log } from "@/composables/logger";
import { apiGet } from "./core";
import type { LyricLine } from "@/types";

/** 获取歌词 */
export async function lyric(id: number): Promise<{
  code: number; lrc?: { lyric: string }; tlyric?: { lyric: string };
}> {
  log.info("netease-api-lrc", "→ lyric()", { id });
  const r = await apiGet("/lyric", { id });
  log.info("netease-api-lrc", "← lyric result", {
    code: r.code, hasLrc: !!r.lrc?.lyric, hasTlyric: !!r.tlyric?.lyric,
    lrcLen: r.lrc?.lyric?.length || 0, tlyricLen: r.tlyric?.lyric?.length || 0,
  });
  return r;
}

/** 获取逐字歌词（/lyric/new） */
export async function lyricNew(id: number): Promise<{
  code: number;
  lrc?: { lyric: string };
  tlyric?: { lyric: string };
  yrc?: { lyric: string; version?: string };
  romalrc?: { lyric: string };
}> {
  log.info("netease-api-lrc", "→ lyricNew()", { id });
  const r = await apiGet("/lyric/new", { id });
  log.info("netease-api-lrc", "← lyricNew result", {
    code: r.code, hasLrc: !!r.lrc?.lyric, hasTlyric: !!r.tlyric?.lyric,
    hasYrc: !!r.yrc?.lyric, hasRomalrc: !!r.romalrc?.lyric,
    lrcLen: r.lrc?.lyric?.length || 0, tlyricLen: r.tlyric?.lyric?.length || 0,
    yrcLen: r.yrc?.lyric?.length || 0,
  });
  return r;
}

/** 解析逐字歌词 yrc 格式为 LyricLine[]
 *  yrc 格式: [行开始ms,行总时长ms](字开始ms,字时长ms,0)字(字开始ms,字时长ms,0)字... */
export function parseYrc(yrcText: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of yrcText.split("\n")) {
    const m = raw.match(/^\[(\d+),(\d+)\]/);
    if (!m) continue;
    const startTime = parseInt(m[1]) / 1000;
    const text = raw.replace(/^\[\d+,\d+\]/, "").replace(/\(\d+,\d+,\d+\)/g, "").trim();
    if (!text) continue;
    lines.push({ time: startTime, text });
  }
  return lines.sort((a, b) => a.time - b.time);
}
