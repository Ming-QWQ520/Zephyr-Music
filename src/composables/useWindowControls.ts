/**
 * 窗口控制逻辑（从 App.vue 提取）
 * 最小化 / 最大化切换 / 关闭
 */
import { log } from "@/composables/logger";

export function useWindowControls() {
  async function minimizeWindow() {
    try {
      const mod = await import("@tauri-apps/api/window");
      const w = mod.getCurrentWindow?.() ?? (mod as any).window?.();
      if (w) await w.minimize();
    } catch (e) {
      log.warn("app", "minimize failed", { error: String(e) });
    }
  }

  async function toggleMaximize() {
    try {
      const mod = await import("@tauri-apps/api/window");
      const w = mod.getCurrentWindow?.() ?? (mod as any).window?.();
      if (w) await w.toggleMaximize();
    } catch (e) {
      log.warn("app", "toggleMaximize failed", { error: String(e) });
    }
  }

  async function closeWindow() {
    try {
      const mod = await import("@tauri-apps/api/window");
      const w = mod.getCurrentWindow?.() ?? (mod as any).window?.();
      if (w) await w.close();
    } catch (e) {
      log.warn("app", "close failed", { error: String(e) });
    }
  }

  return { minimizeWindow, toggleMaximize, closeWindow };
}
