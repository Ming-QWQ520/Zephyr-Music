import { defineStore } from "pinia";
import type { Song, LyricLine, RepeatMode, ViewKey } from "@/types";
import { fetchLyrics } from "@/api/music";

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
    playNow(song: Song) {
      const idx = this.queue.findIndex(s => s.id === song.id);
      if (idx >= 0) this.currentIndex = idx;
      else { this.queue.push(song); this.currentIndex = this.queue.length - 1; }
      this.isPlaying = true; this.pushHistory(song); this.loadLyrics(song);
    },
    patchSong(id: string, patch: Partial<Song>) {
      const idx = this.queue.findIndex(s => s.id === id);
      if (idx >= 0) { this.queue[idx] = { ...this.queue[idx], ...patch }; if (idx === this.currentIndex && patch.lrc) this.loadLyrics(this.queue[idx]); }
    },
    playList(songs: Song[], start = 0) {
      this.queue = [...songs]; this.currentIndex = Math.max(0, Math.min(start, songs.length - 1));
      this.isPlaying = true; const s = this.currentSong; if (s) { this.pushHistory(s); this.loadLyrics(s); }
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
    next() {
      if (this.queue.length === 0) return;
      if (this.shuffle) { let n = Math.floor(Math.random() * this.queue.length); if (n === this.currentIndex && this.queue.length > 1) n = (n + 1) % this.queue.length; this.currentIndex = n; }
      else if (this.currentIndex < this.queue.length - 1) this.currentIndex += 1;
      else if (this.repeat === "all") this.currentIndex = 0;
      else { this.isPlaying = false; return; }
      this.isPlaying = true; const s = this.currentSong; if (s) this.loadLyrics(s);
    },
    prev() {
      if (this.queue.length === 0) return;
      if (this.currentTime > 3) { this.currentTime = 0; return; }
      if (this.currentIndex > 0) this.currentIndex -= 1;
      else if (this.repeat === "all") this.currentIndex = this.queue.length - 1;
      else { this.currentTime = 0; return; }
      this.isPlaying = true; const s = this.currentSong; if (s) this.loadLyrics(s);
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
      try { this.lyrics = await fetchLyrics(song.lrc); } catch { this.lyrics = []; }
    },
    pushHistory(song: Song) {
      this.history = this.history.filter(s => s.id !== song.id);
      this.history.unshift(song);
      if (this.history.length > 50) this.history.length = 50;
    },
  },
});
