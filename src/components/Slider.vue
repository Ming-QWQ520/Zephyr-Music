<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";

const props = withDefaults(defineProps<{
  /** 0..1 progress fraction */
  modelValue: number;
  /** 0..1 buffered fraction (optional) */
  buffered?: number;
  /** tooltip formatter: receives 0..1, returns string */
  format?: (v: number) => string;
  /** always show tooltip while hovering, otherwise only when dragging */
  alwaysShowOnHover?: boolean;
  height?: number;
  handleSize?: number;
  accent?: string;
  trackColor?: string;
  bufferedColor?: string;
  disabled?: boolean;
}>(), {
  buffered: 0,
  format: (v: number) => `${Math.round(v * 100)}%`,
  alwaysShowOnHover: true,
  height: 4,
  handleSize: 12,
  accent: "var(--accent)",
  trackColor: "rgba(255,255,255,0.18)",
  bufferedColor: "rgba(255,255,255,0.32)",
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

const hoverPos = ref(0); // 0..1, position of cursor along the bar
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
    :class="{ disabled, dragging }"
    :style="{
      '--track-h': height + 'px',
      '--handle-s': handleSize + 'px',
      '--accent': accent,
      '--track-color': trackColor,
      '--buf-color': bufferedColor,
    }"
    @pointerdown="onPointerDown"
  >
    <div class="track">
      <div class="buf" :style="{ width: bufPct + '%' }" />
      <div class="fill" :style="{ width: pct + '%' }" />
      <div class="handle" :style="{ left: pct + '%' }" />
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
.track {
  position: relative;
  width: 100%;
  height: var(--track-h);
  background: var(--track-color);
  border-radius: 999px;
  overflow: visible;
  transition: height 0.15s var(--ease-out);
}
.rnp-slider:hover .track,
.rnp-slider.dragging .track {
  height: calc(var(--track-h) + 2px);
}
.buf {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  background: var(--buf-color);
  border-radius: 999px;
}
.fill {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  background: var(--accent);
  border-radius: 999px;
}
.handle {
  position: absolute;
  top: 50%;
  width: var(--handle-s);
  height: var(--handle-s);
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
  transform: translate(-50%, -50%) scale(0);
  transition: transform 0.18s var(--ease-out);
}
.rnp-slider:hover .handle,
.rnp-slider.dragging .handle {
  transform: translate(-50%, -50%) scale(1);
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
