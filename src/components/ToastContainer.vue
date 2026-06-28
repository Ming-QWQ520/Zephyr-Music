<script setup lang="ts">
import { useToast } from "@/composables/useToast";
import Icon from "@/components/Icon.vue";
import { usePlayerStore } from "@/stores/player";

const { toasts, remove } = useToast();
const store = usePlayerStore();

function onAction(url?: string, id?: number) {
  if (url) {
    // 支持 playlist:{id} 格式，跳转到对应歌单
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
  warning: "info",
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
        @click="onAction(toast.actionUrl, toast.id)"
      >
        <div class="toast-icon-wrap">
          <Icon :name="ICON_MAP[toast.type] || 'info'" :size="16" />
        </div>
        <div class="toast-content">
          <div class="toast-title">{{ toast.title }}</div>
          <div v-if="toast.subtitle" class="toast-subtitle">{{ toast.subtitle }}</div>
        </div>
        <button v-if="toast.actionText && toast.actionUrl" class="toast-action" @click.stop="onAction(toast.actionUrl, toast.id)">
          {{ toast.actionText }}
        </button>
        <button v-else class="toast-close" @click.stop="remove(toast.id)">
          <Icon name="close" :size="12" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-container {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--bg-elev-3);
  border: 1px solid var(--border-strong);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  font-size: 13px;
  color: var(--text);
  pointer-events: auto;
  cursor: pointer;
  min-width: 220px;
  max-width: 360px;
}
.toast-icon-wrap { flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.toast.success { border-left: 3px solid #52c41a; }
.toast.success .toast-icon-wrap { color: #52c41a; }
.toast.error { border-left: 3px solid #ff4d4f; }
.toast.error .toast-icon-wrap { color: #ff4d4f; }
.toast.info { border-left: 3px solid var(--accent); }
.toast.info .toast-icon-wrap { color: var(--accent); }
.toast.warning { border-left: 3px solid #faad14; }
.toast.warning .toast-icon-wrap { color: #faad14; }
.toast-content { flex: 1; min-width: 0; }
.toast-title { font-weight: 600; line-height: 1.3; }
.toast-subtitle { font-size: 12px; color: var(--text-secondary); margin-top: 2px; line-height: 1.3; }
.toast-action {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--accent);
  padding: 2px 8px;
  border-radius: 4px;
  transition: background 0.15s;
}
.toast-action:hover { background: var(--bg-hover); }
.toast-close {
  flex-shrink: 0;
  width: 18px; height: 18px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary);
  border-radius: 4px;
  transition: background 0.15s, color 0.15s;
}
.toast-close:hover { background: var(--bg-hover); color: var(--text); }

/* 从右侧平滑弹出 */
.toast-enter-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.toast-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: absolute;
  right: 0;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(120%);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(120%);
}
.toast-move {
  transition: transform 0.3s ease;
}
</style>
