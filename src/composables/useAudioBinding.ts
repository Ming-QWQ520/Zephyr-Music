import { watch, onUnmounted, ref, type Ref } from "vue";
import { usePlayerStore } from "@/stores/player";
import { log } from "@/composables/logger";
import {
  isLocalFile, rodioPlay, rodioPause, rodioResume, rodioStop,
  rodioSetVolume,
} from "@/composables/rodioBridge";
import { scrobbleV1 } from "@/api/netease";

export function useAudioBinding(audioRef: Ref<HTMLAudioElement | null>) {
  const store = usePlayerStore();
  const TAG = "audio";
  const usingRodio = ref(false);
  const ensureAudio = (): HTMLAudioElement | null => audioRef.value;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let songLoading = false;

  // ===== 听歌打卡（仅加密版 /scrobble/v1）=====
  // 仅在用户手动切歌或播放完自动切歌时请求
  // 上报的是上一首歌的实际播放时长（store.currentTime），不造假
  let prevSongInfo: { neteaseId: number; name: string; artist: string; duration: number; sourceid: number | null; playTime: number } | null = null;
  /** 记录当前歌曲信息（用于切换时上报） */
  let currentSongStartInfo: { neteaseId: number; name: string; artist: string; duration: number; sourceid: number | null } | null = null;

  /** 切换歌曲时上报：对上一首歌调用 /scrobble/v1，传入实际播放时长 */
  function doScrobbleV1(prev: { neteaseId: number; name: string; artist: string; duration: number; sourceid: number | null; playTime: number } | null) {
    if (!prev) return;
    // 实际播放时长 = store.currentTime（用户真实听到的位置）
    const actualPlayTime = Math.floor(prev.playTime || 0);
    if (actualPlayTime <= 0) {
      log.info(TAG, "scrobble v1 skipped (playTime=0)", { songId: prev.neteaseId });
      return;
    }
    scrobbleV1(prev.neteaseId, actualPlayTime, {
      sourceid: prev.sourceid || undefined,
      song: prev.name,
      artist: prev.artist,
      total: prev.duration,
    }).then(() => {
      log.info(TAG, "scrobble v1 ok", { songId: prev.neteaseId, playTime: actualPlayTime, total: prev.duration, song: prev.name });
    }).catch((e) => {
      log.warn(TAG, "scrobble v1 failed", { error: String(e) });
    });
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

      // 切换歌曲时：对上一首网易云歌曲调用加密版 /scrobble/v1
      // 上报实际播放时长 = store.currentTime（用户真实听到的位置，不造假）
      if (oldSong && oldSong.source === "netease" && oldSong.neteaseId) {
        if (!song || song.neteaseId !== oldSong.neteaseId) {
          // 构建上一首歌信息，带上当前播放时长
          const playTime = store.currentTime;
          doScrobbleV1(prevSongInfo ? { ...prevSongInfo, playTime } : null);
        }
      }

      // 记录当前歌曲信息（供下次切换时上报）
      if (song && song.source === "netease" && song.neteaseId) {
        if (!oldSong || oldSong.neteaseId !== song.neteaseId) {
          prevSongInfo = {
            neteaseId: song.neteaseId,
            name: song.name,
            artist: song.artist,
            duration: song.duration || 0,
            sourceid: store.sourcePlaylistId,
            playTime: 0,
          };
        }
      } else {
        prevSongInfo = null;
      }
    },
    { immediate: true }
  );

  watch(
    () => store.currentSong?.url,
    async (url) => {
      songLoading = true;
      if (!url) {
        log.info(TAG, "no url, clearing");
        await rodioStop(); stopPolling(); usingRodio.value = false;
        const audio = ensureAudio();
        if (audio) { audio.removeAttribute("src"); audio.load(); }
        songLoading = false; return;
      }
      const song = store.currentSong;
      log.info(TAG, "song changed", { url: url.slice(0, 120), name: song?.name });
      if (isLocalFile(url)) {
        log.info(TAG, "using Rodio");
        usingRodio.value = true;
        const audio = ensureAudio();
        if (audio) { audio.pause(); audio.removeAttribute("src"); }
        try {
          const duration = await rodioPlay(url);
          log.info(TAG, "rodio play started", { duration });
          store.setDuration(duration); store.setPlaying(true); startPolling();
        } catch (e) { log.error(TAG, "rodio play failed", { error: String(e) }); store.setPlaying(false); }
      } else {
        log.info(TAG, "using <audio>");
        usingRodio.value = false;
        await rodioStop(); stopPolling();
        const audio = ensureAudio();
        if (!audio) { songLoading = false; return; }
        audio.src = url; audio.load();
        if (store.isPlaying) {
          audio.play().then(() => log.info(TAG, "play() ok", { dur: audio.duration }))
            .catch((e) => log.error(TAG, "play() failed", { error: String(e) }));
        }
      }
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
  const onEnded = () => { if (usingRodio.value) return; store.next(); };

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

  onUnmounted(() => { if (current) detach(current); stopPolling(); rodioStop(); });
}
