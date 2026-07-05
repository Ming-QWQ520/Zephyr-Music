<script setup lang="ts">
/**
 * 窗口控件组件（最小化/最大化/关闭）
 * 三个按钮被一个大圆角长方体包裹，与标题栏剥离但仍浮于标题栏区域。
 */
import Icon from "@/components/Icon.vue";

const emit = defineEmits<{
  (e: "minimize"): void;
  (e: "toggleMaximize"): void;
  (e: "close"): void;
}>();
</script>

<template>
  <div class="window-controls" data-tauri-drag-region="false">
    <button class="wc-btn" title="最小化" @click="emit('minimize')">
      <Icon name="minimize" :size="13" />
    </button>
    <button class="wc-btn" title="最大化" @click="emit('toggleMaximize')">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <rect x="1.5" y="1.5" width="9" height="9" rx="1.8" stroke="currentColor" stroke-width="1.3"/>
      </svg>
    </button>
    <button class="wc-btn wc-close" title="关闭" @click="emit('close')">
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
        <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.window-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 30px;
  padding: 3px;
  background: var(--bg-elev-3);
  border: 1px solid var(--border-strong, rgba(255,255,255,0.12));
  border-radius: 16px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  -webkit-app-region: no-drag;
  flex-shrink: 0;
}
.wc-btn {
  width: 26px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  color: var(--text-secondary);
  transition: background 0.12s, color 0.12s;
}
.wc-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.wc-close:hover {
  background: var(--accent);
  color: #fff;
}
</style>

<!-- 非 scoped 样式：有壁纸时窗口控件毛玻璃半透明 -->
<style>
body.has-wallpaper .window-controls {
  background: rgba(40, 38, 46, 0.55);
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow: 0 4px 20px rgba(0,0,0,0.35);
}
</style>
