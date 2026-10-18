<script setup lang="ts">
import { computed } from "vue";
import { useSettings } from "@/composables/useSettings";
// 异步加载：Three.js (~500KB) 只在启用 3D 场景时才下载解析，加快应用启动
import { defineAsyncComponent } from "vue";
const NpVisualizer3D = defineAsyncComponent(() => import("./NpVisualizer3D.vue"));

const props = defineProps<{ coverUrl: string }>();
const { settings } = useSettings();
const effectiveBgType = computed(() => settings.scene3D !== "off" ? "solid" : settings.bgType);

// ===== 性能重构 =====
// 旧实现：图像层 + 全屏 backdrop-filter 叠加层 + dim 层 = 3 个合成层，
//         其中 backdrop-filter 会强制每帧对下方所有内容做离屏合成（DevTools 3D 视图中可见
//         1180px 宽的多层堆叠，GPU/内存占用高）。
// 新实现：把 blur/dim 直接合并进图像层自身的 filter 链，单层完成全部效果；
//         blur/fluid 不再需要 overlay 与独立 dim 层（gradient/solid 仍用纯色 dim 层，成本极低）。
const dimFactor = computed(() => 1 - settings.bgDim / 100);
/** blur 越大边缘透明区域越宽，按 blur 值放大 scale 防止露边（1.1 基础 + blur/600） */
const bgScale = computed(() => (1.1 + settings.bgBlur / 600).toFixed(3));
const blurLayerStyle = computed(() => ({
  backgroundImage: props.coverUrl ? `url(${props.coverUrl})` : "none",
  filter: `blur(${settings.bgBlur}px) saturate(1.5) brightness(${(0.6 * dimFactor.value).toFixed(3)})`,
  transform: `scale(${bgScale.value})`,
}));
const fluidLayerStyle = computed(() => ({
  backgroundImage: props.coverUrl ? `url(${props.coverUrl})` : "none",
  filter: `blur(${Math.min(settings.bgBlur, 60)}px) saturate(2) brightness(${(0.5 * dimFactor.value).toFixed(3)})`,
  transform: `scale(${bgScale.value})`,
}));
</script>

<template>
  <div class="rnp-bg" :class="`rnp-bg-${effectiveBgType}`">
    <NpVisualizer3D v-if="settings.scene3D !== 'off'" :cover-url="props.coverUrl" />
    <template v-if="settings.scene3D === 'off'">
      <div v-if="effectiveBgType === 'blur'" class="rnp-bg-blur" :style="blurLayerStyle"></div>
      <div v-if="effectiveBgType === 'fluid'" class="rnp-bg-fluid" :style="fluidLayerStyle"></div>
      <div v-if="effectiveBgType === 'gradient'" class="rnp-bg-gradient"></div>
      <div v-if="effectiveBgType === 'solid'" class="rnp-bg-solid"></div>
      <div
        v-if="(effectiveBgType === 'gradient' || effectiveBgType === 'none') && settings.bgDim > 0"
        class="rnp-bg-dim"
        :style="{ opacity: settings.bgDim / 100 }"
      ></div>
    </template>
    <div v-if="settings.scene3D !== 'off'" class="rnp-bg-3d-vignette"></div>
  </div>
</template>

<style scoped>
.rnp-bg { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
.rnp-bg > div { position: absolute; inset: 0; width: 100%; height: 100%; }
.rnp-bg > :deep(.np-visualizer-3d) { pointer-events: auto; }
/* blur/fluid：blur/dim 已合并进内联 filter，无需独立 overlay/dim 层 */
.rnp-bg-blur { background-position: center; background-repeat: no-repeat; background-size: cover; }
.rnp-bg-fluid { background-position: center; background-repeat: no-repeat; background-size: cover; animation: fluid-pan 25s ease-in-out infinite alternate; }
@keyframes fluid-pan { 0% { translate: 0 0; rotate: 0deg; } 25% { translate: -3% 2%; rotate: 0.5deg; } 50% { translate: 2% -2%; rotate: -0.5deg; } 75% { translate: -1% 3%; rotate: 0.3deg; } 100% { translate: 3% -1%; rotate: -0.3deg; } }
.rnp-bg-gradient { background-size: 400% 400%; background-position: 50% 50%; animation: gradient-shift 18s ease infinite; background-image: radial-gradient(circle at 25% 30%, rgba(250, 35, 59, 0.3), transparent 50%), radial-gradient(circle at 80% 70%, rgba(70, 30, 90, 0.4), transparent 60%), linear-gradient(135deg, #1a0a14 0%, #050507 100%); }
@keyframes gradient-shift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
.rnp-bg-solid { background: #0a0a0c; }
.rnp-bg-dim { background: #000; }
.rnp-bg-3d-vignette { background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0) 35%, rgba(0, 0, 0, 0.35) 75%, rgba(0, 0, 0, 0.6) 100%); pointer-events: none; }
</style>
