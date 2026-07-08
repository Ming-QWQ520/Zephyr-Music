import { watch, onUnmounted, ref, type Ref } from "vue";
import { usePlayerStore } from "@/stores/player";
import { log } from "@/composables/logger";
import {
  isLocalFile, rodioPlay, rodioPause, rodioResume, rodioStop,
  rodioSetVolume,
} from "@/composables/rodioBridge";
import { scrobbleV1, scrobble } from "@/api/netease";
import { dualScrobble } from "@/api/netease/dual-scrobble";
import { useSettings } from "@/components/SettingsPanel.vue";

export function useAudioBinding(audioRef: Ref<HTMLAudioElement | null>) {
  const store = usePlayerStore();
  const TAG = "audio";
  const usingRodio = ref(false);
  const ensureAudio = (): HTMLAudioElement | null => audioRef.value;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let songLoading = false;

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

  /** 上报打卡：双上报（EAPI scrobble + NCBL scrobble_v1）+ api-enhanced /scrobble
   *  EAPI: startplay + play → 计入听歌量/最近播放/听歌排行
   *  NCBL: PLV + PLD → 计入云村听歌足迹/收听时长/年度报告
   *  api-enhanced /scrobble → 最近播放列表同步 */
  function doScrobble(info: ScrobbleInfo | null, isAutoNext: boolean = false) {
    if (!info) return;
    // 停止计时
    stopTicking();
    const playTime = Math.floor(info.accumulatedTime);
    if (playTime <= 0) {
      log.info(TAG, "scrobble skipped (playTime=0)", { songId: info.neteaseId, name: info.name });
      return;
    }
    // 如果是自动切歌（播放完），上报完整时长
    const reportTime = isAutoNext ? Math.floor(info.duration || playTime) : playTime;

    // 获取音质设置
    let level = "exhigh";
    let bitrate = 320;
    try {
      const { settings } = useSettings();
      level = (settings as any).audioLevel || "exhigh";
      const bitrateMap: Record<string, number> = {
        standard: 128, higher: 192, exhigh: 320, lossless: 999,
        hires: 1999, jyeffect: 999, sky: 999, dolby: 1999, jymaster: 1999,
      };
      bitrate = bitrateMap[level] || 320;
    } catch { /* ignore */ }

    log.info(TAG, "doScrobble 开始", { songId: info.neteaseId, name: info.name, playTime, reportTime, isAutoNext, accumulatedTime: info.accumulatedTime, sourceid: info.sourceid });

    // 1. 调用 api-enhanced /scrobble（最近播放列表同步）
    // sourceid 默认用 songId（Go SDK 行为：sourceID 为空时用 songID）
    const sourceid = info.sourceid || info.neteaseId;
    scrobble(info.neteaseId, sourceid, reportTime).then(() => {
      log.info(TAG, "scrobble (api-enhanced) ok", { songId: info.neteaseId, name: info.name, time: reportTime });
    }).catch((e) => {
      log.warn(TAG, "scrobble (api-enhanced) failed", { error: String(e) });
    });

    // 2. 调用双上报（EAPI + NCBL）
    dualScrobble({
      songId: info.neteaseId,
      songName: info.name,
      artist: info.artist,
      sourceId: info.sourceid || info.neteaseId,
      playTime: reportTime,
      totalTime: info.duration,
      bitrate,
      level,
    }).then((result) => {
      log.info(TAG, "dual scrobble done", {
        songId: info.neteaseId,
        playTime: reportTime,
        accumulated: playTime,
        total: info.duration,
        isAutoNext,
        song: info.name,
        eapi: result.eapi?.code,
        ncbl: result.ncbl?.code,
      });
    }).catch((e) => {
      log.warn(TAG, "dual scrobble error", { error: String(e) });
    });
  }

  /** 记录到最近播放：调用 /scrobble（通过 api-enhanced 服务）
   *  EAPI weblog + NCBL 是直连网易云的上报，但最近播放列表可能需要通过 api-enhanced 的 /scrobble 接口同步
   *  仅在歌曲实际播放超过 10 秒后调用一次 */
  function scrobbleToRecent(info: ScrobbleInfo | null) {
    if (!info || info.scrobbledToRecent) return;
    if (info.accumulatedTime < 10) return;
    info.scrobbledToRecent = true;
    const sourceid = info.sourceid || 0;
    scrobble(info.neteaseId, sourceid, Math.floor(info.accumulatedTime)).then(() => {
      log.info(TAG, "scrobble to recent ok (api-enhanced)", { songId: info.neteaseId, name: info.name, time: Math.floor(info.accumulatedTime) });
    }).catch((e) => {
      log.warn(TAG, "scrobble to recent failed", { error: String(e) });
      info.scrobbledToRecent = false;
    });
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
      if (oldSong && oldSong.source === "netease" && oldSong.neteaseId) {
        if (!song || song.neteaseId !== oldSong.neteaseId) {
          doScrobble(scrobbleInfo, false); // false = 手动切歌
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
        // 播放超过 10 秒后，记录到最近播放（仅一次）
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
    // 播放完毕自动切歌：上报完整时长
    if (scrobbleInfo) {
      doScrobble(scrobbleInfo, true); // true = 自动切歌（播放完）
    }
    store.next();
  };

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      const playing = await import("@tauri-apps/api/core").then(m => m.invoke<boolean>("rodio_is_playing")).catch(() => false);
      if (!playing) { stopPolling(); store.next(); return; }
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
    rodioStop();
  });
}
