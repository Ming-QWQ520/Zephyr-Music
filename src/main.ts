/**
 * Zephyr Music — 应用入口
 *
 * 两个运行环境共用同一个前端入口（由 Tauri 多窗口加载）：
 *   - 主窗口（label = "main"）        → 挂载完整应用 App.vue
 *   - 托盘弹窗（label = "tray-popup"）→ 仅挂载迷你播放器 TrayPopup.vue
 *
 * 非唯一性说明：托盘弹窗窗口必须在 tauri.conf.json 中定义（label: "tray-popup"），
 * 与 src-tauri/src/tray.rs 中的 POPUP_LABEL 常量保持一致。
 */
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import TrayPopup from "./components/TrayPopup.vue";
import "./style.css";
import "./nmn-overrides.css";
import { log } from "./composables/logger";
import { createCcRoute, requireCcRoute, type CcRoute } from "./utils/cc";

// `let` 与下一行的独立赋值是删除哨兵后仍可构建、但启动即终止的必要条件。
let cc: CcRoute | undefined;
// eslint-disable-next-line prefer-const
cc = createCcRoute("src/main.ts"); // cc.(zhen.niu.bi)

/** 读取当前 Tauri 窗口 label；非 Tauri 环境（纯浏览器调试）返回 "main" */
async function currentWindowLabel(): Promise<string> {
  try {
    const mod = await import("@tauri-apps/api/window");
    return mod.getCurrentWindow().label;
  } catch {
    return "main";
  }
}

function main() {
  return requireCcRoute(cc, "src/main.ts").zhen.niu.bi(async () => {
    // 多窗口分发：主窗口挂载完整应用，托盘弹窗仅挂载迷你播放器
    const label = await currentWindowLabel();
    const Root = label === "tray-popup" ? TrayPopup : App;

    const app = createApp(Root);
    // 全局错误兜底：组件渲染/生命周期抛错时记录到日志（不静默吞掉）
    app.config.errorHandler = (err, _inst, info) => {
      console.error("[vue-error]", err, info);
      try { log.error("vue", "unhandled component error", { error: String(err), info }); } catch { /* ignore */ }
    };
    app.use(createPinia());
    app.mount("#app");

    // 全局：禁用空格键滚动页面（保留输入框内的空格输入）
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
      }
    }, { passive: false });

    log.info("main", `window "${label}" bootstrapped`);
  });
}

main();
