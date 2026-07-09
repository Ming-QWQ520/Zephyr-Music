<script setup lang="ts">
/**
 * ProfileView - 全屏个人主页
 * 顶部背景图 + 大头像重叠 + 资料/VIP/听歌统计/快捷入口
 * 数据来源：_cachedUser (api/netease) 与 useNeteaseUser (composables)
 */
import { computed, ref, watch, onMounted } from "vue";
import { usePlayerStore } from "@/stores/player";
import { _cachedUser } from "@/api/netease";
import {
  useNeteaseUser,
  formatCreateTime,
  genderText,
  regionText,
} from "@/composables/useNeteaseUser";
import Icon from "@/components/Icon.vue";

const store = usePlayerStore();
const { neVipInfo, neListenTotal, neUserLevel } = useNeteaseUser();

const neUser = _cachedUser; // ref<NeteaseUser | null>

// ===== VIP 图标加载 =====
// 每次进入个人主页，优先请求动画图(dynamicIconUrl)；加载失败才回退常规图(iconUrl)。
// vipIconSrc: 当前显示的图源；vipIconError: 动画图是否已失败（避免反复重试）
const vipIconSrc = ref("");
const vipDynamicFailed = ref(false);

/** 重置 VIP 图状态：每次进入个人主页调用一次 */
function resetVipIcon() {
  vipDynamicFailed.value = false;
  const v = neVipInfo.value;
  if (!v) { vipIconSrc.value = ""; return; }
  // 优先动画图；没有动画图直接用常规图
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

// 每次组件挂载（即每次进入个人主页）重置 VIP 图，触发动画图重新请求+播放
onMounted(resetVipIcon);
// VIP 信息异步加载完成后再进入主页时也重置一次
watch(() => neVipInfo.value, () => {
  if (!vipIconSrc.value) resetVipIcon();
});

/** 顶部背景图：优先使用 backgroundUrl，否则纯色渐变占位由 CSS 处理 */
const bgStyle = computed(() => {
  if (neUser.value?.backgroundUrl) {
    return { backgroundImage: `url(${neUser.value.backgroundUrl})` };
  }
  return { backgroundImage: "none" };
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

/** 快捷入口：跳转到「我喜欢的音乐」「听歌排行」「最近播放」 */
function goFavorites() {
  // pendingPlaylistId > 0 时 NeteaseView 会选中该歌单；这里没有缓存列表，
  // 委托 Sidebar 已有的逻辑会失败，所以走 netease 视图（首个歌单通常为我喜欢）。
  store.pendingPlaylistId = null;
  store.setView("netease");
}

function goRecord() {
  // 特殊 id -2 表示听歌排行
  store.pendingPlaylistId = -2;
  store.setView("netease");
}

function goRecent() {
  store.setView("library");
}

function goBack() {
  store.setView("recommend");
}
</script>

<template>
  <section class="profile-view nice-scroll">
    <!-- 未登录空状态 -->
    <div v-if="!neUser" class="profile-empty">
      <span class="empty-icon" v-html="SVG_USER" />
      <p>请登录网易云音乐</p>
      <button class="empty-back-btn" @click="goBack">返回</button>
    </div>

    <!-- 已登录：背景图 + 重叠内容 -->
    <template v-else>
      <!-- 背景图层 -->
      <div class="profile-banner" :style="bgStyle" :class="{ 'banner-placeholder': !neUser.backgroundUrl }">
        <div class="banner-mask"></div>
        <button class="back-btn" title="返回" @click="goBack">
          <Icon name="chevronLeft" :size="18" />
        </button>
      </div>

      <!-- 主内容区（与背景图重叠） -->
      <div class="profile-content">
        <!-- 头像 + 昵称行 -->
        <div class="profile-head">
          <img
            v-if="neUser.avatarUrl"
            :src="neUser.avatarUrl"
            class="profile-avatar"
            referrerpolicy="no-referrer"
            alt="avatar"
          />
          <div v-else class="profile-avatar profile-avatar-fallback">
            <span class="avatar-fallback-icon" v-html="SVG_USER" />
          </div>
          <div class="profile-head-text">
            <div class="profile-name-row">
              <h1 class="profile-nickname">{{ neUser.nickname }}</h1>
              <!-- VIP 图标：优先动画图(dynamicIconUrl)，失败回退常规图(iconUrl) -->
              <img
                v-if="vipIconSrc"
                :src="vipIconSrc"
                class="profile-vip-icon"
                :class="{ 'is-dynamic': !vipDynamicFailed }"
                referrerpolicy="no-referrer"
                :alt="neVipInfo?.isVip ? `黑胶VIP${neVipInfo.redVipLevel || ''}` : 'VIP'"
                @error="onVipIconError"
              />
            </div>
            <p v-if="neUser.signature" class="profile-signature" :title="neUser.signature">
              {{ neUser.signature }}
            </p>
            <p v-if="neVipInfo?.expireText" class="profile-vip-expire">
              VIP 到期: {{ neVipInfo.expireText }}
            </p>
          </div>
        </div>

        <!-- 卡片网格 -->
        <div class="profile-grid">
          <!-- 个人资料 -->
          <div v-if="profileItems.length" class="profile-card">
            <div class="card-title">
              <span class="card-title-icon" v-html="SVG_USER" />
              <span>个人资料</span>
            </div>
            <div class="card-rows">
              <div v-for="item in profileItems" :key="item.label" class="info-row">
                <span class="info-icon" v-html="ICON_MAP[item.icon]" />
                <span class="info-label">{{ item.label }}</span>
                <span class="info-value">{{ item.value }}</span>
              </div>
            </div>
          </div>

          <!-- 听歌统计 -->
          <div v-if="neListenTotal || neUserLevel" class="profile-card">
            <div class="card-title">
              <Icon name="clock" :size="14" />
              <span>听歌统计</span>
            </div>
            <div class="card-rows">
              <div v-if="neListenTotal" class="info-row">
                <span class="info-icon">
                  <Icon name="clock" :size="16" />
                </span>
                <span class="info-label">总听歌时长</span>
                <span class="info-value">{{ neListenTotal }}</span>
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

          <!-- 快捷入口 -->
          <div class="profile-card">
            <div class="card-title">
              <Icon name="sparkles" :size="14" />
              <span>快捷入口</span>
            </div>
            <div class="quick-actions">
              <button class="quick-btn" @click="goFavorites">
                <Icon name="heart" :size="18" />
                <span>我喜欢的音乐</span>
              </button>
              <button class="quick-btn" @click="goRecord">
                <Icon name="history" :size="18" />
                <span>听歌排行</span>
              </button>
              <button class="quick-btn" @click="goRecent">
                <Icon name="clock" :size="18" />
                <span>最近播放</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.profile-view {
  height: 100%;
  overflow-y: auto;
  padding: 0;
  display: flex;
  flex-direction: column;
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

/* ===== 背景图层 ===== */
.profile-banner {
  position: relative;
  height: 280px;
  width: 100%;
  background-size: cover;
  background-position: center 30%;
  background-repeat: no-repeat;
  flex-shrink: 0;
}
.profile-banner.banner-placeholder {
  background-image: linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 60%, var(--bg-elev-2) 100%);
  opacity: 0.9;
}
.banner-mask {
  position: absolute; inset: 0;
  background: linear-gradient(to bottom, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 60%, var(--bg) 100%);
  pointer-events: none;
}
.back-btn {
  position: absolute; top: 14px; left: 14px;
  width: 34px; height: 34px; border-radius: var(--radius-full);
  display: flex; align-items: center; justify-content: center;
  color: #fff; background: rgba(0, 0, 0, 0.38);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.18);
  transition: background 0.18s var(--ease-out), transform 0.18s var(--ease-out);
}
.back-btn:hover { background: rgba(0, 0, 0, 0.55); transform: translateX(-1px); }

/* ===== 主内容区（与背景图重叠） ===== */
.profile-content {
  position: relative;
  z-index: 1;
  margin-top: -60px; /* 让头像半在背景图内、半在内容区 */
  padding: 0 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* ===== 头像 + 昵称行 ===== */
.profile-head {
  display: flex;
  align-items: flex-end;
  gap: 18px;
  padding: 0 4px;
}
.profile-avatar {
  width: 120px; height: 120px; border-radius: var(--radius-full);
  object-fit: cover;
  border: 3px solid var(--bg);
  box-shadow: var(--shadow-lg);
  flex-shrink: 0;
  background: var(--bg-elev-2);
}
.profile-avatar-fallback {
  display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary);
}
.avatar-fallback-icon { display: inline-flex; }
.avatar-fallback-icon :deep(svg) { width: 44px; height: 44px; display: block; }
.profile-head-text {
  flex: 1; min-width: 0;
  padding-bottom: 8px;
}
.profile-name-row {
  display: flex; align-items: center; gap: 10px;
  flex-wrap: wrap;
}
.profile-nickname {
  font-size: 24px; font-weight: 700; color: var(--text);
  margin: 0; line-height: 1.2;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 100%;
}
/* VIP 图标（动画图/常规图） */
.profile-vip-icon {
  height: 28px;
  width: auto;
  max-width: 120px;
  object-fit: contain;
  flex-shrink: 0;
  border-radius: 4px;
}
/* 动画图：稍大一点，突出动画效果 */
.profile-vip-icon.is-dynamic {
  height: 32px;
}
.profile-signature {
  margin: 6px 0 0;
  font-size: 13px; font-style: italic;
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.profile-vip-expire {
  margin: 4px 0 0;
  font-size: 11px; color: var(--text-tertiary);
}

/* ===== 卡片网格 ===== */
.profile-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}
.profile-card {
  background: var(--bg-elev-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px 18px;
  display: flex; flex-direction: column; gap: 12px;
}
/* 快捷入口卡跨两列（最后一行整宽） */
.profile-grid .profile-card:last-child {
  grid-column: 1 / -1;
}
.card-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600;
  color: var(--text);
}
.card-title :deep(.icon-svg) { color: var(--accent); }
.card-title-icon { display: inline-flex; color: var(--accent); }
.card-title-icon :deep(svg) { width: 14px; height: 14px; display: block; }
.card-rows {
  display: flex; flex-direction: column; gap: 10px;
}

/* ===== 信息行 ===== */
.info-row {
  display: flex; align-items: center; gap: 10px;
  font-size: 13px; line-height: 1.4;
}
.info-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; flex-shrink: 0;
  color: var(--text-tertiary);
}
.info-icon :deep(svg) { width: 16px; height: 16px; display: block; }
.info-label {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.info-value {
  color: var(--text-secondary);
  margin-left: auto;
  text-align: right;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0;
}

/* ===== 等级条（与 App.vue ne-level 同设计） ===== */
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

/* ===== 快捷入口按钮组 ===== */
.quick-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.quick-btn {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 16px 12px;
  border-radius: var(--radius-sm);
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 12px; font-weight: 500;
  transition: color 0.18s var(--ease-out), background 0.18s var(--ease-out),
              border-color 0.18s var(--ease-out), transform 0.18s var(--ease-out);
}
.quick-btn:hover {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent);
  transform: translateY(-1px);
}
.quick-btn :deep(.icon-svg) { color: var(--accent); }

/* ===== 响应式：窄屏头像/昵称垂直，单列卡片 ===== */
@media (max-width: 720px) {
  .profile-banner { height: 220px; }
  .profile-content { margin-top: -50px; padding: 0 18px 24px; }
  .profile-head {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  .profile-avatar { width: 96px; height: 96px; }
  .profile-head-text { padding-bottom: 0; }
  .profile-nickname { font-size: 20px; }
  .profile-grid { grid-template-columns: 1fr; }
  .profile-grid .profile-card:last-child { grid-column: auto; }
  .quick-actions { grid-template-columns: 1fr; }
}
</style>
