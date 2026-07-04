/** 网易云用户信息 / VIP / 等级 / 听歌足迹 API */
import { log } from "@/composables/logger";
import { apiGet } from "./core";

function truncateForLog(obj: any, maxLen = 500): string {
  try {
    const s = typeof obj === "string" ? obj : JSON.stringify(obj);
    if (!s) return String(s);
    return s.length > maxLen ? s.slice(0, maxLen) + `...(truncated, total ${s.length} chars)` : s;
  } catch { return String(obj); }
}

/** 听歌足迹 - 总收听时长（/listen/data/total） */
export async function listenDataTotal(): Promise<{
  code: number;
  data?: { totalDuration?: number; time?: number; count?: number };
  totalDuration?: number;
  time?: number;
  count?: number;
}> {
  log.info("netease-api-music", "→ listenDataTotal()");
  const r = await apiGet("/listen/data/total");
  log.info("netease-api-music", "← listenDataTotal result", {
    code: r.code,
    keys: r && typeof r === "object" ? Object.keys(r) : [],
    totalDuration: r.data?.totalDuration || r.totalDuration,
    time: r.data?.time || r.time,
    count: r.data?.count || r.count,
    rawPreview: truncateForLog(r, 500),
  });
  return r;
}

/** 获取 VIP 信息（/vip/info/v2，app 端） */
export async function vipInfo(uid?: number): Promise<{
  code: number;
  data?: {
    redVipLevel?: number;
    redVipLevelIcon?: string;
    musicPackage?: { vipCode?: number; vipLevel?: number; expireTime?: number };
    associator?: { vipCode?: number; vipLevel?: number; expireTime?: number };
    isVip?: boolean;
    [key: string]: any;
  };
}> {
  const params: Record<string, string | number> = {};
  if (uid) params.uid = uid;
  log.info("netease-api-music", "→ vipInfo()", { uid });
  const r = await apiGet("/vip/info/v2", params);
  log.info("netease-api-music", "← vipInfo result", {
    code: r.code,
    keys: r && typeof r === "object" ? Object.keys(r) : [],
    dataKeys: r.data ? Object.keys(r.data) : [],
    redVipLevel: r.data?.redVipLevel,
    isVip: r.data?.isVip,
    musicPackage: r.data?.musicPackage,
    associator: r.data?.associator,
    rawPreview: truncateForLog(r, 800),
  });
  return r;
}

/** 获取用户等级信息（/user/level） */
export async function userLevel(): Promise<{
  code: number;
  data?: {
    level?: number;
    nowLoginCount?: number;
    nextLoginCount?: number;
    nowPlayCount?: number;
    nextPlayCount?: number;
    progress?: number;
    info?: string;
    userId?: number;
    full?: boolean;
  };
}> {
  log.info("netease-api-music", "→ userLevel()");
  const r = await apiGet("/user/level");
  const d = r.data;
  log.info("netease-api-music", "← userLevel result", {
    code: r.code,
    level: d?.level,
    nowLoginCount: d?.nowLoginCount,
    nextLoginCount: d?.nextLoginCount,
    nowPlayCount: d?.nowPlayCount,
    nextPlayCount: d?.nextPlayCount,
    progress: d?.progress,
    keys: d ? Object.keys(d) : [],
    rawPreview: truncateForLog(r, 500),
  });
  return r;
}
