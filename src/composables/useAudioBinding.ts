import { watch, onUnmounted, ref, type Ref } from "vue";
import { usePlayerStore } from "@/stores/player";
import { log } from "@/composables/logger";
import {
  isLocalFile, rodioPlay, rodioPause, rodioResume, rodioStop,
  rodioSetVolume,
} from "@/composables/rodioBridge";
import { scrobbleV1, scrobble } from "@/api/netease";

export function useAudioBinding(audioRef: Ref<HTMLAudioElement | null>) {
  const store = usePlayerStore();
  const TAG = "audio";
  const usingRodio = ref(false);
  const ensureAudio = (): HTMLAudioElement | null => audioRef.value;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let songLoading = false;
  let recentScrobbleTimer: ReturnType<typeof setTimeout> | null = null;
  let scrobbleDone = false; // onEnded 上报后设为 true，避免 watch(currentSong) 重复上报

  // ===== 听歌打卡（仅加密版 /scrobble/v1）=====
  // 精确跟踪每首歌的实际播放时长，应对所有场景：
  // - 手动切歌：上报已播放时长
  // - 播放完自动切歌：上报完整时长（duration）
  // - 暂停后切歌：上报暂停前的播放时长
  // - 跳转进度：按实际播放位置计算（seek 不会增加额外时长）
  // - 刚切歌就切下一首：不上报（playTime=0）

  /** 当前歌曲的打卡信息 */
  interface ScrobbleInfo {
    neteaseId: number;
    name: string;
    artist: string;
    duration: number;
    sourceid: number | null;
    /** 本首歌已累计的真实播放秒数 */
    accumulatedTime: number;
    /** 上次记录时间戳（用于计算增量） */
    lastTickMs: number | null;
    /** 是否正在播放（用于暂停时停止累计） */
    ticking: boolean;
    /** 是否已调用 /scrobble 记录到最近播放 */
    scrobbledToRecent: boolean;
  }
  let scrobbleInfo: ScrobbleInfo | null = null;

  /** 开始计时（播放时调用） */
  function startTicking() {
    if (!scrobbleInfo) return;
    if (scrobbleInfo.ticking) return;
    scrobbleInfo.ticking = true;
    scrobbleInfo.lastTickMs = Date.now();
    scheduleRecentScrobble(scrobbleInfo);
  }

  /** 停止计时并累计（暂停/切歌时调用） */
  function stopTicking() {
    if (!scrobbleInfo || !scrobbleInfo.ticking) return;
    scrobbleInfo.ticking = false;
    if (scrobbleInfo.lastTickMs !== null) {
      const delta = (Date.now() - scrobbleInfo.lastTickMs) / 1000;
      // 限制单次增量不超过 5 秒（防止 sleep/卡顿导致异常增量）
      if (delta > 0 && delta < 5) {
        scrobbleInfo.accumulatedTime += delta;
      } else if (delta >= 5) {
        // 大间隔：用 store.currentTime 和上次记录位置的差值
        // 这种情况下不盲目增加，保守处理
      }
      scrobbleInfo.lastTickMs = null;
    }
  }

  /** 用 store.currentTime 精确校准累计时长（每次 timeUpdate 时调用） */
  function syncAccumulatedTime() {
    if (!scrobbleInfo || !scrobbleInfo.ticking) return;
    // 用 store.currentTime 作为当前播放位置
    // accumulatedTime 直接使用 store.currentTime（这是最准确的）
    // 但要处理 seek（跳转）的情况：如果 currentTime 比 accumulatedTime 小很多，说明用户 seek 了
    const ct = store.currentTime;
    if (ct >= 0 && isFinite(ct)) {
      // 用 currentTime 作为实际播放位置
      // 取 max(accumulatedTime, ct) 避免 seek 倒退导致时长减少
      // 但如果 seek 前进了，也不应该把跳过的部分算作播放时长
      // 最准确的方式：用增量累计，而非直接用 currentTime
    }
  }

  /** 上报打卡：对当前歌曲调用 /scrobble/v1（加密版，同步播放时长到听歌排行）
   *  isAutoNext=true: 完整播放完，上报完整时长（duration）
   *  isAutoNext=false: 手动切歌，上报实际播放时长（accumulatedTime） */
  function doScrobble(info: ScrobbleInfo | null, isAutoNext: boolean = false) {
    if (!info) return;
    // 停止计时
    stopTicking();
    const playTime = Math.floor(info.accumulatedTime);
    // 完整播放完：直接用 duration 作为播放时长（不依赖 accumulatedTime）
    // 手动切歌：用实际累计播放时长
    const reportTime = isAutoNext ? Math.floor(info.duration || playTime) : playTime;
    if (reportTime <= 0) {
      log.info(TAG, "scrobble skipped (reportTime=0)", { songId: info.neteaseId, name: info.name, isAutoNext, playTime, duration: info.duration });
      return;
    }
    log.info(TAG, "doScrobble 开始", { songId: info.neteaseId, name: info.name, isAutoNext, reportTime, playTime, duration: info.duration, accumulatedTime: info.accumulatedTime });
    scrobbleV1(info.neteaseId, reportTime, {
      sourceid: info.sourceid || undefined,
      song: info.name,
      artist: info.artist,
      total: info.duration,
      isAutoNext,
    }).then(() => {
      log.info(TAG, "scrobble v1 ok", {
        songId: info.neteaseId,
        playTime: reportTime,
        accumulated: playTime,
        total: info.duration,
        isAutoNext,
        song: info.name,
      });
    }).catch((e) => {
      log.warn(TAG, "scrobble v1 failed", { error: String(e) });
    });
  }

  /** 记录到最近播放：调用 /scrobble（非加密版，同步到最近播放列表）
   *  仅在歌曲实际播放超过一定时长（如 10 秒）后调用一次，避免重复 */
  function scrobbleToRecent(info: ScrobbleInfo | null) {
    if (!info || info.scrobbledToRecent) return;
    if (info.accumulatedTime < 1) return; // 播放开始后尽快同步到网易云最近播放
    info.scrobbledToRecent = true;
    const sourceid = info.sourceid || 0;
    const reportTime = Math.max(1, Math.floor(info.accumulatedTime));
    scrobble(info.neteaseId, sourceid, reportTime).then(() => {
      log.info(TAG, "scrobble to recent ok", { songId: info.neteaseId, name: info.name, time: reportTime });
    }).catch((e) => {
      log.warn(TAG, "scrobble to recent failed", { error: String(e) });
      // 失败了允许重试
      info.scrobbledToRecent = false;
    });
  }

  function scheduleRecentScrobble(info: ScrobbleInfo | null) {
    if (!info || info.scrobbledToRecent || recentScrobbleTimer) return;
    recentScrobbleTimer = setTimeout(() => {
      recentScrobbleTimer = null;
      if (!scrobbleInfo || scrobbleInfo.neteaseId !== info.neteaseId || !scrobbleInfo.ticking) return;
      scrobbleInfo.accumulatedTime = Math.max(scrobbleInfo.accumulatedTime, store.currentTime || 1);
      scrobbleToRecent(scrobbleInfo);
    }, 2500);
  }

  function clearRecentScrobbleTimer() {
    if (recentScrobbleTimer) {
      clearTimeout(recentScrobbleTimer);
      recentScrobbleTimer = null;
    }
  }

  /** 初始化新歌曲的打卡信息 */
  function initScrobble(song: { neteaseId?: number; name?: string; artist?: string; duration?: number; source?: string } | null) {
    if (!song || song.source !== "netease" || !song.neteaseId) {
      scrobbleInfo = null;
      return;
    }
    scrobbleInfo = {
      neteaseId: song.neteaseId,
      name: song.name || "",
      artist: song.artist || "",
      duration: song.duration || 0,
      sourceid: store.sourcePlaylistId,
      accumulatedTime: 0,
      lastTickMs: null,
      ticking: false,
      scrobbledToRecent: false,
    };
    if (store.isPlaying) startTicking();
    log.info(TAG, "scrobble initialized", { songId: song.neteaseId, name: song.name, duration: song.duration });
  }

  // 更新窗口标题栏 + 任务栏标题为 "歌曲名 - 歌手"，并在切换歌曲时打卡
  watch(
    () => store.currentSong,
    async (song, oldSong) => {
      const title = song ? `${song.name} - ${song.artist}` : "Zephyr · 音乐";
      document.title = title;
      try {
        const mod = await import("@tauri-apps/api/window");
        const w = mod.getCurrentWindow?.() ?? (mod as any).window?.();
        if (w) await w.setTitle(title);
      } catch { /* ignore if not in Tauri */ }

      // 切换歌曲时：对上一首网易云歌曲上报打卡
      // 手动切歌（不是自动播放完毕）
      // 如果 onEnded 已经上报过（scrobbleDone=true），跳过避免重复
      if (oldSong && oldSong.source === "netease" && oldSong.neteaseId) {
        if (!song || song.neteaseId !== oldSong.neteaseId) {
          if (!scrobbleDone) {
            doScrobble(scrobbleInfo, false); // false = 手动切歌
          }
          scrobbleDone = false; // 重置标记
        }
      }

      // 初始化新歌曲的打卡信息
      if (song && song.source === "netease" && song.neteaseId) {
        if (!oldSong || oldSong.neteaseId !== song.neteaseId) {
          initScrobble(song);
        }
      } else {
        scrobbleInfo = null;
      }
    },
    { immediate: true }
  );

  // 监听播放状态：播放时开始计时，暂停时停止计时
  watch(
    () => store.isPlaying,
    (playing) => {
      if (playing) {
        startTicking();
      } else {
        stopTicking();
      }
    }
  );

  // 定期同步累计时长（用 store.currentTime 增量）
  let scrobbleTickTimer: ReturnType<typeof setInterval> | null = null;
  let lastReportedTime = 0;
  function startScrobbleTick() {
    stopScrobbleTick();
    lastReportedTime = 0;
    scrobbleTickTimer = setInterval(() => {
      if (!scrobbleInfo || !scrobbleInfo.ticking) return;
      const ct = store.currentTime;
      if (ct >= 0 && isFinite(ct)) {
        // 用增量方式累计：如果 currentTime 前进了，增加差值
        // 如果 currentTime 倒退了（seek），不减少已累计时长
        if (ct > lastReportedTime && ct - lastReportedTime < 5) {
          scrobbleInfo.accumulatedTime += (ct - lastReportedTime);
        }
        lastReportedTime = ct;
        scrobbleInfo.lastTickMs = Date.now();
        // 播放开始后，记录到网易云最近播放（仅一次）
        scrobbleToRecent(scrobbleInfo);
      }
    }, 1000); // 每秒同步一次
  }
  function stopScrobbleTick() {
    if (scrobbleTickTimer) { clearInterval(scrobbleTickTimer); scrobbleTickTimer = null; }
  }

  watch(
    () => store.currentSong?.url,
    async (url) => {
      songLoading = true;
      // 切歌时重置 scrobble tick 的 lastReportedTime
      if (!url) {
        log.info(TAG, "no url, clearing");
        clearRecentScrobbleTimer();
        await rodioStop(); stopPolling(); usingRodio.value = false;
        const audio = ensureAudio();
        if (audio) { audio.removeAttribute("src"); audio.load(); }
        songLoading = false; return;
      }
      const song = store.currentSong;
      // 记录当前播放状态：URL 变化时如果之前是 playing，恢复后也应继续 playing
      // （修复重启后 URL 异步获取完成时 isPlaying 还是 false 的问题）
      const shouldAutoPlay = store.isPlaying || (song as any)?._restorePlaying === true;
      log.info(TAG, "song changed", { url: url.slice(0, 120), name: song?.name, shouldAutoPlay });
      if (isLocalFile(url)) {
        log.info(TAG, "using Rodio");
        usingRodio.value = true;
        const audio = ensureAudio();
        if (audio) { audio.pause(); audio.removeAttribute("src"); }
        try {
          const duration = await rodioPlay(url);
          log.info(TAG, "rodio play started", { duration });
          store.setDuration(duration);
          // 恢复进度（如果是重启恢复场景）
          if ((song as any)?._restoreTime && (song as any)._restoreTime > 0) {
            try {
              await import("@tauri-apps/api/core").then(m => m.invoke("rodio_seek", { position: (song as any)._restoreTime }));
              log.info(TAG, "rodio restored position", { pos: (song as any)._restoreTime });
            } catch { /* ignore */ }
            (song as any)._restoreTime = 0;
          }
          if (shouldAutoPlay) {
            store.setPlaying(true);
            startPolling();
          }
          // 清除恢复标记
          if (song) (song as any)._restorePlaying = false;
        } catch (e) { log.error(TAG, "rodio play failed", { error: String(e) }); store.setPlaying(false); }
      } else {
        log.info(TAG, "using <audio>");
        usingRodio.value = false;
        await rodioStop(); stopPolling();
        const audio = ensureAudio();
        if (!audio) { songLoading = false; return; }
        audio.src = url; audio.load();
        // 恢复进度（重启场景）：等待 loadedmetadata 后再 seek
        if ((song as any)?._restoreTime && (song as any)._restoreTime > 0) {
          const restoreT = (song as any)._restoreTime;
          const onReady = () => {
            try {
              if (isFinite(audio.duration) && restoreT < audio.duration) {
                audio.currentTime = restoreT;
                log.info(TAG, "audio restored position", { pos: restoreT, dur: audio.duration });
              }
            } catch { /* ignore */ }
            audio.removeEventListener("loadedmetadata", onReady);
            (song as any)._restoreTime = 0;
          };
          audio.addEventListener("loadedmetadata", onReady);
        }
        if (shouldAutoPlay) {
          audio.play().then(() => log.info(TAG, "play() ok", { dur: audio.duration }))
            .catch((e) => log.error(TAG, "play() failed", { error: String(e) }));
        }
        // 清除恢复标记
        if (song) (song as any)._restorePlaying = false;
      }
      // 启动 scrobble tick
      startScrobbleTick();
      setTimeout(() => { songLoading = false; }, 200);
    },
    { immediate: true }
  );

  watch(
    () => store.isPlaying,
    async (playing) => {
      if (songLoading) return;
      if (usingRodio.value) {
        if (playing) { await rodioResume(); startPolling(); }
        else { await rodioPause(); stopPolling(); }
      } else {
        const audio = ensureAudio();
        if (!audio) return;
        if (playing) audio.play().catch(() => {});
        else audio.pause();
      }
    }
  );

  watch(
    [() => store.volume, () => store.muted],
    async () => {
      const vol = store.muted ? 0 : store.volume;
      if (usingRodio.value) await rodioSetVolume(vol);
      else { const a = ensureAudio(); if (a) { a.volume = vol; a.muted = store.muted; } }
    },
    { immediate: true }
  );

  // Seek: only trigger rodio_seek on large jumps (>1.5s = user drag, not polling ~0.3s)
  watch(
    () => store.currentTime,
    async (t, oldT) => {
      if (usingRodio.value) {
        if (oldT !== undefined && Math.abs(t - (oldT as number)) > 1.5) {
          try {
            const mod = await import("@tauri-apps/api/core");
            await mod.invoke("rodio_seek", { position: t });
            log.info(TAG, "rodio seek", { pos: t });
          } catch (e) { log.error(TAG, "rodio seek failed", { error: String(e) }); }
        }
        return;
      }
      const audio = ensureAudio();
      if (!audio) return;
      if (Math.abs(audio.currentTime - t) > 0.6) { try { audio.currentTime = t; } catch {} }
    }
  );

  const onLoadedMetadata = () => {
    if (usingRodio.value) return;
    const a = ensureAudio(); if (!a) return;
    if (isFinite(a.duration) && a.duration > 0 && a.duration < 1e6) store.setDuration(a.duration);
  };
  const onTimeUpdate = () => {
    if (usingRodio.value) return;
    const a = ensureAudio(); if (!a) return;
    const ct = a.currentTime;
    if (isFinite(ct) && ct >= 0 && ct < 1e6) store.setTime(ct);
    if ((!store.duration || !isFinite(store.duration)) && isFinite(a.duration) && a.duration > 0 && a.duration < 1e6) store.setDuration(a.duration);
    store.updateActiveLyric();
  };
  const onProgress = () => {
    if (usingRodio.value) return;
    const a = ensureAudio(); if (!a || !a.buffered.length) return;
    store.setBuffered(a.buffered.end(a.buffered.length - 1));
  };
  const onPlay = () => { if (!usingRodio.value && !songLoading) store.setPlaying(true); };
  const onPause = () => { if (!usingRodio.value && !songLoading) store.setPlaying(false); };
  const onError = () => { if (usingRodio.value) return; const a = ensureAudio(); log.error(TAG, "audio error", { code: a?.error?.code, msg: a?.error?.message }); };
  const onEnded = () => {
    if (usingRodio.value) return;
    log.info(TAG, "=== onEnded 触发 === 播放完毕", { song: scrobbleInfo?.name, songId: scrobbleInfo?.neteaseId, duration: scrobbleInfo?.duration, accumulatedTime: scrobbleInfo?.accumulatedTime });
    // 播放完毕自动切歌：上报完整时长
    if (scrobbleInfo) {
      doScrobble(scrobbleInfo, true); // true = 自动切歌（播放完）
      scrobbleDone = true; // 标记已上报，避免 watch(currentSong) 重复上报
    }
    store.next();
  };

  /** Rodio 播放完毕处理（polling 检测到 !playing 时调用） */
  function onRodioEnded() {
    if (scrobbleInfo) {
      doScrobble(scrobbleInfo, true); // true = 自动切歌（播放完）
      scrobbleDone = true;
    }
    store.next();
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      const playing = await import("@tauri-apps/api/core").then(m => m.invoke<boolean>("rodio_is_playing")).catch(() => false);
      if (!playing) { stopPolling(); onRodioEnded(); return; }
      const pos = await import("@tauri-apps/api/core").then(m => m.invoke<number>("rodio_position")).catch(() => 0);
      store.setTime(pos); store.updateActiveLyric();
    }, 300);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  const attach = (a: HTMLAudioElement) => {
    a.addEventListener("loadedmetadata", onLoadedMetadata);
    a.addEventListener("timeupdate", onTimeUpdate);
    a.addEventListener("ended", onEnded);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("progress", onProgress);
    a.addEventListener("error", onError);
  };
  const detach = (a: HTMLAudioElement) => {
    a.removeEventListener("loadedmetadata", onLoadedMetadata);
    a.removeEventListener("timeupdate", onTimeUpdate);
    a.removeEventListener("ended", onEnded);
    a.removeEventListener("play", onPlay);
    a.removeEventListener("pause", onPause);
    a.removeEventListener("progress", onProgress);
    a.removeEventListener("error", onError);
  };

  let current: HTMLAudioElement | null = null;
  watch(audioRef, (el) => {
    if (current && current !== el) detach(current);
    if (el) { attach(el); current = el; el.volume = store.volume; el.muted = store.muted; }
  }, { immediate: true });

  onUnmounted(() => {
    if (current) detach(current);
    stopPolling();
    stopScrobbleTick();
    clearRecentScrobbleTimer();
    rodioStop();
  });
}
