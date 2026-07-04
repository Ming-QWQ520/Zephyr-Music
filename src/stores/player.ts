import { defineStore } from "pinia";
import type { Song, LyricLine, RepeatMode, ViewKey } from "@/types";
import { fetchLyrics } from "@/api/music";
import { songUrlV1 as songUrl, lyricNew, lyric, parseYrc, type NeteaseSong, type AudioLevel } from "@/api/netease";
import { log } from "@/composables/logger";
import { useSettings } from "@/components/SettingsPanel.vue";

const SESSION_KEY = "zephyr-session";

interface SessionData {
  queue: Song[];
  currentIndex: number;
  currentTime: number;
  volume: number;
  muted: boolean;
}

function loadSession(): SessionData | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d.queue && Array.isArray(d.queue) && d.queue.length > 0) return d;
  } catch { /* ignore */ }
  return null;
}

function saveSession(data: SessionData) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

interface State {
  queue: Song[]; currentIndex: number; isPlaying: boolean;
  currentTime: number; duration: number; buffered: number;
  volume: number; muted: boolean; shuffle: boolean; repeat: RepeatMode;
  lyrics: LyricLine[]; activeLyricIndex: number;
  currentView: ViewKey; searchKeyword: string; history: Song[];
  previousView: ViewKey | null;
  pendingPlaylistId: number | null;
  /** 当前播放队列来源的歌单 ID（用于听歌打卡 sourceid） */
  sourcePlaylistId: number | null;
  /** 视图历史栈，用于返回上一页 */
  viewHistory: ViewKey[];
  /** 当前歌单 ID 历史，用于返回上一歌单 */
  playlistIdHistory: (number | null)[];
}

export const usePlayerStore = defineStore("player", {
  state: (): State => {
    const session = loadSession();
    return {
      queue: session?.queue || [], currentIndex: session?.currentIndex ?? -1, isPlaying: false,
      currentTime: session?.currentTime || 0, duration: 0, buffered: 0,
      volume: session?.volume ?? 0.8, muted: session?.muted ?? false, shuffle: false, repeat: "off",
      lyrics: [], activeLyricIndex: -1,
      currentView: "recommend", searchKeyword: "", history: [],
      previousView: null,
      pendingPlaylistId: null,
      sourcePlaylistId: null,
      viewHistory: [],
      playlistIdHistory: [],
    } as State;
  },
  getters: {
    currentSong(s): Song | null { return s.currentIndex >= 0 && s.currentIndex < s.queue.length ? s.queue[s.currentIndex] : null; },
    hasNext(s): boolean { return s.queue.length > 0 && (s.repeat === "all" || s.currentIndex < s.queue.length - 1); },
    hasPrev(s): boolean { return s.queue.length > 0 && (s.repeat === "all" || s.currentIndex > 0); },
    progress(s): number { return s.duration > 0 ? Math.min(1, s.currentTime / s.duration) : 0; },
    bufferedFrac(s): number { return s.duration > 0 ? Math.min(1, s.buffered / s.duration) : 0; },
    canGoBack(s): boolean { return s.viewHistory.length > 0; },
  },
  actions: {
    setView(v: ViewKey) {
      // 记录历史（避免重复入栈）
      if (this.currentView !== v) {
        this.viewHistory.push(this.currentView);
        if (this.viewHistory.length > 20) this.viewHistory.shift();
      }
      this.currentView = v;
    },
    /** 返回上一页 */
    goBackView() {
      if (this.viewHistory.length > 0) {
        this.currentView = this.viewHistory.pop()!;
      } else {
        this.currentView = "recommend";
      }
    },
    openFullscreenPlayer() { if (this.currentView !== "nowplaying") this.previousView = this.currentView; this.currentView = "nowplaying"; },
    closeFullscreenPlayer() { this.currentView = this.previousView || "search"; this.previousView = null; },
    setSearchKeyword(kw: string) { this.searchKeyword = kw; },
    /** 设置当前播放队列来源的歌单 ID（用于听歌打卡 sourceid） */
    setSourcePlaylistId(id: number | null) { this.sourcePlaylistId = id; },

    /** 播放一首歌。如果是网易云歌曲（source=netease），动态获取 URL 和歌词。
     *  URL 和歌词并行获取，不等待歌词就开始播放（歌词后台加载，加载完自动显示）。 */
    async playNow(song: Song) {
      // 网易云歌曲：并行获取 URL 和歌词（不阻塞播放）
      if (song.source === "netease" && song.neteaseId) {
        const urlPromise = !song.url ? this._ensureNeteaseUrl(song) : Promise.resolve();
        const lrcPromise = !song.lrc ? this._ensureNeteaseLyrics(song).then(() => {
          // 歌词获取完成后，如果还是当前歌曲，重新加载歌词
          if (this.currentSong?.id === song.id) this.loadLyrics(song);
        }) : Promise.resolve();
        await urlPromise; // 只等待 URL，不等待歌词
        // 歌词在后台继续加载（lrcPromise 不 await）
        void lrcPromise;
      }
      const idx = this.queue.findIndex(s => s.id === song.id);
      if (idx >= 0) this.currentIndex = idx;
      else { this.queue.push(song); this.currentIndex = this.queue.length - 1; }
      this.isPlaying = true; this.pushHistory(song);
      // 立即加载已有歌词（如果之前已缓存）
      if (song.lrc) this.loadLyrics(song);
      else this.lyrics = [];
    },

    /** 播放歌单。网易云歌曲需要逐个获取 URL（首次播放时懒加载）。 */
    async playList(songs: Song[], start = 0) {
      this.queue = [...songs];
      this.currentIndex = Math.max(0, Math.min(start, songs.length - 1));
      this.isPlaying = true;
      const s = this.currentSong;
      if (s) {
        if (s.source === "netease" && s.neteaseId) {
          // 并行获取 URL 和歌词，只等待 URL
          const urlPromise = !s.url ? this._ensureNeteaseUrl(s) : Promise.resolve();
          const lrcPromise = !s.lrc ? this._ensureNeteaseLyrics(s).then(() => {
            if (this.currentSong?.id === s.id) this.loadLyrics(s);
          }) : Promise.resolve();
          await urlPromise;
          void lrcPromise;
        }
        this.pushHistory(s);
        if (s.lrc) this.loadLyrics(s);
        else this.lyrics = [];
      }
    },

    /** 下一首播放（插入到当前歌曲后面） */
    async playNextSong(song: Song) {
      if (song.source === "netease" && song.neteaseId && !song.url) {
        await this._ensureNeteaseUrl(song);
      }
      this.queue.splice(this.currentIndex + 1, 0, song);
    },

    /** 网易云歌曲：获取播放 URL，patch 回 queue */
    async _ensureNeteaseUrl(song: Song) {
      if (!song.neteaseId) return;
      try {
        const { settings } = useSettings();
        const level = (settings as any).audioLevel || "exhigh";
        const res = await songUrl(song.neteaseId, level);
        const d = res.data?.[0];
        if (d?.url) {
          song.url = d.url;
          const idx = this.queue.findIndex(s => s.id === song.id);
          if (idx >= 0) this.queue[idx].url = d.url;
        }
      } catch { /* ignore */ }
    },

    /** 网易云歌词获取：优先逐字 yrc，回退普通 lrc */
    async _ensureNeteaseLyrics(song: Song) {
      if (!song.neteaseId || song.lrc) return;
      let lrcText = "";
      let tlyric = "";
      try {
        const newRes = await lyricNew(song.neteaseId);
        log.info("lyrics", "lyricNew response", { keys: Object.keys(newRes), hasYrc: !!newRes.yrc?.lyric, hasLrc: !!newRes.lrc?.lyric, songId: song.neteaseId, songName: song.name });
        if (newRes.yrc?.lyric) {
          const parsed = parseYrc(newRes.yrc.lyric);
          log.info("lyrics", "yrc parsed", { lines: parsed.length, firstLine: parsed[0]?.text || "" });
          if (parsed.length > 0) {
            // 存储原始 yrc 文本到 song 上（用于逐字渲染）
            (song as any).yrcText = newRes.yrc.lyric;
            const idx2 = this.queue.findIndex(s => s.id === song.id);
            if (idx2 >= 0) (this.queue[idx2] as any).yrcText = newRes.yrc.lyric;
            // 转标准 LRC 格式
            lrcText = parsed.map(l => {
              const min = String(Math.floor(l.time / 60)).padStart(2, "0");
              const sec = String(Math.floor(l.time % 60)).padStart(2, "0");
              const ms = String(Math.floor((l.time % 1) * 1000)).padStart(3, "0").slice(0, 2);
              return `[${min}:${sec}.${ms}]${l.text}`;
            }).join("\n");
            log.info("lyrics", "using yrc (逐字歌词)", { lrcLen: lrcText.length });
          }
        }
        // /lyric/new 同时返回 lrc 和 tlyric，无需再调用 /lyric
        if (!lrcText && newRes.lrc?.lyric) {
          lrcText = newRes.lrc.lyric;
          log.info("lyrics", "using lrc from /lyric/new", { lrcLen: lrcText.length });
        }
        if (newRes.tlyric?.lyric) {
          tlyric = newRes.tlyric.lyric;
          log.info("lyrics", "got tlyric", { tlyricLen: tlyric.length });
        }
      } catch (e) { log.warn("lyrics", "lyricNew error", { error: String(e) }); }
      // 只有 /lyric/new 完全失败时才回退到 /lyric
      if (!lrcText) {
        log.info("lyrics", "lyricNew failed or empty, fallback to /lyric", { songId: song.neteaseId });
        try {
          const lrcRes = await lyric(song.neteaseId);
          if (lrcRes.lrc?.lyric) {
            lrcText = lrcRes.lrc.lyric;
            if (!tlyric) tlyric = lrcRes.tlyric?.lyric || "";
            log.info("lyrics", "got lrc from /lyric", { lrcLen: lrcText.length });
          }
        } catch (e) { log.warn("lyrics", "lyric error", { error: String(e) }); }
      }
      if (lrcText) {
        // 只存储原文 LRC（不含翻译），翻译单独存储
        song.lrc = "data:text/plain;charset=utf-8," + encodeURIComponent(lrcText);
        if (tlyric) {
          (song as any).tlyricText = tlyric;
          const idxT = this.queue.findIndex(s => s.id === song.id);
          if (idxT >= 0) (this.queue[idxT] as any).tlyricText = tlyric;
        }
        const idx = this.queue.findIndex(s => s.id === song.id);
        if (idx >= 0) this.queue[idx].lrc = song.lrc;
        log.info("lyrics", "lyrics stored", { lrcLen: lrcText.length, hasYrc: !!(song as any).yrcText, hasTlyric: !!tlyric, tlyricLen: tlyric.length });
      } else {
        log.warn("lyrics", "no lyrics found", { songId: song.neteaseId, songName: song.name });
      }
    },

    patchSong(id: string, patch: Partial<Song>) {
      const idx = this.queue.findIndex(s => s.id === id);
      if (idx >= 0) { this.queue[idx] = { ...this.queue[idx], ...patch }; if (idx === this.currentIndex && patch.lrc) this.loadLyrics(this.queue[idx]); }
    },
    addToQueue(song: Song) { if (!this.queue.find(s => s.id === song.id)) this.queue.push(song); },
    playNext(song: Song) { this.queue.splice(this.currentIndex + 1, 0, song); },
    removeFromQueue(index: number) {
      if (index < 0 || index >= this.queue.length) return;
      const wasCurrent = index === this.currentIndex;
      this.queue.splice(index, 1);
      if (wasCurrent) {
        if (this.queue.length === 0) { this.currentIndex = -1; this.isPlaying = false; }
        else if (index <= this.currentIndex) this.currentIndex = Math.max(0, this.currentIndex - 1);
      } else if (index < this.currentIndex) this.currentIndex -= 1;
    },
    togglePlay() { if (this.queue.length > 0) this.isPlaying = !this.isPlaying; },
    async next() {
      if (this.queue.length === 0) return;
      if (this.shuffle) { let n = Math.floor(Math.random() * this.queue.length); if (n === this.currentIndex && this.queue.length > 1) n = (n + 1) % this.queue.length; this.currentIndex = n; }
      else if (this.currentIndex < this.queue.length - 1) this.currentIndex += 1;
      else if (this.repeat === "all") this.currentIndex = 0;
      else { this.isPlaying = false; return; }
      this.isPlaying = true;
      const s = this.currentSong;
      if (s) {
        if (s.source === "netease" && s.neteaseId) {
          // 并行获取 URL 和歌词
          const urlP = !s.url ? this._ensureNeteaseUrl(s) : Promise.resolve();
          const lrcP = !s.lrc ? this._ensureNeteaseLyrics(s).then(() => {
            if (this.currentSong?.id === s.id) this.loadLyrics(s);
          }) : Promise.resolve();
          await urlP;
          void lrcP;
        }
        if (s.lrc) this.loadLyrics(s);
        else this.lyrics = [];
      }
    },
    async prev() {
      if (this.queue.length === 0) return;
      if (this.currentTime > 3) { this.currentTime = 0; return; }
      if (this.currentIndex > 0) this.currentIndex -= 1;
      else if (this.repeat === "all") this.currentIndex = this.queue.length - 1;
      else { this.currentTime = 0; return; }
      this.isPlaying = true;
      const s = this.currentSong;
      if (s) {
        if (s.source === "netease" && s.neteaseId) {
          // 并行获取 URL 和歌词
          const urlP = !s.url ? this._ensureNeteaseUrl(s) : Promise.resolve();
          const lrcP = !s.lrc ? this._ensureNeteaseLyrics(s).then(() => {
            if (this.currentSong?.id === s.id) this.loadLyrics(s);
          }) : Promise.resolve();
          await urlP;
          void lrcP;
        }
        if (s.lrc) this.loadLyrics(s);
        else this.lyrics = [];
      }
    },
    seek(t: number) { this.currentTime = t; },
    seekByFraction(f: number) { if (this.duration > 0) this.currentTime = Math.max(0, f * this.duration); },
    setVolume(v: number) { this.volume = Math.max(0, Math.min(1, v)); this.muted = this.volume === 0; },
    toggleMute() { this.muted = !this.muted; },
    toggleShuffle() { this.shuffle = !this.shuffle; },
    cycleRepeat() { this.repeat = this.repeat === "off" ? "all" : this.repeat === "all" ? "one" : "off"; },
    setTime(t: number) { this.currentTime = t; },
    setDuration(d: number) { this.duration = d; },
    setBuffered(b: number) { this.buffered = b; },
    setPlaying(p: boolean) { this.isPlaying = p; },
    updateActiveLyric() {
      if (this.lyrics.length === 0) { this.activeLyricIndex = -1; return; }
      let idx = -1;
      for (let i = 0; i < this.lyrics.length; i++) { if (this.lyrics[i].time <= this.currentTime) idx = i; else break; }
      this.activeLyricIndex = idx;
    },
    async loadLyrics(song: Song) {
      this.lyrics = []; this.activeLyricIndex = -1;
      // 网易云歌曲：如果歌词还没获取，先获取（与 URL 解耦）
      if (song.source === "netease" && song.neteaseId && !song.lrc) {
        await this._ensureNeteaseLyrics(song);
      }
      if (!song.lrc) return;
      // data URL 格式的歌词（网易云）
      if (song.lrc.startsWith("data:text/plain")) {
        try {
          const text = decodeURIComponent(song.lrc.split(",")[1] || "");
          const tlyricText = (song as any).tlyricText || "";
          this.lyrics = this._parseLrc(text, tlyricText);
        } catch { this.lyrics = []; }
        return;
      }
      try { this.lyrics = await fetchLyrics(song.lrc); } catch { this.lyrics = []; }
    },
    /** LRC 解析（用于网易云 data URL 歌词）
     *  原文 LRC 和翻译 tlyric 分开解析，然后按最近时间戳匹配翻译到原文行。
     *  这比合并文本方式更准确，能正确处理原文本身含括号的情况。 */
    _parseLrc(text: string, tlyricText = ""): LyricLine[] {
      const parseLines = (raw: string): { time: number; text: string }[] => {
        const out: { time: number; text: string }[] = [];
        const re = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
        for (const line of raw.split("\n")) {
          const matches = [...line.matchAll(re)];
          if (!matches.length) continue;
          const content = line.replace(re, "").trim();
          if (!content) continue;
          for (const m of matches) {
            const min = parseInt(m[1]), sec = parseInt(m[2]), ms = parseInt(m[3]);
            const time = min * 60 + sec + ms / 1000;
            out.push({ time, text: content });
          }
        }
        return out.sort((a, b) => a.time - b.time);
      };
      const origLines = parseLines(text);
      const transLines = tlyricText ? parseLines(tlyricText) : [];
      // 按最近时间戳匹配翻译
      for (const orig of origLines) {
        let bestDiff = 999;
        let bestTrans = "";
        for (const tl of transLines) {
          const diff = Math.abs(tl.time - orig.time);
          if (diff < bestDiff && diff < 3.0) {
            bestDiff = diff;
            bestTrans = tl.text;
          }
        }
        if (bestTrans) (orig as any).translation = bestTrans;
      }
      return origLines as LyricLine[];
    },
    pushHistory(song: Song) {
      this.history = this.history.filter(s => s.id !== song.id);
      this.history.unshift(song);
      if (this.history.length > 50) this.history.length = 50;
    },
    /** 保存当前会话到 localStorage（播放队列、进度、音量） */
    saveSession() {
      saveSession({
        queue: this.queue,
        currentIndex: this.currentIndex,
        currentTime: this.currentTime,
        volume: this.volume,
        muted: this.muted,
      });
    },
  },
});
