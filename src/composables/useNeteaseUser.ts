/**
 * 网易云用户信息（VIP / 等级 / 听歌时长）
 * 从 App.vue 提取，负责登录后加载用户附加信息。
 */
import { ref } from "vue";
import { log } from "@/composables/logger";
import { _cachedUser, listenDataTotal, vipInfo, userLevel } from "@/api/netease";
import type { VipInfo, UserLevelInfo } from "@/types";

/** 格式化总听歌时长（秒 → x小时y分钟） */
export function formatListenTime(seconds: number): string {
  if (!seconds || seconds <= 0) return "0分钟";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}小时${m}分钟`;
  return `${m}分钟`;
}

export function useNeteaseUser() {
  const neVipInfo = ref<VipInfo | null>(null);
  const neListenTotal = ref<string>("");
  const neUserLevel = ref<UserLevelInfo | null>(null);

  /** 加载 VIP 信息、总听歌时长和用户等级 */
  async function loadVipAndListenData() {
    const user = _cachedUser.value;
    if (!user) return;
    const [vipRes, listenRes, levelRes] = await Promise.allSettled([
      vipInfo(user.userId),
      listenDataTotal(),
      userLevel(),
    ]);
    try {
      if (vipRes.status === "fulfilled") {
        const d = vipRes.value.data || vipRes.value as any;
        if (d) {
          const isVip = d.isVip ?? (d.associator?.vipLevel ?? 0) > 0;
          const level = d.redVipLevel || 0;
          const expire = d.associator?.expireTime || d.musicPackage?.expireTime;
          const expireText = expire ? new Date(expire).toLocaleDateString("zh-CN") : "";
          neVipInfo.value = { isVip, redVipLevel: level, expireText };
          log.info("app", "VIP info loaded", { isVip, level, expireText });
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

  return { neVipInfo, neListenTotal, neUserLevel, loadVipAndListenData, clearUserInfo };
}
