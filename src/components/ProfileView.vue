<script setup lang="ts">
/**
 * ProfileView - 全屏个人主页（重构版）
 *
 * 设计要点：
 *   - 去掉背景图，全屏滚动卡片布局（与推荐页风格一致）
 *   - 所有卡片采用透明玻璃样式（有壁纸时半透明 + backdrop-filter）
 *   - 同屏展示：用户信息 / 听歌统计 / 我的歌单 / 最近播放 / 听歌排行
 *
 * 数据来源：
 *   - _cachedUser (api/netease)                              用户基本信息
 *   - useNeteaseUser (composables)                          VIP/听歌时长/等级
 *   - getCachedPlaylists (api/netease)                      我的歌单
 *   - recordRecentSong (api/netease)                        最近播放（前 10）
 *   - userRecord (api/netease)                              听歌排行（本周前 10）
 *   - neteaseSongToSong (api/netease)                       网易云歌曲 → Song 转换
 *   - usePlayerStore (stores/player)                        播放控制 / 视图切换
 */
import { computed, ref, watch, onMounted } from "vue";
import { usePlayerStore } from "@/stores/player";
import {
  _cachedUser,
  getCachedPlaylists,
  recordRecentSong,
  userRecord,
  neteaseSongToSong,
} from "@/api/netease";
import {
  dailySignin,
  yunbeiSign,
  yunbeiAccount,
  vipSign,
  vipGrowthpoint,
  vipTasks,
  vipGrowthpointGet,
} from "@/api/netease/signin";
import {
  useNeteaseUser,
  formatCreateTime,
  genderText,
  regionText,
} from "@/composables/useNeteaseUser";
import { formatTime } from "@/utils/format";
import type { NeteasePlaylist, NeteaseSong, Song } from "@/types";
import Icon from "@/components/Icon.vue";

const store = usePlayerStore();
const { neVipInfo, neListenTotal, neUserLevel } = useNeteaseUser();

const neUser = _cachedUser; // ref<NeteaseUser | null>

// ===== VIP 图标加载 =====
// 每次进入个人主页，优先请求动画图(dynamicIconUrl)；加载失败才回退常规图(iconUrl)。
// vipIconSrc: 当前显示的图源；vipDynamicFailed: 动画图是否已失败（避免反复重试）
const vipIconSrc = ref("");
const vipDynamicFailed = ref(false);

/** 重置 VIP 图状态：每次进入个人主页调用一次 */
function resetVipIcon() {
  vipDynamicFailed.value = false;
  const v = neVipInfo.value;
  if (!v) { vipIconSrc.value = ""; return; }
  if (v.dynamicIconUrl) {
    vipIconSrc.value = v.dynamicIconUrl;
  } else if (v.iconUrl) {
    vipIconSrc.value = v.iconUrl;
  } else {
    vipIconSrc.value = "";
  }
}

/** 动画图加载失败 → 切换到常规图 */
function onVipIconError() {
  if (vipDynamicFailed.value) return; // 常规图也失败，不再切换
  vipDynamicFailed.value = true;
  const fallback = neVipInfo.value?.iconUrl || "";
  if (fallback && vipIconSrc.value !== fallback) {
    vipIconSrc.value = fallback;
  }
}

// 是否已发起过听歌排行的请求（避免 neUser 异步加载完成后重复请求）
let weekRankLoaded = false;

// 3分钟缓存：进入个人主页时，3分钟内不重复加载数据
const PROFILE_CACHE_MS = 3 * 60 * 1000;
let lastProfileLoadTime = 0;

// 每次组件挂载（即每次进入个人主页）重置 VIP 图，触发动画图重新请求+播放
onMounted(() => {
  resetVipIcon();
  const now = Date.now();
  if (now - lastProfileLoadTime > PROFILE_CACHE_MS) {
    loadPlaylists();
    loadRecentSongs();
    if (neUser.value?.userId) {
      weekRankLoaded = true;
      loadWeekRank();
    }
    // 加载签到/云贝数据（一次请求获取余额+签到状态）
    loadSigninInfo();
    lastProfileLoadTime = now;
  }
});
// VIP 信息异步加载完成后再进入主页时也重置一次
watch(() => neVipInfo.value, () => {
  if (!vipIconSrc.value) resetVipIcon();
});
// neUser 异步到达后再拉取听歌排行
watch(() => neUser.value?.userId, (uid) => {
  if (uid && !weekRankLoaded) {
    weekRankLoaded = true;
    loadWeekRank();
  }
});

/** 个人资料项（注册时间 / 性别 / 所在地，空值自动隐藏） */
const profileItems = computed(() => {
  const u = neUser.value;
  if (!u) return [];
  const items: { icon: string; label: string; value: string }[] = [];
  const createTimeText = formatCreateTime(u.createTime);
  if (createTimeText) {
    items.push({ icon: "calendar", label: "注册时间", value: createTimeText });
  }
  // gender 0 = 保密，不显示
  if (u.gender && u.gender !== 0) {
    items.push({ icon: "user", label: "性别", value: genderText(u.gender) });
  }
  const region = regionText(u.province, u.city);
  if (region) {
    items.push({ icon: "mapPin", label: "所在地区", value: region });
  }
  return items;
});

/** 用户等级进度条宽度（百分比） */
const levelBarStyle = computed(() => {
  if (!neUserLevel.value) return { width: "0%" };
  return { width: `${neUserLevel.value.progress}%` };
});

// ===== 内联 SVG 图标（user/calendar/mapPin 不在 Icon.vue 的 ICONS 中） =====
// 与 Icon.vue 同样的 24x24 viewBox / stroke 1.8 / currentColor 风格
const SVG_USER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/></svg>`;
const SVG_CALENDAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 9h16M8 3v4M16 3v4"/></svg>`;
const SVG_MAPPIN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-5.6-7-11a7 7 0 0 1 14 0c0 5.4-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`;

const ICON_MAP: Record<string, string> = {
  calendar: SVG_CALENDAR,
  user: SVG_USER,
  mapPin: SVG_MAPPIN,
};

// ===== 我的歌单 =====
const myPlaylists = ref<NeteasePlaylist[]>([]);
const loadingPlaylists = ref(false);
const playlistsRowRef = ref<HTMLElement | null>(null);

/** 鼠标滚轮上下滚动时，横向平滑滑动歌单列表（提速 1.8 倍） */
function onPlaylistsWheel(e: WheelEvent) {
  if (!playlistsRowRef.value) return;
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    e.preventDefault();
    const el = playlistsRowRef.value;
    // 速度倍数：滚轮 delta 乘以 1.8，滚动更快
    const delta = e.deltaY * 1.8;
    el.scrollTo({ left: el.scrollLeft + delta, behavior: "smooth" });
  }
}

async function loadPlaylists() {
  loadingPlaylists.value = true;
  try {
    myPlaylists.value = await getCachedPlaylists();
  } catch (e) {
    console.warn("[ProfileView] loadPlaylists error:", e);
    myPlaylists.value = [];
  } finally {
    loadingPlaylists.value = false;
  }
}

function openPlaylist(pl: NeteasePlaylist) {
  store.pendingPlaylistId = pl.id;
  store.setView("netease");
}

// ===== 最近播放 =====
const recentSongs = ref<Song[]>([]);
const loadingRecent = ref(false);

async function loadRecentSongs() {
  loadingRecent.value = true;
  try {
    const r = await recordRecentSong(10);
    const list = Array.isArray(r.data)
      ? r.data
      : ((r.data as any)?.list as any[]) || r.list || [];
    recentSongs.value = list.slice(0, 10).map((item: any): Song => {
      // 兼容 { song } / { data: { song } } / { data: NeteaseSong } / NeteaseSong 几种形态
      const ns: NeteaseSong =
        item.song || item.data?.song || item.data || item;
      return neteaseSongToSong(ns);
    });
  } catch (e) {
    console.warn("[ProfileView] loadRecentSongs error:", e);
    recentSongs.value = [];
  } finally {
    loadingRecent.value = false;
  }
}

// ===== 听歌排行（本周） =====
const weekRank = ref<{ song: Song; playCount: number }[]>([]);
const loadingRank = ref(false);

async function loadWeekRank() {
  const uid = neUser.value?.userId;
  if (!uid) { loadingRank.value = false; return; }
  loadingRank.value = true;
  try {
    const r = await userRecord(uid, 1); // type=1 → weekData
    const list = r.weekData || [];
    weekRank.value = list.slice(0, 10).map((item) => ({
      song: neteaseSongToSong(item.song),
      playCount: item.playCount || 0,
    }));
  } catch (e) {
    console.warn("[ProfileView] loadWeekRank error:", e);
    weekRank.value = [];
  } finally {
    loadingRank.value = false;
  }
}

/** 当前播放歌曲 id，用于高亮 */
const currentSongId = computed(() => store.currentSong?.id || "");

/** 播放某首歌（点击最近播放 / 听歌排行行） */
function playSongAt(song: Song, list: Song[]) {
  const idx = list.findIndex((s) => s.id === song.id);
  if (idx >= 0 && list.length > 1) {
    store.playList(list.slice(), idx);
  } else {
    store.playNow(song);
  }
}

function goBack() {
  store.setView("recommend");
}

// ===== 签到 / 云贝（弹窗式）=====
const showSigninModal = ref(false);     // 弹窗是否可见
const dailySigned = ref(false);        // 每日签到是否已完成
const dailySignLoading = ref(false);
const dailySignResult = ref("");       // 签到结果提示

const yunbeiSigned = ref(false);       // 云贝签到是否已完成
const yunbeiSignLoading = ref(false);
const yunbeiSignResult = ref("");

const yunbeiBalance = ref<number | null>(null); // 云贝余额
const yunbeiBalanceLoading = ref(false);

// VIP 乐签打卡
const vipSigned = ref(false);            // 乐签打卡是否已完成
const vipSignLoading = ref(false);
const vipSignResult = ref("");

// VIP 成长值 & 等级
const vipGrowthValue = ref<number | null>(null); // 成长值
const vipGrowthLoading = ref(false);
const vipLevel = ref<number | null>(null);          // VIP 等级
const vipLevelName = ref<string | null>(null);     // VIP 等级名称，如 "黑胶·叁"

// 领取 VIP 成长值
const vipGrowthGetLoading = ref(false);
const vipGrowthGetResult = ref("");

/** 每日签到 */
async function doDailySignin() {
  dailySignLoading.value = true;
  dailySignResult.value = "";
  try {
    const r = await dailySignin(0); // type=0 安卓签到（3积分）
    if (r.code === 200) {
      dailySigned.value = true;
      dailySignResult.value = `签到成功！+${r.point || 3} 积分`;
      loadSigninInfo(); // 签到后刷新余额和状态
    } else if (r.code === -2) {
      // 重复签到
      dailySigned.value = true;
      dailySignResult.value = "今日已签到";
    } else {
      dailySignResult.value = `签到失败 (${r.code || '未知错误'})`;
    }
  } catch (e) {
    dailySignResult.value = "签到失败，请检查网络";
  } finally {
    dailySignLoading.value = false;
  }
}

/** 云贝签到 */
async function doYunbeiSign() {
  yunbeiSignLoading.value = true;
  yunbeiSignResult.value = "";
  try {
    const r = await yunbeiSign();
    if (r.code === 200) {
      yunbeiSigned.value = true;
      yunbeiSignResult.value = "云贝签到成功！";
      loadSigninInfo(); // 签到后刷新余额和状态
    } else if (r.code === -2) {
      // 重复签到
      yunbeiSigned.value = true;
      yunbeiSignResult.value = "今日已签到";
    } else {
      yunbeiSignResult.value = `签到失败 (${r.code || '未知错误'})`;
    }
  } catch (e) {
    yunbeiSignResult.value = "签到失败，请检查网络";
  } finally {
    yunbeiSignLoading.value = false;
  }
}

/** 加载云贝账户信息（一次请求同时获取余额 + 签到状态）
 *  /yunbei/info 返回：
 *    - userPoint.balance: 云贝总数
 *    - mobileSign: 安卓端是否已签到
 *    - pcSign: PC端是否已签到
 */
async function loadSigninInfo() {
  yunbeiBalanceLoading.value = true;
  try {
    const r = await yunbeiAccount();
    if (r.code === 200) {
      // 云贝余额
      yunbeiBalance.value = r.userPoint?.balance ?? null;
      // 每日签到状态：mobileSign=true 表示安卓端已签到
      dailySigned.value = !!r.mobileSign;
      // 云贝签到状态：mobileSign 或 pcSign 任一为 true 即表示今日已签到
      yunbeiSigned.value = !!r.mobileSign || !!r.pcSign;
    }
  } catch (e) {
    yunbeiBalance.value = null;
  } finally {
    yunbeiBalanceLoading.value = false;
  }
}

/** VIP 乐签打卡 */
async function doVipSign() {
  vipSignLoading.value = true;
  vipSignResult.value = "";
  try {
    const r = await vipSign();
    if (r.code === 200) {
      vipSigned.value = true;
      vipSignResult.value = "打卡成功！";
      loadVipGrowth(); // 打卡后刷新成长值
    } else if (r.code === -2) {
      vipSigned.value = true;
      vipSignResult.value = "今日已打卡";
    } else {
      vipSignResult.value = `打卡失败 (${r.code || '未知错误'})`;
    }
  } catch (e) {
    vipSignResult.value = "打卡失败，请检查网络";
  } finally {
    vipSignLoading.value = false;
  }
}

/** 加载 VIP 成长值（/vip/growthpoint）
 *  normalizeResponse 会自动解包 data 层，所以实际返回结构为：
 *    r.userLevel.growthPoint — 当前成长值
 *    r.userLevel.level       — VIP 等级
 *    r.userLevel.levelName   — 等级名称，如 "黑胶·叁"
 */
async function loadVipGrowth() {
  vipGrowthLoading.value = true;
  try {
    const r = await vipGrowthpoint();
    if (r.code === 200) {
      vipGrowthValue.value = r.userLevel?.growthPoint ?? null;
      vipLevel.value = r.userLevel?.level ?? null;
      vipLevelName.value = r.userLevel?.levelName ?? null;
    }
  } catch (e) {
    vipGrowthValue.value = null;
    vipLevel.value = null;
    vipLevelName.value = null;
  } finally {
    vipGrowthLoading.value = false;
  }
}

/** 领取 VIP 成长值
 *  流程：先调用 /vip/tasks 获取 unGetIds，再调用 /vip/growthpoint/get?ids=... 领取
 */
async function doVipGrowthGet() {
  vipGrowthGetLoading.value = true;
  vipGrowthGetResult.value = "";
  try {
    // 1. 获取 VIP 任务列表，提取 unGetIds
    const tasksRes = await vipTasks();
    if (tasksRes.code !== 200) {
      vipGrowthGetResult.value = "获取任务失败";
      return;
    }
    // unGetIds 可能是数组或字符串，需要拼接为逗号分隔的 ids
    const unGetIds = tasksRes.unGetIds || tasksRes.data?.unGetIds;
    if (!unGetIds || (Array.isArray(unGetIds) && unGetIds.length === 0)) {
      vipGrowthGetResult.value = "暂无可领取";
      return;
    }
    // 拼接 ids 字符串
    const ids = Array.isArray(unGetIds) ? unGetIds.join(",") : String(unGetIds);
    // 2. 领取成长值
    const r = await vipGrowthpointGet(ids);
    if (r.code === 200) {
      vipGrowthGetResult.value = "领取成功！";
      loadVipGrowth(); // 领取后刷新成长值
    } else {
      vipGrowthGetResult.value = `领取失败 (${r.code || '未知错误'})`;
    }
  } catch (e) {
    vipGrowthGetResult.value = "领取失败，请检查网络";
  } finally {
    vipGrowthGetLoading.value = false;
  }
}

/** 打开签到弹窗时，自动刷新余额和签到状态 */
function openSigninModal() {
  showSigninModal.value = true;
  loadSigninInfo();
  loadVipGrowth();
}

/** 关闭弹窗 */
function closeSigninModal() {
  showSigninModal.value = false;
}

/** 点击遮罩层关闭 */
function onModalOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) closeSigninModal();
}

/** 弹窗内快捷摘要：签到+云贝+VIP状态 */
const signinSummary = computed(() => {
  const parts: string[] = [];
  if (dailySigned.value) parts.push("已签到");
  if (yunbeiBalance.value !== null) parts.push(`云贝 ${yunbeiBalance.value}`);
  if (vipGrowthValue.value !== null) parts.push(`成长值 ${vipGrowthValue.value}${vipLevelName.value ? ` (${vipLevelName.value})` : ''}`);
  return parts.length ? parts.join(" · ") : "";
});

// 内联 SVG 图标（签到/云贝/VIP）
const SVG_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const SVG_COIN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v12"/><path d="M15.5 9a3 3 0 0 0-7 0c0 1.5 1.5 2 3 2.5s3 1 3 2.5a3 3 0 0 1-7 0"/></svg>`;
const SVG_VIP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
const SVG_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="M6 6 18 18"/></svg>`;
</script>

<template>
  <section class="profile-view nice-scroll">
    <!-- 未登录空状态 -->
    <div v-if="!neUser" class="profile-empty">
      <span class="empty-icon" v-html="SVG_USER" />
      <p>请登录网易云音乐</p>
      <button class="empty-back-btn" @click="goBack">返回</button>
    </div>

    <!-- 已登录：滚动卡片布局 -->
    <template v-else>
      <!-- 顶部：用户信息卡片（头像左 + 信息右） -->
      <div class="profile-card user-card">
        <img
          v-if="neUser.avatarUrl"
          :src="neUser.avatarUrl"
          class="user-avatar"
          referrerpolicy="no-referrer"
          alt="avatar"
        />
        <div v-else class="user-avatar user-avatar-fallback">
          <span class="avatar-fallback-icon" v-html="SVG_USER" />
        </div>

        <div class="user-info">
          <div class="user-name-row">
            <h1 class="user-nickname">{{ neUser.nickname }}</h1>
            <!-- VIP 图标：优先动画图(dynamicIconUrl)，失败回退常规图(iconUrl) -->
            <img
              v-if="vipIconSrc"
              :src="vipIconSrc"
              class="user-vip-icon"
              :class="{ 'is-dynamic': !vipDynamicFailed }"
              referrerpolicy="no-referrer"
              :alt="neVipInfo?.isVip ? `黑胶VIP${neVipInfo.redVipLevel || ''}` : 'VIP'"
              @error="onVipIconError"
            />
          </div>
          <p v-if="neUser.signature" class="user-signature" :title="neUser.signature">
            {{ neUser.signature }}
          </p>
          <p v-if="neVipInfo?.expireText" class="user-vip-expire">
            VIP 到期: {{ neVipInfo.expireText }}
          </p>

          <!-- 资料条：注册时间 / 性别 / 所在地区 + 签到按钮（横向排列） -->
          <div class="user-meta-row">
            <div v-if="profileItems.length" class="user-meta">
              <div v-for="item in profileItems" :key="item.label" class="meta-pill">
                <span class="meta-icon" v-html="ICON_MAP[item.icon]" />
                <span class="meta-label">{{ item.label }}</span>
                <span class="meta-value">{{ item.value }}</span>
              </div>
            </div>
            <button class="signin-trigger" :class="{ done: dailySigned && yunbeiSigned && vipSigned }" @click="openSigninModal">
              <span class="signin-trigger-icon" v-html="SVG_CHECK" />
              <span v-if="dailySigned && yunbeiSigned && vipSigned">已签到</span>
              <span v-else>签到</span>
              <span v-if="signinSummary" class="signin-trigger-summary">{{ signinSummary }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 签到弹窗 -->
      <Teleport to="body">
        <Transition name="modal">
          <div v-if="showSigninModal" class="modal-overlay" @click="onModalOverlayClick">
            <div class="modal-panel">
              <div class="modal-header">
                <span class="modal-title">
                  <span class="modal-title-icon" v-html="SVG_CHECK" />
                  签到 & 云贝
                </span>
                <button class="modal-close" @click="closeSigninModal">
                  <span v-html="SVG_CLOSE" />
                </button>
              </div>
              <div class="modal-body">
                <!-- 每日签到 -->
                <div class="signin-row">
                  <div class="signin-info">
                    <span class="signin-label">每日签到</span>
                    <span class="signin-sublabel">安卓端 +3 积分</span>
                    <span v-if="dailySignResult" class="signin-result" :class="{ success: dailySigned }">{{ dailySignResult }}</span>
                  </div>
                  <button
                    class="signin-btn"
                    :class="{ done: dailySigned }"
                    :disabled="dailySigned || dailySignLoading"
                    @click="doDailySignin"
                  >
                    <span v-if="dailySignLoading" class="spinner-sm" />
                    <span v-else-if="dailySigned" class="signin-check-icon" v-html="SVG_CHECK" />
                    <span v-else>签到</span>
                  </button>
                </div>

                <!-- 云贝签到 -->
                <div class="signin-row">
                  <div class="signin-info">
                    <span class="signin-label">云贝签到</span>
                    <span v-if="yunbeiSignResult" class="signin-result" :class="{ success: yunbeiSigned }">{{ yunbeiSignResult }}</span>
                  </div>
                  <button
                    class="signin-btn yunbei"
                    :class="{ done: yunbeiSigned }"
                    :disabled="yunbeiSigned || yunbeiSignLoading"
                    @click="doYunbeiSign"
                  >
                    <span v-if="yunbeiSignLoading" class="spinner-sm" />
                    <span v-else-if="yunbeiSigned" class="signin-check-icon" v-html="SVG_CHECK" />
                    <span v-else>签到</span>
                  </button>
                </div>

                <!-- VIP 乐签打卡 -->
                <div class="signin-row">
                  <div class="signin-info">
                    <span class="vip-icon" v-html="SVG_VIP" />
                    <span class="signin-label">乐签打卡</span>
                    <span v-if="vipSignResult" class="signin-result" :class="{ success: vipSigned }">{{ vipSignResult }}</span>
                  </div>
                  <button
                    class="signin-btn vip"
                    :class="{ done: vipSigned }"
                    :disabled="vipSigned || vipSignLoading"
                    @click="doVipSign"
                  >
                    <span v-if="vipSignLoading" class="spinner-sm" />
                    <span v-else-if="vipSigned" class="signin-check-icon" v-html="SVG_CHECK" />
                    <span v-else>打卡</span>
                  </button>
                </div>

                <!-- 分隔线 -->
                <div class="signin-divider" />

                <!-- 云贝余额 -->
                <div class="signin-row">
                  <div class="signin-info">
                    <span class="coin-icon" v-html="SVG_COIN" />
                    <span class="signin-label">云贝余额</span>
                  </div>
                  <span class="yunbei-balance">
                    <span v-if="yunbeiBalanceLoading" class="spinner-sm" />
                    <span v-else-if="yunbeiBalance !== null">{{ yunbeiBalance }}</span>
                    <span v-else class="text-tertiary">--</span>
                  </span>
                </div>

                <!-- VIP 成长值 & 等级 -->
                <div class="signin-row">
                  <div class="signin-info">
                    <span class="vip-icon" v-html="SVG_VIP" />
                    <span class="signin-label">VIP 成长值</span>
                    <span v-if="vipLevelName" class="signin-sublabel">{{ vipLevelName }}</span>
                  </div>
                  <span class="yunbei-balance">
                    <span v-if="vipGrowthLoading" class="spinner-sm" />
                    <template v-else-if="vipGrowthValue !== null">
                      <span class="vip-growth-num">{{ vipGrowthValue }}</span>
                      <span v-if="vipLevel !== null" class="vip-level-badge">Lv.{{ vipLevel }}</span>
                    </template>
                    <span v-else class="text-tertiary">--</span>
                  </span>
                </div>

                <!-- 领取 VIP 成长值 -->
                <div class="signin-row">
                  <div class="signin-info">
                    <span class="vip-icon" v-html="SVG_VIP" />
                    <span class="signin-label">领取成长值</span>
                    <span v-if="vipGrowthGetResult" class="signin-result" :class="{ success: vipGrowthGetResult === '领取成功！' }">{{ vipGrowthGetResult }}</span>
                  </div>
                  <button
                    class="signin-btn vip"
                    :disabled="vipGrowthGetLoading"
                    @click="doVipGrowthGet"
                  >
                    <span v-if="vipGrowthGetLoading" class="spinner-sm" />
                    <span v-else>领取</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>

      <!-- 听歌统计卡片 -->
      <div v-if="neListenTotal || neUserLevel" class="profile-card stats-card">
        <div class="card-title">
          <Icon name="clock" :size="14" />
          <span>听歌统计</span>
        </div>
        <div class="stats-body">
          <div v-if="neListenTotal" class="stats-row">
            <span class="stats-label">总听歌时长</span>
            <span class="stats-value">{{ neListenTotal }}</span>
          </div>
          <!-- 用户等级条 -->
          <div v-if="neUserLevel" class="level-block">
            <div class="level-header">
              <span class="level-badge">Lv.{{ neUserLevel.level }}</span>
              <span class="level-progress-text">{{ neUserLevel.progress }}%</span>
            </div>
            <div class="level-bar">
              <div class="level-bar-fill" :style="levelBarStyle"></div>
            </div>
            <div class="level-detail">
              <span>还需登录 {{ neUserLevel.needLogin }} 天</span>
              <span>还需听歌 {{ neUserLevel.needPlay }} 首</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 第三行：我的歌单（横向滚动） -->
      <div class="profile-card playlists-card">
        <div class="card-title">
          <Icon name="list" :size="14" />
          <span>我的歌单</span>
          <span v-if="myPlaylists.length" class="card-title-count">{{ myPlaylists.length }}</span>
        </div>
        <div v-if="loadingPlaylists" class="section-loading"><span class="spinner-sm" /></div>
        <div v-else-if="myPlaylists.length" ref="playlistsRowRef" class="playlists-row" @wheel="onPlaylistsWheel">
          <div
            v-for="pl in myPlaylists"
            :key="pl.id"
            class="pf-pl-item"
            @click="openPlaylist(pl)"
          >
            <div class="pf-pl-cover">
              <img
                v-if="pl.coverImgUrl"
                :src="pl.coverImgUrl"
                :alt="pl.name"
                referrerpolicy="no-referrer"
                loading="lazy"
              />
              <div v-else class="pf-pl-cover-fallback"><Icon name="music" :size="24" /></div>
            </div>
            <div class="pf-pl-name" :title="pl.name">{{ pl.name }}</div>
            <div class="pf-pl-count">{{ pl.trackCount }} 首</div>
          </div>
        </div>
        <div v-else class="section-empty">暂无歌单</div>
      </div>

      <!-- 第四行：最近播放 + 听歌排行（两列） -->
      <div class="dual-row">
        <!-- 最近播放 -->
        <div class="profile-card list-card">
          <div class="card-title">
            <Icon name="history" :size="14" />
            <span>最近播放</span>
            <button class="card-refresh-btn" title="刷新" @click="loadRecentSongs">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
            </button>
          </div>
          <div v-if="loadingRecent" class="section-loading"><span class="spinner-sm" /></div>
          <div v-else-if="recentSongs.length" class="song-list">
            <div
              v-for="(s, i) in recentSongs"
              :key="s.id"
              class="song-row"
              :class="{ active: s.id === currentSongId }"
              :title="`${s.name} - ${s.artist}`"
              @click="playSongAt(s, recentSongs)"
            >
              <span class="song-idx">{{ i + 1 }}</span>
              <div class="song-cover" v-if="s.pic"><img :src="s.pic" alt="" referrerpolicy="no-referrer" /></div>
              <div v-else class="song-cover-placeholder"><Icon name="music" :size="12" /></div>
              <div class="song-meta">
                <div class="song-name">{{ s.name }}</div>
                <div class="song-artist">{{ s.artist }}</div>
              </div>
              <span v-if="s.duration" class="song-dur">{{ formatTime(s.duration) }}</span>
            </div>
          </div>
          <div v-else class="section-empty">暂无最近播放</div>
        </div>

        <!-- 听歌排行（本周） -->
        <div class="profile-card list-card">
          <div class="card-title">
            <Icon name="equalizer" :size="14" />
            <span>听歌排行</span>
            <span class="card-title-sub">本周</span>
            <button class="card-refresh-btn" title="刷新" @click="loadWeekRank">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
            </button>
          </div>
          <div v-if="loadingRank" class="section-loading"><span class="spinner-sm" /></div>
          <div v-else-if="weekRank.length" class="song-list">
            <div
              v-for="(item, i) in weekRank"
              :key="item.song.id"
              class="song-row"
              :class="{ active: item.song.id === currentSongId }"
              :title="`${item.song.name} - ${item.song.artist}`"
              @click="playSongAt(item.song, weekRank.map(w => w.song))"
            >
              <span class="song-idx">{{ i + 1 }}</span>
              <div class="song-cover" v-if="item.song.pic"><img :src="item.song.pic" alt="" referrerpolicy="no-referrer" /></div>
              <div v-else class="song-cover-placeholder"><Icon name="music" :size="12" /></div>
              <div class="song-meta">
                <div class="song-name">{{ item.song.name }}</div>
                <div class="song-artist">{{ item.song.artist }}</div>
              </div>
              <span class="song-playcount">{{ item.playCount }} 次</span>
            </div>
          </div>
          <div v-else class="section-empty">暂无听歌排行</div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.profile-view {
  height: 100%;
  overflow-y: auto;
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* ===== 未登录空状态 ===== */
.profile-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-tertiary);
  padding: 24px;
}
.profile-empty p { font-size: 15px; margin: 4px 0 8px; color: var(--text-secondary); }
.empty-icon { display: inline-flex; color: var(--text-tertiary); }
.empty-icon :deep(svg) { width: 48px; height: 48px; display: block; }
.empty-back-btn {
  padding: 6px 18px; border-radius: var(--radius-full);
  font-size: 13px; color: var(--text-secondary);
  border: 1px solid var(--border); background: var(--bg-elev-1);
  transition: color 0.18s var(--ease-out), background 0.18s var(--ease-out), border-color 0.18s var(--ease-out);
}
.empty-back-btn:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }

/* ===== 通用卡片（透明玻璃样式在非 scoped 块里通过 body.has-wallpaper 覆盖） ===== */
.profile-card {
  background: var(--bg-elev-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  transition: border-color 0.15s var(--ease-out);
}
.card-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 700;
  color: var(--text);
}
.card-title :deep(.icon-svg) { color: var(--accent); }
.card-title-count {
  font-size: 12px; color: var(--text-tertiary);
  font-weight: 500;
  margin-left: 2px;
}
.card-title-sub {
  font-size: 11px; color: var(--text-tertiary);
  font-weight: 500;
  margin-left: 2px;
  padding: 1px 6px;
}
.card-refresh-btn {
  margin-left: auto;
  width: 26px; height: 26px;
  border-radius: var(--radius-sm);
  display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary);
  transition: color 0.15s, background 0.15s;
  cursor: pointer;
}
.card-refresh-btn:hover { color: var(--accent); background: var(--accent-soft); }
.card-refresh-btn:active { transform: scale(0.9); }

/* ===== 用户信息卡片 ===== */
.user-card {
  flex-direction: row;
  align-items: center;
  gap: 20px;
}
.user-avatar {
  width: 96px; height: 96px; border-radius: var(--radius-full);
  object-fit: cover;
  border: 2px solid var(--border);
  box-shadow: var(--shadow-sm);
  flex-shrink: 0;
  background: var(--bg-elev-2);
}
.user-avatar-fallback {
  display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary);
}
.avatar-fallback-icon { display: inline-flex; }
.avatar-fallback-icon :deep(svg) { width: 40px; height: 40px; display: block; }
.user-info {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column;
  gap: 4px;
}
.user-name-row {
  display: flex; align-items: center; gap: 10px;
  flex-wrap: wrap;
}
.user-nickname {
  font-size: 22px; font-weight: 700; color: var(--text);
  margin: 0; line-height: 1.2;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 100%;
}
/* VIP 图标（动画图/常规图） */
.user-vip-icon {
  height: 24px;
  width: auto;
  max-width: 120px;
  object-fit: contain;
  flex-shrink: 0;
  border-radius: 4px;
}
/* 动画图：稍大一点，突出动画效果 */
.user-vip-icon.is-dynamic {
  height: 28px;
}
.user-signature {
  margin: 2px 0 0;
  font-size: 13px; font-style: italic;
  color: var(--text-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.user-vip-expire {
  margin: 0;
  font-size: 11px; color: var(--text-tertiary);
}
.user-meta {
  display: flex; flex-wrap: wrap;
  gap: 8px;
}
.user-meta-row {
  display: flex; flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.meta-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  font-size: 11px;
  line-height: 1;
}
.meta-icon {
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--accent);
  width: 13px; height: 13px;
}
.meta-icon :deep(svg) { width: 13px; height: 13px; display: block; }
.meta-label { color: var(--text-tertiary); }
.meta-value { color: var(--text-secondary); font-weight: 500; }

/* ===== 签到触发按钮（用户卡片内） ===== */
.signin-trigger {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 14px;
  border-radius: var(--radius-full);
  font-size: 12px; font-weight: 600;
  color: #fff;
  background: var(--accent);
  cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
  white-space: nowrap;
  margin-left: auto;
  flex-shrink: 0;
}
.signin-trigger:hover { opacity: 0.85; }
.signin-trigger:active { transform: scale(0.95); }
.signin-trigger.done {
  background: var(--bg-elev-2);
  color: var(--accent);
  border: 1px solid var(--accent);
}
.signin-trigger-icon { display: inline-flex; color: inherit; width: 13px; height: 13px; }
.signin-trigger-icon :deep(svg) { width: 13px; height: 13px; display: block; }
.signin-trigger.done .signin-trigger-icon { color: var(--accent); }
.signin-trigger-summary {
  font-size: 10px; font-weight: 400;
  opacity: 0.75;
  margin-left: 2px;
}

/* ===== 签到弹窗 ===== */
.modal-overlay {
  position: fixed; inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(2px);
}
.modal-panel {
  width: 380px; max-width: 90vw;
  background: var(--bg-elev-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  display: flex; flex-direction: column;
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.modal-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 15px; font-weight: 700;
  color: var(--text);
}
.modal-title-icon { display: inline-flex; color: var(--accent); width: 16px; height: 16px; }
.modal-title-icon :deep(svg) { width: 16px; height: 16px; display: block; }
.modal-close {
  width: 28px; height: 28px;
  border-radius: var(--radius-sm);
  display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.modal-close:hover { color: var(--text); background: var(--bg-hover); }
.modal-close :deep(svg) { width: 16px; height: 16px; display: block; }
.modal-body {
  padding: 16px 18px;
  display: flex; flex-direction: column; gap: 10px;
}

/* ===== 签到行（弹窗内） ===== */
.signin-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  background: var(--bg-elev-2);
  border-radius: var(--radius-sm);
  gap: 12px;
}
.signin-info {
  display: flex; align-items: center; gap: 8px;
  min-width: 0; flex: 1;
}
.signin-label {
  font-size: 13px; color: var(--text); font-weight: 500;
}
.signin-result {
  font-size: 11px; color: var(--text-tertiary);
  margin-left: 4px;
}
.signin-result.success { color: var(--accent); }
.coin-icon { display: inline-flex; color: var(--accent); width: 14px; height: 14px; }
.coin-icon :deep(svg) { width: 14px; height: 14px; display: block; }
.vip-icon { display: inline-flex; color: #a855f7; width: 14px; height: 14px; }
.vip-icon :deep(svg) { width: 14px; height: 14px; display: block; }
.signin-sublabel { font-size: 10px; color: var(--text-tertiary); margin-left: 4px; }
.signin-divider {
  height: 1px;
  background: var(--border-color);
  margin: 4px 0;
  opacity: 0.5;
}
.signin-btn {
  padding: 5px 16px;
  border-radius: var(--radius-full);
  font-size: 12px; font-weight: 600;
  color: #fff;
  background: var(--accent);
  cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
  min-width: 56px;
  text-align: center;
  display: flex; align-items: center; justify-content: center;
  gap: 4px;
}
.signin-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.signin-btn:not(:disabled):hover { opacity: 0.85; }
.signin-btn:not(:disabled):active { transform: scale(0.95); }
.signin-btn.done { background: var(--bg-elev-3); color: var(--accent); }
.signin-btn.yunbei { background: linear-gradient(135deg, #f59e0b, #d97706); }
.signin-btn.yunbei.done { background: var(--bg-elev-3); color: #f59e0b; }
.signin-btn.vip { background: linear-gradient(135deg, #a855f7, #7c3aed); }
.signin-btn.vip.done { background: var(--bg-elev-3); color: #a855f7; }
.signin-check-icon { display: inline-flex; }
.signin-check-icon :deep(svg) { width: 14px; height: 14px; display: block; }
.yunbei-balance {
  font-size: 15px; font-weight: 700; color: var(--text);
  display: flex; align-items: center; gap: 4px;
}
.vip-growth-num { color: #a855f7; }
.vip-level-badge {
  font-size: 10px; font-weight: 600; color: #a855f7;
  background: rgba(168, 85, 247, 0.12);
  border-radius: 6px; padding: 1px 5px; line-height: 1.4;
}

/* ===== 弹窗过渡动画 ===== */
.modal-enter-active { transition: opacity 0.2s ease-out; }
.modal-leave-active { transition: opacity 0.15s ease-in; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .modal-panel,
.modal-leave-to .modal-panel {
  transform: scale(0.95);
}

/* ===== 听歌统计卡片 ===== */
.stats-body {
  display: flex; flex-direction: column; gap: 12px;
}
.stats-row {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 13px;
}
.stats-label { color: var(--text-tertiary); }
.stats-value { color: var(--text); font-weight: 600; }
.level-block {
  width: 100%;
  padding: 10px 12px;
  background: var(--bg-elev-2);
  border-radius: var(--radius-sm);
}
.level-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px;
}
.level-badge { font-size: 13px; font-weight: 700; color: var(--accent); }
.level-progress-text { font-size: 11px; color: var(--text-tertiary); }
.level-bar {
  width: 100%; height: 4px;
  background: var(--bg-elev-3);
  border-radius: 2px; overflow: hidden;
  margin-bottom: 6px;
}
.level-bar-fill {
  height: 100%; background: var(--accent); border-radius: 2px;
  transition: width 0.3s var(--ease-out);
}
.level-detail {
  display: flex; justify-content: space-between;
  font-size: 10px; color: var(--text-tertiary);
}

/* ===== 我的歌单（横向滚动） ===== */
.playlists-row {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 4px 2px 8px;
  scroll-behavior: smooth;
  /* 隐藏滚动条 */
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.playlists-row::-webkit-scrollbar { display: none; }
.pf-pl-item {
  flex: 0 0 210px;
  display: flex; flex-direction: column; gap: 8px;
  cursor: pointer;
}
.pf-pl-item:hover .pf-pl-cover { transform: scale(1.03); box-shadow: var(--shadow-md); }
.pf-pl-cover {
  aspect-ratio: 1;
  width: 210px;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--bg-elev-3);
  display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary);
  box-shadow: var(--shadow-sm);
  transition: transform 0.18s var(--ease-out), box-shadow 0.18s var(--ease-out);
}
.pf-pl-cover img { width: 100%; height: 100%; object-fit: cover; }
.pf-pl-cover-fallback { color: var(--text-tertiary); }
.pf-pl-name {
  font-size: 15px; color: var(--text); font-weight: 600;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  padding: 0 2px;
}
.pf-pl-count {
  font-size: 13px; color: var(--text-tertiary);
  line-height: 1.2;
  padding: 0 2px;
}

/* ===== 两列：最近播放 / 听歌排行 ===== */
.dual-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.song-list {
  display: flex; flex-direction: column;
  gap: 2px;
}
.song-row {
  display: grid;
  grid-template-columns: 28px 36px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.12s var(--ease-out), color 0.12s var(--ease-out);
  user-select: none;
}
.song-row:hover { background: var(--bg-hover); }
.song-row.active { color: var(--accent); background: var(--accent-soft); }
.song-row.active .song-idx,
.song-row.active .song-artist,
.song-row.active .song-dur,
.song-row.active .song-playcount { color: var(--accent); }
.song-idx {
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.song-cover, .song-cover-placeholder {
  width: 36px; height: 36px;
  border-radius: 5px;
  flex-shrink: 0;
  overflow: hidden;
  background: var(--bg-elev-3);
  display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary);
}
.song-cover img { width: 100%; height: 100%; object-fit: cover; }
.song-meta {
  min-width: 0;
  display: flex; flex-direction: column;
  gap: 1px;
}
.song-name {
  font-size: 13px; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.song-artist {
  font-size: 11px; color: var(--text-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.song-dur, .song-playcount {
  font-size: 11px; color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  text-align: right;
  flex-shrink: 0;
}

/* ===== 通用加载/空状态 ===== */
.section-loading {
  display: flex; align-items: center; justify-content: center;
  padding: 20px 0;
  color: var(--text-tertiary);
}
.spinner-sm {
  width: 18px; height: 18px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  display: inline-block;
}
@keyframes spin { to { transform: rotate(360deg); } }
.section-empty {
  padding: 20px 0;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
}

/* ===== 响应式：窄屏两列改单列，头像信息上下 ===== */
@media (max-width: 760px) {
  .profile-view { padding: 18px 16px; gap: 16px; }
  .user-card { flex-direction: column; align-items: flex-start; gap: 14px; }
  .user-avatar { width: 80px; height: 80px; }
  .user-nickname { font-size: 19px; }
  .dual-row { grid-template-columns: 1fr; }
}
</style>

<!-- 非 scoped 样式：有壁纸时卡片毛玻璃半透明（与 RecommendView 的 ranking-card 一致） -->
<style>
body.has-wallpaper .profile-view .profile-card {
  background: rgba(33, 31, 38, 0.55);
  backdrop-filter: blur(3px) saturate(1.8);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  border-color: rgba(255, 255, 255, 0.10);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}
body.has-wallpaper .profile-view .song-row:hover {
  background: rgba(255, 255, 255, 0.08);
}
body.has-wallpaper .profile-view .song-row.active {
  background: rgba(250, 35, 59, 0.18);
}
body.has-wallpaper .profile-view .pf-pl-cover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}
body.has-wallpaper .profile-view .meta-pill,
body.has-wallpaper .profile-view .level-block {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
}
body.has-wallpaper .modal-panel {
  background: rgba(33, 31, 38, 0.92);
  backdrop-filter: blur(16px) saturate(1.8);
  border-color: rgba(255, 255, 255, 0.10);
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
}
</style>
