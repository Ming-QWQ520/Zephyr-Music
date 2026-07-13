<script setup lang="ts">
import { computed } from "vue";
import { useSettings } from "@/composables/useSettings";
import NpVisualizer3D from "./NpVisualizer3D.vue";

const props = defineProps<{ coverUrl: string }>();
const { settings } = useSettings();
const effectiveBgType = computed(() => settings.scene3D !== "off" ? "solid" : settings.bgType);
</script>

<template>
  <div class="rnp-bg" :class="`rnp-bg-${effectiveBgType}`">
    <NpVisualizer3D v-if="settings.scene3D !== 'off'" :cover-url="props.coverUrl" />
    <template v-if="settings.scene3D === 'off'">
      <div v-if="effectiveBgType === 'blur'" class="rnp-bg-blur" :style="{ backgroundImage: coverUrl ? `url(${coverUrl})` : 'none' }"></div>
      <div v-if="effectiveBgType === 'fluid'" class="rnp-bg-fluid" :style="{ backgroundImage: coverUrl ? `url(${coverUrl})` : 'none' }"></div>
      <div v-if="effectiveBgType === 'gradient'" class="rnp-bg-gradient"></div>
      <div v-if="effectiveBgType === 'solid'" class="rnp-bg-solid"></div>
    </template>
    <div v-if="settings.scene3D !== 'off'" class="rnp-bg-3d-vignette"></div>
    <div v-else-if="settings.bgType !== 'none'" class="rnp-bg-dim" :style="{ opacity: settings.bgDim / 100 }"></div>
    <div v-if="effectiveBgType === 'blur' || effectiveBgType === 'fluid'" class="rnp-bg-blur-overlay" :style="{ backdropFilter: `blur(${settings.bgBlur}px) saturate(1.4)`, WebkitBackdropFilter: `blur(${settings.bgBlur}px) saturate(1.4)` }"></div>
  </div>
</template>

<style scoped>
.rnp-bg { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
.rnp-bg > div { position: absolute; inset: 0; width: 100%; height: 100%; }
.rnp-bg > :deep(.np-visualizer-3d) { pointer-events: auto; }
.rnp-bg-blur { background-position: center; background-repeat: no-repeat; background-size: cover; filter: saturate(1.5) brightness(0.6); transform: scale(1.1); }
.rnp-bg-fluid { background-position: center; background-repeat: no-repeat; background-size: cover; filter: saturate(2) brightness(0.5) blur(2px); transform: scale(1.2); animation: fluid-pan 25s ease-in-out infinite alternate; }
@keyframes fluid-pan { 0% { transform: scale(1.2) translate(0, 0) rotate(0deg); } 25% { transform: scale(1.25) translate(-3%, 2%) rotate(0.5deg); } 50% { transform: scale(1.2) translate(2%, -2%) rotate(-0.5deg); } 75% { transform: scale(1.25) translate(-1%, 3%) rotate(0.3deg); } 100% { transform: scale(1.2) translate(3%, -1%) rotate(-0.3deg); } }
.rnp-bg-gradient { background-size: 400% 400%; background-position: 50% 50%; animation: gradient-shift 18s ease infinite; background-image: radial-gradient(circle at 25% 30%, rgba(250, 35, 59, 0.3), transparent 50%), radial-gradient(circle at 80% 70%, rgba(70, 30, 90, 0.4), transparent 60%), linear-gradient(135deg, #1a0a14 0%, #050507 100%); }
@keyframes gradient-shift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
.rnp-bg-solid { background: #0a0a0c; }
.rnp-bg-dim { background: #000; }
.rnp-bg-blur-overlay { pointer-events: none; }
.rnp-bg-3d-vignette { background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0) 35%, rgba(0, 0, 0, 0.35) 75%, rgba(0, 0, 0, 0.6) 100%); pointer-events: none; }
</style>
