<script lang="ts">
import { reactive, watch } from "vue";

export type DisplayMode = "both" | "cover" | "lyrics";
export type ColorMode = "dark" | "light" | "auto";
export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "center" | "bottom";
export type BgType = "cover" | "blur" | "fluid" | "gradient" | "solid" | "none";
/** Background audio visualizer style. Replaces the old "karaoke animation". */
export type VisualizerStyle = "off" | "bars" | "lines" | "wave";
export type VisualizerColor = "accent" | "white" | "rainbow" | "album";
export type LyricAlign = "left" | "center";
export type AnimationTiming = "smooth" | "swift" | "bouncy" | "soft" | "spring";
export type FontFamily = "system" | "serif" | "rounded" | "mono" | "song";

export interface PlayerSettings {
  // Appearance
  displayMode: DisplayMode;
  colorMode: ColorMode;
  accentColor: string;
  textShadow: boolean;
  textGlow: boolean;
  progressPreview: boolean;

  // Cover
  coverHAlign: HAlign;
  coverVAlign: VAlign;
  rectangleCover: boolean;
  coverShadow: boolean;

  // Background
  bgType: BgType;
  bgBlur: number; // px
  bgDim: number; // 0..100

  // Audio visualizer (background bars/lines that bounce with the audio)
  visualizerStyle: VisualizerStyle;
  visualizerColor: VisualizerColor;
  visualizerIntensity: number; // 0..1 — overall amplitude multiplier
  visualizerOpacity: number; // 0..1 — background layer opacity
  visualizerBarCount: number; // 24..96 — number of bars/segments

  // Lyrics
  boldFirstLine: boolean;
  lyricFontSize: number; // px
  lyricLineGap: number; // px
  showRomaji: boolean;
  showTranslation: boolean;
  lyricZoom: number; // multiplier around current line
  lyricBlur: number; // px for inactive lines
  lyricFade: number; // 0..1 opacity falloff
  lyricRotate: boolean;
  rotateCurvature: number; // 0..50
  currentLyricAlign: LyricAlign;
  lyricStagger: number; // 0..1 stagger amount
  animationTiming: AnimationTiming;

  // Misc
  hidePlayerControls: boolean;
  autoHideMiniInfo: boolean;

  // Experimental
  gpuAcceleration: boolean;
  debugLog: boolean;
  skipMetadata: boolean;
  lowLatency: boolean;

  // Font
  fontFamily: FontFamily;
  fontScale: number; // 0.8..1.4
}

const STORAGE_KEY = "rnp-settings";

export const DEFAULT_SETTINGS: PlayerSettings = {
  displayMode: "both",
  colorMode: "dark",
  accentColor: "#fa233b",
  textShadow: true,
  textGlow: false,
  progressPreview: true,

  coverHAlign: "left",
  coverVAlign: "center",
  rectangleCover: false,
  coverShadow: true,

  bgType: "blur",
  bgBlur: 10,
  bgDim: 30,

  visualizerStyle: "off",
  visualizerColor: "accent",
  visualizerIntensity: 0.7,
  visualizerOpacity: 0.55,
  visualizerBarCount: 48,

  boldFirstLine: true,
  lyricFontSize: 28,
  lyricLineGap: 18,
  showRomaji: false,
  showTranslation: true,
  lyricZoom: 1.18,
  lyricBlur: 6,
  lyricFade: 0.32,
  lyricRotate: false,
  rotateCurvature: 18,
  currentLyricAlign: "left",
  lyricStagger: 0.4,
  animationTiming: "smooth",

  hidePlayerControls: false,
  autoHideMiniInfo: true,

  gpuAcceleration: true,
  debugLog: false,
  skipMetadata: false,
  lowLatency: false,

  fontFamily: "system",
  fontScale: 1,
};

let cached: PlayerSettings | null = null;

export function loadSettings(): PlayerSettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return (cached = { ...DEFAULT_SETTINGS });
    const parsed = JSON.parse(raw);
    // Migrate legacy "karaokeAnimation" setting → new visualizer settings.
    // Old: karaokeAnimation: "off" | "wave" | "scale" | "color"
    // New: visualizerStyle: "off" | "bars" | "lines" | "wave"
    if (parsed && "karaokeAnimation" in parsed && !("visualizerStyle" in parsed)) {
      const old = parsed.karaokeAnimation;
      parsed.visualizerStyle =
        old === "off" ? "off" :
        old === "wave" ? "wave" :
        old === "scale" ? "bars" :
        old === "color" ? "bars" : "bars";
      delete parsed.karaokeAnimation;
    }
    cached = { ...DEFAULT_SETTINGS, ...parsed } as PlayerSettings;
  } catch {
    cached = { ...DEFAULT_SETTINGS };
  }
  return cached!;
}

export function saveSettings(s: PlayerSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota errors */
  }
}

const _settings = reactive<PlayerSettings>(loadSettings());

watch(
  _settings,
  (v) => {
    cached = v;
    saveSettings(v);
    // Reflect accent on the CSS variable
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--accent", v.accentColor);
      document.documentElement.style.setProperty(
        "--accent-soft",
        hexToRgba(v.accentColor, 0.16)
      );
      document.documentElement.dataset.colorMode = v.colorMode;
      // GPU acceleration: add/remove a class on <html> that forces translateZ(0) on all animated elements
      if (v.gpuAcceleration) {
        document.documentElement.classList.add("gpu-accel");
        document.documentElement.classList.remove("no-gpu");
      } else {
        document.documentElement.classList.add("no-gpu");
        document.documentElement.classList.remove("gpu-accel");
      }
      // Low latency: reduce animation durations
      if (v.lowLatency) {
        document.documentElement.style.setProperty("--timing-mult", "0.5");
      } else {
        document.documentElement.style.setProperty("--timing-mult", "1");
      }
    }
  },
  { deep: true, immediate: true }
);

function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return `rgba(250,35,59,${alpha})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function useSettings() {
  return { settings: _settings, defaults: DEFAULT_SETTINGS };
}
</script>

<script setup lang="ts">
import { ref, computed } from "vue";
import Icon from "@/components/Icon.vue";
import Slider from "@/components/Slider.vue";

const props = withDefaults(defineProps<{
  visible: boolean;
  mode?: "sidebar" | "modal";
}>(), {
  visible: false,
  mode: "sidebar",
});

const emit = defineEmits<{
  (e: "close"): void;
  (e: "reset"): void;
}>();

const { settings, defaults } = useSettings();

type TabKey = "appearance" | "cover" | "background" | "lyrics" | "font" | "misc" | "experimental" | "about";

interface Tab {
  key: TabKey;
  label: string;
  icon: string;
}

const tabs: Tab[] = [
  { key: "appearance", label: "外观", icon: "palette" },
  { key: "cover", label: "封面", icon: "image" },
  { key: "background", label: "背景", icon: "sparkles" },
  { key: "lyrics", label: "歌词", icon: "lyrics" },
  { key: "font", label: "字体", icon: "font" },
  { key: "misc", label: "杂项", icon: "settings" },
  { key: "experimental", label: "实验性", icon: "flask" },
  { key: "about", label: "关于", icon: "info" },
];

const activeTab = ref<TabKey>("appearance");

const ACCENT_PRESETS = ["#fa233b", "#ff6b35", "#ffd23f", "#06d6a0", "#118ab2", "#9d4edd", "#ef476f", "#073b4c"];

function resetAll() {
  Object.assign(settings, defaults);
  emit("reset");
}

const APP_VERSION = "1.0.0";
</script>

<template>
  <Transition name="panel">
    <section v-if="visible" class="settings-panel" :class="`mode-${mode}`" @click.self="mode === 'modal' ? emit('close') : undefined">
      <div class="panel-card">
        <header class="panel-head">
          <h2>设置</h2>
          <button class="icon-btn" title="关闭" @click="emit('close')">
            <Icon name="close" :size="18" />
          </button>
        </header>

        <div class="panel-body">
          <nav class="tabs nice-scroll">
            <button
              v-for="t in tabs"
              :key="t.key"
              class="tab"
              :class="{ active: activeTab === t.key }"
              @click="activeTab = t.key"
            >
              <Icon :name="t.icon" :size="16" />
              <span>{{ t.label }}</span>
            </button>
          </nav>

          <div class="content nice-scroll">
            <!-- Appearance -->
            <section v-show="activeTab === 'appearance'" class="tab-pane">
              <h3>外观</h3>
              <div class="row">
                <div class="label">显示模式</div>
                <div class="seg">
                  <button
                    v-for="m in ['both', 'cover', 'lyrics'] as const"
                    :key="m"
                    :class="{ active: settings.displayMode === m }"
                    @click="settings.displayMode = m"
                  >{{ m === 'both' ? '都显示' : m === 'cover' ? '只显示封面' : '只显示歌词' }}</button>
                </div>
              </div>
              <div class="row">
                <div class="label">配色模式</div>
                <div class="seg">
                  <button
                    v-for="m in ['dark', 'light', 'auto'] as const"
                    :key="m"
                    :class="{ active: settings.colorMode === m }"
                    @click="settings.colorMode = m"
                  >{{ m === 'dark' ? '深色' : m === 'light' ? '浅色' : '跟随系统' }}</button>
                </div>
              </div>
              <div class="row">
                <div class="label">主题色</div>
                <div class="swatches">
                  <button
                    v-for="c in ACCENT_PRESETS"
                    :key="c"
                    class="swatch"
                    :class="{ active: settings.accentColor === c }"
                    :style="{ background: c }"
                    @click="settings.accentColor = c"
                  />
                  <label class="swatch custom" title="自定义颜色">
                    <input type="color" v-model="settings.accentColor" />
                    <Icon name="plus" :size="14" />
                  </label>
                </div>
              </div>
              <div class="row toggle">
                <div class="label">文字阴影</div>
                <button class="switch" :class="{ on: settings.textShadow }" @click="settings.textShadow = !settings.textShadow" />
              </div>
              <div class="row toggle">
                <div class="label">文字发光</div>
                <button class="switch" :class="{ on: settings.textGlow }" @click="settings.textGlow = !settings.textGlow" />
              </div>
              <div class="row toggle">
                <div class="label">进度条悬停预览</div>
                <button class="switch" :class="{ on: settings.progressPreview }" @click="settings.progressPreview = !settings.progressPreview" />
              </div>
            </section>

            <!-- Cover -->
            <section v-show="activeTab === 'cover'" class="tab-pane">
              <h3>封面</h3>
              <div class="row">
                <div class="label">水平对齐</div>
                <div class="seg">
                  <button
                    v-for="m in ['left', 'center', 'right'] as const"
                    :key="m"
                    :class="{ active: settings.coverHAlign === m }"
                    @click="settings.coverHAlign = m"
                  >{{ m === 'left' ? '左' : m === 'center' ? '中' : '右' }}</button>
                </div>
              </div>
              <div class="row">
                <div class="label">垂直对齐</div>
                <div class="seg">
                  <button
                    v-for="m in ['top', 'center', 'bottom'] as const"
                    :key="m"
                    :class="{ active: settings.coverVAlign === m }"
                    @click="settings.coverVAlign = m"
                  >{{ m === 'top' ? '上' : m === 'center' ? '中' : '下' }}</button>
                </div>
              </div>
              <div class="row toggle">
                <div class="label">矩形封面</div>
                <button class="switch" :class="{ on: settings.rectangleCover }" @click="settings.rectangleCover = !settings.rectangleCover" />
              </div>
              <div class="row toggle">
                <div class="label">封面阴影</div>
                <button class="switch" :class="{ on: settings.coverShadow }" @click="settings.coverShadow = !settings.coverShadow" />
              </div>
            </section>

            <!-- Background -->
            <section v-show="activeTab === 'background'" class="tab-pane">
              <h3>背景</h3>
              <div class="row">
                <div class="label">背景类型</div>
                <div class="seg">
                  <button
                    v-for="m in ['blur', 'fluid', 'gradient', 'solid', 'none'] as const"
                    :key="m"
                    :class="{ active: settings.bgType === m }"
                    @click="settings.bgType = m"
                  >{{ m === 'blur' ? '模糊' : m === 'fluid' ? '流体' : m === 'gradient' ? '渐变' : m === 'solid' ? '纯色' : '无' }}</button>
                </div>
              </div>
              <div class="row">
                <div class="label">模糊强度</div>
                <Slider class="row-slider" :model-value="settings.bgBlur / 120" :format="(v) => `${Math.round(v * 120)}px`" @change="(v) => settings.bgBlur = Math.round(v * 120)" />
              </div>
              <div class="row">
                <div class="label">背景变暗</div>
                <Slider class="row-slider" :model-value="settings.bgDim / 100" :format="(v) => `${Math.round(v * 100)}%`" @change="(v) => settings.bgDim = Math.round(v * 100)" />
              </div>

              <!-- Audio visualizer (background bars / lines that bounce with the audio) -->
              <div class="row subgroup">
                <div class="label subgroup-title">音频可视化</div>
              </div>
              <div class="row">
                <div class="label">可视化样式</div>
                <div class="seg">
                  <button
                    v-for="m in ['off', 'bars', 'lines', 'wave'] as const"
                    :key="m"
                    :class="{ active: settings.visualizerStyle === m }"
                    @click="settings.visualizerStyle = m"
                  >{{ m === 'off' ? '关' : m === 'bars' ? '长方体' : m === 'lines' ? '线条' : '波浪' }}</button>
                </div>
              </div>
              <div class="row">
                <div class="label">配色</div>
                <div class="seg">
                  <button
                    v-for="m in ['accent', 'white', 'rainbow', 'album'] as const"
                    :key="m"
                    :class="{ active: settings.visualizerColor === m }"
                    @click="settings.visualizerColor = m"
                  >{{ m === 'accent' ? '主题色' : m === 'white' ? '白色' : m === 'rainbow' ? '彩虹' : '专辑' }}</button>
                </div>
              </div>
              <div class="row">
                <div class="label">灵敏度</div>
                <Slider class="row-slider" :model-value="settings.visualizerIntensity" :format="(v) => `${Math.round(v * 100)}%`" @change="(v) => settings.visualizerIntensity = +v.toFixed(2)" />
              </div>
              <div class="row">
                <div class="label">不透明度</div>
                <Slider class="row-slider" :model-value="settings.visualizerOpacity" :format="(v) => `${Math.round(v * 100)}%`" @change="(v) => settings.visualizerOpacity = +v.toFixed(2)" />
              </div>
              <div class="row">
                <div class="label">柱体数量</div>
                <Slider class="row-slider" :model-value="(settings.visualizerBarCount - 12) / 20" :format="(v) => `${Math.round(12 + v * 20)}`" @change="(v) => settings.visualizerBarCount = Math.round(12 + v * 20)" />
              </div>
              <p class="hint-block" v-if="settings.visualizerStyle !== 'off'">
                可视化使用模拟频谱（跟随播放进度、音量、节拍），不接触音频元素以确保播放稳定。性能优化：32 柱上限、30fps、暂停时停止。
              </p>
            </section>

            <!-- Lyrics -->
            <section v-show="activeTab === 'lyrics'" class="tab-pane">
              <h3>歌词</h3>
              <div class="row toggle">
                <div class="label">首行加粗</div>
                <button class="switch" :class="{ on: settings.boldFirstLine }" @click="settings.boldFirstLine = !settings.boldFirstLine" />
              </div>
              <div class="row">
                <div class="label">字号</div>
                <Slider class="row-slider" :model-value="(settings.lyricFontSize - 14) / 40" :format="(v) => `${Math.round(14 + v * 40)}px`" @change="(v) => settings.lyricFontSize = Math.round(14 + v * 40)" />
              </div>
              <div class="row">
                <div class="label">行间距</div>
                <Slider class="row-slider" :model-value="settings.lyricLineGap / 60" :format="(v) => `${Math.round(v * 60)}px`" @change="(v) => settings.lyricLineGap = Math.round(v * 60)" />
              </div>
              <div class="row toggle">
                <div class="label">显示罗马音</div>
                <button class="switch" :class="{ on: settings.showRomaji }" @click="settings.showRomaji = !settings.showRomaji" />
              </div>
              <div class="row toggle">
                <div class="label">显示翻译</div>
                <button class="switch" :class="{ on: settings.showTranslation }" @click="settings.showTranslation = !settings.showTranslation" />
              </div>
              <div class="row">
                <div class="label">当前行缩放</div>
                <Slider class="row-slider" :model-value="(settings.lyricZoom - 1) / 0.6" :format="(v) => `${(1 + v * 0.6).toFixed(2)}x`" @change="(v) => settings.lyricZoom = +(1 + v * 0.6).toFixed(2)" />
              </div>
              <div class="row">
                <div class="label">非活跃行模糊</div>
                <Slider class="row-slider" :model-value="settings.lyricBlur / 20" :format="(v) => `${Math.round(v * 20)}px`" @change="(v) => settings.lyricBlur = Math.round(v * 20)" />
              </div>
              <div class="row">
                <div class="label">非活跃行淡出</div>
                <Slider class="row-slider" :model-value="settings.lyricFade" :format="(v) => `${Math.round(v * 100)}%`" @change="(v) => settings.lyricFade = +v.toFixed(2)" />
              </div>
              <div class="row toggle">
                <div class="label">3D 旋转</div>
                <button class="switch" :class="{ on: settings.lyricRotate }" @click="settings.lyricRotate = !settings.lyricRotate" />
              </div>
              <div class="row">
                <div class="label">旋转曲率</div>
                <Slider class="row-slider" :model-value="settings.rotateCurvature / 50" :format="(v) => `${Math.round(v * 50)}`" @change="(v) => settings.rotateCurvature = Math.round(v * 50)" />
              </div>
              <div class="row">
                <div class="label">当前行对齐</div>
                <div class="seg">
                  <button
                    v-for="m in ['left', 'center'] as const"
                    :key="m"
                    :class="{ active: settings.currentLyricAlign === m }"
                    @click="settings.currentLyricAlign = m"
                  >{{ m === 'left' ? '左' : '中' }}</button>
                </div>
              </div>
              <div class="row">
                <div class="label">逐行延迟</div>
                <Slider class="row-slider" :model-value="settings.lyricStagger" :format="(v) => `${Math.round(v * 100)}%`" @change="(v) => settings.lyricStagger = +v.toFixed(2)" />
              </div>
              <div class="row">
                <div class="label">动画曲线</div>
                <div class="seg">
                  <button
                    v-for="m in ['smooth', 'swift', 'bouncy', 'soft', 'spring'] as const"
                    :key="m"
                    :class="{ active: settings.animationTiming === m }"
                    @click="settings.animationTiming = m"
                  >{{ m === 'smooth' ? '平滑' : m === 'swift' ? '迅捷' : m === 'bouncy' ? '弹跳' : m === 'soft' ? '柔和' : '弹簧' }}</button>
                </div>
              </div>
            </section>

            <!-- Font -->
            <section v-show="activeTab === 'font'" class="tab-pane">
              <h3>字体</h3>
              <div class="row">
                <div class="label">字体族</div>
                <div class="seg wrap">
                  <button
                    v-for="m in ['system', 'serif', 'rounded', 'mono', 'song'] as const"
                    :key="m"
                    :class="{ active: settings.fontFamily === m }"
                    @click="settings.fontFamily = m"
                  >{{ m === 'system' ? '系统' : m === 'serif' ? '衬线' : m === 'rounded' ? '圆角' : m === 'mono' ? '等宽' : '宋体' }}</button>
                </div>
              </div>
              <div class="row">
                <div class="label">字体缩放</div>
                <Slider class="row-slider" :model-value="(settings.fontScale - 0.8) / 0.6" :format="(v) => `${(0.8 + v * 0.6).toFixed(2)}x`" @change="(v) => settings.fontScale = +(0.8 + v * 0.6).toFixed(2)" />
              </div>
            </section>

            <!-- Misc -->
            <section v-show="activeTab === 'misc'" class="tab-pane">
              <h3>杂项</h3>
              <div class="row toggle">
                <div class="label">隐藏播放控件</div>
                <button class="switch" :class="{ on: settings.hidePlayerControls }" @click="settings.hidePlayerControls = !settings.hidePlayerControls" />
              </div>
              <div class="row toggle">
                <div class="label">自动隐藏迷你信息</div>
                <button class="switch" :class="{ on: settings.autoHideMiniInfo }" @click="settings.autoHideMiniInfo = !settings.autoHideMiniInfo" />
              </div>
            </section>

            <!-- Experimental -->
            <section v-show="activeTab === 'experimental'" class="tab-pane">
              <h3>实验性 <span class="badge">beta</span></h3>
              <p class="hint-block">
                实验性功能可能不稳定，启用前请确认你已了解风险。
              </p>
              <div class="row toggle">
                <div class="label">
                  硬件加速
                  <small>使用 GPU 合成以提升动画流畅度</small>
                </div>
                <button class="switch" :class="{ on: settings.gpuAcceleration }" @click="settings.gpuAcceleration = !settings.gpuAcceleration" />
              </div>
              <div class="row toggle">
                <div class="label">
                  调试日志
                  <small>在控制台输出详细日志</small>
                </div>
                <button class="switch" :class="{ on: settings.debugLog }" @click="settings.debugLog = !settings.debugLog" />
              </div>
              <div class="row toggle">
                <div class="label">
                  跳过元数据校验
                  <small>对本地文件跳过 lofty 解析</small>
                </div>
                <button class="switch" :class="{ on: settings.skipMetadata }" @click="settings.skipMetadata = !settings.skipMetadata" />
              </div>
              <div class="row toggle">
                <div class="label">
                  低延迟模式
                  <small>减少动画时长以追求即时反馈</small>
                </div>
                <button class="switch" :class="{ on: settings.lowLatency }" @click="settings.lowLatency = !settings.lowLatency" />
              </div>
            </section>

            <!-- About -->
            <section v-show="activeTab === 'about'" class="tab-pane about">
              <h3>关于</h3>
              <div class="about-card">
                <div class="about-icon">
                  <Icon name="music" :size="42" />
                </div>
                <div class="about-info">
                  <div class="about-name">Zephyr · 音乐</div>
                  <div class="about-version">v{{ APP_VERSION }}</div>
                  <p class="about-desc">
                    受 Apple Music 与 Refined Now Playing 启发的桌面音乐播放器。
                    Tauri + Vue 3 + Rodio 后端。
                  </p>
                  <div class="about-meta">
                    <span>© 2025 Zephyr</span>
                    <a href="#" @click.prevent>GitHub</a>
                  </div>
                </div>
              </div>
              <button class="reset-btn" @click="resetAll">
                <Icon name="trash" :size="14" />
                <span>恢复默认设置</span>
              </button>
            </section>
          </div>
        </div>
      </div>
    </section>
  </Transition>
</template>

<style scoped>
/* Sidebar mode (in NowPlayingView): slides from right */
.settings-panel.mode-sidebar {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 420px;
  max-width: 100vw;
  z-index: 200;
  display: flex;
  background: var(--bg-elev-2);
  border-left: 1px solid var(--border);
  box-shadow: -16px 0 48px rgba(0, 0, 0, 0.5);
}

/* Modal mode (on home page): centered fullscreen overlay */
.settings-panel.mode-modal {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.mode-modal .panel-card {
  width: 760px;
  max-width: 92vw;
  height: 560px;
  max-height: 86vh;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 18px;
  box-shadow: var(--shadow-lg);
}

/* Transitions */
.panel-enter-active,
.panel-leave-active {
  transition: transform 0.3s var(--ease-out), opacity 0.3s var(--ease-out);
}
.mode-sidebar.panel-enter-from,
.mode-sidebar.panel-leave-to {
  transform: translateX(100%);
  opacity: 0;
}
.mode-modal.panel-enter-from,
.mode-modal.panel-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

.panel-card {
  flex: 1;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.panel-head h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.panel-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.tabs {
  width: 168px;
  flex-shrink: 0;
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-right: 1px solid var(--border);
  overflow-y: auto;
}
.tab {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  text-align: left;
  transition: color 0.15s, background 0.15s;
}
.tab:hover {
  color: var(--text);
  background: var(--bg-hover);
}
.tab.active {
  color: var(--accent);
  background: var(--accent-soft);
}

.content {
  flex: 1;
  padding: 18px 24px;
  overflow-y: auto;
}
.tab-pane h3 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}
.badge {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 2px 6px;
  border-radius: 4px;
}
.hint-block {
  margin: -8px 0 16px;
  padding: 10px 12px;
  background: var(--bg-elev-3);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 12px;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
  /* Allow rows to wrap on narrow panels (sidebar mode is only 420px wide).
     When the control doesn't fit next to the label, it wraps to a new line
     instead of overflowing the panel. */
  flex-wrap: wrap;
}
.row:last-child {
  border-bottom: none;
}
.row.subgroup {
  padding: 18px 0 6px;
  border-bottom: none;
  margin-top: 6px;
  flex-wrap: nowrap;
}
.row.subgroup .subgroup-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: var(--accent);
  text-transform: uppercase;
}
.row.toggle .label {
  font-size: 13px;
  color: var(--text);
}
.row .label {
  font-size: 13px;
  color: var(--text-secondary);
  /* Label never shrinks; the control wraps if it doesn't fit. */
  flex-shrink: 0;
  margin-right: auto;
}
.row .label small {
  display: block;
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}
.row-slider {
  /* Flexible width: fills available space, but capped so it doesn't get
     absurdly wide on the modal (760px) panel. min-width:0 lets it shrink
     below its intrinsic size. */
  flex: 1 1 140px;
  min-width: 120px;
  max-width: 240px;
}

.seg {
  display: inline-flex;
  background: var(--bg-elev-3);
  border-radius: 8px;
  padding: 2px;
  gap: 2px;
  /* Allow seg buttons to wrap on narrow panels instead of overflowing. */
  flex-wrap: wrap;
  /* Seg takes remaining space after the label, but can also wrap below it. */
  flex: 0 1 auto;
  max-width: 100%;
}
.seg.wrap { flex-wrap: wrap; }
.seg button {
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  transition: color 0.15s, background 0.15s;
  white-space: nowrap;
}
.seg button:hover { color: var(--text); }
.seg button.active {
  color: var(--text);
  background: var(--bg-active);
}

.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.swatch {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid transparent;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15);
  transition: transform 0.15s, border-color 0.15s;
}
.swatch:hover { transform: scale(1.1); }
.swatch.active {
  border-color: #fff;
  transform: scale(1.1);
}
.swatch.custom {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-elev-3);
  color: var(--text-tertiary);
  overflow: hidden;
  cursor: pointer;
}
.swatch.custom input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.switch {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background: var(--bg-elev-3);
  border: 1px solid var(--border);
  transition: background 0.18s var(--ease-out), border-color 0.18s var(--ease-out);
}
.switch::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--text-secondary);
  transition: transform 0.18s var(--ease-out), background 0.18s var(--ease-out);
}
.switch.on {
  background: var(--accent);
  border-color: transparent;
}
.switch.on::after {
  background: #fff;
  transform: translateX(18px);
}

.about-card {
  display: flex;
  gap: 18px;
  padding: 18px;
  background: var(--bg-elev-3);
  border-radius: 12px;
  margin-bottom: 16px;
}
.about-icon {
  width: 70px;
  height: 70px;
  border-radius: 14px;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.about-info { flex: 1; }
.about-name {
  font-size: 18px;
  font-weight: 700;
}
.about-version {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 2px;
}
.about-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 10px 0;
  line-height: 1.6;
}
.about-meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.about-meta a {
  color: var(--accent);
  text-decoration: none;
}

.reset-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.reset-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}

@media (max-width: 720px) {
  .panel-card {
    width: 96vw;
    height: 88vh;
  }
  .panel-body {
    flex-direction: column;
  }
  .tabs {
    width: 100%;
    height: auto;
    flex-direction: row;
    overflow-x: auto;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
  .tab span { white-space: nowrap; }
  .row-slider { width: 140px; }
}
</style>
