<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";

const props = withDefaults(defineProps<{
  modelValue: number;
  buffered?: number;
  format?: (v: number) => string;
  alwaysShowOnHover?: boolean;
  height?: number;
  accent?: string;
  trackColor?: string;
  bufferedColor?: string;
  disabled?: boolean;
  vertical?: boolean;
}>(), {
  buffered: 0,
  format: (v: number) => `${Math.round(v * 100)}%`,
  alwaysShowOnHover: true,
  height: 3,
  accent: "#3b82f6",
  trackColor: "rgba(255,255,255,0.15)",
  bufferedColor: "transparent",
  disabled: false,
  vertical: false,
});

const emit = defineEmits<{
  (e: "update:modelValue", v: number): void;
  (e: "change", v: number): void;
  (e: "dragstart"): void;
  (e: "dragend"): void;
}>();

const rootRef = ref<HTMLDivElement | null>(null);
const dragging = ref(false);
const hovering = ref(false);

const pct = computed(() => Math.max(0, Math.min(1, props.modelValue)) * 100);
const bufPct = computed(() => Math.max(0, Math.min(1, props.buffered || 0)) * 100);

const hoverPos = ref(0);
const showTooltip = computed(() => dragging.value || (hovering.value && props.alwaysShowOnHover));

function clientToFrac(clientX: number, clientY: number): number {
  const el = rootRef.value;
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  if (props.vertical) {
    if (r.height === 0) return 0;
    // 竖向：向上拖动增大音量（顶部=1，底部=0）
    return Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
  }
  if (r.width === 0) return 0;
  return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
}

function onPointerDown(ev: PointerEvent) {
  if (props.disabled) return;
  ev.preventDefault();
  (ev.target as Element).setPointerCapture?.(ev.pointerId);
  dragging.value = true;
  emit("dragstart");
  const f = clientToFrac(ev.clientX, ev.clientY);
  emit("update:modelValue", f);
  emit("change", f);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

function onPointerMove(ev: PointerEvent) {
  if (!dragging.value) return;
  const f = clientToFrac(ev.clientX, ev.clientY);
  hoverPos.value = f;
  emit("update:modelValue", f);
  emit("change", f);
}

function onPointerUp() {
  if (!dragging.value) return;
  dragging.value = false;
  emit("dragend");
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
}

function onMouseMove(ev: MouseEvent) {
  if (dragging.value) return;
  hoverPos.value = clientToFrac(ev.clientX, ev.clientY);
}

function onMouseEnter() { hovering.value = true; }
function onMouseLeave() { hovering.value = false; }

const tooltipLeft = computed(() => {
  const v = dragging.value ? props.modelValue : hoverPos.value;
  return `${Math.max(0, Math.min(1, v)) * 100}%`;
});

const tooltipBottom = computed(() => {
  const v = dragging.value ? props.modelValue : hoverPos.value;
  return `${Math.max(0, Math.min(1, v)) * 100}%`;
});

const tooltipText = computed(() => {
  const v = dragging.value ? props.modelValue : hoverPos.value;
  return props.format(v);
});

onMounted(() => {
  if (rootRef.value) {
    rootRef.value.addEventListener("mouseenter", onMouseEnter);
    rootRef.value.addEventListener("mouseleave", onMouseLeave);
    rootRef.value.addEventListener("mousemove", onMouseMove);
  }
});

onUnmounted(() => {
  if (rootRef.value) {
    rootRef.value.removeEventListener("mouseenter", onMouseEnter);
    rootRef.value.removeEventListener("mouseleave", onMouseLeave);
    rootRef.value.removeEventListener("mousemove", onMouseMove);
  }
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
});
</script>

<template>
  <div
    ref="rootRef"
    class="rnp-slider"
    :class="{ disabled, dragging, hovering, vertical }"
    :style="{
      '--track-h': height + 'px',
      '--track-h-hover': (height + 4) + 'px',
      '--accent': accent,
      '--track-color': trackColor,
      '--buf-color': bufferedColor,
    }"
    @pointerdown="onPointerDown"
  >
    <div class="track">
      <div v-if="!vertical" class="buf" :style="{ width: bufPct + '%' }" />
      <div v-else class="buf" :style="{ height: bufPct + '%' }" />
      <div v-if="!vertical" class="fill" :style="{ width: pct + '%' }" />
      <div v-else class="fill" :style="{ height: pct + '%' }" />
    </div>
    <Transition name="fade-tooltip">
      <div v-if="showTooltip && !vertical" class="tooltip" :style="{ left: tooltipLeft }">
        <span>{{ tooltipText }}</span>
      </div>
      <div v-else-if="showTooltip && vertical" class="tooltip tooltip-vertical" :style="{ bottom: tooltipBottom }">
        <span>{{ tooltipText }}</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.rnp-slider {
  position: relative;
  width: 100%;
  height: 14px;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
}
.rnp-slider.vertical {
  width: 14px;
  height: 100%;
  justify-content: center;
}
.rnp-slider.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
/* 纯进度条，无圆形把手 */
.track {
  position: relative;
  width: 100%;
  height: var(--track-h);
  background: var(--track-color);
  border-radius: 999px;
  overflow: hidden;
  transition: height 0.15s var(--ease-out);
}
.rnp-slider.vertical .track {
  width: var(--track-h);
  height: 100%;
  transition: width 0.15s var(--ease-out);
}
/* hover 或拖动时进度条变粗 */
.rnp-slider.hovering .track,
.rnp-slider.dragging .track {
  height: var(--track-h-hover);
}
.rnp-slider.vertical.hovering .track,
.rnp-slider.vertical.dragging .track {
  width: var(--track-h-hover);
  height: 100%;
}
.buf {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  background: var(--buf-color);
  border-radius: 999px;
}
.rnp-slider.vertical .buf {
  inset: auto 0 0 0;
  width: 100%;
  height: 0;
}
/* 已播放/已播放部分有色（默认蓝色） */
.fill {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  background: var(--accent);
  border-radius: 999px;
}
.rnp-slider.vertical .fill {
  inset: auto 0 0 0;
  width: 100%;
  height: 0;
}
.tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.86);
  color: #fff;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  padding: 3px 7px;
  border-radius: 6px;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: var(--shadow-md);
}
.tooltip::after {
  content: "";
  position: absolute;
  bottom: -3px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 6px;
  height: 6px;
  background: rgba(0, 0, 0, 0.86);
}
/* 竖向 tooltip：显示在滑块右侧 */
.tooltip-vertical {
  bottom: 0 !important;
  left: calc(100% + 8px);
  transform: translateY(50%);
}
.tooltip-vertical::after {
  bottom: 50%;
  left: -3px;
  transform: translateY(50%) rotate(45deg);
}
.fade-tooltip-enter-active,
.fade-tooltip-leave-active {
  transition: opacity 0.15s var(--ease-out);
}
.fade-tooltip-enter-from,
.fade-tooltip-leave-to {
  opacity: 0;
}
</style>
