/**
 * 窗口活动状态 composable（模块级单例 —— 每个 Tauri 窗口/WebView 各一份）
 *
 * 用途：低配机型性能优化。窗口未聚焦且未置顶（或窗口被隐藏，如关闭到托盘）时，
 * 用户看不到播放界面的歌词，可暂停歌词滚动与渲染以节省 CPU/GPU；
 * 窗口聚焦或置顶（always-on-top，悬浮于其他窗口之上仍然可见）时恢复渲染。
 *
 * windowActive = 窗口可见（未被隐藏）&&（已聚焦 || 置顶）
 *   - 聚焦：用户正在查看本窗口 → 渲染
 *   - 置顶：即使未聚焦，窗口仍悬浮在最上层可见 → 渲染
 *   - 隐藏（关闭到托盘/最小化到任务栏隐藏）：不可见 → 不渲染
 */
import { ref, computed } from "vue";

const isFocused = ref(true);
const docVisible = ref(typeof document === "undefined" ? true : !document.hidden);
const isTopmost = ref(false);
let started = false;

function onVisibilityChange() {
  docVisible.value = !document.hidden;
}

async function start() {
  if (started) return;
  started = true;
  document.addEventListener("visibilitychange", onVisibilityChange);
  try {
    // Tauri 环境：原生级焦点事件 + 置顶状态（动态导入保持 web 开发模式可用）
    const mod = await import("@tauri-apps/api/window");
    const win = mod.getCurrentWindow();
    const unlisten = await win.onFocusChanged(({ payload }) => {
      isFocused.value = payload;
    });
    void unlisten; // 单例全生命周期监听，无需 unlisten
    try {
      isTopmost.value = await win.isAlwaysOnTop();
    } catch { /* 老版本 webview 无此 API 时忽略 */ }
  } catch {
    // 非 Tauri 环境（web 开发模式）降级：DOM 焦点事件近似模拟
    window.addEventListener("blur", () => { isFocused.value = false; });
    window.addEventListener("focus", () => { isFocused.value = true; });
  }
}

export function useWindowActivity() {
  void start();
  /** 窗口是否处于"值得渲染"状态（可见 且 聚焦/置顶） */
  const windowActive = computed(() => docVisible.value && (isFocused.value || isTopmost.value));
  return { isFocused, docVisible, isTopmost, windowActive };
}
