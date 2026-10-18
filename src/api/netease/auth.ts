/** 网易云登录 / 认证相关 API */
import { log } from "@/composables/logger";
import { apiGet, apiPost, TAG, getCookie, setCookie, clearCookie, _cachedUser, _cachedPlaylists, _playlistsLoading } from "./core";
import { clearLikeCache } from "./like";
import { truncateForLog } from "@/utils/format";

export interface LoginResult {
  code: number;
  cookie?: string;
  profile?: any;
  account?: any;
  msg?: string;
  message?: string;
}

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
}): Promise<LoginResult> {
  const p: Record<string, string> = { phone: params.phone };
  if (params.password) p.password = params.password;
  if (params.countrycode) p.countrycode = params.countrycode;
  if (params.captcha) p.captcha = params.captcha;
  log.info("netease-api-login", "→ loginCellphone()", {
    countrycode: params.countrycode || "86",
    hasPassword: !!params.password,
    hasCaptcha: !!params.captcha,
  });
  const r = await apiPost<LoginResult>("/login/cellphone", p);
  log.info("netease-api-login", "← loginCellphone result", {
    code: r.code, hasProfile: !!r.profile, hasCookie: !!r.cookie,
  });
  return r;
}

/** 邮箱登录（/login） */
export async function loginEmail(email: string, password: string): Promise<LoginResult> {
  log.info("netease-api-login", "→ loginEmail()", { domain: email.split("@").pop() || "" });
  const r = await apiPost<LoginResult>("/login", { email, password });
  log.info("netease-api-login", "← loginEmail result", {
    code: r.code, hasProfile: !!r.profile, hasCookie: !!r.cookie,
  });
  return r;
}

/** 发送手机验证码（/captcha/sent） */
export async function captchaSent(phone: string, ctcode?: string): Promise<{ code: number; captcha?: boolean; message?: string }> {
  const p: Record<string, string> = { phone };
  if (ctcode) p.ctcode = ctcode;
  log.info("netease-api-login", "→ captchaSent()", { phone, ctcode });
  const r = await apiGet("/captcha/sent", p);
  log.info("netease-api-login", "← captchaSent result", { code: r.code, captcha: r.captcha });
  return r;
}

/** 校验手机验证码（/captcha/verify）。code=200 表示验证码正确。 */
export async function captchaVerify(phone: string, captcha: string, ctcode?: string): Promise<{ code: number; data?: boolean; message?: string }> {
  const p: Record<string, string> = { phone, captcha };
  if (ctcode) p.ctcode = ctcode;
  log.info("netease-api-login", "→ captchaVerify()", { phone });
  const r = await apiGet("/captcha/verify", p);
  log.info("netease-api-login", "← captchaVerify result", { code: r.code, data: r.data });
  return r;
}

/** 单个国家码条目 */
export interface CountryCodeItem {
  /** 中文国家/地区名 */
  zh: string;
  /** 英文国家/地区名 */
  en: string;
  /** 两位地区码（如 CN） */
  locale: string;
  /** 国际区号（如 86），不含 + 号 */
  code: string;
}

/** 国家码分组（label 为首字母或"常用"） */
export interface CountryCodeGroup {
  label: string;
  countryList: CountryCodeItem[];
}

/** 国家码列表（/countries/code/list） */
export async function countriesCodeList(): Promise<{ code: number; data: CountryCodeGroup[] }> {
  log.info("netease-api-login", "→ countriesCodeList()");
  const r = await apiGet<{ code: number; data?: CountryCodeGroup[] }>("/countries/code/list");
  const data = Array.isArray(r.data)
    ? r.data.map(group => ({
        label: String(group.label || ""),
        countryList: Array.isArray(group.countryList)
          ? group.countryList.map(country => ({
              zh: String(country.zh || ""),
              en: String(country.en || ""),
              locale: String(country.locale || ""),
              code: String(country.code || ""),
            })).filter(country => !!country.code)
          : [],
      })).filter(group => group.countryList.length > 0)
    : [];
  log.info("netease-api-login", "← countriesCodeList result", { code: r.code, groups: data.length });
  return { code: r.code, data };
}

/** 检测手机号是否已注册（/cellphone/existence/check）
 *  exist: 1=已注册, 0=未注册；hasPassword 表示该账号是否设置了密码。 */
export async function cellphoneExistenceCheck(phone: string, countrycode?: string): Promise<{
  code: number; exist: number; hasPassword?: boolean; nickname?: string; avatarUrl?: string;
}> {
  const p: Record<string, string> = { phone };
  if (countrycode) p.countrycode = countrycode;
  log.info("netease-api-login", "→ cellphoneExistenceCheck()", { phone, countrycode });
  const r = await apiGet("/cellphone/existence/check", p);
  log.info("netease-api-login", "← cellphoneExistenceCheck result", { code: r.code, exist: r.exist, hasPassword: r.hasPassword });
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

/** 刷新登录状态。二维码登录取得的 Cookie 由上游接口限制，可能无法刷新。 */
export async function loginRefresh(): Promise<LoginResult> {
  log.info(TAG, "loginRefresh()");
  const r = await apiGet<LoginResult>("/login/refresh");
  if (r.code === 200 && r.cookie) setCookie(r.cookie);
  log.info(TAG, "loginRefresh result", { code: r.code, hasCookie: !!r.cookie });
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
