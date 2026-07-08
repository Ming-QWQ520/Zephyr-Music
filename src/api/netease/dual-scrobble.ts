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

const TAG = "dual-scrobble";

export interface ScrobbleOptions {
  songId: number;
  songName?: string;
  artist?: string;
  sourceId?: number | null;
  playTime: number;   // 播放时长(秒)
  totalTime?: number;  // 歌曲总时长(秒)
  bitrate?: number;
  level?: string;
}

export interface ScrobbleResult {
  eapi?: { code: number; message: string };
  ncbl?: { code: number; message: string };
}

/**
 * 双上报: 同时调用 EAPI scrobble + NCBL scrobble_v1
 *
 * 两个接口独立执行，互不影响。失败不影响另一个。
 */
export async function dualScrobble(opts: ScrobbleOptions): Promise<ScrobbleResult> {
  const result: ScrobbleResult = {};
  const cookie = getCookie();
  if (!cookie) {
    log.warn(TAG, "no cookie, skipping scrobble");
    return result;
  }

  const songId = String(opts.songId);
  const sourceId = opts.sourceId ? String(opts.sourceId) : songId;
  const playTime = opts.playTime;
  const totalTime = opts.totalTime || playTime;

  // === 接口一: EAPI scrobble (startplay + play) ===
  try {
    const client = new EapiClient(cookie);
    const eapiRes = await client.scrobble(songId, sourceId, playTime);
    result.eapi = {
      code: eapiRes.code || 200,
      message: eapiRes.message || "EAPI scrobble 完成",
    };
    log.info(TAG, "EAPI scrobble done", { songId, code: result.eapi.code });
  } catch (e) {
    result.eapi = { code: 502, message: `EAPI scrobble 异常: ${e}` };
    log.warn(TAG, "EAPI scrobble error", { error: String(e) });
  }

  // === 接口二: NCBL scrobble_v1 (PLV + PLD) ===
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
  } catch (e) {
    result.ncbl = { code: 502, message: `NCBL scrobble_v1 异常: ${e}` };
    log.warn(TAG, "NCBL scrobble_v1 error", { error: String(e) });
  }

  log.info(TAG, "dual scrobble complete", { songId, eapi: result.eapi?.code, ncbl: result.ncbl?.code });
  return result;
}
