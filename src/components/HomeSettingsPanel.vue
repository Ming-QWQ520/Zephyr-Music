<script setup lang="ts">
/**
 * 首页设置面板（与播放界面设置 SettingsPanel.vue 完全独立）
 *
 * 仅影响首页/侧边栏/标题栏区域。包含：
 *  - 背景设置：自定义全屏壁纸（覆盖标题栏）、模糊、变暗
 *  - 主题色（首页独立）
 *  - 字体缩放
 *  - 侧边栏透明
 */
import { ref, onMounted } from "vue";
import Icon from "@/components/Icon.vue";
import Slider from "@/components/Slider.vue";
import { useHomeSettings } from "@/composables/useHomeSettings";
import { useToast } from "@/composables/useToast";
const toast = useToast();

const props = withDefaults(defineProps<{
  visible: boolean;
}>(), {
  visible: false,
});

const emit = defineEmits<{
  (e: "close"): void;
}>();

const { settings, defaults } = useHomeSettings();

const ACCENT_PRESETS = ["#fa233b", "#ff6b35", "#ffd23f", "#06d6a0", "#118ab2", "#9d4edd", "#ef476f", "#073b4c"];

function resetAll() {
  Object.assign(settings, defaults);
}

/** 选择本地图片作为壁纸 */
async function pickWallpaper() {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const file = await open({
      multiple: false,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] }],
    });
    if (typeof file === "string") {
      // Tauri 2: 用 convertFileSrc 把本地路径转成 asset:// 协议 URL
      // CSP 允许 http://asset.localhost / https://asset.localhost
      let url = file;
      if (!file.startsWith("http") && !file.startsWith("data:") && !file.startsWith("asset:")) {
        try {
          const { convertFileSrc } = await import("@tauri-apps/api/core");
          url = convertFileSrc(file);
        } catch {
          url = `localfile://${file}`;
        }
      }
      settings.bgImage = url;
      settings.bgType = "image";
      toast.success("壁纸已设置", "背景将覆盖整个窗口");
    }
  } catch (e) {
    // 非 tauri 环境（浏览器预览）用 input file
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        settings.bgImage = reader.result as string;
        settings.bgType = "image";
        toast.success("壁纸已设置", "背景将覆盖整个窗口");
      };
      reader.readAsDataURL(f);
    };
    input.click();
  }
}

function clearWallpaper() {
  settings.bgImage = "";
  settings.bgType = "none";
}

function useUrlWallpaper() {
  const url = prompt("输入图片 URL：");
  if (url && url.trim()) {
    settings.bgImage = url.trim();
    settings.bgType = "image";
    toast.success("壁纸已设置", "背景将覆盖整个窗口");
  }
}
</script>

<template>
  <Transition name="home-panel">
    <section v-if="visible" class="home-settings-overlay" @click.self="emit('close')">
      <div class="home-settings-card">
        <header class="hs-head">
          <div class="hs-title">
            <Icon name="settings" :size="18" />
            <h2>首页设置</h2>
          </div>
          <button class="hs-close" title="关闭" @click="emit('close')">
            <Icon name="close" :size="18" />
          </button>
        </header>

        <div class="hs-body nice-scroll">
          <!-- 背景 -->
          <section class="hs-section">
            <h3>背景壁纸</h3>
            <p class="hs-hint">自定义全屏壁纸，覆盖整个窗口（含标题栏）。</p>

            <div class="hs-row">
              <div class="hs-label">背景类型</div>
              <div class="hs-seg">
                <button
                  v-for="m in ['none', 'image'] as const"
                  :key="m"
                  :class="{ active: settings.bgType === m }"
                  @click="settings.bgType = m"
                >{{ m === 'none' ? '无' : '壁纸' }}</button>
              </div>
            </div>

            <!-- 壁纸预览 + 操作 -->
            <div v-if="settings.bgType === 'image'" class="wallpaper-block">
              <div class="wallpaper-preview">
                <img v-if="settings.bgImage" :src="settings.bgImage" :style="{ objectFit: settings.bgFit, filter: `blur(${settings.bgBlur}px) brightness(${1 - settings.bgDim / 100 * 0.7})` }" @error="(e: any) => e.target.style.display='none'" />
                <div v-if="!settings.bgImage" class="wallpaper-empty">
                  <Icon name="image" :size="32" />
                  <span>未设置壁纸</span>
                </div>
              </div>
              <div class="wallpaper-actions">
                <button class="hs-btn primary" @click="pickWallpaper">
                  <Icon name="folder" :size="14" /><span>选择本地图片</span>
                </button>
                <button class="hs-btn" @click="useUrlWallpaper">
                  <Icon name="link" :size="14" /><span>使用 URL</span>
                </button>
                <button v-if="settings.bgImage" class="hs-btn danger" @click="clearWallpaper">
                  <Icon name="trash" :size="14" /><span>清除</span>
                </button>
              </div>
            </div>

            <div v-if="settings.bgType === 'image'" class="hs-row">
              <div class="hs-label">缩放模式</div>
              <div class="hs-seg">
                <button
                  v-for="m in ['cover', 'contain'] as const"
                  :key="m"
                  :class="{ active: settings.bgFit === m }"
                  @click="settings.bgFit = m"
                >{{ m === 'cover' ? '填充' : '适应' }}</button>
              </div>
            </div>

            <div v-if="settings.bgType === 'image'" class="hs-row">
              <div class="hs-label">壁纸模糊</div>
              <Slider class="row-slider" :model-value="settings.bgBlur / 60" :format="(v) => `${Math.round(v * 60)}px`" @change="(v) => settings.bgBlur = Math.round(v * 60)" />
            </div>

            <div v-if="settings.bgType === 'image'" class="hs-row">
              <div class="hs-label">壁纸变暗</div>
              <Slider class="row-slider" :model-value="settings.bgDim / 100" :format="(v) => `${Math.round(v * 100)}%`" @change="(v) => settings.bgDim = Math.round(v * 100)" />
            </div>

            <div v-if="settings.bgType === 'image'" class="hs-row toggle">
              <div class="hs-label">侧边栏透明（壁纸透出）</div>
              <button class="switch" :class="{ on: settings.transparentSidebar }" @click="settings.transparentSidebar = !settings.transparentSidebar" />
            </div>
          </section>

          <!-- 主题色 -->
          <section class="hs-section">
            <h3>主题色（首页）</h3>
            <p class="hs-hint">仅影响首页、侧边栏、标题栏。播放界面主题色在播放界面的设置中单独配置。</p>
            <div class="hs-row">
              <div class="hs-label">颜色</div>
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
          </section>

          <!-- 字体 -->
          <section class="hs-section">
            <h3>字体</h3>
            <div class="hs-row">
              <div class="hs-label">字体缩放</div>
              <Slider class="row-slider" :model-value="(settings.fontScale - 0.8) / 0.6" :format="(v) => `${(0.8 + v * 0.6).toFixed(2)}x`" @change="(v) => settings.fontScale = +(0.8 + v * 0.6).toFixed(2)" />
            </div>
          </section>

          <!-- 重置 -->
          <section class="hs-section">
            <button class="hs-btn danger full" @click="resetAll">
              <Icon name="trash" :size="14" /><span>恢复默认设置</span>
            </button>
          </section>

          <div class="hs-footer-hint">
            <Icon name="info" :size="12" />
            <span>首页设置与播放界面设置互相独立，互不影响。</span>
          </div>
        </div>
      </div>
    </section>
  </Transition>
</template>

<style scoped>
.home-settings-overlay {
  position: fixed; inset: 0; z-index: 900;
  background: rgba(0,0,0,0.4); backdrop-filter: blur(6px);
  display: flex; align-items: stretch; justify-content: stretch;
}
.home-settings-card {
  width: 100%; max-width: 100%; height: 100%; max-height: 100%;
  background: var(--bg-elev-3); border: none; border-radius: 0;
  box-shadow: none;
  display: flex; flex-direction: column; overflow: hidden;
}
.hs-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.hs-title { display: flex; align-items: center; gap: 10px; color: var(--text); }
.hs-title h2 { margin: 0; font-size: 17px; font-weight: 700; }
.hs-close { color: var(--text-tertiary); transition: color 0.15s; }
.hs-close:hover { color: var(--text); }
.hs-body { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 24px; }

.hs-section { display: flex; flex-direction: column; gap: 12px; }
.hs-section h3 { margin: 0; font-size: 14px; font-weight: 700; color: var(--text); }
.hs-hint { margin: 0; font-size: 11px; color: var(--text-tertiary); line-height: 1.5; }

.hs-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 32px; }
.hs-row.toggle { padding: 4px 0; }
.hs-label { font-size: 13px; color: var(--text-secondary); flex-shrink: 0; }
.hs-seg { display: flex; gap: 2px; background: var(--bg-elev-1); border-radius: 8px; padding: 2px; }
.hs-seg button {
  padding: 6px 14px; font-size: 12px; color: var(--text-secondary);
  border-radius: 6px; transition: all 0.15s;
}
.hs-seg button:hover { color: var(--text); }
.hs-seg button.active { background: var(--accent); color: #fff; font-weight: 600; }

.swatches { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.swatch {
  width: 24px; height: 24px; border-radius: 50%; cursor: pointer;
  border: 2px solid transparent; transition: transform 0.12s, border-color 0.12s;
}
.swatch:hover { transform: scale(1.12); }
.swatch.active { border-color: var(--text); }
.swatch.custom { background: var(--bg-elev-1); border: 1px dashed var(--border-strong); position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); }
.swatch.custom input[type="color"] { position: absolute; inset: 0; opacity: 0; cursor: pointer; }

.row-slider { width: 160px; }

.switch { width: 40px; height: 22px; border-radius: 11px; background: var(--bg-elev-1); border: 1px solid var(--border); position: relative; transition: background 0.2s, border-color 0.2s; cursor: pointer; flex-shrink: 0; }
.switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--text-tertiary); transition: transform 0.2s, background 0.2s; }
.switch.on { background: var(--accent); border-color: var(--accent); }
.switch.on::after { transform: translateX(18px); background: #fff; }

.wallpaper-block { display: flex; flex-direction: column; gap: 10px; }
.wallpaper-preview {
  width: 100%; height: 140px; border-radius: 10px;
  background-color: var(--bg-elev-1);
  border: 1px solid var(--border); overflow: hidden; position: relative;
}
.wallpaper-preview img { width: 100%; height: 100%; object-position: center; display: block; }
.wallpaper-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--text-tertiary); font-size: 12px; }
.wallpaper-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.hs-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 8px; font-size: 12px;
  background: var(--bg-elev-1); border: 1px solid var(--border);
  color: var(--text-secondary); transition: all 0.15s;
}
.hs-btn:hover { color: var(--text); border-color: var(--border-strong); background: var(--bg-elev-2); }
.hs-btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.hs-btn.primary:hover { opacity: 0.9; color: #fff; }
.hs-btn.danger { color: #ff4d4f; border-color: rgba(255,77,79,0.3); }
.hs-btn.danger:hover { background: rgba(255,77,79,0.1); border-color: #ff4d4f; }
.hs-btn.full { width: 100%; justify-content: center; }

.hs-footer-hint { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-tertiary); padding-top: 8px; border-top: 1px solid var(--border); }

.home-panel-enter-active, .home-panel-leave-active { transition: opacity 0.18s; }
.home-panel-enter-active .home-settings-card, .home-panel-leave-active .home-settings-card { transition: transform 0.18s, opacity 0.18s; }
.home-panel-enter-from, .home-panel-leave-to { opacity: 0; }
.home-panel-enter-from .home-settings-card, .home-panel-leave-to .home-settings-card { transform: scale(0.96); opacity: 0; }
</style>
