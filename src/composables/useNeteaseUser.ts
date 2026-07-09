/**
 * 网易云用户信息（VIP / 等级 / 听歌时长）
 * 从 App.vue 提取，负责登录后加载用户附加信息。
 *
 * refs 为模块级单例，确保 useNeteaseAuth 和 App.vue 读取同一份数据。
 */
import { ref } from "vue";
import { log } from "@/composables/logger";
import { _cachedUser, listenDataTotal, vipInfo, userLevel, userDetail } from "@/api/netease";
import type { VipInfo, UserLevelInfo } from "@/types";

/** 格式化总听歌时长（秒 → x小时y分钟） */
export function formatListenTime(seconds: number): string {
  if (!seconds || seconds <= 0) return "0分钟";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}小时${m}分钟`;
  return `${m}分钟`;
}

/** 性别代码转文字（0=保密, 1=男, 2=女） */
export function genderText(gender?: number): string {
  if (gender === 1) return "男";
  if (gender === 2) return "女";
  return "保密";
}

/** 格式化创建时间戳（ms → yyyy-MM-dd） */
export function formatCreateTime(ms?: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 网易云行政区划代码 → 省市名称（常见直辖市/省份映射） */
const REGION_MAP: Record<number, string> = {
  11: "北京", 12: "天津", 31: "上海", 50: "重庆",
  13: "河北", 14: "山西", 15: "内蒙古", 21: "辽宁", 22: "吉林", 23: "黑龙江",
  32: "江苏", 33: "浙江", 34: "安徽", 35: "福建", 36: "江西", 37: "山东",
  41: "河南", 42: "湖北", 43: "湖南", 44: "广东", 45: "广西", 46: "海南",
  51: "四川", 52: "贵州", 53: "云南", 54: "西藏", 61: "陕西", 62: "甘肃",
  63: "青海", 64: "宁夏", 65: "新疆", 71: "台湾", 81: "香港", 82: "澳门",
};
/** 直辖市下的区直接归到直辖市 */
const MUNICIPALITIES = new Set([11, 12, 31, 50]);

/** 行政区划代码 → "省份" 或 "省份 城市" */
export function regionText(province?: number, city?: number): string {
  const provCode = province ? Math.floor(province / 10000) : 0;
  const cityCode = city ? Math.floor(city / 10000) : 0;
  const provName = REGION_MAP[provCode] || "";
  // 直辖市：只显示直辖市名（city 的前两位也是直辖市代码）
  if (MUNICIPALITIES.has(provCode) || MUNICIPALITIES.has(cityCode)) {
    return REGION_MAP[provCode] || REGION_MAP[cityCode] || "";
  }
  // 非直辖市且有不同城市代码：显示 "省 市"，但城市名无法精确（只有代码）
  // 简化：只显示省份（网易云 city 是 6 位区划码，精确城市名需完整区划表）
  return provName;
}

// 模块级单例 refs —— 所有 useNeteaseUser() 调用共享同一份数据
const neVipInfo = ref<VipInfo | null>(null);
const neListenTotal = ref<string>("");
const neUserLevel = ref<UserLevelInfo | null>(null);

/** 加载 VIP 信息、总听歌时长和用户等级 */
async function loadVipAndListenData() {
  const user = _cachedUser.value;
  if (!user) return;
  const [vipRes, listenRes, levelRes, detailRes] = await Promise.allSettled([
    vipInfo(user.userId),
    listenDataTotal(),
    userLevel(),
    userDetail(user.userId),
  ]);
  // 合并用户详情（signature/createTime/gender/city/province）到 _cachedUser
  if (detailRes.status === "fulfilled") {
    const profile = detailRes.value.profile;
    if (profile) {
      _cachedUser.value = {
        ...user,
        signature: profile.signature || "",
        createTime: profile.createTime,
        gender: profile.gender,
        city: profile.city,
        province: profile.province,
        backgroundUrl: profile.backgroundUrl || "",
      };
      log.info("app", "userDetail merged", {
        signature: profile.signature,
        gender: profile.gender,
        city: profile.city,
        createTime: profile.createTime,
        hasBg: !!profile.backgroundUrl,
      });
    }
  }
  try {
    if (vipRes.status === "fulfilled") {
      const d = vipRes.value.data || vipRes.value as any;
      if (d) {
        const isVip = d.isVip ?? (d.associator?.vipLevel ?? 0) > 0;
        const level = d.redVipLevel || 0;
        const expire = d.associator?.expireTime || d.musicPackage?.expireTime;
        const expireText = expire ? new Date(expire).toLocaleDateString("zh-CN") : "";
        // API 返回的 iconUrl/dynamicIconUrl 经常为 null（接口鉴权限制），
        // 黑胶 VIP(isSign=true 或 vipCode=100) 使用官方固定图标 URL 兜底。
        const DEFAULT_VIP_ICON = "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/32582188099/3419/2b65/d241/bd664461c263a2dfdbf631bb9848ee3e.png";
        const DEFAULT_VIP_DYNAMIC = "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/32141390012/8f22/7796/8597/3c4e43ad7036268bd80ec4a4d7623d61.webp";
        const isHeijiaoVip = isVip && (d.associator?.isSign === true || d.associator?.vipCode === 100 || (d.associator?.vipLevel ?? 0) > 0);
        let dynamicIconUrl = d.associator?.dynamicIconUrl || "";
        let iconUrl = d.associator?.iconUrl || "";
        // API 返回 null 时用默认黑胶 VIP 图标
        if (isHeijiaoVip && !dynamicIconUrl) dynamicIconUrl = DEFAULT_VIP_DYNAMIC;
        if (isHeijiaoVip && !iconUrl) iconUrl = DEFAULT_VIP_ICON;
        neVipInfo.value = { isVip, redVipLevel: level, expireText, dynamicIconUrl, iconUrl };
        log.info("app", "VIP info loaded", { isVip, level, expireText, hasDynamic: !!dynamicIconUrl, hasIcon: !!iconUrl, usedDefault: isHeijiaoVip && (!d.associator?.iconUrl || !d.associator?.dynamicIconUrl) });
      }
    }
  } catch (e) { log.warn("app", "load vip failed", { error: String(e) }); }
  if (listenRes.status === "fulfilled") {
    const time = listenRes.value.data?.totalDuration || listenRes.value.totalDuration || listenRes.value.data?.time || listenRes.value.time || 0;
    neListenTotal.value = formatListenTime(time);
    log.info("app", "listen total loaded", { time, formatted: neListenTotal.value });
  }
  if (levelRes.status === "fulfilled") {
    const d = levelRes.value.data || levelRes.value as any;
    if (d && d.level != null) {
      const progress = Math.round((d.progress || 0) * 100);
      neUserLevel.value = {
        level: d.level,
        nowLoginCount: d.nowLoginCount || 0,
        nextLoginCount: d.nextLoginCount || 0,
        nowPlayCount: d.nowPlayCount || 0,
        nextPlayCount: d.nextPlayCount || 0,
        progress,
        needLogin: Math.max(0, (d.nextLoginCount || 0) - (d.nowLoginCount || 0)),
        needPlay: Math.max(0, (d.nextPlayCount || 0) - (d.nowPlayCount || 0)),
      };
      log.info("app", "user level loaded", { level: d.level, progress, needLogin: neUserLevel.value.needLogin, needPlay: neUserLevel.value.needPlay });
    }
  }
}

/** 退出登录时清空 */
function clearUserInfo() {
  neVipInfo.value = null;
  neListenTotal.value = "";
  neUserLevel.value = null;
}

export function useNeteaseUser() {
  return { neVipInfo, neListenTotal, neUserLevel, loadVipAndListenData, clearUserInfo };
}
