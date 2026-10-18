/**
 * useTray — 系统托盘前端桥接 composable
 *
 * 职责：
 *   - 调用 Rust 端 `update_tray_tooltip` 命令，在切歌 / 播放状态变化时
 *     同步托盘 tooltip（"▶ 歌名 - 歌手" / "⏸ 歌名 - 歌手"）
 *     （托盘图标保持应用默认 icon，不做动态封面替换）
 *   - 通过 Tauri 事件向 tray-popup 窗口推送播放状态（歌曲/封面/进度/播放状态）
 *   - 监听 tray-popup 窗口发来的 player-action 事件，执行播放控制
 *   - 监听 tray-popup-shown 事件，popup 显示时立即推送一次完整状态
 *
 * 触发时机（由 App.vue 在 onMounted 中调用 initTray()）：
 *   - store.currentSong 变化时 → 更新 tooltip + 推送状态到 popup
 *   - store.isPlaying 变化时 → 更新 tooltip + 推送状态到 popup
 *   - store.currentTime 变化时 → 节流推送进度到 popup（~1s 一次）
 *
 * 单例生命周期：第一次调用 useTray() 时懒创建，watchers 永不卸载
 * （单例 scope，与 useNowPlaying / useMediaSession 一致）。
 *
 * 跨平台说明：
 *   - Windows / macOS：tooltip 单行显示，左键切换窗口，右键弹出 popup
 *   - Linux：右键事件可能不触发，但 tooltip + 左键功能可用
 *   - 非 Tauri 环境（如纯浏览器调试）：所有 invoke 调用会失败，安静降级
 */
import { watch, effectScope } from "vue";
import { usePlayerStore } from "@/stores/player";
import { log } from "@/composables/logger";
import { _cachedUser } from "@/api/netease/core";

const TAG = "tray";

// ===== 单例 =====
let _api: TrayApi | null = null;
const _singletonScope = effectScope(true);

/** 由 App.vue 在启动时调用一次，激活单例并绑定 watchers。 */
export function initTray(): TrayApi {
  if (!_api) {
    _singletonScope.run(() => {
      _api = createApi();
    });
  }
  return _api!;
}

export function destroyTray() {
  _api?.dispose();
  _api = null;
}

export interface TrayApi {
  /** 手动触发一次托盘 tooltip 刷新 */
  refresh: () => void;
  /** 退出应用：设置退出标记 → 关闭窗口（onCloseRequested 检测到标记直接 destroy） */
  quitApp: () => Promise<void>;
  /** 销毁单例（仅 HMR / 测试使用） */
  dispose: () => void;
}

/** 推送给 tray-popup 的播放状态 payload */
interface PlayerStatePayload {
  song: {
    name: string;
    artist: string;
    pic: string;
  } | null;
  isPlaying: boolean;
  /** 当前登录的网易云账户昵称（未登录则为 null） */
  accountName: string | null;
}

function createApi(): TrayApi {
  const store = usePlayerStore();

  /** 计算 tooltip 文本：▶/⏸ 歌名 - 歌手 */
  function buildTooltip(): string {
    const song = store.currentSong;
    if (!song) return "Zephyr · 音乐";
    const title = song.name || "未知歌曲";
    const artist = song.artist || "";
    const state = store.isPlaying ? "▶" : "⏸";
    return artist ? `${state} ${title} - ${artist}` : `${state} ${title}`;
  }

  /** 调用 Rust 命令更新托盘 tooltip（仅 tooltip，不更新图标） */
  async function updateTrayTooltip(tooltip: string) {
    try {
      const mod = await import("@tauri-apps/api/core");
      await mod.invoke("update_tray_tooltip", { tooltip });
      log.debug(TAG, "tooltip updated", { tooltip });
    } catch (e) {
      // 非 Tauri 环境（浏览器调试）会抛 "command not found"，静默降级
      log.debug(TAG, "update_tray_tooltip skipped", { error: String(e) });
    }
  }

  /** 构建推送给 tray-popup 的播放状态 payload */
  function buildPlayerStatePayload(): PlayerStatePayload {
    const song = store.currentSong;
    const accountName = _cachedUser.value?.nickname || null;
    if (!song) {
      return { song: null, isPlaying: store.isPlaying, accountName };
    }
    // 封面 URL：用 200x200 清晰度（popup 封面仅 72x72）
    let pic = song.pic || "";
    if (pic && pic.includes("music.126.net")) {
      pic = pic.replace(/\?param=\d+x\d+/g, "") + "?param=200x200";
    }
    return {
      song: { name: song.name || "未知歌曲", artist: song.artist || "", pic },
      isPlaying: store.isPlaying,
      accountName,
    };
  }

  /** 向 tray-popup 窗口推送播放状态（通过 emitTo 定向发送） */
  async function pushPlayerState() {
    try {
      const { emitTo } = await import("@tauri-apps/api/event");
      const payload = buildPlayerStatePayload();
      // emitTo(target, event, payload) — target 可以是窗口标签字符串
      await emitTo("tray-popup", "player-state", payload);
      log.debug(TAG, "player-state pushed to popup", {
        song: payload.song?.name,
        isPlaying: payload.isPlaying,
      });
    } catch (e) {
      // tray-popup 窗口未打开时 emitTo 仍会成功（事件只是没人接收）
      log.debug(TAG, "push player-state skipped", { error: String(e) });
    }
  }

  /** 处理 tray-popup 发来的播放控制动作 */
  async function handlePlayerAction(payload: any) {
    const action = payload?.action as string;
    log.info(TAG, "player-action received from popup", { action });
    switch (action) {
      case "togglePlay":
        store.togglePlay();
        break;
      case "next":
        void store.next();
        break;
      case "prev":
        void store.prev();
        break;
      case "seek":
        if (typeof payload.seekTime === "number") {
          store.seek(payload.seekTime);
        }
        break;
      case "showMain":
        // 显示主窗口
        try {
          const winMod = await import("@tauri-apps/api/window");
          const w = winMod.getCurrentWindow?.() ?? (winMod as any).window?.();
          if (w) {
            await w.show();
            await w.unminimize();
            await w.setFocus();
          }
        } catch (e) {
          log.warn(TAG, "showMain failed", { error: String(e) });
        }
        break;
      case "quit":
        // 退出应用：先隐藏 popup，再触发主窗口退出流程
        try {
          const coreMod = await import("@tauri-apps/api/core");
          await coreMod.invoke("hide_tray_popup").catch(() => {});
        } catch { /* ignore */ }
        await quitApp();
        break;
      case "request-state":
        // popup 刚打开，请求一次完整状态推送
        await pushPlayerState();
        break;
    }
  }

  /** 监听 tray-popup 发来的 player-action 事件 */
  let unlistenAction: (() => void) | null = null;
  async function setupActionListener() {
    try {
      const eventMod = await import("@tauri-apps/api/event");
      unlistenAction = await eventMod.listen("player-action", (event) => {
        void handlePlayerAction(event.payload);
      });
    } catch (e) {
      log.warn(TAG, "failed to setup player-action listener", { error: String(e) });
    }
  }

  /** 监听 tray-popup-shown 事件（Rust 端在显示 popup 时 emit） */
  let unlistenPopupShown: (() => void) | null = null;
  async function setupPopupShownListener() {
    try {
      const eventMod = await import("@tauri-apps/api/event");
      unlistenPopupShown = await eventMod.listen("tray-popup-shown", () => {
        log.info(TAG, "tray-popup shown, pushing state");
        void pushPlayerState();
      });
    } catch (e) {
      log.warn(TAG, "failed to setup popup-shown listener", { error: String(e) });
    }
  }

  /** 手动刷新 tooltip + 推送状态 */
  function refresh() {
    void updateTrayTooltip(buildTooltip());
    void pushPlayerState();
  }

  /** 退出应用：调用 Rust quit_app 命令（移除托盘 + 退出进程） */
  async function quitApp() {
    try {
      try { store.saveSession(); } catch { /* ignore */ }
      const coreMod = await import("@tauri-apps/api/core");
      await coreMod.invoke("quit_app");
      log.info(TAG, "app quit via quit_app command");
    } catch (e) {
      log.warn(TAG, "quitApp failed", { error: String(e) });
    }
  }

  // ===== 应用级 watchers =====

  // 1) 当前歌曲变化 → 更新 tooltip + 推送状态到 popup
  watch(
    () => store.currentSong,
    () => {
      void updateTrayTooltip(buildTooltip());
      void pushPlayerState();
    },
    { immediate: true }
  );

  // 2) 封面 URL 异步就绪后刷新（网易云歌曲 pic 可能稍后才补全）
  watch(
    () => store.currentSong?.pic,
    () => {
      void pushPlayerState();
    }
  );

  // 3) 播放状态变化 → 更新 tooltip + 推送状态到 popup
  watch(
    () => store.isPlaying,
    () => {
      void updateTrayTooltip(buildTooltip());
      void pushPlayerState();
    }
  );

  // 4) 账户登录/登出变化 → 推送状态（更新 popup 中的账户名显示）
  watch(
    () => _cachedUser.value?.nickname,
    () => {
      void pushPlayerState();
    }
  );

  // 启动事件监听
  void setupActionListener();
  void setupPopupShownListener();

  log.info(TAG, "useTray initialized");

  return {
    refresh,
    quitApp,
    dispose: () => {
      if (unlistenAction) unlistenAction();
      if (unlistenPopupShown) unlistenPopupShown();
    },
  };
}

/** 在 Vue 组件中使用：返回单例 API（如果尚未初始化则懒创建）。 */
export function useTray(): TrayApi {
  if (!_api) initTray();
  return _api!;
}
