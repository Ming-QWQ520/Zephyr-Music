/**
 * NowPlayingView 共享状态 composable
 *
 * 模块级 ref 单例模式（类似 useSettings）：所有子组件（NpBackground /
 * NpTopbar / NpCoverControls / NpLyrics / NpVisualizer / NpQueuePanel）
 * 共享同一份状态，避免 props drilling 过深。
 *
 * 这里只放跨组件共享的状态/逻辑。歌词渲染引擎内部状态（lyricWrapRef /
 * measuredHeights / transforms 等）保留在 NpLyrics.vue 内部，因为它们只
 * 服务于该组件本身。
 *
 * 单例生命周期：第一次调用 useNowPlaying() 时懒创建（确保 Pinia 已激活）。
 * 返回的 refs / computeds / 函数在整个应用生命周期内共享同一份。watcher
 * 永不卸载（因为是单例）—— 它们只 watch 应用级状态（store.currentSong 等），
 * 视图关闭时不产生副作用。
 */
import { ref, computed, watch, nextTick, effectScope, type Ref } from "vue";
import { usePlayerStore } from "@/stores/player";
import { formatTime } from "@/composables/utils";
import { log } from "@/composables/logger";
import { useToast } from "@/composables/useToast";
import { useSettings } from "@/composables/useSettings";
import { likeSong, getCachedLikeList, addLikeCache, removeLikeCache, songWikiSummary, type SongWikiSummary } from "@/api/netease";

// ===== PlayMode 常量（与 PlayerBar 共享语义） =====
export type PlayMode = "sequence" | "list" | "single" | "shuffle";
export const PLAY_MODE_ORDER: PlayMode[] = ["sequence", "list", "shuffle", "single"];
export const PLAY_MODE_LABEL: Record<PlayMode, string> = {
  sequence: "顺序播放",
  list: "列表循环",
  single: "单曲循环",
  shuffle: "随机播放",
};
export const PLAY_MODE_ICON: Record<PlayMode, string> = {
  sequence: "sequence",
  list: "repeat",
  single: "repeatOne",
  shuffle: "shuffle",
};

// ===== 音质 =====
export interface AudioLevel { key: string; label: string; }
export const audioLevels: AudioLevel[] = [
  { key: "standard", label: "标准" },
  { key: "higher", label: "较高" },
  { key: "exhigh", label: "极高" },
  { key: "lossless", label: "无损" },
  { key: "hires", label: "Hi-Res" },
  { key: "jyeffect", label: "高清环绕" },
  { key: "sky", label: "沉浸环绕" },
  { key: "dolby", label: "杜比全景" },
  { key: "jymaster", label: "超清母带" },
];

// ===== Lyric 解析数据结构（对外导出供 NpLyrics 复用） =====
export interface ParsedLyric {
  time: number;
  text: string;
  translation?: string;
  romaji?: string;
  isInterlude?: boolean;
  /** 逐字数据：如果歌曲有 yrc，这里存储每个字的时间信息 */
  words?: { start: number; duration: number; text: string }[];
  /** 括号内的中文补充歌词（换行显示） */
  subText?: string;
}
export interface YrcWord { start: number; duration: number; text: string; }
export interface YrcLine { startTime: number; words: YrcWord[]; text: string; }

/**
 * 解析完整 yrc 文本为结构化逐字行数组
 */
export function parseYrcLines(yrcText: string): YrcLine[] {
  const lines: YrcLine[] = [];
  for (const raw of yrcText.split("\n")) {
    const m = raw.match(/^\[(\d+),(\d+)\]/);
    if (!m) continue;
    const startTime = parseInt(m[1]) / 1000;
    const words: YrcWord[] = [];
    // 提取每个字：(startMs,durationMs,0)文字
    const wordRe = /\((\d+),(\d+),\d+\)([^(]+)/g;
    let wm;
    let fullText = "";
    while ((wm = wordRe.exec(raw)) !== null) {
      const wStart = parseInt(wm[1]) / 1000;
      const wDur = parseInt(wm[2]) / 1000;
      const wText = wm[3];
      words.push({ start: wStart, duration: wDur, text: wText });
      fullText += wText;
    }
    if (words.length > 0) {
      lines.push({ startTime, words, text: fullText.trim() });
    }
  }
  return lines;
}

/**
 * Parse a single raw lyric line. If the line ends with (xxx) or （xxx）
 * AND the content inside is primarily non-CJK (foreign text), treat it as
 * a translation. Chinese lyrics often use () for supplementary lyrics,
 * so we keep the brackets inline (no extraction) to avoid breaking the line.
 */
export function parseLyricLine(raw: string): { text: string; translation?: string; subText?: string } {
  const t = raw.trim();
  const m = t.match(/^(.*?)[(（]([^)）]+)[)）]\s*$/);
  if (m) {
    const mainText = m[1].trim();
    const inside = m[2].trim();
    const cjkCount = (inside.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    if (cjkCount === 0) {
      // 完全无CJK → 翻译
      return { text: mainText, translation: inside };
    } else {
      // 含CJK → 中文歌曲的补充歌词，保持原样不拆分
      return { text: t };
    }
  }
  return { text: t };
}

// ===== 单例懒创建 =====
let _api: NowPlayingApi | null = null;
/** 独立的 effect scope，确保 watchers 不会被绑定到任何组件的 setup scope
 *  （否则 NowPlayingView 卸载时 watchers 会被销毁，导致百科等自动刷新失效）。 */
const _singletonScope = effectScope(true);

export function useNowPlaying(): NowPlayingApi {
  if (!_api) {
    let api: NowPlayingApi;
    _singletonScope.run(() => {
      api = createApi();
    });
    _api = api!;
  }
  return _api;
}

function createApi() {
  const store = usePlayerStore();
  const { settings } = useSettings();
  const toast = useToast();

  // ----- 喜欢歌曲 -----
  const liked = ref(false);
  const likeLoading = ref(false);

  async function toggleLike() {
    const song = store.currentSong;
    if (!song || song.source !== "netease" || !song.neteaseId) return;
    likeLoading.value = true;
    try {
      const newLike = !liked.value;
      await likeSong(song.neteaseId, newLike);
      liked.value = newLike;
      if (newLike) addLikeCache(song.neteaseId);
      else removeLikeCache(song.neteaseId);
    } catch (e) {
      log.warn("nowplaying", "like failed", { error: String(e) });
    }
    likeLoading.value = false;
  }

  // ----- 布局状态 -----
  const showSettings = ref(false);
  const showQueue = ref(false);
  const showWiki = ref(false);
  const topbarVisible = ref(false);
  /** 播放列表 DOM 引用（NpQueuePanel 通过 template ref 绑定） */
  const qpListRef = ref<HTMLElement | null>(null);

  /** 歌曲百科数据 + 加载状态 */
  const wikiSummary = ref<SongWikiSummary | null>(null);
  const wikiLoading = ref(false);
  /** 已加载百科对应的歌曲 neteaseId，用于匹配判断是否需要刷新 */
  const wikiLoadedSongId = ref<number | null>(null);
  let _wikiPromise: Promise<void> | null = null;
  let _wikiTargetId: number | null = null;

  let hideTopbarTimer: ReturnType<typeof setTimeout> | null = null;

  function onMouseMove(e: MouseEvent) {
    // Only show topbar when mouse is in the top ~60px strip
    if (e.clientY < 60) {
      topbarVisible.value = true;
      if (hideTopbarTimer) clearTimeout(hideTopbarTimer);
      hideTopbarTimer = setTimeout(() => {
        if (!showSettings.value && !showQueue.value) topbarVisible.value = false;
      }, 2000);
    } else {
      if (topbarVisible.value && !showSettings.value && !showQueue.value) {
        topbarVisible.value = false;
      }
    }
  }

  function close() { store.closeFullscreenPlayer(); }

  async function toggleFullscreen() {
    try {
      const mod = await import("@tauri-apps/api/window");
      const w = mod.getCurrentWindow?.() ?? (mod as any).window?.();
      if (w) await w.toggleMaximize();
    } catch {}
  }

  /** 切换播放列表面板（立即显示并定位到当前播放歌曲） */
  function toggleQueue() {
    if (showQueue.value) { showQueue.value = false; return; }
    showQueue.value = true;
    nextTick(() => scrollQueueToCurrent(false));
  }

  /** ===== 歌曲百科 ===== */
  /** 拉取当前歌曲的百科数据（仅网易云歌曲）。带 Promise 共享避免重复请求。 */
  async function preloadWiki() {
    const s = store.currentSong;
    if (!s || s.source !== "netease" || !s.neteaseId) {
      wikiSummary.value = null;
      wikiLoadedSongId.value = null;
      return;
    }
    const targetId = s.neteaseId;
    // 已加载同一首歌的百科数据 → 不重复请求
    if (wikiLoadedSongId.value === targetId && wikiSummary.value) return;
    // Promise 共享：同一首歌已有请求在飞则复用
    if (_wikiPromise && _wikiTargetId === targetId) return _wikiPromise;
    // 新歌曲：立即清空旧数据（让 UI 进入 loading 态，避免显示上一首的百科）
    wikiSummary.value = null;
    wikiLoadedSongId.value = null;
    _wikiTargetId = targetId;
    _wikiPromise = (async () => {
      wikiLoading.value = true;
      try {
        const res = await songWikiSummary(targetId);
        // 竞态保护
        if (store.currentSong?.neteaseId !== targetId) {
          log.info("nowplaying", "skipped stale wiki response", { targetId });
          return;
        }
        wikiSummary.value = res;
        wikiLoadedSongId.value = targetId;
        log.info("nowplaying", "wiki loaded", {
          songId: targetId,
          blocksCount: res.blocks?.length || res.data?.blocks?.length || 0,
        });
      } catch (e) {
        log.warn("nowplaying", "load wiki failed", { songId: targetId, error: String(e) });
      } finally {
        wikiLoading.value = false;
        _wikiPromise = null;
        _wikiTargetId = null;
      }
    })();
    return _wikiPromise;
  }

  /** 切换百科面板：打开时按歌曲 ID 匹配，仅在 ID 不符时刷新 */
  function toggleWiki() {
    if (showWiki.value) {
      showWiki.value = false;
      return;
    }
    showWiki.value = true;
    // 匹配歌曲 ID：如果已加载的百科不是当前歌曲的，才重新拉取
    void preloadWiki();
  }

  /** 关闭百科面板 */
  function closeWiki() {
    showWiki.value = false;
  }

  /** 滚动播放列表到当前歌曲（直接设置 scrollTop，避免影响父容器滚动） */
  function scrollQueueToCurrent(smooth = true) {
    const idx = store.currentIndex;
    if (idx < 0 || !qpListRef.value) return;
    const list = qpListRef.value;
    const el = list.children[idx] as HTMLElement;
    if (!el) return;
    const targetTop = el.offsetTop - list.offsetTop;
    if (smooth) {
      list.scrollTo({ top: targetTop, behavior: "smooth" });
    } else {
      list.scrollTop = targetTop;
    }
  }

  // ----- PlayMode -----
  const playMode = computed<PlayMode>(() => {
    if (store.shuffle) return "shuffle";
    if (store.repeat === "one") return "single";
    if (store.repeat === "all") return "list";
    return "sequence";
  });
  function cyclePlayMode() {
    const idx = PLAY_MODE_ORDER.indexOf(playMode.value);
    const next = PLAY_MODE_ORDER[(idx + 1) % PLAY_MODE_ORDER.length];
    store.shuffle = false;
    if (store.repeat !== "off") store.repeat = "off";
    if (next === "list") store.repeat = "all";
    else if (next === "single") store.repeat = "one";
    else if (next === "shuffle") store.shuffle = true;
  }

  // ----- 音量 -----
  const volumeFrac = computed(() => (store.muted ? 0 : store.volume));
  function onVolume(f: number) { store.setVolume(f); }
  function toggleMute() { store.toggleMute(); }
  function onVolWheel(e: WheelEvent) {
    e.preventDefault();
    const step = 0.05;
    const delta = e.deltaY < 0 ? step : -step;
    const newVol = Math.max(0, Math.min(1, store.volume + delta));
    store.setVolume(newVol);
  }

  // ----- 进度 -----
  const progressFrac = computed(() => store.progress);
  function onSeek(f: number) { store.seekByFraction(f); }

  // ----- 高潮点 / 副歌时间（/song/chorus）-----
  // 单一数据源：在 player store 中预加载 chorusStart（切歌时触发），
  // PlayerBar 与 NowPlaying 共享同一份 chorusMarkFrac / jumpToChorus，避免两处不同步。
  const chorusMarkFrac = computed(() => store.chorusMarkFrac);
  function jumpToChorus() { store.jumpToChorus(); }


  // ----- 音质 -----
  function cycleAudioLevel() {
    const idx = audioLevels.findIndex(l => l.key === settings.audioLevel);
    const next = audioLevels[(idx + 1) % audioLevels.length];
    settings.audioLevel = next.key;
  }
  const currentLevelLabel = computed(() => {
    const l = audioLevels.find(l => l.key === settings.audioLevel);
    return l ? l.label : "标准";
  });

  // ----- Song / cover -----
  const song = computed(() => store.currentSong);
  const coverUrl = computed(() => {
    const pic = song.value?.pic || "";
    if (!pic) return "";
    // 网易云封面支持 ?param=NxN 控制清晰度
    const q = settings.coverQuality || 300;
    if (pic.includes("music.126.net")) {
      return pic.replace(/\?param=\d+x\d+/g, "") + `?param=${q}x${q}`;
    }
    return pic;
  });

  // ----- Lyric 解析（跨组件共享：NpLyrics 渲染 + cover-controls 进度条 tooltip） -----
  const yrcLines = ref<YrcLine[]>([]);

  const parsedLyrics = computed<ParsedLyric[]>(() => {
    const src = store.lyrics;

    // 如果有逐字歌词，直接用 yrcLines 作为歌词源（避免时间戳转换误差）
    if (yrcLines.value.length > 0) {
      const out: ParsedLyric[] = [];
      const transMap = new Map<number, string>();
      for (const cur of src) {
        if ((cur as any).translation) {
          transMap.set(Math.round(cur.time * 100), (cur as any).translation);
        }
      }

      for (let i = 0; i < yrcLines.value.length; i++) {
        const yl = yrcLines.value[i];
        const next = yrcLines.value[i + 1];
        const gap = next ? next.startTime - yl.startTime : 0;
        let translation = transMap.get(Math.round(yl.startTime * 100));
        if (!translation) {
          let bestDiff = 999;
          for (const cur of src) {
            if (!(cur as any).translation) continue;
            const diff = Math.abs(cur.time - yl.startTime);
            if (diff < bestDiff && diff < 3.0) {
              bestDiff = diff;
              translation = (cur as any).translation;
            }
          }
        }
        out.push({
          time: yl.startTime,
          text: yl.text || (gap > 8 ? "♪" : ""),
          translation,
          isInterlude: !yl.text,
          words: yl.words,
        });
      }
      return out;
    }

    // 无逐字歌词：普通处理
    const out: ParsedLyric[] = [];
    for (let i = 0; i < src.length; i++) {
      const cur = src[i];
      const next = src[i + 1];
      const parsed = parseLyricLine(cur.text);
      const gap = next ? next.time - cur.time : 0;
      out.push({
        time: cur.time,
        text: parsed.text || (gap > 8 ? "♪" : ""),
        translation: (cur as any).translation || parsed.translation,
        subText: parsed.subText,
        isInterlude: !parsed.text,
      });
    }
    return out;
  });

  const activeIndex = computed(() => store.activeLyricIndex);

  /** 进度条悬停预览：返回对应时间点的歌词文本 */
  function getLyricAtTime(t: number): string {
    if (!parsedLyrics.value.length) return formatTime(t);
    let found = "";
    for (const line of parsedLyrics.value) {
      if (line.time <= t && line.text && !line.isInterlude) {
        found = line.text.length > 30 ? line.text.slice(0, 30) + "..." : line.text;
      } else if (line.time > t) break;
    }
    return found || formatTime(t);
  }

  // ===== 歌词选择模式（NpTopbar 显示提示条 + NpLyrics 处理点击） =====
  const lyricSelectMode = ref(false);
  const selectedLyricLines = ref<Set<number>>(new Set());
  /** 进入选择模式时冻结的 activeIndex（停止自动滚动） */
  const frozenActiveIndex = ref(-1);
  /** 翻译开关按钮可见性（鼠标在右下角区域附近时显示） */
  const translateBtnVisible = ref(false);

  function enterLyricSelectMode() {
    lyricSelectMode.value = true;
    frozenActiveIndex.value = activeIndex.value;
    selectedLyricLines.value = new Set();
    if (typeof document !== "undefined") {
      document.body.classList.add("lyric-select-mode");
    }
    log.info("now-playing", "entered lyric select mode", { frozenIndex: frozenActiveIndex.value });
  }

  function exitLyricSelectMode() {
    if (!lyricSelectMode.value) return;
    lyricSelectMode.value = false;
    selectedLyricLines.value = new Set();
    frozenActiveIndex.value = -1;
    if (typeof document !== "undefined") {
      document.body.classList.remove("lyric-select-mode");
    }
  }

  function toggleLyricLineSelection(idx: number) {
    const s = new Set(selectedLyricLines.value);
    if (s.has(idx)) s.delete(idx);
    else s.add(idx);
    selectedLyricLines.value = s;
  }

  function selectAllLyrics() {
    const s = new Set<number>();
    for (let i = 0; i < parsedLyrics.value.length; i++) s.add(i);
    selectedLyricLines.value = s;
  }

  async function copySelectedLyrics() {
    if (selectedLyricLines.value.size === 0) return;
    const indices = Array.from(selectedLyricLines.value).sort((a, b) => a - b);
    const lines: string[] = [];
    for (const idx of indices) {
      const line = parsedLyrics.value[idx];
      if (!line || line.isInterlude) continue;
      let text = line.text || "";
      if (line.translation && settings.showTranslation) {
        text += "\n" + line.translation;
      }
      lines.push(text);
    }
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      log.info("now-playing", "lyrics copied", { count: lines.length, length: text.length });
      toast.success("复制成功", `已复制 ${lines.length} 行歌词到剪贴板`);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast.success("复制成功", `已复制 ${lines.length} 行歌词到剪贴板`);
    }
  }

  // ===== 队列 =====
  const queueList = computed(() => store.queue);

  // ===== 应用级 watcher（单例生命周期内只挂载一次） =====
  // 当歌曲变化时：重置 liked + 重新拉百科（若百科面板已打开则刷新数据）
  //  - 监听 currentIndex（切歌时立即变化），确保百科面板已打开时自动刷新
  watch(() => store.currentIndex, () => {
    liked.value = false;
    // 若百科面板已打开，自动拉取新歌曲的百科数据
    if (showWiki.value) {
      void preloadWiki();
    }
  });
  // neteaseId 就绪后再触发一次（currentIndex 变化时 neteaseId 可能还没设置）
  watch(() => store.currentSong?.neteaseId, (newId, oldId) => {
    if (newId !== oldId && showWiki.value) {
      void preloadWiki();
    }
  });

  // 当歌曲变化 OR 当前歌曲的 yrcText 异步就绪时，重新解析 yrc
  //  - 第一次切歌：song.yrcText 通常还没有（API 异步获取），yrcLines = []
  //  - 后台 _ensureNeteaseLyrics 完成后写入 yrcText，本 watcher 再次触发，解析 yrc
  //  - 切到无 yrc 歌曲：yrcLines 立即清空
  watch(
    () => [store.currentSong, (store.currentSong as any)?.yrcText] as const,
    ([songVal, _yrcText]) => {
      const yrcText = (songVal as any)?.yrcText;
      if (yrcText) {
        yrcLines.value = parseYrcLines(yrcText);
      } else {
        yrcLines.value = [];
      }
    },
    { immediate: true }
  );

  // 同步 liked 状态（异步获取，加竞态保护）
  watch(() => store.currentSong, async (songVal) => {
    if (!songVal || songVal.source !== "netease" || !songVal.neteaseId) return;
    try {
      const likeSet = await getCachedLikeList();
      // 防止异步竞态：若期间歌曲已切换，不写入
      if (store.currentSong !== songVal) return;
      liked.value = likeSet.has(songVal.neteaseId);
    } catch { /* ignore */ }
  }, { immediate: true });

  return {
    // store / settings 共享访问（便于子组件获取 currentTime / duration 等）
    store,
    settings,
    // 喜欢歌曲
    liked,
    likeLoading,
    toggleLike,
    // 布局状态
    showSettings,
    showQueue,
    showWiki,
    topbarVisible,
    qpListRef,
    onMouseMove,
    close,
    toggleFullscreen,
    toggleQueue,
    scrollQueueToCurrent,
    // 歌曲百科
    wikiSummary,
    wikiLoading,
    toggleWiki,
    closeWiki,
    preloadWiki,
    // PlayMode
    playMode,
    cyclePlayMode,
    // 音量
    volumeFrac,
    onVolume,
    toggleMute,
    onVolWheel,
    // 进度
    progressFrac,
    onSeek,
    // 高潮点
    chorusMarkFrac,
    jumpToChorus,
    // 音质
    audioLevels,
    cycleAudioLevel,
    currentLevelLabel,
    // 歌曲信息
    song,
    coverUrl,
    // 歌词解析（跨组件共享）
    yrcLines,
    parsedLyrics,
    activeIndex,
    getLyricAtTime,
    // 歌词选择模式
    lyricSelectMode,
    selectedLyricLines,
    frozenActiveIndex,
    translateBtnVisible,
    enterLyricSelectMode,
    exitLyricSelectMode,
    toggleLyricLineSelection,
    selectAllLyrics,
    copySelectedLyrics,
    // 队列
    queueList,
  };
}

// 类型导出供子组件使用
export type NowPlayingApi = ReturnType<typeof createApi>;
export type QpListRef = Ref<HTMLElement | null>;
