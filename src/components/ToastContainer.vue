<script setup lang="ts">
/**
 * ToastContainer — 全局通知容器
 *
 * 设计要点：
 *   - 毛玻璃质感（backdrop-filter）+ 类型色彩左侧条
 *   - 图标圆形背景，类型色彩高亮
 *   - 进度条显示剩余时间（CSS animation 线性递减）
 *   - 从右下角弹出，支持点击跳转和手动关闭
 *   - 悬停时暂停自动消失（CSS animation-play-state: paused）
 */
import { useToast } from "@/composables/useToast";
import Icon from "@/components/Icon.vue";
import { usePlayerStore } from "@/stores/player";

const { toasts, remove } = useToast();
const store = usePlayerStore();

function onAction(url?: string, id?: number) {
  if (url) {
    const m = url.match(/^playlist:(.+)$/);
    if (m) {
      const pid = Number(m[1]);
      if (!isNaN(pid)) {
        store.pendingPlaylistId = pid;
        store.setView("netease");
      }
    }
  }
  if (id !== undefined) remove(id);
}

const ICON_MAP: Record<string, string> = {
  success: "check",
  error: "close",
  info: "info",
  warning: "warn",
};
</script>

<template>
  <div class="toast-container">
    <TransitionGroup name="toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="toast"
        :class="toast.type"
        :style="{ '--toast-duration': toast.duration + 'ms' }"
        @click="onAction(toast.actionUrl, toast.id)"
      >
        <!-- 类型色彩左侧条 -->
        <div class="toast-accent-bar"></div>
        <!-- 图标 -->
        <div class="toast-icon-wrap">
          <Icon :name="ICON_MAP[toast.type] || 'info'" :size="16" />
        </div>
        <!-- 内容 -->
        <div class="toast-content">
          <div class="toast-title">{{ toast.title }}</div>
          <div v-if="toast.subtitle" class="toast-subtitle">{{ toast.subtitle }}</div>
        </div>
        <!-- 操作按钮 / 关闭按钮 -->
        <button v-if="toast.actionText && toast.actionUrl" class="toast-action" @click.stop="onAction(toast.actionUrl, toast.id)">
          {{ toast.actionText }}
        </button>
        <button v-else class="toast-close" @click.stop="remove(toast.id)" title="关闭">
          <Icon name="close" :size="12" />
        </button>
        <!-- 进度条（duration > 0 时显示） -->
        <div v-if="toast.duration > 0" class="toast-progress">
          <div class="toast-progress-fill"></div>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-container {
  position: fixed;
  right: 24px;
  bottom: 96px; /* 避开播放栏 */
  z-index: 9999;
  display: flex;
  flex-direction: column-reverse; /* 最新的在底部，靠近播放栏 */
  gap: 10px;
  pointer-events: none;
}

.toast {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px 12px 10px;
  border-radius: 14px;
  background: var(--bg-glass, rgba(255, 255, 255, 0.85));
  backdrop-filter: blur(20px) saturate(1.8);
  -webkit-backdrop-filter: blur(20px) saturate(1.8);
  border: 1px solid var(--border);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.12),
    0 2px 8px rgba(0, 0, 0, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
  font-size: 13px;
  color: var(--text);
  pointer-events: auto;
  cursor: pointer;
  min-width: 260px;
  max-width: 380px;
  overflow: hidden;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.toast:hover {
  transform: translateX(-2px);
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.16),
    0 4px 12px rgba(0, 0, 0, 0.10),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
}

/* 悬停时暂停进度条动画 */
.toast:hover .toast-progress-fill {
  animation-play-state: paused;
}

/* 左侧类型色彩条 */
.toast-accent-bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  border-radius: 14px 0 0 14px;
  transition: width 0.2s ease;
}

/* 图标圆形背景 */
.toast-icon-wrap {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--bg-elev-1);
  transition: background 0.2s ease;
}

/* ===== 类型样式 ===== */
.toast.success .toast-accent-bar { background: #34d399; }
.toast.success .toast-icon-wrap { background: rgba(52, 211, 153, 0.15); color: #10b981; }

.toast.error .toast-accent-bar { background: #f87171; }
.toast.error .toast-icon-wrap { background: rgba(248, 113, 113, 0.15); color: #ef4444; }

.toast.info .toast-accent-bar { background: var(--accent); }
.toast.info .toast-icon-wrap { background: var(--accent-soft); color: var(--accent); }

.toast.warning .toast-accent-bar { background: #fbbf24; }
.toast.warning .toast-icon-wrap { background: rgba(251, 191, 36, 0.15); color: #f59e0b; }

/* 内容区 */
.toast-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.toast-title {
  font-weight: 600;
  font-size: 13px;
  line-height: 1.4;
  letter-spacing: -0.01em;
}
.toast-subtitle {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 操作按钮 */
.toast-action {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  padding: 5px 12px;
  border-radius: 8px;
  background: var(--accent-soft);
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
}
.toast-action:hover {
  background: var(--accent);
  color: var(--on-accent, #fff);
}

/* 关闭按钮 */
.toast-close {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.toast-close:hover {
  background: var(--bg-hover);
  color: var(--text);
}

/* 进度条 */
.toast-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 2px;
  background: transparent;
  overflow: hidden;
}
.toast-progress-fill {
  height: 100%;
  width: 100%;
  transform-origin: left;
  animation: toast-progress-shrink var(--toast-duration, 3000ms) linear forwards;
}
.toast.success .toast-progress-fill { background: #34d399; }
.toast.error .toast-progress-fill { background: #f87171; }
.toast.info .toast-progress-fill { background: var(--accent); }
.toast.warning .toast-progress-fill { background: #fbbf24; }

@keyframes toast-progress-shrink {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}

/* ===== 入场/出场动画 ===== */
.toast-enter-active {
  transition: all 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}
.toast-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.6, 1);
  position: absolute;
  right: 0;
  width: 100%;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(120%) scale(0.9);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(60%) scale(0.95);
}
.toast-move {
  transition: transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}
</style>
