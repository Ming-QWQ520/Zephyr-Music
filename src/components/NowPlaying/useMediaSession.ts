/**
 * useMediaSession — 浏览器媒体控制（Media Session API）单例 composable
 *
 * 设计参照 util/music/music.js 中的 Media Session 实现，并适配 Zephyr 的
 * Pinia player store + useSettings 响应式架构：
 *
 *   - updateMediaSession(song, coverUrl)        设置元数据 + 注册 action handlers
 *   - setMediaSessionHandlers()                 注册 play/pause/prev/next/stop/seekto 等回调
 *   - updateMediaSessionPlaybackState(playing)  同步播放状态到系统媒体控件
 *   - clearMediaSession()                       清空元数据与状态
 *
 * 触发时机（由 App.vue 在 onMounted 中调用 initMediaSession()）：
 *   - store.currentSong 变化时 → 重新设置元数据（标题/艺术家/封面）
 *   - store.isPlaying 变化时 → 同步 playbackState
 *   - store.currentTime 变化时 → 更新位置状态（positionState），让系统媒体控件进度条联动
 *   - settings.mediaSessionEnabled 变化时 → 开启时绑定、关闭时解绑并清空
 *
 * 单例生命周期：第一次调用 useMediaSession() 时懒创建，watchers 永不卸载
 * （单例 scope，与 useNowPlaying 一致），只 watch 应用级状态。
 */
import { watch, effectScope } from "vue";
import { usePlayerStore } from "@/stores/player";
import { useSettings } from "@/composables/useSettings";
import { log } from "@/composables/logger";
import type { Song } from "@/types";

const TAG = "media-session";

/** Media Session 支持的 action 类型（取自标准 W3C 规范） */
type MediaSessionAction =
  | "play"
  | "pause"
  | "previoustrack"
  | "nexttrack"
  | "stop"
  | "seekbackward"
  | "seekforward"
  | "seekto"
  | "seekrelative"
  | "togglemicrophone"
  | "togglecamera"
  | "hangup"
  | "previousslide"
  | "nextslide"
  | "skipad"
  | "pausead";

interface MediaSessionActionDetails {
  action: MediaSessionAction;
  seekTime?: number | null;
  seekOffset?: number | null;
  fastSeek?: boolean | null;
}

function getMediaSession(): MediaSession | null {
  if (typeof navigator === "undefined") return null;
  const ms = (navigator as any).mediaSession as MediaSession | undefined;
  return ms ?? null;
}

/** 是否支持 Media Session API */
export function isMediaSessionSupported(): boolean {
  return !!getMediaSession();
}

// ===== 单例 =====
let _api: MediaSessionApi | null = null;
const _singletonScope = effectScope(true);

/** 由 App.vue 在启动时调用一次，激活单例并绑定 watchers。
 *  - 受 settings.mediaSessionEnabled 控制：关闭时不绑定 handlers、清空元数据。
 *  - 重复调用安全（幂等）。 */
export function initMediaSession(): MediaSessionApi {
  if (!_api) {
    _singletonScope.run(() => {
      _api = createApi();
    });
  }
  return _api!;
}

/** 销毁单例（仅在测试 / HMR 中使用，运行时不调用） */
export function destroyMediaSession() {
  _api?.dispose();
  _api = null;
}

export interface MediaSessionApi {
  /** 显式更新元数据（一般在切歌后立即调用） */
  updateMetadata: (song: Song | null, coverUrl?: string) => void;
  /** 显式更新播放状态 */
  updatePlaybackState: (playing: boolean) => void;
  /** 显式更新进度位置状态（系统媒体控件进度条） */
  updatePositionState: () => void;
  /** 清空 Media Session（停止播放 / 退出时调用） */
  clear: () => void;
  /** 重新绑定 / 解绑 action handlers（设置开关变化时调用） */
  syncHandlers: () => void;
  /** 销毁：解绑所有 handlers、清空元数据 */
  dispose: () => void;
}

function createApi(): MediaSessionApi {
  const store = usePlayerStore();
  const { settings } = useSettings();

  let handlersRegistered = false;
  /** 上次更新元数据使用的歌曲 ID，避免重复设置触发系统通知抖动 */
  let lastMetadataSongId: string | null = null;

  // ---------- 工具函数 ----------

  /** 将任意封面 URL 规范化为系统媒体控件可识别的 artwork 列表。
   *  - 网络 URL / data URL：直接使用
   *  - 相对路径 / file:// 等：浏览器中无法直接访问，跳过（避免 console 报错） */
  function buildArtwork(coverUrl?: string): MediaImage[] {
    if (!coverUrl) return [];
    // 网络串流 URL（http/https）与 data: 内嵌图片可直接使用
    if (
      coverUrl.startsWith("http://") ||
      coverUrl.startsWith("https://") ||
      coverUrl.startsWith("data:")
    ) {
      // 尝试识别类型
      let type = "image/png";
      if (coverUrl.startsWith("data:")) {
        const m = coverUrl.match(/^data:([^;,]+)/);
        if (m) type = m[1];
      } else if (coverUrl.includes(".jpg") || coverUrl.includes(".jpeg")) {
        type = "image/jpeg";
      } else if (coverUrl.includes(".webp")) {
        type = "image/webp";
      } else if (coverUrl.includes(".gif")) {
        type = "image/gif";
      }
      // 提供多个尺寸，让系统按需选择最合适的（这里用一个尺寸即可，
      // 真实尺寸由浏览器加载后确定；512x512 是常见的封面规格）
      return [{ src: coverUrl, sizes: "512x512", type }];
    }
    // 其他协议（file://、相对路径、blob URL 等）：浏览器/Tauri 中可能可访问，
    // 但 Media Session 对其支持不稳定，先尝试一次，失败由浏览器忽略
    try {
      return [{ src: coverUrl, sizes: "512x512", type: "image/png" }];
    } catch {
      return [];
    }
  }

  // ---------- 元数据 ----------
  function updateMetadata(song: Song | null, coverUrl?: string) {
    if (!settings.mediaSessionEnabled) return;
    const ms = getMediaSession();
    if (!ms) {
      log.warn(TAG, "Media Session API not supported, skip metadata update");
      return;
    }
    if (!song) {
      clear();
      return;
    }
    // 同一首歌不重复设置（避免每次 timeupdate 触发都重写元数据）
    if (lastMetadataSongId === song.id && ms.metadata) return;
    lastMetadataSongId = song.id;

    const metadata = {
      title: song.name || "未知歌曲",
      artist: song.artist || "",
      artwork: buildArtwork(coverUrl),
    };
    try {
      ms.metadata = new MediaMetadata(metadata);
      log.info(TAG, "metadata set", {
        title: metadata.title,
        artist: metadata.artist,
        hasArtwork: metadata.artwork.length > 0,
      });
    } catch (e) {
      log.warn(TAG, "MediaMetadata construction failed", { error: String(e), metadata });
    }

    // 元数据设置后立即注册 handlers（只注册一次）
    if (!handlersRegistered) {
      registerHandlers();
    }
    // 元数据就绪后同步一次位置状态
    updatePositionState();
  }

  // ---------- 播放状态 ----------
  function updatePlaybackState(playing: boolean) {
    if (!settings.mediaSessionEnabled) return;
    const ms = getMediaSession();
    if (!ms) return;
    const state: MediaSessionPlaybackState = playing ? "playing" : "paused";
    try {
      ms.playbackState = state;
      log.info(TAG, "playbackState set", { state });
    } catch (e) {
      log.warn(TAG, "set playbackState failed", { error: String(e) });
    }
  }

  // ---------- 位置状态（进度条） ----------
  function updatePositionState() {
    if (!settings.mediaSessionEnabled) return;
    const ms = getMediaSession();
    if (!ms || typeof ms.setPositionState !== "function") return;
    const duration = store.duration;
    const position = store.currentTime;
    // duration 无效或为 0 时不能调用 setPositionState（会抛错）
    if (!isFinite(duration) || duration <= 0) return;
    if (!isFinite(position) || position < 0 || position > duration) return;
    try {
      ms.setPositionState({
        duration,
        position,
        playbackRate: 1,
      });
      log.debug(TAG, "positionState updated", { duration, position });
    } catch (e) {
      // 部分浏览器在 position > duration 时会抛 InvalidStateError，忽略
      log.debug(TAG, "setPositionState skipped", { error: String(e), duration, position });
    }
  }

  // ---------- Action Handlers ----------
  /** 注册所有支持的 action handlers。多次调用安全：先解绑再重绑。 */
  function registerHandlers() {
    const ms = getMediaSession();
    if (!ms || typeof ms.setActionHandler !== "function") return;

    // play / pause
    try {
      ms.setActionHandler("play", () => {
        log.info(TAG, "action: play");
        if (!store.isPlaying) store.togglePlay();
      });
    } catch (e) { log.warn(TAG, "setActionHandler play failed", { error: String(e) }); }

    try {
      ms.setActionHandler("pause", () => {
        log.info(TAG, "action: pause");
        if (store.isPlaying) store.togglePlay();
      });
    } catch (e) { log.warn(TAG, "setActionHandler pause failed", { error: String(e) }); }

    // prev / next
    try {
      ms.setActionHandler("previoustrack", () => {
        log.info(TAG, "action: previoustrack");
        store.prev();
      });
    } catch (e) { log.warn(TAG, "setActionHandler previoustrack failed", { error: String(e) }); }

    try {
      ms.setActionHandler("nexttrack", () => {
        log.info(TAG, "action: nexttrack");
        store.next();
      });
    } catch (e) { log.warn(TAG, "setActionHandler nexttrack failed", { error: String(e) }); }

    // stop
    try {
      ms.setActionHandler("stop", () => {
        log.info(TAG, "action: stop");
        // Zephyr 没有显式的 stop action：暂停 + 进度归零
        if (store.isPlaying) store.togglePlay();
        store.seek(0);
      });
    } catch (e) { log.warn(TAG, "setActionHandler stop failed", { error: String(e) }); }

    // seekto（系统媒体控件的进度条拖动）
    try {
      ms.setActionHandler("seekto", (details: MediaSessionActionDetails) => {
        if (details.seekTime !== undefined && details.seekTime !== null) {
          log.info(TAG, "action: seekto", { seekTime: details.seekTime });
          store.seek(details.seekTime);
        }
      });
    } catch (e) { log.warn(TAG, "setActionHandler seekto failed", { error: String(e) }); }

    // seekbackward / seekforward（媒体键上的快退/快进，通常 ±10s）
    try {
      ms.setActionHandler("seekbackward", (details: MediaSessionActionDetails) => {
        const offset = details.seekOffset ?? 10;
        const target = Math.max(0, store.currentTime - offset);
        log.info(TAG, "action: seekbackward", { offset, target });
        store.seek(target);
      });
    } catch (e) { log.warn(TAG, "setActionHandler seekbackward failed", { error: String(e) }); }

    try {
      ms.setActionHandler("seekforward", (details: MediaSessionActionDetails) => {
        const offset = details.seekOffset ?? 10;
        const target = Math.min(store.duration || 0, store.currentTime + offset);
        log.info(TAG, "action: seekforward", { offset, target });
        store.seek(target);
      });
    } catch (e) { log.warn(TAG, "setActionHandler seekforward failed", { error: String(e) }); }

    // seekrelative（部分浏览器支持的相对跳转，与 seekbackward/forward 等价）
    try {
      ms.setActionHandler("seekrelative" as any, (details: MediaSessionActionDetails) => {
        const offset = details.seekOffset ?? 0;
        if (offset === 0) return;
        const target = Math.max(0, Math.min(store.duration || 0, store.currentTime + offset));
        log.info(TAG, "action: seekrelative", { offset, target });
        store.seek(target);
      });
    } catch (e) {
      // 大部分浏览器不支持此 action，忽略 TypeError
      log.debug(TAG, "seekrelative not supported", { error: String(e) });
    }

    handlersRegistered = true;
    log.info(TAG, "action handlers registered");
  }

  /** 解绑所有 action handlers（关闭开关时调用） */
  function unregisterHandlers() {
    const ms = getMediaSession();
    if (!ms || typeof ms.setActionHandler !== "function") return;
    const actions: MediaSessionAction[] = [
      "play", "pause", "previoustrack", "nexttrack", "stop",
      "seekto", "seekbackward", "seekforward",
    ];
    // seekrelative 是非标准 action，单独尝试解绑
    const extraActions = ["seekrelative"] as any[];
    for (const action of [...actions, ...extraActions]) {
      try {
        ms.setActionHandler(action, null);
      } catch {
        // 部分浏览器不支持某些 action 的 null 解绑，忽略
      }
    }
    handlersRegistered = false;
    log.info(TAG, "action handlers unregistered");
  }

  /** 同步 handlers 绑定状态到当前 settings.mediaSessionEnabled */
  function syncHandlers() {
    if (settings.mediaSessionEnabled) {
      if (!handlersRegistered) registerHandlers();
      // 重新激活元数据与状态（关闭后再开启时恢复显示）
      if (store.currentSong) {
        // 强制重设：清空 lastMetadataSongId 让 updateMetadata 真正生效
        lastMetadataSongId = null;
        updateMetadata(store.currentSong, getCurrentCoverUrl());
      }
      updatePlaybackState(store.isPlaying);
      updatePositionState();
    } else {
      if (handlersRegistered) unregisterHandlers();
      clear();
    }
  }

  // ---------- 清空 ----------
  function clear() {
    const ms = getMediaSession();
    if (!ms) return;
    try {
      ms.metadata = null;
      ms.playbackState = "none";
      log.info(TAG, "metadata cleared");
    } catch (e) {
      log.warn(TAG, "clear failed", { error: String(e) });
    }
    lastMetadataSongId = null;
  }

  // ---------- 销毁 ----------
  function dispose() {
    unregisterHandlers();
    clear();
  }

  // ---------- 当前封面 URL（与 useNowPlaying.coverUrl 同源逻辑） ----------
  function getCurrentCoverUrl(): string {
    const song = store.currentSong;
    if (!song) return "";
    const pic = song.pic || "";
    if (!pic) return "";
    const q = settings.coverQuality || 300;
    if (pic.includes("music.126.net")) {
      return pic.replace(/\?param=\d+x\d+/g, "") + `?param=${q}x${q}`;
    }
    return pic;
  }

  // ===== 应用级 watchers（单例生命周期内只挂载一次） =====

  // 1) 设置开关变化：开启时绑定，关闭时解绑
  watch(
    () => settings.mediaSessionEnabled,
    (enabled) => {
      log.info(TAG, "mediaSessionEnabled changed", { enabled });
      syncHandlers();
    },
    { immediate: true }
  );

  // 2) 当前歌曲变化 → 更新元数据
  watch(
    () => store.currentSong,
    (song) => {
      if (!settings.mediaSessionEnabled) return;
      updateMetadata(song, getCurrentCoverUrl());
      // 切歌后立即同步一次位置状态（duration 可能还未就绪，updatePositionState 内部会跳过）
      updatePositionState();
    },
    { immediate: true }
  );

  // 3) 封面 URL 异步就绪后重新更新元数据（网易云封面 URL 可能在歌曲对象变化后才补全）
  watch(
    () => store.currentSong?.pic,
    () => {
      if (!settings.mediaSessionEnabled) return;
      // 强制刷新（因为 pic 可能从空变为有值）
      lastMetadataSongId = null;
      updateMetadata(store.currentSong, getCurrentCoverUrl());
    }
  );

  // 4) 播放状态变化 → 同步 playbackState
  watch(
    () => store.isPlaying,
    (playing) => {
      if (!settings.mediaSessionEnabled) return;
      updatePlaybackState(playing);
    }
  );

  // 5) 进度变化 → 节流更新位置状态（避免每次 timeupdate 都触发，~1s 一次足够）
  let lastPosUpdate = 0;
  watch(
    () => store.currentTime,
    () => {
      if (!settings.mediaSessionEnabled) return;
      const now = Date.now();
      if (now - lastPosUpdate < 1000) return;
      lastPosUpdate = now;
      updatePositionState();
    }
  );

  // 6) duration 就绪后立即更新位置状态
  watch(
    () => store.duration,
    () => {
      if (!settings.mediaSessionEnabled) return;
      updatePositionState();
    }
  );

  log.info(TAG, "useMediaSession initialized", {
    supported: isMediaSessionSupported(),
    enabled: settings.mediaSessionEnabled,
  });

  return {
    updateMetadata,
    updatePlaybackState,
    updatePositionState,
    clear,
    syncHandlers,
    dispose,
  };
}

/** 在 Vue 组件中使用：返回单例 API（如果尚未初始化则懒创建）。 */
export function useMediaSession(): MediaSessionApi {
  if (!_api) initMediaSession();
  return _api!;
}
