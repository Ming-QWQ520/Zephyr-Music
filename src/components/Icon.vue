<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{
  name: string;
  size?: number | string;
  /** stroke width for line-style icons */
  stroke?: number;
}>(), {
  size: 20,
  stroke: 1.8,
});

const dim = computed(() => (typeof props.size === "number" ? `${props.size}px` : props.size));

// Each entry is the inner SVG markup. Viewbox is 24x24.
const ICONS: Record<string, string> = {
  search: `<circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" stroke-linecap="round"/>`,
  play: `<path d="M7 5.5v13a1 1 0 0 0 1.54.84l10.2-6.5a1 1 0 0 0 0-1.68L8.54 4.66A1 1 0 0 0 7 5.5Z" fill="currentColor" stroke="none"/>`,
  pause: `<rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/>`,
  next: `<path d="M5 5.5v13a1 1 0 0 0 1.54.84l8.2-5.23a1 1 0 0 0 0-1.68L6.54 4.66A1 1 0 0 0 5 5.5Z" fill="currentColor" stroke="none"/><rect x="17.5" y="5" width="2.4" height="14" rx="1" fill="currentColor" stroke="none"/>`,
  prev: `<path d="M19 5.5v13a1 1 0 0 1-1.54.84l-8.2-5.23a1 1 0 0 1 0-1.68l8.2-5.23A1 1 0 0 1 19 5.5Z" fill="currentColor" stroke="none"/><rect x="4" y="5" width="2.4" height="14" rx="1" fill="currentColor" stroke="none"/>`,
  shuffle: `<path d="M4 7h3.5a3 3 0 0 1 2.4 1.2l4.2 5.6a3 3 0 0 0 2.4 1.2H20" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 17h3.5a3 3 0 0 0 2.4-1.2l4.2-5.6a3 3 0 0 1 2.4-1.2H20" stroke-linecap="round" stroke-linejoin="round"/><path d="m17 4 3 3-3 3M17 14l3 3-3 3" stroke-linecap="round" stroke-linejoin="round"/>`,
  repeat: `<path d="M4 11a5 5 0 0 1 5-5h7" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 13a5 5 0 0 1-5 5H8" stroke-linecap="round" stroke-linejoin="round"/><path d="m14 3 3 3-3 3M10 15l-3 3 3 3" stroke-linecap="round" stroke-linejoin="round"/>`,
  repeatOne: `<path d="M4 11a5 5 0 0 1 5-5h7" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 13a5 5 0 0 1-5 5H8" stroke-linecap="round" stroke-linejoin="round"/><path d="m14 3 3 3-3 3M10 15l-3 3 3 3" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 9.2v6.2M12 9.2 10.4 10.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  sequence: `<path d="M4 7h12" stroke-linecap="round"/><path d="M4 12h12" stroke-linecap="round"/><path d="M4 17h12" stroke-linecap="round"/><path d="m19 5 2 2-2 2M19 14l2 2-2 2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 7H8M21 16H8" stroke-linecap="round"/>`,
  list: `<path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round"/>`,
  music: `<path d="M9 18V6l11-2v12" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" />`,
  volume: `<path d="M4 9v6h4l5 4V5L8 9H4Z" stroke-linejoin="round"/><path d="M16 9a3 3 0 0 1 0 6" stroke-linecap="round"/><path d="M19 6a7 7 0 0 1 0 12" stroke-linecap="round"/>`,
  volumeLow: `<path d="M4 9v6h4l5 4V5L8 9H4Z" stroke-linejoin="round"/><path d="M16 9a3 3 0 0 1 0 6" stroke-linecap="round"/>`,
  volumeMute: `<path d="M4 9v6h4l5 4V5L8 9H4Z" stroke-linejoin="round"/><path d="m16 9 5 6M21 9l-5 6" stroke-linecap="round"/>`,
  heart: `<path d="M12 20s-7-4.6-9.2-9C1.4 8.4 2.7 5.2 5.9 5.2c1.9 0 3.1 1 4.1 2.3 1-1.3 2.2-2.3 4.1-2.3 3.2 0 4.5 3.2 3.1 5.8C19 15.4 12 20 12 20Z" stroke-linejoin="round"/>`,
  heartFilled: `<path d="M12 20s-7-4.6-9.2-9C1.4 8.4 2.7 5.2 5.9 5.2c1.9 0 3.1 1 4.1 2.3 1-1.3 2.2-2.3 4.1-2.3 3.2 0 4.5 3.2 3.1 5.8C19 15.4 12 20 12 20Z" fill="currentColor" stroke="none"/>`,
  home: `<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1v-7.5Z" stroke-linejoin="round"/>`,
  library: `<path d="M4 5h3v14H4zM10 5h3v14h-3zM16.5 5.6l3 13.4-2.5.6-3-13.4z" stroke-linejoin="round"/>`,
  history: `<path d="M4 12a8 8 0 1 0 2.3-5.6" stroke-linecap="round"/><path d="M6 4v3.5h3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8v4.2l3 1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  settings: `<circle cx="12" cy="12" r="3" /><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l1.6-1.2-1.8-3.1-1.9.8a7.7 7.7 0 0 0-2.6-1.5L13.3 3h-3.6l-.4 2a7.7 7.7 0 0 0-2.6 1.5l-1.9-.8L2 8.8l1.6 1.2a7.7 7.7 0 0 0 0 3L2 14.2l1.8 3.1 1.9-.8a7.7 7.7 0 0 0 2.6 1.5l.4 2h3.6l.4-2a7.7 7.7 0 0 0 2.6-1.5l1.9.8 1.8-3.1-1.6-1.2Z" stroke-linejoin="round"/>`,
  close: `<path d="m6 6 12 12M18 6 6 18" stroke-linecap="round"/>`,
  chevronDown: `<path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/>`,
  chevronLeft: `<path d="m15 6-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"/>`,
  chevronRight: `<path d="m9 6 6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/>`,
  chevronUp: `<path d="m6 15 6-6 6 6" stroke-linecap="round" stroke-linejoin="round"/>`,
  plus: `<path d="M12 5v14M5 12h14" stroke-linecap="round"/>`,
  trash: `<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" stroke-linecap="round" stroke-linejoin="round"/>`,
  drag: `<path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round"/>`,
  minimize: `<path d="M5 12h14" stroke-linecap="round"/>`,
  collapse: `<path d="M5 9V5h4M19 9V5h-4M5 15v4h4M19 15v4h-4" stroke-linecap="round" stroke-linejoin="round"/>`,
  expand: `<path d="M9 5v4H5M15 5v4h4M9 19v-4H5M15 19v-4h4" stroke-linecap="round" stroke-linejoin="round"/>`,
  maximize: `<rect x="5" y="5" width="14" height="14" rx="2"/>`,
  folder: `<path d="M4 7a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7Z" stroke-linejoin="round"/>`,
  download: `<path d="M12 4v10m0 0 4-4m-4 4-4-4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 19h14" stroke-linecap="round"/>`,
  cast: `<path d="M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 16a2 2 0 0 1 2 2M4 12a6 6 0 0 1 6 6" stroke-linecap="round"/>`,
  lyrics: `<path d="M5 6h14M5 10h14M5 14h8M5 18h10" stroke-linecap="round"/>`,
  palette: `<path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H16a5 5 0 0 0 5-5c0-3.9-4-7-9-7Z" stroke-linejoin="round"/><circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="11" r="1" fill="currentColor" stroke="none"/>`,
  font: `<path d="M6 18 11 6h2l5 12M8 14h8" stroke-linecap="round" stroke-linejoin="round"/>`,
  image: `<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m5 17 4-4 3 3 3-2 4 4" stroke-linecap="round" stroke-linejoin="round"/>`,
  more: `<circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none"/>`,
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01" stroke-linecap="round"/>`,
  flask: `<path d="M9 3h6M10 3v6L4 19a2 2 0 0 0 1.7 3h12.6A2 2 0 0 0 20 19l-6-10V3" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 15h10" stroke-linecap="round"/>`,
  sparkles: `<path d="m12 4 1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4Z" stroke-linejoin="round"/><path d="M18 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" stroke-linejoin="round"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2" stroke-linecap="round" stroke-linejoin="round"/>`,
  equalizer: `<path d="M6 4v8M6 16v4M12 4v3M12 11v9M18 4v9M18 17v3" stroke-linecap="round"/><circle cx="6" cy="12" r="2" /><circle cx="12" cy="8" r="2" /><circle cx="18" cy="14" r="2" />`,
  grip: `<circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none"/>`,
};

const inner = computed(() => ICONS[props.name] || "");
</script>

<template>
  <svg
    :width="dim"
    :height="dim"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="round"
    aria-hidden="true"
    class="icon-svg"
    v-html="inner"
  />
</template>

<style scoped>
.icon-svg {
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
}
</style>
