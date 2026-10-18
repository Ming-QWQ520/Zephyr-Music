<script setup lang="ts">
/**
 * NotificationView - 通知中心
 *
 * 设计要点：
 *   - 三个 Tab：评论通知 / @我通知 / 系统通知
 *   - 卡片风格与项目一致
 *   - 高内聚：通知相关逻辑集中于此
 *
 * 数据来源：
 *   - msgComments (api/netease/social)  评论通知
 *   - msgForwards (api/netease/social)  @我通知
 *   - msgNotices  (api/netease/social)  系统通知
 */
import { ref, computed, onMounted } from "vue";
import { usePlayerStore } from "@/stores/player";
import {
  msgComments,
  msgForwards,
  msgNotices,
} from "@/api/netease/social";
import { _cachedUser } from "@/api/netease/core";
import Icon from "@/components/Icon.vue";

const store = usePlayerStore();

// ===== Tab 切换 =====
type NotifyTab = "comments" | "forwards" | "notices";
const activeTab = ref<NotifyTab>("comments");

const tabs: { key: NotifyTab; label: string }[] = [
  { key: "comments", label: "评论" },
  { key: "forwards", label: "@我" },
  { key: "notices", label: "通知" },
];

// ===== 数据 =====
interface NotifyItem {
  id: string;
  type: string;           // comment | forward | notice
  noticeType?: number;    // 原始通知类型（1=赞动态, 2=收藏歌单, 6=赞评论, 10=互动）
  content: string;        // 通知描述文本
  nickname: string;
  avatarUrl: string;
  time: number;
  targetName?: string;    // 关联对象名称（歌单名/歌曲名/评论内容）
  actionLabel?: string;   // 动作标签（赞了/收藏了/给了你一个抱抱）
}
const comments = ref<NotifyItem[]>([]);
const forwards = ref<NotifyItem[]>([]);
const notices = ref<NotifyItem[]>([]);

const loading = ref(false);
const hasMore = ref(false);

// 内联 SVG 图标
const SVG_BELL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
const SVG_COMMENT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const SVG_AT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>`;
const SVG_NOTICE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
const SVG_HEART = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
const SVG_STAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
const SVG_HUG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;

const TAB_ICONS: Record<NotifyTab, string> = {
  comments: SVG_COMMENT,
  forwards: SVG_AT,
  notices: SVG_NOTICE,
};

/** 通知类型 → 图标 & 颜色 */
const NOTICE_TYPE_META: Record<number, { icon: string; color: string }> = {
  1:  { icon: SVG_HEART, color: "#ef4444" },   // 赞动态
  2:  { icon: SVG_STAR,  color: "#f59e0b" },   // 收藏歌单
  6:  { icon: SVG_HEART, color: "#ef4444" },   // 赞评论
  10: { icon: SVG_HUG,   color: "#a855f7" },   // 互动/抱抱
};

function getNoticeTypeIcon(noticeType?: number): { icon: string; color: string } {
  if (noticeType && NOTICE_TYPE_META[noticeType]) return NOTICE_TYPE_META[noticeType];
  return { icon: SVG_NOTICE, color: "var(--text-tertiary)" };
}

const currentList = computed(() => {
  switch (activeTab.value) {
    case "comments": return comments.value;
    case "forwards": return forwards.value;
    case "notices": return notices.value;
    default: return notices.value;
  }
});

// ===== 加载 =====
async function loadComments() {
  const uid = _cachedUser.value?.userId;
  if (!uid) return;
  loading.value = true;
  try {
    const r = await msgComments(uid, 50);
    const list = r.comments || [];
    hasMore.value = !!r.more;
    comments.value = list.map((item: any): NotifyItem => ({
      id: String(item.commentId || item.id || Math.random()),
      type: "comment",
      content: item.content || "",
      nickname: item.user?.nickname || "未知用户",
      avatarUrl: item.user?.avatarUrl || "",
      time: item.time || 0,
      targetName: item.beReplied?.[0]?.content || "",
    }));
  } catch (e) {
    console.warn("[NotificationView] loadComments error:", e);
    comments.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadForwards() {
  loading.value = true;
  try {
    const r = await msgForwards(50);
    const list = r.forwards || [];
    hasMore.value = !!r.more;
    forwards.value = list.map((item: any): NotifyItem => ({
      id: String(item.id || Math.random()),
      type: "forward",
      content: item.msg || item.content || "",
      nickname: item.user?.nickname || "未知用户",
      avatarUrl: item.user?.avatarUrl || "",
      time: item.time || 0,
      targetName: item.associatedContent?.title || "",
    }));
  } catch (e) {
    console.warn("[NotificationView] loadForwards error:", e);
    forwards.value = [];
  } finally {
    loading.value = false;
  }
}

/** 解析 /msg/notices 返回的 notice JSON 字符串
 *  notice 字段是 JSON 字符串，需要解析后根据 type 提取不同信息：
 *    type 1: 赞了动态/笔记（track 分享歌曲等）
 *    type 2: 收藏了歌单（playlist）
 *    type 6: 赞了评论（comment）
 *    type 10: 互动（generalNotice，如抱抱）
 */
function parseNoticeItem(raw: any): NotifyItem {
  const id = String(raw.id || Math.random());
  const time = raw.time || 0;

  // 尝试解析 notice JSON 字符串
  let parsed: any = null;
  try {
    if (typeof raw.notice === "string") {
      parsed = JSON.parse(raw.notice);
    } else if (raw.notice && typeof raw.notice === "object") {
      parsed = raw.notice;
    }
  } catch (e) {
    // 解析失败，使用兜底
  }

  // 兜底：直接从顶层取值
  if (!parsed) {
    return {
      id,
      type: "notice",
      content: raw.content || raw.title || "",
      nickname: raw.nickname || raw.fromUser?.nickname || "系统通知",
      avatarUrl: raw.avatarUrl || raw.fromUser?.avatarUrl || "",
      time,
      targetName: raw.subTitle || "",
    };
  }

  const noticeType = parsed.type ?? 0;
  const user = parsed.user || {};
  const nickname = user.nickname || "未知用户";
  const avatarUrl = user.avatarUrl || "";

  let content = "";
  let targetName = "";
  let actionLabel = "";

  switch (noticeType) {
    case 1: {
      // 赞了动态/笔记
      actionLabel = "赞了你的动态";
      const track = parsed.track;
      if (track) {
        // 尝试从 track.json 中提取歌曲信息
        try {
          const trackJson = typeof track.json === "string" ? JSON.parse(track.json) : track.json;
          const song = trackJson?.song;
          if (song) {
            targetName = song.name || "";
            const artists = song.artists?.map((a: any) => a.name).join("/") || "";
            if (artists) targetName += ` - ${artists}`;
          }
          if (trackJson?.msg) content = trackJson.msg;
        } catch {
          content = track.name || "";
        }
      }
      break;
    }
    case 2: {
      // 收藏了歌单
      actionLabel = "收藏了你的歌单";
      const playlist = parsed.playlist;
      if (playlist) {
        targetName = playlist.name || "";
      }
      break;
    }
    case 6: {
      // 赞了评论
      actionLabel = "赞了你的评论";
      const comment = parsed.comment;
      if (comment) {
        content = comment.content || "";
      }
      break;
    }
    case 10: {
      // 互动（如抱抱）
      const gn = parsed.generalNotice;
      if (gn) {
        actionLabel = gn.actionDesc || "互动";
        content = gn.content || "";
      }
      break;
    }
    default: {
      // 未知类型，尝试通用提取
      actionLabel = "通知";
      content = parsed.content || parsed.title || "";
      break;
    }
  }

  return {
    id,
    type: "notice",
    noticeType,
    content,
    nickname,
    avatarUrl,
    time,
    targetName,
    actionLabel,
  };
}

async function loadNotices() {
  loading.value = true;
  try {
    const r = await msgNotices(50);
    const list = r.notices || [];
    hasMore.value = !!r.more;
    notices.value = list.map((item: any) => parseNoticeItem(item));
  } catch (e) {
    console.warn("[NotificationView] loadNotices error:", e);
    notices.value = [];
  } finally {
    loading.value = false;
  }
}

async function switchTab(tab: NotifyTab) {
  activeTab.value = tab;
  // 按需加载
  if (tab === "comments" && comments.value.length === 0) await loadComments();
  else if (tab === "forwards" && forwards.value.length === 0) await loadForwards();
  else if (tab === "notices" && notices.value.length === 0) await loadNotices();
}

function formatTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const isToday = d.toDateString() === now.toDateString();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (isToday) return `今天 ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`;
}

function goBack() {
  store.setView("recommend");
}

onMounted(() => {
  loadComments();
});
</script>

<template>
  <section class="notification-view nice-scroll">
    <!-- 未登录空状态 -->
    <div v-if="!_cachedUser" class="notify-empty">
      <span class="empty-icon" v-html="SVG_BELL" />
      <p>请登录后查看通知</p>
      <button class="empty-back-btn" @click="goBack">返回</button>
    </div>

    <!-- 已登录 -->
    <template v-else>
      <!-- 标题 + Tab 切换 -->
      <div class="notify-header">
        <div class="notify-title">
          <Icon name="bell" :size="18" />
          <span>通知中心</span>
        </div>
        <div class="notify-tabs">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="notify-tab"
            :class="{ active: activeTab === tab.key }"
            @click="switchTab(tab.key)"
          >
            <span class="tab-icon" v-html="TAB_ICONS[tab.key]" />
            <span>{{ tab.label }}</span>
          </button>
        </div>
      </div>

      <!-- 通知列表 -->
      <div class="notify-content">
        <div v-if="loading" class="section-loading"><span class="spinner-sm" /></div>
        <div v-else-if="currentList.length" class="notify-list">
          <div
            v-for="item in currentList"
            :key="item.id"
            class="notify-item"
          >
            <div class="notify-avatar">
              <img v-if="item.avatarUrl" :src="item.avatarUrl" alt="" referrerpolicy="no-referrer" />
              <span v-else class="avatar-fallback">{{ item.nickname.charAt(0) }}</span>
              <!-- 通知类型角标 -->
              <span
                v-if="item.actionLabel"
                class="notify-type-badge"
                :style="{ color: getNoticeTypeIcon(item.noticeType).color }"
                v-html="getNoticeTypeIcon(item.noticeType).icon"
              />
            </div>
            <div class="notify-body">
              <div class="notify-top-row">
                <span class="notify-nickname">{{ item.nickname }}</span>
                <span class="notify-time">{{ formatTime(item.time) }}</span>
              </div>
              <p v-if="item.actionLabel" class="notify-action">{{ item.actionLabel }}</p>
              <p v-if="item.content" class="notify-content-text">{{ item.content }}</p>
              <p v-if="item.targetName" class="notify-target">{{ item.targetName }}</p>
            </div>
          </div>
        </div>
        <div v-else class="section-empty">暂无通知</div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.notification-view {
  height: 100%;
  overflow-y: auto;
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.notify-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-tertiary);
  padding: 24px;
}
.notify-empty p { font-size: 15px; margin: 4px 0 8px; color: var(--text-secondary); }
.empty-icon { display: inline-flex; color: var(--text-tertiary); }
.empty-icon :deep(svg) { width: 48px; height: 48px; display: block; }
.empty-back-btn {
  padding: 6px 18px; border-radius: var(--radius-full);
  font-size: 13px; color: var(--text-secondary);
  border: 1px solid var(--border); background: var(--bg-elev-1);
  transition: color 0.18s var(--ease-out), background 0.18s var(--ease-out);
}
.empty-back-btn:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }

/* ===== 头部 ===== */
.notify-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.notify-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 18px; font-weight: 700;
  color: var(--text);
}
.notify-title :deep(.icon-svg) { color: var(--accent); }

.notify-tabs {
  display: flex;
  gap: 4px;
  background: var(--bg-elev-1);
  border-radius: var(--radius-sm);
  padding: 3px;
  border: 1px solid var(--border);
}
.notify-tab {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  font-size: 13px; font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.15s var(--ease-out), background 0.15s var(--ease-out);
}
.notify-tab:hover { color: var(--text); background: var(--bg-hover); }
.notify-tab.active { color: var(--accent); background: var(--accent-soft); }
.tab-icon { display: inline-flex; align-items: center; }
.tab-icon :deep(svg) { width: 14px; height: 14px; display: block; }

/* ===== 内容 ===== */
.notify-content {
  flex: 1;
  min-height: 0;
}
.notify-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.notify-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--radius);
  background: var(--bg-elev-1);
  border: 1px solid var(--border);
  transition: background 0.12s var(--ease-out), border-color 0.12s var(--ease-out);
}
.notify-item:hover { background: var(--bg-hover); border-color: var(--accent); }
.notify-avatar {
  width: 40px; height: 40px;
  border-radius: var(--radius-full);
  overflow: hidden;
  flex-shrink: 0;
  background: var(--bg-elev-3);
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
.notify-avatar img { width: 100%; height: 100%; object-fit: cover; }
.notify-type-badge {
  position: absolute;
  bottom: -2px; right: -2px;
  width: 18px; height: 18px;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-elev-1);
  border-radius: 50%;
  border: 1.5px solid var(--bg-elev-1);
}
.notify-type-badge :deep(svg) { width: 10px; height: 10px; display: block; }
.avatar-fallback {
  font-size: 16px; font-weight: 600; color: var(--text-tertiary);
}
.notify-body {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column;
  gap: 4px;
}
.notify-top-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px;
}
.notify-nickname {
  font-size: 13px; font-weight: 600; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.notify-action {
  font-size: 12px; color: var(--text-secondary);
  margin: 0;
}
.notify-time {
  font-size: 11px; color: var(--text-tertiary);
  flex-shrink: 0;
}
.notify-content-text {
  font-size: 13px; color: var(--text-secondary);
  line-height: 1.5;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.notify-target {
  font-size: 11px; color: var(--text-tertiary);
  font-style: italic;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ===== 通用 ===== */
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

/* ===== 响应式 ===== */
@media (max-width: 760px) {
  .notification-view { padding: 18px 16px; gap: 12px; }
}
</style>

<style>
body.has-wallpaper .notification-view .notify-item {
  background: rgba(33, 31, 38, 0.55);
  backdrop-filter: blur(3px) saturate(1.8);
  border-color: rgba(255, 255, 255, 0.10);
}
body.has-wallpaper .notification-view .notify-tabs {
  background: rgba(33, 31, 38, 0.55);
  border-color: rgba(255, 255, 255, 0.10);
}
</style>
