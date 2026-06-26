import { defineStore } from "pinia";
import type { Song, LyricLine, RepeatMode, ViewKey } from "@/types";
import { fetchLyrics } from "@/api/music";
import { songUrlV1 as songUrl, lyric, type NeteaseSong } from "@/api/netease";

interface State {
  queue: Song[]; currentIndex: number; isPlaying: boolean;
  currentTime: number; duration: number; buffered: number;
  volume: number; muted: boolean; shuffle: boolean; repeat: RepeatMode;
  lyrics: LyricLine[]; activeLyricIndex: number;
  currentView: ViewKey; searchKeyword: string; history: Song[];
  previousView: ViewKey | null;
}

export const usePlayerStore = defineStore("player", {
  state: (): State => ({
    queue: [], currentIndex: -1, isPlaying: false,
    currentTime: 0, duration: 0, buffered: 0,
    volume: 0.8, muted: false, shuffle: false, repeat: "off",
    lyrics: [], activeLyricIndex: -1,
    currentView: "search", searchKeyword: "", history: [],
    previousView: null,
  }),
  getters: {
    currentSong(s): Song | null { return s.currentIndex >= 0 && s.currentIndex < s.queue.length ? s.queue[s.currentIndex] : null; },
    hasNext(s): boolean { return s.queue.length > 0 && (s.repeat === "all" || s.currentIndex < s.queue.length - 1); },
    hasPrev(s): boolean { return s.queue.length > 0 && (s.repeat === "all" || s.currentIndex > 0); },
    progress(s): number { return s.duration > 0 ? Math.min(1, s.currentTime / s.duration) : 0; },
    bufferedFrac(s): number { return s.duration > 0 ? Math.min(1, s.buffered / s.duration) : 0; },
  },
  actions: {
    setView(v: ViewKey) { this.currentView = v; },
    openFullscreenPlayer() { if (this.currentView !== "nowplaying") this.previousView = this.currentView; this.currentView = "nowplaying"; },
    closeFullscreenPlayer() { this.currentView = this.previousView || "search"; this.previousView = null; },
    setSearchKeyword(kw: string) { this.searchKeyword = kw; },

    /** 播放一首歌。如果是网易云歌曲（source=netease），动态获取 URL 和歌词。 */
    async playNow(song: Song) {
      // 网易云歌曲：动态获取播放 URL
      if (song.source === "netease" && song.neteaseId && !song.url) {
        await this._ensureNeteaseUrl(song);
      }
      const idx = this.queue.findIndex(s => s.id === song.id);
      if (idx >= 0) this.currentIndex = idx;
      else { this.queue.push(song); this.currentIndex = this.queue.length - 1; }
      this.isPlaying = true; this.pushHistory(song); this.loadLyrics(song);
    },

    /** 播放歌单。网易云歌曲需要逐个获取 URL（首次播放时懒加载）。 */
    async playList(songs: Song[], start = 0) {
      this.queue = [...songs];
      this.currentIndex = Math.max(0, Math.min(start, songs.length - 1));
      this.isPlaying = true;
      const s = this.currentSong;
      if (s) {
        if (s.source === "netease" && s.neteaseId && !s.url) {
          await this._ensureNeteaseUrl(s);
        }
        this.pushHistory(s); this.loadLyrics(s);
      }
    },

    /** 下一首播放（插入到当前歌曲后面） */
    async playNextSong(song: Song) {
      if (song.source === "netease" && song.neteaseId && !song.url) {
        await this._ensureNeteaseUrl(song);
      }
      this.queue.splice(this.currentIndex + 1, 0, song);
    },

    /** 网易云歌曲：获取播放 URL + 歌词 URL，patch 回 queue */
    async _ensureNeteaseUrl(song: Song) {
      if (!song.neteaseId) return;
      try {
        const res = await songUrl(song.neteaseId);
        const d = res.data?.[0];
        if (d?.url) {
          song.url = d.url;
          // patch queue 里的对应歌曲
          const idx = this.queue.findIndex(s => s.id === song.id);
          if (idx >= 0) this.queue[idx].url = d.url;
        }
      } catch { /* ignore */ }
      // 获取歌词 URL（用 data URL 形式存储，避免额外请求）
      if (!song.lrc && song.neteaseId) {
        try {
          const lrcRes = await lyric(song.neteaseId);
          if (lrcRes.lrc?.lyric) {
            // 把歌词内容存成 data URL，fetchLyrics 能直接解析
            const lrcText = lrcRes.lrc.lyric;
            const tlyric = lrcRes.tlyric?.lyric || "";
            const fullLrc = tlyric ? lrcText + "\n" + tlyric : lrcText;
            song.lrc = "data:text/plain;charset=utf-8," + encodeURIComponent(fullLrc);
            const idx = this.queue.findIndex(s => s.id === song.id);
            if (idx >= 0) this.queue[idx].lrc = song.lrc;
          }
        } catch { /* ignore */ }
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
        if (s.source === "netease" && s.neteaseId && !s.url) await this._ensureNeteaseUrl(s);
        this.loadLyrics(s);
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
        if (s.source === "netease" && s.neteaseId && !s.url) await this._ensureNeteaseUrl(s);
        this.loadLyrics(s);
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
      if (!song.lrc) return;
      // data URL 格式的歌词（网易云）
      if (song.lrc.startsWith("data:text/plain")) {
        try {
          const text = decodeURIComponent(song.lrc.split(",")[1] || "");
          this.lyrics = this._parseLrc(text);
        } catch { this.lyrics = []; }
        return;
      }
      try { this.lyrics = await fetchLyrics(song.lrc); } catch { this.lyrics = []; }
    },
    /** 简单 LRC 解析（用于网易云 data URL 歌词） */
    _parseLrc(text: string): LyricLine[] {
      const lines: LyricLine[] = [];
      const re = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
      for (const raw of text.split("\n")) {
        const matches = [...raw.matchAll(re)];
        if (!matches.length) continue;
        const content = raw.replace(re, "").trim();
        if (!content) continue;
        for (const m of matches) {
          const min = parseInt(m[1]), sec = parseInt(m[2]), ms = parseInt(m[3]);
          const time = min * 60 + sec + ms / 1000;
          lines.push({ time, text: content });
        }
      }
      return lines.sort((a, b) => a.time - b.time);
    },
    pushHistory(song: Song) {
      this.history = this.history.filter(s => s.id !== song.id);
      this.history.unshift(song);
      if (this.history.length > 50) this.history.length = 50;
    },
  },
});
