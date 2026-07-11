<script setup lang="ts">
/**
 * 背景层（rnp-bg）
 *
 * 包含 blur/fluid/gradient/solid 背景类型切换 + dim overlay + blur overlay。
 * 从 useSettings 读取 settings.bgType/bgBlur/bgDim，coverUrl 由父组件通过 props 传入。
 */
import { useSettings } from "@/composables/useSettings";

defineProps<{
  coverUrl: string;
}>();

const { settings } = useSettings();
</script>

<template>
  <div class="rnp-bg" :class="`rnp-bg-${settings.bgType}`">
    <!-- Blur background: album cover as bg-image + backdrop-blur -->
    <div v-if="settings.bgType === 'blur'" class="rnp-bg-blur"
      :style="{ backgroundImage: coverUrl ? `url(${coverUrl})` : 'none' }">
    </div>
    <!-- Fluid background: album cover + slow pan animation -->
    <div v-if="settings.bgType === 'fluid'" class="rnp-bg-fluid"
      :style="{ backgroundImage: coverUrl ? `url(${coverUrl})` : 'none' }">
    </div>
    <!-- Gradient background: animated gradient from accent colors -->
    <div v-if="settings.bgType === 'gradient'" class="rnp-bg-gradient"></div>
    <!-- Solid background: plain dark -->
    <div v-if="settings.bgType === 'solid'" class="rnp-bg-solid"></div>
    <!-- Dim overlay (always present when type !== 'none') -->
    <div v-if="settings.bgType !== 'none'" class="rnp-bg-dim"
      :style="{ opacity: settings.bgDim / 100 }">
    </div>
    <!-- Blur overlay: backdrop-filter blur on top of bg image -->
    <div v-if="settings.bgType === 'blur' || settings.bgType === 'fluid'" class="rnp-bg-blur-overlay"
      :style="{ backdropFilter: `blur(${settings.bgBlur}px) saturate(1.4)`, WebkitBackdropFilter: `blur(${settings.bgBlur}px) saturate(1.4)` }">
    </div>
  </div>
</template>

<style scoped>
.rnp-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}
.rnp-bg > div {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.rnp-bg-blur {
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  filter: saturate(1.5) brightness(0.6);
  transform: scale(1.1);
}
.rnp-bg-fluid {
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  filter: saturate(2) brightness(0.5) blur(2px);
  transform: scale(1.2);
  animation: fluid-pan 25s ease-in-out infinite alternate;
}
@keyframes fluid-pan {
  0% { transform: scale(1.2) translate(0, 0) rotate(0deg); }
  25% { transform: scale(1.25) translate(-3%, 2%) rotate(0.5deg); }
  50% { transform: scale(1.2) translate(2%, -2%) rotate(-0.5deg); }
  75% { transform: scale(1.25) translate(-1%, 3%) rotate(0.3deg); }
  100% { transform: scale(1.2) translate(3%, -1%) rotate(-0.3deg); }
}
.rnp-bg-gradient {
  background-size: 400% 400%;
  background-position: 50% 50%;
  animation: gradient-shift 18s ease infinite;
  background-image:
    radial-gradient(circle at 25% 30%, rgba(250, 35, 59, 0.3), transparent 50%),
    radial-gradient(circle at 80% 70%, rgba(70, 30, 90, 0.4), transparent 60%),
    linear-gradient(135deg, #1a0a14 0%, #050507 100%);
}
@keyframes gradient-shift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
.rnp-bg-solid { background: #0a0a0c; }
.rnp-bg-dim { background: #000; }
.rnp-bg-blur-overlay { pointer-events: none; }
</style>
