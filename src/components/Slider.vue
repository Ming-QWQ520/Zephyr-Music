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
}>(), {
  buffered: 0,
  format: (v: number) => `${Math.round(v * 100)}%`,
  alwaysShowOnHover: true,
  height: 3,
  accent: "#3b82f6",
  trackColor: "rgba(255,255,255,0.15)",
  bufferedColor: "transparent",
  disabled: false,
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

function clientToFrac(clientX: number): number {
  const el = rootRef.value;
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  if (r.width === 0) return 0;
  return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
}

function onPointerDown(ev: PointerEvent) {
  if (props.disabled) return;
  ev.preventDefault();
  (ev.target as Element).setPointerCapture?.(ev.pointerId);
  dragging.value = true;
  emit("dragstart");
  const f = clientToFrac(ev.clientX);
  emit("update:modelValue", f);
  emit("change", f);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

function onPointerMove(ev: PointerEvent) {
  if (!dragging.value) return;
  const f = clientToFrac(ev.clientX);
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
  hoverPos.value = clientToFrac(ev.clientX);
}

function onMouseEnter() { hovering.value = true; }
function onMouseLeave() { hovering.value = false; }

const tooltipLeft = computed(() => {
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
    :class="{ disabled, dragging, hovering }"
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
      <div class="buf" :style="{ width: bufPct + '%' }" />
      <div class="fill" :style="{ width: pct + '%' }" />
    </div>
    <Transition name="fade-tooltip">
      <div v-if="showTooltip" class="tooltip" :style="{ left: tooltipLeft }">
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
/* hover 或拖动时进度条变粗 */
.rnp-slider.hovering .track,
.rnp-slider.dragging .track {
  height: var(--track-h-hover);
}
.buf {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  background: var(--buf-color);
  border-radius: 999px;
}
/* 已播放/已播放部分有色（默认蓝色） */
.fill {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  background: var(--accent);
  border-radius: 999px;
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
.fade-tooltip-enter-active,
.fade-tooltip-leave-active {
  transition: opacity 0.15s var(--ease-out);
}
.fade-tooltip-enter-from,
.fade-tooltip-leave-to {
  opacity: 0;
}
</style>
