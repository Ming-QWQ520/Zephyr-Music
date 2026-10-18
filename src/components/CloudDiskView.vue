<script setup lang="ts">
/**
 * CloudDiskView — 音乐云盘视图
 *
 * 功能：
 *   - 查看云盘歌曲列表（分页加载、多选批量下载）
 *   - 播放云盘歌曲（点击播放，右键菜单）
 *   - 多文件上传（队列执行，并发上传）
 *   - 多文件下载（批量选择，并发下载）
 *   - 统一传输面板（浮动右下角，显示所有上传/下载进度、速度、剩余时间）
 *   - 删除云盘歌曲
 *   - 搜索云盘歌曲
 *   - 上传/下载记录（点击打开文件所在文件夹）
 *   - 下载文件夹设置
 */
import { ref, computed, onMounted, onUnmounted } from "vue";
import { usePlayerStore } from "@/stores/player";
import {
  userCloud, userCloudDel, cloudUpload, cloudUploadByPath, cloudSongToSong, cloudDownload,
  getCloudArtist, getCloudName,
  getCachedUser, songUrlV1,
  type CloudDiskSong, type UploadProgressData,
} from "@/api/netease";
import { log } from "@/composables/logger";
import { useToast } from "@/composables/useToast";
import { storeGetSync, storeSetSync } from "@/composables/useStore";
import Icon from "@/components/Icon.vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
const store = usePlayerStore();
const toast = useToast();

// ===== Tab 状态 =====
type Tab = "songs" | "uploadRecords" | "downloadRecords";
const activeTab = ref<Tab>("songs");

// ===== 云盘歌曲列表状态 =====
const songs = ref<CloudDiskSong[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const hasMore = ref(false);
const offset = ref(0);
const limit = 30;
const searchKeyword = ref("");
const totalCount = ref(0);

// ===== 多选状态 =====
const selectedIds = ref<Set<number>>(new Set());
const selectionMode = ref(false);
const selectedVersion = ref(0); // 强制 computed 重算

function toggleSelection(songId: number) {
  if (selectedIds.value.has(songId)) selectedIds.value.delete(songId);
  else selectedIds.value.add(songId);
  selectedVersion.value++;
}

function toggleSelectionMode() {
  selectionMode.value = !selectionMode.value;
  if (!selectionMode.value) {
    selectedIds.value.clear();
    selectedVersion.value++;
  }
}

function selectAll() {
  const allSelected = filteredSongs.value.every(s => selectedIds.value.has(s.songId));
  if (allSelected) {
    filteredSongs.value.forEach(s => selectedIds.value.delete(s.songId));
  } else {
    filteredSongs.value.forEach(s => selectedIds.value.add(s.songId));
  }
  selectedVersion.value++;
}

const selectedCount = computed(() => {
  void selectedVersion.value;
  return selectedIds.value.size;
});

const selectedSongs = computed(() => {
  void selectedVersion.value;
  return filteredSongs.value.filter(s => selectedIds.value.has(s.songId));
});

// ===== 统一传输任务管理 =====
type TransferType = "upload" | "download";
type TransferStatus = "queued" | "md5" | "uploading" | "downloading" | "saving" | "import" | "done" | "error";

interface TransferTask {
  id: string;
  type: TransferType;
  filename: string;
  totalSize: number;
  loaded: number;
  speed: number;
  status: TransferStatus;
  phaseText: string;
  startTime: number;
  endTime?: number;
  /** upload: File 对象; download: undefined */
  file?: File;
  /** download: songId; upload: undefined */
  songId?: number;
  songName?: string;
  /** download 完成后的本地路径 */
  filepath?: string;
  /** download 用的 AbortController，支持取消 */
  abortCtrl?: AbortController;
  /** 是否已展开详情（在面板中） */
  expanded?: boolean;
}

const transferTasks = ref<TransferTask[]>([]);
const transferPanelOpen = ref(true);
const MAX_CONCURRENT_DOWNLOAD = 3; // 下载并发 3（Rust 端处理，无 UI 卡顿）

/** 活跃任务（排队中或进行中） */
const activeTasks = computed(() =>
  transferTasks.value.filter(t =>
    t.status !== "done" && t.status !== "error"
  )
);
/** 已完成任务（最近 50 条） */
const completedTasks = computed(() =>
  transferTasks.value.filter(t =>
    t.status === "done" || t.status === "error"
  ).slice(0, 50)
);
/** 活跃下载任务数 */
// activeDownloadCount reserved for future use
/** 总速度（所有活跃任务速度之和） */
const totalSpeed = computed(() =>
  activeTasks.value.reduce((sum, t) => sum + (t.speed || 0), 0)
);
/** 是否有传输任务 */
const hasTransfers = computed(() => transferTasks.value.length > 0);

function updateTask(id: string, patch: Partial<TransferTask>) {
  const task = transferTasks.value.find(t => t.id === id);
  if (task) {
    // 直接 mutate 已有对象属性（Vue 3 reactive 会精确追踪单个属性变更）
    // 比 transferTasks.value[idx] = {...} 更高效，避免创建新对象触发整数组 diff
    for (const [k, v] of Object.entries(patch)) {
      (task as any)[k] = v;
    }
  }
}

function clearCompleted() {
  transferTasks.value = transferTasks.value.filter(t =>
    t.status !== "done" && t.status !== "error"
  );
}

/** 取消任务（仅对 queued/downloading 有效） */
function cancelTask(id: string) {
  const task = transferTasks.value.find(t => t.id === id);
  if (!task) return;
  if (task.abortCtrl) {
    task.abortCtrl.abort();
  }
  updateTask(id, { status: "error", phaseText: "已取消", endTime: Date.now() });
}

// ===== 上传队列调度 =====
let uploadQueueRunning = false;
async function processUploadQueue() {
  if (uploadQueueRunning) return;
  uploadQueueRunning = true;
  let successCount = 0;
  let totalCount = 0;
  try {
    while (true) {
      // 找到下一个排队中的上传任务
      const next = transferTasks.value.find(t =>
        t.type === "upload" && t.status === "queued"
      );
      if (!next) break;
      totalCount++;
      await executeUpload(next);
      // 检查是否成功
      const finished = transferTasks.value.find(t => t.id === next.id);
      if (finished && finished.status === "done") successCount++;
      // 上传间隔 3 秒，避免网易云 API 缓存导致后续文件返回相同的 songId/resourceId
      if (totalCount > 0) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    // 所有上传完成后统一刷新一次列表
    if (totalCount > 0 && successCount > 0) {
      await loadCloud(true);
      if (totalCount > 1) {
        toast.success(`批量上传完成`, `${successCount}/${totalCount} 个文件成功`);
      }
    }
  } finally {
    uploadQueueRunning = false;
  }
}

async function executeUpload(task: TransferTask) {
  log.info("clouddisk", "executeUpload start", { id: task.id, filename: task.filename, hasFilepath: !!task.filepath, hasFile: !!task.file });
  updateTask(task.id, { status: "md5", phaseText: "计算文件 MD5..." });
  try {
    let songId: string | null = null;
    const onProgress = (data: UploadProgressData) => {
      const patch: Partial<TransferTask> = {
        loaded: data.loaded,
        totalSize: data.total || task.totalSize,
        speed: data.speed,
        phaseText: data.phaseText,
      };
      if (data.phase === "md5") patch.status = "md5";
      else if (data.phase === "uploading") patch.status = "uploading";
      else if (data.phase === "import") patch.status = "import";
      else if (data.phase === "complete") { patch.status = "done"; patch.endTime = Date.now(); }
      updateTask(task.id, patch);
    };

    if (task.filepath) {
      // Tauri 环境：客户端直传模式（MD5 → token → PUT → complete）
      log.info("clouddisk", "executeUpload: using client direct upload (cloudUploadByPath)", { filepath: task.filepath });
      let fileSize = task.totalSize;
      if (!fileSize) {
        try {
          fileSize = await invoke<number>("get_file_size", { filepath: task.filepath });
          updateTask(task.id, { totalSize: fileSize });
          log.info("clouddisk", "executeUpload: file size", { fileSize });
        } catch (e) { log.warn("clouddisk", "get_file_size failed", { error: String(e) }); }
      }
      songId = await cloudUploadByPath(task.filepath, task.filename, fileSize, task.id, onProgress);
    } else if (task.file) {
      // 浏览器 fallback：用 File 对象
      log.warn("clouddisk", "executeUpload: using browser fallback (cloudUpload with File)", { filename: task.filename });
      const file = task.file;
      if (!task.totalSize) { updateTask(task.id, { totalSize: file.size }); }
      songId = await cloudUpload(file, onProgress);
    } else {
      updateTask(task.id, { status: "error", phaseText: "无文件", endTime: Date.now() });
      return;
    }

    const finalSize = task.totalSize || task.file?.size || 0;
    // 记录到上传历史
    uploadRecords.value.unshift({
      filename: task.filename, songId: songId || "", songName: task.filename,
      fileSize: finalSize, time: Date.now(), success: !!songId,
    });
    saveUploadRecords();
    if (songId) {
      toast.success("上传成功", task.filename);
    } else {
      toast.error("上传失败", task.filename);
      updateTask(task.id, { status: "error", phaseText: "上传失败", endTime: Date.now() });
    }
  } catch (e) {
    log.warn("clouddisk", "upload failed", { error: String(e) });
    toast.error("上传失败", String(e));
    updateTask(task.id, { status: "error", phaseText: String(e), endTime: Date.now() });
    uploadRecords.value.unshift({
      filename: task.filename, songId: "", songName: task.filename,
      fileSize: task.totalSize || 0, time: Date.now(), success: false,
    });
    saveUploadRecords();
  }
}

// ===== 下载队列调度 =====
let downloadQueueRunning = false;
async function processDownloadQueue() {
  if (downloadQueueRunning) return;
  downloadQueueRunning = true;
  try {
    while (true) {
      // 当前正在下载的任务数
      const running = transferTasks.value.filter(t =>
        t.type === "download" &&
        t.status !== "queued" && t.status !== "done" && t.status !== "error"
      ).length;
      if (running >= MAX_CONCURRENT_DOWNLOAD) {
        // 等待 500ms 再检查（降低轮询频率，减少 CPU 占用）
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      const next = transferTasks.value.find(t =>
        t.type === "download" && t.status === "queued"
      );
      if (!next) break;
      executeDownload(next); // 不 await，允许并发
    }
  } finally {
    downloadQueueRunning = false;
  }
}

async function executeDownload(task: TransferTask) {
  if (!task.songId) return;
  const cloudSong = songs.value.find(s => s.songId === task.songId);
  if (!cloudSong) {
    updateTask(task.id, { status: "error", phaseText: "歌曲不存在", endTime: Date.now() });
    return;
  }
  updateTask(task.id, { status: "downloading", phaseText: "获取下载链接..." });
  try {
    const res = await cloudDownload(task.songId);
    const url = res.url || res.data?.url;
    if (!url) {
      toast.error("下载失败", `未获取到下载链接: ${task.songName}`);
      updateTask(task.id, { status: "error", phaseText: "无下载链接", endTime: Date.now() });
      return;
    }
    const artist = getCloudArtist(cloudSong);
    const ext = url.match(/\.(mp3|flac|wav|ape|m4a|ogg)/i)?.[0] || ".mp3";
    const filename = `${task.songName} - ${artist}${ext}`;
    updateTask(task.id, { filename, phaseText: "下载中..." });

    const folder = downloadFolder.value || await getDefaultDownloadFolder();
    const filepath = await join(folder, filename);

    // 用 Rust 端流式下载，避免前端 IPC 传输大块数据的开销
    // 通过 Tauri 事件接收进度更新
    const eventName = `download-progress-${task.id}`;
    let unlisten: UnlistenFn | null = null;
    let lastSpeedTime = Date.now();
    let lastSpeedLoaded = 0;

    unlisten = await listen<{ loaded: number; total: number; done?: boolean }>(eventName, (e) => {
      const { loaded, total, done } = e.payload;
      // 速度计算
      const now = Date.now();
      let speed = 0;
      const dt = (now - lastSpeedTime) / 1000;
      if (dt >= 0.5 && loaded > lastSpeedLoaded) {
        speed = (loaded - lastSpeedLoaded) / dt;
        lastSpeedTime = now;
        lastSpeedLoaded = loaded;
      }
      updateTask(task.id, {
        loaded,
        totalSize: total || cloudSong.fileSize,
        speed,
        status: done ? "saving" : "downloading",
      });
    });

    // 调用 Rust 命令下载（阻塞直到完成）
    const fileSize = await invoke<number>("download_file_stream", {
      url,
      filepath,
      taskId: task.id,
    });
    unlisten();

    updateTask(task.id, {
      loaded: fileSize,
      totalSize: fileSize,
      speed: 0,
      status: "done",
      phaseText: "已完成",
      endTime: Date.now(),
      filepath,
    });
    downloadRecords.value.unshift({
      filename, filepath, songName: task.songName || "",
      fileSize, time: Date.now(), success: true,
    });
    saveDownloadRecords();
  } catch (e: any) {
    if (e?.name === "AbortError") return;
    log.warn("clouddisk", "download failed", { error: String(e) });
    toast.error("下载失败", task.songName || "");
    updateTask(task.id, { status: "error", phaseText: String(e), endTime: Date.now() });
    const errTask = transferTasks.value.find(t => t.id === task.id);
    downloadRecords.value.unshift({
      filename: task.filename || "", filepath: "", songName: task.songName || "",
      fileSize: errTask?.loaded || 0, time: Date.now(), success: false,
    });
    saveDownloadRecords();
  }
}

// ===== 下载文件夹设置 =====
const downloadFolder = ref<string>("");

async function getDefaultDownloadFolder(): Promise<string> {
  try {
    const exeDir = await invoke<string>("get_exe_dir");
    return await join(exeDir, "CloudDownload");
  } catch (e) {
    log.warn("clouddisk", "get_exe_dir failed", { error: String(e) });
    return "CloudDownload";
  }
}

async function loadDownloadFolder() {
  const saved = storeGetSync("cloud-download-folder");
  if (saved) downloadFolder.value = saved;
  else downloadFolder.value = await getDefaultDownloadFolder();
}

async function chooseDownloadFolder() {
  try {
    const selected = await openDialog({ directory: true, title: "选择下载文件夹" });
    if (selected) {
      downloadFolder.value = selected;
      storeSetSync("cloud-download-folder", selected);
      toast.success("已设置下载文件夹", selected);
    }
  } catch (e) {
    log.warn("clouddisk", "choose folder failed", { error: String(e) });
  }
}

// ===== 上传/下载记录 =====
interface UploadRecord {
  filename: string; songId: string; songName: string;
  fileSize: number; time: number; success: boolean;
}
interface DownloadRecord {
  filename: string; filepath: string; songName: string;
  fileSize: number; time: number; success: boolean;
}
const uploadRecords = ref<UploadRecord[]>([]);
const downloadRecords = ref<DownloadRecord[]>([]);

function loadRecords() {
  try {
    const upRaw = storeGetSync("cloud-upload-records");
    if (upRaw) uploadRecords.value = JSON.parse(upRaw);
    const dlRaw = storeGetSync("cloud-download-records");
    if (dlRaw) downloadRecords.value = JSON.parse(dlRaw);
  } catch { /* ignore */ }
}
function saveUploadRecords() { storeSetSync("cloud-upload-records", JSON.stringify(uploadRecords.value.slice(0, 100))); }
function saveDownloadRecords() { storeSetSync("cloud-download-records", JSON.stringify(downloadRecords.value.slice(0, 100))); }

async function openInFolder(filepath: string) {
  try { await invoke("open_in_folder", { path: filepath }); }
  catch (e) { log.warn("clouddisk", "open folder failed", { error: String(e) }); toast.error("打开文件夹失败", "请手动打开"); }
}

// ===== 右键菜单 =====
const contextMenu = ref<{ visible: boolean; x: number; y: number; song: CloudDiskSong | null }>({ visible: false, x: 0, y: 0, song: null });

// ===== 计算属性 =====
const filteredSongs = computed(() => {
  if (!searchKeyword.value) return songs.value;
  const kw = searchKeyword.value.toLowerCase();
  return songs.value.filter(s =>
    getCloudName(s).toLowerCase().includes(kw) || getCloudArtist(s).toLowerCase().includes(kw)
  );
});

/** 歌曲列表带下载任务状态
 *  用 Map 索引任务，避免对每首歌都 find（O(n*m) → O(n+m)） */
const songsWithTaskState = computed(() => {
  // 构建 songId → activeTask 的索引
  const activeBySongId = new Map<number, TransferTask>();
  const doneBySongId = new Set<number>();
  for (const t of transferTasks.value) {
    if (t.type === "download" && t.songId !== undefined) {
      if (t.status === "done") doneBySongId.add(t.songId);
      else if (t.status !== "error") activeBySongId.set(t.songId, t);
    }
  }
  return filteredSongs.value.map(s => ({
    song: s,
    task: activeBySongId.get(s.songId),
    done: doneBySongId.has(s.songId),
  }));
});

// ===== 数据加载 =====
async function loadCloud(reload = false) {
  if (reload) { offset.value = 0; songs.value = []; }
  loading.value = reload;
  loadingMore.value = !reload;
  try {
    const user = await getCachedUser();
    if (!user) { toast.error("请先登录"); return; }
    const res = await userCloud(limit, offset.value);
    if (res.code === 200) {
      const newSongs = res.data || [];
      if (reload) { songs.value = newSongs; } else { songs.value = [...songs.value, ...newSongs]; }
      hasMore.value = newSongs.length >= limit;
      totalCount.value = res.count || songs.value.length;
    } else { toast.error("加载失败", `code: ${res.code}`); }
  } catch (e) {
    log.warn("clouddisk", "load failed", { error: String(e) });
    toast.error("加载失败", "请稍后重试");
  } finally { loading.value = false; loadingMore.value = false; }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return;
  offset.value += limit;
  await loadCloud(false);
}

// ===== 播放 =====
async function playSong(cloudSong: CloudDiskSong) {
  try {
    const song = cloudSongToSong(cloudSong);
    if (!song.url && song.neteaseId) {
      toast.info("获取播放地址...", song.name);
      const urlRes = await songUrlV1(song.neteaseId, "standard");
      const d = urlRes.data?.[0];
      if (d?.url) { song.url = d.url; } else { toast.error("无法播放", "获取播放地址失败"); return; }
    }
    store.playNow(song);
  } catch (e) { log.warn("clouddisk", "play failed", { error: String(e) }); toast.error("播放失败", "请稍后重试"); }
}

// ===== 多文件上传 =====
const uploadFileInput = ref<HTMLInputElement | null>(null);

async function triggerUpload() {
  // 优先用 Tauri dialog（获取真实文件路径，Rust 可直接读取）
  try {
    log.info("clouddisk", "triggerUpload: opening tauri dialog");
    const selected = await openDialog({
      multiple: true,
      title: "选择要上传的音乐文件",
      filters: [{ name: "音乐", extensions: ["mp3", "flac", "wav", "ape", "m4a"] }],
    });
    log.info("clouddisk", "triggerUpload: dialog result", { selected: typeof selected === "string" ? selected : Array.isArray(selected) ? `${selected.length} files` : String(selected) });
    if (!selected) {
      log.info("clouddisk", "triggerUpload: dialog cancelled");
      return;
    }
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length === 0) {
      log.warn("clouddisk", "triggerUpload: no paths returned");
      return;
    }
    addUploadTasks(paths);
  } catch (e) {
    // fallback: 浏览器环境用 input file
    log.warn("clouddisk", "tauri dialog failed, fallback to input", { error: String(e) });
    uploadFileInput.value?.click();
  }
}

function addUploadTasks(filepaths: string[]) {
  log.info("clouddisk", "addUploadTasks", { count: filepaths.length, paths: filepaths.map(p => p.slice(-40)) });
  for (const filepath of filepaths) {
    const id = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const filename = filepath.split(/[/\\]/).pop() || filepath;
    transferTasks.value.push({
      id, type: "upload",
      filename,
      totalSize: 0, // 稍后从 Rust 获取
      loaded: 0,
      speed: 0,
      status: "queued",
      phaseText: "排队中...",
      startTime: Date.now(),
      filepath, // 存储 Rust 可读的本地路径
    });
  }
  toast.info("已添加上传任务", `${filepaths.length} 个文件`);
  processUploadQueue();
}

async function onFilesSelected(e: Event) {
  // 浏览器 fallback：File 对象无法直接传给 Rust，需要先写入临时文件
  // Tauri 环境下用 triggerUpload 的 dialog 路径，不会走到这里
  const input = e.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  const files = Array.from(input.files);
  input.value = "";
  for (const file of files) {
    const id = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    transferTasks.value.push({
      id, type: "upload",
      filename: file.name,
      totalSize: file.size,
      loaded: 0,
      speed: 0,
      status: "queued",
      phaseText: "排队中...",
      startTime: Date.now(),
      file,
    });
  }
  toast.info("已添加上传任务", `${files.length} 个文件`);
  processUploadQueue();
}

// ===== 下载 =====
function downloadSong(cloudSong: CloudDiskSong) {
  // 检查是否已有该歌曲的下载任务
  const existing = transferTasks.value.find(t =>
    t.type === "download" && t.songId === cloudSong.songId &&
    t.status !== "done" && t.status !== "error"
  );
  if (existing) return;
  const id = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  transferTasks.value.push({
    id, type: "download",
    filename: "",
    totalSize: cloudSong.fileSize,
    loaded: 0,
    speed: 0,
    status: "queued",
    phaseText: "排队中...",
    startTime: Date.now(),
    songId: cloudSong.songId,
    songName: getCloudName(cloudSong),
  });
  processDownloadQueue();
}

/** 批量下载选中的歌曲 */
function downloadSelected() {
  if (selectedSongs.value.length === 0) return;
  for (const song of selectedSongs.value) {
    downloadSong(song);
  }
  toast.info("已添加下载任务", `${selectedSongs.value.length} 首歌曲`);
  // 退出选择模式
  selectionMode.value = false;
  selectedIds.value.clear();
  selectedVersion.value++;
}

// ===== 删除 =====
async function deleteSong(cloudSong: CloudDiskSong) {
  try {
    const res = await userCloudDel(cloudSong.songId);
    if (res.code === 200) { toast.success("已删除", getCloudName(cloudSong)); songs.value = songs.value.filter(s => s.songId !== cloudSong.songId); }
    else { toast.error("删除失败", `code: ${res.code}`); }
  } catch (e) { log.warn("clouddisk", "delete failed", { error: String(e) }); toast.error("删除失败", "请稍后重试"); }
}

// ===== 右键菜单 =====
function onContextMenu(e: MouseEvent, song: CloudDiskSong) {
  e.preventDefault();
  e.stopPropagation();
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, song };
  requestAnimationFrame(() => {
    const els = document.querySelectorAll(".ctx-menu");
    const el = els[els.length - 1] as HTMLElement | null;
    if (!el) return;
    const mw = el.offsetWidth, mh = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let x = e.clientX, y = e.clientY;
    if (x + mw > vw - 8) x = vw - mw - 8;
    if (y + mh > vh - 8) y = vh - mh - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    contextMenu.value = { visible: true, x, y, song };
  });
}
function closeContextMenu() { contextMenu.value.visible = false; }
function onDocClick() { closeContextMenu(); }

// ===== 工具函数 =====
function formatFileSize(bytes: number): string {
  if (!bytes) return "—";
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB";
  return bytes + " B";
}
function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec < 1) return "—";
  if (bytesPerSec >= 1024 * 1024) return (bytesPerSec / 1024 / 1024).toFixed(1) + " MB/s";
  if (bytesPerSec >= 1024) return (bytesPerSec / 1024).toFixed(0) + " KB/s";
  return bytesPerSec.toFixed(0) + " B/s";
}
function formatTime(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function progressPercent(loaded: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((loaded / total) * 100));
}
function formatEta(loaded: number, total: number, speed: number): string {
  if (!total || !speed || loaded >= total) return "";
  const remainingBytes = total - loaded;
  const remainingSec = remainingBytes / speed;
  if (remainingSec < 1) return "<1s";
  if (remainingSec < 60) return `${Math.round(remainingSec)}s`;
  const min = Math.floor(remainingSec / 60);
  const sec = Math.round(remainingSec % 60);
  return `${min}m${sec}s`;
}
function taskStatusText(task: TransferTask): string {
  switch (task.status) {
    case "queued": return "排队中";
    case "md5": return "计算MD5";
    case "uploading": return `上传 ${progressPercent(task.loaded, task.totalSize)}%`;
    case "downloading": return `下载 ${progressPercent(task.loaded, task.totalSize)}%`;
    case "saving": return "保存中";
    case "import": return "完成导入";
    case "done": return "已完成";
    case "error": return "失败";
  }
}

onMounted(async () => {
  document.addEventListener("click", onDocClick);
  await loadDownloadFolder();
  loadRecords();
  loadCloud(true);
});
onUnmounted(() => { document.removeEventListener("click", onDocClick); });
</script>

<template>
  <section class="clouddisk-view nice-scroll" @click="closeContextMenu">
    <!-- Header -->
    <header class="cd-header">
      <div class="cd-header-left">
        <h1 class="cd-title">音乐云盘</h1>
        <span v-if="totalCount && activeTab === 'songs'" class="cd-count">{{ totalCount }} 首</span>
      </div>
      <div class="cd-header-right">
        <div class="cd-tabs">
          <button class="cd-tab" :class="{ active: activeTab === 'songs' }" @click="activeTab = 'songs'">云盘歌曲</button>
          <button class="cd-tab" :class="{ active: activeTab === 'uploadRecords' }" @click="activeTab = 'uploadRecords'">上传记录</button>
          <button class="cd-tab" :class="{ active: activeTab === 'downloadRecords' }" @click="activeTab = 'downloadRecords'">下载记录</button>
        </div>
      </div>
    </header>

    <!-- ===== 云盘歌曲 Tab ===== -->
    <template v-if="activeTab === 'songs'">
      <div class="cd-toolbar">
        <div class="cd-search">
          <Icon name="search" :size="14" />
          <input v-model="searchKeyword" placeholder="搜索云盘歌曲" class="cd-search-input" />
        </div>
        <button class="cd-upload-btn" @click="triggerUpload">
          <Icon name="plus" :size="16" /><span>上传歌曲</span>
        </button>
        <input ref="uploadFileInput" type="file" accept=".mp3,.flac,.wav,.ape,.m4a" multiple style="display:none" @change="onFilesSelected" />
        <button class="cd-select-btn" :class="{ active: selectionMode }" @click="toggleSelectionMode">
          <Icon name="check" :size="14" /><span>{{ selectionMode ? '退出选择' : '批量选择' }}</span>
        </button>
        <button v-if="selectionMode && selectedCount > 0" class="cd-batch-dl-btn" @click="downloadSelected">
          <Icon name="download" :size="14" /><span>下载选中 ({{ selectedCount }})</span>
        </button>
        <button v-if="selectionMode" class="cd-select-all-btn" @click="selectAll">
          <Icon name="check" :size="14" /><span>全选</span>
        </button>
        <button class="cd-refresh-btn" :disabled="loading" title="刷新" @click="loadCloud(true)"><Icon name="history" :size="16" /></button>
        <button class="cd-folder-btn" title="下载文件夹设置" @click="chooseDownloadFolder">
          <Icon name="folder" :size="16" />
          <span class="cd-folder-path">{{ downloadFolder ? downloadFolder.split(/[/\\]/).pop() : 'CloudDownload' }}</span>
        </button>
      </div>

      <div v-if="loading" class="cd-loading"><div class="cd-spinner" /><span>加载中...</span></div>
      <div v-else-if="filteredSongs.length === 0" class="cd-empty">
        <Icon name="folder" :size="48" />
        <p>{{ searchKeyword ? '未找到匹配歌曲' : '云盘暂无歌曲' }}</p>
        <button v-if="!searchKeyword" class="cd-upload-btn" @click="triggerUpload"><Icon name="plus" :size="16" /><span>上传第一首</span></button>
      </div>
      <div v-else class="cd-list">
        <div class="cd-list-header" :class="{ 'has-checkbox': selectionMode }">
          <span v-if="selectionMode" class="cd-col-check"></span>
          <span class="cd-col-idx">#</span><span class="cd-col-name">歌曲</span><span class="cd-col-artist">艺术家</span><span class="cd-col-size">大小</span><span class="cd-col-date">上传日期</span><span class="cd-col-action">操作</span>
        </div>
        <div v-for="(item, idx) in songsWithTaskState" :key="item.song.songId" class="cd-list-item-wrap" :class="{ active: item.song.songId === store.currentSong?.neteaseId, selected: selectedIds.has(item.song.songId) }">
          <div class="cd-list-item" :class="{ 'has-checkbox': selectionMode }" @click="selectionMode ? toggleSelection(item.song.songId) : playSong(item.song)" @contextmenu="onContextMenu($event, item.song)">
            <span v-if="selectionMode" class="cd-col-check" @click.stop="toggleSelection(item.song.songId)">
              <div class="cd-checkbox" :class="{ checked: selectedIds.has(item.song.songId) }"></div>
            </span>
            <span class="cd-col-idx">{{ idx + 1 }}</span>
            <span class="cd-col-name truncate">{{ getCloudName(item.song) }}</span>
            <span class="cd-col-artist truncate">{{ getCloudArtist(item.song) }}</span>
            <span class="cd-col-size">{{ formatFileSize(item.song.fileSize) }}</span>
            <span class="cd-col-date">{{ formatTime(item.song.addTime) }}</span>
            <span class="cd-col-action" @click.stop>
              <button v-if="!item.task && !item.done" class="cd-action-btn" title="下载" @click.stop="downloadSong(item.song)"><Icon name="download" :size="14" /></button>
              <div v-else-if="item.task" class="cd-action-btn cd-action-progress" :title="taskStatusText(item.task)">
                <div class="cd-mini-spinner" />
              </div>
              <Icon v-else name="check" :size="14" class="cd-action-done" />
            </span>
          </div>
          <!-- 行内迷你进度条 -->
          <div v-if="item.task" class="cd-inline-progress">
            <div class="cd-inline-bar">
              <div class="cd-inline-fill" :class="{ 'is-error': item.task.status === 'error' }" :style="{ width: (item.task.status === 'done' ? 100 : progressPercent(item.task.loaded, item.task.totalSize)) + '%' }"></div>
            </div>
            <span class="cd-inline-text">{{ taskStatusText(item.task) }} · {{ formatFileSize(item.task.loaded) }}/{{ formatFileSize(item.task.totalSize) }}</span>
          </div>
        </div>
      </div>
      <div v-if="hasMore && !loading" class="cd-load-more">
        <button class="cd-load-more-btn" :disabled="loadingMore" @click="loadMore">{{ loadingMore ? '加载中...' : '加载更多' }}</button>
      </div>
    </template>

    <!-- ===== 上传记录 Tab ===== -->
    <template v-if="activeTab === 'uploadRecords'">
      <div v-if="uploadRecords.length === 0" class="cd-empty"><Icon name="history" :size="48" /><p>暂无上传记录</p></div>
      <div v-else class="cd-records">
        <div v-for="record in uploadRecords" :key="record.time" class="cd-record-card">
          <div class="cd-record-info">
            <div class="cd-record-name" :title="record.filename">{{ record.filename }}</div>
            <div class="cd-record-meta">
              <span>{{ formatFileSize(record.fileSize) }}</span>
              <span>{{ formatTime(record.time) }}</span>
              <span :class="record.success ? 'cd-status-ok' : 'cd-status-fail'">{{ record.success ? '成功' : '失败' }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ===== 下载记录 Tab ===== -->
    <template v-if="activeTab === 'downloadRecords'">
      <div v-if="downloadRecords.length === 0" class="cd-empty"><Icon name="download" :size="48" /><p>暂无下载记录</p></div>
      <div v-else class="cd-records">
        <div v-for="record in downloadRecords" :key="record.time" class="cd-record-card" :class="{ clickable: record.success && record.filepath }" @click="record.success && record.filepath && openInFolder(record.filepath)">
          <div class="cd-record-info">
            <div class="cd-record-name" :title="record.filename">{{ record.filename }}</div>
            <div class="cd-record-meta">
              <span>{{ formatFileSize(record.fileSize) }}</span>
              <span>{{ formatTime(record.time) }}</span>
              <span :class="record.success ? 'cd-status-ok' : 'cd-status-fail'">{{ record.success ? '成功' : '失败' }}</span>
            </div>
          </div>
          <button v-if="record.success && record.filepath" class="cd-action-btn" title="打开文件夹" @click.stop="openInFolder(record.filepath)"><Icon name="folder" :size="16" /></button>
        </div>
      </div>
    </template>

    <!-- ===== 浮动传输面板 ===== -->
    <Teleport to="body">
      <Transition name="tp-slide">
        <div v-if="hasTransfers" class="cd-transfer-panel" :class="{ collapsed: !transferPanelOpen }">
          <div class="tp-header" @click="transferPanelOpen = !transferPanelOpen">
            <div class="tp-header-left">
              <Icon name="transfer" :size="14" />
              <span class="tp-title">传输列表</span>
              <span v-if="activeTasks.length > 0" class="tp-active-count">{{ activeTasks.length }} 个进行中</span>
            </div>
            <div class="tp-header-right">
              <span v-if="totalSpeed > 0" class="tp-total-speed">{{ formatSpeed(totalSpeed) }}</span>
              <button class="tp-clear-btn" title="清空已完成" @click.stop="clearCompleted"><Icon name="trash" :size="12" /></button>
              <div class="tp-toggle-icon" :class="{ rotated: transferPanelOpen }"><Icon name="chevronDown" :size="14" /></div>
            </div>
          </div>
          <div v-show="transferPanelOpen" class="tp-body nice-scroll">
            <!-- 活跃任务 -->
            <div v-for="task in activeTasks" :key="task.id" class="tp-task" :class="{ 'is-upload': task.type === 'upload', 'is-download': task.type === 'download' }">
              <div class="tp-task-row">
                <Icon :name="task.type === 'upload' ? 'upload' : 'download'" :size="12" class="tp-task-icon" />
                <span class="tp-task-name truncate">{{ task.filename || task.songName }}</span>
                <span class="tp-task-status" :class="{ 'is-error': task.status === 'error' }">{{ taskStatusText(task) }}</span>
                <button v-if="task.status === 'queued' || task.status === 'downloading' || task.status === 'uploading'" class="tp-cancel-btn" title="取消" @click.stop="cancelTask(task.id)"><Icon name="close" :size="10" /></button>
              </div>
              <div class="tp-task-bar">
                <div class="tp-task-fill" :class="{ 'is-md5': task.status === 'md5', 'is-error': task.status === 'error' }" :style="{ width: progressPercent(task.loaded, task.totalSize) + '%' }"></div>
              </div>
              <div class="tp-task-meta">
                <span>{{ formatFileSize(task.loaded) }} / {{ formatFileSize(task.totalSize) }}</span>
                <span v-if="task.speed > 0 && (task.status === 'uploading' || task.status === 'downloading')">{{ formatSpeed(task.speed) }}</span>
                <span v-if="(task.status === 'uploading' || task.status === 'downloading') && task.speed > 0">剩余 {{ formatEta(task.loaded, task.totalSize, task.speed) || '...' }}</span>
              </div>
            </div>
            <!-- 已完成任务 -->
            <div v-if="completedTasks.length > 0" class="tp-section-divider">
              <span>已完成 ({{ completedTasks.length }})</span>
            </div>
            <div v-for="task in completedTasks" :key="task.id" class="tp-task tp-task-done" :class="{ 'is-error': task.status === 'error' }" @click="task.type === 'download' && task.filepath && task.status === 'done' && openInFolder(task.filepath)">
              <div class="tp-task-row">
                <Icon :name="task.type === 'upload' ? 'upload' : 'download'" :size="12" class="tp-task-icon" />
                <span class="tp-task-name truncate">{{ task.filename || task.songName }}</span>
                <span class="tp-task-status" :class="{ 'is-ok': task.status === 'done', 'is-error': task.status === 'error' }">{{ task.status === 'done' ? '✓' : '✗' }}</span>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <Transition name="ctx-fade">
        <div v-if="contextMenu.visible && contextMenu.song" class="ctx-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @click.stop>
          <button class="ctx-item" @click="contextMenu.song && playSong(contextMenu.song); closeContextMenu()"><Icon name="play" :size="14" /><span>播放</span></button>
          <button class="ctx-item" @click="if (contextMenu.song) { store.playNext(cloudSongToSong(contextMenu.song)); } closeContextMenu()"><Icon name="next" :size="14" /><span>下一首播放</span></button>
          <button class="ctx-item" @click="if (contextMenu.song) { downloadSong(contextMenu.song); } closeContextMenu()"><Icon name="download" :size="14" /><span>下载</span></button>
          <div class="ctx-divider" />
          <button class="ctx-item ctx-danger" @click="if (contextMenu.song) { deleteSong(contextMenu.song); } closeContextMenu()"><Icon name="trash" :size="14" /><span>从云盘删除</span></button>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>

<style scoped>
.clouddisk-view { height: 100%; overflow-y: auto; padding: 24px 28px 24px; display: flex; flex-direction: column; gap: 16px; }
.cd-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-shrink: 0; flex-wrap: wrap; }
.cd-header-left { display: flex; align-items: center; gap: 12px; }
.cd-title { margin: 0; font-size: 24px; font-weight: 700; color: var(--text); }
.cd-count { font-size: 13px; color: var(--text-tertiary); }
.cd-header-right { display: flex; align-items: center; gap: 8px; }

.cd-tabs { display: flex; gap: 4px; background: rgba(255, 255, 255, 0.2); border-radius: 10px; padding: 3px; backdrop-filter: blur(5px) saturate(1); }
.cd-tab { padding: 6px 14px; border-radius: 8px; font-size: 13px; color: var(--text-tertiary); background: transparent; border: none; cursor: pointer; transition: all 0.15s; }
.cd-tab.active { color: var(--text); background: rgba(0, 0, 0, 0.4); }
.cd-tab:hover:not(.active) { color: var(--text-secondary); }

.cd-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cd-search { display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 20px; background: rgba(0, 0, 0, 0.2); border: 1px solid var(--border); backdrop-filter: blur(10px) saturate(1); }
.cd-search-input { background: transparent; border: none; outline: none; color: var(--text); font-size: 13px; width: 160px; font-family: inherit; }
.cd-search-input::placeholder { color: var(--text-tertiary); }
.cd-upload-btn, .cd-select-btn, .cd-batch-dl-btn, .cd-select-all-btn { display: flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 20px; background: rgba(0, 0, 0, 0.2); color: var(--text-tertiary); font-size: 13px; font-weight: 500; border: none; cursor: pointer; transition: opacity 0.15s; backdrop-filter: blur(10px) saturate(1); }
.cd-upload-btn:hover, .cd-select-btn:hover { color: #fff; }
.cd-select-btn.active { background: var(--accent); color: #fff; }
.cd-batch-dl-btn { background: var(--accent); color: #fff; }
.cd-batch-dl-btn:hover { opacity: 0.9; }
.cd-select-all-btn { padding: 8px 12px; }
.cd-refresh-btn, .cd-folder-btn { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 20px; background: rgba(0, 0, 0, 0.5); border: 1px solid var(--border); color: var(--text-secondary); cursor: pointer; transition: all 0.15s; font-size: 12px; backdrop-filter: blur(3px) saturate(1); }
.cd-refresh-btn:hover, .cd-folder-btn:hover { color: var(--accent); border-color: var(--accent); }
.cd-refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.cd-folder-path { max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.cd-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 80px 0; color: var(--text-tertiary); font-size: 14px; }
.cd-spinner { width: 28px; height: 28px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
.cd-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 80px 0; color: var(--text-tertiary); }
.cd-empty p { margin: 0; font-size: 14px; }

/* Song list */
.cd-list { display: flex; flex-direction: column; gap: 2px; }
.cd-list-header, .cd-list-item { display: grid; grid-template-columns: 40px 1fr 1fr 80px 140px 80px; gap: 12px; align-items: center; padding: 8px 12px; }
.cd-list-header.has-checkbox, .cd-list-item.has-checkbox { grid-template-columns: 32px 40px 1fr 1fr 80px 140px 80px; }
.cd-list-header { font-size: 12px; color: var(--text-tertiary); border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 4px; }
.cd-list-item-wrap { border-radius: 8px; transition: background 0.1s; }
.cd-list-item-wrap:hover { background: var(--bg-hover); }
.cd-list-item-wrap.active { background: var(--accent-soft); }
.cd-list-item-wrap.selected { background: var(--accent-soft); }
.cd-list-item { cursor: pointer; font-size: 13px; color: var(--text-secondary); }
.cd-list-item-wrap.active .cd-list-item { color: var(--accent); }
.cd-col-idx { text-align: center; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
.cd-col-size, .cd-col-date { font-size: 12px; color: var(--text-tertiary); }
.cd-col-action { display: flex; align-items: center; gap: 6px; justify-content: center; }
.cd-col-check { display: flex; align-items: center; justify-content: center; cursor: pointer; }
.cd-checkbox { width: 16px; height: 16px; border-radius: 4px; border: 2px solid var(--text-tertiary); transition: all 0.15s; }
.cd-checkbox.checked { background: var(--accent); border-color: var(--accent); position: relative; }
.cd-checkbox.checked::after { content: ""; position: absolute; left: 4px; top: 1px; width: 5px; height: 9px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
.cd-action-btn { width: 28px; height: 28px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: none; cursor: pointer; color: var(--text-tertiary); transition: all 0.15s; padding: 0; }
.cd-action-btn:hover { color: var(--accent); background: var(--bg-hover); }
.cd-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.cd-action-done { color: #06d6a0; }
.cd-action-progress { cursor: default; }
.cd-action-progress:hover { background: transparent; color: var(--text-tertiary); }
.cd-mini-spinner { width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
.cd-status-ok { color: #06d6a0; font-size: 12px; }
.cd-status-fail { color: #ff6b6b; font-size: 12px; }

/* 行内迷你进度条 */
.cd-inline-progress { padding: 0 12px 6px; display: flex; align-items: center; gap: 8px; }
.cd-inline-bar { flex: 1; height: 2px; background: var(--bg-elev-1); border-radius: 1px; overflow: hidden; }
.cd-inline-fill { height: 100%; background: var(--accent); border-radius: 1px; transition: width 0.2s ease; }
.cd-inline-fill.is-error { background: #ff6b6b; width: 100% !important; }
.cd-inline-text { font-size: 10px; color: var(--text-tertiary); white-space: nowrap; font-variant-numeric: tabular-nums; }

/* 记录卡片 */
.cd-records { display: flex; flex-direction: column; gap: 8px; }
.cd-record-card { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 10px; background: rgba(255, 255, 255, 0.15); border: 1px solid var(--border); transition: all 0.15s; backdrop-filter: blur(3px) saturate(1); }
.cd-record-card.clickable { cursor: pointer; }
.cd-record-card.clickable:hover { border-color: var(--accent); background: var(--bg-hover); }
.cd-record-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.cd-record-name { font-size: 14px; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cd-record-meta { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--text-tertiary); }

.cd-load-more { display: flex; justify-content: center; padding: 20px 0; }
.cd-load-more-btn { padding: 8px 24px; border-radius: 20px; background: var(--bg-elev-1); border: 1px solid var(--border); color: var(--text-secondary); font-size: 13px; cursor: pointer; transition: all 0.15s; }
.cd-load-more-btn:hover { color: var(--accent); border-color: var(--accent); }
.cd-load-more-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* ===== 浮动传输面板 ===== */
:global(.cd-transfer-panel) { position: fixed; right: 20px; bottom: 90px; width: 360px; max-height: 420px; background: rgba(28, 26, 32, 0.95); backdrop-filter: blur(16px) saturate(1.5); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.5); z-index: 400; display: flex; flex-direction: column; overflow: hidden; }
:global(.cd-transfer-panel.collapsed) { max-height: 44px; }
:global(.tp-header) { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0; }
:global(.tp-header:hover) { background: rgba(255,255,255,0.04); }
:global(.tp-header-left) { display: flex; align-items: center; gap: 8px; }
:global(.tp-title) { font-size: 13px; font-weight: 600; color: #fff; }
:global(.tp-active-count) { font-size: 11px; color: var(--accent); }
:global(.tp-header-right) { display: flex; align-items: center; gap: 8px; }
:global(.tp-total-speed) { font-size: 11px; color: #06d6a0; font-variant-numeric: tabular-nums; }
:global(.tp-clear-btn) { width: 22px; height: 22px; border-radius: 5px; display: flex; align-items: center; justify-content: center; background: transparent; border: none; cursor: pointer; color: rgba(255,255,255,0.5); transition: all 0.15s; padding: 0; }
:global(.tp-clear-btn:hover) { color: #ff6b6b; background: rgba(255,107,107,0.1); }
:global(.tp-toggle-icon) { display: flex; align-items: center; color: rgba(255,255,255,0.5); transition: transform 0.2s; }
:global(.tp-toggle-icon.rotated) { transform: rotate(180deg); }
:global(.tp-body) { flex: 1; overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
:global(.tp-task) { padding: 8px 10px; border-radius: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.04); }
:global(.tp-task-row) { display: flex; align-items: center; gap: 8px; }
:global(.tp-task-icon) { color: rgba(255,255,255,0.4); flex-shrink: 0; }
:global(.tp-task.is-upload .tp-task-icon) { color: #9d4edd; }
:global(.tp-task.is-download .tp-task-icon) { color: #06d6a0; }
:global(.tp-task-name) { flex: 1; min-width: 0; font-size: 12px; color: #fff; }
:global(.tp-task-status) { font-size: 11px; color: var(--accent); white-space: nowrap; }
:global(.tp-task-status.is-ok) { color: #06d6a0; }
:global(.tp-task-status.is-error) { color: #ff6b6b; }
:global(.tp-cancel-btn) { width: 18px; height: 18px; border-radius: 4px; display: flex; align-items: center; justify-content: center; background: transparent; border: none; cursor: pointer; color: rgba(255,255,255,0.4); padding: 0; }
:global(.tp-cancel-btn:hover) { color: #ff6b6b; background: rgba(255,107,107,0.15); }
:global(.tp-task-bar) { height: 3px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; margin: 6px 0 4px; }
:global(.tp-task-fill) { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.2s ease; }
:global(.tp-task-fill.is-md5) { background: linear-gradient(90deg, #9d4edd, #fa233b); }
:global(.tp-task-fill.is-error) { background: #ff6b6b; width: 100% !important; }
:global(.tp-task-meta) { display: flex; align-items: center; gap: 10px; font-size: 10px; color: rgba(255,255,255,0.4); font-variant-numeric: tabular-nums; }
:global(.tp-task-done) { padding: 6px 10px; cursor: default; }
:global(.tp-task-done.is-error .tp-task-name) { color: rgba(255,255,255,0.3); }
:global(.tp-section-divider) { padding: 8px 10px 4px; font-size: 10px; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 0.5px; }
:global(.tp-slide-enter-active), :global(.tp-slide-leave-active) { transition: transform 0.3s, opacity 0.3s; }
:global(.tp-slide-enter-from), :global(.tp-slide-leave-to) { transform: translateX(400px); opacity: 0; }

/* Right-click menu */
:global(.ctx-menu) { position: fixed; z-index: 500; min-width: 180px; background: rgba(30, 28, 34, 0.96); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,0.5); padding: 4px; }
:global(.ctx-item) { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; border-radius: 6px; font-size: 13px; color: rgba(255,255,255,0.9); text-align: left; transition: background 0.1s; background: transparent; border: none; cursor: pointer; }
:global(.ctx-item:hover) { background: rgba(255,255,255,0.1); color: #fff; }
:global(.ctx-danger) { color: #ff6b6b; }
:global(.ctx-danger:hover) { background: rgba(255,107,107,0.15); color: #ff6b6b; }
:global(.ctx-divider) { height: 1px; background: rgba(255,255,255,0.1); margin: 4px 8px; }
:global(.ctx-fade-enter-active), :global(.ctx-fade-leave-active) { transition: opacity 0.12s, transform 0.12s; }
:global(.ctx-fade-enter-from), :global(.ctx-fade-leave-to) { opacity: 0; transform: scale(0.95); }

@keyframes spin { to { transform: rotate(360deg); } }
</style>
