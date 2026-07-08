/**
 * 网易云双上报接口统一封装
 *
 * 接口一: 听歌记录上报 (EAPI scrobble)
 *   - POST /api/feedback/weblog (AES-128-ECB 加密)
 *   - startplay + play 两段式 → 计入听歌量/最近播放/听歌排行
 *
 * 接口二: 云村听歌足迹上报 (NCBL scrobble_v1)
 *   - POST /api/clientlog/encrypt/upload (ChaCha20 + RSA-256 + gzip)
 *   - PLV + PLD 两段式 → 计入云村听歌足迹/收听时长/年度报告
 *
 * 转换自 Go SDK: cloudmusic-report-sdk-go
 */

import { log } from "@/composables/logger";
import { EapiClient } from "./eapi-scrobble";
import { ncblScrobbleV1, buildNcblContext, type NcblSong, type NcblSource } from "./ncbl-scrobble";
import { getCookie } from "./core";
import { scrobbleLog } from "./scrobble-log";

const TAG = "dual-scrobble";

export interface ScrobbleOptions {
  songId: number;
  songName?: string;
  artist?: string;
  sourceId?: number | null;
  playTime: number;
  totalTime?: number;
  bitrate?: number;
  level?: string;
}

export interface ScrobbleResult {
  eapi?: { code: number; message: string };
  ncbl?: { code: number; message: string };
}

export async function dualScrobble(opts: ScrobbleOptions): Promise<ScrobbleResult> {
  const result: ScrobbleResult = {};
  const cookie = getCookie();

  await scrobbleLog(`====== 双上报开始 ====== songId=${opts.songId} name="${opts.songName}" time=${opts.playTime}s total=${opts.totalTime}s`);

  if (!cookie) {
    log.warn(TAG, "no cookie, skipping scrobble");
    await scrobbleLog(`错误: 无 cookie，跳过上报`);
    return result;
  }

  await scrobbleLog(`cookie 长度=${cookie.length} 有MUSIC_U=${cookie.includes("MUSIC_U")} 有csrf=${cookie.includes("__csrf")}`);

  const songId = String(opts.songId);
  const sourceId = opts.sourceId ? String(opts.sourceId) : songId;
  const playTime = opts.playTime;
  const totalTime = opts.totalTime || playTime;

  // === EAPI scrobble ===
  try {
    const client = new EapiClient(cookie);
    const eapiRes = await client.scrobble(songId, sourceId, playTime);
    result.eapi = {
      code: eapiRes.code || 200,
      message: eapiRes.message || "EAPI scrobble 完成",
    };
    log.info(TAG, "EAPI scrobble done", { songId, code: result.eapi.code });
    await scrobbleLog(`[DUAL] EAPI 完成 code=${result.eapi.code}`);
  } catch (e) {
    result.eapi = { code: 502, message: `EAPI scrobble 异常: ${e}` };
    log.warn(TAG, "EAPI scrobble error", { error: String(e) });
    await scrobbleLog(`[DUAL] EAPI 异常: ${e}`);
  }

  // === NCBL scrobble_v1 ===
  try {
    const ctx = buildNcblContext(cookie);
    const song: NcblSong = {
      id: opts.songId,
      name: opts.songName || "",
      artist: opts.artist || "",
      bitrate: opts.bitrate || 320,
      level: opts.level || "exhigh",
      vip: false,
      time: totalTime,
    };
    const source: NcblSource = {
      id: sourceId,
      type: "track",
      name: "list",
    };
    const ncblRes = await ncblScrobbleV1(ctx, song, source, playTime);
    result.ncbl = {
      code: ncblRes.code,
      message: ncblRes.message,
    };
    log.info(TAG, "NCBL scrobble_v1 done", { songId, code: ncblRes.code });
    await scrobbleLog(`[DUAL] NCBL 完成 code=${result.ncbl.code}`);
  } catch (e) {
    result.ncbl = { code: 502, message: `NCBL scrobble_v1 异常: ${e}` };
    log.warn(TAG, "NCBL scrobble_v1 error", { error: String(e) });
    await scrobbleLog(`[DUAL] NCBL 异常: ${e}`);
  }

  await scrobbleLog(`====== 双上报结束 ====== EAPI=${result.eapi?.code} NCBL=${result.ncbl?.code}`);
  log.info(TAG, "dual scrobble complete", { songId, eapi: result.eapi?.code, ncbl: result.ncbl?.code });
  return result;
}
