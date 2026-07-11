/** 网易云登录 / 认证相关 API */
import { log } from "@/composables/logger";
import { apiGet, apiPost, TAG, getCookie, setCookie, clearCookie, _cachedUser, _cachedPlaylists, _playlistsLoading } from "./core";
import { clearLikeCache } from "./like";
import { truncateForLog } from "@/utils/format";

/** 生成二维码 key */
export async function qrKey(): Promise<{ code: number; unikey: string }> {
  log.info(TAG, "qrKey()");
  const r = await apiGet("/login/qr/key");
  log.info(TAG, "qrKey result", { code: r.code, hasUnikey: !!r.unikey });
  return r;
}

/** 生成二维码图片（base64） */
export async function qrCreate(key: string): Promise<{
  code: number; qrimg: string; qrurl?: string; qrcode?: string;
}> {
  log.info(TAG, "qrCreate()", { key });
  const r = await apiGet("/login/qr/create", { key, qrimg: "true" });
  log.info(TAG, "qrCreate result", { code: r.code, hasQrimg: !!r.qrimg });
  return r;
}

/** 检测二维码扫码状态
 *  800=过期 801=等待扫码 802=待确认 803=授权成功(返回cookie) */
export async function qrCheck(key: string): Promise<{
  code: number; message: string; cookie?: string;
}> {
  const r = await apiGet("/login/qr/check", { key });
  log.info(TAG, "qrCheck", { key, code: r.code, message: r.message, hasCookie: !!r.cookie });
  return r;
}

/** 手机登录（/login/cellphone） */
export async function loginCellphone(params: {
  phone: string; password?: string; countrycode?: string; captcha?: string;
}): Promise<{ code: number; cookie?: string; profile?: any; account?: any }> {
  const p: Record<string, string> = { phone: params.phone };
  if (params.password) p.password = params.password;
  if (params.countrycode) p.countrycode = params.countrycode;
  if (params.captcha) p.captcha = params.captcha;
  log.info("netease-api-login", "→ loginCellphone()", { phone: params.phone, hasPassword: !!params.password, hasCaptcha: !!params.captcha });
  const r = await apiPost("/login/cellphone", p);
  log.info("netease-api-login", "← loginCellphone result", {
    code: r.code, hasProfile: !!r.profile, hasCookie: !!r.cookie,
    cookiePreview: r.cookie ? r.cookie.slice(0, 80) : "",
  });
  return r;
}

/** 邮箱登录（/login） */
export async function loginEmail(email: string, password: string): Promise<{ code: number; cookie?: string; profile?: any; account?: any }> {
  log.info("netease-api-login", "→ loginEmail()", { email });
  const r = await apiPost("/login", { email, password });
  log.info("netease-api-login", "← loginEmail result", {
    code: r.code, hasProfile: !!r.profile, hasCookie: !!r.cookie,
    cookiePreview: r.cookie ? r.cookie.slice(0, 80) : "",
  });
  return r;
}

/** 发送手机验证码（/captcha/sent） */
export async function captchaSent(phone: string, ctcode?: string): Promise<{ code: number; captcha?: boolean }> {
  const p: Record<string, string> = { phone };
  if (ctcode) p.ctcode = ctcode;
  log.info("netease-api-login", "→ captchaSent()", { phone });
  const r = await apiGet("/captcha/sent", p);
  log.info("netease-api-login", "← captchaSent result", { code: r.code, captcha: r.captcha });
  return r;
}

/** 登录状态 — 返回 profile（已登录）或 null（未登录） */
export async function loginStatus(): Promise<{ code: number; account: any; profile: {
  userId?: number; nickname?: string; avatarUrl?: string;
  signature?: string; createTime?: number; gender?: number;
  city?: number; province?: number; backgroundUrl?: string;
  [key: string]: any;
} | null }> {
  log.info(TAG, "loginStatus()");
  const r = await apiGet("/login/status");
  log.info("netease-api-login", "← loginStatus 原始数据", {
    code: r.code, hasProfile: !!r.profile, userId: r.profile?.userId,
    nickname: r.profile?.nickname, vipType: r.profile?.vipType,
    isVip: r.profile?.vipType > 0, rawPreview: truncateForLog(r, 1000),
  });
  return r;
}

/** 账号信息（获取 uid） */
export async function userAccount(): Promise<{
  code: number; account?: any; profile?: { userId: number; nickname: string; avatarUrl: string };
}> {
  log.info(TAG, "userAccount()");
  const r = await apiGet("/user/account");
  log.info(TAG, "userAccount result", { code: r.code, userId: r.profile?.userId });
  return r;
}

/** 退出登录 */
export async function logout(): Promise<{ code: number }> {
  log.info(TAG, "logout()");
  const r = await apiGet("/logout");
  clearCookie();
  _cachedUser.value = null;
  _cachedPlaylists.value = [];
  _playlistsLoading.value = false;
  clearLikeCache();
  log.info(TAG, "logout done, cookie cleared");
  return r;
}

// re-export cookie helpers for convenience
export { getCookie, setCookie, clearCookie };
