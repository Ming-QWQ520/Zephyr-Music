import { defineStore } from "pinia";
import type { Song, LyricLine, RepeatMode, ViewKey } from "@/types";
import { fetchLyrics } from "@/api/music";
import { songUrlV1 as songUrl, lyricNew, lyric, parseYrc, personalFm, neteaseSongToSong, songChorus } from "@/api/netease";
import { log } from "@/composables/logger";
import { useSettings } from "@/composables/useSettings";
import { useToast } from "@/composables/useToast";
import { formatTime } from "@/utils/format";
import { invoke } from "@tauri-apps/api/core";

interface SessionData {
  queue: Song[];
  currentIndex: number;
  currentTime: number;
  volume: number;
  muted: boolean;
  /** 退出时是否处于私人漫游模式（恢复后继续漫游） */
  isPersonalRoam?: boolean;
}

/**
 * 播放列表（退出前的歌单数据）持久化到 exe 所在目录 data/playlist/playlist.json（明文 JSON）。
 *
 * 工作方式（与 settings store 一致的"内存缓存 + 异步落盘"模式）：
 *   - state() 同步读取 sessionCache（首次为 null → 空队列）
 *   - App.vue 启动时调用 initSessionCache() 从 playlist.json 异步加载到 sessionCache
 *   - 随后调用 store.restoreSession() 将缓存应用到 store 状态并触发歌曲恢复
 *   - saveSession() 同步更新缓存 + 异步调用 Rust save_playlist_json 落盘
 *
 * 落盘使用 Rust 端同步 fs::write，保证窗口关闭瞬间也能完成写入。
 */
let sessionCache: SessionData | null = null;
/** 挂起的落盘 Promise（供关闭前 flush 等待） */
let pendingSave: Promise<void> = Promise.resolve();
/** 漫游补充请求进行中标记（防止并发重复拉取） */
let _roamTopUpBusy = false;

/** 同步读取内存缓存（供 state() 初始化使用）。 */
function loadSession(): SessionData | null {
  return sessionCache;
}

/** 启动时调用：从 data/playlist/playlist.json 异步加载到 sessionCache。 */
export async function initSessionCache(): Promise<void> {
  try {
    const raw = await invoke<string | null>("load_playlist_json");
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.queue && Array.isArray(d.queue) && d.queue.length > 0) {
      sessionCache = d as SessionData;
    }
  } catch (e) {
    console.warn("[session] load playlist.json failed:", e);
  }
}

/** 异步落盘到 data/playlist/playlist.json（通过 Rust 同步 fs::write）。 */
function saveSessionToDisk(data: SessionData): void {
  pendingSave = invoke("save_playlist_json", { json: JSON.stringify(data) })
    .catch((e) => console.warn("[session] save playlist.json failed:", e))
    .then(() => undefined);
}

/** 等待所有挂起的落盘完成（供窗口关闭前调用）。 */
export function flushSession(): Promise<void> {
  return pendingSave;
}

/** 高潮点请求的共享 Promise（避免同一首歌并发调用 preloadChorus 时发多次请求） */
let _chorusPromise: Promise<void> | null = null;
let _chorusTargetId: string | null = null;

/** 音频字节预加载函数（由 App.vue 在 useAudioBinding 后注入）。
 *  - 用于切歌前的音频数据预拉，让浏览器 HTTP 缓存提前命中，
 *    主 audio 元素切歌时直接读缓存，秒切无网络等待。
 *  - 仅在网络串流（HTMLAudioElement）场景有意义；Rodio 由 Rust 处理。 */
let _preloadAudioDataFn: ((url: string) => void) | null = null;

/** 注入音频字节预加载函数（App.vue 在 useAudioBinding 后调用） */
export function setPreloadAudioDataFn(fn: ((url: string) => void) | null) {
  _preloadAudioDataFn = fn;
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
  /** 是否处于私人漫游模式（每日推荐歌曲，单首播放，不感兴趣换歌） */
  isPersonalRoam: boolean;
  /** 视图历史栈，用于返回上一页 */
  viewHistory: ViewKey[];
  /** 当前歌单 ID 历史，用于返回上一歌单 */
  playlistIdHistory: (number | null)[];
  /** 高潮点 / 副歌开始时间（秒）。null 表示无数据 / 加载中 / 非网易云。
   *  由 preloadChorus() 在切歌时异步获取，PlayerBar 与 NowPlaying 共享同一份，
   *  避免两处分别请求导致不同步。 */
  chorusStart: number | null;
  /** 用户主动 seek 的版本号（仅 seek/seekByFraction 递增，setTime 不算）。
   *  供逐字歌词在同一行内 seek 时重建 CSS 动画延迟使用。 */
  seekVersion: number;
}

export const usePlayerStore = defineStore("player", {
  state: (): State => {
    const session = loadSession();
    return {
      queue: session?.queue || [], currentIndex: session?.currentIndex ?? -1, isPlaying: false,
      currentTime: session?.currentTime || 0, duration: 0, buffered: 0,
      volume: session?.volume ?? 0.8, muted: session?.muted ?? false, shuffle: false, repeat: "all",
      lyrics: [], activeLyricIndex: -1,
      currentView: "recommend", searchKeyword: "", history: [],
      previousView: null,
      pendingPlaylistId: null,
      sourcePlaylistId: null,
      isPersonalRoam: false,
      viewHistory: [],
      playlistIdHistory: [],
      chorusStart: null,
      seekVersion: 0,
    } as State;
  },
  getters: {
    currentSong(s): Song | null { return s.currentIndex >= 0 && s.currentIndex < s.queue.length ? s.queue[s.currentIndex] : null; },
    // 私人漫游模式下始终可以"下一首"（快到队尾会自动补充推荐）
    hasNext(s): boolean { return s.queue.length > 0 && (s.isPersonalRoam || s.repeat === "all" || s.currentIndex < s.queue.length - 1); },
    hasPrev(s): boolean { return s.queue.length > 0 && (s.repeat === "all" || s.currentIndex > 0); },
    progress(s): number { return s.duration > 0 ? Math.min(1, s.currentTime / s.duration) : 0; },
    bufferedFrac(s): number { return s.duration > 0 ? Math.min(1, s.buffered / s.duration) : 0; },
    canGoBack(s): boolean { return s.viewHistory.length > 0; },
    /** 进度条上的高潮点标记位置（0~1，超出范围返回 null） */
    chorusMarkFrac(s): number | null {
      if (s.chorusStart === null || s.duration <= 0) return null;
      const f = s.chorusStart / s.duration;
      return f > 0 && f < 1 ? f : null;
    },
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
      this.isPersonalRoam = false; // 手动播放退出私人漫游模式
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
      } else {
        // 非网易云：立即清空高潮点
        this.chorusStart = null;
      }
      const idx = this.queue.findIndex(s => s.id === song.id);
      if (idx >= 0) this.currentIndex = idx;
      else { this.queue.push(song); this.currentIndex = this.queue.length - 1; }
      this.isPlaying = true; this.pushHistory(song);
      // 立即加载已有歌词（如果之前已缓存）
      if (song.lrc) this.loadLyrics(song);
      else this.lyrics = [];
      // 后台加载高潮点（网易云歌曲）
      void this.preloadChorus();
      // 后台预加载下一首（受 settings.preloadNextSong 开关控制）
      void this._preloadNextSong();
    },

    /** 播放歌单。网易云歌曲需要逐个获取 URL（首次播放时懒加载）。 */
    async playList(songs: Song[], start = 0) {
      this.isPersonalRoam = false;
      const idx = Math.max(0, Math.min(start, songs.length - 1));
      const s = songs[idx];
      if (s) {
        // 先获取 URL，再设置 queue（避免 URL 为空时 watch 清除播放）
        if (s.source === "netease" && s.neteaseId && !s.url) {
          await this._ensureNeteaseUrl(s);
        }
        // 并行获取歌词
        if (s.source === "netease" && s.neteaseId && !s.lrc) {
          void this._ensureNeteaseLyrics(s).then(() => {
            if (this.currentSong?.id === s.id) this.loadLyrics(s);
          });
        }
      }
      this.queue = [...songs];
      this.currentIndex = idx;
      this.isPlaying = true;
      if (s) {
        this.pushHistory(s);
        if (s.lrc) this.loadLyrics(s);
        else this.lyrics = [];
      }
      // 后台加载高潮点（网易云歌曲）
      void this.preloadChorus();
      // 后台预加载下一首（受 settings.preloadNextSong 开关控制）
      void this._preloadNextSong();
    },

    /** 下一首播放（插入到当前歌曲后面） */
    async playNextSong(song: Song) {
      if (song.source === "netease" && song.neteaseId && !song.url) {
        await this._ensureNeteaseUrl(song);
      }
      this.queue.splice(this.currentIndex + 1, 0, song);
    },

    /** 播放队列中指定位置的歌曲。
     *  统一处理 URL/歌词按需获取——恢复会话后队列中的歌曲 URL 为空，
     *  直接设置 currentIndex 不获取 URL 会导致点击无声。 */
    async playAt(idx: number) {
      if (idx < 0 || idx >= this.queue.length) return;
      this.currentIndex = idx;
      this.isPlaying = true;
      const s = this.currentSong;
      if (s) this.pushHistory(s);
      const ok = await this._prepareCurrentSong();
      if (this.isPersonalRoam) void this._roamTopUp(); // 漫游模式：跳到队尾附近时补充推荐
      if (!ok && this.currentSong) {
        useToast().warning("无法播放", `「${this.currentSong.name}」获取播放地址失败（VIP 或无版权）`);
      }
    },

    // ===== 私人漫游（网易云 PC 端"漫游"/私人FM）=====
    // 基于 /personal_fm：每次返回 1~3 首推荐，播放快到队尾时自动追加，
    // 形成无限流式播放。手动播放其他歌曲(playNow/playList)会退出漫游模式。

    /** 拉取一批漫游推荐歌曲 */
    async _fetchRoamSongs(): Promise<Song[]> {
      try {
        const res = await personalFm();
        return (res.data || []).map(neteaseSongToSong);
      } catch (e) {
        log.warn("player", "personal fm fetch failed", { error: String(e) });
        return [];
      }
    },

    /** 漫游队列补充：队尾剩余不足 2 首时拉取新推荐追加（去重，最多尝试 3 轮） */
    async _roamTopUp() {
      if (_roamTopUpBusy) return;
      _roamTopUpBusy = true;
      try {
        let rounds = 0;
        while (this.isPersonalRoam && this.queue.length - 1 - this.currentIndex < 2 && rounds < 3) {
          rounds++;
          const more = await this._fetchRoamSongs();
          if (!this.isPersonalRoam) return; // 拉取期间用户退出了漫游
          const fresh = more.filter(m => !this.queue.some(q => q.id === m.id));
          if (fresh.length === 0) continue;
          this.queue.push(...fresh);
        }
      } finally {
        _roamTopUpBusy = false;
      }
    },

    /** 开始私人漫游：拉取推荐替换队列并播放。返回是否成功开始。 */
    async startPersonalRoam(): Promise<boolean> {
      const songs = await this._fetchRoamSongs();
      if (songs.length === 0) return false;
      this.isPersonalRoam = true;
      this.sourcePlaylistId = null;
      this.shuffle = false;
      const first = songs[0];
      if (first.neteaseId && !first.url) await this._ensureNeteaseUrl(first);
      this.queue = songs;
      this.currentIndex = 0;
      this.isPlaying = true;
      this.pushHistory(first);
      if (first.neteaseId && !first.lrc) {
        void this._ensureNeteaseLyrics(first).then(() => {
          if (this.currentSong?.id === first.id) this.loadLyrics(first);
        });
      }
      if (first.lrc) this.loadLyrics(first);
      else this.lyrics = [];
      void this._roamTopUp(); // 后台预取下一批
      return true;
    },

    /** 退出私人漫游模式（保留当前队列，仅关闭自动补充） */
    stopPersonalRoam() { this.isPersonalRoam = false; },

    /** 网易云歌曲：获取播放 URL，patch 回 queue。
     *  网络请求失败时自动重试（应对启动初期网络未就绪等瞬时故障）。
     *  返回是否成功拿到 URL。API 正常返回但无 URL（VIP/无版权）时不重试。 */
    async _ensureNeteaseUrl(song: Song, retries = 2): Promise<boolean> {
      if (!song.neteaseId) return false;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const { settings } = useSettings();
          const level = (settings as any).audioLevel || "exhigh";
          const res = await songUrl(song.neteaseId, level);
          const d = res.data?.[0];
          if (d?.url) {
            // 网易云 API 返回 http:// URL（带尾部斜杠），实际加载会触发 302 重定向：
            //   http://m.../jdymusic/.../<id>/ → https://m.../jdymusic/.../<id>
            // 重定向响应无 Cache-Control 不被缓存，每次切歌都要走一遍网络往返（3-23 秒）。
            // 这里直接升级 https:// 并去尾斜杠，跳过 302，主 audio 元素和 preload 都直读 CDN 缓存。
            let finalUrl = d.url;
            if (finalUrl.startsWith("http://")) {
              finalUrl = "https://" + finalUrl.slice("http://".length);
            }
            if (finalUrl.endsWith("/")) finalUrl = finalUrl.slice(0, -1);
            song.url = finalUrl;
            const idx = this.queue.findIndex(s => s.id === song.id);
            if (idx >= 0) this.queue[idx].url = finalUrl;
            return true;
          }
          // 请求成功但无 URL：VIP 专享/无版权等，重试无意义
          log.warn("player", "song url empty (VIP/copyright?)", { id: song.neteaseId, name: song.name });
          return false;
        } catch (e) {
          log.warn("player", "song url fetch failed", { id: song.neteaseId, attempt, error: String(e) });
          if (attempt < retries) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      return false;
    },

    /** 网易云歌词获取：优先逐字 yrc，回退普通 lrc
     *  forceUseYrc（默认 true）：即使 parseYrc 解析为空也存储 yrcText，
     *  让逐字渲染器有机会尝试解析；并优先使用 yrc 而非回退到 lrc。
     */
    async _ensureNeteaseLyrics(song: Song) {
      if (!song.neteaseId) return;
      // lrc 和 yrcText 都已缓存才跳过（forceUseYrc 时 yrcText 缺失也要重新获取）
      if (song.lrc && (song as any).yrcText) return;
      const { settings } = useSettings();
      const forceUseYrc = settings.forceUseYrc;
      let lrcText = "";
      let tlyric = "";
      try {
        const newRes = await lyricNew(song.neteaseId);
        log.info("lyrics", "lyricNew response", { keys: Object.keys(newRes), hasYrc: !!newRes.yrc?.lyric, hasLrc: !!newRes.lrc?.lyric, songId: song.neteaseId, songName: song.name, forceUseYrc });
        if (newRes.yrc?.lyric) {
          const parsed = parseYrc(newRes.yrc.lyric);
          log.info("lyrics", "yrc parsed", { lines: parsed.length, firstLine: parsed[0]?.text || "" });
          if (parsed.length > 0 || forceUseYrc) {
            // 存储原始 yrc 文本到 song 上（用于逐字渲染）
            // forceUseYrc 时即使 parseYrc 解析为空也存储 yrcText，
            // 让逐字渲染器 (parseYrcLines) 有机会用更宽松的解析器渲染逐字效果。
            (song as any).yrcText = newRes.yrc.lyric;
            const idx2 = this.queue.findIndex(s => s.id === song.id);
            if (idx2 >= 0) (this.queue[idx2] as any).yrcText = newRes.yrc.lyric;
            // 转标准 LRC 格式（用于非逐字回退显示）
            if (parsed.length > 0) {
              lrcText = parsed.map(l => {
                const min = String(Math.floor(l.time / 60)).padStart(2, "0");
                const sec = String(Math.floor(l.time % 60)).padStart(2, "0");
                const ms = String(Math.floor((l.time % 1) * 1000)).padStart(3, "0").slice(0, 2);
                return `[${min}:${sec}.${ms}]${l.text}`;
              }).join("\n");
              log.info("lyrics", "using yrc (逐字歌词)", { lrcLen: lrcText.length });
            } else {
              log.info("lyrics", "forceUseYrc: stored yrcText but parseYrc returned 0 lines", { yrcLen: newRes.yrc.lyric.length });
            }
          }
        }
        // /lyric/new 同时返回 lrc 和 tlyric，无需再调用 /lyric
        // 注意：forceUseYrc 时若 yrc 已存储但 lrcText 仍为空（parseYrc 解析为空），
        // 仍需 lrc 用作逐字渲染器的时间戳底图（歌词渲染需要 .lyrics 数组）。
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

    /** 加载当前歌曲的高潮点（/song/chorus）。仅网易云歌曲。
     *  统一在 store 处理，避免 PlayerBar 与 NowPlaying 各自请求导致不同步。
     *  非网易云歌曲或无 neteaseId → 立即清空 chorusStart。
     *  带 Promise 共享：同一首歌并发调用时只发一次真实请求，避免重复请求浪费带宽。 */
    async preloadChorus() {
      const song = this.currentSong;
      if (!song || song.source !== "netease" || !song.neteaseId) {
        this.chorusStart = null;
        return;
      }
      const targetId = song.id;
      const targetNeteaseId = song.neteaseId;
      // 立即清空旧值（避免切歌瞬间显示上一首的高潮点）
      this.chorusStart = null;

      // Promise 共享：同一首歌已有请求在飞则复用，不重复发请求
      if (_chorusPromise && _chorusTargetId === targetId) {
        log.info("chorus", "preloadChorus: sharing in-flight request", { targetId });
        return _chorusPromise;
      }
      _chorusTargetId = targetId;
      _chorusPromise = (async () => {
        try {
          const res = await songChorus(targetNeteaseId);
          // 竞态保护：若期间歌曲已切换，不写入
          if (this.currentSong?.id !== targetId) {
            log.info("chorus", "skipped stale chorus response", { targetId, currentId: this.currentSong?.id });
            return;
          }
          const list = res.chorus || res.data || [];
          const first = list[0];
          if (first && typeof first.startTime === "number") {
            this.chorusStart = Math.max(0, Math.floor(first.startTime / 1000));
            log.info("chorus", "chorus loaded", {
              songId: targetNeteaseId, start: this.chorusStart,
              text: formatTime(this.chorusStart),
            });
          } else {
            log.info("chorus", "chorus empty", { songId: targetNeteaseId });
          }
        } catch (e) {
          log.warn("chorus", "load chorus failed", { songId: targetNeteaseId, error: String(e) });
        } finally {
          _chorusPromise = null;
          _chorusTargetId = null;
        }
      })();
      return _chorusPromise;
    },

    /** 跳到高潮点开始处播放。若已有高潮点数据则直接 seek。 */
    jumpToChorus() {
      if (this.chorusStart === null) return;
      this.seek(this.chorusStart);
      if (!this.isPlaying) this.togglePlay();
      useToast().info("高潮点", `已跳转至 ${formatTime(this.chorusStart)}`);
    },

    /** 预加载下一首歌的音频 URL 和歌词（后台异步，不阻塞当前播放）。
     *  在 _prepareCurrentSong 完成后触发；受 settings.preloadNextSong 开关控制。
     *  - 不预取高潮点（chorus 由切歌后 preloadChorus 处理）
     *  - 随机播放模式下不预加载（下次切歌会随机选，预加载命中概率太低）
     *  - 单曲循环模式下也预加载下一首（用户随时可能手动切下一首）
     *  - 私人漫游模式下，下一首可能还没在队列里，由 _roamTopUp 负责预取推荐歌曲 */
    async _preloadNextSong() {
      try {
        const { settings } = useSettings();
        if (!settings.preloadNextSong) return;
        if (this.queue.length === 0) return;
        // 随机播放：下一首是随机的，预加载命中概率太低，跳过
        if (this.shuffle) return;
        // 计算下一首 index
        let nextIdx = -1;
        if (this.isPersonalRoam) {
          nextIdx = this.currentIndex + 1;
          // 漫游模式：若队列还没补充到下一首，由 _roamTopUp 负责；这里不重复
          if (nextIdx >= this.queue.length) return;
        } else if (this.currentIndex < this.queue.length - 1) {
          nextIdx = this.currentIndex + 1;
        } else if (this.repeat === "all") {
          nextIdx = 0;
        } else {
          return; // 列表末端、非循环，无下一首
        }
        if (nextIdx < 0 || nextIdx >= this.queue.length) return;
        const nextSong = this.queue[nextIdx];
        if (!nextSong || nextSong.source !== "netease" || !nextSong.neteaseId) return;
        // 已加载（有 url 且有 lrc）则跳过 API 请求，但仍触发音频字节预加载
        if (nextSong.url && nextSong.lrc) {
          log.info("preload", "next song url+lrc already cached, skip API; trigger audio preload", { name: nextSong.name });
          if (nextSong.url && _preloadAudioDataFn) {
            _preloadAudioDataFn(nextSong.url);
          }
          return;
        }
        log.info("preload", "→ preloading next song", { idx: nextIdx, name: nextSong.name, hasUrl: !!nextSong.url, hasLrc: !!nextSong.lrc });
        const urlP = nextSong.url ? Promise.resolve(true) : this._ensureNeteaseUrl(nextSong);
        const lrcP = nextSong.lrc ? Promise.resolve() : this._ensureNeteaseLyrics(nextSong);
        // 预加载与播放解耦，不 await，失败也不影响播放
        void Promise.all([urlP, lrcP]).then(([ok]) => {
          log.info("preload", "← next song preloaded", {
            name: nextSong.name,
            hasUrl: !!nextSong.url, hasLrc: !!nextSong.lrc, urlOk: ok,
          });
          // URL 拿到后，触发音频字节预加载（让浏览器 HTTP 缓存提前命中，
          // 切歌时主 audio 元素读缓存秒切）
          if (ok && nextSong.url && _preloadAudioDataFn) {
            _preloadAudioDataFn(nextSong.url);
          }
        }).catch((e) => {
          log.warn("preload", "preload next song failed", { name: nextSong.name, error: String(e) });
        });
      } catch (e) {
        log.warn("preload", "_preloadNextSong error", { error: String(e) });
      }
    },

    patchSong(id: string, patch: Partial<Song>) {
      const idx = this.queue.findIndex(s => s.id === id);
      if (idx >= 0) { this.queue[idx] = { ...this.queue[idx], ...patch }; if (idx === this.currentIndex && patch.lrc) this.loadLyrics(this.queue[idx]); }
    },
    /** 加入队列末尾（最后一首播放）。如果已存在则移动到末尾，不重复添加。 */
    addToQueue(song: Song) {
      const existingIdx = this.queue.findIndex(s => s.id === song.id);
      if (existingIdx >= 0) {
        // 已存在：移动到末尾
        if (existingIdx === this.queue.length - 1) return; // 已在末尾
        this.queue.splice(existingIdx, 1);
        // 调整 currentIndex（如果移除的是当前歌曲之前的位置）
        if (existingIdx < this.currentIndex) this.currentIndex -= 1;
        else if (existingIdx === this.currentIndex) this.currentIndex = this.queue.length; // 将在 push 后修正
        this.queue.push(song);
        if (existingIdx === this.currentIndex) this.currentIndex = this.queue.length - 1;
      } else {
        this.queue.push(song);
      }
    },
    /** 下一首播放（插入到当前歌曲后面）。如果已存在则移动到当前位置后面，不重复添加。 */
    playNext(song: Song) {
      const existingIdx = this.queue.findIndex(s => s.id === song.id);
      const insertIdx = this.currentIndex + 1;
      if (existingIdx >= 0) {
        // 已存在：移动到当前位置后面
        if (existingIdx === insertIdx) return; // 已在目标位置
        // 先移除
        this.queue.splice(existingIdx, 1);
        // 调整插入位置：如果移除的在插入位置之前，插入位置减1
        const adjustedInsert = existingIdx < insertIdx ? insertIdx - 1 : insertIdx;
        // 调整 currentIndex：如果移除的在当前歌曲之前，currentIndex 减1
        if (existingIdx < this.currentIndex) this.currentIndex -= 1;
        this.queue.splice(adjustedInsert, 0, song);
      } else {
        this.queue.splice(insertIdx, 0, song);
      }
    },
    /** 拖拽移动队列内歌曲：从 fromIdx 移动到 toIdx */
    moveInQueue(fromIdx: number, toIdx: number) {
      if (fromIdx < 0 || fromIdx >= this.queue.length) return;
      if (toIdx < 0 || toIdx >= this.queue.length) return;
      if (fromIdx === toIdx) return;
      const [moved] = this.queue.splice(fromIdx, 1);
      // 从前往后拖时，移除后 toIdx 已前移一位，需要 -1 才能插入到目标位置前面
      // 从后往前拖时，toIdx 不变，直接插入
      const insertIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
      this.queue.splice(insertIdx, 0, moved);
      // 调整 currentIndex
      if (fromIdx === this.currentIndex) {
        this.currentIndex = insertIdx;
      } else if (fromIdx < this.currentIndex && insertIdx >= this.currentIndex) {
        this.currentIndex -= 1;
      } else if (fromIdx > this.currentIndex && insertIdx <= this.currentIndex) {
        this.currentIndex += 1;
      }
    },
    /** 清空播放队列 */
    clearQueue() {
      this.queue = [];
      this.currentIndex = -1;
      this.isPlaying = false;
      this.lyrics = [];
      this.activeLyricIndex = -1;
    },
    removeFromQueue(index: number) {
      if (index < 0 || index >= this.queue.length) return;
      const wasCurrent = index === this.currentIndex;
      this.queue.splice(index, 1);
      if (wasCurrent) {
        if (this.queue.length === 0) { this.currentIndex = -1; this.isPlaying = false; }
        else if (index <= this.currentIndex) this.currentIndex = Math.max(0, this.currentIndex - 1);
      } else if (index < this.currentIndex) this.currentIndex -= 1;
    },
    togglePlay() {
      if (this.queue.length === 0) return;
      const willPlay = !this.isPlaying;
      this.isPlaying = willPlay;
      // 自愈：URL 缺失（启动恢复时获取失败/URL 过期被清空）时重新获取。
      // URL 到位后 useAudioBinding 的 url watch 检测到 isPlaying=true 会自动开始播放。
      const s = this.currentSong;
      if (willPlay && s && s.source === "netease" && s.neteaseId && !s.url) {
        void this._ensureNeteaseUrl(s).then((ok) => {
          if (!ok && this.currentSong?.id === s.id) {
            this.isPlaying = false;
            useToast().error("无法播放", "获取播放地址失败，请检查网络后重试");
          }
        });
      }
    },
    /** 加载当前歌曲的 URL（等待）+ 歌词（后台）+ 高潮点（后台）。返回 URL 是否可用。 */
    async _prepareCurrentSong(): Promise<boolean> {
      const s = this.currentSong;
      if (!s) return false;
      let ok = true;
      if (s.source === "netease" && s.neteaseId) {
        const urlP = !s.url ? this._ensureNeteaseUrl(s) : Promise.resolve(true);
        const lrcP = !s.lrc ? this._ensureNeteaseLyrics(s).then(() => {
          if (this.currentSong?.id === s.id) this.loadLyrics(s);
        }) : Promise.resolve();
        // 高潮点：后台加载（与 url/lrc 解耦，不阻塞播放）
        void this.preloadChorus();
        ok = await urlP;
        void lrcP;
      } else {
        // 非网易云歌曲：清空高潮点
        this.chorusStart = null;
        ok = !!s.url;
      }
      if (s.lrc) this.loadLyrics(s);
      else this.lyrics = [];
      // 当前歌曲准备完成后，后台预加载下一首歌（受 settings.preloadNextSong 开关控制）
      void this._preloadNextSong();
      return ok;
    },
    /** 下一首。
     *  - 私人漫游模式：始终向前，快到队尾自动拉取新推荐追加
     *  - 无法播放的歌曲（VIP 专享/无版权/获取失败）自动跳过，最多连跳 5 首 */
    async next(_skipCount = 0): Promise<void> {
      if (this.queue.length === 0) return;
      if (this.isPersonalRoam) {
        // 漫游模式：忽略随机/循环，永远向前
        if (this.currentIndex >= this.queue.length - 1) {
          await this._roamTopUp();
        }
        if (this.currentIndex < this.queue.length - 1) this.currentIndex += 1;
        else { this.isPlaying = false; useToast().error("漫游中断", "获取推荐歌曲失败，请稍后重试"); return; }
      }
      else if (this.shuffle) { let n = Math.floor(Math.random() * this.queue.length); if (n === this.currentIndex && this.queue.length > 1) n = (n + 1) % this.queue.length; this.currentIndex = n; }
      else if (this.currentIndex < this.queue.length - 1) this.currentIndex += 1;
      else if (this.repeat === "all") this.currentIndex = 0;
      else { this.isPlaying = false; return; }
      this.isPlaying = true;
      const ok = await this._prepareCurrentSong();
      if (this.isPersonalRoam) void this._roamTopUp(); // 漫游：继续预取，保证下一首随时可放
      if (!ok && _skipCount < 5 && this.queue.length > 1) {
        const skipped = this.currentSong;
        if (skipped) useToast().warning("已跳过", `「${skipped.name}」无法播放（VIP 或无版权）`);
        return this.next(_skipCount + 1);
      }
    },
    async prev() {
      if (this.queue.length === 0) return;
      // 直接切换到上一首，无论当前进度
      if (this.currentIndex > 0) this.currentIndex -= 1;
      else if (this.repeat === "all" && !this.isPersonalRoam) this.currentIndex = this.queue.length - 1;
      else { this.currentTime = 0; return; }
      this.isPlaying = true;
      await this._prepareCurrentSong();
    },
    seek(t: number) { this.currentTime = t; this.seekVersion++; },
    seekByFraction(f: number) { if (this.duration > 0) { this.currentTime = Math.max(0, f * this.duration); this.seekVersion++; } },
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
      // 有逐字歌词时 activeLyricIndex 由 NpLyrics 的 rAF 逐帧更新，
      // 此处跳过避免 onTimeUpdate(~250ms) 与 rAF(~16ms) 冲突导致闪烁
      if ((this.currentSong as any)?.yrcText) return;
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
    /** 保存当前会话到 data/playlist/playlist.json（播放队列、进度、音量）。
     *  只保存歌曲 ID、名称、歌手等最小信息，不保存 URL（URL 会过期）。
     *  恢复时通过 _ensureNeteaseUrl 重新获取 URL。
     *  同步更新内存缓存 + 异步调用 Rust 落盘（不阻塞 UI）。 */
    saveSession() {
      const slimQueue = this.queue.map((s) => ({
        id: s.id,
        name: s.name,
        artist: s.artist,
        pic: s.pic,
        source: s.source,
        neteaseId: s.neteaseId,
        duration: s.duration,
        url: "", // 清空 URL，恢复时重新获取
        lrc: "",
      }));
      const data: SessionData = {
        queue: slimQueue,
        currentIndex: this.currentIndex,
        currentTime: this.currentTime,
        volume: this.volume,
        muted: this.muted,
        isPersonalRoam: this.isPersonalRoam,
      };
      sessionCache = data;
      saveSessionToDisk(data);
    },
    /** 将 initSessionCache() 加载到的缓存应用到 store 状态。
     *  仅在当前队列为空（冷启动）时应用，避免覆盖运行中的状态。
     *  返回是否有歌曲需要恢复（供 App.vue 触发 restoreLastSong）。 */
    restoreSession(): boolean {
      if (!sessionCache || this.queue.length > 0) return false;
      this.queue = sessionCache.queue;
      this.currentIndex = sessionCache.currentIndex;
      this.currentTime = sessionCache.currentTime;
      this.volume = sessionCache.volume;
      this.muted = sessionCache.muted;
      this.isPersonalRoam = sessionCache.isPersonalRoam ?? false;
      return !!this.currentSong;
    },
  },
});
