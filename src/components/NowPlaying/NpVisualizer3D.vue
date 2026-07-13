<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { ThreeScene3D, createBandExtractor, type Scene3DAnalysis } from "@/composables/use3DScene";
import { useAudioVisualizer } from "@/composables/useAudioVisualizer";
import { useNowPlaying } from "./useNowPlaying";
import type { Scene3D } from "@/types";

const props = defineProps<{ coverUrl: string }>();

const { settings } = useNowPlaying();
const visualizer = useAudioVisualizer();
const extractor = createBandExtractor();
const containerRef = ref<HTMLDivElement | null>(null);
let scene: ThreeScene3D | null = null;

onMounted(() => {
  const el = containerRef.value;
  if (!el) return;
  scene = new ThreeScene3D(el);
  scene.setAnalysisCallback((): Scene3DAnalysis => {
    const r = extractor.extract((out) => visualizer.fillFrequency(out));
    return { bass: r.bass, mid: r.mid, treble: r.treble, beat: r.beat, energy: r.energy };
  });
  scene.setAlphaTarget(1);
  if (settings.scene3D !== "off") scene.setPreset(settings.scene3D);
  scene.setCover(props.coverUrl || null);
});

onUnmounted(() => { scene?.dispose(); scene = null; extractor.reset(); });

watch(() => settings.scene3D, (p: Scene3D) => { if (!scene) return; if (p !== "off") scene.setPreset(p); });
watch(() => props.coverUrl, (url: string) => { scene?.setCover(url || null); });
</script>

<template>
  <div ref="containerRef" class="np-visualizer-3d" aria-hidden="true"></div>
</template>

<style scoped>
.np-visualizer-3d { position: absolute; inset: 0; z-index: 0; pointer-events: auto; background: transparent; }
</style>
